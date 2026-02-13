# Table-Talk MVP - Development Rules v1.2

**Client:** Charles Peterson (Made to Connect Co) | **Budget:** 110hrs @ $10/hr | **Platform:** DigitalOcean

## Core Features
1. **QR Scan** → Welcome → **Context Selection** (Exploring/Established) → **Mode** (Single/Dual-Phone) → Questions
2. **Session Groups**: Auto-isolate different dining parties (15-min activity window)
3. **Join Codes**: 6-digit codes for secure Dual-Phone pairing (10-min expiry)
4. **Deterministic Deck**: Seed-based shuffle per group+table+context+day, no repeats, wraps at end
5. **Dual-Phone Sync**: WebSocket <300ms latency, participant-based rooms, "Both Ready" + checkmark reveal rituals

## Tech Stack
- Frontend: React + Tailwind, mobile-first (375px min)
- Backend: Node.js/Express + Socket.io
- Database: PostgreSQL (sessions, session_participants, deck_sessions, questions, analytics_events)
- Hosting: DigitalOcean App Platform + Managed Postgres

## Privacy (CRITICAL)
❌ NEVER store: names, emails, phones, IPs, answer content, raw join codes
✅ Store only: session_id, participant_id (UUID), code hashes (SHA256), timestamps (UTC), question_id, anonymous events

## Database Schema
```sql
sessions: session_id, table_token, restaurant_id, mode, context, session_group_id, 
          pairing_code_hash, pairing_expires_at, dual_status, expires_at, last_activity_at
session_participants: participant_id, session_id, role, last_seen_at, disconnected_at
deck_sessions: deck_context_id, seed, position_index, service_day, session_group_id
questions: question_id, text, answer_text, type, context, difficulty, options
analytics_events: event_id, session_id, event_type, event_data, timestamp
```

## Session Isolation Rules
- **Same party (15-min window)**: Automatically join same session_group_id
- **Different party**: New session_group_id, isolated deck
- **Dual-Phone pairing**: Requires 6-digit join code (hashed, 10-min expiry)
- **Cleanup**: Expire sessions after 30-min inactivity, waiting dual after 10-min

## Relationship Contexts (v1.2)
- **Exploring**: Personal connection - new or existing - oriented toward discovery
- **Established**: Ongoing, committed romantic relationship

## Milestones
- Phase 1 (20h): Setup, QR, welcome, context/mode, session groups, join codes
- Phase 2 (35h): Deck logic, questions, Single+Dual modes, participant sync
- Phase 3 (25h): Testing (70% coverage), analytics, UI polish, cleanup jobs
- Phase 4 (20h): Deploy, docs, QR codes, handoff + 10h support

## Quality Standards
- Touch targets: 48px min | Latency: <300ms | Mobile-first | No PII | UTC timestamps
- Code: camelCase (JS), snake_case (DB), parameterized queries only
- Join code: 6-digit numeric, SHA256 hashed with salt, rate-limited (5 attempts/min)# Table-Talk MVP - Development Rules v1.2

**Client:** Charles Peterson (Made to Connect Co) | **Budget:** 110hrs @ $10/hr | **Platform:** DigitalOcean

## Core Features
1. **QR Scan** → Welcome → **Context Selection** (Exploring/Established) → **Mode** (Single/Dual-Phone) → Questions
2. **Deterministic Deck**: Seed-based shuffle, no repeats per table/day, wraps at end
3. **Dual-Phone Sync**: WebSocket <300ms latency, "Both Ready" ritual (open-ended), checkmark reveal (multiple-choice)

## Tech Stack
- Frontend: React + Tailwind, mobile-first (375px min)
- Backend: Node.js/Express + Socket.io
- Database: PostgreSQL (sessions, deck_sessions, questions, analytics_events)
- Hosting: DigitalOcean App Platform + Managed Postgres

## Privacy (CRITICAL)
❌ NEVER store: names, emails, phones, IPs, answer content
✅ Store only: session_id (UUID), timestamps (UTC), question_id, anonymous events

## Database Schema
```sql
sessions: session_id, table_token, restaurant_id, mode, context, expires_at
deck_sessions: deck_context_id, seed, position_index, service_day
questions: question_id, text, answer_text, type, context, difficulty, options
analytics_events: event_id, session_id, event_type, event_data, timestamp
```

## Relationship Contexts (v1.2)
- **Exploring**: Personal connection - new or existing - oriented toward discovery
- **Established**: Ongoing, committed romantic relationship

## Milestones
- Phase 1 (20h): Setup, QR, welcome, context/mode selection
- Phase 2 (35h): Deck logic, questions, Single+Dual modes, sync
- Phase 3 (25h): Testing (70% coverage), analytics, UI polish
- Phase 4 (20h): Deploy, docs, QR codes, handoff + 10h support

## Quality Standards
- Touch targets: 48px min | Latency: <300ms | Mobile-first | No PII | UTC timestamps
- Code: camelCase (JS), snake_case (DB), parameterized queries only