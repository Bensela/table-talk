const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const db = require('../db');

const seedQuestions = async () => {
  try {
    const seedPath = path.join(__dirname, '../database/seeds/questions.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf8');

    console.log('🌱 Seeding questions...');
    await db.query(seedSql);
    console.log('✅ Questions seeded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding questions:', err);
    process.exit(1);
  }
};

seedQuestions();
