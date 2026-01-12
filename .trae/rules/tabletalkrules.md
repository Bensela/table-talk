# Table-Talk MVP Development Rules

## Project Identity

**Project Name:** Table-Talk MVP  
**Client:** Charles Peterson (Made to Connect Co)  
**Project Type:** QR-based conversation starter web application  
**Development Model:** Work-for-hire (all IP belongs to client)

---

## Core Product Vision

Table-Talk helps people have meaningful conversations at restaurants and social gatherings by providing thought-provoking questions accessed via QR codes placed on tables.

### Primary Use Cases
1. **Single-Phone Mode**: One person scans QR, group shares one device
2. **Dual-Phone Mode**: Two people scan same QR, synchronized experience across devices

---

## Technical Architecture Rules

### Hosting & Infrastructure
- **Platform:** DigitalOcean App Platform
- **Database:** DigitalOcean Managed PostgreSQL
- **Deployment:** Must follow DigitalOcean Hosting Profile v1.0
- **Repository:** GitHub (client-owned)

### Technology Stack Constraints
- **Frontend:** Modern JavaScript framework (React/Vue/Svelte)
- **Backend:** Node.js or Python-based API
- **Database:** PostgreSQL only
- **Real-time:** WebSocket or SSE for Dual-Phone sync
- **Mobile-First:** Responsive design, iOS and Android tested

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
User scans QR → Extract table_id → Create/join session → Show mode selection
```

**Rules:**
- Each QR code contains unique `table_id`
- QR format: `https://tabletalk.app/t/{table_id}`
- First scan creates new session
- Subsequent scans join existing session
- Sessions tied to table + date (one deck per table per day)

### 2. Mode Selection
**Single-Phone Mode:**
- One device for entire group
- Simple "Next Question" button
- No synchronization needed

**Dual-Phone Mode:**
- Two devices connect to same session
- Real-time sync of question reveals
- Coordinated "Next" button (both must click)
- Automatic reconnection handling

**Rules:**
- Mode chosen once at session start
- Cannot switch modes mid-session
- UI adapts based on selected mode

### 3. Question Loop Logic
```
CORE ALGORITHM:
1. Load daily deck for this table (shuffled once per day)
2. Display questions sequentially
3. Track position in deck
4. Prevent repeats within same day
5. Reset deck at midnight (server time)
```

**Question Display Rules:**
- Show one question at a time
- "Reveal Answer" button (optional, collapses to show answer)
- "Next Question" button advances deck
- Progress indicator (e.g., "Question 5 of 50")
- No back button (forward-only progression)

**Daily Deck Logic:**
- Each table gets same shuffled deck for entire day
- Deck order generated using: `seed = hash(table_id + date)`
- New shuffle at midnight server time
- If deck exhausted, cycle back to start

### 4. Dual-Phone Synchronization
**Sync Events:**
- Question reveal (both see answer simultaneously)
- Next question trigger (requires both users to click)
- Session join/leave notifications

**Sync Rules:**
- Use WebSockets or Server-Sent Events
- <300ms sync latency requirement
- Handle disconnections gracefully
- Auto-reconnect with session ID
- Show "waiting for other person" state

**"Both Click Next" Logic:**
```
User 1 clicks Next → Show "Waiting for partner..."
User 2 clicks Next → Both advance to next question
```

### 5. Reconnection Handling
**Scenarios:**
- Browser refresh
- Network interruption
- Device sleep/wake
- Tab switching

**Rules:**
- Store session_id in sessionStorage
- Auto-reconnect on page load
- Resume at current question
- Show reconnection status to user
- Timeout after 30 minutes of inactivity

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
- Touch targets minimum 44px × 44px
- Readable text (16px minimum body)
- High contrast for outdoor use
- Large, obvious CTA buttons

### Visual Hierarchy
1. **Primary:** Question text (large, bold)
2. **Secondary:** Answer text (revealed on tap)
3. **Tertiary:** Navigation (Next button, progress)
4. **Background:** Minimal chrome, focus on content

### Interaction Patterns
- Single tap to reveal answer
- Obvious button for Next question
- Loading states for all async actions
- Error messages in plain language
- Success confirmations (subtle)

### Responsive Breakpoints
- **Mobile:** 320px - 767px
- **Tablet:** 768px - 1024px
- **Desktop:** 1025px+ (center content, max-width 600px)

---

## Database Schema Rules

### Tables Required

**sessions**
```sql
- session_id (UUID, primary key)
- table_id (string, indexed)
- mode (enum: 'single', 'dual')
- created_at (timestamp)
- expires_at (timestamp)
- current_question_index (integer)
- deck_seed (string) -- for daily shuffle
```

**analytics_events**
```sql
- event_id (UUID, primary key)
- session_id (UUID, foreign key)
- event_type (string, indexed)
- event_data (JSONB)
- timestamp (timestamp, indexed)
```

**questions** (seed data)
```sql
- question_id (integer, primary key)
- question_text (text)
- answer_text (text, nullable)
- category (string, nullable)
- difficulty (enum: 'easy', 'medium', 'deep')
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
- [ ] Database schema created and migrated
- [ ] QR code scanning functional
- [ ] Session creation working
- [ ] Mode selection UI complete
- [ ] Basic frontend routing

### Stage 2: Core Q&A Logic (~35 hrs)
- [ ] Question display component
- [ ] Answer reveal functionality
- [ ] Next question navigation
- [ ] Daily deck logic implemented
- [ ] Single-Phone mode fully functional
- [ ] Dual-Phone sync working (basic)
- [ ] Progress tracking

### Stage 3: Testing, Analytics, UI Polish (~25 hrs)
- [ ] All test scenarios passing
- [ ] Analytics events logged correctly
- [ ] Mobile UI polished and responsive
- [ ] Reconnection logic working
- [ ] Error states handled gracefully
- [ ] Loading states implemented
- [ ] Cross-browser testing complete

### Stage 4: Deployment & Support (~20 hrs)
- [ ] Application deployed to DigitalOcean
- [ ] Production database seeded
- [ ] Documentation complete
- [ ] Client handoff demonstration
- [ ] 10 hours support available

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