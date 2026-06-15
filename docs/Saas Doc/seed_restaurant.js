#!/usr/bin/env node
// backend/scripts/seed_restaurant.js
// Usage:
//   node backend/scripts/seed_restaurant.js \
//     --name="Casa Moreno" \
//     --slug="casa-moreno" \
//     --tables=12 \
//     --baseUrl="https://your-app.ondigitalocean.app"

'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db  = require('../db');
const crypto = require('crypto');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=')];
    })
);

const name       = args.name    || 'New Restaurant';
const slug       = (args.slug   || name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const tableCount = parseInt(args.tables  || '10', 10);
const baseUrl    = args.baseUrl || process.env.FRONTEND_URL || 'https://tabletalk.app';

(async () => {
  const secretKey = crypto.randomBytes(32).toString('hex');

  const result = await db.query(
    `INSERT INTO restaurants (slug, name, secret_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE
       SET name       = EXCLUDED.name,
           updated_at = NOW()
     RETURNING id, slug, name, secret_key`,
    [slug, name, secretKey]
  );

  const r = result.rows[0];

  console.log('\n✅  Restaurant created / updated');
  console.log('    id         :', r.id);
  console.log('    name       :', r.name);
  console.log('    slug       :', r.slug);
  console.log('    secret_key :', r.secret_key, '  ← store this securely\n');

  console.log('📱  QR code URLs (print these per table):');
  for (let i = 1; i <= tableCount; i++) {
    const t = `table-${String(i).padStart(3, '0')}`;
    console.log(`    ${baseUrl}/t/${r.slug}/${t}`);
  }

  console.log('\n🔑  Admin API usage:');
  const h = `X-Restaurant-Key: ${r.secret_key}`;
  console.log(`    GET  /restaurants/${r.slug}              -H "${h}"`);
  console.log(`    GET  /restaurants/${r.slug}/sessions     -H "${h}"`);
  console.log(`    GET  /restaurants/${r.slug}/analytics    -H "${h}"`);
  console.log(`    POST /restaurants/${r.slug}/qr           -H "${h}" \\`);
  console.log(`         -d '{"tables":["table-001","table-002"]}'`);
  console.log();

  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
