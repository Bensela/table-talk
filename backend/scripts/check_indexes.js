const db = require('../db');

const checkIndexes = async () => {
  try {
    const result = await db.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'questions';
    `);
    console.log(result.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

checkIndexes();
