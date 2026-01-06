# Table Talk MVP

Deep conversations, simplified. A QR-initiated, anonymous, mobile-first web app that facilitates structured, synchronized conversation using question decks at a physical table.

## � Features

*   **QR-Based Entry**: No app download or signup required.
*   **Two Modes**:
    *   **Single Phone**: Pass one device around the table.
    *   **Dual Phone**: Sync two devices in real-time.
*   **Anonymous**: No PII, no tracking, no cookies.
*   **Daily Deck**: Curated questions that reset daily at midnight.
*   **Real-time Sync**: <300ms latency for reveal/next actions.

## 🛠 Tech Stack

*   **Frontend**: React, TypeScript, Tailwind CSS, Zustand, Socket.io-client
*   **Backend**: Node.js, Express, Socket.io, Winston (Logging)
*   **Deployment**: Ready for DigitalOcean App Platform

## 🏃‍♂️ Local Development

### Prerequisites

*   Node.js v18+
*   npm or yarn

### Setup

1.  **Clone the repository**
    ```bash
    git clone https://github.com/charlpet/table-talk.git
    cd table-talk
    ```

2.  **Backend Setup**
    ```bash
    cd backend
    npm install
    # Create .env file
    echo "PORT=3000" > .env
    npm run dev
    ```

3.  **Frontend Setup**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

4.  **Access**
    *   Frontend: `http://localhost:5173`
    *   Backend: `http://localhost:3000`

## 📦 Deployment (DigitalOcean App Platform)

This repo is structured for easy monorepo deployment.

1.  **Create App**: Link your GitHub repo to DigitalOcean App Platform.
2.  **Add Components**:
    *   **Web Service (Backend)**:
        *   Source Directory: `backend`
        *   Build Command: `npm install`
        *   Start Command: `npm start`
        *   HTTP Port: `3000`
    *   **Static Site (Frontend)**:
        *   Source Directory: `frontend`
        *   Build Command: `npm install && npm run build`
        *   Output Directory: `dist`
        *   **Environment Variable**: Set `VITE_API_URL` to your backend's public URL (e.g., `https://backend-xyz.ondigitalocean.app`).

## 🛡 Privacy & Security

*   **No PII**: We do not store IP addresses or user agents.
*   **Ephemeral State**: Sessions auto-expire after 24 hours or 30 minutes of inactivity.
*   **Deterministic Decks**: Questions are shuffled based on the date, ensuring consistency without user tracking.

## � Analytics

Anonymous events are logged to `backend/logs/analytics.log`:
*   `session_started`
*   `mode_selected`
*   `question_advanced`
*   `reconnect_occurred`
*   `session_completed`

---
*Built with ❤️ by Trae AI*
