const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined in .env');
  console.error('👉 Please create server/.env and add DATABASE_URL=postgresql://user:password@localhost:5432/tabletalk');
  process.exit(1);
}

// Extract connection details to connect to default 'postgres' db first
const url = new URL(DATABASE_URL);
const dbName = url.pathname.split('/')[1];
const postgresUrl = `${url.protocol}//${url.username}:${url.password}@${url.hostname}:${url.port}/postgres`;

const init = async () => {
  console.log('🔄 Starting database setup...');
  console.log(`📡 Connecting as user "${url.username}" to host "${url.hostname}"...`);

  // 1. Create Database if not exists
  const rootClient = new Client({ connectionString: postgresUrl });
  try {
    await rootClient.connect();
    const res = await rootClient.query(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
    if (res.rows.length === 0) {
      console.log(`✨ Creating database "${dbName}"...`);
      await rootClient.query(`CREATE DATABASE "${dbName}"`);
    } else {
      console.log(`✅ Database "${dbName}" already exists.`);
    }
  } catch (err) {
    if (err.code === '28P01') {
      console.error('\n❌ AUTHENTICATION FAILED');
      console.error(`👉 The password for user "${url.username}" is incorrect.`);
      console.error('👉 Please open "server/.env" and update DATABASE_URL with the correct password.');
      console.error('   Example: postgresql://postgres:YOUR_REAL_PASSWORD@localhost:5432/tabletalk\n');
    } else {
      console.error('❌ Error connecting to postgres database:', err.message);
    }
    process.exit(1);
  } finally {
    await rootClient.end();
  }

  // 2. Run Init SQL and Seeds
  const dbClient = new Client({ connectionString: DATABASE_URL });
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
