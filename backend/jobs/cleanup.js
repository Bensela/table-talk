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

    // Rule 2: 5-minute timeout for unconfirmed Start Fresh intent
    const expiredFreshIntents = await db.query(`
      UPDATE sessions
      SET dual_status = 'ended',
          expires_at = NOW()
      WHERE (fresh_intent_a = TRUE OR fresh_intent_b = TRUE)
        AND fresh_intent_at <= NOW() - INTERVAL '5 minutes'
        AND dual_status != 'ended'
      RETURNING session_id
    `);
    if (expiredFreshIntents.rowCount > 0) {
        console.log(`[CLEANUP] Terminated ${expiredFreshIntents.rowCount} sessions due to unconfirmed Start Fresh intent`);
        
        // Notify any remaining connected clients that the session is dead
        try {
            const io = require('../index').io;
            if (io) {
                expiredFreshIntents.rows.forEach(row => {
                    io.to(row.session_id).emit('error', { message: 'Session expired' });
                    io.to(row.session_id).disconnectSockets(true);
                });
            }
        } catch (e) {
            console.error('[CLEANUP] Failed to emit socket termination event:', e);
        }
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
