// backend/middleware/resolveRestaurant.js
// Reads :restaurantSlug from params or restaurant_slug from body.
// Attaches req.restaurant for all downstream controllers.
// Multi-tenant flows require an explicit restaurant slug.

const db = require('../db');

const resolveRestaurant = async (req, res, next) => {
  const slug =
    req.params.restaurantSlug ||
    req.body?.restaurant_slug;

  if (!slug) {
    return res.status(400).json({ error: 'restaurant_slug is required for tenant QR flows' });
  }

  try {
    const result = await db.query(
      `SELECT id, slug, name, billing_status, contact_email, contact_phone,
              address, latitude, longitude, manager_name
       FROM restaurants
       WHERE slug = $1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Restaurant '${slug}' not found` });
    }

    const restaurant = result.rows[0];
    const isActive = restaurant.billing_status === 'active';

    if (!isActive) {
      return res.status(403).json({ error: 'Restaurant account is inactive' });
    }

    req.restaurant = {
      ...restaurant,
      active: isActive
    };
    next();
  } catch (err) {
    console.error('[resolveRestaurant] DB error:', err);
    next(err);
  }
};

module.exports = { resolveRestaurant };
