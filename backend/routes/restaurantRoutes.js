// backend/routes/restaurantRoutes.js
// Public:  GET /restaurants/:slug/info
// Admin:   GET|POST|PATCH /restaurants/:slug   (requires X-Restaurant-Key header)
//          GET /restaurants/:slug/sessions
//          POST /restaurants/:slug/qr
//          PATCH /restaurants/:slug/deactivate

const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const QRCode = require('qrcode');

// ── Admin auth middleware ──────────────────────────────────────────────────────
const adminAuth = async (req, res, next) => {
  const slug = req.params.slug;
  const key  = req.headers['x-restaurant-key'];

  if (!key) {
    return res.status(401).json({ error: 'X-Restaurant-Key header required' });
  }

  try {
    const result = await db.query(
      `SELECT id, slug, name, plan, active
       FROM restaurants
       WHERE slug = $1 AND secret_key = $2`,
      [slug, key]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Invalid credentials' });
    }

    req.restaurant = result.rows[0];
    next();
  } catch (err) {
    console.error('[adminAuth] DB error:', err);
    next(err);
  }
};

// ── Super-admin key guard (for creating restaurants) ──────────────────────────
const superAdminGuard = (req, res, next) => {
  const superKey = process.env.SUPER_ADMIN_KEY;
  if (!superKey) return next(); // Not set → open (dev only)
  if (req.headers['x-super-admin-key'] !== superKey) {
    return res.status(403).json({ error: 'Super-admin key required' });
  }
  next();
};

// ── Public: resolve slug (called by QR landing to show restaurant name) ───────
router.get('/:slug/info', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT slug, name, active FROM restaurants WHERE slug = $1`,
      [req.params.slug]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /restaurants/:slug/info]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: get restaurant details ─────────────────────────────────────────────
router.get('/:slug', adminAuth, (req, res) => {
  // secret_key intentionally excluded from response
  const { id, slug, name, plan, active, contact_email, contact_phone,
          address, latitude, longitude, manager_name, created_at } = req.restaurant;
  res.json({ id, slug, name, plan, active, contact_email, contact_phone,
              address, latitude, longitude, manager_name, created_at });
});

// ── Super-admin: create a restaurant ─────────────────────────────────────────
// POST /restaurants  { name, slug, contactEmail, contactPhone, address, latitude, longitude, managerName }
router.post('/', superAdminGuard, async (req, res) => {
  const { name, slug, contactEmail, contactPhone, address, latitude, longitude, managerName } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' });
  }

  const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const secretKey = crypto.randomBytes(32).toString('hex');

  try {
    const result = await db.query(
      `INSERT INTO restaurants (slug, name, secret_key, contact_email, contact_phone, address, latitude, longitude, manager_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, slug, name, plan, secret_key, active, contact_email, contact_phone, address, latitude, longitude, manager_name, created_at`,
      [slugClean, name, secretKey, contactEmail || null, contactPhone || null, address || null, latitude || null, longitude || null, managerName || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Slug already taken' });
    }
    console.error('[POST /restaurants]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: list recent sessions ───────────────────────────────────────────────
router.get('/:slug/sessions', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         session_id,
         table_token,
         mode,
         context,
         dual_status,
         created_at,
         expires_at,
         current_question_index
       FROM sessions
       WHERE restaurant_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.params.slug]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /restaurants/:slug/sessions]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: generate QR codes ──────────────────────────────────────────────────
// POST /restaurants/:slug/qr  { tables: ['table-001', ...], baseUrl }
router.post('/:slug/qr', adminAuth, async (req, res) => {
  const {
    tables,
    baseUrl = process.env.FRONTEND_URL || 'https://tabletalk.app'
  } = req.body;

  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({ error: 'tables[] array required' });
  }

  try {
    const results = [];
    for (const tableId of tables) {
      const url = `${baseUrl}/r/${req.params.slug}/t/${tableId}`;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 600,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      results.push({ tableId, url, qr: dataUrl });
    }
    res.json(results);
  } catch (err) {
    console.error('[POST /restaurants/:slug/qr]', err);
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// ── Admin: analytics summary ──────────────────────────────────────────────────
router.get('/:slug/analytics', adminAuth, async (req, res) => {
  try {
    const [sessions, events] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) AS total_sessions,
           COUNT(*) FILTER (WHERE mode = 'dual-phone') AS dual_sessions,
           COUNT(*) FILTER (WHERE mode = 'single-phone') AS single_sessions,
           COUNT(DISTINCT table_token) AS tables_used,
           MAX(created_at) AS last_session_at
         FROM sessions
         WHERE restaurant_id = $1`,
        [req.params.slug]
      ),
      db.query(
        `SELECT event_type, COUNT(*) AS count
         FROM analytics_events ae
         JOIN sessions s ON ae.session_id = s.session_id
         WHERE s.restaurant_id = $1
           AND ae.timestamp > NOW() - INTERVAL '30 days'
         GROUP BY event_type
         ORDER BY count DESC`,
        [req.params.slug]
      )
    ]);

    res.json({
      summary: sessions.rows[0],
      events: events.rows
    });
  } catch (err) {
    console.error('[GET /restaurants/:slug/analytics]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: update restaurant profile ──────────────────────────────────────────
router.patch('/:slug', adminAuth, async (req, res) => {
  const { name, contactEmail, contactPhone, address, latitude, longitude, managerName } = req.body;
  try {
    const fields = [];
    const params = [req.params.slug];
    let i = 2;
    if (name !== undefined)        { fields.push(`name = $${i++}`);         params.push(name); }
    if (contactEmail !== undefined) { fields.push(`contact_email = $${i++}`); params.push(contactEmail || null); }
    if (contactPhone !== undefined) { fields.push(`contact_phone = $${i++}`); params.push(contactPhone || null); }
    if (address !== undefined)      { fields.push(`address = $${i++}`);       params.push(address || null); }
    if (latitude !== undefined)     { fields.push(`latitude = $${i++}`);      params.push(latitude || null); }
    if (longitude !== undefined)    { fields.push(`longitude = $${i++}`);     params.push(longitude || null); }
    if (managerName !== undefined)  { fields.push(`manager_name = $${i++}`); params.push(managerName || null); }
    fields.push(`updated_at = NOW()`);
    if (fields.length === 1) return res.status(400).json({ error: 'No fields to update' });

    const result = await db.query(
      `UPDATE restaurants SET ${fields.join(', ')} WHERE slug = $1
       RETURNING id, slug, name, plan, active, contact_email, contact_phone, address, latitude, longitude, manager_name, created_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PATCH /restaurants/:slug]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: deactivate a restaurant ────────────────────────────────────────────
router.patch('/:slug/deactivate', adminAuth, async (req, res) => {
  try {
    await db.query(
      `UPDATE restaurants SET active = false, updated_at = NOW() WHERE slug = $1`,
      [req.params.slug]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /restaurants/:slug/deactivate]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
