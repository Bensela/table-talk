const crypto = require('crypto');
const db = require('../db');
const { signToken } = require('../middleware/authMiddleware');
const { geocodeAddress } = require('../services/geocodeService');
const { hashPassword } = require('./adminController');

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function logPublicAnalyticsEvent(eventType, eventData) {
  try {
    await db.query(
      `INSERT INTO analytics_events (event_type, event_data)
       VALUES ($1, $2)`,
      [eventType, eventData]
    );
  } catch (err) {
    console.error(`Public analytics event failed: ${eventType}`, err);
  }
}

async function getInviteByToken(token) {
  const tokenHash = hashInviteToken(token);
  const result = await db.query(
    `SELECT ri.id, ri.restaurant_id, ri.invite_email, ri.expires_at, ri.consumed_at,
            r.name, r.slug, r.contact_phone, r.address, r.latitude, r.longitude,
            r.manager_name, r.billing_status
     FROM restaurant_invites ri
     JOIN restaurants r ON r.id = ri.restaurant_id
     WHERE ri.token_hash = $1`,
    [tokenHash]
  );

  return result.rows[0] || null;
}

/**
 * GET /api/public/handshake
 * Public handshake to validate restaurant status and table registration.
 * Query parameters: slug, table
 */
async function handshake(req, res) {
  const { slug, table } = req.query;

  if (!slug || !table) {
    await logPublicAnalyticsEvent('qr_scan_rejected', {
      reason: 'missing_parameters',
      restaurant_slug: slug || null,
      table_number: table || null
    });
    return res.status(400).json({ error: 'Missing slug or table parameter' });
  }

  try {
    // 1. Query the restaurant
    const restResult = await db.query(
      'SELECT id, name, slug, billing_status, plan, trial_ends_at FROM restaurants WHERE slug = $1',
      [slug]
    );

    if (restResult.rows.length === 0) {
      await logPublicAnalyticsEvent('qr_scan_rejected', {
        reason: 'restaurant_not_found',
        restaurant_slug: slug,
        table_number: table
      });
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const restaurant = restResult.rows[0];

    // 2. Check billing status
    //    - Always allow billing_status = 'active'
    //    - Also allow billing_status = 'pending' for Trial restaurants (SA
    //      may provision Trial QRs before the invite-completion onboarding
    //      flips billing_status to 'active'). Trial validity is already
    //      bounded by trial_ends_at + plan = 'trial' only.
    const isTrialPending =
      restaurant.billing_status === 'pending' &&
      restaurant.plan === 'trial' &&
      restaurant.trial_ends_at &&
      new Date(restaurant.trial_ends_at).getTime() > Date.now();

    if (restaurant.billing_status !== 'active' && !isTrialPending) {
      await logPublicAnalyticsEvent('qr_scan_rejected', {
        reason: 'restaurant_inactive',
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        restaurant_name: restaurant.name,
        restaurant_billing_status: restaurant.billing_status,
        restaurant_plan: restaurant.plan,
        table_number: table
      });
      return res.status(403).json({ error: 'Service is temporarily undergoing maintenance' });
    }

    // 3. Check if table exists
    const tableResult = await db.query(
      'SELECT id, table_number FROM restaurant_tables WHERE restaurant_id = $1 AND table_number = $2',
      [restaurant.id, table]
    );

    if (tableResult.rows.length === 0) {
      await logPublicAnalyticsEvent('qr_scan_rejected', {
        reason: 'table_not_registered',
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        restaurant_name: restaurant.name,
        table_number: table
      });
      return res.status(404).json({ error: 'Table not registered' });
    }

    await logPublicAnalyticsEvent('qr_scan_validated', {
      restaurant_id: restaurant.id,
      restaurant_slug: restaurant.slug,
      restaurant_name: restaurant.name,
      table_number: table
    });

    // 4. Generate active session/handshake token
    const sessionToken = signToken({
      restaurant_id: restaurant.id,
      restaurant_slug: restaurant.slug,
      table_number: table,
      purpose: 'public_handshake'
    });

    res.json({
      restaurant_name: restaurant.name,
      restaurant_slug: restaurant.slug,
      table_number: table,
      branding: {
        logo_url: null,
        primary_color: '#06b6d4' // default beautiful cyan
      },
      session_token: sessionToken
    });
  } catch (err) {
    console.error('Handshake error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/public/restaurant-invites/:token
 * Validates a public restaurant onboarding invite.
 */
async function getRestaurantInvite(req, res) {
  const { token } = req.params;

  try {
    const invite = await getInviteByToken(token);
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (invite.consumed_at) {
      return res.status(410).json({ error: 'This invite has already been used' });
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This invite has expired' });
    }

    res.json({
      restaurant: {
        id: invite.restaurant_id,
        name: invite.name,
        slug: invite.slug,
        contact_email: invite.invite_email,
        contact_phone: invite.contact_phone,
        address: invite.address,
        latitude: invite.latitude,
        longitude: invite.longitude,
        manager_name: invite.manager_name,
        billing_status: invite.billing_status
      },
      invite: {
        expires_at: invite.expires_at
      }
    });
  } catch (err) {
    console.error('Get restaurant invite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/public/restaurant-invites/:token/complete
 * Completes restaurant onboarding and creates the restaurant admin user.
 */
async function completeRestaurantInvite(req, res) {
  const { token } = req.params;
  const { restaurantName, managerName, contactPhone, address, password } = req.body;

  const trimmedName = typeof restaurantName === 'string' ? restaurantName.trim() : '';
  const trimmedManagerName = typeof managerName === 'string' ? managerName.trim() : '';
  const trimmedAddress = typeof address === 'string' ? address.trim() : '';

  if (!trimmedName || !trimmedManagerName || !trimmedAddress || !password) {
    return res.status(400).json({
      error: 'Restaurant name, manager name, address, and password are required'
    });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const invite = await getInviteByToken(token);
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (invite.consumed_at) {
      return res.status(410).json({ error: 'This invite has already been used' });
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This invite has expired' });
    }

    const existingUser = await db.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [invite.invite_email]);
    if (existingUser.rowCount > 0) {
      return res.status(400).json({ error: 'This email already has an admin account' });
    }

    const geocoded = await geocodeAddress(trimmedAddress);
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    await db.query('BEGIN');

    const restaurantResult = await db.query(
      `UPDATE restaurants
       SET name = $1,
           manager_name = $2,
           contact_email = $3,
           contact_phone = $4,
           address = $5,
           latitude = $6,
           longitude = $7,
           billing_status = 'active',
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, name, slug, billing_status, contact_email, contact_phone,
                 address, latitude, longitude, manager_name`,
      [
        trimmedName,
        trimmedManagerName,
        invite.invite_email,
        contactPhone ? String(contactPhone).trim() : null,
        trimmedAddress,
        geocoded?.latitude ?? null,
        geocoded?.longitude ?? null,
        invite.restaurant_id
      ]
    );

    const restaurant = restaurantResult.rows[0];

    const userResult = await db.query(
      `INSERT INTO users (email, password_hash, role, restaurant_id)
       VALUES ($1, $2, 'RESTAURANT_ADMIN', $3)
       RETURNING id, email, role, restaurant_id`,
      [invite.invite_email, passwordHash, invite.restaurant_id]
    );

    await db.query(
      `UPDATE restaurant_invites
       SET consumed_at = NOW()
       WHERE id = $1`,
      [invite.id]
    );

    await db.query('COMMIT');

    const user = userResult.rows[0];
    const authToken = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      restaurant_id: user.restaurant_id
    });

    res.json({
      token: authToken,
      user: {
        ...user,
        restaurant_name: restaurant.name,
        restaurant_slug: restaurant.slug
      },
      restaurant
    });
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // Ignore rollback failures when the transaction did not start.
    }
    console.error('Complete restaurant invite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  handshake,
  getRestaurantInvite,
  completeRestaurantInvite
};
