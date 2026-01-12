# Table-Talk MVP (Phase 2)

Phase 2 complete: Core Q&A loop and Dual-Phone Sync.

## Setup

1. **Database Setup & Seeding**
   Ensure your `.env` has the correct `DATABASE_URL`.
   Run the seed script to populate questions:
   ```bash
   cd server
   node -e "const fs = require('fs'); const db = require('./db'); const sql = fs.readFileSync('./database/seeds/questions.sql', 'utf8'); db.query(sql).then(() => { console.log('Seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"
   ```

2. **Running the App**
   - Server: `npm run dev` (Port 5000)
   - Client: `npm run dev` (Port 5173)

## Features

- **Single-Phone Mode**: Classic pass-around experience.
- **Dual-Phone Mode**: Real-time sync via WebSocket.
- **Daily Deck**: Deterministic shuffling per table per day.
- **Analytics**: Tracks views, reveals, and progression.

## Dual-Phone Logic

- Uses `socket.io` for real-time events.
- "Both Click Next": Both users must click "Next" to advance.
- Server maintains "waiting" state in memory.
- DB is updated only when both users have signaled readiness.
