const path = require('path');
const dbPath = path.resolve(__dirname, '..', 'backend', 'db');
const db = require(dbPath);

(async () => {
  try {
    const q1 = await db.query(`
      SELECT session_id, restaurant_id, table_token, mode, context,
             COALESCE(last_activity_at, created_at) AS last_seen_at
      FROM sessions
      WHERE restaurant_id IS NOT NULL
      ORDER BY COALESCE(last_activity_at, created_at) DESC
      LIMIT 5
    `);
    console.log('\nSessions WITH restaurant_id:');
    console.table(q1.rows);

    const q2 = await db.query(`
      SELECT session_id, restaurant_id, table_token, mode, context,
             COALESCE(last_activity_at, created_at) AS last_seen_at
      FROM sessions
      WHERE restaurant_id IS NULL
      ORDER BY COALESCE(last_activity_at, created_at) DESC
      LIMIT 5
    `);
    console.log('\nSessions WITHOUT restaurant_id (NULL):');
    console.table(q2.rows);

    const q3 = await db.query(`
      SELECT event_type, session_id, restaurant_id, table_token, anonymous_id,
             timestamp, jsonb_pretty(event_data) AS evdata
      FROM analytics_events
      ORDER BY timestamp DESC
      LIMIT 8
    `);
    console.log('\nLast 8 analytics events:');
    console.table(q3.rows.map(r => ({ ...r, evdata: (r.evdata||'').slice(0,80) })));

    const q4 = await db.query(`
      SELECT r.id, r.name, r.slug, r.latitude, r.longitude
      FROM restaurants r
    `);
    console.log('\nRestaurants:');
    console.table(q4.rows);

    process.exit(0);
  } catch (e) {
    console.error(e); process.exit(1);
  }
})();
