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
    // Rule 1: Expire waiting dual sessions after 30 minutes
    const expiredWaiting = await db.query(`
      UPDATE sessions
      SET dual_status = 'ended',
          expires_at = NOW(),
          pairing_code_hash = NULL
      WHERE dual_status = 'waiting'
        AND mode = 'dual-phone'
        AND created_at <= NOW() - INTERVAL '30 minutes'
        AND expires_at > NOW()
      RETURNING session_id
    `);
    if (expiredWaiting.rowCount > 0) {
        console.log(`[CLEANUP] Expired ${expiredWaiting.rowCount} waiting dual sessions`);
    }

    // Rule 2: Terminate sessions if Start Fresh is not mutually confirmed within 5 minutes
    const expiredFreshIntents = await db.query(`
      UPDATE sessions
      SET dual_status = 'ended',
          expires_at = NOW(),
          fresh_intent_a = FALSE,
          fresh_intent_b = FALSE,
          fresh_intent_at = NULL
      WHERE (
          (fresh_intent_a = TRUE AND COALESCE(fresh_intent_b, FALSE) = FALSE)
          OR (COALESCE(fresh_intent_a, FALSE) = FALSE AND fresh_intent_b = TRUE)
        )
        AND fresh_intent_at <= NOW() - INTERVAL '5 minutes'
        AND dual_status != 'ended'
      RETURNING session_id
    `);
    if (expiredFreshIntents.rowCount > 0) {
        console.log(`[CLEANUP] Terminated ${expiredFreshIntents.rowCount} sessions due to unconfirmed Start Fresh`);
    }

    // Rule 3: Extend sessions at midnight only if an active phone is present
    const extendedSessions = await db.query(`
      UPDATE sessions
      SET expires_at = expires_at + INTERVAL '24 hours'
      WHERE expires_at <= NOW() 
        AND EXISTS (
          SELECT 1 FROM session_participants sp
          WHERE sp.session_id = sessions.session_id
            AND sp.disconnected_at IS NULL
            AND sp.last_seen_at >= NOW() - INTERVAL '2 minutes'
        )
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
