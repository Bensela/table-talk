# Table-Talk MVP

**Connect Deeper At The Table.**

Table-Talk is a web application designed to spark meaningful conversations in restaurants. Guests scan a QR code at their table to unlock a curated "Daily Deck" of questions, tailored to their relationship context (Exploring, Established, Mature).

## Features

*   **Zero Friction**: No app download or signup required. Just scan and play.
*   **Context Aware**: Select from 3 relationship levels to get the right questions.
*   **Dual Modes**:
    *   **Single-Phone**: Pass one device around.
    *   **Dual-Phone**: Sync two devices for a shared "reveal" experience.
*   **Daily Deck**: Questions are shuffled deterministically every day, ensuring fresh content without repeats.
*   **Privacy First**: Anonymous sessions that auto-expire. No data tracking.

## Architecture

*   **Frontend**: React, Vite, Tailwind CSS, Framer Motion.
*   **Backend**: Node.js, Express, Socket.io (for real-time sync).
*   **Database**: PostgreSQL (Managed).
*   **Infrastructure**: DigitalOcean App Platform.

## Quick Start (Local)

1.  **Clone**: `git clone https://github.com/easymssolutions/table-talk.git`
2.  **Install**:
    ```bash
    npm install
    cd backend && npm install
    cd ../frontend && npm install
    ```
3.  **Database**:
    *   Ensure PostgreSQL is running.
    *   Create a `.env` in `backend/` (see `.env.example`).
    *   Run migrations: `cd backend && node scripts/migrate.js`
    *   Seed data: `node scripts/seed.js`
4.  **Run**:
    *   Backend: `cd backend && npm run dev`
    *   Frontend: `cd frontend && npm run dev`

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed production deployment instructions.

## Documentation

*   [API Reference](docs/API.md)
*   [Deployment Guide](docs/DEPLOYMENT.md)
*   [Support Guidelines](docs/SUPPORT.md)

## License

Proprietary - All rights reserved by Charles Peterson (Made to Connect Co).
