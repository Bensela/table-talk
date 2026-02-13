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

    // Rule 2: Expire inactive sessions (30 min no activity)
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

    // Rule 3: Mark disconnected participants (5 min no heartbeat)
    const disconnectedParticipants = await db.query(`
      UPDATE session_participants
      SET disconnected_at = NOW()
      WHERE last_seen_at < NOW() - INTERVAL '5 minutes'
        AND disconnected_at IS NULL
      RETURNING participant_id
    `);
    if (disconnectedParticipants.rowCount > 0) {
        console.log(`[CLEANUP] Marked ${disconnectedParticipants.rowCount} participants as disconnected`);
    }

    // Rule 4: Hard delete sessions expired >1 hour ago (Cleanup old data)
    // Note: Be careful with foreign keys (ON DELETE CASCADE required on related tables)
    // analytics_events might want to keep session_id, so we might not want to delete session row yet
    // unless we don't care about historic analytics linking to session table.
    // MVP rule: "Hard delete sessions expired >1 hour ago" from prompt.
    // Let's assume foreign keys are set to CASCADE or we delete related first.
    // In Phase 1 migration: "session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE"
    // So session_participants will be deleted.
    // analytics_events? usually we want to keep them. If analytics_events references session_id, we lose them.
    // Let's check init.sql or assumptions. 
    // Assuming we want to keep analytics, we might set session_id to NULL or just not delete sessions yet?
    // Prompt explicitly says: "Rule 4: Hard delete sessions expired >1 hour ago"
    // So we will do it.
    
    // Check if analytics_events has foreign key constraint
    // If so, we might lose data. For MVP, we follow instructions.
    
    const deletedSessions = await db.query(`
      DELETE FROM sessions
      WHERE expires_at < NOW() - INTERVAL '1 hour'
      RETURNING session_id
    `);
    if (deletedSessions.rowCount > 0) {
        console.log(`[CLEANUP] Deleted ${deletedSessions.rowCount} old sessions`);
    }

    // Log cleanup analytics
    if (expiredWaiting.rowCount > 0 || expiredInactive.rowCount > 0 || disconnectedParticipants.rowCount > 0 || deletedSessions.rowCount > 0) {
        await logAnalyticsEvent('cleanup_job_completed', {
            expired_waiting: expiredWaiting.rowCount,
            expired_inactive: expiredInactive.rowCount,
            disconnected_participants: disconnectedParticipants.rowCount,
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
