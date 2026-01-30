# Table-Talk MVP (Phase 2 Complete)

Table-Talk helps people have meaningful conversations at restaurants through thought-provoking questions accessed via QR codes.

## Features

- **QR Code Entry**: Seamless entry via table-specific QR codes.
- **Context Selection**: Users choose their relationship context (Exploring, Established, Mature) to filter questions.
- **Modes**:
  - **Single-Phone**: Pass one device around.
  - **Dual-Phone**: Two devices sync in real-time for a shared experience.
- **Daily Deck**: Deterministic shuffling ensures a unique question order per table/context per day, resetting at midnight UTC.
- **Privacy**: No PII stored; sessions expire after 24 hours.

## Architecture

### Tech Stack
- **Frontend**: React (Vite), Tailwind CSS, Framer Motion
- **Backend**: Node.js, Express, Socket.io
- **Database**: PostgreSQL (with `uuid-ossp`)

### Key Components

1.  **Session Management (`sessions` table)**:
    - Stores `table_token`, `mode`, `context`, and expiration.
    - Handles ephemeral user sessions without login.

2.  **Deck Logic (`deck_sessions` table)**:
    - Implements the "Daily Deck" algorithm.
    - Stores a `seed` generated from `table_token + context + service_day`.
    - Tracks `position_index` to persist progress across reloads and devices.
    - Ensures no repeats within a day.

3.  **Synchronization (Dual-Phone)**:
    - Uses **Socket.io** for real-time events (`advance_question`, `reveal_answer`).
    - **"Both Click Next" Logic**: In Dual Mode, the server waits for both participants to request the next question before advancing the deck.
    - **State Recovery**: Frontend re-fetches current state on reconnection.

### API Endpoints

- `POST /api/sessions`: Create/Join a session.
- `GET /api/sessions/:id`: Retrieve session details.
- `GET /api/sessions/:id/questions/current`: Get current question based on deck position.
- `POST /api/sessions/:id/questions/next`: Advance the deck (Single Mode).
- `POST /api/sessions/:id/answer/reveal`: Log answer reveal.

## Setup & Run

1.  **Install Dependencies**:
    ```bash
    npm install
    cd client && npm install
    cd ../server && npm install
    ```

2.  **Database Setup**:
    Update `server/.env` with your PostgreSQL credentials.
    ```bash
    cd server
    node scripts/migrate.js  # Runs migrations
    node scripts/seed.js     # Seeds 50+ questions
    ```

3.  **Development**:
    ```bash
    # Terminal 1 (Backend)
    cd server && npm run dev
    
    # Terminal 2 (Frontend)
    cd client && npm run dev
    ```

4.  **Testing**:
    ```bash
    cd server && npm test
    cd client && npm test
    ```

## Mobile Optimization
- Designed for mobile-first (375px+).
- Large touch targets (44px+).
- High contrast for readability in various lighting conditions.
