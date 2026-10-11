// Pure planning logic for correcting stored restaurant_tables.qr_code_url
// values that point at the wrong host (e.g. the unrelated https://tabletalk.app
// default). No I/O here so every rule is unit-testable.
//
// Rules:
//  - Restaurant/table identity is taken from the DB row (slug + table_number)
//    and must match the identity encoded in the stored URL, otherwise the row
//    is skipped (never "fixed" into a different table).
//  - Only rows whose host is explicitly listed in fromHosts are rewritten.
//  - The rewritten URL uses the exact format the provisioner already writes:
//    <origin>/r/<slug>/t/<encodeURIComponent(table_number)>.
//  - Rows already holding the canonical URL are left alone, so re-running the
//    correction is a no-op (idempotent).

const QR_PATH = /^\/r\/([^/]+)\/t\/([^/?#]+)\/?$/i;

function normalizeBaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch {
    throw new Error('base URL must be an absolute URL, e.g. https://your-app.ondigitalocean.app');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('base URL must use https (or http for local testing)');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('base URL must be an origin only (no path, query or fragment)');
  }
  return parsed.origin;
}

function buildCanonicalQrUrl(baseOrigin, slug, tableNumber) {
  return `${baseOrigin}/r/${slug}/t/${encodeURIComponent(String(tableNumber).trim())}`;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function planQrUrlCorrections(rows, { baseUrl, fromHosts = ['tabletalk.app', 'www.tabletalk.app'] } = {}) {
  const baseOrigin = normalizeBaseUrl(baseUrl);
  const baseHost = new URL(baseOrigin).host.toLowerCase();
  const targetHosts = new Set(fromHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean));

  if (targetHosts.size === 0) {
    throw new Error('at least one source host is required');
  }
  if (targetHosts.has(baseHost)) {
    throw new Error('the base URL host must not be one of the hosts being replaced');
  }

  const updates = [];
  const skipped = [];
  let unchanged = 0;

  for (const row of rows) {
    const slug = String(row.slug || '').trim();
    const tableNumber = String(row.table_number ?? '').trim();
    const stored = row.qr_code_url;

    if (!stored) {
      skipped.push({ id: row.id, reason: 'no_stored_url' });
      continue;
    }

    let url;
    try {
      url = new URL(stored);
    } catch {
      skipped.push({ id: row.id, reason: 'unparsable_url' });
      continue;
    }

    const match = url.pathname.match(QR_PATH);
    if (!match) {
      skipped.push({ id: row.id, reason: 'unexpected_path' });
      continue;
    }

    if (safeDecode(match[1]) !== slug || safeDecode(match[2]) !== tableNumber) {
      skipped.push({ id: row.id, reason: 'identity_mismatch' });
      continue;
    }

    const canonical = buildCanonicalQrUrl(baseOrigin, slug, tableNumber);
    if (stored === canonical) {
      unchanged += 1;
      continue;
    }

    if (!targetHosts.has(url.host.toLowerCase())) {
      skipped.push({ id: row.id, reason: 'host_not_targeted', host: url.host.toLowerCase() });
      continue;
    }

    updates.push({
      id: row.id,
      restaurant_id: row.restaurant_id,
      slug,
      table_number: tableNumber,
      old_url: stored,
      new_url: canonical
    });
  }

  return { updates, skipped, unchanged, baseOrigin };
}

module.exports = { normalizeBaseUrl, buildCanonicalQrUrl, planQrUrlCorrections };
