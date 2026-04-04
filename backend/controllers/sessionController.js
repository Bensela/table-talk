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
    const sessionGroupId = crypto.randomUUID();
    const isNewGroup = true;

    // 2. Prepare Session Data (Expire 24 hours from now to prevent timezone bugs)
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    // Remove pairing code generation entirely per new requirements
    const pairingCode = null;
    const pairingCodeHash = null;
    const pairingExpiresAt = null;
    let dualStatus = null;

    // 3. Handle Dual-Phone Logic
    let dualGroupId = null;
    if (mode === 'dual-phone') {
      dualStatus = 'waiting';
      // Create a new Dual Group ID for this new pair
      dualGroupId = crypto.randomUUID();
    }

    // Generate explicit UUID for session to use in hash
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
        pairing_code_hash, pairing_expires_at, dual_status, expires_at, table_id, dual_group_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
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
        table_token, // Legacy support
        dualGroupId // New field
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

    // Notify Setup Channel that session is created
    // This releases any waiting users (Phone B)
    try {
        const { io } = require('../index');
        if (io) {
            io.to(`setup_${table_token}`).emit('setup_completed', { 
                mode, 
                sessionId,
                sessionGroupId 
            });
            // Note: The setup lock will be cleared when Phone A disconnects from setup room
            // or we can explicitly clear it if we exposed a clearLock function.
            // But relying on socket disconnect/release from client is fine.
        }
    } catch (e) {
        console.warn('Could not emit setup_completed event:', e);
    }

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
  const { table_token, restaurant_id, session_id, reclaim_role } = req.body;

  try {
    let validSession = null;

    if (session_id) {
      // Direct join by ID (preferred)
      const result = await db.query(`
        SELECT * FROM sessions 
        WHERE session_id = $1 
          AND (dual_status = 'waiting' OR (dual_status = 'paired' AND $2::text IS NOT NULL))
          AND expires_at > NOW()
      `, [session_id, reclaim_role || null]);
      
      if (result.rows.length > 0) validSession = result.rows[0];
    } else if (table_token) {
      // Find latest waiting session
      const result = await db.query(`
        SELECT * FROM sessions
        WHERE table_token = $1
          AND restaurant_id = $2
          AND dual_status = 'waiting'
          AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1
      `, [table_token, restaurant_id || 'default']);

      if (result.rows.length > 0) validSession = result.rows[0];
    }

    if (!validSession) {
      return res.status(404).json({ error: 'No waiting session found to join.' });
    }

    // 3. Update Session Status
    if (!reclaim_role) {
        // Ensure we are the first to claim Role B
        const updateResult = await db.query(`
          UPDATE sessions 
          SET dual_status = 'paired', pairing_code_hash = NULL, pairing_expires_at = NULL 
          WHERE session_id = $1 AND dual_status = 'waiting'
          RETURNING *
        `, [validSession.session_id]);

        if (updateResult.rowCount === 0) {
          // Race condition: Someone else grabbed it just now
          return res.status(409).json({ error: 'SESSION_FULL' });
        }
    } else {
        // We are reclaiming a disconnected role
        // Delete the old disconnected participant
        await db.query(`
          DELETE FROM session_participants
          WHERE session_id = $1 AND role = $2 AND disconnected_at IS NOT NULL
        `, [validSession.session_id, reclaim_role]);
    }

    // 4. Create Participant (Role B or Reclaimed Role)
    const assignedRole = reclaim_role || 'B';
    const participantId = crypto.randomUUID();
    const participantToken = crypto.randomBytes(32).toString('hex');
    const participantTokenHash = crypto.createHash('sha256').update(participantToken).digest('hex');

    try {
      await db.query(
        `INSERT INTO session_participants (participant_id, session_id, role, participant_token_hash)
         VALUES ($1, $2, $3, $4)`,
        [participantId, validSession.session_id, assignedRole, participantTokenHash]
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
      [validSession.session_id, 'auto_join_success', { success: true }]
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
  const { mode, position_index, context } = req.body; // Support mode, context and position_index updates

  try {
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
          updatedSession.restaurant_id || 'default', 
          updatedSession.table_token, 
          context, 
          updatedSession.session_group_id
      );

      // Log analytics
      await db.query(
        `INSERT INTO analytics_events (session_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [session_id, 'context_changed', { context }]
      );
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
      await db.query(
        `INSERT INTO analytics_events (session_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [session_id, 'mode_selected', { mode }]
      );
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
  const { session_id } = req.params;
  try {
    console.log(`[API] Explicitly ending session ${session_id}...`);

    // 1. Get Session Details first to find the deck_session and context
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    
    if (sessionResult.rows.length > 0) {
      const session = sessionResult.rows[0];
      
      // 2. Reset Deck Session
      // When a session is explicitly ended via "End Session", we must reset the deck progress
      // so the next session starts from Question 1 (index 0).
      if (session.context) {
        const today = new Date().toISOString().split('T')[0];
        // Only reset for this specific session group to avoid side effects
        await db.query(
          `UPDATE deck_sessions SET position_index = 0, updated_at = NOW()
           WHERE restaurant_id = $1 AND table_token = $2 AND relationship_context = $3 AND service_day = $4 AND session_group_id = $5`,
          [session.restaurant_id || 'default', session.table_token, session.context, today, session.session_group_id]
        );
      }
    } else {
        // Session already gone (maybe cleanup job ran or duplicate request)
        console.log(`[API] Session ${session_id} not found during end request (already deleted?)`);
        return res.status(200).json({ message: 'Session already deleted' });
    }

    // 3. Delete dependent data (Explicitly, just like cleanup job handles implicitly via CASCADE or logic)
    // IMPORTANT: The cleanup job (Rule 4) deletes from 'sessions' where expires_at is old.
    // Here we want to do the same thing: REMOVE it completely.
    // If we rely on ON DELETE CASCADE, we can just delete from sessions.
    
    // Check if constraints exist (assumed yes based on cleanup job comments).
    // Safest approach matches cleanup job logic: Direct Delete.
    
    // However, to be extra safe against constraint errors if CASCADE isn't there:
    await db.query('DELETE FROM analytics_events WHERE session_id = $1', [session_id]);
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

const resolveSession = async (req, res) => {
  const { restaurant_id, table_token, device_token } = req.body;

  if (!table_token) {
    return res.status(400).json({ error: 'table_token is required' });
  }

  try {
    const restaurantId = restaurant_id || 'default';

    // 1. Attempt Resume by Device Token
    if (device_token) {
      const participantTokenHash = crypto.createHash('sha256').update(device_token).digest('hex');

      // First, let's proactively clear any stale fresh_intent (> 5 mins)
      // so it doesn't linger forever. We don't terminate the session anymore to protect the active partner.
      const expiredResult = await db.query(`
        UPDATE sessions s
        SET fresh_intent_a = FALSE,
            fresh_intent_b = FALSE,
            fresh_intent_at = NULL
        FROM session_participants sp
        WHERE s.session_id = sp.session_id
          AND sp.participant_token_hash = $1
          AND (s.fresh_intent_a = TRUE OR s.fresh_intent_b = TRUE)
          AND s.fresh_intent_at <= NOW() - INTERVAL '5 minutes'
          AND s.dual_status != 'ended'
        RETURNING s.session_id
      `, [participantTokenHash]);

      // Now check if they have ANY active session anywhere
      const anyActiveSession = await db.query(`
        SELECT s.session_id, s.table_token, s.mode, s.dual_status, sp.role
        FROM sessions s
        JOIN session_participants sp ON s.session_id = sp.session_id
        WHERE sp.participant_token_hash = $1
          AND s.expires_at > NOW()
          AND (s.dual_status IS NULL OR s.dual_status != 'ended')
        ORDER BY s.created_at DESC
        LIMIT 1
      `, [participantTokenHash]);

      if (anyActiveSession.rows.length > 0) {
        const activeSession = anyActiveSession.rows[0];
        
        // If it's the SAME table, resume normally
        if (activeSession.table_token === table_token) {
           // ... (Resume Logic) ...
           // Before resuming, check if this user has a pending "fresh_intent" that they are trying to bypass by rescanning
           // If they scan the SAME table, we should clear their fresh_intent so they rejoin seamlessly
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

           const resumeResult = await db.query(`
            SELECT s.session_id, s.mode, s.context, s.created_at, sp.participant_id, sp.role, s.dual_group_id, s.dual_status
            FROM sessions s
            JOIN session_participants sp ON s.session_id = sp.session_id
            WHERE s.session_id = $1 AND sp.participant_token_hash = $2
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

    // 2. Check for Waiting OR Paired Dual Session (Auto-Join)
    // Find active dual session for this table
    const dualResult = await db.query(`
      SELECT * FROM sessions
      WHERE table_token = $1
        AND restaurant_id = $2
        AND mode = 'dual-phone'
        AND dual_status != 'ended'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `, [table_token, restaurantId]);

    if (dualResult.rows.length > 0) {
      const dualSession = dualResult.rows[0];

      if (dualSession.dual_status === 'waiting') {
        // A is waiting. B can join.
        return res.json({
          action: 'join_dual',
          session_id: dualSession.session_id,
          role: 'B'
        });
      } else if (dualSession.dual_status === 'paired') {
        // A and B already exist.
        // User C (no token) scans QR.
        // CHECK: Is there a slot available?
        // We know dual_status='paired' usually means full.
        // But maybe one participant "left" (terminated)?
        // Let's check participant count.
        
        const participants = await db.query(`
            SELECT count(*) as count FROM session_participants 
            WHERE session_id = $1 AND disconnected_at IS NULL
        `, [dualSession.session_id]);
        
        const activeCount = parseInt(participants.rows[0].count);
        
        // If actually full (2 active participants), then Start New.
        // But wait, the requirement says: "Phone B quitting and rescanning... rejoins same group".
        // If Phone B quits (clears storage), they have NO device_token.
        // So they fall into this block.
        // If we strictly block them here, they can't rejoin.
        // However, "quitting" usually implies they want to leave?
        // "Start Fresh" clears storage.
        // But if they just "closed tab" and cleared storage by accident?
        // The rule says: "Phone B... rejoins the same group... even after context changes."
        // If they lost their token, they are anonymous. We can't identify them as "The Original Phone B".
        // UNLESS we allow re-claiming the slot if it's "open" (disconnected)?
        
        // Let's check if a role is disconnected.
        const disconnectedRole = await db.query(`
            SELECT role FROM session_participants
            WHERE session_id = $1 AND disconnected_at IS NOT NULL
        `, [dualSession.session_id]);
        
        if (disconnectedRole.rows.length > 0) {
            const roleToReclaim = disconnectedRole.rows[0].role;
            console.log(`[API] Reclaiming disconnected role ${roleToReclaim} for session ${dualSession.session_id}`);
            
            return res.json({
              action: 'reclaim_dual',
              session_id: dualSession.session_id,
              role: roleToReclaim
            });
        }
        
        return res.json({
          action: 'start_new',
          reason: 'dual_session_full'
        });
      }
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
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = sessionResult.rows[0];

    // Get current question (position_index)
    let position_index = 0;
    if (session.context) {
      const today = new Date().toISOString().split('T')[0];
      const deckResult = await db.query(
        `SELECT position_index FROM deck_sessions 
         WHERE restaurant_id = $1 AND table_token = $2 AND relationship_context = $3 AND service_day = $4 AND session_group_id = $5`,
        [session.restaurant_id || 'default', session.table_token, session.context, today, session.session_group_id]
      );
      if (deckResult.rows.length > 0) {
        position_index = deckResult.rows[0].position_index;
      }
    }
    
    // Get current question via Deck Service
    // This handles deck_session lookup, seed usage, and shuffling
    const question = await deckService.getCurrentQuestion({
      restaurant_id: session.restaurant_id || 'default',
      table_token: session.table_token,
      context: session.context,
      session_group_id: session.session_group_id
    });

    res.json({
      session_id: session.session_id,
      mode: session.mode,
      context: session.context,
      dual_status: session.dual_status,
      position_index: position_index,
      current_question: question // Will be null if deck empty
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
         RETURNING fresh_intent_a, fresh_intent_b, dual_group_id`,
        [session_id]
    );
    
    if (updateResult.rows.length === 0) {
       return res.status(404).json({ error: 'Session not found' });
    }
    
    const { fresh_intent_a, fresh_intent_b, dual_group_id } = updateResult.rows[0];

    // Notify partner via socket if possible
    const io = require('../index').io;
    if (io) {
       io.to(session_id).emit('partner_requested_fresh', { role });
    }

    // 3. Check Termination
    let activeCount = 1; // Fallback
    try {
        const io = require('../index').io;
        if (io) {
            const room = io.sockets.adapter.rooms.get(session_id);
            activeCount = room ? room.size : 0;
        }
    } catch (e) {
        console.warn("[API] Could not get socket room size, falling back to DB count");
        const activeCountRes = await db.query(`
            SELECT COUNT(*) as active_count
            FROM session_participants
            WHERE session_id = $1 AND disconnected_at IS NULL
        `, [session_id]);
        activeCount = parseInt(activeCountRes.rows[0].active_count, 10);
    }

    // Terminate if both agreed, or if this user is the only one currently connected to the session
    const shouldTerminate = (fresh_intent_a && fresh_intent_b) || (activeCount <= 1);

    if (shouldTerminate) {
        console.log(`[API] Terminating session ${session_id}. Mutual: ${fresh_intent_a && fresh_intent_b}, Active Count: ${activeCount}`);
        
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
        await db.query(
          `INSERT INTO analytics_events (session_id, event_type, event_data)
           VALUES ($1, $2, $3)`,
          [session_id, 'dual_session_terminated_mutual', { source: 'api' }]
        );
        
        if (io) {
            io.to(session_id).emit('dual_group_terminated');
        }
    }

    res.json({ success: true, terminated: shouldTerminate });

  } catch (err) {
    console.error('Error handling fresh intent:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const upgradeToDual = async (req, res) => {
  const { session_id } = req.params;
  const { participant_id } = req.body;

  try {
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
            `, [dual_group_id, sessionData.restaurant_id || 'default', sessionData.table_token, session_id, expires_at]);
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

module.exports = { createSession, joinDualPhoneSession, resumeSessionByQr, getSession, updateSession, endSession, getSessionByTable, heartbeat, resolveSession, getSessionState, freshIntent, upgradeToDual };
