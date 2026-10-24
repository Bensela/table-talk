const db = require('../db');
const deckService = require('../services/deckService');
const { insertAnalyticsEvent, insertSessionAnalyticsEvent } = require('../services/analyticsService');
const {
  validateTempGeoAccessToken
} = require('../controllers/publicController');

const crypto = require('crypto');

const SESSION_DURATION_HOURS = 24;

const DEFAULT_RESTAURANT_ID = 'd0000000-0000-0000-0000-000000000000';

/**
 * Guest geofencing feature switch.
 *
 * Current product policy disables guest location enforcement.
 * Missing/unknown values intentionally default to OFF.
 *
 * Existing geofence infrastructure remains available for safe
 * future reactivation.
 */
function isGuestGeofenceEnabled() {
  return String(process.env.GUEST_GEOFENCE_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

/**
 * Session-level temp-access geolocation gate. If the request carries a
 * temporary access token we verify it's scoped to the resolved restaurant
 * + table and hasn't expired. Expired tokens → explicit 410 so the frontend
 * clears the stale token and re-prompts for GPS or a fresh temp access
 * window. Invalid/other errors only block when a token is present but bad
 * (tamper protection), not when no token is supplied at all.
 *
 * Returns: { passed: boolean, response_body: object|null, status: number|null }
 */
async function validateSessionTempGeoAccess(req, { table_token, restaurant_id, restaurant_slug }) {
  // Guest location enforcement is disabled unless explicitly re-enabled.
  //
  // Ignore legacy temporary-geolocation tokens while disabled so stale,
  // expired or previously issued geo tokens cannot block a valid session.
  //
  // This bypass affects only the legacy guest-location requirement.
  // Normal session authentication/authorization remains unchanged.
  if (!isGuestGeofenceEnabled()) {
    return {
      passed: true,
      response_body: null,
      status: null,
      geofence_disabled: true
    };
  }
  // No token → pass through silently (rely on handshake + session JWT).
  const bodyTok =
    (req.body && (req.body.temp_access_token || req.body.tempGeoToken)) || null;
  const queryTok =
    (req.query && (req.query.temp_access_token || req.query.tempGeoToken)) || null;
  const authz = (req.headers && (req.headers.authorization || req.headers.Authorization)) || null;
  const hasBearer =
    typeof authz === 'string' && authz.trim().toLowerCase().startsWith('bearer ');
  const hasToken = Boolean(bodyTok || queryTok || hasBearer);
  if (!hasToken) {
    return { passed: true, response_body: null, status: null };
  }
  let resolvedRestaurantId = restaurant_id || null;
  if (!resolvedRestaurantId && (restaurant_id || restaurant_slug)) {
    try {
      resolvedRestaurantId = await resolveRestaurantId(restaurant_id || null, restaurant_slug || null);
    } catch (_) { resolvedRestaurantId = null; }
  }
  const scopeOpts = {
    restaurant_id: resolvedRestaurantId || null,
    table_token: table_token != null ? String(table_token) : null
  };
  let check;
  try {
    check = validateTempGeoAccessToken(req, scopeOpts);
  } catch (e) {
    check = {
      valid: false,
      token_present: true,
      error_code: 'TOKEN_INVALID',
      error: 'Invalid temporary access token'
    };
  }
  if (check.valid) {
    return { passed: true, response_body: null, status: null, check };
  }
  if (check && check._not_a_temp_token) {
    return { passed: true, response_body: null, status: null };
  }
  if (check.error_code === 'TOKEN_EXPIRED') {
    return {
      passed: false,
      status: 410,
      response_body: {
        error: check.error || 'Temporary access window has expired.',
        geofence_code: 'TEMP_ACCESS_EXPIRED',
        temp_access_expired: true
      }
    };
  }
  // Token present but invalid (tampered, wrong restaurant, wrong table) →
  // hard 401 so caller drops the token instead of silently pretending no
  // temp access ever existed. No PII leaked.
  return {
    passed: false,
    status: 401,
    response_body: {
      error: check.error || 'Temporary access token is invalid.',
      geofence_code: 'TEMP_ACCESS_INVALID',
      temp_access_valid: false
    }
  };
}

async function resolveRestaurantId(restaurant_id, restaurant_slug) {
  if (!restaurant_id && !restaurant_slug) {
    return DEFAULT_RESTAURANT_ID;
  }
  
  try {
    let queryStr = 'SELECT id FROM restaurants WHERE ';
    let params = [];
    if (restaurant_id && restaurant_id !== 'default' && restaurant_id !== DEFAULT_RESTAURANT_ID) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(restaurant_id)) {
        queryStr += 'id = $1';
        params.push(restaurant_id);
      } else {
        queryStr += 'slug = $1';
        params.push(restaurant_id);
      }
    } else if (restaurant_slug && restaurant_slug !== 'default') {
      queryStr += 'slug = $1';
      params.push(restaurant_slug);
    } else {
      return DEFAULT_RESTAURANT_ID;
    }
    const res = await db.query(queryStr, params);
    if (res.rows.length > 0) {
      return res.rows[0].id;
    }
  } catch (e) {
    console.error('Error resolving restaurant_id:', e);
  }
  return DEFAULT_RESTAURANT_ID;
}

// The resolveRestaurant middleware authorizes exactly one tenant per request
// (slug lookup + billing eligibility). A body-supplied restaurant_id must never
// override that decision, otherwise a valid slug could be used to create or
// join sessions inside a different (e.g. expired) tenant.
async function resolveAuthorizedRestaurantId(req, restaurant_id, restaurant_slug) {
  if (req.restaurant?.id) return req.restaurant.id;
  return resolveRestaurantId(restaurant_id, restaurant_slug);
}

// --- Helper Functions ---

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const PAIRING_CODE_LENGTH = 4;

function generatePairingCode() {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_ALPHABET[crypto.randomInt(PAIRING_ALPHABET.length)];
  }
  return code;
}

function hashPairingCode(code, sessionId, salt = process.env.SECRET_SALT || 'default_salt') {
  return crypto
    .createHash('sha256')
    .update(code + sessionId + salt)
    .digest('hex');
}

// --- Controller Functions ---

const createSession = async (req, res) => {
  const table_token = req.body.table_token;
  const { restaurant_id, context, mode } = req.body;
  const restaurant_slug = req.restaurant?.slug || req.body.restaurant_slug || restaurant_id;
  // Diagnostic only (History Log Exports device_type column). Never used
  // for fingerprinting, authorization, or any security decision.
  const deviceType = ['iOS', 'Android'].includes(req.body.device_type) ? req.body.device_type : null;

  if (!table_token) {
    return res.status(400).json({ error: 'table_token is required' });
  }

  // Temp-access token (geofence bypass) validation. The token is scoped to
  // restaurant + table; if the session request is signed but the token is
  // EXPIRED, we refuse the request entirely. This enforces the "access is
  // automatically revoked once the temporary access window expires" rule.
  //
  // Note: a missing token is fine; only a present-but-invalid/expired token
  // is rejected here since it means the user previously fell back to temp
  // access and that window has lapsed.
  let tempAccessInfo = {
    valid: false,
    token_present: false,
    geofence_disabled: !isGuestGeofenceEnabled()
  };

  if (isGuestGeofenceEnabled()) {
    try {
      tempAccessInfo = validateTempGeoAccessToken(req, {
        restaurant_id: null, // resolved below
        table_token: String(table_token)
      });
    } catch (e) {
      tempAccessInfo = {
        valid: false,
        token_present: true,
        error_code: 'TOKEN_INVALID'
      };
    }

    if (tempAccessInfo.token_present && !tempAccessInfo.valid) {
      if (tempAccessInfo.error_code === 'TOKEN_EXPIRED') {
        return res.status(410).json({
          error:
            tempAccessInfo.error ||
            'Temporary access window has expired. Please enable location services or request a new temporary access window.',
          geofence_code: 'TEMP_ACCESS_EXPIRED',
          temp_access_expired: true
        });
      }

      // Preserve legacy token validation when geofencing is explicitly ON.
    }
  }

  // Optional: Validate context and mode if provided
  if (context && !['Exploring', 'Established', 'Mature'].includes(context)) {
    return res.status(400).json({ error: 'Invalid context' });
  }
  
  if (mode && !['single', 'dual', 'single-phone', 'dual-phone'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  try {
    const resolvedRestaurantId = await resolveAuthorizedRestaurantId(req, restaurant_id, restaurant_slug);

    // Re-validate temp access with the resolved restaurant id so it can't
    // be reused across restaurants.
    if (isGuestGeofenceEnabled() && tempAccessInfo.token_present) {
      const scoped = validateTempGeoAccessToken(req, {
        restaurant_id: resolvedRestaurantId,
        table_token: String(table_token)
      });
      if (!scoped.valid) {
        if (scoped.error_code === 'TOKEN_EXPIRED') {
          return res.status(410).json({
            error:
              scoped.error ||
              'Temporary access window has expired.',
            geofence_code: 'TEMP_ACCESS_EXPIRED',
            temp_access_expired: true
          });
        }
        tempAccessInfo = { ...scoped, token_present: true };
      } else {
        tempAccessInfo = scoped;
      }
    }

    // 1. Determine Session Group
    const sessionGroupId = crypto.randomUUID();
    const isNewGroup = true;

    const now = new Date();
    const expires_at = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 0, 0
    ));
    
    // Generate the session id before hashing pairing credentials.
    const sessionId = crypto.randomUUID();

    // Pairing credentials exist only for a newly-created dual-phone session.
    // The raw four-letter code is returned once to Phone A; only its hash is stored.
    let pairingCode = null;
    let pairingCodeHash = null;
    let pairingExpiresAt = null;
    let dualStatus = null;

    // 3. Handle Dual-Phone Logic
    let dualGroupId = null;
    if (mode === 'dual-phone') {
      pairingCode = generatePairingCode();
      pairingCodeHash = hashPairingCode(pairingCode, sessionId);
      pairingExpiresAt = new Date(Date.now() + (5 * 60 * 1000));
      dualStatus = 'waiting';
      dualGroupId = crypto.randomUUID();
    }

    // 4. Ensure deck session exists (seed generation)
    if (context) {
      // Pass sessionGroupId to deck service if updated to support it
      // For now, keep existing call but note deckService might need update
      await deckService.getDeckSession(resolvedRestaurantId, table_token, context, sessionGroupId);
    }

    // 5. Create Session
    console.log(`[API] Creating session for table ${table_token} (Group: ${sessionGroupId})`);
    const newSession = await db.query(
      `INSERT INTO sessions 
       (session_id, table_token, restaurant_id, context, mode, session_group_id, 
        pairing_code_hash, pairing_expires_at, dual_status, expires_at, table_id, dual_group_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
       RETURNING *`,
      [
        sessionId,
        table_token, 
        resolvedRestaurantId, 
        context || 'Exploring', 
        mode || 'single-phone',
        sessionGroupId,
        pairingCodeHash,
        pairingExpiresAt,
        dualStatus,
        expires_at,
        table_token,
        dualGroupId // New field
      ]
    );
    
    // 6. Create Participant
    const participantId = crypto.randomUUID();
    const participantToken = crypto.randomBytes(32).toString('hex');
    const participantTokenHash = crypto.createHash('sha256').update(participantToken).digest('hex');

    await db.query(
      `INSERT INTO session_participants (participant_id, session_id, role, participant_token_hash, last_seen_at, disconnected_at)
       VALUES ($1, $2, $3, $4, NOW(), NULL)`,
      [participantId, sessionId, 'A', participantTokenHash]
    );

    // Log Session Group Creation/Join
    const baseSession = {
      session_id: sessionId,
      participant_id: participantId,
      restaurant_id: resolvedRestaurantId,
      table_token
    };
    if (isNewGroup) {
      await insertAnalyticsEvent({
        ...baseSession,
        event_type: 'session_group_created',
        event_data: { session_group_id: sessionGroupId, context }
      });
    } else {
      await insertAnalyticsEvent({
        ...baseSession,
        event_type: 'session_joined_existing_group',
        event_data: { session_group_id: sessionGroupId }
      });
    }

    // 7. Log analytics
    if (mode === 'dual-phone') {
      await insertAnalyticsEvent({
        ...baseSession,
        event_type: 'join_code_generated',
        event_data: { expires_at: pairingExpiresAt }
      });
      await insertAnalyticsEvent({
        ...baseSession,
        event_type: 'waiting_partner_start',
        event_data: { context, session_group_id: sessionGroupId }
      });
    }

    await insertAnalyticsEvent({
      ...baseSession,
      event_type: 'session_created',
      event_data: { context, mode, session_group_id: sessionGroupId, role: 'A', device_type: deviceType }
    });

    // 8. Return Response
    const response = {
      ...newSession.rows[0],
      participant_id: participantId,
      participant_token: participantToken, // Return raw token once
      pairing_code: pairingCode // Only return raw code here!
    };
    
    // Remove hash from response
    delete response.pairing_code_hash;

    res.status(201).json(response);
  } catch (err) {
    console.error('Error creating session:', err);
    // Write error to file for debugging
    const fs = require('fs');
    fs.appendFileSync('error.log', `${new Date().toISOString()} - Error creating session: ${err.message}\n${err.stack}\n\n`);
    res.status(500).json({ error: 'Server error' });
  }
};

const joinDualPhoneSession = async (req, res) => {
  const { table_token, restaurant_id, restaurant_slug, code } = req.body;

  try {
    // Patch 2A: a new Phone B must redeem the four-letter code.
    // session_id is intentionally not accepted as join authorization.
    if (!table_token) {
      return res.status(400).json({ error: 'table_token is required', code: 'PAIRING_TABLE_REQUIRED' });
    }

    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!/^[ABCDEFGHJKLMNPRSTUVWXYZ]{4}$/.test(normalizedCode)) {
      return res.status(400).json({ error: 'Invalid pairing code.', code: 'PAIRING_CODE_INVALID' });
    }

    const geoGate = await validateSessionTempGeoAccess(req, {
      table_token,
      restaurant_id,
      restaurant_slug
    });
    if (!geoGate.passed) {
      return res.status(geoGate.status || 410).json(geoGate.response_body);
    }

    const resolvedRestaurantId = await resolveAuthorizedRestaurantId(req, restaurant_id, restaurant_slug);

    // Candidate discovery is tenant + table scoped. dual_status='waiting' alone
    // is NOT sufficient because Start Fresh also uses that state.
    const candidates = await db.query(
      `SELECT session_id, restaurant_id, table_token, context, mode,
              session_group_id, dual_status, pairing_code_hash, pairing_expires_at
         FROM sessions
        WHERE restaurant_id = $1
          AND table_token = $2
          AND mode = 'dual-phone'
          AND dual_status = 'waiting'
          AND pairing_code_hash IS NOT NULL
          AND pairing_expires_at > NOW()
          AND expires_at > NOW()
        ORDER BY created_at DESC`,
      [resolvedRestaurantId, table_token]
    );

    let matchedSession = null;
    let matchedHash = null;

    for (const candidate of candidates.rows) {
      const candidateHash = hashPairingCode(normalizedCode, candidate.session_id);
      const storedHash = String(candidate.pairing_code_hash || '');

      if (candidateHash.length === storedHash.length) {
        const supplied = Buffer.from(candidateHash, 'hex');
        const stored = Buffer.from(storedHash, 'hex');

        if (supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored)) {
          matchedSession = candidate;
          matchedHash = candidateHash;
          break;
        }
      }
    }

    if (!matchedSession) {
      // Deliberately avoid revealing whether a waiting session exists.
      return res.status(404).json({ error: 'Invalid or expired pairing code.', code: 'PAIRING_CODE_INVALID' });
    }

    const participantId = crypto.randomUUID();
    const participantToken = crypto.randomBytes(32).toString('hex');
    const participantTokenHash = crypto.createHash('sha256').update(participantToken).digest('hex');

    // Atomic single-use redemption.
    // If another Phone B wins first, claimed returns zero rows and no participant
    // is inserted. The existing UNIQUE(session_id, role) constraint is an
    // additional database-level race defense.
    let claimResult;
    try {
      claimResult = await db.query(
        `WITH claimed AS (
            UPDATE sessions
               SET dual_status = 'paired',
                   pairing_code_hash = NULL,
                   pairing_expires_at = NULL
             WHERE session_id = $1
               AND restaurant_id = $2
               AND table_token = $3
               AND mode = 'dual-phone'
               AND dual_status = 'waiting'
               AND pairing_code_hash = $4
               AND pairing_code_hash IS NOT NULL
               AND pairing_expires_at > NOW()
               AND expires_at > NOW()
             RETURNING session_id, restaurant_id, table_token, context, mode,
                       session_group_id, dual_status
          ), inserted AS (
            INSERT INTO session_participants
              (participant_id, session_id, role, participant_token_hash, last_seen_at, disconnected_at)
            SELECT $5, session_id, 'B', $6, NOW(), NULL
              FROM claimed
            RETURNING session_id
          )
          SELECT claimed.*
            FROM claimed
            JOIN inserted USING (session_id)`,
        [
          matchedSession.session_id,
          resolvedRestaurantId,
          table_token,
          matchedHash,
          participantId,
          participantTokenHash
        ]
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'SESSION_FULL', code: 'PAIRING_ALREADY_CLAIMED' });
      }
      throw err;
    }

    if (claimResult.rows.length === 0) {
      return res.status(409).json({ error: 'SESSION_FULL', code: 'PAIRING_ALREADY_CLAIMED' });
    }

    const claimedSession = claimResult.rows[0];

    // Best-effort, coordination-only notification: any other device still
    // sitting on the code-entry screen for this SAME table's now-consumed
    // pairing opportunity should stop waiting and move on. Carries no
    // session/participant/pairing identity — this is not an authorization
    // signal, just a UX nudge to the pre-session setup room.
    try {
      const io = require('../index').io;
      if (io && restaurant_slug && table_token) {
        const setupKey = String(restaurant_slug).trim().toLowerCase() + '::' + table_token;
        io.to('setup_' + setupKey).emit('pairing_opportunity_consumed', {
          restaurantSlug: String(restaurant_slug).trim().toLowerCase(),
          tableToken: table_token
        });
      }
    } catch (_) { /* best-effort only */ }

    await insertAnalyticsEvent({
      session_id: claimedSession.session_id,
      participant_id: participantId,
      restaurant_id: claimedSession.restaurant_id,
      table_token: claimedSession.table_token,
      event_type: 'session_paired',
      event_data: { role: 'B', reclaim: false }
    });

    await insertAnalyticsEvent({
      session_id: claimedSession.session_id,
      participant_id: participantId,
      restaurant_id: claimedSession.restaurant_id,
      table_token: claimedSession.table_token,
      event_type: 'partner_connected',
      event_data: { role: 'B' }
    });

    await insertAnalyticsEvent({
      session_id: claimedSession.session_id,
      participant_id: participantId,
      restaurant_id: claimedSession.restaurant_id,
      table_token: claimedSession.table_token,
      event_type: 'pairing_code_redeemed',
      event_data: { success: true, role: 'B' }
    });

    res.json({
      session_id: claimedSession.session_id,
      participant_id: participantId,
      participant_token: participantToken,
      session_group_id: claimedSession.session_group_id,
      context: claimedSession.context,
      mode: claimedSession.mode,
      dual_status: 'paired'
    });
  } catch (err) {
    console.error('Error joining dual session:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
const getSession = async (req, res) => {
  const { session_id } = req.params;
  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (sessionResult.rows.length > 0) {
      const s = sessionResult.rows[0];
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: s.table_token,
        restaurant_id: s.restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
    }
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = sessionResult.rows[0];
    
    // Retrieve position_index from deck_sessions if context exists
    let position_index = 0;
    if (session.context) {
      const today = new Date().toISOString().split('T')[0];
      // Updated query to respect session_group_id
      const deckResult = await db.query(
        `SELECT position_index FROM deck_sessions 
         WHERE restaurant_id = $1 AND table_token = $2 AND relationship_context = $3 AND service_day = $4 AND session_group_id = $5`,
        [session.restaurant_id || DEFAULT_RESTAURANT_ID, session.table_token, session.context, today, session.session_group_id]
      );
      if (deckResult.rows.length > 0) {
        position_index = deckResult.rows[0].position_index;
      }
    }

    res.json({ ...session, position_index });
  } catch (err) {
    console.error('Error getting session:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateSession = async (req, res) => {
  const { session_id } = req.params;
  const { mode, position_index, context } = req.body; // Support mode, context and position_index updates

  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const preSession = await db.query('SELECT table_token, restaurant_id FROM sessions WHERE session_id = $1', [session_id]);
    if (preSession.rows.length > 0) {
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: preSession.rows[0].table_token,
        restaurant_id: preSession.rows[0].restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
    }

    let updatedSession = null;

    // 1. Handle Context Update (e.g., Switching Maturity in Dual Mode)
    if (context) {
      if (!['Exploring', 'Established', 'Mature'].includes(context)) {
        return res.status(400).json({ error: 'Invalid context' });
      }

      // Update session context
      // When context changes in Dual Mode, we keep the same session_id and dual_group_id.
      // This is consistent with Option A (Mutation).
      // However, if we ever needed to switch to Option B (New Session), we would use dual_group_id here.
      // For now, we update in place as per recent fix.
      const result = await db.query(
        `UPDATE sessions SET context = $1 WHERE session_id = $2 RETURNING *`,
        [context, session_id]
      );
      
      if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
      updatedSession = result.rows[0];

      // IMPORTANT: Ensure deck session exists for this new context
      // Re-use createSession logic (or similar) to ensure deck_sessions row exists
      const deckService = require('../services/deckService');
      await deckService.getDeckSession(
          updatedSession.restaurant_id || DEFAULT_RESTAURANT_ID, 
          updatedSession.table_token, 
          context, 
          updatedSession.session_group_id
      );

      // Log analytics
      await insertAnalyticsEvent({
        session_id: session_id,
        restaurant_id: updatedSession.restaurant_id,
        table_token: updatedSession.table_token,
        event_type: 'context_changed',
        event_data: { context }
      });
    }

    // 2. Handle Mode Update
    if (mode) {
      if (!['single', 'dual', 'single-phone', 'dual-phone'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode' });
      }
      
      const result = await db.query(
        `UPDATE sessions SET mode = $1 WHERE session_id = $2 RETURNING *`,
        [mode, session_id]
      );
      updatedSession = result.rows[0];
      
      // Log analytics
      await insertAnalyticsEvent({
        session_id: session_id,
        restaurant_id: updatedSession.restaurant_id,
        table_token: updatedSession.table_token,
        event_type: 'mode_selected',
        event_data: { mode }
      });
    }

    if (context || mode) {
       // Emit update event to socket room
       const io = require('../index').io;
       if (io) {
           io.to(session_id).emit('session_updated', { 
               context: updatedSession.context, 
               mode: updatedSession.mode 
           });
       }
    }

    if (position_index !== undefined) {
      // Need to find the session to know context/token
      const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
      if (sessionResult.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
      const session = sessionResult.rows[0];

      if (session.context) {
        const today = new Date().toISOString().split('T')[0];
        // Update deck_session specifically for this session group
        await db.query(
          `UPDATE deck_sessions SET position_index = $1, updated_at = NOW()
           WHERE restaurant_id = $2 AND table_token = $3 AND relationship_context = $4 AND service_day = $5 AND session_group_id = $6`,
          [position_index, session.restaurant_id || DEFAULT_RESTAURANT_ID, session.table_token, session.context, today, session.session_group_id]
        );
      }
      updatedSession = session; // Just return session, position updated in other table
    }

    if (!updatedSession) {
      // If nothing updated but session exists
      const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
      if (sessionResult.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
      updatedSession = sessionResult.rows[0];
    }

    res.json(updatedSession);
  } catch (err) {
    console.error('Error updating session:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const endSession = async (req, res) => {
  const { session_id } = req.params;
  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    console.log(`[API] Explicitly ending session ${session_id}...`);

    // 1. Get Session Details first to find the deck_session and context
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    
    if (sessionResult.rows.length > 0) {
      const session = sessionResult.rows[0];
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: session.table_token,
        restaurant_id: session.restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
      
      // 2. Reset Deck Session
      // When a session is explicitly ended via "End Session", we must reset the deck progress
      // so the next session starts from Question 1 (index 0).
      if (session.context) {
        const today = new Date().toISOString().split('T')[0];
        // Only reset for this specific session group to avoid side effects
        await db.query(
          `UPDATE deck_sessions SET position_index = 0, updated_at = NOW()
           WHERE restaurant_id = $1 AND table_token = $2 AND relationship_context = $3 AND service_day = $4 AND session_group_id = $5`,
          [session.restaurant_id || DEFAULT_RESTAURANT_ID, session.table_token, session.context, today, session.session_group_id]
        );
      }
    } else {
        // Session already gone (maybe cleanup job ran or duplicate request)
        console.log(`[API] Session ${session_id} not found during end request (already deleted?)`);
        return res.status(200).json({ message: 'Session already deleted' });
    }

    // 3. Delete dependent data
    // IMPORTANT: analytics_events rows are NEVER deleted (append-only).
    // The session_id FK uses ON DELETE SET NULL, so the historical event
    // stream keeps restaurant_id, table_token, anonymous_id top-level cols
    // even when the sessions row itself is deleted.
    await db.query('DELETE FROM session_participants WHERE session_id = $1', [session_id]);
    // Delete dual_groups referencing this session before deleting the session itself
    await db.query('DELETE FROM dual_groups WHERE active_session_id = $1', [session_id]);
    
    // 4. Delete the session itself
    const deleteResult = await db.query('DELETE FROM sessions WHERE session_id = $1 RETURNING session_id', [session_id]);
    
    if (deleteResult.rowCount > 0) {
        console.log(`[API] Session ${session_id} ended and deleted successfully.`);
        res.status(200).json({ message: 'Session deleted' });
    } else {
        console.warn(`[API] Delete command ran but no rows affected for session ${session_id}`);
        // Consider it success if it's already gone
        res.status(200).json({ message: 'Session likely already deleted' });
    }
  } catch (err) {
    console.error('Error deleting session:', err);
    // If it's a foreign key violation or other DB error, send 500
    res.status(500).json({ error: 'Server error' });
  }
};

const getSessionByTable = async (req, res) => {
  const { table_token } = req.params;
  try {
    const geoGate = await validateSessionTempGeoAccess(req, {
      table_token,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoGate.passed) {
      return res.status(geoGate.status || 410).json(geoGate.response_body);
    }

    // Only return sessions that are explicitly waiting for a partner (Dual Mode)
    // This allows multiple Single Mode sessions to coexist without blocking each other
    // and allows Phone C to start a new session even if A & B are paired.
    const query = `SELECT * FROM sessions 
                   WHERE table_token = $1 
                   AND expires_at > NOW() 
                   AND dual_status = 'waiting'
                   ORDER BY created_at DESC LIMIT 1`;
    const result = await db.query(query, [table_token]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No waiting session found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting session by table:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const heartbeat = async (req, res) => {
  const { session_id } = req.params;
  const { participant_id } = req.body;

  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const sesh = await db.query(
      `SELECT table_token, restaurant_id FROM sessions WHERE session_id = $1`,
      [session_id]
    );
    if (sesh.rows.length > 0) {
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: sesh.rows[0].table_token,
        restaurant_id: sesh.rows[0].restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
    }

    // Update both session and participant activity
    await db.query(`
      UPDATE sessions SET last_activity_at = NOW() WHERE session_id = $1
    `, [session_id]);

    if (participant_id) {
      await db.query(`
        UPDATE session_participants SET last_seen_at = NOW() WHERE participant_id = $1
      `, [participant_id]);
    }

    res.status(204).send();
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const resumeSessionByQr = async (req, res) => {
  const { table_token, restaurant_id, restaurant_slug, participant_token } = req.body;

  if (!table_token || !participant_token) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const geoGate = await validateSessionTempGeoAccess(req, {
      table_token,
      restaurant_id,
      restaurant_slug
    });
    if (!geoGate.passed) {
      return res.status(geoGate.status || 410).json(geoGate.response_body);
    }

    const participantTokenHash = crypto.createHash('sha256').update(participant_token).digest('hex');
    const resolvedRestaurantId = await resolveAuthorizedRestaurantId(req, restaurant_id, restaurant_slug);

    // Find active session for this table where the participant belongs
    // Join sessions and session_participants
    const result = await db.query(`
      SELECT s.*, sp.participant_id, sp.role
      FROM sessions s
      JOIN session_participants sp ON s.session_id = sp.session_id
      WHERE s.table_token = $1
        AND s.restaurant_id = $2
        AND sp.participant_token_hash = $3
        AND s.expires_at > NOW()
      ORDER BY 
          CASE WHEN s.mode = 'dual-phone' THEN 1 ELSE 2 END,
          s.created_at DESC
        LIMIT 1
    `, [table_token, resolvedRestaurantId, participantTokenHash]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active session found for this participant.' });
    }

    const session = result.rows[0];

    res.json({
      session_id: session.session_id,
      participant_id: session.participant_id,
      role: session.role,
      mode: session.mode,
      context: session.context,
      dual_status: session.dual_status
    });
  } catch (err) {
    console.error('Error resuming session by QR:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const resolveSession = async (req, res) => {
  const { restaurant_id, restaurant_slug, table_token, device_token, prefer_new_session } = req.body;

  // Strict explicit intent: only a literal boolean true activates the bypass.
  // Strings such as "true" or numeric 1 must not enable it.
  const preferNewSession = prefer_new_session === true;

  if (!table_token) {
    return res.status(400).json({ error: 'table_token is required' });
  }

  try {
    // Temp-access geolocation gate: explicit 410/401 if a present token has
    // expired or is invalid for this restaurant/table combination.
    const geoGate = await validateSessionTempGeoAccess(req, {
      table_token,
      restaurant_id,
      restaurant_slug
    });
    if (!geoGate.passed) {
      return res.status(geoGate.status || 410).json(geoGate.response_body);
    }

    const resolvedRestaurantId = await resolveAuthorizedRestaurantId(req, restaurant_id, restaurant_slug);

    // 1. Attempt Resume by Device Token
    if (device_token) {
      const participantTokenHash = crypto.createHash('sha256').update(device_token).digest('hex');

      const expiredResult = await db.query(`
        UPDATE sessions s
        SET fresh_intent_a = FALSE,
            fresh_intent_b = FALSE,
            fresh_intent_at = NULL
        FROM session_participants sp
        WHERE s.session_id = sp.session_id
          AND sp.participant_token_hash = $1
          AND (
            (s.fresh_intent_a = TRUE AND COALESCE(s.fresh_intent_b, FALSE) = FALSE)
            OR (COALESCE(s.fresh_intent_a, FALSE) = FALSE AND s.fresh_intent_b = TRUE)
          )
          AND s.fresh_intent_at <= NOW() - INTERVAL '5 minutes'
          AND s.dual_status != 'ended'
        RETURNING s.session_id
      `, [participantTokenHash]);

      // Now check if they have ANY active session anywhere for this restaurant
      const anyActiveSession = await db.query(`
        SELECT s.session_id, s.table_token, s.mode, s.dual_status, sp.role
        FROM sessions s
        JOIN session_participants sp ON s.session_id = sp.session_id
        WHERE sp.participant_token_hash = $1
          AND s.restaurant_id = $2
          AND s.expires_at > NOW()
          AND (s.dual_status IS NULL OR s.dual_status != 'ended')
        ORDER BY 
          CASE WHEN s.mode = 'dual-phone' THEN 1 ELSE 2 END,
          s.created_at DESC
        LIMIT 1
      `, [participantTokenHash, resolvedRestaurantId]);

      if (anyActiveSession.rows.length > 0) {
        const activeSession = anyActiveSession.rows[0];
        
        // If it's the SAME table, resume normally
        if (activeSession.table_token === table_token) {
           // Simplified flow: if this is a dual-phone session with only one Start Fresh
           // press that is ALREADY older than 20 seconds (timeout window expired), do
           // NOT resume it — treat as ended and let user start a brand new session.
           // This covers the edge case where both the server setTimeout + join_session
           // didn't run (backend restart + partner never reconnected within 20s window).
           // Relies on existing fresh_intent_at/fresh_intent_a/b columns — no schema.
           if (activeSession.mode === 'dual-phone') {
             const stale = await db.query(
               `SELECT fresh_intent_a, fresh_intent_b, fresh_intent_at, dual_group_id, restaurant_id,
                       pairing_code_hash, pairing_expires_at
                FROM sessions WHERE session_id = $1`,
               [activeSession.session_id]
             );
             const sf = stale.rows[0];
             if (sf) {
               const onlyOne = Boolean(sf.fresh_intent_a) !== Boolean(sf.fresh_intent_b);
               const over = sf.fresh_intent_at && (Date.now() - new Date(sf.fresh_intent_at).getTime() >= 20 * 1000);
               // An unredeemed pairing attempt (Phone B never joined) whose own
               // 5-minute pairing_expires_at has passed is equally stale, even
               // though no fresh_intent was ever pressed. Without this check a
               // rescan in the gap before the cleanup cron tick runs would
               // resume the dead pairing-code/"waiting" screen.
               const pairingNeverRedeemed = Boolean(sf.pairing_code_hash);
               const pairingExpired = pairingNeverRedeemed && sf.pairing_expires_at &&
                 new Date(sf.pairing_expires_at).getTime() <= Date.now();
               if ((onlyOne && over) || pairingExpired) {
                 try {
                   await db.query(`
                     UPDATE sessions
                     SET dual_status = 'ended', expires_at = NOW(),
                         pairing_code_hash = NULL, pairing_expires_at = NULL
                     WHERE session_id = $1
                   `, [activeSession.session_id]);
                   if (sf.dual_group_id) {
                     try { await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [sf.dual_group_id]); } catch (_) {}
                     try { await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1`, [sf.dual_group_id]); } catch (_) {}
                   }
                 } catch (_) {}
                 // Skip resume; fall through to start_new_session path below.
               } else {
                 // Inside 20s window or no one-sided Start Fresh → normal resume.
                 // Before resuming, check if this user has a pending "fresh_intent" that
                 // they are trying to bypass by rescanning; clear their intent so the
                 // ongoing dual session with their partner resumes seamlessly.
                 const intentField = activeSession.role === 'A' ? 'fresh_intent_a' : 'fresh_intent_b';
                 await db.query(`
                   UPDATE sessions 
                   SET ${intentField} = FALSE 
                   WHERE session_id = $1
                 `, [activeSession.session_id]);
                 
                 // If both are false now, clear the timestamp
                 await db.query(`
                   UPDATE sessions 
                   SET fresh_intent_at = NULL 
                   WHERE session_id = $1 AND fresh_intent_a = FALSE AND fresh_intent_b = FALSE
                 `, [activeSession.session_id]);
               }
             }
           } else {
             // Non-dual: clear my own fresh_intent before resume (defensive)
             const intentField = activeSession.role === 'A' ? 'fresh_intent_a' : 'fresh_intent_b';
             await db.query(`
               UPDATE sessions 
               SET ${intentField} = FALSE 
               WHERE session_id = $1
             `, [activeSession.session_id]);
             await db.query(`
               UPDATE sessions 
               SET fresh_intent_at = NULL 
               WHERE session_id = $1 AND fresh_intent_a = FALSE AND fresh_intent_b = FALSE
             `, [activeSession.session_id]);
           }

           // Exclude 'ended' here on purpose: the stale-intent/stale-pairing
           // block just above may have ended this very session a moment ago,
           // and that must fall through to the start_new path below instead
           // of resuming the now-dead session.
           const resumeResult = await db.query(`
            SELECT s.session_id, s.mode, s.context, s.created_at, sp.participant_id, sp.role, s.dual_group_id, s.dual_status
            FROM sessions s
            JOIN session_participants sp ON s.session_id = sp.session_id
            WHERE s.session_id = $1 AND sp.participant_token_hash = $2
              AND (s.dual_status IS NULL OR s.dual_status != 'ended')
           `, [activeSession.session_id, participantTokenHash]);
           
           if (resumeResult.rows.length > 0) {
             const session = resumeResult.rows[0];
             return res.json({
               action: 'resume',
               session_id: session.session_id,
               mode: session.mode,
               role: session.role, 
               context: session.context,
               participant_id: session.participant_id,
               created_at: session.created_at 
             });
           }
        } else {
           // It's a DIFFERENT table, and the old session is still active
           // Check if this user has already expressed intent to leave (Start Fresh)
           // If so, and the other user is gone (disconnected), we should allow them to leave.
           // BUT the rule says "5 min timeout".
           // However, if BOTH are disconnected?
           // The query `anyActiveSession` checks `s.expires_at > NOW()`.
           // If the session is active, it means it hasn't expired.
           
           // Let's check if the OTHER participant is disconnected.
           // If I am trying to scan a NEW table, and my old session is active, but my partner is disconnected...
           // Should I be blocked? "Wait for your partner to leave".
           // Yes, blocked until 5 min timeout kills the session.
           
           // What if *I* already pressed Start Fresh (fresh_intent_X = TRUE)?
           // If I pressed Start Fresh, I am waiting for partner to confirm.
           // If partner is still there (connected), I am blocked.
           // If partner is disconnected, I am blocked until timeout.
           
           // The user says: "When both phone logged out, they should be able to scan a new QR code, instantly".
           // "Logged out" means pressing Start Fresh.
           // If BOTH pressed Start Fresh, `fresh_intent` handler sets `expires_at = NOW()`.
           // So `anyActiveSession` query should NOT return it.
           // So they should be allowed.
           
           // CASE: Phone A presses Start Fresh. Phone B presses Start Fresh.
           // -> Session ends.
           // -> Phone A scans new table.
           // -> `anyActiveSession` returns empty (because `expires_at` is NOW/past).
           // -> Proceeds to Create New Session.
           
           // So why does the user think it's not instant?
           // Maybe the update to `expires_at` in `index.js` is not committing or is race-conditiony?
           // Or maybe `dual_status` check in `anyActiveSession` query is failing?
           // Query: `AND (s.dual_status IS NULL OR s.dual_status != 'ended')`
           // `fresh_intent` sets `dual_status = 'ended'`.
           
           // So if both press it, it should work.
           
           // Maybe the user means: Phone A presses Start Fresh. Phone B is *already* gone (disconnected, but didn't press Start Fresh).
           // "When both phone logged out". "Logged out" is ambiguous.
           // If B just closed the tab, `fresh_intent_b` is false.
           // So session is active.
           // A is blocked.
           
           // If user says "When both phone logged out... instantly", maybe they mean:
           // If A logs out, and B is *disconnected*, it should end?
           // "Phone A is prevent... applied when Phone B is still in the session... but When both phone logged out".
           // This phrasing strongly implies "Both A and B performed the logout action".
           
           // Wait!
           // "Start Fresh" clears local storage on the client side (`clearStoredParticipant`).
           // If A clears storage, they lose `device_token`.
           // If B clears storage, they lose `device_token`.
           // If both clear storage, then when they scan a new code, `device_token` is null (or new).
           // If `device_token` is new/null, `resolveSession` skips the "Attempt Resume" block!
           // It goes straight to Step 2 (Join Dual) or Step 3 (Start New).
           
           // So if "Start Fresh" works correctly on frontend (clears storage), the backend doesn't even know it's them!
           // So they should be able to scan instantly!
           
           // WHY is A blocked?
           // "Phone A is prevent to access new session... that's great!"
           // This means `device_token` MUST be preserved or identifying them somehow.
           // Ah! In `SessionGame.jsx`: `handleRestart`:
           // `// Remove clearStoredParticipant to remember device token so server can block/resume them`
           // `// clearStoredParticipant();`
           // I commented out `clearStoredParticipant` in a previous turn to implement blocking!
           // So the token IS persisted.
           
           // So A has token. Backend finds active session. Blocked. Correct.
           // B presses Start Fresh. Token persisted. Backend finds session?
           // NO, backend terminates session. `dual_status='ended'`.
           // So `anyActiveSession` query (`status != 'ended'`) returns 0 rows.
           // So A should be free.
           
           // Is it possible that `index.js` `fresh_intent` logic is NOT setting `dual_status = 'ended'`?
           // I see:
           // `UPDATE sessions SET dual_status = 'ended', expires_at = NOW() ...`
           // It seems correct.
           
           // Is it possible `anyActiveSession` query is finding *another* session?
           // Unlikely.
           
           // Let's look at `index.js` line 559.
           // `const endResult = await db.query(...)`.
           // It updates.
           
           // What if the frontend "Start Fresh" isn't emitting `fresh_intent` correctly?
           // In `SessionMenu.jsx` (I need to check it), "Start Fresh" emits `fresh_intent`.
           
           // Let's assume the user is correct and something is wrong.
           // Maybe the query in `resolveSession` has a bug?
           // `AND (s.dual_status IS NULL OR s.dual_status != 'ended')`
           // If `dual_status` becomes 'ended', this condition fails -> row excluded -> No active session -> Allowed.
           
           // Wait. "When Phone A press Start at Fresh... Phone A is prevent... applied when Phone B is still in the session...".
           // This implies A pressed it, B hasn't. Session active. A blocked.
           // "When both phone logged out, they should be able to scan a new QR code, instantly".
           // This implies A pressed, B pressed. Session ended. A blocked?
           // If A is blocked *after* B pressed, then `dual_status` update failed OR query is wrong.
           
           // Let's verify `fresh_intent` handler in `index.js`.
           // It listens on `socket.on('fresh_intent', ...)`.
           // It checks `if (fresh_intent_a && fresh_intent_b)`.
           
           // Maybe `fresh_intent_b` isn't being set because B is "logged out"?
           // If B presses "Start Fresh", they emit `fresh_intent`.
           // BUT, if A already pressed it, A is redirected to Home. A's socket disconnects.
           // Does A's `fresh_intent_a` flag persist in DB? Yes, `UPDATE sessions SET fresh_intent_a = TRUE`.
           // So when B emits, `fresh_intent_a` is true in DB.
           // `fresh_intent_b` becomes true.
           // Both true -> Terminate.
           
           // Wait, I see `// Clear any pending Fresh Intent for this user (they are back!)` in `join_session` handler.
           // If A scans a NEW QR code while blocked...
           // `resolveSession` returns `blocked_active_session`.
           // Client stays on "Blocked" modal.
           // Does this trigger `join_session`? No.
           // But if A scans the *OLD* QR code?
           // `resolveSession` returns `resume`.
           // Client joins session.
           // `join_session` handler runs.
           // `UPDATE sessions SET fresh_intent_a = FALSE`.
           // So if A retries the OLD table, they clear their intent.
           // But if they scan a NEW table, they are blocked, and intent remains TRUE.
           
           // So if A scans New Table -> Blocked. Intent A = True.
           // B presses Start Fresh -> Intent B = True.
           // Session ends.
           // A scans New Table -> Should be allowed.
           
           // Is it possible the "Blocked" popup prevents A from scanning again?
           // "The 5 min waiting period ... is applied when Phone B is still in the session ... but When both phone logged out, they should be able to scan a new QR code, instantly".
           
           // Maybe the user is observing that *Phone B* is blocked?
           // If B presses Start Fresh, session ends immediately. B is redirected.
           // B scans new table.
           // Old session ended. B allowed.
           
           // Is there any 5 minute timer involved in the "Both logged out" case?
           // Only `cleanup.js` or `resolveSession` stale check.
           
           // Let's look at `resolveSession` again.
           // `AND s.fresh_intent_at <= NOW() - INTERVAL '5 minutes'`
           // This is for *terminating* stale sessions.
           
           // Maybe the issue is:
           // A logs out. A is blocked.
           // B logs out. Session ends.
           // A scans.
           // Is A's `device_token` still associated with the ended session?
           // Yes, in `session_participants`.
           // But `resolveSession` query filters `s.dual_status != 'ended'`.
           
           // WAIT!
           // `AND (s.dual_status IS NULL OR s.dual_status != 'ended')`
           // If `dual_status` is 'ended', this returns FALSE.
           // So `anyActiveSession` returns nothing.
           // So A is allowed.
           
           // Is it possible `dual_status` is NOT 'ended'?
           // In `index.js`, `fresh_intent` sets it to 'ended'.
           
           // Let's try to enforce the termination more aggressively?
           // Or maybe there is a client-side issue?
           // If A is on the "Blocked" screen, they need to close it to scan again.
           
           // What if "When both phone logged out" means "A logged out, then B logged out"?
           // Maybe the user thinks they are still blocked because they see the message *from the previous scan*?
           
           // Let's assume there is a bug in `index.js`.
           // `const { fresh_intent_a, fresh_intent_b } = updateResult.rows[0];`
           // `if (fresh_intent_a && fresh_intent_b)`
           
           // If A emits, A disconnects.
           // B emits.
           // `updateResult` returns the ROW.
           // Does `RETURNING fresh_intent_a` return the *current* DB value (including A's true)?
           // Yes.
           
           // I will add a check in `resolveSession` to explicitely ignore 'ended' sessions to be 100% sure.
           // It is already there.
           
           // Let's look at `resolveSession` again.
           // `AND s.expires_at > NOW()`
           // `fresh_intent` sets `expires_at = NOW()`.
           // So `expires_at > NOW()` is FALSE.
           // So it is excluded.
           
           // Could it be that `NOW()` precision causes issues?
           // `expires_at = NOW()` might be equal to `NOW()` in the query?
           // `expires_at > NOW()`: if equal, it's false. So excluded. Correct.
           
           // Maybe the "5 min waiting period" refers to something else?
           // "Phone A is prevent to access new session ... but the 5 min waiting period to be a ble to scan a new QR code is applied when Phone B is still in the session".
           // This describes the "Blocking" feature working correctly (A waits for B).
           // "When both phone logged out, they should be able to scan a new QR code, instantly".
           
           // Is it possible that B's logout isn't triggering `fresh_intent`?
           // If B clicks "Start Fresh", does it emit `fresh_intent`?
           // I need to check `SessionMenu.jsx`.
           
           // If `SessionMenu.jsx` disconnects socket *before* emitting?
           // Or if it uses HTTP to logout?
           // If it uses HTTP, `index.js` socket handler won't run.
           // I don't see a `logout` HTTP endpoint in `sessionController`.
           // So it must be socket.
           
           // Let's check `SessionMenu.jsx`.
           
           // Also, I will add a failsafe in `resolveSession`.
           // If `fresh_intent_a` AND `fresh_intent_b` are true in DB, but `dual_status` is somehow NOT 'ended' (race condition?), we should treat it as ended.
           
           if (activeSession.mode === 'dual-phone') {
              return res.json({
                 action: 'blocked_active_session',
                 reason: 'You have an active Dual session at another table. Wait for your partner to leave, or return to your original table.'
              });
           }
        }
      }
    }

            // 2. Unknown-device Dual-Phone Discovery
        //
        // Unknown devices never receive a target session_id and never reclaim
        // an existing participant role. Admission to Phone B requires the
        // four-letter pairing code through /join-dual.
        //
        // A live pairing hash distinguishes an initial waiting session from
        // Start Fresh, which may also temporarily use dual_status='waiting'.
        const pairingOpportunity = await db.query(`
          SELECT 1
          FROM sessions
          WHERE table_token = $1
            AND restaurant_id = $2
            AND mode = 'dual-phone'
            AND dual_status = 'waiting'
            AND pairing_code_hash IS NOT NULL
            AND pairing_expires_at > NOW()
            AND expires_at > NOW()
          LIMIT 1
        `, [table_token, resolvedRestaurantId]);

        if (pairingOpportunity.rows.length > 0 && !preferNewSession) {
          return res.json({
            action: 'enter_join_code'
          });
        }

        // An unknown third phone cannot inherit/reclaim a participant seat.
        // It may start its own independent session.
        const activeDualSession = await db.query(`
          SELECT 1
          FROM sessions
          WHERE table_token = $1
            AND restaurant_id = $2
            AND mode = 'dual-phone'
            AND dual_status = 'paired'
            AND expires_at > NOW()
          LIMIT 1
        `, [table_token, resolvedRestaurantId]);

        if (activeDualSession.rows.length > 0) {
          return res.json({
            action: 'start_new',
            reason: 'dual_session_full'
          });
        }
// 3. Start New Session
    // No resume, no waiting dual session -> Start New
    return res.json({
      action: 'start_new'
    });

  } catch (err) {
    console.error('Error resolving session:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const getSessionState = async (req, res) => {
  const { session_id } = req.params;
  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (sessionResult.rows.length > 0) {
      const s = sessionResult.rows[0];
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: s.table_token,
        restaurant_id: s.restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
    }
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = sessionResult.rows[0];
    const participantId = req.query.participant_id;

    if (participantId && session.mode === 'dual-phone' && session.dual_status !== 'ended') {
      const p = await db.query(
        `SELECT last_seen_at FROM session_participants WHERE session_id = $1 AND participant_id = $2`,
        [session_id, participantId]
      );
      if (p.rows.length === 0) {
        return res.status(403).json({ error: 'Invalid participant' });
      }
      const lastSeen = p.rows[0].last_seen_at ? new Date(p.rows[0].last_seen_at) : null;
      if (!lastSeen || Date.now() - lastSeen.getTime() > 15 * 60 * 1000) {
        return res.status(403).json({ error: 'INACTIVE' });
      }
    }

    // Get current question (position_index)
    let position_index = 0;
    if (session.context) {
      const today = new Date().toISOString().split('T')[0];
      const deckResult = await db.query(
        `SELECT position_index FROM deck_sessions 
         WHERE restaurant_id = $1 AND table_token = $2 AND relationship_context = $3 AND service_day = $4 AND session_group_id = $5`,
        [session.restaurant_id || DEFAULT_RESTAURANT_ID, session.table_token, session.context, today, session.session_group_id]
      );
      if (deckResult.rows.length > 0) {
        position_index = deckResult.rows[0].position_index;
      }
    }
    
    // Get current question via Deck Service
    // This handles deck_session lookup, seed usage, and shuffling
    const question = await deckService.getCurrentQuestion({
      restaurant_id: session.restaurant_id || DEFAULT_RESTAURANT_ID,
      table_token: session.table_token,
      context: session.context,
      session_group_id: session.session_group_id
    });
    
    // Check if partner ever joined
    const participantsResult = await db.query('SELECT role FROM session_participants WHERE session_id = $1', [session_id]);
    const hasPartnerJoined = participantsResult.rows.length > 1;
    const oneSidedFresh = Boolean(session.fresh_intent_a) !== Boolean(session.fresh_intent_b);
    const waitingReason =
      session.dual_status === 'waiting'
        ? (session.fresh_intent_a || session.fresh_intent_b)
          ? 'partner_fresh'
          : hasPartnerJoined
            ? 'partner_single'
            : 'initial'
        : null;
    const secondsRemaining =
      oneSidedFresh && session.fresh_intent_at
        ? Math.max(0, 20 - Math.floor((Date.now() - new Date(session.fresh_intent_at).getTime()) / 1000))
        : null;

    // Pull live synchronization counters from the in-memory socket state.
    // If the server was recently restarted these maps are empty (all 0) but
    // we fall back to a safe heuristic so reconnected clients are not stuck.
    let nextIntentCount = 0;
    let advanceIntentCount = 0;
    let readyCount = 0;
    let conversationStarted = false;
    try {
      // Try multiple channels in order of reliability. require.main is Node's documented
      // way to reach the entry module, but under dev Vite proxy reload / test harnesses
      // require.main can be swapped. As a belt-and-suspenders fallback we also reach the
      // same singleton via a process global set in index.js.
      let snap = null;
      // Path #1: global (most reliable — always attached at index.js boot)
      if (typeof global.__tableTalkSessionStateSnapshot === 'function') {
        snap = global.__tableTalkSessionStateSnapshot(session_id);
      }
      // Path #2: require.main.exports (original path, used in production directly)
      if (!snap && typeof require !== 'undefined' && require.main && require.main.exports && typeof require.main.exports.getSessionStateSnapshot === 'function') {
        snap = require.main.exports.getSessionStateSnapshot(session_id);
      }
      // Path #3: direct relative import (works when this file is loaded from the same node_modules tree)
      if (!snap) {
        try {
          const idx = require('../index');
          if (idx && typeof idx.getSessionStateSnapshot === 'function') {
            snap = idx.getSessionStateSnapshot(session_id);
          }
        } catch (_) { /* avoid circular-require exceptions */ }
      }
      if (snap) {
        nextIntentCount = typeof snap.nextIntentCount === 'number' ? snap.nextIntentCount : 0;
        advanceIntentCount = typeof snap.advanceIntentCount === 'number' ? snap.advanceIntentCount : 0;
        readyCount = typeof snap.readyCount === 'number' ? snap.readyCount : 0;
        conversationStarted = Boolean(snap.conversationStarted);
      }
    } catch (_) { /* ignore — server restarted, maps cleared */ }
    // Safe heuristic fallback if in-memory maps were cleared (server restart):
    // OLD BUG (L1489 REMOVED):
    //   `if (!conversationStarted && position_index > 0) conversationStarted = true;`
    //   This hard-coded conversation_started=true for EVERY QUESTION after the
    //   very first deck position, permanently skipping the "I'm Ready" phase on
    //   Rounds 2+, because deck advance always increments position_index to >=1.
    //   We NEVER infer from position_index alone — only intent counts count for
    //   determining per-question phase state. Each new question STARTS with
    //   "I'm Ready" regardless of how many previous rounds were completed.
    //   Fix per user's explicit 2026-08-30 directive:
    //     "at any new question revealed the flow should start with 'I am Ready'
    //      process then 'Next Question' process then New Question reveal with
    //      'I am Ready' Process then 'Next Question' ......"
    // (If MCQ has been answered there's no explicit DB column for "locked answers
    //  persisted", but since we cleared the intent Sets via clearSessionState
    //  after the MCQ advance_question broadcasted, the NEW open-ended question
    //  at deck position+1 correctly starts at 0/0 intents → "I'm Ready".)
    // If nextIntentCount is >=2 both clicked → conversationStarted = true regardless
    if (nextIntentCount >= 2) {
      conversationStarted = true;
    }
    // OLD BUG (L1507 REMOVED):
    //   `if (advanceIntentCount >= 1) conversationStarted = true;`
    //   Duplicate of index.js L406 OR-clause bug: any single click of Next Question
    //   in the session's entire LIFETIME once rendered conversation_started=true
    //   in HTTP replies (until clearSessionState ran), and clearSessionState and
    //   the state broadcast were racing. Removing this — conversationStarted is
    //   ONLY derived from nextIntentCount >= 2 (both users already Ready'd).
    //   This is the ONLY correct per-question phase definition:
    //     Phase 1 (Ready)    : nextIntentCount 0..1
    //     Phase 2 (Conversation Started) : nextIntentCount >= 2

    res.json({
      session_id: session.session_id,
      mode: session.mode,
      context: session.context,
      dual_status: session.dual_status,
      position_index: position_index,
      current_question: question, // Will be null if deck empty
      has_partner_joined: hasPartnerJoined,
      waiting_reason: waitingReason,
      seconds_remaining: secondsRemaining,
      fresh_intent_at: session.fresh_intent_at
    });
  } catch (err) {
    console.error('Error getting session state:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const freshIntent = async (req, res) => {
  const { session_id } = req.params;
  const { participant_id } = req.body;

  if (!participant_id) {
    return res.status(400).json({ error: 'participant_id is required' });
  }

  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const sesh = await db.query(
      `SELECT table_token, restaurant_id FROM sessions WHERE session_id = $1`,
      [session_id]
    );
    if (sesh.rows.length > 0) {
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: sesh.rows[0].table_token,
        restaurant_id: sesh.rows[0].restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
    }

    // 1. Get Role
    const participant = await db.query(`
      SELECT role FROM session_participants 
      WHERE session_id = $1 AND participant_id = $2
    `, [session_id, participant_id]);

    if (participant.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found in session' });
    }
    const role = participant.rows[0].role;
    
    // 2. Update Intent
    const intentField = role === 'A' ? 'fresh_intent_a' : 'fresh_intent_b';
    
    const updateResult = await db.query(
        `UPDATE sessions 
         SET ${intentField} = TRUE, 
             fresh_intent_at = COALESCE(fresh_intent_at, NOW())
         WHERE session_id = $1 
         RETURNING fresh_intent_a, fresh_intent_b, dual_group_id, table_token`,
        [session_id]
    );
    
    if (updateResult.rows.length === 0) {
       return res.status(404).json({ error: 'Session not found' });
    }
    
    const { fresh_intent_a, fresh_intent_b, dual_group_id, table_token } = updateResult.rows[0];

    // Notify partner via socket if possible and clear any in-flight context change
    // (workflow cleanup on HTTP fresh_intent path when socket handler was skipped).
    const server = require('../index');
    const io = server?.io;
    if (typeof server?.clearPendingContexts === 'function') {
      try { server.clearPendingContexts(session_id); } catch (_) {}
    }
    if (io) {
       io.to(session_id).emit('partner_requested_fresh', { role });
    }

    const shouldTerminate = (fresh_intent_a && fresh_intent_b);

    if (shouldTerminate) {
        console.log(`[API] Terminating session ${session_id}. Mutual: ${fresh_intent_a && fresh_intent_b}`);
        
        await db.query(`
          UPDATE sessions 
          SET dual_status = 'ended', expires_at = NOW() 
          WHERE session_id = $1
        `, [session_id]);
        
        if (dual_group_id) {
            await db.query(`
              UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1
            `, [dual_group_id]);
            await db.query(`
              UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1
            `, [dual_group_id]);
        }
        
        // Log Analytics
        await insertAnalyticsEvent({
          session_id,
          event_type: 'dual_session_terminated_mutual',
          event_data: { source: 'api' }
        });
        
        if (io) {
            io.to(session_id).emit('dual_group_terminated');
        }

    } else {
        try {
          const s = await db.query(`SELECT mode, dual_status FROM sessions WHERE session_id = $1`, [session_id]);
          // Always reflect the waiting state in DB + broadcast it for single-sided Start Fresh.
          // Previously this only ran when dual_status === 'paired', which could be skipped
          // if a single-phone session upgraded to dual-phone had stale/in-flight paired status
          // (e.g. upgrade reload + partner join racing), causing the "Waiting for Partner" screen
          // to never appear on the partner device even though Start Fresh was clearly pressed.
          // Now we flip dual_status to 'waiting' whenever mode is dual-phone and the session
          // isn't already ended.
          if (s.rows[0]?.mode === 'dual-phone' && s.rows[0]?.dual_status !== 'ended') {
            await db.query(`UPDATE sessions SET dual_status = 'waiting' WHERE session_id = $1`, [session_id]);
            // Simplified flow: arm the 20-second auto-termination timer on server (via shared
            // helper exported from index.js). Uses existing fresh_intent_at column — no schema.
            try {
              if (typeof server?.armSingleFreshTimeout === 'function') server.armSingleFreshTimeout(session_id);
            } catch (_) {}
            if (io) {
              io.to(session_id).emit('session_updated', { dual_status: 'waiting', waiting_reason: 'partner_fresh', mode: 'dual-phone', seconds_remaining: 20 });
            }
          }
        } catch (e) {}
    }

    res.json({ success: true, terminated: shouldTerminate });

  } catch (err) {
    console.error('Error handling fresh intent:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Explicit "Cancel & Return to Scanner" for an unredeemed dual-phone pairing
// attempt (Phone B never joined). Also invoked by the frontend's own
// 5-minute pairing countdown on expiry, so this must be idempotent and safe
// to call more than once. Scoped strictly to sessions still in the
// pre-pairing 'waiting' state with a live pairing hash — once Phone B has
// redeemed the code (dual_status = 'paired', pairing_code_hash cleared by
// the atomic redemption), this is a no-op, so a stale cancel/timeout can
// never terminate an already-paired session.
const cancelPairing = async (req, res) => {
  const { session_id } = req.params;
  const { participant_id } = req.body;

  if (!participant_id) {
    return res.status(400).json({ error: 'participant_id is required' });
  }

  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const sesh = await db.query(
      `SELECT table_token, restaurant_id FROM sessions WHERE session_id = $1`,
      [session_id]
    );

    if (sesh.rows.length === 0) {
      return res.status(200).json({ success: true, cancelled: false, reason: 'not_found' });
    }

    const geoScoped = await validateSessionTempGeoAccess(req, {
      table_token: sesh.rows[0].table_token,
      restaurant_id: sesh.rows[0].restaurant_id,
      restaurant_slug: null
    });
    if (!geoScoped.passed) {
      return res.status(geoScoped.status || 410).json(geoScoped.response_body);
    }

    const participant = await db.query(
      `SELECT role FROM session_participants WHERE session_id = $1 AND participant_id = $2`,
      [session_id, participant_id]
    );
    if (participant.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found in session' });
    }

    // Ownership check and mutation happen atomically: the UPDATE itself is
    // also scoped to a participant row that belongs to this session, so a
    // caller can never cancel a pairing attempt it does not own.
    const cancelled = await db.query(`
      UPDATE sessions
      SET dual_status = 'ended', expires_at = NOW(),
          pairing_code_hash = NULL, pairing_expires_at = NULL
      WHERE session_id = $1
        AND mode = 'dual-phone'
        AND dual_status = 'waiting'
        AND pairing_code_hash IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM session_participants sp
          WHERE sp.session_id = sessions.session_id AND sp.participant_id = $2
        )
      RETURNING dual_group_id, restaurant_id, table_token
    `, [session_id, participant_id]);

    if (cancelled.rowCount === 0) {
      // Already paired, already ended, or never a live pairing attempt —
      // nothing to cancel. Idempotent no-op (also protects a paired session
      // from a stale timeout/cancel that arrives just after Phone B joins).
      return res.json({ success: true, cancelled: false });
    }

    const row = cancelled.rows[0];

    if (row.dual_group_id) {
      try { await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]); } catch (_) {}
    }

    try {
      const server = require('../index');
      const io = server?.io;
      if (io) {
        io.to(session_id).emit('dual_group_terminated');
      }
    } catch (_) {}

    await insertAnalyticsEvent({
      session_id,
      participant_id: participant_id || null,
      restaurant_id: row.restaurant_id || null,
      table_token: row.table_token || null,
      event_type: 'pairing_cancelled',
      event_data: { source: 'user_cancel_or_client_timeout' }
    });

    res.json({ success: true, cancelled: true });
  } catch (err) {
    console.error('Error cancelling pairing attempt:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const upgradeToDual = async (req, res) => {
  const { session_id } = req.params;
  const { participant_id } = req.body;

  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const sesh = await db.query(
      `SELECT table_token, restaurant_id FROM sessions WHERE session_id = $1`,
      [session_id]
    );
    if (sesh.rows.length > 0) {
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: sesh.rows[0].table_token,
        restaurant_id: sesh.rows[0].restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
    }

    // Verify participant
    const participant = await db.query(`
      SELECT role FROM session_participants 
      WHERE session_id = $1 AND participant_id = $2
    `, [session_id, participant_id]);

    if (participant.rows.length === 0) {
      console.warn(`[Upgrade] Participant ${participant_id} not found in session ${session_id}`);
      return res.status(404).json({ error: 'Participant not found' });
    }

    // Verify session is single-phone
    const session = await db.query(`
      SELECT mode, table_token, restaurant_id, dual_group_id, dual_status FROM sessions WHERE session_id = $1
    `, [session_id]);

    if (session.rows.length === 0) {
      console.warn(`[Upgrade] Session ${session_id} not found`);
      return res.status(404).json({ error: 'Session not found' });
    }

    const sessionData = session.rows[0];

    if (sessionData.mode === 'dual-phone') {
      // Flow #2 tighten: when switching BACK to Dual (resume), clear any stale
      // context-change intents left over from before the Single→Dual flip so the
      // rejoining user does not see a stale "Change Deck?" modal.
      try {
        const srv = require('../index');
        if (typeof srv?.clearPendingContexts === 'function') srv.clearPendingContexts(session_id);
      } catch (_) {}
      return res.json({ success: true, message: 'Already in dual mode' });
    }

    let newDualStatus = sessionData.dual_status;

    if (!sessionData.dual_group_id) {
        // Create dual group
        // Ensure we import crypto if not already done in the top scope
        const crypto = require('crypto');
        
        // We use crypto.randomUUID() for generation. In environments where it's unavailable, 
        // we use a simple hex generator fallback, since the `uuid` package is an ES Module and 
        // causes require() errors in CommonJS backend.
        let dual_group_id;
        if (typeof crypto.randomUUID === 'function') {
            dual_group_id = crypto.randomUUID();
        } else {
            dual_group_id = crypto.randomBytes(16).toString('hex');
            // Add dashes to make it look like a UUID for Postgres UUID type:
            dual_group_id = dual_group_id.slice(0, 8) + '-' + 
                            dual_group_id.slice(8, 12) + '-' + 
                            dual_group_id.slice(12, 16) + '-' + 
                            dual_group_id.slice(16, 20) + '-' + 
                            dual_group_id.slice(20);
        }
        
        // We insert without active_session_id foreign key first to avoid circular dependency
        // if active_session_id isn't strictly required or if there's a race condition
        // Actually, sessions table already exists. The issue is likely that active_session_id 
        // references sessions(session_id), which is fine, BUT we are getting a 500.
        // Let's wrap in a try-catch to see the exact DB error.
        try {
            const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await db.query(`
              INSERT INTO dual_groups (dual_group_id, restaurant_id, table_token, active_session_id, expires_at)
              VALUES ($1, $2, $3, $4, $5)
            `, [dual_group_id, sessionData.restaurant_id || DEFAULT_RESTAURANT_ID, sessionData.table_token, session_id, expires_at]);
        } catch (dbErr) {
            console.error("DB Error inserting dual_group:", dbErr);
            throw dbErr; // Rethrow to be caught by outer block
        }
        
        newDualStatus = 'waiting';

        // Update session
        await db.query(`
          UPDATE sessions 
          SET mode = 'dual-phone', dual_status = $1, dual_group_id = $2
          WHERE session_id = $3
        `, [newDualStatus, dual_group_id, session_id]);
    } else {
        // It already has a dual_group_id (was previously upgraded to dual).
        // Just flip the mode back. Keep the existing dual_status (e.g., 'paired' or 'waiting').
        await db.query(`
          UPDATE sessions 
          SET mode = 'dual-phone'
          WHERE session_id = $1
        `, [session_id]);
    }

    // Notify via socket
    const io = require('../index').io;
    if (io) {
        // We emit 'session_updated' because SessionGame.jsx already listens to this
        // and calls fetchCurrentQuestion() which will pull the new mode and dual_status.
        io.to(session_id).emit('session_updated', { mode: 'dual-phone', dual_status: newDualStatus });
    }

    res.json({ success: true, mode: 'dual-phone', dual_status: newDualStatus });
  } catch (err) {
    console.error('Error upgrading session:', err);
    // Write error to file for debugging
    const fs = require('fs');
    fs.appendFileSync('error.log', `${new Date().toISOString()} - Error upgrading session: ${err.message}\n${err.stack}\n\n`);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/sessions/events
 * Append-only client-side in-session event stream (render events, menu opens,
 * per-side next intent, etc.). participant_id is required for attribution
 * but the route accepts anonymous_id for extra tracking.
 *
 * Request body:
 *   { event_type, participant_id, session_id?, event_data?, anonymous_id?,
 *     restaurant_id?, table_token?, timestamp? }
 */
const postSessionEvent = async (req, res) => {
  try {
    const geoPreGate = await validateSessionTempGeoAccess(req, {
      table_token: null,
      restaurant_id: null,
      restaurant_slug: null
    });
    if (!geoPreGate.passed) {
      return res.status(geoPreGate.status || 410).json(geoPreGate.response_body);
    }

    const body = req.body || {};
    const eventType = typeof body.event_type === 'string' ? body.event_type.trim().slice(0, 50) : '';
    const sessionId = body.session_id || null;
    const participantId = body.participant_id || null;

    if (!eventType) {
      return res.status(400).json({ error: 'event_type required' });
    }
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id required for in-session events' });
    }
    if (!participantId) {
      return res.status(400).json({ error: 'participant_id required for in-session events' });
    }

    const sessionRes = await db.query(
      `SELECT restaurant_id, table_token FROM sessions WHERE session_id = $1`,
      [sessionId]
    );
    const session = sessionRes.rows && sessionRes.rows[0] ? sessionRes.rows[0] : null;

    if (session) {
      const geoScoped = await validateSessionTempGeoAccess(req, {
        table_token: session.table_token,
        restaurant_id: session.restaurant_id,
        restaurant_slug: null
      });
      if (!geoScoped.passed) {
        return res.status(geoScoped.status || 410).json(geoScoped.response_body);
      }
    }

    const event = await insertAnalyticsEvent({
      event_type: eventType,
      session_id: sessionId,
      participant_id: participantId,
      restaurant_id: body.restaurant_id || session?.restaurant_id || null,
      table_token: (typeof body.table_token === 'string' ? body.table_token : null) || session?.table_token || null,
      anonymous_id: typeof body.anonymous_id === 'string' ? body.anonymous_id : null,
      event_data: body.event_data || null,
      timestamp: body.timestamp || null
    });

    return res.status(201).json({ event_id: event ? event.event_id : null });
  } catch (err) {
    console.error('[sessions/events] post failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { createSession, joinDualPhoneSession, resumeSessionByQr, getSession, updateSession, endSession, getSessionByTable, heartbeat, resolveSession, getSessionState, freshIntent, cancelPairing, upgradeToDual, postSessionEvent };
