const crypto = require('crypto');
const db = require('../db');
const { signToken } = require('../middleware/authMiddleware');

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

/**
 * GET /api/admin/tenants
 * Super Admin: List all tenants (restaurants) with billing details.
 */
async function getTenants(req, res) {
  try {
    const result = await db.query(
      `SELECT id, name, slug, billing_status, created_at 
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
 * POST /api/admin/tenants
 * Super Admin: Register a new tenant. Optionally creates a tenant admin user.
 */
async function createTenant(req, res) {
  const { name, slug, adminEmail, adminPassword } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'Name and slug are required' });
  }

  try {
    // Check if slug is taken
    const slugCheck = await db.query('SELECT 1 FROM restaurants WHERE slug = $1', [slug]);
    if (slugCheck.rowCount > 0) {
      return res.status(400).json({ error: 'Slug is already in use' });
    }

    await db.query('BEGIN');

    const restResult = await db.query(
      `INSERT INTO restaurants (name, slug, billing_status) 
       VALUES ($1, $2, 'active') 
       RETURNING id, name, slug, billing_status, created_at`,
      [name, slug]
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
    await db.query('ROLLBACK');
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
  const { name, slug, billing_status } = req.body;

  try {
    const fields = [];
    const params = [id];
    let index = 2;

    if (name !== undefined) {
      fields.push(`name = $${index++}`);
      params.push(name);
    }
    if (slug !== undefined) {
      // Slug check
      const slugCheck = await db.query('SELECT 1 FROM restaurants WHERE slug = $1 AND id != $2', [slug, id]);
      if (slugCheck.rowCount > 0) {
        return res.status(400).json({ error: 'Slug is already in use' });
      }
      fields.push(`slug = $${index++}`);
      params.push(slug);
    }
    if (billing_status !== undefined) {
      if (!['active', 'suspended'].includes(billing_status)) {
        return res.status(400).json({ error: 'Invalid billing status' });
      }
      fields.push(`billing_status = $${index++}`);
      params.push(billing_status);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const result = await db.query(
      `UPDATE restaurants 
       SET ${fields.join(', ')} 
       WHERE id = $1 
       RETURNING id, name, slug, billing_status, created_at`,
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
 * PATCH /api/admin/questions/reshuffle
 * Super Admin: Bulk update 'sort_order' of Global Questions (restaurant_id IS NULL)
 */
async function reshuffleGlobalQuestions(req, res) {
  const { question_ids } = req.body; // Array of UUIDs in desired order
  if (!Array.isArray(question_ids)) {
    return res.status(400).json({ error: 'question_ids array is required' });
  }

  try {
    await db.query('BEGIN');
    for (let i = 0; i < question_ids.length; i++) {
      await db.query(
        `UPDATE questions 
         SET sort_order = $1 
         WHERE id = $2 AND restaurant_id IS NULL`,
        [i, question_ids[i]]
      );
    }
    await db.query('COMMIT');
    res.json({ message: 'Global questions reshuffled successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Reshuffle global questions error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
      `SELECT id, name, slug, billing_status, created_at 
       FROM restaurants 
       WHERE id = $1`,
      [restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get tenant billing error:', err);
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

    // Generate table public session QR URL
    // Format: https://tabletalk.app/r/[slug]?table=[number]
    const qr_code_url = `https://tabletalk.app/r/${slug}?table=${encodeURIComponent(table_number)}`;

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

module.exports = {
  login,
  getTenants,
  createTenant,
  updateTenant,
  reshuffleGlobalQuestions,
  getTenantBilling,
  getTenantTables,
  createTenantTable,
  hashPassword // Exported for potential test usage
};
