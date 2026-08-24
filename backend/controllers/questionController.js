const db = require('../db');
const deckService = require('../services/deckService');
const { insertSessionAnalyticsEvent } = require('../services/analyticsService');

const getCurrentQuestion = async (req, res) => {
  const { session_id } = req.params;

  try {
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];
    
    // Ensure deck session exists via getCurrentQuestion logic internally
    // (Removed redundant incorrect call to getDeckSession)

    const question = await deckService.getCurrentQuestion(session);

    if (!question) {
      return res.status(404).json({ error: 'No questions available for this context' });
    }

    await insertSessionAnalyticsEvent(session, {
      event_type: 'question_viewed',
      event_data: {
        question_id: question.question_id,
        position_index: question.position_index != null ? question.position_index : null,
        deck_id: question.deck_session_id != null ? question.deck_session_id : null
      }
    });

    res.json(question);
  } catch (err) {
    console.error('Error getting question:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const nextQuestion = async (req, res) => {
  const { session_id } = req.params;
  console.log(`[API] nextQuestion called for session ${session_id}`);

  try {
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      console.log(`[API] Session ${session_id} not found`);
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = sessionResult.rows[0];
    console.log(`[API] Advancing deck for session ${session_id} (Token: ${session.table_token}, Context: ${session.context})`);
    
    const newIndex = await deckService.advanceDeck(session);
    console.log(`[API] New index: ${newIndex}`);

    // Update session last_activity
    await db.query(
      `UPDATE sessions SET last_activity_at = NOW() WHERE session_id = $1`,
      [session_id]
    );

    await insertSessionAnalyticsEvent(session, {
      event_type: 'next_clicked',
      event_data: { new_index: newIndex }
    });

    res.json({ success: true, index: newIndex });
  } catch (err) {
    console.error('[API] Error advancing question:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const prevQuestion = async (req, res) => {
  const { session_id } = req.params;
  
  try {
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = sessionResult.rows[0];
    
    // Decrement index
    const newIndex = await deckService.previousDeck(session);

    // Update session last_activity
    await db.query(
      `UPDATE sessions SET last_activity_at = NOW() WHERE session_id = $1`,
      [session_id]
    );

    await insertSessionAnalyticsEvent(session, {
      event_type: 'prev_clicked',
      event_data: { new_index: newIndex }
    });

    res.json({ success: true, index: newIndex });
  } catch (err) {
    console.error('[API] Error going back:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const revealAnswer = async (req, res) => {
  const { session_id } = req.params;
  const { question_id } = req.body;

  try {
    const sessionRes = await db.query(
      `SELECT session_id, restaurant_id, table_token FROM sessions WHERE session_id = $1`,
      [session_id]
    );
    const session = sessionRes.rows && sessionRes.rows[0] ? sessionRes.rows[0] : { session_id };
    await insertSessionAnalyticsEvent(session, {
      event_type: 'answer_revealed',
      event_data: { question_id: question_id || null }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Error logging reveal:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getCurrentQuestion,
  nextQuestion,
  prevQuestion,
  revealAnswer
};
