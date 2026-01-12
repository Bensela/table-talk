const db = require('../db');
const crypto = require('crypto');

// Cache all questions in memory for performance (since < 1000 items)
let questionsCache = null;

const getQuestions = async () => {
  if (questionsCache) return questionsCache;
  const result = await db.query('SELECT * FROM questions ORDER BY question_id');
  questionsCache = result.rows;
  return questionsCache;
};

// Simple seeded random generator
const seededRandom = (seed) => {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  // Convert first 8 chars of hash to integer
  return parseInt(hash.substring(0, 8), 16);
};

// Fisher-Yates shuffle with seed
const shuffle = (array, seed) => {
  const shuffled = [...array];
  let currentSeed = seededRandom(seed);
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Generate next pseudo-random number
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    const j = Math.floor((currentSeed / 4294967296) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const getDailyDeck = async (table_id) => {
  const questions = await getQuestions();
  const today = new Date().toISOString().split('T')[0];
  const seed = `${table_id}-${today}`;
  return shuffle(questions, seed);
};

const getCurrentQuestion = async (session) => {
  const deck = await getDailyDeck(session.table_id);
  const index = session.current_question_index % deck.length;
  return {
    ...deck[index],
    index: index + 1,
    total: deck.length
  };
};

module.exports = {
  getCurrentQuestion,
  getDailyDeck
};
