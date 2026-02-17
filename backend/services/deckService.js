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
  // IMPORTANT: We check for session_group_id first if provided.
  // BUT the issue described by user is that a NEW session (with NEW session_group_id) picks up OLD progress.
  // This means the query below might be too broad or falling back to a table-based lookup.
  
  // Let's look at the query being used:
  /*
    SELECT * FROM deck_sessions 
     WHERE restaurant_id = $1 
     AND table_token = $2 
     AND relationship_context = $3 
     AND service_day = $4
     AND session_group_id = $5
  */
  
  // Wait, if session_group_id is unique per session, this query returns NOTHING for a new session.
  // So it falls through to create a new deck session.
  // IF it creates a new deck session, position_index defaults to 0 (by DB default).
  
  // SO WHY does it resume?
  // Let's check the DB schema for deck_sessions.
  // Maybe there is logic somewhere else that is updating it?
  
  // Ah, let's look at getSession in sessionController.js:
  /*
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
  */
  
  // BINGO! The getSession controller is querying deck_sessions by TABLE + CONTEXT + DAY.
  // It ignores session_group_id!
  // This means all sessions for Table X on Day Y share the same deck progress if they have the same context.
  
  // To fix this according to the user's request ("Kill session -> Start Fresh"),
  // we need to ensure that when a session is KILLED, we either:
  // A) Reset that shared deck_session (which I tried, but maybe failed if multiple rows exist?)
  // B) Make deck_sessions tied to the SESSION GROUP, not just the table.
  
  // If we tie it to Session Group, then a new session (new group) automatically starts at 0.
  // This seems to be the intended architecture since we added session_group_id to the table.
  
  // However, `getDeckSession` creates a new row with `session_group_id`.
  // BUT `getSession` in controller ignores it and just grabs "ANY" row for that table/context.
  
  // Let's fix `getDeckSession` to be strict about the group ID if possible, 
  // OR update `getSession` to respect the group ID.
  
  // Actually, `getDeckSession` logic in this file seems correct (uses session_group_id).
  // The problem is likely in `sessionController.js`'s `getSession` function
  // and potentially `deckService.js` if it's falling back to older rows.
  
  // Let's look at the DB schema.
  // If `deck_sessions` has a UNIQUE constraint on (restaurant, table, context, day), then we can't insert a new one for a new group.
  // We need to check the schema.
  
  // Assuming the schema allows multiple deck_sessions for the same table/day (different groups):
  // Then `getSession` is buggy because it selects without filtering by group.
  
  // Let's fix the query in `getDeckSession` first to be absolutely sure.
  
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

  // If not found by specific group, DO NOT fall back to finding "any" for the table.
  // Just create a NEW one for this group.
  // This ensures isolation.

  console.log(`[DeckService] Creating new deck session for ${table_token} (${context}) Group: ${session_group_id}`);
  
  const seedInput = `${restaurant_id}|${table_token}|${context}|${today}|${session_group_id}`;
  const seed = crypto.createHash('sha256').update(seedInput).digest('hex').substring(0, 16);
  const deck_context_id = crypto.createHash('sha256').update(seedInput).digest('hex');

  const newDeck = await db.query(
    `INSERT INTO deck_sessions 
     (deck_context_id, restaurant_id, table_token, relationship_context, service_day, session_group_id, seed, position_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
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
  
  // Safety check: ensure index is valid (though modulo should handle it)
  if (!shuffledDeck[index]) {
      console.error('[DeckService] Invalid index after shuffle:', index, 'Length:', shuffledDeck.length);
      return null;
  }

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

const previousDeck = async (session) => {
  console.log(`[DeckService] Rewinding deck for ${session.table_token}`);
  
  // 1. Get Deck Session
  const deckSession = await getDeckSession(
    session.restaurant_id || 'default', 
    session.table_token, 
    session.context,
    session.session_group_id
  );

  // 2. Get total questions
  const allQuestions = await getAllQuestions();
  const deckQuestions = allQuestions.filter(q => 
    !q.context || q.context === session.context
  );
  const totalQuestions = deckQuestions.length;

  if (totalQuestions === 0) return 1;

  // 3. Calculate new index
  let newIndex = deckSession.position_index - 1;
  
  // Wraparound logic (go to end if at start)
  if (newIndex < 0) {
    newIndex = totalQuestions - 1;
  }

  // 4. Update DB
  await db.query(
    `UPDATE deck_sessions 
     SET position_index = $1, updated_at = NOW()
     WHERE deck_context_id = $2`,
    [newIndex, deckSession.deck_context_id]
  );
  
  return newIndex + 1; // Return 1-based index
};

module.exports = {
  getCurrentQuestion,
  getDeckSession,
  advanceDeck,
  previousDeck,
  _resetCache: () => { questionsCache = null; }
};
