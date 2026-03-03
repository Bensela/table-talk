const db = require('../db');
const deckService = require('../services/deckService');

const crypto = require('crypto');

const SESSION_DURATION_HOURS = 24;

// --- Helper Functions ---

function generatePairingCode() {
  // Generate cryptographically random 6-digit code
  const buffer = crypto.randomBytes(3);
  const code = parseInt(buffer.toString('hex'), 16) % 1000000;
  return code.toString().padStart(6, '0');
}

function hashPairingCode(code, sessionId, salt = process.env.SECRET_SALT || 'default_salt') {
  return crypto
    .createHash('sha256')
    .update(code + sessionId + salt)
    .digest('hex');
}

// --- Controller Functions ---

const createSession = async (req, res) => {
  // Support both legacy table_id and new table_token
  const table_token = req.body.table_token || req.body.table_id;
  const { restaurant_id, context, mode } = req.body;

  if (!table_token) {
    return res.status(400).json({ error: 'table_token is required' });
  }

  // Optional: Validate context and mode if provided
  if (context && !['Exploring', 'Established', 'Mature'].includes(context)) {
    return res.status(400).json({ error: 'Invalid context' });
  }
  
  if (mode && !['single', 'dual', 'single-phone', 'dual-phone'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  try {
    // 1. Determine Session Group
    // Always create a new group for a new session creation request.
    // Auto-joining logic has been removed to allow "Start New Session" to work predictably.
    const sessionGroupId = crypto.randomUUID();
    const isNewGroup = true;

    // 2. Prepare Session Data
    // Persistent Architecture: No expiration (Set to year 9999)
    const expires_at = new Date('9999-12-31T23:59:59Z');
    
    // Instant Join Architecture: No verification codes
    let pairingCode = null;
    let pairingCodeHash = null;
    let pairingExpiresAt = null;
    let dualStatus = null;

    // 3. Handle Dual-Phone Logic
    if (mode === 'dual-phone') {
      dualStatus = 'waiting';
      // No pairing code generation
    }

    // Generate explicit UUID for session
    const sessionId = crypto.randomUUID();

    // 4. Ensure deck session exists (seed generation)
    if (context) {
      // Pass sessionGroupId to deck service if updated to support it
      // For now, keep existing call but note deckService might need update
      await deckService.getDeckSession(restaurant_id || 'default', table_token, context, sessionGroupId);
    }

    // 5. Create Session
    console.log(`[API] Creating session for table ${table_token} (Group: ${sessionGroupId})`);
    const newSession = await db.query(
      `INSERT INTO sessions 
       (session_id, table_token, restaurant_id, context, mode, session_group_id, 
        pairing_code_hash, pairing_expires_at, dual_status, expires_at, table_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
       RETURNING *`,
      [
        sessionId,
        table_token, 
        restaurant_id || 'default', 
        context || 'Exploring', 
        mode || 'single-phone',
        sessionGroupId,
        pairingCodeHash,
        pairingExpiresAt,
        dualStatus,
        expires_at,
        table_token // Legacy support
      ]
    );
    
    // Log Session Group Creation/Join
    if (isNewGroup) {
       await db.query(
        `INSERT INTO analytics_events (session_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [sessionId, 'session_group_created', { session_group_id: sessionGroupId, table_token, context }]
      );
    } else {
       await db.query(
        `INSERT INTO analytics_events (session_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [sessionId, 'session_joined_existing_group', { session_group_id: sessionGroupId }]
      );
    }

    // 6. Create Participant
    const participantId = crypto.randomUUID();
    const participantToken = crypto.randomBytes(32).toString('hex');
    const participantTokenHash = crypto.createHash('sha256').update(participantToken).digest('hex');

    await db.query(
      `INSERT INTO session_participants (participant_id, session_id, role, participant_token_hash)
       VALUES ($1, $2, $3, $4)`,
      [participantId, sessionId, 'A', participantTokenHash] // First user is Role A
    );

    // 7. Log analytics
    if (mode === 'dual-phone') {
      await db.query(
        `INSERT INTO analytics_events (session_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [sessionId, 'join_code_generated', { expires_at: pairingExpiresAt }]
      );
    }

    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [sessionId, 'session_created', { table_token, context, mode, session_group_id: sessionGroupId }]
    );

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
  const { table_token, restaurant_id } = req.body; // No code required

  try {
    // 1. Find waiting sessions for this table
    // Persistent Architecture: Ignore expiration checks (effectively)
    const waitingSessions = await db.query(`
      SELECT session_id, pairing_code_hash, context, session_group_id, mode
      FROM sessions
      WHERE table_token = $1
        AND restaurant_id = $2
        AND dual_status = 'waiting'
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `, [table_token, restaurant_id || 'default']);

    // 2. Auto-Select First Waiting Session (Instant Join)
    let validSession = null;
    if (waitingSessions.rows.length > 0) {
        validSession = waitingSessions.rows[0];
    }

    if (!validSession) {
      return res.status(404).json({ error: 'No waiting session found to join.' });
    }

    // 3. Update Session Status
    // No code hash to clear
    await db.query(`
      UPDATE sessions 
      SET dual_status = 'paired'
      WHERE session_id = $1
    `, [validSession.session_id]);

    // 4. Create Participant (Role B)
    const participantId = crypto.randomUUID();
    const participantToken = crypto.randomBytes(32).toString('hex');
    const participantTokenHash = crypto.createHash('sha256').update(participantToken).digest('hex');

    try {
      await db.query(
        `INSERT INTO session_participants (participant_id, session_id, role, participant_token_hash)
         VALUES ($1, $2, $3, $4)`,
        [participantId, validSession.session_id, 'B', participantTokenHash]
      );
    } catch (err) {
      if (err.code === '23505') { // Unique constraint violation (session_id, role)
         return res.status(409).json({ error: 'SESSION_FULL' });
      }
      throw err;
    }

    // 5. Log analytics
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [validSession.session_id, 'session_paired', { role: 'B' }]
    );
    
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [validSession.session_id, 'join_code_used', { success: true }]
    );

    res.json({
      session_id: validSession.session_id,
      participant_id: participantId,
      participant_token: participantToken,
      session_group_id: validSession.session_group_id,
      context: validSession.context,
      mode: validSession.mode,
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
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
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
        [session.restaurant_id || 'default', session.table_token, session.context, today, session.session_group_id]
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
  const { mode, position_index } = req.body; // Support mode and position_index updates

  try {
    let updatedSession = null;

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
      await db.query(
        `INSERT INTO analytics_events (session_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [session_id, 'mode_selected', { mode }]
      );
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
          [position_index, session.restaurant_id || 'default', session.table_token, session.context, today, session.session_group_id]
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
  // DEPRECATED for Persistent Architecture
  // This endpoint now simply returns success without deleting data, 
  // ensuring historical sessions remain accessible as requested.
  // It might log the "end" intent but won't destroy the session.
  const { session_id } = req.params;
  console.log(`[API] End session requested for ${session_id} - Ignored (Persistent Mode)`);
  res.status(200).json({ message: 'Session preserved' });
};

const getSessionByTable = async (req, res) => {
  const { table_token } = req.params;
  try {
    const query = `SELECT * FROM sessions 
                   WHERE table_token = $1 
                   AND expires_at > NOW() 
                   ORDER BY created_at DESC LIMIT 1`;
    const result = await db.query(query, [table_token]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active session found' });
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
  const { table_token, restaurant_id, participant_token } = req.body;

  if (!table_token || !participant_token) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const participantTokenHash = crypto.createHash('sha256').update(participant_token).digest('hex');

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
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [table_token, restaurant_id || 'default', participantTokenHash]);

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

module.exports = { createSession, joinDualPhoneSession, resumeSessionByQr, getSession, updateSession, endSession, getSessionByTable, heartbeat };
