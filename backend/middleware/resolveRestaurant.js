// backend/middleware/resolveRestaurant.js
// Reads :restaurantSlug from params or restaurant_slug from body.
// Attaches req.restaurant for all downstream controllers.
// Falls back to 'default' for legacy QR codes with no slug.

const db = require('../db');

const resolveRestaurant = async (req, res, next) => {
  const slug =
    req.params.restaurantSlug ||
    req.body?.restaurant_slug ||
    'default';

  try {
    const result = await db.query(
      `SELECT id, slug, name, plan, active, contact_email, contact_phone,
              address, latitude, longitude, manager_name
       FROM restaurants
       WHERE slug = $1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Restaurant '${slug}' not found` });
    }

    const restaurant = result.rows[0];

    if (!restaurant.active) {
      return res.status(403).json({ error: 'Restaurant account is inactive' });
    }

    req.restaurant = restaurant;
    next();
  } catch (err) {
    console.error('[resolveRestaurant] DB error:', err);
    next(err);
  }
};

module.exports = { resolveRestaurant };
