const db = require('../db');

const checkConstraint = async () => {
  try {
    const result = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'questions'::regclass;
    `);
    console.log(result.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

checkConstraint();
