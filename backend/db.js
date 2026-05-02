const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL;

// Use URL API to safely strip sslmode without touching the password
const url = new URL(connectionString);
url.searchParams.delete('sslmode');
const cleanUrl = url.toString();

const isLocal = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1');
const useSSL = process.env.DB_SSL === 'true' || (!isLocal && process.env.NODE_ENV === 'production');

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

console.log(`🔌 DB Connection: ${useSSL ? 'Remote (SSL)' : 'Local (No SSL)'}`);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
