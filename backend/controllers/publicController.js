const db = require('../db');
const { signToken } = require('../middleware/authMiddleware');

/**
 * GET /api/public/handshake
 * Public handshake to validate restaurant status and table registration.
 * Query parameters: slug, table
 */
async function handshake(req, res) {
  const { slug, table } = req.query;

  if (!slug || !table) {
    return res.status(400).json({ error: 'Missing slug or table parameter' });
  }

  try {
    // 1. Query the restaurant
    const restResult = await db.query(
      'SELECT id, name, slug, billing_status FROM restaurants WHERE slug = $1',
      [slug]
    );

    if (restResult.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const restaurant = restResult.rows[0];

    // 2. Check billing status
    if (restaurant.billing_status !== 'active') {
      return res.status(403).json({ error: 'Service is temporarily undergoing maintenance' });
    }

    // 3. Check if table exists
    const tableResult = await db.query(
      'SELECT id, table_number FROM restaurant_tables WHERE restaurant_id = $1 AND table_number = $2',
      [restaurant.id, table]
    );

    if (tableResult.rows.length === 0) {
      return res.status(404).json({ error: 'Table not registered' });
    }

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

module.exports = {
  handshake
};
