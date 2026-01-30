const db = require('../db');
const deckService = require('../services/deckService');

const SESSION_DURATION_HOURS = 24;

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
    // Check for existing active session for this table + context
    let query = `SELECT * FROM sessions 
                 WHERE table_token = $1 
                 AND expires_at > NOW() `;
    const params = [table_token];
    
    if (context) {
      query += `AND context = $2 `;
      params.push(context);
    }
    
    query += `ORDER BY created_at DESC LIMIT 1`;

    const existingSession = await db.query(query, params);

    if (existingSession.rows.length > 0) {
      // If exists: join existing session
      return res.status(200).json(existingSession.rows[0]);
    }

    // Create new session
    const expires_at = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
    
    // Ensure deck session exists (seed generation)
    if (context) {
      await deckService.getDeckSession(restaurant_id || 'default', table_token, context);
    }

    const newSession = await db.query(
      `INSERT INTO sessions 
       (table_token, restaurant_id, context, mode, expires_at, table_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [
        table_token, 
        restaurant_id || null, 
        context || null, 
        mode || 'single-phone', 
        expires_at,
        table_token // Legacy support
      ]
    );

    // Log analytics
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [newSession.rows[0].session_id, 'session_created', { table_token, context, mode }]
    );

    res.status(201).json(newSession.rows[0]);
  } catch (err) {
    console.error('Error creating session:', err);
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
      const deckResult = await db.query(
        `SELECT position_index FROM deck_sessions 
         WHERE restaurant_id = $1 AND table_token = $2 AND relationship_context = $3 AND service_day = $4`,
        [session.restaurant_id || 'default', session.table_token, session.context, today]
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
        // Update deck_session
        await db.query(
          `UPDATE deck_sessions SET position_index = $1, updated_at = NOW()
           WHERE restaurant_id = $2 AND table_token = $3 AND relationship_context = $4 AND service_day = $5`,
          [position_index, session.restaurant_id || 'default', session.table_token, session.context, today]
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
    await db.query('DELETE FROM sessions WHERE session_id = $1', [session_id]);
    res.status(204).send();
  } catch (err) {
    console.error('Error ending session:', err);
    res.status(500).json({ error: 'Server error' });
  }
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

module.exports = { createSession, getSession, updateSession, endSession, getSessionByTable };
