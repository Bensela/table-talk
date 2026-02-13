const db = require('../db');

async function clearSessions() {
  try {
    console.log('Clearing all active sessions...');
    
    // Delete from dependent tables first (due to FK constraints)
    await db.query('DELETE FROM analytics_events');
    await db.query('DELETE FROM session_participants');
    await db.query('DELETE FROM deck_sessions');
    await db.query('DELETE FROM sessions');

    console.log('✅ All sessions cleared successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error clearing sessions:', err);
    process.exit(1);
  }
}

clearSessions();
