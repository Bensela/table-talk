const { Pool } = require('pg');
require('dotenv').config();

const isLocal = process.env.DATABASE_URL && (
  process.env.DATABASE_URL.includes('localhost') || 
  process.env.DATABASE_URL.includes('127.0.0.1') ||
  process.env.DB_SSL === 'false'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

console.log(`🔌 DB Connection: ${isLocal ? 'Local (No SSL)' : 'Remote (SSL)'}`);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
