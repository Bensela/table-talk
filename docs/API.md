# API Documentation

**Base URL**: `https://api.tabletalk.app/api` (Production)

## Sessions

### Create/Join Session
Creates a new session or joins an existing active one for the table.

- **POST** `/sessions`
- **Body**:
  ```json
  {
    "table_token": "table-123",
    "context": "Exploring", // Optional: 'Exploring' | 'Established' | 'Mature'
    "mode": "dual-phone"    // Optional: 'single-phone' | 'dual-phone'
  }
  ```
- **Response** (200/201):
  ```json
  {
    "session_id": "uuid...",
    "table_token": "table-123",
    "mode": "dual-phone",
    "expires_at": "2026-02-02T12:00:00Z"
  }
  ```

### Get Session
- **GET** `/sessions/:session_id`
- **Response**: Session object.

### Get Session by Table
Checks for an active session for a QR code scan.

- **GET** `/sessions/by-table/:table_token`
- **Response**: Session object or 404.

## Questions

### Get Current Question
Returns the current question for the session's deck position.

- **GET** `/sessions/:session_id/questions/current`
- **Response**:
  ```json
  {
    "question_id": 1,
    "question_text": "...",
    "answer_text": "...",
    "index": 5,
    "total": 50
  }
  ```

### Next Question
Advances the deck position (Single Mode) or requests advance (Dual Mode).

- **POST** `/sessions/:session_id/questions/next`
- **Response**: `{"success": true, "index": 6}`

### Reveal Answer
Logs that the answer/hint was revealed.

- **POST** `/sessions/:session_id/answer/reveal`
- **Body**: `{"question_id": 1}`

## Health

### Health Check
- **GET** `/health`
- **Response**: `{"status": "ok"}`
