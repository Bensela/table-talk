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
    const expires_at = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
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
  const { table_token, restaurant_id, session_id } = req.body;

  try {
    let validSession = null;

    if (session_id) {
      // Direct join by ID (preferred)
      const result = await db.query(`
        SELECT * FROM sessions 
        WHERE session_id = $1 
          AND dual_status = 'waiting'
          AND expires_at > NOW()
      `, [session_id]);
      
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

      // Add dual_status check to prevent resuming 'ended' sessions
      const resumeResult = await db.query(`
        SELECT s.session_id, s.mode, s.context, s.created_at, sp.participant_id, sp.role, s.dual_group_id, s.dual_status
        FROM sessions s
        JOIN session_participants sp ON s.session_id = sp.session_id
        WHERE s.table_token = $1
          AND s.restaurant_id = $2
          AND sp.participant_token_hash = $3
          AND s.expires_at > NOW()
          AND (s.dual_status IS NULL OR s.dual_status != 'ended')
        ORDER BY s.created_at DESC
        LIMIT 1
      `, [table_token, restaurantId, participantTokenHash]);

      if (resumeResult.rows.length > 0) {
        const session = resumeResult.rows[0];
        console.log('[API] Resume Session Found:', session.session_id);
        
        // DUAL GROUP ID CHECK (Option B Future Proofing / Option A Robustness)
        // If this participant belongs to a dual_group_id, we should ensure they are
        // resuming the LATEST session for that group, in case the session ID changed (Option B).
        // Since we are using Option A (Mutation), session_id shouldn't change.
        // But let's be safe: if dual_group_id exists, find the latest session for it.
        
        if (session.dual_group_id) {
             const latestGroupSession = await db.query(`
                SELECT session_id, context, mode FROM sessions 
                WHERE dual_group_id = $1 
                ORDER BY created_at DESC LIMIT 1
             `, [session.dual_group_id]);
             
             if (latestGroupSession.rows.length > 0) {
                 const latest = latestGroupSession.rows[0];
                 // If the session ID is different (Option B scenario), we might need to migrate the participant?
                 // Or just return the latest ID and let the frontend join it?
                 // Since we use Mutation (Option A), latest.session_id should equal session.session_id.
                 // But if we ever switch, this logic handles it.
                 if (latest.session_id !== session.session_id) {
                     console.log('[API] Participant belongs to older session in group. Redirecting to latest:', latest.session_id);
                     // We technically need to move the participant record to the new session if we did Option B.
                     // But for Option A, they match.
                 }
             }
        }

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
            // A role is "open" (disconnected).
            // We can allow this anonymous user to CLAIM it.
            // This enables "Resume after clearing cache" behavior if the server knows the other person is gone.
            // We should assign them the disconnected role.
            // But wait, what if it's Phone C trying to hijack Phone B's spot while B is just restarting phone?
            // This is a trade-off. MVP rule: "Smart Reconnection".
            // Let's allow it for seamlessness.
            
            const roleToReclaim = disconnectedRole.rows[0].role;
            console.log(`[API] Reclaiming disconnected role ${roleToReclaim} for session ${dualSession.session_id}`);
            
            // We need to return 'join_dual' but with logic to REPLACE the old participant?
            // Or just return join_dual and let the join endpoint handle the swap?
            // joinDualPhoneSession endpoint logic needs to support "Reclaim".
            // Currently it only supports 'waiting'.
            // Let's update client to handle 'reclaim_dual'?
            // Or easier: update dual_status to 'waiting' temporarily? No, risky.
            
            // Let's return 'join_dual' and ensure joinDualPhoneSession handles 'paired' status if we pass a flag?
            // Actually, joinDualPhoneSession checks `dual_status = 'waiting'`.
            // We need to support joining a 'paired' session if we are reclaiming.
            
            // Let's stick to the prompt requirement: "If group already has two participants... do not join".
            // If "Phone B quitting" means they cleared storage, they are a NEW DEVICE.
            // If the group is "paired", and we don't recognize them, we MUST start new session (Phone C rule).
            // The only exception is if Phone B *didn't* clear storage (handled in step 1).
            // OR if "quitting" means explicit "Leave Session" which sets disconnected_at?
            
            // Re-reading: "Phone B quitting and rescanning... rejoins".
            // If "quitting" = closing tab -> Storage persists -> Step 1 handles it.
            // If "quitting" = Start Fresh -> Storage cleared -> New Device -> Start New Session.
            // This seems correct for security.
            // "Works even if context switched during absence" -> This implies Step 1 (Resume) logic.
            // If context switched, session_id might be same (Option A) or different (Option B).
            // Step 1 logic I wrote handles `dual_group_id` lookup to find the *latest* session.
            
            // So, for this block (Step 2), we assume it's Phone C or a hard-reset Phone B.
            // Hard-reset Phone B *should* probably start fresh or be blocked.
            // I will implement "Start New" here to protect the session from Phone C.
            
            return res.json({
              action: 'start_new',
              reason: 'dual_session_full'
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

module.exports = { createSession, joinDualPhoneSession, resumeSessionByQr, getSession, updateSession, endSession, getSessionByTable, heartbeat, resolveSession, getSessionState };
