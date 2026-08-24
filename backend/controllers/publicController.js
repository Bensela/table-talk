const crypto = require('crypto');
const db = require('../db');
const { signToken } = require('../middleware/authMiddleware');
const { geocodeAddress } = require('../services/geocodeService');
const { hashPassword } = require('./adminController');
const { insertAnalyticsEvent } = require('../services/analyticsService');
const {
  evaluateGeofence,
  getCachedRestaurantGeo,
  setCachedRestaurantGeo,
  invalidateCachedRestaurantGeo
} = require('../services/geofenceService');

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

      if (allowLowAccuracyBypass) {
        lowAccuracyBypassGranted = true;
        logPublicAnalyticsEvent('geofence_bypass_low_accuracy', {
          restaurant_id: restaurant.id,
          restaurant_slug: restaurant.slug,
          table_number: table,
          distance_m: geofence.distance_m,
          configured_radius_m: geofence.configured_radius_m,
          effective_radius_m: geofence.radius_m,
          client_lat: clientLatParsed,
          client_lng: clientLngParsed
        });
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
          restaurant_lng: Number(restaurant.longitude)
        });
        return res.status(403).json({
          error: 'Location required',
          geofence_code: 'OUTSIDE_RADIUS',
          requires_geolocation: true,
          geolocation_status: geolocation_status || null,
          distance_m: geofence.distance_m,
          configured_radius_m: geofence.configured_radius_m,
          effective_radius_m: geofence.radius_m,
          radius_overridden: geofence.radius_overridden === true,
          suggest_high_accuracy: geofence.suggest_high_accuracy === true,
          restaurant_name: restaurant.name
        });
      }
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
    } else if (lowAccuracyBypassGranted) {
      // already logged above
    } else if (geofence.requires_geolocation === true) {
      logPublicAnalyticsEvent(
        geolocation_status === 'denied' ? 'geofence_check_location_denied' : 'geofence_check_pending_coords',
        {
          restaurant_id: restaurant.id,
          restaurant_slug: restaurant.slug,
          table_number: table,
          geolocation_status: geolocation_status || null,
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
        suggest_high_accuracy: geofence.suggest_high_accuracy === true
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
  preflightGeofence
};
