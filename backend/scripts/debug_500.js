const db = require('../db');
const crypto = require('crypto');

async function testAnalytics() {
  try {
    console.log('Testing DB Connection...');
    const res = await db.query('SELECT NOW()');
    console.log('DB Connected:', res.rows[0]);

    console.log('Checking analytics_events table...');
    const tableCheck = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'analytics_events';
    `);
    console.log('Columns:', tableCheck.rows.map(r => r.column_name));

    if (tableCheck.rows.length === 0) {
      console.error('CRITICAL: analytics_events table does not exist!');
      // Create it if missing (fallback)
      await db.query(`
        CREATE TABLE IF NOT EXISTS analytics_events (
          event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
          event_type VARCHAR(50) NOT NULL,
          event_data JSONB,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('Created analytics_events table.');
    }

    console.log('Testing Insert...');
    // Create a dummy session first to satisfy FK
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 3600000);
    
    // We need to insert into sessions first. 
    // Note: session_group_id is NOT NULL in v1.2, ensure we provide it.
    // Also deck seed might be required if logic depends on it, but table constraints are minimal usually.
    
    // Check sessions constraints
    const constraints = await db.query(`
        SELECT conname, pg_get_constraintdef(oid) 
        FROM pg_constraint 
        WHERE conrelid = 'sessions'::regclass;
    `);
    // console.log('Session Constraints:', constraints.rows);

    await db.query(`
      INSERT INTO sessions (session_id, table_token, session_group_id, expires_at)
      VALUES ($1, 'debug_table', $2, $3)
    `, [sessionId, crypto.randomUUID(), expiresAt]);
    console.log('Dummy session created.');

    await db.query(`
      INSERT INTO analytics_events (session_id, event_type, event_data)
      VALUES ($1, 'debug_event', $2)
    `, [sessionId, { foo: 'bar' }]);
    console.log('Analytics insert successful.');

    // Cleanup
    await db.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
    console.log('Cleanup successful.');

    process.exit(0);
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
}

testAnalytics();
