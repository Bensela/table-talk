const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined');
  process.exit(1);
}

const isLocal = DATABASE_URL && (
  DATABASE_URL.includes('localhost') || 
  DATABASE_URL.includes('127.0.0.1')
);

const useSSL = process.env.DB_SSL === 'true' || (!isLocal && process.env.NODE_ENV === 'production');

const init = async () => {
  console.log('🔄 Starting database setup...');

  // Run Init SQL and Seeds
  const dbClient = new Client({ 
    connectionString: DATABASE_URL,
    ssl: useSSL ? { rejectUnauthorized: false } : false
  });
  try {
    await dbClient.connect();
    
    console.log('📜 Running init.sql...');
    const initSql = fs.readFileSync(path.join(__dirname, '../database/init.sql'), 'utf8');
    await dbClient.query(initSql);
    console.log('✅ Schema initialized.');

    console.log('🌱 Seeding questions...');
    const seedSql = fs.readFileSync(path.join(__dirname, '../database/seeds/questions.sql'), 'utf8');
    
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
