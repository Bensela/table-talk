const db = require('../db');

const SESSION_DURATION_HOURS = 24;

const createSession = async (req, res) => {
  const { table_id } = req.body;

  if (!table_id) {
    return res.status(400).json({ error: 'table_id is required' });
  }

  try {
    // Check for existing active session for this table
    const existingSession = await db.query(
      `SELECT * FROM sessions 
       WHERE table_id = $1 
       AND expires_at > NOW() 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [table_id]
    );

    if (existingSession.rows.length > 0) {
      return res.status(200).json(existingSession.rows[0]);
    }

    // Create new session
    // Simple daily seed logic: table_id + date
    const today = new Date().toISOString().split('T')[0];
    const deck_seed = `${table_id}-${today}`; 
    
    // Expires in 24 hours
    const expires_at = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

    const newSession = await db.query(
      `INSERT INTO sessions (table_id, expires_at, deck_seed) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [table_id, expires_at, deck_seed]
    );

    // Log analytics
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [newSession.rows[0].session_id, 'session_created', { table_id }]
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
    const session = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session.rows[0]);
  } catch (err) {
    console.error('Error getting session:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateSessionMode = async (req, res) => {
  const { session_id } = req.params;
  const { mode } = req.body;

  if (!['single', 'dual'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  try {
    const updatedSession = await db.query(
      `UPDATE sessions SET mode = $1 WHERE session_id = $2 RETURNING *`,
      [mode, session_id]
    );
    
    if (updatedSession.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Log analytics
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [session_id, 'mode_selected', { mode }]
    );

    res.json(updatedSession.rows[0]);
  } catch (err) {
    console.error('Error updating session mode:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { createSession, getSession, updateSessionMode };
