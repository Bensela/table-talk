const { Pool } = require('pg');
const path = require('path');
// Explicitly load .env from current directory if not found
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL;

// Determine if we should use SSL
// Localhost usually doesn't need SSL, remote (DigitalOcean) does.
const isLocal = connectionString && (
  connectionString.includes('localhost') || 
  connectionString.includes('127.0.0.1')
);

// If explicit DB_SSL is set, respect it
const useSSL = process.env.DB_SSL === 'true' || (!isLocal && process.env.NODE_ENV === 'production');

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

console.log(`🔌 DB Connection: ${useSSL ? 'Remote (SSL)' : 'Local (No SSL)'}`);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
