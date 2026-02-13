const db = require('../db');

const seedQuestions = async () => {
  try {
    console.log('🌱 Seeding Questions (v1.2)...');

    // Ensure unique constraint on question_text for upsert
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_text_unique ON questions (question_text);');

    const questions = [
      // --- Exploring (30 Questions) ---
      { text: "What is your favorite way to spend a Sunday morning?", context: "Exploring" },
      { text: "What was your dream job when you were a child?", context: "Exploring" },
      { text: "If you could live anywhere in the world for a year, where would it be?", context: "Exploring" },
      { text: "What is the best meal you've ever had?", context: "Exploring" },
      { text: "What is a skill you've always wanted to learn?", context: "Exploring" },
      { text: "What is your favorite book or movie of all time?", context: "Exploring" },
      { text: "If you could have dinner with any historical figure, who would it be?", context: "Exploring" },
      { text: "What is the most adventurous thing you've ever done?", context: "Exploring" },
      { text: "What is a song that always puts you in a good mood?", context: "Exploring" },
      { text: "If you won the lottery tomorrow, what is the first thing you would buy?", context: "Exploring" },
      { text: "What is your biggest pet peeve?", context: "Exploring" },
      { text: "What is a hidden talent you have?", context: "Exploring" },
      { text: "Do you prefer the beach or the mountains?", context: "Exploring" },
      { text: "What is the best piece of advice you've ever received?", context: "Exploring" },
      { text: "What is your favorite holiday tradition?", context: "Exploring" },
      { text: "If you could have any superpower, what would it be?", context: "Exploring" },
      { text: "What is a weird food combination that you enjoy?", context: "Exploring" },
      { text: "What is the last concert you went to?", context: "Exploring" },
      { text: "What is your favorite board game or card game?", context: "Exploring" },
      { text: "If you could only eat one food for the rest of your life, what would it be?", context: "Exploring" },
      { text: "What is a place you've visited that you never want to go back to?", context: "Exploring" },
      { text: "Who is your favorite fictional character?", context: "Exploring" },
      { text: "What is something you are currently obsessed with?", context: "Exploring" },
      { text: "If you could time travel, would you go to the past or the future?", context: "Exploring" },
      { text: "What is your favorite season and why?", context: "Exploring" },
      { text: "What is a goal you have for this year?", context: "Exploring" },
      { text: "What is the funniest thing that has happened to you recently?", context: "Exploring" },
      { text: "If you were an animal, what would you be?", context: "Exploring" },
      { text: "What is your favorite way to relax after a long day?", context: "Exploring" },
      { text: "What is something you are proud of?", context: "Exploring" },

      // --- Established (20 Questions) ---
      { text: "What is one of your favorite memories of us together?", context: "Established" },
      { text: "What is something I do that makes you feel loved?", context: "Established" },
      { text: "What is a challenge we've overcome that made us stronger?", context: "Established" },
      { text: "What is something new you'd like to try together?", context: "Established" },
      { text: "Where do you see us in 5 years?", context: "Established" },
      { text: "What is a quality of mine that you admire?", context: "Established" },
      { text: "What is the most romantic thing I've ever done for you?", context: "Established" },
      { text: "How have we changed since we first met?", context: "Established" },
      { text: "What is your favorite thing about our daily routine?", context: "Established" },
      { text: "What is a small thing I do that annoys you (be honest!)?", context: "Established" },
      { text: "What is something you want to support me in right now?", context: "Established" },
      { text: "What is your favorite trip we've taken together?", context: "Established" },
      { text: "How do you think we balance each other out?", context: "Established" },
      { text: "What is something you've learned from me?", context: "Established" },
      { text: "What is a goal we should set for our relationship?", context: "Established" },
      { text: "What is your favorite way to show affection?", context: "Established" },
      { text: "When do you feel most connected to me?", context: "Established" },
      { text: "What is a tradition you want to start with me?", context: "Established" },
      { text: "What is something you appreciate about my family?", context: "Established" },
      { text: "What is the best gift I've ever given you?", context: "Established" }
    ];

    for (const q of questions) {
      // Upsert based on question_text to avoid duplicates
      await db.query(`
        INSERT INTO questions (question_text, context, question_type, difficulty, active)
        VALUES ($1, $2, 'open-ended', 'easy', true)
        ON CONFLICT (question_text) DO NOTHING
      `, [q.text, q.context]);
    }

    console.log(`✅ Seeded ${questions.length} questions.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
};

seedQuestions();
