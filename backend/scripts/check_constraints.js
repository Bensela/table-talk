const db = require('../db');

async function listConstraints() {
  try {
    const res = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'deck_sessions'::regclass;
    `);
    console.log('Constraints on deck_sessions:');
    res.rows.forEach(r => console.log(`- ${r.conname}: ${r.pg_get_constraintdef}`));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listConstraints();
