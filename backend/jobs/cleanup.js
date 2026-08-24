const cron = require('node-cron');
const db = require('../db');
const { insertAnalyticsEvent, EVENT_TYPES } = require('../services/analyticsService');

async function logAnalyticsEvent(event_type, event_data) {
  try {
    await insertAnalyticsEvent({ event_type, event_data });
  } catch (err) {
    console.error('[CLEANUP] Failed to log analytics event:', err);
  }
}

function notifySessionTermination(sessionRows) {
  if (!sessionRows || sessionRows.length === 0) return;

  try {
    const { io, clearSetupLockForTable } = require('../index');
    if (!io) return;

    sessionRows.forEach((row) => {
      if (row.session_id) {
        io.to(row.session_id).emit('dual_group_terminated');
      }
      if (row.table_token && clearSetupLockForTable) {
        clearSetupLockForTable(row.table_token);
      }
    });
  } catch (err) {
    console.warn('[CLEANUP] Could not notify terminated sessions:', err.message);
  }
}

async function cleanupSessions(source = 'scheduled_cron') {
  console.log('[CLEANUP] Starting session cleanup job...');
  const jobStart = Date.now();
  try {
    await insertAnalyticsEvent({
      event_type: EVENT_TYPES.CLEANUP_JOB_STARTED,
      event_data: { source, scheduled: source === 'scheduled_cron' }
    }).catch(() => null);
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
      RETURNING session_id, table_token, restaurant_id
    `);
    if (expiredWaiting && expiredWaiting.rowCount > 0) {
        console.log(`[CLEANUP] Expired ${expiredWaiting.rowCount} waiting dual sessions`);
        notifySessionTermination(expiredWaiting.rows);
        for (const row of expiredWaiting.rows) {
          await insertAnalyticsEvent({
            session_id: row.session_id,
            restaurant_id: row.restaurant_id || null,
            table_token: row.table_token || null,
            event_type: 'session_end',
            event_data: { reason: 'dual_waiting_timeout_partner_never_joined', source: 'cleanup_job' }
          });
        }
    }

    // Rule 2: Clear unconfirmed Start Fresh intents after 5 minutes
    const expiredFreshIntents = await db.query(`
      UPDATE sessions
      SET fresh_intent_a = FALSE,
          fresh_intent_b = FALSE,
          fresh_intent_at = NULL
      WHERE (
          (fresh_intent_a = TRUE AND COALESCE(fresh_intent_b, FALSE) = FALSE)
          OR (COALESCE(fresh_intent_a, FALSE) = FALSE AND fresh_intent_b = TRUE)
        )
      AND fresh_intent_at <= NOW() - INTERVAL '5 minutes'
      AND dual_status != 'ended'
      RETURNING session_id, table_token, restaurant_id
    `);
    if (expiredFreshIntents && expiredFreshIntents.rowCount > 0) {
        console.log(`[CLEANUP] Cleared unconfirmed Start Fresh intents for ${expiredFreshIntents.rowCount} sessions`);
        for (const row of expiredFreshIntents.rows) {
          await insertAnalyticsEvent({
            session_id: row.session_id,
            restaurant_id: row.restaurant_id || null,
            table_token: row.table_token || null,
            event_type: 'start_fresh_cancelled_timeout',
            event_data: { reason: 'unconfirmed_single_side_fresh_timeout', source: 'cleanup_job' }
          });
        }
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
    if (extendedSessions && extendedSessions.rowCount > 0) {
        console.log(`[CLEANUP] Extended ${extendedSessions.rowCount} active sessions past midnight`);
    }
    
    // Rule 4: Hard delete sessions expired (midnight cleanup)
    // First capture the rows we're about to delete so we can emit session_end events
    const sessionsToDelete = await db.query(`
      SELECT session_id, restaurant_id, table_token
      FROM sessions
      WHERE expires_at < NOW()
    `);
    if (sessionsToDelete && sessionsToDelete.rowCount > 0) {
      for (const row of sessionsToDelete.rows) {
        await insertAnalyticsEvent({
          session_id: row.session_id,
          restaurant_id: row.restaurant_id || null,
          table_token: row.table_token || null,
          event_type: 'session_end',
          event_data: { reason: 'session_timeout_midnight_cleanup', source: 'cleanup_job' }
        });
      }
    }
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
    
    if (deletedSessions && deletedSessions.rowCount > 0) {
        console.log(`[CLEANUP] Deleted ${deletedSessions.rowCount} expired sessions (midnight limit)`);
    }

    // Log cleanup analytics
    const eWaitingCount = expiredWaiting ? expiredWaiting.rowCount : 0;
    const dSessionsCount = deletedSessions ? deletedSessions.rowCount : 0;
    const eFreshCount = expiredFreshIntents ? expiredFreshIntents.rowCount : 0;
    const eSessionsCount = extendedSessions ? extendedSessions.rowCount : 0;
    const durationMs = Math.max(0, Date.now() - jobStart);

    await insertAnalyticsEvent({
      event_type: EVENT_TYPES.CLEANUP_JOB_COMPLETED,
      event_data: {
        source,
        scheduled: source === 'scheduled_cron',
        duration_ms: durationMs,
        expired_waiting: eWaitingCount,
        deleted_sessions: dSessionsCount,
        expired_fresh: eFreshCount,
        extended_sessions: eSessionsCount
      }
    }).catch(() => null);

  } catch (err) {
    console.error('[CLEANUP] Error during cleanup:', err);
    const durationMs = Math.max(0, Date.now() - jobStart);
    try {
      await insertAnalyticsEvent({
        event_type: EVENT_TYPES.CLEANUP_JOB_ERROR,
        event_data: {
          source,
          scheduled: source === 'scheduled_cron',
          duration_ms: durationMs,
          message: err && err.message ? String(err.message).slice(0, 800) : String(err || '').slice(0, 800),
          stack: err && err.stack ? String(err.stack).slice(0, 2000) : null,
          code: err && err.code ? String(err.code) : null
        }
      });
    } catch (_) { /* swallow analytics failure */ }
  }
}

// Schedule: every minute so 5-minute rules do not drift by another full cron interval
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('* * * * *', () => cleanupSessions('scheduled_cron'));
}

module.exports = { cleanupSessions };
