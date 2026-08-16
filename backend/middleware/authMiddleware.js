const crypto = require('crypto');
const db = require('../db');

// In-memory or fallback secret. In production, process.env.JWT_SECRET should be defined.
const JWT_SECRET = process.env.JWT_SECRET || 'tabletalk_secure_secret_key_123';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[auth] WARNING: JWT_SECRET env var is not set in production — using unsafe fallback. Set JWT_SECRET immediately.');
}

const TOKEN_ERRORS = {
  TOKEN_REQUIRED: 'TOKEN_REQUIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED'
};

// Expiry presets (seconds). Shorter admin sessions for better security.
const TOKEN_TTL = {
  SUPER_ADMIN: 8 * 60 * 60,      // 8 hours
  RESTAURANT_ADMIN: 8 * 60 * 60, // 8 hours
  DEFAULT: 12 * 60 * 60          // 12 hours fallback (never used for admin logins)
};

// -----------------------------------------------------------------------------
// Login attempt rate limiter (in-memory, per-email + per-IP dual tracking)
// -----------------------------------------------------------------------------
const LOGIN_RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000,   // 15 minute window
  MAX_PER_EMAIL: 10,           // 10 attempts per email in window
  MAX_PER_IP: 30               // 30 attempts per IP in window
};
const rateLimitState = {
  byEmail: new Map(),   // lower(email) -> [{ts}]
  byIp: new Map()       // ip -> [{ts}]
};
function pruneWindow(arr, nowMs) {
  const cutoff = nowMs - LOGIN_RATE_LIMIT.WINDOW_MS;
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  return i > 0 ? arr.slice(i) : arr;
}
function applyLoginRateLimit(email, ip) {
  const now = Date.now();
  const keyE = (email || '').toString().trim().toLowerCase();
  const keyI = (ip || 'unknown').toString();
  const arrE = pruneWindow(rateLimitState.byEmail.get(keyE) || [], now);
  const arrI = pruneWindow(rateLimitState.byIp.get(keyI) || [], now);
  if (arrE.length >= LOGIN_RATE_LIMIT.MAX_PER_EMAIL ||
      arrI.length >= LOGIN_RATE_LIMIT.MAX_PER_IP) {
    return { blocked: true, retryAfterMs: LOGIN_RATE_LIMIT.WINDOW_MS - (now - (arrE[0] || arrI[0] || now)) };
  }
  arrE.push(now);
  arrI.push(now);
  rateLimitState.byEmail.set(keyE, arrE);
  rateLimitState.byIp.set(keyI, arrI);
  return { blocked: false };
}
function resetLoginRateLimit(email, ip) {
  if (email) rateLimitState.byEmail.delete(email.toString().trim().toLowerCase());
  if (ip) rateLimitState.byIp.delete(ip.toString());
}

// -----------------------------------------------------------------------------
// JWT sign + verify (HMAC SHA-256, base64url)
// -----------------------------------------------------------------------------
function signToken(payload, overrides = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64UrlHeader = Buffer.from(JSON.stringify(header)).toString('base64url');

  const iat = Math.floor(Date.now() / 1000);
  const role = String(payload?.role || '').toUpperCase();
  const ttlSeconds = overrides.expiresInSeconds ||
    TOKEN_TTL[role] ||
    payload?.expiresInSeconds ||
    TOKEN_TTL.DEFAULT;
  const jti = overrides.jti || crypto.randomBytes(8).toString('hex');
  const nbf = overrides.notBefore || iat;

  const expiryPayload = {
    ...payload,
    iat,
    nbf,
    jti,
    exp: overrides.exp ? Number(overrides.exp) : iat + ttlSeconds
  };
  const base64UrlPayload = Buffer.from(JSON.stringify(expiryPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${base64UrlHeader}.${base64UrlPayload}`)
    .digest('base64url');

  return `${base64UrlHeader}.${base64UrlPayload}.${signature}`;
}

/**
 * Verifies a JWT-like token and returns { payload } or { error, error_code }.
 */
function verifyTokenDetailed(token) {
  if (!token) {
    return { error: 'Access token required', error_code: TOKEN_ERRORS.TOKEN_REQUIRED };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { error: 'Invalid token', error_code: TOKEN_ERRORS.TOKEN_INVALID };
  }

  const [header, payload, signature] = parts;

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (!crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )) {
    return { error: 'Invalid token signature', error_code: TOKEN_ERRORS.TOKEN_INVALID };
  }

  try {
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    // Not before check
    if (decodedPayload.nbf && now < decodedPayload.nbf) {
      return { error: 'Token not yet valid', error_code: TOKEN_ERRORS.TOKEN_INVALID };
    }
    // Expiration check
    if (decodedPayload.exp && now > decodedPayload.exp) {
      return { error: 'Token has expired', error_code: TOKEN_ERRORS.TOKEN_EXPIRED };
    }
    // Required claims check
    if (!decodedPayload.id || !decodedPayload.role) {
      return { error: 'Token missing required claims', error_code: TOKEN_ERRORS.TOKEN_INVALID };
    }
    return { payload: decodedPayload };
  } catch (err) {
    return { error: 'Malformed token payload', error_code: TOKEN_ERRORS.TOKEN_INVALID };
  }
}

// Backward compatible wrapper — returns payload or null
function verifyToken(token) {
  const result = verifyTokenDetailed(token);
  return result?.payload || null;
}

// Client-side helper (used by frontend) — decode ONLY, without signature check.
// Exported for the frontend to be able to check `exp` without a round-trip.
function decodeTokenPayloadUnsafe(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Middleware to authenticate requests via the Authorization header (Bearer token).
 * Sends 401 with explicit error_code so the frontend can auto-redirect on expiry.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required', error_code: TOKEN_ERRORS.TOKEN_REQUIRED });
  }

  const result = verifyTokenDetailed(token);
  if (!result.payload) {
    const statusCode = result.error_code === TOKEN_ERRORS.TOKEN_EXPIRED ? 401 : 401;
    return res.status(statusCode).json({ error: result.error, error_code: result.error_code });
  }

  req.user = result.payload; // Contains: { id, email, role, restaurant_id, iat, exp, jti }
  next();
}

/**
 * Middleware to restrict access based on user role.
 * @param {string[]} roles - Allowed roles (e.g. ['SUPER_ADMIN', 'RESTAURANT_ADMIN'])
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions', error_code: 'ROLE_DENIED' });
    }
    next();
  };
}

/**
 * Middleware to ensure data isolation.
 * For RESTAURANT_ADMIN, validates that any request involving a restaurant_id matches the admin's restaurant_id.
 */
function verifyTenantAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', error_code: TOKEN_ERRORS.TOKEN_REQUIRED });
  }

  if (req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  const requestRestaurantId = req.params.restaurant_id || req.body.restaurant_id || req.query.restaurant_id;

  if (requestRestaurantId && String(requestRestaurantId) !== String(req.user.restaurant_id)) {
    return res.status(403).json({ error: 'Access denied: data isolation violation', error_code: 'ROLE_DENIED' });
  }

  next();
}

module.exports = {
  TOKEN_ERRORS,
  TOKEN_TTL,
  signToken,
  verifyToken,
  verifyTokenDetailed,
  decodeTokenPayloadUnsafe,
  authenticateToken,
  requireRole,
  verifyTenantAccess,
  applyLoginRateLimit,
  resetLoginRateLimit
};

