const crypto = require('crypto');
const db = require('../db');
const { signToken, applyLoginRateLimit, resetLoginRateLimit, TOKEN_TTL } = require('../middleware/authMiddleware');
const QRCode = require('qrcode');
const deckService = require('../services/deckService');
const billingService = require('../services/billingService');
const { geocodeAddress } = require('../services/geocodeService');
const { invalidateCachedRestaurantGeo } = require('../services/geofenceService');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://tabletalk.app').replace(/\/+$/, '');
const GLOBAL_RESTAURANT_ID = 'd0000000-0000-0000-0000-000000000000';
const INVITE_EXPIRY_DAYS = Number.parseInt(process.env.RESTAURANT_INVITE_EXPIRY_DAYS || '14', 10);
const TRIAL_DURATION_DAYS = Number.parseInt(process.env.RESTAURANT_TRIAL_DAYS || '14', 10);

/**
 * PBKDF2 Hashing function matching migration logic:
 * Salt: 'salt123', Key: 'superadmin123', Iterations: 1000, Length: 64, Digest: sha512
 */
function hashPassword(password, salt = 'salt123') {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}.1000.${hash}`;
}

/**
 * Verifies password against hash using stored salt/iterations.
 */
function verifyPassword(password, storedHash) {
  try {
    const [salt, iterationsStr, hash] = storedHash.split('.');
    const iterations = parseInt(iterationsStr, 10);
    const computedHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return computedHash === hash;
  } catch (err) {
    return false;
  }
}

function slugifyRestaurantName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMetricsRangeConfig(rangeKey, opts = {}) {
  const normalized = String(rangeKey || '24h').trim().toLowerCase();

  if (normalized === 'month' || normalized === 'this-month' || normalized === 'this_month') {
    const start = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      1, 0, 0, 0, 0
    ));
    const end = new Date();
    return {
      key: 'this_month',
      sqlInterval: null,
      seriesInterval: '1 day',
      bucketFormat: 'Mon DD',
      bucketTrunc: 'day',
      startAt: start,
      endAt: end,
      useExplicitBounds: true
    };
  }

  if (normalized === '7d') {
    return {
      key: '7d',
      sqlInterval: '7 days',
      seriesInterval: '1 day',
      bucketFormat: 'Mon DD',
      bucketTrunc: 'day'
    };
  }

  if (normalized === '30d') {
    return {
      key: '30d',
      sqlInterval: '30 days',
      seriesInterval: '1 day',
      bucketFormat: 'Mon DD',
      bucketTrunc: 'day'
    };
  }

  if (normalized === 'custom' && opts.startAt && opts.endAt) {
    const ms = Math.max(1, opts.endAt.getTime() - opts.startAt.getTime());
    const days = ms / (1000 * 60 * 60 * 24);
    const bucketTrunc = days <= 2 ? 'hour' : 'day';
    const bucketFormat = bucketTrunc === 'hour' ? 'HH24:00' : 'Mon DD';
    const seriesInterval = bucketTrunc === 'hour' ? '1 hour' : '1 day';
    return {
      key: 'custom',
      sqlInterval: null,
      seriesInterval,
      bucketFormat,
      bucketTrunc,
      startAt: opts.startAt,
      endAt: opts.endAt,
      useExplicitBounds: true
    };
  }

  return {
    key: '24h',
    sqlInterval: '24 hours',
    seriesInterval: '1 hour',
    bucketFormat: 'HH24:00',
    bucketTrunc: 'hour'
  };
}

/**
 * Build a WHERE clause fragment (and matching params) for analytics_events / sessions
 * window queries. Supports both:
 *   - preset ranges (NOW() - INTERVAL 'X')
 *   - explicit custom bounds (startAt <= ts < endAt, inclusive start, exclusive end)
 *
 * Returns: { whereSql (string without leading WHERE), params (array) }
 *
 * @param {object} range  Result of getMetricsRangeConfig()
 * @param {string} tsColumn  SQL column expression to compare against (e.g. "ae.timestamp")
 * @param {object} [opts]
 * @param {number} [opts.paramOffset]   Starting $N index (1-based) if chaining in a larger query
 */
function buildRangeWhere(range, tsColumn, opts = {}) {
  const params = [];
  const clauses = [];
  let idx = (opts.paramOffset || 0);
  const $ = () => `$${++idx}`;

  if (range.useExplicitBounds && range.startAt && range.endAt) {
    clauses.push(`${tsColumn} >= ${$()}::timestamptz`);
    params.push(range.startAt.toISOString());
    clauses.push(`${tsColumn} <  ${$()}::timestamptz`);
    params.push(range.endAt.toISOString());
  } else if (range.sqlInterval) {
    clauses.push(`${tsColumn} >= NOW() - INTERVAL '${range.sqlInterval}'`);
  }

  return {
    whereSql: clauses.length ? clauses.join(' AND ') : 'TRUE',
    params,
    nextParamIdx: idx
  };
}

/**
 * Convert a Date (or anything Date-parseable) to strict ISO8601 UTC with milliseconds:
 *   2026-08-29T20:18:14.123Z
 * Excel/Numbers/Sheets all parse this natively when CSV encoding is UTF-8 BOM.
 */
function toIsoUtc(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString();
}

/**
 * Escape a single CSV field to RFC-4180 + Excel compatibility:
 *  - null/undefined → empty string
 *  - strings containing comma, quote, CR, or LF → wrapped in double quotes
 *    with internal " doubled.
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') value = String(value);
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvLine(columns) {
  return columns.map(escapeCsvField).join(',') + '\r\n';
}

function buildInviteEmail(restaurantName, inviteEmail, inviteUrl) {
  const subject = 'Complete your Catalyst restaurant subscription';
  const bodyText = [
    `Hi ${restaurantName},`,
    '',
    'Your Catalyst restaurant subscription is ready to complete.',
    'Use the secure link below to finish the onboarding form and create your restaurant admin login:',
    '',
    inviteUrl,
    '',
    'If you are opening this on a mobile device, you can also scan the provided QR code.',
    '',
    'Thanks,',
    'Catalyst'
  ].join('\n');

  const mailtoUrl = `mailto:${encodeURIComponent(inviteEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;

  return {
    subject,
    bodyText,
    mailtoUrl
  };
}

function normalizeQuestionType(value) {
  if (!value) {
    return 'open-ended';
  }

  const normalized = String(value).trim().toLowerCase();
  if (['multiple-choice', 'multiple_choice', 'multiple choice', 'mcq'].includes(normalized)) {
    return 'multiple-choice';
  }
  if (['open-ended', 'open_ended', 'open ended', 'open'].includes(normalized)) {
    return 'open-ended';
  }

  throw new Error(`Unsupported question type: ${value}`);
}

function normalizeQuestionContext(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'exploring') return 'Exploring';
  if (normalized === 'established') return 'Established';
  if (normalized === 'mature') return 'Mature';

  throw new Error(`Unsupported question context: ${value}`);
}

function normalizeQuestionDifficulty(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['easy', 'medium', 'deep'].includes(normalized)) {
    return normalized;
  }

  throw new Error(`Unsupported question difficulty: ${value}`);
}

function parseBooleanField(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;

  return fallback;
}

function parseOptionsField(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Options JSON must be an array');
    }
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  }

  const items = raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : null;
}

function parseCsvText(csvText) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(current);
      if (row.some((cell) => String(cell).trim() !== '')) {
        rows.push(row);
      }
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => String(cell).trim() !== '')) {
    rows.push(row);
  }

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) =>
    String(header || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );

  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] !== undefined ? String(cells[index]).trim() : '';
    });
    return record;
  });
}

async function ensureUniqueRestaurantSlug(name, excludeRestaurantId = null) {
  const baseSlug = slugifyRestaurantName(name) || 'restaurant';
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const params = [candidate];
    let query = 'SELECT 1 FROM restaurants WHERE slug = $1';

    if (excludeRestaurantId) {
      query += ' AND id != $2';
      params.push(excludeRestaurantId);
    }

    const existing = await db.query(query, params);
    if (existing.rowCount === 0) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function resolveRestaurantLocation({ address, latitude, longitude, shouldGeocode }) {
  if (address !== undefined) {
    const trimmedAddress = typeof address === 'string' ? address.trim() : '';

    if (!trimmedAddress) {
      return {
        address: null,
        latitude: null,
        longitude: null
      };
    }

    const parsedLatitude = parseOptionalNumber(latitude);
    const parsedLongitude = parseOptionalNumber(longitude);

    if (parsedLatitude !== null && parsedLongitude !== null) {
      return {
        address: trimmedAddress,
        latitude: parsedLatitude,
        longitude: parsedLongitude
      };
    }

    if (shouldGeocode) {
      const geocoded = await geocodeAddress(trimmedAddress);
      return {
        address: trimmedAddress,
        latitude: geocoded?.latitude ?? null,
        longitude: geocoded?.longitude ?? null
      };
    }

    return {
      address: trimmedAddress,
      latitude: parsedLatitude,
      longitude: parsedLongitude
    };
  }

  if (latitude !== undefined || longitude !== undefined) {
    return {
      latitude: parseOptionalNumber(latitude),
      longitude: parseOptionalNumber(longitude)
    };
  }

  return null;
}

/**
 * POST /api/admin/login
 * Public admin login endpoint — rate-limited per-email and per-IP.
 * Always returns the same generic response on wrong email or wrong password
 * to prevent user enumeration.
 */
async function login(req, res) {
  const emailIn = typeof req.body?.email === 'string' ? req.body.email : '';
  const passwordIn = typeof req.body?.password === 'string' ? req.body.password : '';
  const email = emailIn.trim().toLowerCase();
  const password = passwordIn;

  // Rate limit check runs even for malformed requests to prevent probing.
  const clientIp = String(
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.headers['x-real-ip']?.toString() ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
  const limit = applyLoginRateLimit(email, clientIp);
  if (limit.blocked) {
    const retrySeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    res.setHeader('Retry-After', retrySeconds);
    return res.status(429).json({
      error: `Too many login attempts. Try again in ${retrySeconds} seconds.`,
      retry_after_seconds: retrySeconds
    });
  }

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Timing-safe response: use a fixed work budget so that a "user not found" vs
  // "wrong password" take about the same wall-clock time.
  let user = null;
  try {
    const userResult = await db.query(
      `SELECT u.*, r.name as restaurant_name, r.slug as restaurant_slug 
       FROM users u 
       LEFT JOIN restaurants r ON u.restaurant_id = r.id 
       WHERE u.email = $1`,
      [email]
    );
    if (userResult.rows.length > 0) {
      user = userResult.rows[0];
    }
  } catch (err) {
    console.error('Login lookup error:', err);
  }

  const candidateHash = user?.password_hash
    ? user.password_hash
    : 'salt123.1000.' + crypto.pbkdf2Sync('__invalid__', 'salt123', 1000, 64, 'sha512').toString('hex');
  const isCorrect = user ? verifyPassword(password, candidateHash) : verifyPassword('__invalid__', candidateHash);

  if (!user || !isCorrect) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Sign token with role-based TTL (8 hours for both SA/RA)
  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role,
    restaurant_id: user.restaurant_id
  });

  // Record last successful login + reset rate limit counters for this user/ip
  try {
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  } catch (_err) {
    // Non-fatal — login still succeeds even if we couldn't record timestamp
  }
  resetLoginRateLimit(email, clientIp);

  const tokenRole = String(user.role || 'DEFAULT').toUpperCase();
  const expiresInSeconds = TOKEN_TTL[tokenRole] || TOKEN_TTL.DEFAULT;

  res.json({
    token,
    expires_in_seconds: expiresInSeconds,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      restaurant_id: user.restaurant_id,
      restaurant_name: user.restaurant_name,
      restaurant_slug: user.restaurant_slug
    }
  });
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function requestPasswordReset(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const token = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  try {
    const updated = await db.query(
      `UPDATE users
       SET password_reset_token_hash = $1,
           password_reset_expires_at = $2,
           password_reset_requested_at = NOW(),
           password_reset_used_at = NULL
       WHERE LOWER(email) = LOWER($3)
       RETURNING id`,
      [tokenHash, expiresAt.toISOString(), email]
    );

    const response = {
      ok: true,
      message: 'If an account exists for this email, a password reset link has been generated.'
    };

    if (process.env.NODE_ENV !== 'production' && updated.rows.length > 0) {
      response.reset_token = token;
      response.reset_url = `${FRONTEND_URL}/admin/login?reset=${encodeURIComponent(token)}`;
      response.expires_at = expiresAt.toISOString();
    }

    res.json(response);
  } catch (err) {
    console.error('Password reset request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function validateResetToken(req, res) {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) {
    return res.status(400).json({ ok: false, error: 'Token is required' });
  }
  const tokenHash = hashPasswordResetToken(token);
  try {
    const userResult = await db.query(
      `SELECT id, password_reset_expires_at
       FROM users
       WHERE password_reset_token_hash = $1
         AND password_reset_used_at IS NULL
         AND password_reset_expires_at IS NOT NULL
       LIMIT 1`,
      [tokenHash]
    );
    if (!userResult.rows.length) {
      return res.status(400).json({ ok: false, error: 'Invalid or expired reset link' });
    }
    const row = userResult.rows[0];
    if (new Date(row.password_reset_expires_at).getTime() < Date.now()) {
      return res.status(410).json({ ok: false, error: 'This reset link has expired' });
    }
    const minutesLeft = Math.max(0, Math.round((new Date(row.password_reset_expires_at).getTime() - Date.now()) / 60000));
    return res.json({ ok: true, expires_at: row.password_reset_expires_at, minutes_left: minutesLeft });
  } catch (err) {
    console.error('Validate reset token error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}

async function geocodeRestaurantAddress(req, res) {
  const trimmedAddress = typeof req.body?.address === 'string' ? req.body.address.trim() : '';

  if (!trimmedAddress) {
    return res.status(400).json({ error: 'Address is required' });
  }

  try {
    const geocoded = await geocodeAddress(trimmedAddress);

    if (geocoded?.latitude == null || geocoded?.longitude == null) {
      return res.status(404).json({ error: 'Unable to locate that address' });
    }

    return res.json({
      address: trimmedAddress,
      latitude: geocoded.latitude,
      longitude: geocoded.longitude
    });
  } catch (err) {
    console.error('Geocode restaurant address error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function resetPassword(req, res) {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'token and new_password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const tokenHash = hashPasswordResetToken(token);

  try {
    const userResult = await db.query(
      `SELECT id
       FROM users
       WHERE password_reset_token_hash = $1
         AND password_reset_used_at IS NULL
         AND password_reset_expires_at IS NOT NULL
         AND password_reset_expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    if (!userResult.rows.length) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const userId = userResult.rows[0].id;
    const salt = crypto.randomBytes(16).toString('hex');
    const nextHash = hashPassword(newPassword, salt);

    await db.query(
      `UPDATE users
       SET password_hash = $1,
           password_reset_used_at = NOW(),
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL
       WHERE id = $2`,
      [nextHash, userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Defensive column guards so /admin/tenants never 500 before 014_billing_subscriptions.sql is applied.
let _tenantColumnsCache = null;
async function tenantColumns() {
  if (_tenantColumnsCache) return _tenantColumnsCache;
  try {
    const res = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'restaurants'`
    );
    const set = new Set(res.rows.map((r) => r.column_name));
    _tenantColumnsCache = set;
    return set;
  } catch (_) {
    _tenantColumnsCache = new Set();
    return _tenantColumnsCache;
  }
}
function tcol(set, name, fallback = 'NULL') {
  return set.has(name) ? `"${name}"` : fallback;
}

/**
 * GET /api/admin/tenants
 * Super Admin: List all tenants (restaurants) with billing details.
 */
async function getTenants(req, res) {
  try {
    const cols = await tenantColumns();
    const safeSelect = [
      'id',
      'name',
      'slug',
      `${tcol(cols, 'plan', "'starter'")} AS plan`,
      `${tcol(cols, 'billing_status', "'pending'")} AS billing_status`,
      `${tcol(cols, 'billing_provider', "'manual'")} AS billing_provider`,
      `${tcol(cols, 'trial_ends_at')} AS trial_ends_at`,
      `${tcol(cols, 'subscription_current_period_end')} AS subscription_current_period_end`,
      `${tcol(cols, 'subscription_cancel_at_period_end', 'FALSE')} AS subscription_cancel_at_period_end`,
      `${tcol(cols, 'contact_email')} AS contact_email`,
      `${tcol(cols, 'contact_phone')} AS contact_phone`,
      `${tcol(cols, 'address')} AS address`,
      `${tcol(cols, 'latitude')} AS latitude`,
      `${tcol(cols, 'longitude')} AS longitude`,
      `${tcol(cols, 'manager_name')} AS manager_name`,
      'created_at'
    ].join(', ');
    const result = await db.query(
      `SELECT ${safeSelect} FROM restaurants ORDER BY created_at DESC`
    );
    const rows = result.rows.map((row) => ({
      ...row,
      computed_status: deriveComputedBillingStatus(row)
    }));
    res.json(rows);
  } catch (err) {
    console.error('Get tenants error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function deriveComputedBillingStatus(row) {
  const status = row.billing_status;
  if (status === 'suspended') return 'suspended';
  const now = new Date();
  const plan = row.plan;
  if (row.trial_ends_at) {
    if (now < new Date(row.trial_ends_at)) return 'trialing';
    if (status === 'pending' || status === 'active') return 'past_due';
  }
  if (row.subscription_current_period_end && plan !== 'trial') {
    const endDate = new Date(row.subscription_current_period_end);
    if (now <= endDate) {
      if (row.subscription_cancel_at_period_end) return 'cancel_at_period_end';
      return 'active';
    }
    return 'past_due';
  }
  if (status === 'active') return 'active';
  if (status === 'pending') return plan === 'trial' ? 'trialing' : 'pending';
  return status || 'pending';
}

/**
 * POST /api/admin/tenants/invites
 * Super Admin: create a pending restaurant and onboarding invite.
 */
async function createTenantInvite(req, res) {
  const { name, email } = req.body;
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!trimmedName || !trimmedEmail) {
    return res.status(400).json({ error: 'Restaurant name and email are required' });
  }

  try {
    const activeInvite = await db.query(
      `SELECT 1
       FROM restaurant_invites
       WHERE LOWER(invite_email) = LOWER($1)
         AND consumed_at IS NULL
         AND expires_at > NOW()`,
      [trimmedEmail]
    );

    if (activeInvite.rowCount > 0) {
      return res.status(400).json({ error: 'An active onboarding invite already exists for this email' });
    }

    const existingUser = await db.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [trimmedEmail]);
    if (existingUser.rowCount > 0) {
      return res.status(400).json({ error: 'This email is already in use by an existing admin account' });
    }

    const slug = await ensureUniqueRestaurantSlug(trimmedName);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const trialStartsAt = new Date();
    const trialEndsAt = new Date(trialStartsAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await db.query('BEGIN');

    const restaurantResult = await db.query(
      `INSERT INTO restaurants (name, slug, billing_status, contact_email, plan, trial_ends_at)
       VALUES ($1, $2, 'pending', $3, 'trial', $4)
       RETURNING id, name, slug, billing_status, contact_email, plan, trial_ends_at, created_at`,
      [trimmedName, slug, trimmedEmail, trialEndsAt]
    );

    const restaurant = restaurantResult.rows[0];

    await db.query(
      `INSERT INTO restaurant_invites (restaurant_id, invite_email, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [restaurant.id, trimmedEmail, tokenHash, expiresAt, req.user?.id || null]
    );

    await db.query('COMMIT');

    const inviteUrl = `${FRONTEND_URL}/subscribe/${token}`;
    const emailPackage = buildInviteEmail(trimmedName, trimmedEmail, inviteUrl);
    const qrCodeDataUrl = await QRCode.toDataURL(inviteUrl, {
      width: 600,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.status(201).json({
      restaurant,
      invite: {
        email: trimmedEmail,
        url: inviteUrl,
        expires_at: expiresAt.toISOString(),
        email_subject: emailPackage.subject,
        email_body: emailPackage.bodyText,
        mailto_url: emailPackage.mailtoUrl,
        qr_code_data_url: qrCodeDataUrl
      }
    });
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // Ignore rollback failures when the transaction did not start.
    }
    console.error('Create tenant invite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/admin/tenants
 * Super Admin: Register a new tenant. Optionally creates a tenant admin user.
 */
async function createTenant(req, res) {
  const { name, slug, adminEmail, adminPassword, contactEmail, contactPhone, address, latitude, longitude, geofenceRadius, managerName } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'Name and slug are required' });
  }

  try {
    // Check if slug is taken
    const slugCheck = await db.query('SELECT 1 FROM restaurants WHERE slug = $1', [slug]);
    if (slugCheck.rowCount > 0) {
      return res.status(400).json({ error: 'Slug is already in use' });
    }

    const location = await resolveRestaurantLocation({
      address,
      latitude,
      longitude,
      shouldGeocode: Boolean(address) && (latitude === undefined || latitude === null || latitude === '') && (longitude === undefined || longitude === null || longitude === '')
    });

    let radiusInt = 100;
    if (geofenceRadius != null && Number.isFinite(Number(geofenceRadius))) {
      radiusInt = Math.max(5, Math.min(5000, Math.floor(Number(geofenceRadius))));
    }

    const trialStartsAt = new Date();
    const trialEndsAt = new Date(trialStartsAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await db.query('BEGIN');

    const restResult = await db.query(
      `INSERT INTO restaurants (name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, geofence_radius_meters, manager_name, plan, trial_ends_at)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, 'trial', $10)
       RETURNING id, name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, geofence_radius_meters, manager_name, plan, trial_ends_at, created_at`,
      [
        name,
        slug,
        contactEmail || null,
        contactPhone || null,
        location?.address ?? (address || null),
        location?.latitude ?? parseOptionalNumber(latitude),
        location?.longitude ?? parseOptionalNumber(longitude),
        radiusInt,
        managerName || null,
        trialEndsAt
      ]
    );

    const restaurant = restResult.rows[0];

    // Optionally create tenant admin
    if (adminEmail && adminPassword) {
      const emailCheck = await db.query('SELECT 1 FROM users WHERE email = $1', [adminEmail]);
      if (emailCheck.rowCount > 0) {
        await db.query('ROLLBACK');
        return res.status(400).json({ error: 'Admin email is already in use' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passHash = hashPassword(adminPassword, salt);

      await db.query(
        `INSERT INTO users (email, password_hash, role, restaurant_id) 
         VALUES ($1, $2, 'RESTAURANT_ADMIN', $3)`,
        [adminEmail, passHash, restaurant.id]
      );
    }

    await db.query('COMMIT');
    res.status(201).json(restaurant);
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // Ignore rollback failures when the transaction did not start.
    }
    console.error('Create tenant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /api/admin/tenants/:id
 * Super Admin: Update billing status or details.
 */
async function updateTenant(req, res) {
  const { id } = req.params;
  const { name, slug, billing_status, contactEmail, contactPhone, address, latitude, longitude, geofenceRadius, managerName } = req.body;

  try {
    const fields = [];
    const params = [id];
    let index = 2;

    const location = await resolveRestaurantLocation({
      address,
      latitude,
      longitude,
      shouldGeocode:
        address !== undefined &&
        (latitude === undefined || latitude === null || latitude === '') &&
        (longitude === undefined || longitude === null || longitude === '')
    });

    if (name !== undefined) {
      fields.push(`name = $${index++}`);
      params.push(name);
    }
    if (slug !== undefined) {
      const slugCheck = await db.query('SELECT 1 FROM restaurants WHERE slug = $1 AND id != $2', [slug, id]);
      if (slugCheck.rowCount > 0) {
        return res.status(400).json({ error: 'Slug is already in use' });
      }
      fields.push(`slug = $${index++}`);
      params.push(slug);
    }
    if (billing_status !== undefined) {
      if (!['active', 'suspended', 'pending'].includes(billing_status)) {
        return res.status(400).json({ error: 'Invalid billing status' });
      }
      fields.push(`billing_status = $${index++}`);
      params.push(billing_status);
    }
    if (contactEmail !== undefined) {
      fields.push(`contact_email = $${index++}`);
      params.push(contactEmail || null);
    }
    if (contactPhone !== undefined) {
      fields.push(`contact_phone = $${index++}`);
      params.push(contactPhone || null);
    }
    if (address !== undefined) {
      fields.push(`address = $${index++}`);
      params.push(location?.address ?? null);
    }
    if (latitude !== undefined || (address !== undefined && location && 'latitude' in location)) {
      fields.push(`latitude = $${index++}`);
      const rawLat = location?.latitude ?? null;
      const clampedLat = rawLat == null ? null : Math.min(Math.max(Number(rawLat), -90), 90);
      params.push(clampedLat);
    }
    if (longitude !== undefined || (address !== undefined && location && 'longitude' in location)) {
      fields.push(`longitude = $${index++}`);
      const rawLng = location?.longitude ?? null;
      const clampedLng = rawLng == null ? null : Math.min(Math.max(Number(rawLng), -180), 180);
      params.push(clampedLng);
    }
    if (geofenceRadius !== undefined) {
      // 50m is the reliable GPS minimum for consumer phones; anything
      // smaller produces false blocks even inside the restaurant.
      let radiusInt = 100;
      if (geofenceRadius != null && Number.isFinite(Number(geofenceRadius))) {
        radiusInt = Math.max(50, Math.min(5000, Math.floor(Number(geofenceRadius))));
      }
      fields.push(`geofence_radius_meters = $${index++}`);
      params.push(radiusInt);
    }
    if (managerName !== undefined) {
      fields.push(`manager_name = $${index++}`);
      params.push(managerName || null);
    }

    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // If slug is being changed, load the existing row so we can invalidate the
    // old slug *and* the new slug from the geofence soft-TTL cache below.
    let priorRow = null;
    if (slug !== undefined) {
      const prior = await db.query('SELECT slug FROM restaurants WHERE id = $1 LIMIT 1', [id]);
      priorRow = prior.rows[0] || null;
    }

    const result = await db.query(
      `UPDATE restaurants
       SET ${fields.join(', ')}
       WHERE id = $1
       RETURNING id, name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, geofence_radius_meters, manager_name, created_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const updated = result.rows[0];
    // Evict cache keys that could be holding stale lat/lng/radius/slug data.
    // Always evict current slug; when slug changes, also evict the prior slug
    // (otherwise re-lookups with the old URL path would return stale info).
    invalidateCachedRestaurantGeo(updated.slug);
    if (priorRow && priorRow.slug && priorRow.slug !== updated.slug) {
      invalidateCachedRestaurantGeo(priorRow.slug);
    }

    res.json(updated);
  } catch (err) {
    console.error('Update tenant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/admin/tenants/:id
 * Super Admin: Permanently delete a restaurant and related data (including its admins).
 */
async function deleteTenantPermanent(req, res) {
  const { id } = req.params;

  try {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const restaurantResult = await client.query(
        `SELECT id, slug, name
         FROM restaurants
         WHERE id = $1`,
        [id]
      );

      if (!restaurantResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const restaurant = restaurantResult.rows[0];

      if (restaurant.slug === 'default' || restaurant.id === GLOBAL_RESTAURANT_ID) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'The default restaurant cannot be deleted' });
      }

      const dualGroupsBySession = await client.query(
        `DELETE FROM dual_groups
         WHERE active_session_id IN (
           SELECT session_id FROM sessions WHERE restaurant_id = $1
         )`,
        [restaurant.id]
      );

      const dualGroupsBySlug = await client.query(
        `DELETE FROM dual_groups
         WHERE restaurant_id = $1`,
        [restaurant.slug]
      );

      const deckSessionsResult = await client.query(
        `DELETE FROM deck_sessions
         WHERE restaurant_id = $1`,
        [restaurant.slug]
      );

      const sessionsResult = await client.query(
        `DELETE FROM sessions
         WHERE restaurant_id = $1`,
        [restaurant.id]
      );

      const questionsResult = await client.query(
        `DELETE FROM questions
         WHERE restaurant_id = $1`,
        [restaurant.id]
      );

      const usersResult = await client.query(
        `DELETE FROM users
         WHERE restaurant_id = $1`,
        [restaurant.id]
      );

      const restaurantsResult = await client.query(
        `DELETE FROM restaurants
         WHERE id = $1`,
        [restaurant.id]
      );

      await client.query('COMMIT');

      res.json({
        deleted: {
          restaurants: restaurantsResult.rowCount,
          users: usersResult.rowCount,
          sessions: sessionsResult.rowCount,
          questions: questionsResult.rowCount,
          deck_sessions: deckSessionsResult.rowCount,
          dual_groups: dualGroupsBySession.rowCount + dualGroupsBySlug.rowCount
        },
        restaurant: {
          id: restaurant.id,
          slug: restaurant.slug,
          name: restaurant.name
        }
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Delete tenant permanent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/admin/metrics/overview
 * Super Admin: overview metrics, live usage, and recent activity.
 */
async function getSuperAdminMetrics(req, res) {
  try {
    // Resolve start/end dates. Accept ISO strings from query, or pass through
    // to getMetricsRangeConfig for custom range handling.
    const rawStart = (req.query.start_at && String(req.query.start_at).trim()) || null;
    const rawEnd = (req.query.end_at && String(req.query.end_at).trim()) || null;
    const opts = {};
    if (rawStart) {
      const s = new Date(rawStart);
      if (!Number.isNaN(s.getTime())) opts.startAt = s;
    }
    if (rawEnd) {
      const e = new Date(rawEnd);
      if (!Number.isNaN(e.getTime())) opts.endAt = e;
    }
    const range = getMetricsRangeConfig(req.query.range, opts);
    const bucketTrunc = range.bucketTrunc;
    const bucketFormat = range.bucketFormat;
    const sqlInterval = range.sqlInterval;
    const seriesInterval = range.seriesInterval;
    const aeRange = buildRangeWhere(range, 'ae.timestamp', { paramOffset: 0 });
    const sRange = buildRangeWhere(range, 's.created_at', { paramOffset: aeRange.nextParamIdx });
    const globalExcludeAe = `COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $${aeRange.nextParamIdx + 1}`;
    const globalExcludeS = `s.restaurant_id <> $${sRange.nextParamIdx + 1}`;
    const aeParams = [...aeRange.params, GLOBAL_RESTAURANT_ID];
    const sParams = [...sRange.params, GLOBAL_RESTAURANT_ID];
    const aeWhere = `${aeRange.whereSql} AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL) AND ${globalExcludeAe}`;
    const sWhere = `${sRange.whereSql} AND ${globalExcludeS}`;

    const [restaurantSummaryResult, questionSummaryResult, overviewResult, liveRestaurantsResult, contextMixResult, timelineResult, recentActivityResult] = await Promise.all([
      db.query(
        `SELECT
            COUNT(*) FILTER (WHERE slug <> 'default') AS total_restaurants,
            COUNT(*) FILTER (WHERE slug <> 'default' AND billing_status = 'active') AS active_restaurants,
            COUNT(*) FILTER (WHERE slug <> 'default' AND billing_status = 'pending') AS pending_restaurants,
            COUNT(*) FILTER (WHERE slug <> 'default' AND billing_status = 'suspended') AS suspended_restaurants
         FROM restaurants`
      ),
      db.query(
        `SELECT COUNT(*) AS total_questions
         FROM questions
         WHERE restaurant_id IS NULL OR restaurant_id = $1`,
        [GLOBAL_RESTAURANT_ID]
      ),
      db.query(
        `WITH live_sessions AS (
           SELECT session_id, restaurant_id, table_token, mode, context, COALESCE(last_activity_at, created_at) AS last_seen_at
           FROM sessions
           WHERE restaurant_id <> $1
             AND expires_at > NOW()
             AND COALESCE(dual_status, '') <> 'ended'
         ),
         recent_restaurant_activity AS (
           -- Primary truth: denormalized analytics_events rows from the last 24 hours
           SELECT
             COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) AS restaurant_id,
             MAX(ae.timestamp) AS last_activity_at,
             COUNT(DISTINCT ae.session_id) FILTER (WHERE ae.event_type = 'session_created') AS active_sessions,
             COUNT(DISTINCT COALESCE(ae.table_token, ae.event_data->>'table_token')) FILTER (WHERE ae.event_type IN ('qr_scan_validated','session_created','question_viewed')) AS active_tables,
             COUNT(*) FILTER (WHERE ae.event_type = 'question_viewed') AS engagement_signals,
             MAX(CASE WHEN ae.timestamp >= NOW() - INTERVAL '5 minutes' THEN 1 ELSE 0 END) AS is_realtime
           FROM analytics_events ae
           WHERE ae.timestamp >= NOW() - INTERVAL '24 hours'
             AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL)
             AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $1
           GROUP BY 1
         )
         SELECT
           COALESCE(rra.restaurant_id, ls.restaurant_id) AS restaurant_id,
           MAX(CASE WHEN ls.mode = 'dual-phone' THEN 1 ELSE 0 END) AS has_dual,
           COUNT(DISTINCT ls.session_id)::int AS active_sessions_now,
           COUNT(DISTINCT ls.table_token)::int AS active_tables_now,
           COALESCE(MAX(rra.active_sessions), 0)::int AS sessions_24h,
           COALESCE(MAX(rra.active_tables), 0)::int AS tables_24h,
           COALESCE(MAX(rra.engagement_signals), 0)::int AS engagement_signals_24h,
           COALESCE(
             MAX(rra.is_realtime) = 1,
             BOOL_OR(COALESCE(ls.last_seen_at, '-infinity'::timestamptz) >= NOW() - INTERVAL '5 minutes')
           )::boolean AS live_now_flag
         FROM recent_restaurant_activity rra
         FULL OUTER JOIN live_sessions ls ON ls.restaurant_id = rra.restaurant_id
         WHERE COALESCE(rra.restaurant_id, ls.restaurant_id) IS NOT NULL
         GROUP BY 1
        `,
        [GLOBAL_RESTAURANT_ID]
      ),
      db.query(
        `WITH live_sessions AS (
           SELECT restaurant_id, table_token, COALESCE(last_activity_at, created_at) AS last_seen_at
           FROM sessions
           WHERE restaurant_id <> $1
             AND expires_at > NOW()
             AND COALESCE(dual_status, '') <> 'ended'
             AND COALESCE(last_activity_at, created_at) >= NOW() - INTERVAL '24 hours'
         ),
         recent_restaurant_activity AS (
           SELECT
             COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) AS restaurant_id,
             MAX(ae.timestamp) AS last_activity_at,
             COUNT(DISTINCT ae.session_id) FILTER (WHERE ae.event_type = 'session_created') AS active_sessions,
             COUNT(DISTINCT COALESCE(ae.table_token, ae.event_data->>'table_token')) FILTER (WHERE ae.event_type IN ('qr_scan_validated','session_created','question_viewed')) AS active_tables,
             COUNT(*) FILTER (WHERE ae.event_type = 'question_viewed') AS engagement_signals,
             MAX(CASE WHEN ae.timestamp >= NOW() - INTERVAL '5 minutes' THEN 1 ELSE 0 END) AS is_realtime
           FROM analytics_events ae
           WHERE ae.timestamp >= NOW() - INTERVAL '24 hours'
             AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL)
             AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $1
           GROUP BY 1
         )
         SELECT
           r.id,
           r.name,
           r.slug,
           r.address,
           r.latitude,
           r.longitude,
           r.geofence_radius_meters,
           GREATEST(
             rra.last_activity_at,
             (SELECT MAX(ls2.last_seen_at) FROM live_sessions ls2 WHERE ls2.restaurant_id = r.id)
           ) AS last_activity_at,
           -- Active sessions NOW (strict in-memory 5m hot sessions)
           COALESCE((SELECT COUNT(*) FROM live_sessions WHERE restaurant_id = r.id AND last_seen_at >= NOW() - INTERVAL '5 minutes'), 0) AS active_sessions,
           COALESCE((SELECT COUNT(DISTINCT table_token) FROM live_sessions WHERE restaurant_id = r.id AND last_seen_at >= NOW() - INTERVAL '5 minutes'), 0) AS active_tables,
           -- Cumulative 24h numbers: primary numbers on card
           COALESCE(rra.active_sessions, 0)::int AS sessions_24h,
           COALESCE(rra.active_tables, 0)::int AS tables_24h,
           COALESCE(rra.engagement_signals, 0)::int AS engagement_signals_24h,
           -- Flags used by frontend to tint card
           CASE WHEN COALESCE(rra.is_realtime, 0) = 1 THEN true ELSE false END AS live_now
         FROM recent_restaurant_activity rra
         JOIN restaurants r ON r.id = rra.restaurant_id
         UNION
         SELECT
           r.id,
           r.name,
           r.slug,
           r.address,
           r.latitude,
           r.longitude,
           r.geofence_radius_meters,
           MAX(ls.last_seen_at) AS last_activity_at,
           COUNT(*) FILTER (WHERE ls.last_seen_at >= NOW() - INTERVAL '5 minutes') AS active_sessions,
           COUNT(DISTINCT ls.table_token) FILTER (WHERE ls.last_seen_at >= NOW() - INTERVAL '5 minutes') AS active_tables,
           0 AS sessions_24h,
           0 AS tables_24h,
           0 AS engagement_signals_24h,
           BOOL_OR(ls.last_seen_at >= NOW() - INTERVAL '5 minutes') AS live_now
         FROM live_sessions ls
         JOIN restaurants r ON r.id = ls.restaurant_id
         WHERE NOT EXISTS (
           SELECT 1 FROM recent_restaurant_activity rra WHERE rra.restaurant_id = ls.restaurant_id
         )
         GROUP BY r.id, r.name, r.slug, r.address, r.latitude, r.longitude, r.geofence_radius_meters
         ORDER BY live_now DESC, last_activity_at DESC, active_sessions DESC
         LIMIT 12`,
        [GLOBAL_RESTAURANT_ID]
      ),
      db.query(
        `SELECT COALESCE(context, 'Unknown') AS label, COUNT(*) AS count
         FROM sessions s
         WHERE ${sWhere}
         GROUP BY COALESCE(context, 'Unknown')
         ORDER BY COUNT(*) DESC`,
        sParams
      ),
      db.query(
        `WITH hours AS (
           SELECT generate_series(
             ${range.useExplicitBounds
               ? `date_trunc('${bucketTrunc}', $1::timestamptz)`
               : `date_trunc('${bucketTrunc}', NOW()) - INTERVAL '${sqlInterval}' + INTERVAL '${seriesInterval}'`
             },
             ${range.useExplicitBounds
               ? `date_trunc('${bucketTrunc}', $2::timestamptz) - INTERVAL '1 microsecond'`
               : `date_trunc('${bucketTrunc}', NOW())`
             },
             INTERVAL '${seriesInterval}'
           ) AS hour_bucket
         )
         SELECT
           to_char(hours.hour_bucket, '${bucketFormat}') AS hour_label,
           COALESCE(SUM(CASE WHEN ae.event_type = 'qr_scan_validated' THEN 1 ELSE 0 END), 0) AS qr_scans,
           COALESCE(SUM(CASE WHEN ae.event_type = 'session_created' THEN 1 ELSE 0 END), 0) AS sessions_started,
           COALESCE(SUM(CASE WHEN ae.event_type = 'question_viewed' THEN 1 ELSE 0 END), 0) AS question_views
         FROM hours
         LEFT JOIN analytics_events ae
           ON date_trunc('${bucketTrunc}', ae.timestamp) = hours.hour_bucket
          AND (
            ${range.useExplicitBounds
              ? `ae.timestamp >= $3::timestamptz AND ae.timestamp < $4::timestamptz`
              : `ae.timestamp >= NOW() - INTERVAL '${sqlInterval}'`
            }
          )
         GROUP BY hours.hour_bucket
         ORDER BY hours.hour_bucket`,
        range.useExplicitBounds
          ? [range.startAt.toISOString(), range.endAt.toISOString(), range.startAt.toISOString(), range.endAt.toISOString()]
          : []
      ),
      db.query(
        `SELECT
           ae.event_type,
           ae.timestamp,
           ae.event_data,
           ae.session_id,
           ae.participant_id,
           ae.restaurant_id AS ae_restaurant_id,
           ae.table_token AS ae_table_token,
           ae.anonymous_id,
           COALESCE(
             r.name,
             ae.event_data->>'restaurant_name',
             r_default.name,
             NULLIF(ae.event_data->>'restaurant_slug', '')
           ) AS restaurant_name,
           COALESCE(
             r.slug,
             ae.event_data->>'restaurant_slug',
             r_default.slug
           ) AS restaurant_slug,
           COALESCE(
             s.table_token,
             ae.table_token,
             ae.event_data->>'table_token',
             ae.event_data->>'table_number'
           ) AS table_token
         FROM analytics_events ae
         LEFT JOIN sessions s ON s.session_id = ae.session_id
         LEFT JOIN restaurants r ON r.id IN (ae.restaurant_id, s.restaurant_id, (ae.event_data->>'restaurant_id')::uuid)
         LEFT JOIN restaurants r_default ON r_default.id IN (s.restaurant_id, ae.restaurant_id)
         WHERE ${aeWhere}
           AND ae.event_type IN (
             'qr_scan_validated', 'qr_scan_rejected', 'qr_scan_invalid',
             'geofence_check_denied', 'welcome_geofence_denied',
             'welcome_geolocation_request', 'welcome_screen_rendered',
             'context_selected', 'mode_selected',
             'session_created', 'session_resumed', 'session_reconnect',
             'session_end',
             'session_paired', 'dual_partner_joined', 'dual_pairing_failed', 'dual_full_rejected',
             'dual_pairing_requested', 'waiting_partner_ended', 'partner_reconnected', 'partner_disconnected',
             'socket_joined_session',
             'context_changed', 'mode_changed', 'menu_opened', 'menu_closed',
             'menu_reset_context_requested', 'menu_reset_mode_requested',
             'menu_start_fresh_pressed', 'menu_start_fresh_outcome',
             'start_fresh', 'session_destroyed',
             'question_viewed', 'question_shown', 'question_dwell_complete',
             'question_revealed', 'question_locked',
             'question_advanced', 'question_advance',
             'hint_revealed', 'mcq_answer_submitted'
           )
         ORDER BY ae.timestamp DESC
         LIMIT 20`,
        aeParams
      )
    ]);

    const restaurantSummary = restaurantSummaryResult.rows[0];
    const overviewRows = overviewResult.rows || [];

    const overview = {
      active_sessions_now: overviewRows.reduce((sum, row) => sum + Number(row.active_sessions_now || 0), 0),
      active_tables_now: overviewRows.reduce((sum, row) => sum + Number(row.active_tables_now || 0), 0),
      live_restaurants_now: overviewRows.filter((row) => Boolean(row.live_now_flag)).length,
      active_restaurants_24h: overviewRows.length,
      dual_sessions_now: overviewRows.reduce((sum, row) => sum + Number(row.has_dual || 0), 0),
      sessions_24h: overviewRows.reduce((sum, row) => sum + Number(row.sessions_24h || 0), 0),
      tables_24h: overviewRows.reduce((sum, row) => sum + Number(row.tables_24h || 0), 0),
      engagement_24h: overviewRows.reduce((sum, row) => sum + Number(row.engagement_signals_24h || 0), 0)
    };

    // Compute windowed overview numbers: qr_scans, question_views, created sessions in chosen interval
    //
    // CRITICAL: We rebuild all three WHERE clauses with SEQUENTIAL paramOffsets because
    // this single db.query() call contains 3 inlined subqueries. The earlier sWhere / aeWhere
    // were numbered for SEPARATE parallel Promise.all queries (each starting at $1) and
    // would COLLIDE when inlined into the same SQL statement (all three referencing $1,
    // causing PostgreSQL 08P01 "bind provides N params but prepared requires 1").
    //   Placeholder layout:
    //     Subquery 1 (sessions_window):     $1 .. $#sParams
    //     Subquery 2 (qr_scans_window):     $#sParams+1  .. $#sParams+#aeQrParams
    //     Subquery 3 (question_views):      $#sParams+#aeQrParams+1  ..  $end
    let windowOverview = {};
    {
      const iq_sRange = buildRangeWhere(range, 's.created_at', { paramOffset: 0 });
      const iq_sGlobalIdx = iq_sRange.nextParamIdx + 1;
      const iq_sWhere = `${iq_sRange.whereSql} AND s.restaurant_id <> $${iq_sGlobalIdx}`;
      const iq_sParams = [...iq_sRange.params, GLOBAL_RESTAURANT_ID];

      const iq_aeQrRange = buildRangeWhere(range, 'ae.timestamp', { paramOffset: iq_sParams.length });
      const iq_aeQrGlobalIdx = iq_aeQrRange.nextParamIdx + 1;
      const iq_aeQrWhere = `${iq_aeQrRange.whereSql} AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL) AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $${iq_aeQrGlobalIdx}`;
      const iq_aeQrParams = [...iq_aeQrRange.params, GLOBAL_RESTAURANT_ID];

      const iq_aeQvRange = buildRangeWhere(range, 'ae.timestamp', { paramOffset: iq_sParams.length + iq_aeQrParams.length });
      const iq_aeQvGlobalIdx = iq_aeQvRange.nextParamIdx + 1;
      const iq_aeQvWhere = `${iq_aeQvRange.whereSql} AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL) AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $${iq_aeQvGlobalIdx}`;
      const iq_aeQvParams = [...iq_aeQvRange.params, GLOBAL_RESTAURANT_ID];

      const intervalQuery = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM sessions s WHERE ${iq_sWhere}) AS sessions_window,
           (SELECT COUNT(*) FROM analytics_events ae WHERE event_type = 'qr_scan_validated' AND ${iq_aeQrWhere}) AS qr_scans_window,
           (SELECT COUNT(*) FROM analytics_events ae WHERE event_type = 'question_viewed' AND ${iq_aeQvWhere}) AS question_views_window`,
        [...iq_sParams, ...iq_aeQrParams, ...iq_aeQvParams]
      );
      windowOverview = intervalQuery.rows?.[0] || {};
    }

    res.json({
      generated_at: new Date().toISOString(),
      range: range.key,
      range_start_at: range.useExplicitBounds && range.startAt ? toIsoUtc(range.startAt) : null,
      range_end_at: range.useExplicitBounds && range.endAt ? toIsoUtc(range.endAt) : null,
      overview: {
        total_restaurants: Number(restaurantSummary.total_restaurants || 0),
        active_restaurants: Number(restaurantSummary.active_restaurants || 0),
        pending_restaurants: Number(restaurantSummary.pending_restaurants || 0),
        suspended_restaurants: Number(restaurantSummary.suspended_restaurants || 0),
        total_questions: Number(questionSummaryResult.rows[0]?.total_questions || 0),
        active_sessions_now: Number(overview.active_sessions_now || 0),
        active_tables_now: Number(overview.active_tables_now || 0),
        live_restaurants_now: Number(overview.live_restaurants_now || 0),
        active_restaurants_24h: Number(overview.active_restaurants_24h || 0),
        dual_sessions_now: Number(overview.dual_sessions_now || 0),
        sessions_window: Number(windowOverview.sessions_window || 0),
        qr_scans_window: Number(windowOverview.qr_scans_window || 0),
        question_views_window: Number(windowOverview.question_views_window || 0)
      },
      live_restaurants: liveRestaurantsResult.rows.map((row) => ({
        ...row,
        active_sessions: Number(row.active_sessions || 0),
        active_tables: Number(row.active_tables || 0),
        sessions_24h: Number(row.sessions_24h || 0),
        tables_24h: Number(row.tables_24h || 0),
        engagement_signals_24h: Number(row.engagement_signals_24h || 0),
        live_now: Boolean(row.live_now)
      })),
      context_mix: contextMixResult.rows.map((row) => ({
        label: row.label,
        count: Number(row.count || 0)
      })),
      activity_timeline: timelineResult.rows.map((row) => ({
        hour_label: row.hour_label,
        qr_scans: Number(row.qr_scans || 0),
        sessions_started: Number(row.sessions_started || 0),
        question_views: Number(row.question_views || 0)
      })),
      recent_activity: recentActivityResult.rows
    });
  } catch (err) {
    console.error('Get super admin metrics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Validate + resolve export window params, return { range, error, httpStatus }.
 * Rules:
 *  - Super Admin only (already enforced at the route; we also double-check user role)
 *  - Max window: 93 days (1 quarter-ish) to prevent full-history abuse
 *  - start_at must be a valid ISO timestamp
 *  - end_at must be a valid ISO timestamp and must be STRICTLY AFTER start_at
 *  - If `range` preset provided, it computes bounds via getMetricsRangeConfig
 *    (which has built-in this_month / custom / 24h / 7d / 30d)
 */
function resolveExportWindow(req) {
  const q = req.query || {};
  let rawStart = (q.start_at && String(q.start_at).trim()) || null;
  let rawEnd = (q.end_at && String(q.end_at).trim()) || null;
  const preset = String(q.range || '24h').trim().toLowerCase();

  // Short-circuit: preset=this_month sets start/end automatically
  if (preset === 'this_month' || preset === 'month') {
    return { range: getMetricsRangeConfig('this_month'), error: null };
  }

  // For 24h/7d/30d presets, we still use the explicit NOW()-interval SQL query
  if (['24h', '7d', '30d'].includes(preset) && !rawStart && !rawEnd) {
    return { range: getMetricsRangeConfig(preset), error: null };
  }

  // Otherwise require explicit start/end
  if (!rawStart || !rawEnd) {
    return { error: 'start_at and end_at (ISO8601 UTC) are required when range=custom', httpStatus: 400 };
  }
  const startAt = new Date(rawStart);
  const endAt = new Date(rawEnd);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { error: 'start_at and end_at must be valid ISO8601 timestamps', httpStatus: 400 };
  }
  if (endAt.getTime() <= startAt.getTime()) {
    return { error: 'end_at must be strictly after start_at', httpStatus: 400 };
  }
  const MAX_DAYS = 93;
  if ((endAt.getTime() - startAt.getTime()) > MAX_DAYS * 24 * 60 * 60 * 1000) {
    return { error: `Export window cannot exceed ${MAX_DAYS} days`, httpStatus: 400 };
  }
  const range = getMetricsRangeConfig('custom', { startAt, endAt });
  return { range, error: null };
}

/**
 * GET /api/admin/metrics/export
 * Super Admin: full streaming export of analytics_events rows (with denormalized
 * restaurant/session lookup), overview rows, context mix, activity timeline.
 *
 * Query params:
 *  - format:      "csv" | "json"       (default: csv)
 *  - range:       "24h" | "7d" | "30d" | "this_month" | "custom"
 *  - start_at:    ISO8601 UTC timestamp (required when range=custom)
 *  - end_at:      ISO8601 UTC timestamp (required when range=custom)
 *  - dataset:     "events" | "overview" | "all"    (default: all)
 *
 * Security:
 *  - authenticateToken + requireRole(['SUPER_ADMIN']) at the route level
 *  - Also validates req.user.role === 'SUPER_ADMIN' inline as second layer
 *  - Excludes rows without any restaurant context (where both ae.restaurant_id
 *    AND event_data->>restaurant_id are NULL), so purely global admin-only
 *    rows never leak tenant data
 *
 * Performance:
 *  - CSV: chunked, streaming via `res.write` (no large in-memory string)
 *  - analytics_events cursor reads in 500-row batches (keyset pagination on
 *    timestamp, event_id) to keep peak memory bounded for large windows
 */
async function exportSuperAdminMetrics(req, res) {
  try {
    if (!req.user || req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Super Admin role required' });
    }

    const format = (req.query.format && String(req.query.format).toLowerCase() === 'json') ? 'json' : 'csv';
    const dataset = String(req.query.dataset || 'all').toLowerCase();

    const window = resolveExportWindow(req);
    if (window.error) {
      return res.status(window.httpStatus || 400).json({ error: window.error });
    }
    const range = window.range;

    const aeRange = buildRangeWhere(range, 'ae.timestamp', { paramOffset: 0 });
    const aeParams = [...aeRange.params, GLOBAL_RESTAURANT_ID];
    const aeWhere = `${aeRange.whereSql} AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL) AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $${aeRange.params.length + 1}`;

    // ---------- small (non-streaming) datasets we can materialize once ----------
    let overviewData = null;
    let contextMix = null;
    let timeline = null;
    const needsOverview = dataset === 'all' || dataset === 'overview';
    if (needsOverview) {
      // ============================================================
      // OVERVIEW QUERY: sequential placeholder numbering for a single
      // combined db.query() containing 3 standalone subqueries + 3
      // windowed subqueries (sessions/qr/qv). Standalone live_now
      // subqueries all compare to the SAME GLOBAL_RESTAURANT_ID so we
      // share a single $N (param #1) rather than 3 separate placeholders
      // — correct semantics and saves 2 params. All subsequent
      // WHERE clauses build with paramOffset set to the cumulative
      // previous length so placeholders are monotonic and unique.
      // ============================================================
      const oParamIdxStart = 1; // $1 used for all 3 live_restaurant global excludes
      const o_shared_global = oParamIdxStart;
      const o_next_after_global = o_shared_global + 0; // using same $1, no new slot

      const ov_sRange = buildRangeWhere(range, 's.created_at', { paramOffset: o_next_after_global });
      const ov_sParams = [...ov_sRange.params, GLOBAL_RESTAURANT_ID];
      const ov_sGlobalIdx = ov_sRange.nextParamIdx + 1;
      const ov_sWhere = `${ov_sRange.whereSql} AND s.restaurant_id <> $${ov_sGlobalIdx}`;
      const offsetAfterS = o_next_after_global + ov_sParams.length;

      const ov_aeQrRange = buildRangeWhere(range, 'ae.timestamp', { paramOffset: offsetAfterS });
      const ov_aeQrParams = [...ov_aeQrRange.params, GLOBAL_RESTAURANT_ID];
      const ov_aeQrGlobalIdx = ov_aeQrRange.nextParamIdx + 1;
      const ov_aeQrWhere = `${ov_aeQrRange.whereSql} AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL) AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $${ov_aeQrGlobalIdx}`;
      const offsetAfterQr = offsetAfterS + ov_aeQrParams.length;

      const ov_aeQvRange = buildRangeWhere(range, 'ae.timestamp', { paramOffset: offsetAfterQr });
      const ov_aeQvParams = [...ov_aeQvRange.params, GLOBAL_RESTAURANT_ID];
      const ov_aeQvGlobalIdx = ov_aeQvRange.nextParamIdx + 1;
      const ov_aeQvWhere = `${ov_aeQvRange.whereSql} AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL) AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $${ov_aeQvGlobalIdx}`;

      const overviewParams = [
        GLOBAL_RESTAURANT_ID,   // $1 — shared for all 3 live_now global excludes
        ...ov_sParams,
        ...ov_aeQrParams,
        ...ov_aeQvParams
      ];

      // ============================================================
      // CONTEXT MIX (single WHERE, sParams only): use the same
      // placeholders as above since this runs in a SEPARATE db.query
      // call from overviewQuery so $1 numbering is independent.
      // ============================================================
      const ctx_sRange = buildRangeWhere(range, 's.created_at', { paramOffset: 0 });
      const ctx_sParams = [...ctx_sRange.params, GLOBAL_RESTAURANT_ID];
      const ctx_sGlobalIdx = ctx_sRange.nextParamIdx + 1;
      const ctx_sWhere = `${ctx_sRange.whereSql} AND s.restaurant_id <> $${ctx_sGlobalIdx}`;

      // ============================================================
      // TIMELINE QUERY: build ae range filter + global exclude with
      // paramOffsets aligned to actual use of $1..$N in this QUERY
      // (no hardcoded $5 — previously broke for relative ranges where
      // only $1 existed and $2..$4 were empty causing 08P01).
      //
      // Layout for explicit bounds (custom):
      //   $1 = series_start, $2 = series_end (generate_series)
      //   $3 = ae_start,     $4 = ae_end       (ae.timestamp range)
      //   $5 = GLOBAL_RESTAURANT_ID
      // Layout for relative (24h etc):
      //   $1 = GLOBAL_RESTAURANT_ID (only param — no explicit $2..$4)
      // ============================================================
      let timelineSql, timelineParams;
      {
        const tl_aeRange = buildRangeWhere(
          range,
          'ae.timestamp',
          { paramOffset: range.useExplicitBounds ? 2 : 0 }
        );
        // after ae range placeholders, compute global exclude index
        const tl_globalIdx = tl_aeRange.nextParamIdx + 1;
        const tl_aeRangeWhere = tl_aeRange.whereSql;
        const tl_seriesStart = range.useExplicitBounds
          ? `date_trunc('${range.bucketTrunc}', $1::timestamptz)`
          : `date_trunc('${range.bucketTrunc}', NOW()) - INTERVAL '${range.sqlInterval}' + INTERVAL '${range.seriesInterval}'`;
        const tl_seriesEnd = range.useExplicitBounds
          ? `date_trunc('${range.bucketTrunc}', $2::timestamptz) - INTERVAL '1 microsecond'`
          : `date_trunc('${range.bucketTrunc}', NOW())`;
        const tl_tsFormat = range.useExplicitBounds
          ? `to_char(hours.b, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
          : `to_char(hours.b AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

        timelineSql = `
          WITH hours AS (
            SELECT generate_series(
              ${tl_seriesStart},
              ${tl_seriesEnd},
              INTERVAL '${range.seriesInterval}'
            ) AS b
          )
          SELECT
            to_char(hours.b, '${range.bucketFormat}') AS bucket_label,
            ${tl_tsFormat} AS bucket_timestamp_utc,
            COALESCE(SUM(CASE WHEN ae.event_type = 'qr_scan_validated' THEN 1 ELSE 0 END), 0) AS qr_scans,
            COALESCE(SUM(CASE WHEN ae.event_type = 'session_created' THEN 1 ELSE 0 END), 0) AS sessions_started,
            COALESCE(SUM(CASE WHEN ae.event_type = 'question_viewed' THEN 1 ELSE 0 END), 0) AS question_views
          FROM hours
          LEFT JOIN analytics_events ae
            ON date_trunc('${range.bucketTrunc}', ae.timestamp) = hours.b
           AND (${tl_aeRangeWhere})
           AND (ae.restaurant_id IS NOT NULL OR (ae.event_data->>'restaurant_id') IS NOT NULL)
           AND COALESCE(ae.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) <> $${tl_globalIdx}
          GROUP BY hours.b
          ORDER BY hours.b
        `;
        timelineParams = [
          ...(range.useExplicitBounds ? [range.startAt.toISOString(), range.endAt.toISOString()] : []),
          ...tl_aeRange.params,
          GLOBAL_RESTAURANT_ID
        ];
      }

      const [overviewQuery, contextQuery, timelineQuery] = await Promise.all([
        db.query(
          `SELECT
             NOW() AS snapshot_utc,
             (SELECT COUNT(*) FILTER (WHERE slug <> 'default') FROM restaurants) AS total_restaurants,
             (SELECT COUNT(*) FILTER (WHERE slug <> 'default' AND billing_status = 'active') FROM restaurants) AS active_restaurants,
             (SELECT COUNT(*) FROM sessions WHERE expires_at > NOW() AND COALESCE(dual_status, '') <> 'ended' AND restaurant_id <> $${o_shared_global}) AS active_sessions_now,
             (SELECT COUNT(DISTINCT table_token) FROM sessions WHERE expires_at > NOW() AND COALESCE(dual_status, '') <> 'ended' AND restaurant_id <> $${o_shared_global}) AS active_tables_now,
             (SELECT COUNT(DISTINCT restaurant_id) FROM sessions WHERE expires_at > NOW() AND COALESCE(dual_status, '') <> 'ended' AND restaurant_id <> $${o_shared_global}) AS live_restaurants_now,
             (SELECT COUNT(*) FROM sessions s WHERE ${ov_sWhere}) AS sessions_window,
             (SELECT COUNT(*) FROM analytics_events ae WHERE event_type = 'qr_scan_validated' AND ${ov_aeQrWhere}) AS qr_scans_window,
             (SELECT COUNT(*) FROM analytics_events ae WHERE event_type = 'question_viewed' AND ${ov_aeQvWhere}) AS question_views_window`,
          overviewParams
        ),
        db.query(
          `SELECT COALESCE(s.context, 'Unknown') AS label, COUNT(*) AS count
           FROM sessions s WHERE ${ctx_sWhere}
           GROUP BY COALESCE(s.context, 'Unknown') ORDER BY COUNT(*) DESC`,
          ctx_sParams
        ),
        db.query(timelineSql, timelineParams)
      ]);
      overviewData = overviewQuery.rows?.[0] || {};
      contextMix = contextQuery.rows || [];
      timeline = timelineQuery.rows || [];
    }

    const nowUtc = toIsoUtc(new Date());
    const rangeStartIso = range.useExplicitBounds && range.startAt ? toIsoUtc(range.startAt) : '';
    const rangeEndIso = range.useExplicitBounds && range.endAt ? toIsoUtc(range.endAt) : '';

    if (format === 'json') {
      const payload = {
        exported_at: nowUtc,
        range_key: range.key,
        range_start_at_utc: rangeStartIso || null,
        range_end_at_utc: rangeEndIso || null,
        dataset
      };
      if (overviewData) {
        payload.overview = {
          generated_at_utc: toIsoUtc(overviewData.snapshot_utc),
          total_restaurants: Number(overviewData.total_restaurants || 0),
          active_restaurants: Number(overviewData.active_restaurants || 0),
          active_sessions_now: Number(overviewData.active_sessions_now || 0),
          active_tables_now: Number(overviewData.active_tables_now || 0),
          live_restaurants_now: Number(overviewData.live_restaurants_now || 0),
          sessions_window: Number(overviewData.sessions_window || 0),
          qr_scans_window: Number(overviewData.qr_scans_window || 0),
          question_views_window: Number(overviewData.question_views_window || 0)
        };
        payload.context_mix = contextMix.map((r) => ({ label: r.label, count: Number(r.count || 0) }));
        payload.activity_timeline = timeline.map((r) => ({
          bucket_label: r.bucket_label,
          bucket_timestamp_utc: toIsoUtc(r.bucket_timestamp_utc),
          qr_scans: Number(r.qr_scans || 0),
          sessions_started: Number(r.sessions_started || 0),
          question_views: Number(r.question_views || 0)
        }));
      }
      if (dataset === 'all' || dataset === 'events') {
        const eventsCursor = await db.query(
          `SELECT
             ae.event_id,
             ae.event_type,
             to_char(ae.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS event_timestamp_utc,
             ae.session_id,
             ae.participant_id,
             COALESCE(ae.restaurant_id, s.restaurant_id, (ae.event_data->>'restaurant_id')::uuid) AS restaurant_id,
             COALESCE(r.name, ae.event_data->>'restaurant_name', r_default.name) AS restaurant_name,
             COALESCE(r.slug, ae.event_data->>'restaurant_slug', r_default.slug) AS restaurant_slug,
             COALESCE(s.table_token, ae.table_token, ae.event_data->>'table_token', ae.event_data->>'table_number') AS table_token,
             ae.anonymous_id,
             ae.event_data
           FROM analytics_events ae
           LEFT JOIN sessions s ON s.session_id = ae.session_id
           LEFT JOIN restaurants r ON r.id IN (ae.restaurant_id, s.restaurant_id, (ae.event_data->>'restaurant_id')::uuid)
           LEFT JOIN restaurants r_default ON r_default.id IN (s.restaurant_id, ae.restaurant_id)
           WHERE ${aeWhere}
           ORDER BY ae.timestamp ASC, ae.event_id ASC`,
          aeParams
        );
        payload.events = eventsCursor.rows.map((row) => ({
          ...row,
          event_timestamp_utc: toIsoUtc(row.event_timestamp_utc)
        }));
        payload.events_count = payload.events.length;
      }
      // Cache headers — sensitive admin-only data, no-cache
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="catalyst-sa-metrics-${range.key}-${Date.now()}.json"`
      );
      return res.status(200).json(payload);
    }

    // ---------- CSV (streaming) ----------
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="catalyst-sa-metrics-${range.key}-${Date.now()}.csv"`
    );
    // UTF-8 BOM at top of the file so Excel correctly detects UTF-8 without
    // falling back to system codepage (CSV cross-platform compatibility).
    const BOM = '\uFEFF';

    // ---- METADATA HEADER BLOCK ----
    res.write(BOM);
    res.write(toCsvLine(['catalyst_sa_metrics_export', '', '', '', '', '', '', '', '', '', '']));
    res.write(toCsvLine([
      'export_generated_at_utc',
      'range_key',
      'range_start_at_utc',
      'range_end_at_utc',
      'exported_by_user_id',
      'exported_by_role',
      'super_admin_email_redacted',
      'dataset',
      'utc_format_iso8601',
      '',
      ''
    ]));
    res.write(toCsvLine([
      nowUtc,
      range.key,
      rangeStartIso,
      rangeEndIso,
      String(req.user?.id || ''),
      String(req.user?.role || ''),
      '',
      dataset,
      'YYYY-MM-DDThh:mm:ss.sssZ',
      '',
      ''
    ]));
    res.write(toCsvLine(['', '', '', '', '', '', '', '', '', '', '']));

    // ---- OVERVIEW SECTION ----
    if (overviewData) {
      res.write(toCsvLine(['# SECTION: OVERVIEW METRICS', '', '', '', '', '', '', '', '', '', '']));
      res.write(toCsvLine([
        'timestamp_utc',
        'metric_section',
        'metric_name',
        'metric_value',
        'metric_unit',
        '',
        '',
        '',
        '',
        '',
        ''
      ]));
      const snapshotAt = toIsoUtc(overviewData.snapshot_utc);
      const overviewRows = [
        ['total_restaurants', Number(overviewData.total_restaurants || 0), 'restaurants'],
        ['active_restaurants', Number(overviewData.active_restaurants || 0), 'restaurants'],
        ['active_sessions_now', Number(overviewData.active_sessions_now || 0), 'sessions'],
        ['active_tables_now', Number(overviewData.active_tables_now || 0), 'tables'],
        ['live_restaurants_now', Number(overviewData.live_restaurants_now || 0), 'restaurants'],
        [`sessions_window_${range.key}`, Number(overviewData.sessions_window || 0), 'sessions'],
        [`qr_scans_window_${range.key}`, Number(overviewData.qr_scans_window || 0), 'events'],
        [`question_views_window_${range.key}`, Number(overviewData.question_views_window || 0), 'views']
      ];
      for (const [name, value, unit] of overviewRows) {
        res.write(toCsvLine([snapshotAt, 'overview', name, value, unit, '', '', '', '', '', '']));
      }
      res.write(toCsvLine(['', '', '', '', '', '', '', '', '', '', '']));

      // ---- CONTEXT MIX ----
      res.write(toCsvLine(['# SECTION: CONTEXT MIX', '', '', '', '', '', '', '', '', '', '']));
      res.write(toCsvLine([
        'timestamp_utc',
        'metric_section',
        'context_label',
        'count_sessions',
        'window',
        '',
        '',
        '',
        '',
        '',
        ''
      ]));
      for (const r of contextMix) {
        res.write(toCsvLine([
          nowUtc,
          'context_mix',
          String(r.label || ''),
          Number(r.count || 0),
          range.key,
          '',
          '',
          '',
          '',
          '',
          ''
        ]));
      }
      res.write(toCsvLine(['', '', '', '', '', '', '', '', '', '', '']));

      // ---- ACTIVITY TIMELINE ----
      res.write(toCsvLine(['# SECTION: ACTIVITY TIMELINE (time-series)', '', '', '', '', '', '', '', '', '', '']));
      res.write(toCsvLine([
        'timestamp_utc',
        'metric_section',
        'bucket_label',
        'qr_scans',
        'sessions_started',
        'question_views',
        'window',
        '',
        '',
        '',
        ''
      ]));
      for (const r of timeline) {
        res.write(toCsvLine([
          toIsoUtc(r.bucket_timestamp_utc),
          'timeline',
          String(r.bucket_label || ''),
          Number(r.qr_scans || 0),
          Number(r.sessions_started || 0),
          Number(r.question_views || 0),
          range.key,
          '',
          '',
          '',
          ''
        ]));
      }
      res.write(toCsvLine(['', '', '', '', '', '', '', '', '', '', '']));
    }

    // ---- ANALYTICS EVENTS ----
    if (dataset === 'all' || dataset === 'events') {
      res.write(toCsvLine(['# SECTION: ANALYTICS EVENTS (time-ordered)', '', '', '', '', '', '', '', '', '', '']));
      res.write(toCsvLine([
        'timestamp_utc',
        'event_id',
        'event_type',
        'restaurant_name',
        'restaurant_slug',
        'table_token',
        'session_id',
        'participant_id',
        'anonymous_id',
        'event_data_json'
      ]));

      // Keyset cursor: 500-row batches ordered by (timestamp ASC, event_id ASC).
      // Avoids massive in-memory result sets for 30-day windows.
      const BATCH_SIZE = 500;
      let afterTs = null;
      let afterEventId = null;
      let batchNum = 0;
      let totalEvents = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        batchNum += 1;
        let sql;
        let params;
        if (afterTs && afterEventId) {
          sql = `SELECT
                   ae.event_id,
                   ae.event_type,
                   to_char(ae.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS event_timestamp_utc,
                   ae.session_id,
                   ae.participant_id,
                   ae.anonymous_id,
                   ae.event_data,
                   COALESCE(r.name, ae.event_data->>'restaurant_name', r_default.name) AS restaurant_name,
                   COALESCE(r.slug, ae.event_data->>'restaurant_slug', r_default.slug) AS restaurant_slug,
                   COALESCE(s.table_token, ae.table_token, ae.event_data->>'table_token', ae.event_data->>'table_number') AS table_token
                 FROM analytics_events ae
                 LEFT JOIN sessions s ON s.session_id = ae.session_id
                 LEFT JOIN restaurants r ON r.id IN (ae.restaurant_id, s.restaurant_id, (ae.event_data->>'restaurant_id')::uuid)
                 LEFT JOIN restaurants r_default ON r_default.id IN (s.restaurant_id, ae.restaurant_id)
                 WHERE ${aeWhere}
                   AND (ae.timestamp > $${aeParams.length + 1}::timestamptz
                        OR (ae.timestamp = $${aeParams.length + 2}::timestamptz AND ae.event_id > $${aeParams.length + 3}::uuid))
                 ORDER BY ae.timestamp ASC, ae.event_id ASC
                 LIMIT ${BATCH_SIZE}`;
          params = [...aeParams, afterTs, afterTs, afterEventId];
        } else {
          sql = `SELECT
                   ae.event_id,
                   ae.event_type,
                   to_char(ae.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS event_timestamp_utc,
                   ae.session_id,
                   ae.participant_id,
                   ae.anonymous_id,
                   ae.event_data,
                   COALESCE(r.name, ae.event_data->>'restaurant_name', r_default.name) AS restaurant_name,
                   COALESCE(r.slug, ae.event_data->>'restaurant_slug', r_default.slug) AS restaurant_slug,
                   COALESCE(s.table_token, ae.table_token, ae.event_data->>'table_token', ae.event_data->>'table_number') AS table_token
                 FROM analytics_events ae
                 LEFT JOIN sessions s ON s.session_id = ae.session_id
                 LEFT JOIN restaurants r ON r.id IN (ae.restaurant_id, s.restaurant_id, (ae.event_data->>'restaurant_id')::uuid)
                 LEFT JOIN restaurants r_default ON r_default.id IN (s.restaurant_id, ae.restaurant_id)
                 WHERE ${aeWhere}
                 ORDER BY ae.timestamp ASC, ae.event_id ASC
                 LIMIT ${BATCH_SIZE}`;
          params = aeParams;
        }
        const batch = await db.query(sql, params);
        if (!batch.rows || batch.rows.length === 0) break;
        for (const row of batch.rows) {
          totalEvents += 1;
          const eventJson = row.event_data != null
            ? (typeof row.event_data === 'string' ? row.event_data : JSON.stringify(row.event_data))
            : '';
          res.write(toCsvLine([
            toIsoUtc(row.event_timestamp_utc),
            String(row.event_id || ''),
            String(row.event_type || ''),
            String(row.restaurant_name || ''),
            String(row.restaurant_slug || ''),
            String(row.table_token || ''),
            String(row.session_id || ''),
            String(row.participant_id || ''),
            String(row.anonymous_id || ''),
            eventJson
          ]));
        }
        const last = batch.rows[batch.rows.length - 1];
        afterTs = new Date(last.event_timestamp_utc).toISOString();
        afterEventId = last.event_id;
        if (batch.rows.length < BATCH_SIZE) break;
        // Yield a tick between batches to not starve the event loop for huge exports.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setImmediate(r));
      }

      // ---- EVENTS FOOTER ----
      res.write(toCsvLine(['', '', '', '', '', '', '', '', '', '', '']));
      res.write(toCsvLine([
        '# TOTALS: events_exported',
        nowUtc,
        String(totalEvents),
        'events',
        `batches=${batchNum}`,
        '',
        '',
        '',
        '',
        '',
        ''
      ]));
    }

    return res.end();
  } catch (err) {
    console.error('[SA metrics export] failed:', err);
    // If headers not yet sent, send proper JSON error. If streaming already
    // started (res.write called) we can't change status, so abort the stream.
    try {
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Export failed. Please try again with a narrower date range.' });
      }
      res.destroy && res.destroy(err);
    } catch (_) { /* swallow */ }
    return null;
  }
}

/**
 * GET /api/admin/questions
 * Super Admin: list global/default question bank rows.
 */
async function getGlobalQuestions(req, res) {
  try {
    const result = await db.query(
      `SELECT question_id, question_text, answer_text, category, sub_category, difficulty,
              question_type, context, options, active, sort_order, restaurant_id,
              created_at, updated_at
       FROM questions
       WHERE restaurant_id IS NULL OR restaurant_id = $1
       ORDER BY COALESCE(sort_order, 2147483647), question_id`,
      [GLOBAL_RESTAURANT_ID]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get global questions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /api/admin/questions/:id
 * Super Admin: update one global question.
 */
async function updateGlobalQuestion(req, res) {
  const questionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(questionId)) {
    return res.status(400).json({ error: 'A valid question id is required' });
  }

  const {
    question_text,
    answer_text,
    category,
    sub_category,
    difficulty,
    question_type,
    context,
    options,
    active
  } = req.body;

  try {
    const fields = [];
    const params = [questionId];
    let index = 2;

    if (question_text !== undefined) {
      const value = String(question_text || '').trim();
      if (!value) {
        return res.status(400).json({ error: 'question_text cannot be empty' });
      }
      fields.push(`question_text = $${index++}`);
      params.push(value);
    }

    if (answer_text !== undefined) {
      fields.push(`answer_text = $${index++}`);
      params.push(answer_text ? String(answer_text).trim() : null);
    }

    if (category !== undefined) {
      fields.push(`category = $${index++}`);
      params.push(category ? String(category).trim() : null);
    }

    if (sub_category !== undefined) {
      fields.push(`sub_category = $${index++}`);
      params.push(sub_category ? String(sub_category).trim() : null);
    }

    if (difficulty !== undefined) {
      fields.push(`difficulty = $${index++}`);
      params.push(normalizeQuestionDifficulty(difficulty));
    }

    if (question_type !== undefined) {
      const normalizedQuestionType = normalizeQuestionType(question_type);
      const parsedOptions = options !== undefined ? parseOptionsField(options) : undefined;

      if (normalizedQuestionType === 'multiple-choice' && !parsedOptions && options !== undefined) {
        return res.status(400).json({ error: 'multiple-choice questions require options' });
      }

      fields.push(`question_type = $${index++}`);
      params.push(normalizedQuestionType);
    }

    if (context !== undefined) {
      fields.push(`context = $${index++}`);
      params.push(normalizeQuestionContext(context));
    }

    if (options !== undefined) {
      const parsedOptions = parseOptionsField(options);
      const nextQuestionType = question_type !== undefined ? normalizeQuestionType(question_type) : null;

      if (nextQuestionType === 'multiple-choice' && !parsedOptions) {
        return res.status(400).json({ error: 'multiple-choice questions require options' });
      }

      fields.push(`options = $${index++}::jsonb`);
      params.push(parsedOptions ? JSON.stringify(parsedOptions) : null);
    }

    if (active !== undefined) {
      fields.push(`active = $${index++}`);
      params.push(Boolean(active));
    }

    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) {
      return res.status(400).json({ error: 'No question fields were provided to update' });
    }

    const result = await db.query(
      `UPDATE questions
       SET ${fields.join(', ')}
       WHERE question_id = $1 AND (restaurant_id IS NULL OR restaurant_id = $${index})
       RETURNING question_id, question_text, answer_text, category, sub_category, difficulty,
                 question_type, context, options, active, sort_order, restaurant_id, created_at, updated_at`,
      [...params, GLOBAL_RESTAURANT_ID]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Question not found' });
    }

    deckService._resetCache();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update global question error:', err);
    res.status(400).json({ error: err.message || 'Failed to update question' });
  }
}

/**
 * DELETE /api/admin/questions/:id
 * Super Admin: delete one global question.
 */
async function deleteGlobalQuestion(req, res) {
  const questionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(questionId)) {
    return res.status(400).json({ error: 'A valid question id is required' });
  }

  try {
    const result = await db.query(
      `DELETE FROM questions
       WHERE question_id = $1 AND (restaurant_id IS NULL OR restaurant_id = $2)
       RETURNING question_id`,
      [questionId, GLOBAL_RESTAURANT_ID]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Question not found' });
    }

    deckService._resetCache();
    res.json({ deleted: 1, question_id: questionId });
  } catch (err) {
    console.error('Delete global question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/admin/questions/bulk-delete
 * Super Admin: bulk delete global questions.
 */
async function bulkDeleteGlobalQuestions(req, res) {
  const { question_ids } = req.body;
  if (!Array.isArray(question_ids) || question_ids.length === 0) {
    return res.status(400).json({ error: 'question_ids must be a non-empty array' });
  }

  const normalizedIds = question_ids
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id));

  if (normalizedIds.length !== question_ids.length) {
    return res.status(400).json({ error: 'question_ids must contain valid question ids' });
  }

  try {
    const result = await db.query(
      `DELETE FROM questions
       WHERE question_id = ANY($1::int[]) AND (restaurant_id IS NULL OR restaurant_id = $2)
       RETURNING question_id`,
      [normalizedIds, GLOBAL_RESTAURANT_ID]
    );

    deckService._resetCache();
    res.json({
      deleted: result.rowCount,
      question_ids: result.rows.map((row) => row.question_id)
    });
  } catch (err) {
    console.error('Bulk delete global questions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /api/admin/questions/reshuffle
 * Super Admin: Bulk update 'sort_order' of Global Questions (restaurant_id IS NULL)
 */
async function reshuffleGlobalQuestions(req, res) {
  const { question_ids } = req.body;
  if (!Array.isArray(question_ids)) {
    return res.status(400).json({ error: 'question_ids array is required' });
  }

  try {
    await db.query('BEGIN');
    for (let i = 0; i < question_ids.length; i++) {
      await db.query(
        `UPDATE questions 
         SET sort_order = $1 
         WHERE question_id = $2 AND (restaurant_id IS NULL OR restaurant_id = $3)`,
        [i, question_ids[i], GLOBAL_RESTAURANT_ID]
      );
    }
    await db.query('COMMIT');
    deckService._resetCache();
    res.json({ message: 'Global questions reshuffled successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Reshuffle global questions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/admin/questions/import
 * Super Admin: import global questions from CSV text.
 */
async function importGlobalQuestions(req, res) {
  const { csvText, replaceExisting = false } = req.body;

  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ error: 'csvText is required' });
  }

  try {
    const parsedRows = parseCsvText(csvText);
    if (parsedRows.length === 0) {
      return res.status(400).json({ error: 'No question rows were found in the CSV file' });
    }

    const questionsToInsert = parsedRows.map((row, index) => {
      const questionText = row.question_text || row.text || row.question;
      if (!questionText) {
        throw new Error(`Row ${index + 2}: question_text is required`);
      }

      const questionType = normalizeQuestionType(row.question_type || row.type);
      const options = parseOptionsField(row.options || row.choices);

      if (questionType === 'multiple-choice' && (!options || options.length === 0)) {
        throw new Error(`Row ${index + 2}: multiple-choice questions require options`);
      }

      return {
        question_text: questionText,
        answer_text:
          row.answer_text ||
          row.hint ||
          row.follow_up_tip ||
          row.follow_up ||
          row.tip ||
          null,
        category: row.category || null,
        sub_category: row.sub_category || row.subcategory || row.sub_category_name || null,
        difficulty: normalizeQuestionDifficulty(row.difficulty),
        question_type: questionType,
        context: normalizeQuestionContext(row.context),
        options,
        active: parseBooleanField(row.active, true),
        sort_order: row.sort_order !== undefined && row.sort_order !== '' ? Number.parseInt(row.sort_order, 10) : null
      };
    });

    if (questionsToInsert.some((question) => question.sort_order !== null && !Number.isInteger(question.sort_order))) {
      return res.status(400).json({ error: 'sort_order values must be whole numbers' });
    }

    await db.query('BEGIN');

    let nextSortOrder = 0;
    if (replaceExisting) {
      await db.query(
        'DELETE FROM questions WHERE restaurant_id IS NULL OR restaurant_id = $1',
        [GLOBAL_RESTAURANT_ID]
      );
    } else {
      const maxSort = await db.query(
        `SELECT COALESCE(MAX(sort_order), -1) AS max_sort
         FROM questions
         WHERE restaurant_id IS NULL OR restaurant_id = $1`,
        [GLOBAL_RESTAURANT_ID]
      );
      nextSortOrder = Number.parseInt(maxSort.rows[0]?.max_sort ?? -1, 10) + 1;
    }

    for (const question of questionsToInsert) {
      const sortOrder = Number.isInteger(question.sort_order) ? question.sort_order : nextSortOrder++;

      await db.query(
        `INSERT INTO questions (
          question_text,
          answer_text,
          category,
          sub_category,
          difficulty,
          question_type,
          context,
          options,
          active,
          sort_order,
          restaurant_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NULL)`,
        [
          question.question_text,
          question.answer_text,
          question.category,
          question.sub_category,
          question.difficulty,
          question.question_type,
          question.context,
          question.options ? JSON.stringify(question.options) : null,
          question.active,
          sortOrder
        ]
      );
    }

    await db.query('COMMIT');
    deckService._resetCache();

    res.status(201).json({
      imported: questionsToInsert.length,
      replaceExisting: Boolean(replaceExisting)
    });
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // Ignore rollback failures when the transaction did not start.
    }
    console.error('Import global questions error:', err);
    res.status(400).json({ error: err.message || 'Failed to import CSV questions' });
  }
}

/**
 * GET /api/tenant/billing
 * Restaurant Admin: Get own restaurant billing info
 */
async function getTenantBilling(req, res) {
  const restaurantId = req.user.restaurant_id;
  if (!restaurantId) {
    return res.status(400).json({ error: 'User is not associated with any restaurant' });
  }

  try {
    const result = await db.query(
      `SELECT id, name, slug, billing_status, contact_email, contact_phone,
              address, latitude, longitude, geofence_radius_meters, manager_name, created_at
       FROM restaurants
       WHERE id = $1`,
      [restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const restaurant = result.rows[0];

    if (restaurant.address && (restaurant.latitude == null || restaurant.longitude == null)) {
      const geocoded = await geocodeAddress(restaurant.address);

      if (geocoded?.latitude != null && geocoded?.longitude != null) {
        const updatedResult = await db.query(
          `UPDATE restaurants
           SET latitude = $2,
               longitude = $3,
               updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, slug, billing_status, contact_email, contact_phone,
                     address, latitude, longitude, geofence_radius_meters, manager_name, created_at`,
          [restaurantId, geocoded.latitude, geocoded.longitude]
        );

        const geocodedRow = updatedResult.rows[0];
        if (geocodedRow && geocodedRow.slug) invalidateCachedRestaurantGeo(geocodedRow.slug);
        return res.json(geocodedRow || result.rows[0]);
      }
    }

    res.json(restaurant);
  } catch (err) {
    console.error('Get tenant billing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateTenantProfile(req, res) {
  const restaurantId = req.user.restaurant_id;
  if (!restaurantId) {
    return res.status(400).json({ error: 'User is not associated with any restaurant' });
  }
  const { name, managerName, contactEmail, contactPhone, address, latitude, longitude } = req.body;
  try {
    const fields = [];
    const params = [restaurantId];
    let i = 2;
    const location = await resolveRestaurantLocation({
      address,
      latitude,
      longitude,
      shouldGeocode:
        address !== undefined &&
        (latitude === undefined || latitude === null || latitude === '') &&
        (longitude === undefined || longitude === null || longitude === '')
    });
    if (name !== undefined)         { fields.push(`name = $${i++}`);          params.push(name); }
    if (managerName !== undefined)    { fields.push(`manager_name = $${i++}`);  params.push(managerName || null); }
    if (contactEmail !== undefined)   { fields.push(`contact_email = $${i++}`); params.push(contactEmail || null); }
    if (contactPhone !== undefined)   { fields.push(`contact_phone = $${i++}`); params.push(contactPhone || null); }
    if (address !== undefined)        { fields.push(`address = $${i++}`);        params.push(location?.address ?? null); }
    if (latitude !== undefined || (address !== undefined && location && 'latitude' in location)) {
      fields.push(`latitude = $${i++}`);
      const rawLat = location?.latitude ?? null;
      const clampedLat = rawLat == null ? null : Math.min(Math.max(Number(rawLat), -90), 90);
      params.push(clampedLat);
    }
    if (longitude !== undefined || (address !== undefined && location && 'longitude' in location)) {
      fields.push(`longitude = $${i++}`);
      const rawLng = location?.longitude ?? null;
      const clampedLng = rawLng == null ? null : Math.min(Math.max(Number(rawLng), -180), 180);
      params.push(clampedLng);
    }
    fields.push(`updated_at = NOW()`);
    if (fields.length === 1) return res.status(400).json({ error: 'No fields to update' });

    const result = await db.query(
      `UPDATE restaurants SET ${fields.join(', ')} WHERE id = $1
       RETURNING id, name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, manager_name, created_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Restaurant not found' });
    const profileUpdated = result.rows[0];
    if (profileUpdated && profileUpdated.slug) {
      invalidateCachedRestaurantGeo(profileUpdated.slug);
    }
    res.json(profileUpdated);
  } catch (err) {
    console.error('Update tenant profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/tenant/tables
 * Restaurant Admin: List all tables registered for own restaurant
 */
async function getTenantTables(req, res) {
  const restaurantId = req.user.restaurant_id;
  if (!restaurantId) {
    return res.status(400).json({ error: 'User is not associated with any restaurant' });
  }

  try {
    const result = await db.query(
      `SELECT id, table_number, qr_code_url, created_at 
       FROM restaurant_tables 
       WHERE restaurant_id = $1 
       ORDER BY table_number ASC`,
      [restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get tenant tables error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/tenant/tables
 * Restaurant Admin: Register a new table, generate its QR URL.
 * DEPRECATED: This endpoint is now SUPER ADMIN ONLY.
 */
async function createTenantTable(req, res) {
  return res.status(403).json({
    error: 'Table and QR management are performed exclusively by the Catalyst Super Admin team. Please contact your onboarding contact to provision tables or make QR changes.'
  });
}

/**
 * POST /api/tenant/qr
 * Restaurant Admin: Generate QR codes for selected table(s) or all tables.
 * DEPRECATED: This endpoint is now SUPER ADMIN ONLY.
 */
async function generateTenantQr(req, res) {
  return res.status(403).json({
    error: 'QR code generation is performed exclusively by the Catalyst Super Admin team. Please contact your onboarding contact for QR deliveries.'
  });
}

/**
 * PATCH /api/tenant/tables/:id/qr
 * Restaurant Admin: Regenerate QR code for a single table.
 * DEPRECATED: This endpoint is now SUPER ADMIN ONLY.
 */
async function regenerateTableQr(req, res) {
  return res.status(403).json({
    error: 'QR regeneration is performed exclusively by the Catalyst Super Admin team. Please contact your onboarding contact for changes.'
  });
}

module.exports = {
  login,
  requestPasswordReset,
  validateResetToken,
  geocodeRestaurantAddress,
  resetPassword,
  getTenants,
  createTenantInvite,
  createTenant,
  updateTenant,
  deleteTenantPermanent,
  getSuperAdminMetrics,
  exportSuperAdminMetrics,
  updateTenantProfile,
  getGlobalQuestions,
  updateGlobalQuestion,
  deleteGlobalQuestion,
  bulkDeleteGlobalQuestions,
  importGlobalQuestions,
  reshuffleGlobalQuestions,
  getTenantBilling,
  getTenantTables,
  createTenantTable,
  generateTenantQr,
  regenerateTableQr,
  hashPassword
};
