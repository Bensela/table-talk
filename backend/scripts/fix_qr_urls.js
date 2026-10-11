#!/usr/bin/env node
/* eslint-disable no-console */
// Correct restaurant_tables.qr_code_url values that point at the wrong host.
//
//   Dry run (default, read-only):
//     node scripts/fix_qr_urls.js --base-url https://your-app.ondigitalocean.app
//   Apply (writes a JSON backup first, then updates only qr_code_url):
//     node scripts/fix_qr_urls.js --base-url https://your-app.ondigitalocean.app --apply
//   Roll back a previous apply:
//     node scripts/fix_qr_urls.js --rollback qr_url_backup_<timestamp>.json
//
// Options:
//   --base-url <origin>   Correct Catalyst frontend origin (defaults to FRONTEND_URL)
//   --from-host a,b       Hosts to replace (default: tabletalk.app,www.tabletalk.app)
//   --restaurant <slug>   Limit to one restaurant
//   --backup-file <path>  Where to write the backup (default: ./qr_url_backup_<ts>.json)
//
// Safety: never deletes rows, only touches qr_code_url, skips rows whose
// restaurant/table identity does not match the stored URL, and every UPDATE
// is guarded by the previous value so concurrent edits are never overwritten.
// Uses DATABASE_URL (and DB_SSL settings) exactly like the server does.

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { planQrUrlCorrections } = require('../services/qrUrlRemediation');

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--from-host') args.fromHost = argv[++i];
    else if (a === '--restaurant') args.restaurant = argv[++i];
    else if (a === '--backup-file') args.backupFile = argv[++i];
    else if (a === '--rollback') args.rollback = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function describeTarget() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`; // never print credentials
  } catch {
    return '(unparsable DATABASE_URL)';
  }
}

async function fetchRows(restaurantSlug) {
  const params = [];
  let where = '';
  if (restaurantSlug) {
    params.push(restaurantSlug);
    where = 'WHERE r.slug = $1';
  }
  const res = await db.query(
    `SELECT rt.id, rt.restaurant_id, r.slug, rt.table_number, rt.qr_code_url
       FROM restaurant_tables rt
       JOIN restaurants r ON r.id = rt.restaurant_id
       ${where}
      ORDER BY r.slug, rt.table_number`,
    params
  );
  return res.rows;
}

async function runUpdates(items, { from, to }) {
  const client = await db.pool.connect();
  let changed = 0;
  let skippedConcurrent = 0;
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const r = await client.query(
        'UPDATE restaurant_tables SET qr_code_url = $3 WHERE id = $1 AND qr_code_url = $2',
        [item.id, item[from], item[to]]
      );
      if (r.rowCount === 1) changed += 1;
      else skippedConcurrent += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { changed, skippedConcurrent };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeTarget()}`);

  if (args.rollback) {
    const backup = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    const { changed, skippedConcurrent } = await runUpdates(backup.updates, { from: 'new_url', to: 'old_url' });
    console.log(`Rollback complete: restored ${changed}, left ${skippedConcurrent} (value no longer matched).`);
    return;
  }

  const baseUrl = args.baseUrl || process.env.FRONTEND_URL;
  if (!baseUrl) throw new Error('--base-url (or FRONTEND_URL) is required');
  const fromHosts = args.fromHost ? args.fromHost.split(',') : undefined;

  const rows = await fetchRows(args.restaurant);
  const plan = planQrUrlCorrections(rows, { baseUrl, fromHosts });

  const skipCounts = plan.skipped.reduce((acc, s) => {
    const key = s.host ? `${s.reason} (${s.host})` : s.reason;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(`Rows scanned: ${rows.length} | already correct: ${plan.unchanged} | to update: ${plan.updates.length} | skipped: ${plan.skipped.length}`);
  if (Object.keys(skipCounts).length) console.log('Skipped by reason:', skipCounts);
  for (const u of plan.updates.slice(0, 50)) {
    console.log(`  [${u.slug} / ${u.table_number}]\n    ${u.old_url}\n -> ${u.new_url}`);
  }
  if (plan.updates.length > 50) console.log(`  ...and ${plan.updates.length - 50} more`);

  if (!args.apply) {
    console.log('\nDRY RUN: no changes written. Re-run with --apply to update.');
    return;
  }
  if (plan.updates.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  const backupFile = path.resolve(args.backupFile || `qr_url_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ created_at: new Date().toISOString(), base_url: plan.baseOrigin, updates: plan.updates }, null, 2),
    { flag: 'wx' }
  );
  console.log(`Backup written: ${backupFile}`);

  const { changed, skippedConcurrent } = await runUpdates(plan.updates, { from: 'old_url', to: 'new_url' });
  console.log(`Applied: updated ${changed}, skipped ${skippedConcurrent} (value changed since scan).`);
  console.log(`To undo: node scripts/fix_qr_urls.js --rollback ${backupFile}`);
}

main()
  .then(() => db.pool.end())
  .catch(async (err) => {
    console.error('fix_qr_urls failed:', err.message);
    try { await db.pool.end(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
