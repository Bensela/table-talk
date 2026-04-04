const cron = require('node-cron');
const db = require('../db');

async function logAnalyticsEvent(event_type, event_data) {
  try {
    await db.query(`
      INSERT INTO analytics_events (event_type, event_data)
      VALUES ($1, $2)
    `, [event_type, event_data]);
  } catch (err) {
    console.error('[CLEANUP] Failed to log analytics event:', err);
  }
}

async function cleanupSessions() {
  console.log('[CLEANUP] Starting session cleanup job...');

  try {
    // Rule 1: Expire waiting dual sessions after 10 minutes
    const expiredWaiting = await db.query(`
      UPDATE sessions
      SET dual_status = 'ended',
          expires_at = NOW(),
          pairing_code_hash = NULL
      WHERE dual_status = 'waiting'
        AND pairing_expires_at < NOW()
        AND expires_at > NOW()
      RETURNING session_id
    `);
    if (expiredWaiting.rowCount > 0) {
        console.log(`[CLEANUP] Expired ${expiredWaiting.rowCount} waiting dual sessions`);
    }

    // Rule 2: Remove old unconfirmed fresh intents instead of terminating the session
    // If a fresh intent has been pending for over 5 minutes and the session is still active,
    // we just clear the intent so it doesn't linger forever.
    const expiredFreshIntents = await db.query(`
      UPDATE sessions
      SET fresh_intent_a = FALSE,
          fresh_intent_b = FALSE,
          fresh_intent_at = NULL
      WHERE (fresh_intent_a = TRUE OR fresh_intent_b = TRUE)
        AND fresh_intent_at <= NOW() - INTERVAL '5 minutes'
        AND dual_status != 'ended'
      RETURNING session_id
    `);
    if (expiredFreshIntents.rowCount > 0) {
        console.log(`[CLEANUP] Cleared unconfirmed Start Fresh intents for ${expiredFreshIntents.rowCount} active sessions`);
    }

    // Rule 3: Extend active sessions at midnight
    // If a session expires (hits 00:00) but has recent activity, extend it by 24h
    const extendedSessions = await db.query(`
      UPDATE sessions
      SET expires_at = expires_at + INTERVAL '24 hours'
      WHERE expires_at <= NOW() 
        AND last_activity_at >= NOW() - INTERVAL '15 minutes'
      RETURNING session_id
    `);
    if (extendedSessions.rowCount > 0) {
        console.log(`[CLEANUP] Extended ${extendedSessions.rowCount} active sessions past midnight`);
    }
    
    // Rule 4: Hard delete sessions expired (midnight cleanup)
    // First delete dependent dual_groups to avoid foreign key violations
    await db.query(`
      DELETE FROM dual_groups
      WHERE active_session_id IN (SELECT session_id FROM sessions WHERE expires_at < NOW())
    `);
    
    const deletedSessions = await db.query(`
      DELETE FROM sessions
      WHERE expires_at < NOW()
      RETURNING session_id
    `);
    
    if (deletedSessions.rowCount > 0) {
        console.log(`[CLEANUP] Deleted ${deletedSessions.rowCount} expired sessions (midnight limit)`);
    }

    // Log cleanup analytics
    if (expiredWaiting.rowCount > 0 || deletedSessions.rowCount > 0 || expiredFreshIntents.rowCount > 0 || extendedSessions.rowCount > 0) {
        await logAnalyticsEvent('cleanup_job_completed', {
            expired_waiting: expiredWaiting.rowCount,
            deleted_sessions: deletedSessions.rowCount,
            expired_fresh: expiredFreshIntents.rowCount,
            extended_sessions: extendedSessions.rowCount
        });
    }

  } catch (err) {
    console.error('[CLEANUP] Error during cleanup:', err);
  }
}

// Schedule: every 5 minutes
cron.schedule('*/5 * * * *', cleanupSessions);

module.exports = { cleanupSessions };
