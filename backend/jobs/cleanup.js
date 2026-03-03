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

    // Rule 2: Expire inactive sessions (30 min no activity) - DISABLED per new requirement
    // New requirement says "Session is valid only until expires_at (created_at + 24 hours)"
    // So we should NOT expire them early based on inactivity.
    /*
    const expiredInactive = await db.query(`
      UPDATE sessions
      SET expires_at = NOW()
      WHERE last_activity_at < NOW() - INTERVAL '30 minutes'
        AND expires_at > NOW()
      RETURNING session_id
    `);
    if (expiredInactive.rowCount > 0) {
        console.log(`[CLEANUP] Expired ${expiredInactive.rowCount} inactive sessions`);
    }
    */
    
    // Rule 4: Hard delete sessions expired > 24 hours (Cleanup old data)
    // The requirement says "After expires_at, resolver must never return it".
    // Our queries check `expires_at > NOW()`, so they already respect this.
    // But we need to clean up the DB to prevent bloat.
    // Requirement: "Implement Scheduled cleanup job that deletes expired sessions"
    
    // We delete sessions that have passed their expiration time.
    // Since `expires_at` is set to created_at + 24h, this deletes them after 24h.
    // We add a small buffer (e.g., 1 hour) just in case, or delete immediately?
    // "After 24 hours, devices start fresh." -> So delete immediately after expiry is fine.
    
    const deletedSessions = await db.query(`
      DELETE FROM sessions
      WHERE expires_at < NOW()
      RETURNING session_id
    `);
    
    if (deletedSessions.rowCount > 0) {
        console.log(`[CLEANUP] Deleted ${deletedSessions.rowCount} expired sessions (past 24h limit)`);
    }

    // Log cleanup analytics
    if (expiredWaiting.rowCount > 0 || deletedSessions.rowCount > 0) {
        await logAnalyticsEvent('cleanup_job_completed', {
            expired_waiting: expiredWaiting.rowCount,
            deleted_sessions: deletedSessions.rowCount
        });
    }

  } catch (err) {
    console.error('[CLEANUP] Error during cleanup:', err);
  }
}

// Schedule: every 5 minutes
cron.schedule('*/5 * * * *', cleanupSessions);

module.exports = { cleanupSessions };
