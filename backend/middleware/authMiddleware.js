const crypto = require('crypto');
const db = require('../db');

// In-memory or fallback secret. In production, process.env.JWT_SECRET should be defined.
const JWT_SECRET = process.env.JWT_SECRET || 'tabletalk_secure_secret_key_123';

/**
 * Signs a payload with HMAC SHA-256 and base64url encoding.
 * Returns a JWT-like token.
 */
function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64UrlHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  
  // Set default expiration: 24 hours
  const expiryPayload = {
    ...payload,
    exp: payload.exp || Math.floor(Date.now() / 1000) + (24 * 60 * 60)
  };
  const base64UrlPayload = Buffer.from(JSON.stringify(expiryPayload)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${base64UrlHeader}.${base64UrlPayload}`)
    .digest('base64url');
    
  return `${base64UrlHeader}.${base64UrlPayload}.${signature}`;
}

/**
 * Verifies the signature of the JWT-like token and parses its payload.
 * Returns the payload or null if invalid/expired.
 */
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  const [header, payload, signature] = parts;
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
    
  if (signature !== expectedSignature) {
    return null;
  }
  
  try {
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // Check expiration
    if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
      return null; // Expired
    }
    return decodedPayload;
  } catch (err) {
    return null;
  }
}

/**
 * Middleware to authenticate requests via the Authorization header (Bearer token).
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
  
  req.user = payload; // Contains: { id, email, role, restaurant_id }
  next();
}

/**
 * Middleware to restrict access based on user role.
 * @param {string[]} roles - Allowed roles (e.g. ['SUPER_ADMIN', 'RESTAURANT_ADMIN'])
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
}

/**
 * Middleware to ensure data isolation.
 * For RESTAURANT_ADMIN, validates that any request involving a restaurant_id matches the admin's restaurant_id.
 * If the user is SUPER_ADMIN, they bypass this check.
 */
function verifyTenantAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (req.user.role === 'SUPER_ADMIN') {
    return next(); // Super admin has global access
  }
  
  // Check parameters, query, and request body for restaurant_id or tenant id
  const requestRestaurantId = req.params.restaurant_id || req.body.restaurant_id || req.query.restaurant_id;
  
  if (requestRestaurantId && requestRestaurantId !== req.user.restaurant_id) {
    return res.status(403).json({ error: 'Access denied: data isolation violation' });
  }
  
  next();
}

module.exports = {
  signToken,
  verifyToken,
  authenticateToken,
  requireRole,
  verifyTenantAccess
};
