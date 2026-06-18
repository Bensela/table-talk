const crypto = require('crypto');
const db = require('../db');
const { signToken } = require('../middleware/authMiddleware');
const QRCode = require('qrcode');
const deckService = require('../services/deckService');
const { geocodeAddress } = require('../services/geocodeService');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://tabletalk.app').replace(/\/+$/, '');
const GLOBAL_RESTAURANT_ID = 'd0000000-0000-0000-0000-000000000000';
const INVITE_EXPIRY_DAYS = Number.parseInt(process.env.RESTAURANT_INVITE_EXPIRY_DAYS || '14', 10);

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

function getMetricsRangeConfig(rangeKey) {
  const normalized = String(rangeKey || '24h').trim().toLowerCase();

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

  return {
    key: '24h',
    sqlInterval: '24 hours',
    seriesInterval: '1 hour',
    bucketFormat: 'HH24:00',
    bucketTrunc: 'hour'
  };
}

function buildInviteEmail(restaurantName, inviteEmail, inviteUrl) {
  const subject = 'Complete your Table-Talk restaurant subscription';
  const bodyText = [
    `Hi ${restaurantName},`,
    '',
    'Your Table-Talk restaurant subscription is ready to complete.',
    'Use the secure link below to finish the onboarding form and create your restaurant admin login:',
    '',
    inviteUrl,
    '',
    'If you are opening this on a mobile device, you can also scan the provided QR code.',
    '',
    'Thanks,',
    'Table-Talk'
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
 * Public admin login endpoint.
 */
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userResult = await db.query(
      `SELECT u.*, r.name as restaurant_name, r.slug as restaurant_slug 
       FROM users u 
       LEFT JOIN restaurants r ON u.restaurant_id = r.id 
       WHERE u.email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
    const isCorrect = verifyPassword(password, user.password_hash);
    if (!isCorrect) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Sign token
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      restaurant_id: user.restaurant_id
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        restaurant_id: user.restaurant_id,
        restaurant_name: user.restaurant_name,
        restaurant_slug: user.restaurant_slug
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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

/**
 * GET /api/admin/tenants
 * Super Admin: List all tenants (restaurants) with billing details.
 */
async function getTenants(req, res) {
  try {
    const result = await db.query(
      `SELECT id, name, slug, billing_status, contact_email, contact_phone,
              address, latitude, longitude, manager_name, created_at
       FROM restaurants
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get tenants error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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

    await db.query('BEGIN');

    const restaurantResult = await db.query(
      `INSERT INTO restaurants (name, slug, billing_status, contact_email)
       VALUES ($1, $2, 'pending', $3)
       RETURNING id, name, slug, billing_status, contact_email, created_at`,
      [trimmedName, slug, trimmedEmail]
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
  const { name, slug, adminEmail, adminPassword, contactEmail, contactPhone, address, latitude, longitude, managerName } = req.body;
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

    await db.query('BEGIN');

    const restResult = await db.query(
      `INSERT INTO restaurants (name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, manager_name)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
       RETURNING id, name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, manager_name, created_at`,
      [
        name,
        slug,
        contactEmail || null,
        contactPhone || null,
        location?.address ?? (address || null),
        location?.latitude ?? parseOptionalNumber(latitude),
        location?.longitude ?? parseOptionalNumber(longitude),
        managerName || null
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
  const { name, slug, billing_status, contactEmail, contactPhone, address, latitude, longitude, managerName } = req.body;

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
      params.push(location?.latitude ?? null);
    }
    if (longitude !== undefined || (address !== undefined && location && 'longitude' in location)) {
      fields.push(`longitude = $${index++}`);
      params.push(location?.longitude ?? null);
    }
    if (managerName !== undefined) {
      fields.push(`manager_name = $${index++}`);
      params.push(managerName || null);
    }

    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const result = await db.query(
      `UPDATE restaurants
       SET ${fields.join(', ')}
       WHERE id = $1
       RETURNING id, name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, manager_name, created_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json(result.rows[0]);
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
    const range = getMetricsRangeConfig(req.query.range);
    const bucketTrunc = range.bucketTrunc;
    const bucketFormat = range.bucketFormat;
    const sqlInterval = range.sqlInterval;
    const seriesInterval = range.seriesInterval;

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
             AND COALESCE(last_activity_at, created_at) >= NOW() - INTERVAL '5 minutes'
         )
         SELECT
           (SELECT COUNT(*) FROM live_sessions) AS active_sessions_now,
           (SELECT COUNT(DISTINCT restaurant_id::text || ':' || table_token) FROM live_sessions) AS active_tables_now,
           (SELECT COUNT(DISTINCT restaurant_id) FROM live_sessions) AS live_restaurants_now,
           (SELECT COUNT(*) FROM live_sessions WHERE mode = 'dual-phone') AS dual_sessions_now,
           (SELECT COUNT(*) FROM sessions WHERE restaurant_id <> $1 AND created_at >= NOW() - INTERVAL '${sqlInterval}') AS sessions_window,
           (SELECT COUNT(*) FROM analytics_events WHERE event_type = 'qr_scan_validated' AND timestamp >= NOW() - INTERVAL '${sqlInterval}') AS qr_scans_window,
           (SELECT COUNT(*) FROM analytics_events WHERE event_type = 'question_viewed' AND timestamp >= NOW() - INTERVAL '${sqlInterval}') AS question_views_window`
        ,
        [GLOBAL_RESTAURANT_ID]
      ),
      db.query(
        `WITH live_sessions AS (
           SELECT restaurant_id, table_token, COALESCE(last_activity_at, created_at) AS last_seen_at
           FROM sessions
           WHERE restaurant_id <> $1
             AND expires_at > NOW()
             AND COALESCE(dual_status, '') <> 'ended'
             AND COALESCE(last_activity_at, created_at) >= NOW() - INTERVAL '5 minutes'
         )
         SELECT
           r.id,
           r.name,
           r.slug,
           r.address,
           r.latitude,
           r.longitude,
           MAX(ls.last_seen_at) AS last_activity_at,
           COUNT(*) AS active_sessions,
           COUNT(DISTINCT ls.table_token) AS active_tables
         FROM live_sessions ls
         JOIN restaurants r ON r.id = ls.restaurant_id
         GROUP BY r.id, r.name, r.slug, r.address, r.latitude, r.longitude
         ORDER BY COUNT(*) DESC, MAX(ls.last_seen_at) DESC
         LIMIT 8`,
        [GLOBAL_RESTAURANT_ID]
      ),
      db.query(
        `SELECT COALESCE(context, 'Unknown') AS label, COUNT(*) AS count
         FROM sessions
         WHERE restaurant_id <> $1
           AND created_at >= NOW() - INTERVAL '${sqlInterval}'
         GROUP BY COALESCE(context, 'Unknown')
         ORDER BY COUNT(*) DESC`,
        [GLOBAL_RESTAURANT_ID]
      ),
      db.query(
        `WITH hours AS (
           SELECT generate_series(
             date_trunc('${bucketTrunc}', NOW()) - INTERVAL '${sqlInterval}' + INTERVAL '${seriesInterval}',
             date_trunc('${bucketTrunc}', NOW()),
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
          AND ae.timestamp >= NOW() - INTERVAL '${sqlInterval}'
         GROUP BY hours.hour_bucket
         ORDER BY hours.hour_bucket`
      ),
      db.query(
        `SELECT
           ae.event_type,
           ae.timestamp,
           ae.event_data,
           COALESCE(r.name, ae.event_data->>'restaurant_name') AS restaurant_name,
           COALESCE(r.slug, ae.event_data->>'restaurant_slug') AS restaurant_slug,
           COALESCE(s.table_token, ae.event_data->>'table_number') AS table_token
         FROM analytics_events ae
         LEFT JOIN sessions s ON s.session_id = ae.session_id
         LEFT JOIN restaurants r ON r.id = s.restaurant_id
         WHERE ae.timestamp >= NOW() - INTERVAL '${sqlInterval}'
           AND ae.event_type IN ('qr_scan_validated', 'qr_scan_rejected', 'session_created', 'question_viewed', 'session_paired', 'context_changed')
         ORDER BY ae.timestamp DESC
         LIMIT 12`
      )
    ]);

    const restaurantSummary = restaurantSummaryResult.rows[0];
    const overview = overviewResult.rows[0];

    res.json({
      generated_at: new Date().toISOString(),
      range: range.key,
      overview: {
        total_restaurants: Number(restaurantSummary.total_restaurants || 0),
        active_restaurants: Number(restaurantSummary.active_restaurants || 0),
        pending_restaurants: Number(restaurantSummary.pending_restaurants || 0),
        suspended_restaurants: Number(restaurantSummary.suspended_restaurants || 0),
        total_questions: Number(questionSummaryResult.rows[0]?.total_questions || 0),
        active_sessions_now: Number(overview.active_sessions_now || 0),
        active_tables_now: Number(overview.active_tables_now || 0),
        live_restaurants_now: Number(overview.live_restaurants_now || 0),
        dual_sessions_now: Number(overview.dual_sessions_now || 0),
        sessions_window: Number(overview.sessions_window || 0),
        qr_scans_window: Number(overview.qr_scans_window || 0),
        question_views_window: Number(overview.question_views_window || 0)
      },
      live_restaurants: liveRestaurantsResult.rows.map((row) => ({
        ...row,
        active_sessions: Number(row.active_sessions || 0),
        active_tables: Number(row.active_tables || 0)
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
              address, latitude, longitude, manager_name, created_at
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
                     address, latitude, longitude, manager_name, created_at`,
          [restaurantId, geocoded.latitude, geocoded.longitude]
        );

        return res.json(updatedResult.rows[0]);
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
    if (latitude !== undefined || (address !== undefined && location && 'latitude' in location))       { fields.push(`latitude = $${i++}`);       params.push(location?.latitude ?? null); }
    if (longitude !== undefined || (address !== undefined && location && 'longitude' in location))     { fields.push(`longitude = $${i++}`);     params.push(location?.longitude ?? null); }
    fields.push(`updated_at = NOW()`);
    if (fields.length === 1) return res.status(400).json({ error: 'No fields to update' });

    const result = await db.query(
      `UPDATE restaurants SET ${fields.join(', ')} WHERE id = $1
       RETURNING id, name, slug, billing_status, contact_email, contact_phone, address, latitude, longitude, manager_name, created_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(result.rows[0]);
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
 * Restaurant Admin: Register a new table, generate its QR URL
 */
async function createTenantTable(req, res) {
  const restaurantId = req.user.restaurant_id;
  const { table_number } = req.body;

  if (!restaurantId) {
    return res.status(400).json({ error: 'User is not associated with any restaurant' });
  }
  if (!table_number) {
    return res.status(400).json({ error: 'table_number is required' });
  }

  try {
    // Get restaurant slug
    const restRes = await db.query('SELECT slug FROM restaurants WHERE id = $1', [restaurantId]);
    if (restRes.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }
    const slug = restRes.rows[0].slug;

    // Generate table public QR URL using path-based format: /r/{slug}/t/{tableNumber}
    const qr_code_url = `${FRONTEND_URL}/r/${slug}/t/${encodeURIComponent(table_number)}`;

    const result = await db.query(
      `INSERT INTO restaurant_tables (restaurant_id, table_number, qr_code_url) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (restaurant_id, table_number) DO UPDATE SET qr_code_url = EXCLUDED.qr_code_url
       RETURNING id, table_number, qr_code_url, created_at`,
      [restaurantId, table_number, qr_code_url]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create tenant table error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/tenant/qr
 * Restaurant Admin: Generate QR codes for selected table(s) or all tables.
 * Body: { tables?: string[] } — if omitted, generates for all tables.
 * Returns array of { id, table_number, url, qr } where qr is a data URL.
 */
async function generateTenantQr(req, res) {
  const restaurantId = req.user.restaurant_id;
  if (!restaurantId) {
    return res.status(400).json({ error: 'User is not associated with any restaurant' });
  }
  const { tables } = req.body; // optional array of table_numbers

  try {
    const restRes = await db.query('SELECT slug FROM restaurants WHERE id = $1', [restaurantId]);
    if (!restRes.rows.length) return res.status(404).json({ error: 'Restaurant not found' });
    const slug = restRes.rows[0].slug;

    let query = `SELECT id, table_number, qr_code_url FROM restaurant_tables WHERE restaurant_id = $1`;
    const params = [restaurantId];
    if (Array.isArray(tables) && tables.length > 0) {
      query += ` AND table_number = ANY($2)`;
      params.push(tables);
    }
    query += ` ORDER BY table_number ASC`;

    const rows = await db.query(query, params);
    const results = await Promise.all(rows.rows.map(async (row) => {
      const url = `${FRONTEND_URL}/r/${slug}/t/${encodeURIComponent(row.table_number)}`;
      const qr = await QRCode.toDataURL(url, { width: 600, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
      return { id: row.id, table_number: row.table_number, url, qr };
    }));

    res.json(results);
  } catch (err) {
    console.error('Generate tenant QR error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /api/tenant/tables/:id/qr
 * Restaurant Admin: Regenerate QR code for a single table. Returns fresh QR data URL.
 */
async function regenerateTableQr(req, res) {
  const restaurantId = req.user.restaurant_id;
  if (!restaurantId) {
    return res.status(400).json({ error: 'User is not associated with any restaurant' });
  }
  const { id } = req.params;

  try {
    const restRes = await db.query('SELECT slug FROM restaurants WHERE id = $1', [restaurantId]);
    if (!restRes.rows.length) return res.status(404).json({ error: 'Restaurant not found' });
    const slug = restRes.rows[0].slug;

    const rowRes = await db.query(
      `SELECT id, table_number FROM restaurant_tables WHERE id = $1 AND restaurant_id = $2`,
      [id, restaurantId]
    );
    if (!rowRes.rows.length) return res.status(404).json({ error: 'Table not found' });

    const row = rowRes.rows[0];
    const url = `${FRONTEND_URL}/r/${slug}/t/${encodeURIComponent(row.table_number)}`;
    const qr = await QRCode.toDataURL(url, { width: 600, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });

    await db.query(
      `UPDATE restaurant_tables SET qr_code_url = $1 WHERE id = $2`,
      [url, id]
    );

    res.json({ id: row.id, table_number: row.table_number, url, qr });
  } catch (err) {
    console.error('Regenerate table QR error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  login,
  requestPasswordReset,
  geocodeRestaurantAddress,
  resetPassword,
  getTenants,
  createTenantInvite,
  createTenant,
  updateTenant,
  deleteTenantPermanent,
  getSuperAdminMetrics,
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
