const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not defined');
  process.exit(1);
}

const isLocal =
  connectionString.includes('localhost') ||
  connectionString.includes('127.0.0.1');

const caCert = process.env.DB_CA_CERT
  ? process.env.DB_CA_CERT.replace(/\\n/g, '\n')
  : null;

const useSSL =
  process.env.DB_SSL === 'true' ||
  (!isLocal && process.env.NODE_ENV === 'production');

const sslConfig = useSSL
  ? caCert
    ? {
        ca: caCert,
        rejectUnauthorized: true
      }
    : {
        rejectUnauthorized: false
      }
  : false;

const pool = new Pool({
  connectionString,
  ssl: sslConfig
});

console.log(
  `DB Connection: ${useSSL ? 'Remote SSL' : 'Local No SSL'}${
    caCert ? ' with CA certificate' : ''
  }`
);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
