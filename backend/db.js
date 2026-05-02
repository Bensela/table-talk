const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL;

const isLocal = connectionString && (
  connectionString.includes('localhost') ||
  connectionString.includes('127.0.0.1')
);

const useSSL = process.env.DB_SSL === 'true' || (!isLocal && process.env.NODE_ENV === 'production');

// Parse individual params to avoid URL string manipulation issues
let poolConfig;
if (isLocal) {
  poolConfig = { connectionString, ssl: false };
} else {
  const parsed = new URL(connectionString);
  poolConfig = {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 5432,
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace('/', ''),
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  };
}

const pool = new Pool(poolConfig);

console.log(`🔌 DB Connection: ${useSSL ? 'Remote (SSL)' : 'Local (No SSL)'}`);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
