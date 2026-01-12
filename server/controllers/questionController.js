const db = require('../db');
const deckService = require('../services/deckService');

const getCurrentQuestion = async (req, res) => {
  const { session_id } = req.params;

  try {
    const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];
    const question = await deckService.getCurrentQuestion(session);

    // Log analytics
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [session_id, 'question_viewed', { question_id: question.question_id }]
    );

    res.json(question);
  } catch (err) {
    console.error('Error getting question:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const nextQuestion = async (req, res) => {
  const { session_id } = req.params;

  try {
    const result = await db.query(
      `UPDATE sessions 
       SET current_question_index = current_question_index + 1 
       WHERE session_id = $1 
       RETURNING current_question_index`,
      [session_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Log analytics
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [session_id, 'next_clicked', { new_index: result.rows[0].current_question_index }]
    );

    res.json({ success: true, index: result.rows[0].current_question_index });
  } catch (err) {
    console.error('Error advancing question:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const revealAnswer = async (req, res) => {
  const { session_id } = req.params;
  const { question_id } = req.body;

  try {
    await db.query(
      `INSERT INTO analytics_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [session_id, 'answer_revealed', { question_id }]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error logging reveal:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getCurrentQuestion,
  nextQuestion,
  revealAnswer
};
