const fs = require('fs');
const path = require('path');
const db = require('../db');

const sourceFile = path.resolve(__dirname, '..', '..', 'docs', 'Table-Talk-Questions-500-Updated.sql');

function unescapeSqlString(value) {
  return String(value || '').replace(/''/g, "'").trim();
}

function parseHintRows(sqlText) {
  const rows = [];
  const linePattern = /^\('((?:[^']|'')*)',\s*'''((?:[^']|'')*)''',\s*'''open-ended''',\s*'''((?:[^']|'')*)''',\s*'''((?:[^']|'')*)'''\),?$/;

  for (const rawLine of sqlText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(linePattern);
    if (!match) {
      continue;
    }

    rows.push({
      question_text: unescapeSqlString(match[1]),
      answer_text: unescapeSqlString(match[2]),
      context: unescapeSqlString(match[3]),
      difficulty: unescapeSqlString(match[4]).toLowerCase()
    });
  }

  return rows;
}

async function main() {
  const sqlText = fs.readFileSync(sourceFile, 'utf8');
  const hintRows = parseHintRows(sqlText);

  if (hintRows.length === 0) {
    throw new Error('No open-ended hint rows were parsed from the SQL source file.');
  }

  await db.query('BEGIN');

  try {
    let updatedCount = 0;

    for (const row of hintRows) {
      const result = await db.query(
        `UPDATE questions
         SET answer_text = $1,
             updated_at = NOW()
         WHERE question_type = 'open-ended'
           AND question_text = $2
           AND context = $3
           AND difficulty = $4
           AND (answer_text IS NULL OR BTRIM(answer_text) = '')`,
        [row.answer_text, row.question_text, row.context, row.difficulty]
      );

      updatedCount += result.rowCount;
    }

    await db.query('COMMIT');
    console.log(`Backfilled hints for ${updatedCount} question row(s).`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Hint backfill failed:', error);
    process.exit(1);
  });
