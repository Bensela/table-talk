# Codebase Walkthrough

This document provides a high-level tour of the Table-Talk codebase to help developers and maintainers understand the project structure.

## Directory Structure

```
table-talk/
├── backend/                # Node.js/Express API & Socket.io Server
│   ├── controllers/        # Request handlers (logic layer)
│   ├── database/           # SQL migration and seed files
│   ├── routes/             # API route definitions
│   ├── scripts/            # Utility scripts (QR generation, seeding)
│   ├── services/           # Business logic (Deck management)
│   ├── tests/              # Jest unit and integration tests
│   ├── app.js              # Express app setup
│   └── index.js            # Entry point (Server + Socket.io)
│
├── frontend/               # React (Vite) Client Application
│   ├── src/
│   │   ├── api/            # Axios instance and API calls
│   │   ├── components/     # Reusable UI components (Buttons, Cards)
│   │   ├── pages/          # Route views (Home, SessionGame, etc.)
│   │   └── tests/          # Component and Integration tests
│   └── index.html          # Entry HTML file
│
├── docs/                   # Project Documentation
└── app-spec.yaml           # DigitalOcean App Platform configuration
```

## Key Files & Logic

### Backend

*   **`backend/services/deckService.js`**:
    *   **Core Logic**: This is the heart of the "Daily Deck". It uses a deterministic shuffle algorithm (Fisher-Yates with a seeded random number generator) to ensure that for a given `restaurant_id + table_id + context + date`, the question order is always the same.
    *   **Caching**: Implements a simple in-memory cache to reduce database load for repeated deck requests.

*   **`backend/index.js`**:
    *   **Socket.io**: Handles the real-time synchronization for "Dual-Phone" mode.
    *   **Events**: Listens for `join_session`, `ready_toggled`, `answer_submitted`, and `request_next` to coordinate the state between two phones.

*   **`backend/controllers/sessionController.js`**:
    *   **Session Management**: Handles creating new sessions (`POST /sessions`) and validating existing ones. It ensures sessions expire automatically (via database cron or expiration checks).

### Frontend

*   **`frontend/src/pages/SessionGame.jsx`**:
    *   **Main Game Loop**: Manages the state of the current question, the socket connection, and the UI mode (Single vs. Dual).
    *   **Syncing**: Listens for socket events like `advance_question` or `reveal_answers` to update the UI in real-time.

*   **`frontend/src/components/QuestionCard.jsx`**:
    *   **UI Component**: Displays the question and handles the "Tap to Reveal" interaction.
    *   **Animations**: Uses `framer-motion` for smooth card transitions and reveal effects.

*   **`frontend/src/api/index.js`**:
    *   **API Layer**: Centralized Axios instance. All backend requests go through here, allowing for easy configuration of base URLs and headers.

## Database Schema

The database consists of three main tables:
1.  **`questions`**: Stores the content (text, category, type).
2.  **`sessions`**: Tracks active user sessions (table, mode, expiration).
3.  **`deck_sessions`**: Tracks the state of a specific table's deck (seed, current position) to ensure continuity.

## Common Tasks

*   **Adding New Questions**: Add them to `backend/database/seeds/questions.sql` and run `npm run db:seed`.
*   **Changing Session Duration**: Update the `INTERVAL` in `backend/controllers/sessionController.js`.
*   **Generating QR Codes**: Run `node backend/scripts/generate_qr.js`.
