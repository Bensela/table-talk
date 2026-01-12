const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined in .env');
  process.exit(1);
}

const init = async () => {
  console.log('🔄 Starting database migration...');

  // Direct connection to the target database
  // In cloud environments like Render, we often don't have permissions to connect to 'postgres'
  // and the database is already created for us.
  
  const dbClient = new Client({ 
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await dbClient.connect();
    
    // Read init.sql
    console.log('📜 Running init.sql...');
    const initSql = fs.readFileSync(path.join(__dirname, '../database/init.sql'), 'utf8');
    await dbClient.query(initSql);
    console.log('✅ Schema initialized.');

    // Read questions.sql
    console.log('🌱 Seeding questions...');
    const seedSql = fs.readFileSync(path.join(__dirname, '../database/seeds/questions.sql'), 'utf8');
    
    // Check if questions already exist to avoid duplicates if re-running
    // We wrap this in try-catch in case table didn't exist before init.sql (though it ran above)
    const checkQuestions = await dbClient.query('SELECT COUNT(*) FROM questions');
    if (parseInt(checkQuestions.rows[0].count) === 0) {
       await dbClient.query(seedSql);
       console.log('✅ Seed data inserted.');
    } else {
       console.log('ℹ️ Questions table already populated. Skipping seed.');
    }

  } catch (err) {
    console.error('❌ Error initializing database:', err.message);
    process.exit(1);
  } finally {
    await dbClient.end();
  }

  console.log('🚀 Database setup complete!');
};

init();
