import { SEED_QUESTIONS } from '../data/questions.js';

// Seedable random number generator (simple LCG) to ensure deterministic daily decks
const mulberry32 = (a) => {
  return () => {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export const getDailyDeck = () => {
  // 1. Get current date string (YYYY-MM-DD) based on server-local midnight
  const now = new Date();
  const dateString = now.toISOString().split('T')[0]; // e.g. "2023-10-27"

  // 2. Create a numeric seed from the date string
  let seed = 0;
  for (let i = 0; i < dateString.length; i++) {
    seed = ((seed << 5) - seed) + dateString.charCodeAt(i);
    seed |= 0; // Convert to 32bit integer
  }
  
  // 3. Shuffle questions deterministically using the seed
  // We use a copy of SEED_QUESTIONS
  const deck = [...SEED_QUESTIONS];
  const rng = mulberry32(seed);

  // Fisher-Yates shuffle with seeded RNG
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // 4. Return the shuffled deck
  // In a real app with a huge database, we might pick N questions. 
  // For MVP with 10 questions, we just shuffle them so the order changes daily 
  // but it's consistent for everyone on that day (global daily deck).
  // OR if we want "No repeats per table per day" and we have a small pool, 
  // returning the full shuffled pool ensures they see them in a specific order.
  
  return deck;
};
