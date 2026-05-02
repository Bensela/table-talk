const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('🔍 NODE_ENV:', process.env.NODE_ENV);
console.log('🔍 DB_SSL:', process.env.DB_SSL);
console.log('🔍 DATABASE_URL defined:', !!process.env.DATABASE_URL);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined');
  process.exit(1);
}

// Parse individual connection params to avoid URL string manipulation issues
const parsed = new URL(DATABASE_URL);
const clientConfig = {
  host: parsed.hostname,
  port: parseInt(parsed.port) || 5432,
  user: parsed.username,
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace('/', ''),
  ssl: { rejectUnauthorized: false },
};

const init = async () => {
  console.log('🔄 Starting database migration...');
  console.log('🔌 Connecting to host:', clientConfig.host);

  const dbClient = new Client(clientConfig);

  try {
    await dbClient.connect();
    console.log('✅ Connected to database.');

    // 1. Run Base Init (Idempotent)
    console.log('📜 Running init.sql...');
    const initSql = fs.readFileSync(path.join(__dirname, '../database/init.sql'), 'utf8');
    await dbClient.query(initSql);

    // 2. Run Phase 1 Upgrade
    console.log('📜 Running 001_phase1_upgrade.sql...');
    const upgradeSql = fs.readFileSync(path.join(__dirname, '../database/migrations/001_phase1_upgrade.sql'), 'utf8');
    await dbClient.query(upgradeSql);

    // 3. Run Phase 1.2 Restrictions
    console.log('📜 Running 002_restrict_contexts.sql...');
    const restrictSql = fs.readFileSync(path.join(__dirname, '../database/migrations/002_restrict_contexts.sql'), 'utf8');
    await dbClient.query(restrictSql);

    // 4. Run Phase 2 Expansion
    console.log('📜 Running 003_enable_mature_context.sql...');
    const enableMatureSql = fs.readFileSync(path.join(__dirname, '../database/migrations/003_enable_mature_context.sql'), 'utf8');
    await dbClient.query(enableMatureSql);

    // 5. Run Phase 1.2 Upgrade
    console.log('📜 Running 004_v1_2_upgrade.sql...');
    const v12Sql = fs.readFileSync(path.join(__dirname, '../database/migrations/004_v1_2_upgrade.sql'), 'utf8');
    await dbClient.query(v12Sql);

    // 6. Run Dual Security Upgrade
    console.log('📜 Running 005_v1_3_dual_security.sql...');
    const dualSecSql = fs.readFileSync(path.join(__dirname, '../database/migrations/005_v1_3_dual_security.sql'), 'utf8');
    await dbClient.query(dualSecSql);

    // 7. Run Missing Hints Fix
    console.log('📜 Running 006_fix_missing_hints.sql...');
    const hintsSql = fs.readFileSync(path.join(__dirname, '../database/migrations/006_fix_missing_hints.sql'), 'utf8');
    await dbClient.query(hintsSql);

    // 8. Run Session Lifecycle Fields
    console.log('📜 Running 007_add_session_lifecycle_fields.sql...');
    const lifecycleSql = fs.readFileSync(path.join(__dirname, '../database/migrations/007_add_session_lifecycle_fields.sql'), 'utf8');
    await dbClient.query(lifecycleSql);

    console.log('✅ Schema upgraded.');

    // 9. Seed Questions (Idempotent)
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
