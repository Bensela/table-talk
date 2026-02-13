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

  const dbClient = new Client({ 
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await dbClient.connect();
    
    // 1. Run Base Init (Idempotent)
    console.log('📜 Running init.sql...');
    const initSql = fs.readFileSync(path.join(__dirname, '../database/init.sql'), 'utf8');
    await dbClient.query(initSql);
    
    // 2. Run Phase 1 Upgrade
    console.log('📜 Running 001_phase1_upgrade.sql...');
    const upgradeSql = fs.readFileSync(path.join(__dirname, '../database/migrations/001_phase1_upgrade.sql'), 'utf8');
    await dbClient.query(upgradeSql);
    
    // 3. Run Phase 1.2 Restrictions (Restrict Contexts)
    console.log('📜 Running 002_restrict_contexts.sql...');
    const restrictSql = fs.readFileSync(path.join(__dirname, '../database/migrations/002_restrict_contexts.sql'), 'utf8');
    await dbClient.query(restrictSql);

    // 4. Run Phase 2 Expansion (Enable Mature)
    console.log('📜 Running 003_enable_mature_context.sql...');
    const enableMatureSql = fs.readFileSync(path.join(__dirname, '../database/migrations/003_enable_mature_context.sql'), 'utf8');
    await dbClient.query(enableMatureSql);

    // 5. Run Phase 1.2 Upgrade (Session Groups & Participants)
    console.log('📜 Running 004_v1_2_upgrade.sql...');
    const v12Sql = fs.readFileSync(path.join(__dirname, '../database/migrations/004_v1_2_upgrade.sql'), 'utf8');
    await dbClient.query(v12Sql);

    console.log('✅ Schema upgraded.');

    // 3. Seed Questions (Idempotent-ish)
    console.log('🌱 Checking seed data...');
    const checkQuestions = await dbClient.query('SELECT COUNT(*) FROM questions');
    if (parseInt(checkQuestions.rows[0].count) === 0) {
       const seedSql = fs.readFileSync(path.join(__dirname, '../database/seeds/questions.sql'), 'utf8');
       await dbClient.query(seedSql);
       console.log('✅ Seed data inserted.');
    } else {
       console.log('ℹ️ Questions table already populated.');
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
