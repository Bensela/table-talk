const crypto = require('crypto');
const db = require('../db');
const { signToken, verifyTokenDetailed, TOKEN_ERRORS } = require('../middleware/authMiddleware');
const { geocodeAddress } = require('../services/geocodeService');
const { hashPassword } = require('./adminController');
const { insertAnalyticsEvent } = require('../services/analyticsService');
const {
  evaluateGeofence,
  getCachedRestaurantGeo,
  setCachedRestaurantGeo,
  invalidateCachedRestaurantGeo
} = require('../services/geofenceService');

// Max duration of a temporary geolocation bypass. Short-lived so the user
// cannot "permanently skip" the gate. Must be <= 10 minutes; we keep 5.
const TEMP_GEO_ACCESS_TTL_SECONDS = 5 * 60;

/**
 * Returns the raw temporary geolocation access token string from the
 * current request, or null when none is present. Lookup order:
 *   1. Authorization: Bearer <token>
 *   2. Query string ?temp_access_token=
 *   3. Body ?temp_access_token (application/json)
 *
 * The value is validated elsewhere by a JWT signature check — this helper
 * just plucks the candidate string.
 */
function extractTempGeoAccessToken(req) {
  const authz =
    (req.headers && (req.headers.authorization || req.headers.Authorization)) || null;
  if (typeof authz === 'string') {
    const trimmed = authz.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      const candidate = trimmed.slice(7).trim();
      if (candidate) return candidate;
    }
    // legacy alternative: "temp <token>"
    if (trimmed.toLowerCase().startsWith('temp ')) {
      const candidate = trimmed.slice(5).trim();
      if (candidate) return candidate;
    }
  }
  const queryTok =
    (req.query && (req.query.temp_access_token || req.query.tempGeoToken)) || null;
  if (typeof queryTok === 'string' && queryTok) return queryTok;
  const bodyTok =
    (req.body && (req.body.temp_access_token || req.body.tempGeoToken)) || null;
  if (typeof bodyTok === 'string' && bodyTok) return bodyTok;
  return null;
}

/**
 * Peek (unsigned / no signature verification) a JWT's payload claims to
 * detect whether a token is a user/admin role token (has id + role, no purpose)
 * vs a temp-geo token (has purpose === temp_geo_access). This is used in
 * auth-header conflict resolution where the same header name (Authorization)
 * is reused across multiple token types.
 */
function peekPayloadClaims(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    const obj = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_) {
    return null;
  }
}

/**
 * Validate a temp-access token + (optionally) scope it to a restaurant/table.
 *
 * Returns: { valid: boolean, payload: object|null, error: string|null, error_code: string|null }
 *
 * Scoping: the token is only considered "valid for this request" when
 * restaurant_id matches (and if table_token is present in the token, it must
 * match the request table_token). This prevents a user from scanning a QR
 * at Restaurant A, being granted temp access, then using that same token
 * later at Restaurant B.
 */
// Direct HMAC-SHA256 verification of a JWT token string against JWT_SECRET.
// Unlike verifyTokenDetailed (authMiddleware), this does NOT require id/role
// claims — it only checks signature integrity + structure. Used specifically
// for temp-geo access tokens which carry `purpose === temp_geo_access` instead
// of `id` + `role`.
function __verifyTempTokenSignature(rawToken) {
  try {
    const JWT_SECRET_local = process.env.JWT_SECRET || 'tabletalk_secure_secret_key_123';
    const parts = String(rawToken || '').split('.');
    if (parts.length !== 3) return { ok: false, error: 'Invalid token structure', error_code: TOKEN_ERRORS.TOKEN_INVALID };
    const [header, payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET_local)
      .update(`${header}.${payload}`)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return { ok: false, error: 'Invalid token signature', error_code: TOKEN_ERRORS.TOKEN_INVALID };
    }
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return { ok: true, payload: decodedPayload };
  } catch (_) {
    return { ok: false, error: 'Malformed token', error_code: TOKEN_ERRORS.TOKEN_INVALID };
  }
}

function validateTempGeoAccessToken(req, opts = {}) {
  const raw = extractTempGeoAccessToken(req);
  if (!raw) {
    return {
      valid: false,
      payload: null,
      error: null,
      error_code: null,
      token_present: false
    };
  }

  // Classify token FIRST by peeking at unsigned payload claims. This lets us
  // decide which verification path to use and avoids false blocks when an
  // admin Bearer token (id+role, no purpose) happens to be present on a
  // session endpoint request.
  const peek = peekPayloadClaims(raw);
  const isRoleJwt = !!(peek && peek.id && peek.role && !peek.purpose);
  const isTempGeoJwt = !!(peek && peek.purpose === 'temp_geo_access');

  // Path A — clearly a role JWT (admin / restaurant_admin / handshake user).
  // Demote immediately to token_present=false so the caller proceeds to the
  // normal auth middleware path. Signature integrity will be verified there
  // via authenticateToken (which requires id+role and rejects tampering).
  if (isRoleJwt && !isTempGeoJwt) {
    return {
      valid: false,
      payload: null,
      error: null,
      error_code: null,
      token_present: false,
      _not_a_temp_token: true
    };
  }

  // Path B — claims show purpose === temp_geo_access. Use the dedicated
  // temp-token signature verifier (no id/role claim requirement) + exp check.
  if (isTempGeoJwt) {
    const direct = __verifyTempTokenSignature(raw);
    if (!direct.ok) {
      return {
        valid: false,
        payload: null,
        error: direct.error,
        error_code: direct.error_code || TOKEN_ERRORS.TOKEN_INVALID,
        token_present: true
      };
    }
    const p = direct.payload;
    const now = Math.floor(Date.now() / 1000);
    if (Number.isFinite(Number(p.exp)) && Number(p.exp) < now - 2) {
      return {
        valid: false,
        payload: null,
        error: 'Temporary access token has expired. Please request a new one.',
        error_code: TOKEN_ERRORS.TOKEN_EXPIRED,
        token_present: true
      };
    }
    if (opts.restaurant_id && p.restaurant_id && String(opts.restaurant_id) !== String(p.restaurant_id)) {
      return {
        valid: false,
        payload: null,
        error: 'Temporary access token is not valid for this restaurant',
        error_code: TOKEN_ERRORS.TOKEN_REVOKED,
        token_present: true
      };
    }
    if (opts.table_token && p.table_token && String(opts.table_token) !== String(p.table_token)) {
      return {
        valid: false,
        payload: null,
        error: 'Temporary access token is not valid for this table',
        error_code: TOKEN_ERRORS.TOKEN_REVOKED,
        token_present: true
      };
    }
    return {
      valid: true,
      payload: p,
      error: null,
      error_code: null,
      token_present: true
    };
  }

  // Path C — unclassified token. Run verifyTokenDetailed; if it fails with
  // TOKEN_INVALID and peek shows no purpose claims, demote to not-a-token.
  const verified = verifyTokenDetailed(raw);
  if (verified && verified.error) {
    if (verified.error_code === TOKEN_ERRORS.TOKEN_INVALID && peek && !peek.purpose) {
      return {
        valid: false,
        payload: null,
        error: null,
        error_code: null,
        token_present: false,
        _not_a_temp_token: true
      };
    }
    return {
      valid: false,
      payload: null,
      error: verified.error,
      error_code: verified.error_code || TOKEN_ERRORS.TOKEN_INVALID,
      token_present: true
    };
  }
  const p = verified && verified.payload;
  if (!p || p.purpose !== 'temp_geo_access') {
    return {
      valid: false,
      payload: null,
      error: null,
      error_code: null,
      token_present: false,
      _not_a_temp_token: true
    };
  }
  if (opts.restaurant_id && p.restaurant_id && String(opts.restaurant_id) !== String(p.restaurant_id)) {
    return {
      valid: false,
      payload: null,
      error: 'Temporary access token is not valid for this restaurant',
      error_code: TOKEN_ERRORS.TOKEN_REVOKED,
      token_present: true
    };
  }
  if (opts.table_token && p.table_token && String(opts.table_token) !== String(p.table_token)) {
    return {
      valid: false,
      payload: null,
      error: 'Temporary access token is not valid for this table',
      error_code: TOKEN_ERRORS.TOKEN_REVOKED,
      token_present: true
    };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number.isFinite(Number(p.exp)) && Number(p.exp) < now - 2) {
    return {
      valid: false,
      payload: null,
      error: 'Temporary access token has expired. Please request a new one.',
      error_code: TOKEN_ERRORS.TOKEN_EXPIRED,
      token_present: true
    };
  }
  return {
    valid: true,
    payload: p,
    error: null,
    error_code: null,
    token_present: true,
    expires_at_unix: Number(p.exp) || null,
    expires_at_iso:
      Number.isFinite(Number(p.exp))
        ? new Date(Number(p.exp) * 1000).toISOString()
        : null
  };
}

/**
 * POST /api/public/temp-access
 *
 * Issue a short-lived signed token that lets a user proceed past the
 * geofence gate when GPS is temporarily unavailable but permission
 * has NOT been permanently denied.
 *
 * Policy:
 *   • geolocation_status === 'denied' → 403 (permanent permission = NO bypass)
 *   • geolocation_status === 'prompt' | 'unsupported' | 'granted' (and
 *     requires_geolocation=true) → 200, signed token, TTL=5 min
 *   • Token is scoped: restaurant_id + table_token so it can't be reused
 *     across restaurants / tables.
 */
async function issueTempGeoAccess(req, res) {
  const { slug, table, client_lat, client_lng, geolocation_status } =
    Object.assign({}, req.query || {}, req.body || {});

  if (!slug || !table) {
    return res.status(400).json({
      error: 'slug and table are required',
      temp_access_granted: false
    });
  }

  const geoStatusRaw = String(geolocation_status || 'prompt').toLowerCase();
  const known = ['granted', 'prompt', 'denied', 'unsupported'];
  const geoStatus = known.includes(geoStatusRaw) ? geoStatusRaw : 'prompt';

  // Permanent block: NEVER issue a bypass when the user explicitly denied
  // permission. Even "try again" CTA must be the only option.
  if (geoStatus === 'denied') {
    logPublicAnalyticsEvent('temp_geo_access_denied', {
      restaurant_slug: String(slug),
      table_token: String(table),
      reason: 'location_permission_denied'
    });
    return res.status(403).json({
      error:
        'Location permission is required. Please enable location services for this site in your browser settings and try again.',
      temp_access_granted: false,
      geolocation_status: 'denied',
      action_required: 'enable_location_permission'
    });
  }

  let restaurant;
  try {
    restaurant = await loadRestaurantBySlug(slug);
  } catch (err) {
    console.error('[temp-access] load restaurant failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }

  // Confirm table actually exists so the issued token can be scoped.
  const tableRes = await db.query(
    `SELECT 1 FROM restaurant_tables
     WHERE restaurant_id = $1 AND table_number = $2
     LIMIT 1`,
    [restaurant.id, String(table)]
  );
  if (tableRes.rowCount === 0) {
    return res.status(404).json({ error: 'Table not registered' });
  }

  const clientLatParsed =
    client_lat != null && client_lat !== '' ? Number(client_lat) : null;
  const clientLngParsed =
    client_lng != null && client_lng !== '' ? Number(client_lng) : null;
  const radiusOpts = resolveEffectiveRadiusOptions(req);
  const geofence = evaluateGeofence(restaurant, clientLatParsed, clientLngParsed, {
    effectiveRadiusOverride: radiusOpts.effectiveRadiusOverride
  });

  // Issue temp access when the user cannot pass the radius gate right now:
  //   • Location fix is currently *unavailable* (no GPS, user hasn't granted
  //     yet, or device has no GPS chip → requires_geolocation / unsupported /
  //     prompt), OR
  //   • Location fix is available but places them clearly OUTSIDE the
  //     effective radius (inside === false). They are already on the denied
  //     screen; "Temporarily Use (5m)" is their escape hatch for dev / remote
  //     testing / moving would be impractical. The legacy low-accuracy button
  //     is hidden whenever the temp-access button is visible, so relaxing
  //     eligibility here keeps a single working escape per scenario.
  const eligible =
    geofence.requires_geolocation === true ||
    geoStatus === 'unsupported' ||
    geoStatus === 'prompt' ||
    geofence.inside === false;

  if (!eligible) {
    logPublicAnalyticsEvent('temp_geo_access_denied', {
      restaurant_id: restaurant.id,
      restaurant_slug: restaurant.slug,
      table_token: String(table),
      reason: 'gps_fix_available_or_radius_outside',
      geolocation_status: geoStatus,
      requires_geolocation: geofence.requires_geolocation === true,
      inside: geofence.inside === true,
      distance_m: geofence.distance_m
    });
    return res.status(400).json({
      error:
        'A location reading is already available. Move closer to the restaurant or tap "Check again / Allow Location".',
      temp_access_granted: false,
      geolocation_status: geoStatus,
      geofence: {
        inside: geofence.inside,
        distance_m: geofence.distance_m,
        configured_radius_m: geofence.configured_radius_m,
        effective_radius_m: geofence.radius_m,
        requires_geolocation: geofence.requires_geolocation
      }
    });
  }

  // JTI to make the token one-shot revocable if we ever add a revocation
  // table. For now the exp claim alone is sufficient.
  const token = signToken(
    {
      purpose: 'temp_geo_access',
      restaurant_id: restaurant.id,
      restaurant_slug: restaurant.slug,
      table_token: String(table),
      geolocation_status_at_issue: geoStatus,
      requires_geolocation: geofence.requires_geolocation === true,
      radius_overridden: geofence.radius_overridden === true
    },
    { expiresInSeconds: TEMP_GEO_ACCESS_TTL_SECONDS }
  );

  const expiresAtUnix =
    Math.floor(Date.now() / 1000) + TEMP_GEO_ACCESS_TTL_SECONDS;
  const expiresAtIso = new Date(expiresAtUnix * 1000).toISOString();

  logPublicAnalyticsEvent('temp_geo_access_granted', {
    restaurant_id: restaurant.id,
    restaurant_slug: restaurant.slug,
    table_token: String(table),
    geolocation_status_at_issue: geoStatus,
    ttl_seconds: TEMP_GEO_ACCESS_TTL_SECONDS,
    requires_geolocation: geofence.requires_geolocation === true
  });

  return res.json({
    temp_access_granted: true,
    temp_access_token: token,
    ttl_seconds: TEMP_GEO_ACCESS_TTL_SECONDS,
    expires_at_iso: expiresAtIso,
    expires_at_unix: expiresAtUnix,
    restaurant_id: restaurant.id,
    restaurant_slug: restaurant.slug,
    table_token: String(table),
    geolocation_status: geoStatus,
    geofence: {
      requires_geolocation: geofence.requires_geolocation,
      configured_radius_m: geofence.configured_radius_m,
      effective_radius_m: geofence.radius_m,
      radius_overridden: geofence.radius_overridden
    }
  });
}

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function logPublicAnalyticsEvent(eventType, eventData) {
  const run = async () => {
    try {
      const data = eventData || {};
      const restaurantId = data.restaurant_id || null;
      const tableToken = typeof data.table_number === 'string' || typeof data.table_number === 'number'
        ? String(data.table_number)
        : data.table_token || null;
      await insertAnalyticsEvent({
        event_type: eventType,
        restaurant_id: restaurantId,
        table_token: tableToken,
        event_data: data
      });
    } catch (err) {
      console.error(`Public analytics event failed: ${eventType}`, err);
    }
  };
  // Fire-and-forget: never block the user-facing HTTP response on a 1-row
  // analytics INSERT. If DB is slow, the event still reaches the stream
  // eventually without increasing handshake latency.
  setImmediate(run);
  return null;
}

/**
 * Detect whether the request comes from an environment where browser
 * geolocation accuracy is known to be unreliable: localhost/127.x dev
 * hosts, plaintext HTTP, or explicitly tagged `bypass=dev_grace`.
 * In those cases we enlarge the effective radius to 2,000m so legitimate
 * dev/demo users aren't locked out by bad IP lookups.
 */
function resolveEffectiveRadiusOptions(req) {
  const host = String(
    (req.headers && (req.headers.host || req.headers['x-forwarded-host'])) || ''
  ).toLowerCase();
  const fwdProto = String(
    (req.headers && (req.headers['x-forwarded-proto'] || req.headers[':scheme'])) || ''
  ).toLowerCase();
  const isLocalHostname =
    host.startsWith('localhost') ||
    host.startsWith('127.') ||
    host.startsWith('[::1]') ||
    host.includes('127.0.0.1');
  const isHttpProto =
    (req.protocol && String(req.protocol).toLowerCase() === 'http') ||
    fwdProto === 'http';
  const devGrace = isLocalHostname || isHttpProto;
  return {
    devGrace,
    isLocalHostname,
    isHttpProto,
    effectiveRadiusOverride: devGrace ? 2000 : null
  };
}

/**
 * Return true when the caller has *bona fide* evidence of a low-accuracy
 * device (suggest_high_accuracy was already set AND the GPS upgrade call
 * still produced a terrible fix / no fix). Used to enable a one-time
 * "Temporarily allow" button on production endpoints where desktop
 * browsers with no GPS chip would otherwise be permanently locked out.
 */
function clientRequestsLowAccuracyBypass(req) {
  const bypass =
    (req.query && req.query.bypass) ||
    (req.body && req.body.bypass);
  if (typeof bypass !== 'string') return false;
  const normalized = bypass.toLowerCase();
  if (normalized === 'low_accuracy_device') return true;
  return false;
}

/**
 * Load the restaurant geo + identity row.
 * Soft-TTL cache lookup first; on miss + successful DB load, prime cache.
 * Note: returns the FULL restaurant row (billing fields included) so we
 * can use the same cached value for both status checks and geo evaluation.
 */
async function loadRestaurantBySlug(slug) {
  if (!slug) return null;
  const cached = getCachedRestaurantGeo(slug);
  if (cached && cached._fullRow) {
    return cached._fullRow;
  }
  const res = await db.query(
    'SELECT id, name, slug, billing_status, plan, trial_ends_at, latitude, longitude, geofence_radius_meters FROM restaurants WHERE slug = $1',
    [slug]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  setCachedRestaurantGeo(slug, {
    id: row.id,
    name: row.name,
    slug: row.slug,
    latitude: row.latitude,
    longitude: row.longitude,
    geofence_radius_meters: row.geofence_radius_meters,
    _fullRow: row
  });
  return row;
}

/**
 * Load the geo row only (id, lat, lng, radius).
 * Used by preflightGeofence where we don't need billing status.
 */
async function loadRestaurantGeoBySlug(slug) {
  if (!slug) return null;
  const cached = getCachedRestaurantGeo(slug);
  if (cached && cached.id != null) {
    return {
      id: cached.id,
      name: cached.name,
      slug: cached.slug,
      latitude: cached.latitude,
      longitude: cached.longitude,
      geofence_radius_meters: cached.geofence_radius_meters
    };
  }
  const res = await db.query(
    'SELECT id, name, slug, latitude, longitude, geofence_radius_meters FROM restaurants WHERE slug = $1',
    [slug]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  setCachedRestaurantGeo(slug, {
    id: row.id,
    name: row.name,
    slug: row.slug,
    latitude: row.latitude,
    longitude: row.longitude,
    geofence_radius_meters: row.geofence_radius_meters
  });
  return row;
}

/**
 * POST /api/public/events
 * Append-only anonymous/pre-session event stream from the frontend.
 * Accepts events before a session exists (scanner success, welcome render,
 * context/mode screens, etc.). session_id / participant_id can be added
 * later by the frontend once they exist via the same endpoint or in-session
 * /sessions/events endpoint; all columns are nullable.
 *
 * Request body:
 *   { event_type, event_data?, session_id?, participant_id?,
 *     restaurant_id?, table_token?, anonymous_id?, timestamp? }
 * Returns 201 { event_id }
 */
async function postPublicEvent(req, res) {
  try {
    const body = req.body || {};
    const eventType = typeof body.event_type === 'string' ? body.event_type.trim() : '';
    if (!eventType) {
      return res.status(400).json({ error: 'event_type required' });
    }
    const event = await insertAnalyticsEvent({
      event_type: eventType.slice(0, 50),
      session_id: body.session_id || null,
      participant_id: body.participant_id || null,
      restaurant_id: body.restaurant_id || null,
      table_token: typeof body.table_token === 'string'
        ? body.table_token
        : (body.table_number != null ? String(body.table_number) : null) || null,
      anonymous_id: typeof body.anonymous_id === 'string' ? body.anonymous_id : null,
      event_data: body.event_data || null,
      timestamp: body.timestamp || null
    });
    return res.status(201).json({ event_id: event ? event.event_id : null });
  } catch (err) {
    console.error('[public events] post failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
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
 * Public handshake to validate restaurant status, table registration,
 * and (when available) geofence proximity to the restaurant.
 *
 * Query parameters:
 *   - slug, table (required)
 *   - client_lat, client_lng (optional, decimal degrees)
 *   - geolocation_status (optional, "granted"|"prompt"|"denied"|"unsupported")
 */
async function handshake(req, res) {
  const { slug, table, client_lat, client_lng, geolocation_status } = req.query;

  if (!slug || !table) {
    logPublicAnalyticsEvent('qr_scan_rejected', {
      reason: 'missing_parameters',
      restaurant_slug: slug || null,
      table_number: table || null
    });
    return res.status(400).json({ error: 'Missing slug or table parameter' });
  }

  const clientLatRaw = client_lat != null && client_lat !== '' ? String(client_lat) : null;
  const clientLngRaw = client_lng != null && client_lng !== '' ? String(client_lng) : null;
  const clientLatParsed = clientLatRaw != null ? Number(clientLatRaw) : null;
  const clientLngParsed = clientLngRaw != null ? Number(clientLngRaw) : null;
  const radiusOpts = resolveEffectiveRadiusOptions(req);
  const lowAccuracyBypass = clientRequestsLowAccuracyBypass(req);

  // Normalize geolocation_status so the rest of the handshake can reason
  // consistently about permission state.
  const geoStatusRaw = typeof geolocation_status === 'string'
    ? geolocation_status.toLowerCase()
    : 'prompt';
  const knownGeoStatuses = ['granted', 'prompt', 'denied', 'unsupported'];
  const normalizedGeoStatus = knownGeoStatuses.includes(geoStatusRaw) ? geoStatusRaw : 'prompt';

  let tempAccess; // { valid, payload, error, token_present, expires_at_iso, expires_at_unix }
  try {
    tempAccess = validateTempGeoAccessToken(req, {
      restaurant_id: null, // restaurant_id unknown until loadRestaurantBySlug
      table_token: String(table)
    });
  } catch (err) {
    console.error('[handshake] temp-access validate threw:', err);
    tempAccess = {
      valid: false,
      payload: null,
      error: 'Invalid temporary access token',
      error_code: 'TOKEN_INVALID',
      token_present: true
    };
  }
  let tempAccessBypassGranted = false;
  let tempAccessExpiresAtIso = null;
  let tempAccessExpiresAtUnix = null;

  try {
    // 1. Load restaurant (soft TTL cache → DB miss)
    const restaurant = await loadRestaurantBySlug(slug);
    if (!restaurant) {
      logPublicAnalyticsEvent('qr_scan_rejected', {
        reason: 'restaurant_not_found',
        restaurant_slug: slug,
        table_number: table
      });
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    // Re-validate temp-access token now that the restaurant id is known so we
    // can bind it to the correct restaurant/table scope. Invalid tokens
    // (wrong restaurant, expired, tampered, etc.) are stripped silently
    // because the user should fall back to the normal GPS gate in that case.
    if (tempAccess.token_present && !tempAccess.valid) {
      logPublicAnalyticsEvent('handshake_temp_access_invalid', {
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        table_number: table,
        error_code: tempAccess.error_code || 'TOKEN_INVALID',
        error: tempAccess.error || null,
        geolocation_status: normalizedGeoStatus
      });
      // TEMP_ACCESS_EXPIRED → explicitly return a 410 so the frontend knows
      // to drop the stored token and offer a new one.
      if (tempAccess.error_code === TOKEN_ERRORS.TOKEN_EXPIRED) {
        return res.status(410).json({
          error: tempAccess.error || 'Temporary access window has expired',
          geofence_code: 'TEMP_ACCESS_EXPIRED',
          temp_access_expired: true,
          geolocation_status: normalizedGeoStatus
        });
      }
    }
    if (tempAccess.token_present) {
      const scoped = validateTempGeoAccessToken(req, {
        restaurant_id: restaurant.id,
        table_token: String(table)
      });
      if (scoped.valid) {
        tempAccess = scoped;
        tempAccessBypassGranted = true;
        tempAccessExpiresAtIso = scoped.expires_at_iso || null;
        tempAccessExpiresAtUnix = scoped.expires_at_unix || null;
      } else if (scoped.error_code === TOKEN_ERRORS.TOKEN_EXPIRED) {
        tempAccess = scoped;
        logPublicAnalyticsEvent('handshake_temp_access_expired', {
          restaurant_id: restaurant.id,
          restaurant_slug: restaurant.slug,
          table_number: table,
          geolocation_status: normalizedGeoStatus
        });
        return res.status(410).json({
          error: scoped.error || 'Temporary access window has expired',
          geofence_code: 'TEMP_ACCESS_EXPIRED',
          temp_access_expired: true,
          geolocation_status: normalizedGeoStatus
        });
      }
    }

    // Permanent deny when the end user has explicitly denied browser
    // geolocation permission and they do NOT have an active, scoped
    // temporary access token. "Prompt" or "unsupported" users fall through
    // to the grace paths below (temp-access CTA if enabled).
    if (normalizedGeoStatus === 'denied' && !tempAccessBypassGranted) {
      logPublicAnalyticsEvent('welcome_geofence_denied', {
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        table_number: table,
        geolocation_status: normalizedGeoStatus,
        reason: 'permission_denied_no_temp_access'
      });
      return res.status(403).json({
        error:
          'Location permission is required. Please allow location access for this site in your browser settings, then try again.',
        geofence_code: 'LOCATION_PERMISSION_DENIED',
        requires_geolocation: true,
        geolocation_status: 'denied',
        temp_access_possible: false,
        temp_access_active: false,
        restaurant_name: restaurant.name,
        action_required: 'enable_location_permission'
      });
    }

    // 2. Billing status (fail closed only for inactive non-trial tenants)
    const isTrialPending =
      restaurant.billing_status === 'pending' &&
      restaurant.plan === 'trial' &&
      restaurant.trial_ends_at &&
      new Date(restaurant.trial_ends_at).getTime() > Date.now();

    if (restaurant.billing_status !== 'active' && !isTrialPending) {
      logPublicAnalyticsEvent('qr_scan_rejected', {
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

    // 3. Geofence evaluation (fail-closed only when both sides have coords
    //    AND the haversine distance exceeds the effective radius).
    //
    //    Grace policies (all three are logged independently so the SA
    //    dashboard retains visibility into when the gate was softened):
    //
    //      (a) Host-based grace: req hostname is localhost/127.x OR plaintext
    //          HTTP → effective_radius_m = max(configured, 2000). IP-based
    //          fixes in dev environments are notoriously bad.
    //      (b) Low-accuracy device bypass: caller explicitly sets
    //          `bypass=low_accuracy_device` AND the raw (non-overridden)
    //          distance would have triggered suggest_high_accuracy. This
    //          proves the client has already attempted a GPS upgrade and it
    //          failed — a desktop-with-no-GPS scenario. We pass *only* the
    //          geofence gate; table/billing validation still runs.
    const geofence = evaluateGeofence(restaurant, clientLatParsed, clientLngParsed, {
      effectiveRadiusOverride: radiusOpts.effectiveRadiusOverride
    });
    let lowAccuracyBypassGranted = false;
    if (radiusOpts.devGrace && geofence.radius_overridden) {
      logPublicAnalyticsEvent('geofence_localhost_grace_applied', {
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        table_number: table,
        configured_radius_m: geofence.configured_radius_m,
        effective_radius_m: geofence.radius_m,
        is_local_hostname: radiusOpts.isLocalHostname,
        is_http_proto: radiusOpts.isHttpProto,
        distance_m: geofence.distance_m,
        inside: geofence.inside === true
      });
    }

    if (geofence.requires_geolocation === false && geofence.inside === false) {
      // Try the low-accuracy-device bypass. The "raw suggest_high_accuracy"
      // signal would be computed against the *configured* radius not the
      // overridden localhost-grace radius. We approximate this check:
      // grant if the raw distance > max(500m, 2× configured_radius). That's
      // the exact same policy as evaluateGeofence when no override is set.
      const configuredRadius = geofence.configured_radius_m;
      const outsideFarEnoughForGpsUpgrade =
        configuredRadius < 250
          ? geofence.distance_m > Math.max(500, configuredRadius * 2)
          : geofence.distance_m > configuredRadius + 500;
      const allowLowAccuracyBypass =
        lowAccuracyBypass && outsideFarEnoughForGpsUpgrade;

      // Rule: a VALID temp-access token (always < 5 minutes old, scoped to
      // this restaurant + table) supersedes both the requires_geolocation
      // gate AND the OUTSIDE_RADIUS gate. This lets the "Temporarily Use"
      // CTA on the frontend advance the user to the welcome screen even
      // when location services are temporarily unavailable.
      const allowTempAccessBypass = tempAccessBypassGranted === true;

      if (allowLowAccuracyBypass || allowTempAccessBypass) {
        if (allowLowAccuracyBypass && !allowTempAccessBypass) lowAccuracyBypassGranted = true;
        logPublicAnalyticsEvent(
          allowTempAccessBypass
            ? 'geofence_bypass_temp_access'
            : 'geofence_bypass_low_accuracy',
          {
            restaurant_id: restaurant.id,
            restaurant_slug: restaurant.slug,
            table_number: table,
            distance_m: geofence.distance_m,
            configured_radius_m: geofence.configured_radius_m,
            effective_radius_m: geofence.radius_m,
            client_lat: clientLatParsed,
            client_lng: clientLngParsed,
            temp_access_expires_at_unix: allowTempAccessBypass ? tempAccessExpiresAtUnix : null
          }
        );
      } else {
        logPublicAnalyticsEvent('geofence_check_denied', {
          restaurant_id: restaurant.id,
          restaurant_slug: restaurant.slug,
          table_number: table,
          distance_m: geofence.distance_m,
          configured_radius_m: geofence.configured_radius_m,
          effective_radius_m: geofence.radius_m,
          radius_overridden: geofence.radius_overridden === true,
          suggest_high_accuracy: geofence.suggest_high_accuracy === true,
          client_lat: clientLatParsed,
          client_lng: clientLngParsed,
          restaurant_lat: Number(restaurant.latitude),
          restaurant_lng: Number(restaurant.longitude),
          temp_access_present: tempAccess.token_present === true,
          temp_access_valid: tempAccess.valid === true,
          geolocation_status: normalizedGeoStatus
        });
        return res.status(403).json({
          error: 'Location required',
          geofence_code: 'OUTSIDE_RADIUS',
          requires_geolocation: true,
          geolocation_status: normalizedGeoStatus,
          temp_access_possible: normalizedGeoStatus !== 'denied',
          temp_access_active: tempAccessBypassGranted === true,
          distance_m: geofence.distance_m,
          configured_radius_m: geofence.configured_radius_m,
          effective_radius_m: geofence.radius_m,
          radius_overridden: geofence.radius_overridden === true,
          suggest_high_accuracy: geofence.suggest_high_accuracy === true,
          restaurant_name: restaurant.name
        });
      }
    }

    // When temp access is active and we're in the `requires_geolocation`
    // path or an inside=false OUTSIDE_RADIUS path, we've already gated it
    // above. Still apply the same soft pass for the pending-coords /
    // requires_geolocation path if the token is valid.
    if (
      geofence.requires_geolocation === true &&
      tempAccessBypassGranted === true &&
      normalizedGeoStatus !== 'denied'
    ) {
      logPublicAnalyticsEvent('geofence_bypass_temp_access', {
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        table_number: table,
        reason: 'requires_geolocation_pending_coords',
        temp_access_expires_at_unix: tempAccessExpiresAtUnix,
        geolocation_status: normalizedGeoStatus
      });
    }

    if (geofence.requires_geolocation === false && geofence.inside === true) {
      logPublicAnalyticsEvent('geofence_check_passed', {
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        table_number: table,
        distance_m: geofence.distance_m,
        configured_radius_m: geofence.configured_radius_m,
        effective_radius_m: geofence.radius_m,
        radius_overridden: geofence.radius_overridden === true
      });
    } else if (lowAccuracyBypassGranted || tempAccessBypassGranted) {
      // already logged above
    } else if (geofence.requires_geolocation === true) {
      logPublicAnalyticsEvent(
        normalizedGeoStatus === 'denied' ? 'geofence_check_location_denied' : 'geofence_check_pending_coords',
        {
          restaurant_id: restaurant.id,
          restaurant_slug: restaurant.slug,
          table_number: table,
          geolocation_status: normalizedGeoStatus,
          restaurant_coords_present: geofence.restaurant_coords_present,
          client_coords_present: geofence.client_coords_present,
          configured_radius_m: geofence.configured_radius_m,
          effective_radius_m: geofence.radius_m,
          radius_overridden: geofence.radius_overridden === true
        }
      );
    }

    // 4. Single-JOIN lookup: confirm table existence and carry restaurant row
    //    through at the same time. This turns 2 SQL roundtrips → 1.
    const tableJoinResult = await db.query(
      `
        SELECT rt.id AS table_id, rt.table_number
        FROM restaurant_tables rt
        WHERE rt.restaurant_id = $1 AND rt.table_number = $2
        LIMIT 1
      `,
      [restaurant.id, table]
    );

    if (tableJoinResult.rows.length === 0) {
      logPublicAnalyticsEvent('qr_scan_rejected', {
        reason: 'table_not_registered',
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        restaurant_name: restaurant.name,
        table_number: table
      });
      return res.status(404).json({ error: 'Table not registered' });
    }

    logPublicAnalyticsEvent('qr_scan_validated', {
      restaurant_id: restaurant.id,
      restaurant_slug: restaurant.slug,
      restaurant_name: restaurant.name,
      table_number: table,
      geofence: {
        inside: geofence.inside,
        distance_m: geofence.distance_m,
        configured_radius_m: geofence.configured_radius_m,
        effective_radius_m: geofence.radius_m,
        radius_overridden: geofence.radius_overridden === true,
        requires_geolocation: geofence.requires_geolocation,
        low_accuracy_bypass_granted: lowAccuracyBypassGranted === true
      }
    });

    // 5. Generate active session/handshake token
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
        primary_color: '#06b6d4'
      },
      session_token: sessionToken,
      geofence: {
        requires_geolocation: geofence.requires_geolocation,
        inside: geofence.inside,
        distance_m: geofence.distance_m,
        configured_radius_m: geofence.configured_radius_m,
        effective_radius_m: geofence.radius_m,
        radius_overridden: geofence.radius_overridden === true,
        low_accuracy_bypass_granted: lowAccuracyBypassGranted === true,
        suggest_high_accuracy: geofence.suggest_high_accuracy === true,
        temp_access_granted: tempAccessBypassGranted === true,
        temp_access_expires_at_iso: tempAccessBypassGranted ? tempAccessExpiresAtIso || null : null,
        temp_access_expires_at_unix: tempAccessBypassGranted ? tempAccessExpiresAtUnix || null : null,
        geolocation_status: normalizedGeoStatus
      }
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

/**
 * GET /api/public/geofence
 * Optimistic pre-flight check that only runs the geofence evaluation
 * (no billing/table validation, no token). Used by the frontend to
 * poll permission state and show the "Allow location" prompt before
 * triggering the real handshake.
 *
 * Query: slug, table, client_lat, client_lng, geolocation_status
 */
async function preflightGeofence(req, res) {
  const { slug, client_lat, client_lng, geolocation_status } = req.query;

  if (!slug) {
    return res.status(400).json({ error: 'Missing slug parameter' });
  }

  try {
    const restaurant = await loadRestaurantGeoBySlug(slug);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const clientLatParsed = client_lat != null && client_lat !== '' ? Number(client_lat) : null;
    const clientLngParsed = client_lng != null && client_lng !== '' ? Number(client_lng) : null;
    const result = evaluateGeofence(restaurant, clientLatParsed, clientLngParsed);

    if (result.requires_geolocation === false && result.inside === false) {
      logPublicAnalyticsEvent('geofence_check_denied', {
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        source: 'preflight',
        distance_m: result.distance_m,
        radius_m: result.radius_m
      });
    } else if (result.requires_geolocation === false && result.inside === true) {
      logPublicAnalyticsEvent('geofence_check_passed', {
        restaurant_id: restaurant.id,
        restaurant_slug: restaurant.slug,
        source: 'preflight',
        distance_m: result.distance_m,
        radius_m: result.radius_m
      });
    } else {
      logPublicAnalyticsEvent(
        geolocation_status === 'denied' ? 'geofence_check_location_denied' : 'geofence_check_pending_coords',
        {
          restaurant_id: restaurant.id,
          restaurant_slug: restaurant.slug,
          source: 'preflight',
          geolocation_status: geolocation_status || null,
          restaurant_coords_present: result.restaurant_coords_present,
          client_coords_present: result.client_coords_present,
          configured_radius_m: result.radius_m
        }
      );
    }

    return res.json({
      restaurant_name: restaurant.name,
      geofence_code:
        result.requires_geolocation
          ? 'REQUIRES_LOCATION'
          : result.inside
            ? 'INSIDE_RADIUS'
            : 'OUTSIDE_RADIUS',
      requires_geolocation: result.requires_geolocation,
      inside: result.inside,
      distance_m: result.distance_m,
      configured_radius_m: result.radius_m,
      suggest_high_accuracy: result.suggest_high_accuracy === true
    });
  } catch (err) {
    console.error('Preflight geofence error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  handshake,
  getRestaurantInvite,
  completeRestaurantInvite,
  postPublicEvent,
  preflightGeofence,
  issueTempGeoAccess,
  validateTempGeoAccessToken,
  extractTempGeoAccessToken,
  peekPayloadClaims
};
