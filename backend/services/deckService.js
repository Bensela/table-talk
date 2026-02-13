const db = require('../db');
const crypto = require('crypto');

// Cache all questions in memory
let questionsCache = null;

const getAllQuestions = async () => {
  if (questionsCache) return questionsCache;
  const result = await db.query('SELECT * FROM questions WHERE active = true ORDER BY question_id');
  questionsCache = result.rows;
  return questionsCache;
};

// Simple seeded random generator
const seededRandom = (seed) => {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
};

// Fisher-Yates shuffle
const shuffle = (array, seed) => {
  const shuffled = [...array];
  let currentSeed = seededRandom(seed);
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    const j = Math.floor((currentSeed / 4294967296) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const getDeckSession = async (restaurant_id, table_token, context, session_group_id) => {
  const today = new Date().toISOString().split('T')[0];
  
  // Try to find existing deck session
  const existing = await db.query(
    `SELECT * FROM deck_sessions 
     WHERE restaurant_id = $1 
     AND table_token = $2 
     AND relationship_context = $3 
     AND service_day = $4
     AND session_group_id = $5`,
    [restaurant_id, table_token, context, today, session_group_id]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create new deck session
  console.log(`[DeckService] Creating new deck session for ${table_token} (${context}) Group: ${session_group_id}`);
  
  // Deterministic seed based on group + context + day
  const seedInput = `${restaurant_id}|${table_token}|${context}|${today}|${session_group_id}`;
  const seed = crypto.createHash('sha256').update(seedInput).digest('hex').substring(0, 16); // Use shorter hex for seed
  const deck_context_id = crypto.createHash('sha256').update(seedInput).digest('hex');

  const newDeck = await db.query(
    `INSERT INTO deck_sessions 
     (deck_context_id, restaurant_id, table_token, relationship_context, service_day, session_group_id, seed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [deck_context_id, restaurant_id, table_token, context, today, session_group_id, seed]
  );

  return newDeck.rows[0];
};

const getCurrentQuestion = async (session) => {
  // 1. Get Deck Session
  const deckSession = await getDeckSession(
    session.restaurant_id || 'default', 
    session.table_token, 
    session.context,
    session.session_group_id
  );

  if (!deckSession) {
      console.error('[DeckService] Deck session is null/undefined');
      return null;
  }
  if (!deckSession.seed) {
      console.error('[DeckService] Deck session seed is missing:', deckSession);
      // Fallback: Generate a temporary seed if missing (should not happen with new creation logic)
      deckSession.seed = crypto.randomBytes(8).toString('hex');
  }

  // 2. Get Questions for Context
  const allQuestions = await getAllQuestions();
  // Filter questions that match the context (or if context is null/global)
  const deckQuestions = allQuestions.filter(q => 
    !q.context || q.context === session.context
  );

  if (deckQuestions.length === 0) {
    return null; // Handle empty deck
  }

  // 3. Shuffle
  const shuffledDeck = shuffle(deckQuestions, deckSession.seed);

  // 4. Get Current Position
  // If position_index is greater than deck length (e.g. deck shrank or changed), wrap it
  const index = deckSession.position_index % shuffledDeck.length;
  
  return {
    ...shuffledDeck[index],
    index: index + 1,
    total: shuffledDeck.length,
    deck_session_id: deckSession.deck_context_id
  };
};

const advanceDeck = async (session) => {
  console.log(`[DeckService] Advancing deck for ${session.table_token}`);
  const deckSession = await getDeckSession(
    session.restaurant_id || 'default', 
    session.table_token, 
    session.context,
    session.session_group_id
  );

  // Get total questions to handle wraparound
  const allQuestions = await getAllQuestions();
  const deckQuestions = allQuestions.filter(q => 
    !q.context || q.context === session.context
  );
  const totalQuestions = deckQuestions.length;

  let newIndex = deckSession.position_index + 1;
  
  // Wraparound logic
  if (totalQuestions > 0 && newIndex >= totalQuestions) {
    newIndex = 0;
  }

  await db.query(
    `UPDATE deck_sessions 
     SET position_index = $1, updated_at = NOW()
     WHERE deck_context_id = $2`,
    [newIndex, deckSession.deck_context_id]
  );
  
  return newIndex + 1; // Return 1-based index for display
};

module.exports = {
  getCurrentQuestion,
  getDeckSession,
  advanceDeck,
  _resetCache: () => { questionsCache = null; }
};
