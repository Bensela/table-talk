const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, '../database/seeds/questions.sql');
const seedSql = fs.readFileSync(seedPath, 'utf8');

console.log('Total length:', seedSql.length);
console.log('Character at 4197:', seedSql[4197]);
console.log('Context around 4197:', seedSql.substring(4180, 4220));
