# Table-Talk MVP Development Rules

## Project Identity

**Project Name:** Table-Talk MVP  
**Client:** Charles Peterson (Made to Connect Co)  
**Project Type:** QR-based conversation starter web application  
**Development Model:** Work-for-hire (all IP belongs to client)  
**Version:** 1.1 (Updated from PRD.md)

---

## Core Product Vision

Table-Talk helps people have meaningful conversations at restaurants and social gatherings by providing thought-provoking questions accessed via QR codes placed on tables.

**Mission:** Transform ordinary meals into opportunities for deeper connection and discovery through thoughtfully curated questions that adapt to relationship stages.

### Primary Use Cases
1. **Single-Phone Mode (Conversation-First)**: One person scans QR, group shares one device, minimal phone interaction
2. **Dual-Phone Mode (Synchronized Experience)**: Two people scan same QR, synchronized experience with private reflection moments

---

## Technical Architecture Rules

### Hosting & Infrastructure
- **Platform:** DigitalOcean App Platform
- **Database:** DigitalOcean Managed PostgreSQL
- **Deployment:** Must follow DigitalOcean Hosting Profile v1.0
- **Repository:** GitHub (client-owned)

### Technology Stack Constraints
- **Frontend:** Modern JavaScript framework (React/Vue/Svelte) - mobile-first
- **Backend:** Node.js + Express OR Python + FastAPI
- **Database:** PostgreSQL only (DigitalOcean Managed)
- **Real-time:** WebSocket (Socket.io) or Server-Sent Events for Dual-Phone sync
- **Mobile-First:** Responsive design, tested on iOS Safari and Android Chrome
- **Styling:** Tailwind CSS or similar utility-first framework

### Performance Requirements
- **Latency:** <300ms for all user actions
- **Load Time:** Initial page load <2 seconds
- **Offline:** Graceful degradation when connection lost
- **Reconnect:** Automatic session recovery

---

## Data & Privacy Rules

### Strict Privacy Requirements
❌ **NEVER STORE:**
- Names
- Phone numbers
- Email addresses
- IP addresses (beyond session management)
- Device identifiers
- Any personally identifiable information (PII)

✅ **ALLOWED TO STORE:**
- Anonymous session IDs
- Table IDs (from QR codes)
- Timestamps
- Question IDs
- Mode selection (Single/Dual)
- Aggregate analytics events

### Data Retention
- Sessions expire after 24 hours
- Analytics data aggregated and anonymized
- No user tracking across sessions

---

## Core Feature Requirements

### 1. QR Code Scanning & Session Creation
```
FLOW:
User scans QR → Extract table_token → Show welcome screen → Context selection → Mode selection → Create/join session
```

**Rules:**
- Each QR code contains unique `table_token` (e.g., table_042, venue_123_table_8)
- QR format: `https://tabletalk.app/t/{table_token}`
- Welcome screen shows brief message: "Welcome to Table Talk. Thoughtful questions designed to spark meaningful conversation between two people. Explore new topics together... and stay curious."
- First scan creates new session after welcome and selections
- Subsequent scans join existing session (same table, same service day)
- Sessions tied to: restaurant_id + table_token + relationship_context + service_day

### 2. Relationship Context Selection (REQUIRED)
**Three Contexts:**
- **Exploring**: A personal connection - new or existing - oriented toward discovery (first dates, new friendships, getting-to-know-you)
- **Established**: An ongoing, committed romantic relationship (couples with history, intentional reconnection)
- **Mature**: A long-term romantic relationship marked by shared history and depth (20+ years together, philosophical exploration)

**Rules:**
- Context selection required before any questions display
- Selection determines which questions are eligible (filters question set)
- Context displayed subtly during session (e.g., header icon)
- Cannot change context mid-session (maintains deck integrity)
- Context replaces previous "category" concept

### 3. Mode Selection
**Single-Phone Mode:**
- One device for entire group
- Simple "Next Question" button
- No synchronization needed
- Conversation-first, minimal device interaction

**Dual-Phone Mode:**
- Two devices connect to same session
- Real-time sync of question reveals and progression
- Coordinated "Next" button (both must click)
- Automatic reconnection handling
- Connection status indicators visible

**Rules:**
- Mode chosen once at session start (after context selection)
- Cannot switch modes mid-session
- UI adapts based on selected mode

### 3. Question Loop Logic
```
CORE ALGORITHM:
1. User selects Relationship Context (Exploring/Established/Mature)
2. Load eligible questions for selected context
3. Apply deterministic shuffle using stored seed
4. Display questions sequentially (virtual deck)
5. Track position_index in deck_sessions table
6. Prevent repeats within same deck context
7. Reset deck at midnight UTC (new service day)
```

**Question Display Rules:**
- Show one question at a time (full-screen focus)
- Optional answer/hint text (collapsed by default, expandable)
- "Next Question" button advances deck
- Progress indicator (e.g., "Question 5 of 50")
- No back button (forward-only progression)
- Smooth transitions between questions (300ms fade)

**Question Types:**
1. **Open-Ended** (Primary format):
   - Conversational prompts requiring discussion
   - Optional hint/reflection text
   - No typed input required
   
2. **Multiple-Choice** (Variety format):
   - 3-5 answer options
   - Private selection in Dual-Phone mode
   - Reveal ritual shows selections with checkmarks

**Daily Deck Logic (Deterministic Randomization):**
- Each unique deck context gets deterministic shuffle
- Deck context = hash(restaurant_id + table_token + relationship_context + service_day)
- Seed stored in deck_sessions table
- Same seed always produces same question order
- Position_index tracks current location (0-based)
- Deck wraps to beginning if exhausted
- New service day (midnight UTC) creates new deck context
- Virtual deck generated on-demand, never stored as full list

### 4. Dual-Phone Synchronization & Interaction Rituals

**Design Principle:** State changes annotate existing content rather than replacing it. This maintains context and keeps conversation primary.

#### 4.1 Open-Ended Questions - Shared Readiness Ritual

**Intent:** Signal mutual readiness to talk without requiring typed input.

**Flow:**
1. Both devices display same open-ended question
2. No text input required
3. Each participant sees [Ready] button
4. When one taps [Ready], UI shows "✓ Ready" locally, partner sees "Partner is ready ⏳"
5. When both tap [Ready]:
   - Brief confirmation: "Both Ready ✓✓" (2 seconds)
   - Confirmation fades automatically
   - Question text remains visible but de-emphasized (50% opacity, gray #8E8E93)
   - Screen enters "conversation state" with subtle message: "Conversation in progress..."
   - [Next] button becomes available
6. Both must click [Next] to advance (standard Dual-Phone logic)

**Visual State After "Both Ready":**
- Question de-emphasized visually (not removed)
- Focus shifts from reading to conversation
- No answer content stored in database

#### 4.2 Multiple-Choice Questions - Shared Reveal Ritual

**Intent:** Allow brief private selection with shared reveal moment for comparison and conversation.

**Flow:**
1. Both devices display same multiple-choice question + options (3-5 options)
2. Each participant selects option(s) privately (not visible to partner)
3. Selected option highlighted locally (e.g., blue border)
4. [Final Answer] button appears after selection
5. First user taps [Final Answer] → sees "Waiting for partner... ⏳"
6. Second user taps [Final Answer] → both see reveal state simultaneously
7. **Reveal State:**
   - Original question and all options remain on screen (no screen change)
   - Checkmarks (✓) appear inline next to/on selected options
   - Example: "● Invisibility ✓ ✓" (both selected)
   - Example: "○ Time travel ✓" (one selected)
   - Checkmarks identical for both users (no color differentiation in MVP)
   - No scoring or judgment displayed
8. Conversation occurs comparing choices
9. [Next] button active, both must click to advance

**Important Notes:**
- Answer options annotated, not replaced
- No indication of who selected what (anonymous in MVP)
- No answer content stored in database (only event logged)
- Future enhancement: color-coded checkmarks, percentage stats (deferred)

#### 4.3 Sync Events (WebSocket/SSE)
- `session_joined` - Second user connects
- `question_displayed` - Both see new question
- `ready_toggled` - Open-ended readiness state change
- `both_ready` - Both users ready (trigger conversation state)
- `answer_submitted` - Multiple-choice selection submitted
- `reveal_answers` - Both submitted, show checkmarks
- `next_requested` - User clicked Next
- `question_advanced` - Both users clicked, advance together
- `user_disconnected` - Partner lost connection
- `user_reconnected` - Partner rejoined

**Sync Rules:**
- Use WebSockets or Server-Sent Events
- <300ms sync latency requirement
- Handle disconnections gracefully
- Auto-reconnect with session ID
- Show "waiting for other person" state clearly
- Connection status indicator (green dot = connected)

### 5. Reconnection Handling
**Scenarios:**
- Browser refresh
- Network interruption
- Device sleep/wake
- Tab switching
- WebSocket disconnection

**Rules:**
- Store session_id in sessionStorage
- Auto-reconnect on page load
- Resume at current question (using position_index)
- Show reconnection status to user
- Timeout after 30 minutes of inactivity
- Exponential backoff for reconnection attempts (3 max)
- Session expires after 24 hours

**Reconnection Flow:**
1. Check sessionStorage for session_id
2. Show "Reconnecting..." indicator
3. Fetch session from API: GET /api/sessions/{session_id}
4. If valid: restore state, resume at current position
5. If expired: redirect to landing with message
6. If failed: show retry button after 3 attempts

---

## Analytics Requirements

### Event Tracking (Anonymous Only)
Track these events without PII:
- `session_created` - {table_id, mode, timestamp}
- `question_viewed` - {session_id, question_id, timestamp}
- `answer_revealed` - {session_id, question_id, timestamp}
- `next_clicked` - {session_id, question_id, timestamp}
- `session_ended` - {session_id, duration, questions_viewed}
- `reconnect_attempted` - {session_id, success}

### Analytics Rules
- All events timestamped (UTC)
- No personally identifiable data
- Aggregate daily/weekly reports
- Track mode usage (Single vs Dual)
- Monitor average session duration

---

## UI/UX Rules

### Mobile-First Design
- Design for 375px width minimum (iPhone SE)
- Test down to 320px width
- Touch targets minimum 44px × 44px (iOS guideline) or 48px × 48px (Material Design)
- Readable text (16px minimum body, 24px question text)
- High contrast for outdoor restaurant use
- Large, obvious CTA buttons

### Visual Hierarchy & Typography
1. **Primary:** Question text (24px, bold, #1C1C1E)
2. **Secondary:** Answer/hint text (18px, medium, #1C1C1E)
3. **Tertiary:** Navigation and progress (16px, #8E8E93)
4. **Background:** Clean white (#FFFFFF) or light gray (#F2F2F7)

### Color System
- **Primary CTA:** Blue #007AFF (iOS blue, familiar)
- **Success/Ready:** Green #34C759 (positive confirmation)
- **Error:** Red #FF3B30 (errors, warnings)
- **Text Primary:** Near Black #1C1C1E (high contrast)
- **Text Secondary:** Gray #8E8E93 (de-emphasized)
- **Border:** Light Gray #D1D1D6 (subtle dividers)

### Interaction Patterns
- Single tap to reveal answer/hint
- Obvious button for Next question (fixed bottom position, 48px height)
- Loading states for all async actions (spinner or skeleton)
- Error messages in plain language with retry buttons
- Success confirmations subtle (toast notifications, 2 seconds)
- Smooth transitions (300ms fade animations)

### Spacing System (8px grid)
- xs: 8px (tight spacing)
- sm: 16px (related elements)
- md: 24px (section spacing)
- lg: 32px (major sections)
- xl: 48px (page-level spacing)

### Responsive Breakpoints
- **Mobile:** 320px - 767px (primary design target)
- **Tablet:** 768px - 1024px (centered content, max-width 600px)
- **Desktop:** 1025px+ (centered content, max-width 600px, generous margins)

---

## Database Schema Rules

### Tables Required

**sessions**
```sql
CREATE TABLE sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_token VARCHAR(100) NOT NULL,
  restaurant_id VARCHAR(100) NOT NULL,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('single-phone', 'dual-phone')),
  context VARCHAR(20) NOT NULL CHECK (context IN ('Exploring', 'Established', 'Mature')),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  last_activity_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_table_token (table_token),
  INDEX idx_expires_at (expires_at),
  INDEX idx_restaurant (restaurant_id)
);
```

**deck_sessions** (Deterministic shuffle tracking)
```sql
CREATE TABLE deck_sessions (
  deck_context_id VARCHAR(64) PRIMARY KEY,  -- SHA256 hash
  restaurant_id VARCHAR(100) NOT NULL,
  table_token VARCHAR(100) NOT NULL,
  relationship_context VARCHAR(20) NOT NULL CHECK (relationship_context IN ('Exploring', 'Established', 'Mature')),
  service_day DATE NOT NULL,
  seed VARCHAR(64) NOT NULL,              -- UUID for deterministic shuffle
  position_index INTEGER DEFAULT 0,       -- Current position in virtual deck
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE (restaurant_id, table_token, relationship_context, service_day),
  INDEX idx_lookup (restaurant_id, table_token, relationship_context, service_day)
);
```

**questions** (seed data)
```sql
CREATE TABLE questions (
  question_id SERIAL PRIMARY KEY,
  question_text TEXT NOT NULL,
  answer_text TEXT,                        -- Optional hint/reflection prompt
  question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('open-ended', 'multiple-choice')),
  context VARCHAR(20) NOT NULL CHECK (context IN ('Exploring', 'Established', 'Mature')),
  difficulty VARCHAR(10) CHECK (difficulty IN ('easy', 'medium', 'deep')),
  options JSONB,                           -- For multiple-choice: [{"id": "a", "text": "Option A"}, ...]
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE,
  
  INDEX idx_context (context, active),
  INDEX idx_type (question_type)
);
```

**analytics_events**
```sql
CREATE TABLE analytics_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  timestamp TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_event_type (event_type),
  INDEX idx_timestamp (timestamp),
  INDEX idx_session (session_id)
);
```

### Schema Rules
- Use UUIDs for session identifiers
- Index on table_id + created_at for deck lookup
- JSONB for flexible analytics data
- Timestamps in UTC always
- Cascading deletes for expired sessions

---

## Code Quality Standards

### Code Organization
```
/frontend
  /src
    /components
    /pages
    /hooks
    /utils
    /styles
/backend
  /src
    /routes
    /controllers
    /models
    /services
    /middleware
/database
  /migrations
  /seeds
```

### Naming Conventions
- **Variables:** camelCase (`sessionId`, `tableId`)
- **Components:** PascalCase (`QuestionCard`, `ModeSelector`)
- **Files:** kebab-case (`question-card.jsx`, `session-service.js`)
- **Database:** snake_case (`session_id`, `table_id`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_SESSION_DURATION`)

### Error Handling
- All async functions must handle errors
- User-facing error messages in plain English
- Log errors with context (no PII in logs)
- Graceful degradation (show cached content if possible)
- Retry logic for network failures (3 attempts)

### Security Rules
- No API keys in frontend code
- CORS properly configured
- Rate limiting on all endpoints (100 req/min per IP)
- Input validation on all user data
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitize all output)

---

## Testing Requirements

### Test Coverage Targets
- **Unit Tests:** 70% coverage minimum
- **Integration Tests:** Critical paths (QR scan, mode selection, sync)
- **E2E Tests:** Full user flows (Single-Phone, Dual-Phone)

### Required Test Scenarios

**Single-Phone Mode:**
1. Scan QR → Select Single-Phone → See first question
2. Reveal answer → Click Next → See second question
3. Complete 5 questions → Verify no repeats
4. Refresh browser → Resume at same question

**Dual-Phone Mode:**
1. Device A scans QR → Select Dual-Phone → Wait for partner
2. Device B scans same QR → Both see first question
3. Device A clicks Next → See "waiting" state
4. Device B clicks Next → Both advance
5. Device A disconnects → Device B sees status
6. Device A reconnects → Sync resumes

**Edge Cases:**
- QR with invalid table_id
- Session expired (>24 hours)
- Network timeout during sync
- Rapid clicking of Next button
- Multiple tabs same session

### Device Testing
- iPhone (Safari, latest iOS)
- Android (Chrome, latest Android)
- iPad (Safari)
- Desktop browsers (Chrome, Firefox, Safari)

---

## Deployment Rules

### Environment Variables
```
DATABASE_URL=postgresql://...
SESSION_SECRET=...
WEBSOCKET_URL=wss://...
ANALYTICS_ENABLED=true
LOG_LEVEL=info
```

### Pre-Deployment Checklist
- [ ] All tests passing
- [ ] Database migrations applied
- [ ] Environment variables set
- [ ] HTTPS configured
- [ ] CORS origins whitelisted
- [ ] Rate limiting enabled
- [ ] Error logging configured
- [ ] Analytics verified
- [ ] Mobile devices tested
- [ ] Load testing completed (100 concurrent users)

### Deployment Process
1. Merge to `main` branch
2. Run database migrations
3. Deploy backend to DigitalOcean App Platform
4. Deploy frontend (static build)
5. Verify health check endpoint
6. Test production QR codes
7. Monitor logs for 1 hour

---

## Documentation Requirements

### README.md Must Include
1. Project overview
2. Setup instructions (local development)
3. Environment variables
4. Database setup + seed data
5. Running tests
6. Deployment instructions
7. API endpoint documentation
8. Troubleshooting common issues

### Code Comments
- Complex algorithms explained
- Non-obvious business logic
- Security considerations
- Performance optimizations
- TODO items for known limitations

---

## Milestone Acceptance Criteria

### Stage 1: Setup & Session Flow (~20 hrs)
- [ ] GitHub repo initialized with proper structure
- [ ] Database schema created and migrated (all 4 tables)
- [ ] QR code scanning functional
- [ ] Welcome screen with brief message
- [ ] Relationship Context selection UI (Exploring/Established/Mature with definitions)
- [ ] Mode selection UI (Single-Phone/Dual-Phone)
- [ ] Session creation working
- [ ] Basic frontend routing (landing → welcome → context → mode → questions)
- [ ] Sessions stored with context field

### Stage 2: Core Q&A Logic (~35 hrs)
- [ ] Question display component
- [ ] Answer/hint reveal functionality
- [ ] Next question navigation
- [ ] Deterministic deck logic implemented (seed-based shuffle)
- [ ] deck_sessions table managing position_index
- [ ] Single-Phone mode fully functional
- [ ] Dual-Phone WebSocket/SSE sync working
- [ ] Open-ended "Shared Readiness Ritual" implemented
- [ ] Multiple-choice "Shared Reveal Ritual" with checkmarks
- [ ] Progress tracking accurate
- [ ] 50+ questions seeded across all contexts

### Stage 3: Testing, Analytics, UI Polish (~25 hrs)
- [ ] All test scenarios passing (Single + Dual modes)
- [ ] Analytics events logged correctly (all event types)
- [ ] Mobile UI polished and responsive (iOS + Android tested)
- [ ] Reconnection logic robust (exponential backoff)
- [ ] Error states handled gracefully
- [ ] Loading states implemented
- [ ] Connection status indicators (Dual-Phone)
- [ ] Cross-browser testing complete
- [ ] Performance optimized (<300ms latency)

### Stage 4: Deployment & Support (~20 hrs)
- [ ] Application deployed to DigitalOcean App Platform
- [ ] Production database seeded
- [ ] QR codes generated (printable, high-resolution)
- [ ] Documentation complete (README, DEPLOYMENT, API docs)
- [ ] Client handoff demonstration
- [ ] 10 hours support available (30 days)

---

## Communication Protocols

### Weekly Demos
- Show working features (no mockups)
- Demo on actual mobile devices
- Share deployed preview link
- Discuss blockers and decisions
- Review upcoming week's work

### GitHub Commits
- Commit at least 3× per week
- Descriptive commit messages
- Reference issue numbers
- Push to feature branches
- PR reviews required

### Response Times
- Critical issues: 4 hours
- Questions: 48 hours
- Weekly demos: scheduled in advance

---

## Known Constraints & Limitations

### Budget Constraints
- **Total Hours:** 110 hours (firm cap)
- **Weekly Limit:** 25 hours max
- **Post-Launch Support:** 10 hours only

### Scope Boundaries (Out of Scope)
- ❌ User accounts or login
- ❌ Custom question creation
- ❌ Admin dashboard
- ❌ Question rating/feedback
- ❌ Social sharing features
- ❌ Multi-language support
- ❌ Native mobile apps

### Technical Limitations
- No offline mode (requires connection)
- No browser storage of questions (privacy)
- No question history/favorites
- Sessions expire after 24 hours

---

## Success Metrics

### Functional Success
- Both modes work as specified
- <300ms latency maintained
- Zero PII stored
- 99% uptime during testing period

### User Experience Success
- Session creation <5 seconds
- Intuitive UI (minimal explanation needed)
- Reconnection works >95% of time
- Smooth sync in Dual-Phone mode

### Technical Success
- Clean, maintainable code
- Comprehensive documentation
- All tests passing
- Successful client handoff

---

## Change Management

### Scope Changes
- Must be approved by client in writing
- Hour impact assessed before proceeding
- Contract amendment if >10% change

### Bug Fixes
- Critical bugs fixed within support hours
- Non-critical bugs logged for future
- Security issues prioritized immediately

---

## Final Handoff Requirements

### Deliverables Checklist
- [ ] Source code in GitHub (client-owned repo)
- [ ] Deployed application (live URL)
- [ ] Database schema + seed file
- [ ] README with setup instructions
- [ ] API documentation
- [ ] Test suite
- [ ] Environment variables template
- [ ] Deployment guide
- [ ] 10-hour support agreement

### Knowledge Transfer
- Walkthrough of codebase
- Explanation of key decisions
- Demo of deployment process
- Contact for support period

---

## Emergency Protocols

### Critical Issues Definition
- Application completely down
- Data breach or security vulnerability
- PII accidentally stored
- Dual-Phone sync broken entirely

### Escalation Path
1. Notify client immediately
2. Assess impact and timeline
3. Implement hotfix if <2 hours
4. Deploy emergency patch
5. Document incident and resolution

---

*This document governs all development decisions for Table-Talk MVP. When in doubt, refer to this guide. All rules are mandatory unless explicitly overridden by client in writing.*

**Version:** 1.0  
**Last Updated:** January 2026  
**Owner:** Charles Peterson (Made to Connect Co)






# Table-Talk MVP - Development Rules v1.2

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
