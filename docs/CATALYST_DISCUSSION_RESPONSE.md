# Table Talk (aka Catalyst) — Product Discussion Responses
**Source memo:** `Table Talk (aka Catalyst).md` (Product Thoughts to Share and Discuss, Aug 3, 2026)
**Response date:** 2026-08-06
**Scope:** Answers based on the *actual current repo state*, not a redesign. Includes performance confidence baseline, per-item status, and prioritized next steps.

---

## Confidence Baseline (Actual Performance Today)

This document is grounded in live repository state and local verification.

**Build / diagnostics**
- IDE diagnostics: clean.
- Frontend production build: passing.
  - Output: `frontend/dist/index-*.js` ≈ 938 kB (283 kB gzip)
  - CSS ≈ 60 kB (9.9 kB gzip)
- Backend Jest tests: runnable; `deckService` unit suite executed and passed locally.
- Coverage target (70% from `Phase 3.txt`) is **not currently enforced by CI** and no coverage reports are wired.

**Key reference points inside the repo**
- Frontend API builder + env-aware base: [index.js](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/api/index.js)
- Frontend login (now fixed for production): [Login.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/Login.jsx)
- Backend API route aliases (production-safe): [index.js](file:///c:/Users/Public/Documents/Table-Talk/backend/index.js#L109-L139)
- Session controller + analytics writes: [sessionController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/sessionController.js)
- Question views + navigation events: [questionController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/questionController.js)
- Super Admin metrics + exports: [adminController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/adminController.js), [SuperAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/SuperAdminDashboard.jsx)
- Restaurant tables + QR generation: [adminController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/adminController.js#L1534-L1652), [RestaurantAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/RestaurantAdminDashboard.jsx)
- Session cleanup / retention: [cleanup.js](file:///c:/Users/Public/Documents/Table-Talk/backend/jobs/cleanup.js)
- Deployment specs: [app-spec.yaml](file:///c:/Users/Public/Documents/Table-Talk/app-spec.yaml), [app-spec-optimized.yaml](file:///c:/Users/Public/Documents/Table-Talk/app-spec-optimized.yaml), [DEPLOYMENT_CHECKLIST.md](file:///c:/Users/Public/Documents/Table-Talk/docs/DEPLOYMENT_CHECKLIST.md)

---

## Priority 1 Items

### 1. Testing: QR codes into couples hands this week. Test Restaurant support?

**Status:** GO. No architectural blockers.

**What works today**
- Multi-tenant restaurants + `restaurant_tables` are fully implemented:
  - Schema: [008_multi_restaurant.sql](file:///c:/Users/Public/Documents/Table-Talk/backend/database/migrations/008_multi_restaurant.sql), [009_admin_dashboards.sql](file:///c:/Users/Public/Documents/Table-Talk/backend/database/migrations/009_admin_dashboards.sql)
  - Table registration + QR URL generation by tenant slug + table number: [adminController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/adminController.js#L1534-L1652)
  - Restaurant Admin dashboard can register tables, generate PNG QRs, and print with restaurant name + paper size (Letter / A4 / A5): [RestaurantAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/RestaurantAdminDashboard.jsx#L199-L700)
- Frontend scanner accepts *only* the new tenant-aware `/r/{slug}/t/{tableNumber}` QR format; legacy QRs are explicitly blocked:
  - Scanner parse: [Home.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/Home.jsx#L20-L75)
  - Legacy block screen: [LegacyQrBlocked.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/LegacyQrBlocked.jsx#L30-L45)
- Session retention / party isolation: ~24h, with a cron cleanup that also handles stale dual waits and mutual-start-fresh termination: [cleanup.js](file:///c:/Users/Public/Documents/Table-Talk/backend/jobs/cleanup.js#L35-L133)

**Concerns / Risks (do these before printing)**
1. **Production redeploy health.**
   - Backend route aliases (`/admin` vs `/api/admin`) were pushed recently to fix DO 404s. Verify:
     - `GET /api/health` returns `{"status":"ok"}`
     - `POST /api/admin/login` works from the admin login page hosted on the same domain.
2. **Single-instance assumption.**
   - Setup locks and Socket.io room state are *in-memory* on the Node process: [index.js](file:///c:/Users/Public/Documents/Table-Talk/backend/index.js#L150-L165).
   - Fine for a test week on `instance_count: 1`. Do not scale horizontally yet without Redis adapter + shared locks.
3. **Event funnel (see item 4) is sparse.**
   - We can tell sessions started, but not exactly *where* couples abandoned. If the goal is feedback-driven iteration, the highest-value next code change is instrumentation, not new UI.
4. **Bundle size on low-end phones / poor signal:**
   - 283 kB gzip JS is acceptable but not great. Acceptable for test week; plan to code-split dashboards + scanner.

**Recommended Test Restaurant procedure**
1. Create a dedicated tenant in Super Admin (e.g., slug `test-catalyst`).
2. Add a full profile: address, contact. Live geocoding fills lat/lng automatically.
3. Restaurant Admin dashboard → Register 10 tables: `table-001`…`table-010`.
4. Generate all 10 QRs → print on Letter with restaurant branding → distribute to testers.
5. Gather feedback in two buckets:
   - Product/copy questions (What felt awkward? Did context/mode feel weird?)
   - Behavioral (where did they stop? how far did they get?) — item 4 instrumentation is the only way to answer the second bucket reliably.

---

### 2. Dashboard walkthrough request.

**Status:** A walkthrough is feasible now. The dashboard is operational and covers the main surfaces.

**What is worth demoing (and in what order)**

**Super Admin path** ([SuperAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/SuperAdminDashboard.jsx))
1. **Live Platform Metrics command center**
   - Live sessions, live restaurants, active tables, live dual sessions.
   - Ranges: 24h / 7d / 30d.
   - Timeline: QR scans, sessions started, question views per bucket.
   - Context mix + recent activity feed.
2. **Restaurant onboarding (invite → tenant)**
   - Create tenant invite → “Open Email Draft” (now opens in a new tab).
   - Tenant creation, billing status, profile + map editing.
   - Live geocode auto-fill when editing address (uses an authenticated geocode endpoint, so it works for Super Admin and Restaurant Admin).
3. **Restaurant map view**
   - Per-restaurant cards show active tables + sessions.
   - Map falls back to address-search iframe if coordinates are missing.
4. **Question Library**
   - Search + filters (Context / Type / Difficulty).
   - Manual add/edit/delete + bulk delete.
   - Reshuffle controls.
   - CSV Import (supports “replace existing” for full refresh).
   - CSV Export with print-ready headers:
     - `Question Text, Follow-up / Tip, Question Type, Context, Difficulty, Options`
5. **Metrics Export**
   - CSV or JSON for the chosen range.

**Restaurant Admin path** ([RestaurantAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/RestaurantAdminDashboard.jsx))
1. Profile + map editing.
2. Table registration.
3. QR generation + print dialog (restaurant name, paper size selector).
4. Sessions list (last 200) + summary counts.

**Known gaps the walkthrough should not claim exist**
- No dedicated funnel dashboard (scan → welcome → context → mode → questions).
- No per-question performance dashboards yet.
- No raw events CSV export button yet (only aggregated metrics + questions CSV + tenant sessions list).

---

### 3. How do I update the question list?

**Status:** Fully supported via dashboard. Two preferred paths:

**Path A — Dashboard UI (for spot changes)**
- Super Admin → Global Question Library.
- Individual CRUD, bulk delete, sort order, active toggle, sub-category.

**Path B — CSV (for bulk refreshes)**
- Upload a CSV with recognized headers:
  - `question_text` (aliases: `text`, `question`)
  - `answer_text` (aliases: `hint`, `follow_up_tip`, `follow_up`, `tip`, `Follow-up / Tip`)
  - `question_type` (alias: `type`)
  - `options` (alias: `choices`)
  - `context`, `difficulty`, `category`, `sub_category`, `active`, `sort_order`
- Export prints spreadsheet-style headers:
  - `Question Text, Follow-up / Tip, Question Type, Context, Difficulty, Options`
- Import/export is implemented here:
  - Import: [adminController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/adminController.js#L1293-L1334)
  - UI: [SuperAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/SuperAdminDashboard.jsx#L248-L497)

**Important detail**
- A previous stale-cache issue meant newly imported hints were invisible to in-progress live sessions even after DB update. That is resolved: the deck service no longer serves cached question payloads from memory, so imports/edits show up immediately in the next state fetch.

---

## Priority 2 Items

### 4. “Log every step of every session” with timestamps. Raw events only. Append-only. No third-party analytics.

**Status:** Only partially implemented. The DB *shape* is correct (`analytics_events` table, INSERTs only, ISO timestamps), but *event coverage is too sparse* to support the funnel analysis the memo wants.

#### Events currently recorded (confirmed in code)

Backend currently emits these `analytics_events` rows:
- `qr_scan_validated`, `qr_scan_rejected` (public handshake)
- `session_group_created`, `session_joined_existing_group`
- `session_created`, `join_code_generated`
- `session_paired`, `auto_join_success`
- `context_changed`, `mode_selected` (only when an existing session is patched via API, not the initial create step)
- `next_clicked`, `prev_clicked`
- `answer_revealed`, `question_viewed`
- `dual_session_terminated_mutual`
- Operational: `cleanup_job_completed`

#### Coverage gaps (the memo explicitly wants these; we don’t have them)

**Funnel steps (most critical)**
1. Scanner success / QR decoded (frontend-side, before handshake)
2. Welcome screen rendered
3. Welcome “Continue” clicked
4. Context screen rendered
5. Context selected + which choice
6. Mode screen rendered
7. Single / Dual chosen + which choice
8. *Each* question shown (not just the aggregated “viewed” at state fetch)
9. Question advance + latency (per participant)
10. Session end reasons:
   - timeout
   - Start Fresh single-side
   - Dual mutual termination
   - menu-driven reset
   - partner never joined

**Dual-only events**
- Waiting for partner (start + duration)
- Partner connected
- Partner disconnected / backgrounded / reconnected
- Per-side Next Question intent
- Both-ready sync → advance fired

**Menu events**
- Menu opened/closed
- Reset context
- Reset mode
- Start Fresh pressed (and its outcome: redirect to scanner, block, session terminated)

#### Storage posture assessment

- ✅ Raw events, never summaries.
- ✅ Append-only writes (no UPDATE/DELETE on `analytics_events` found).
- ✅ No rollup tables yet (matches the plan: only add them for speed later, never instead of raw).
- ✅ No external analytics tools; data stays in Postgres.
- ⚠️ Retention is not enforced. The memo says keep everything for ~6 months minimum; today nothing deletes `analytics_events` at all. That’s fine now, but add a retention policy once volume materializes.
- ⚠️ Many events are missing `restaurant_id` and `table_token` in the normalized columns; they are carried inside `event_data` sometimes. For fast reporting we should denormalize them to top-level columns (or add a JSONB index + helper views).

#### Best implementation path

1. **Frontend: add a tiny event logger**
   - Fire a `POST /sessions/events` (or `POST /public/events` for pre-session steps) with:
     - `anonymous_id` (sessionStorage UUID for pre-session continuity)
     - `session_id` / `participant_id` when available
     - `event_type`, `event_data`, timestamp
   - Mount/render events on: Home scanner success, WelcomeScreen, ContextSelection, ModeSelection, and SessionGame question transitions.
   - Menu/SessionMenu actions: [SessionMenu.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/components/SessionMenu.jsx#L27-L228)

2. **Backend: normalize event schema**
   - Ensure every event has top-level or JSONB-indexed fields:
     - `timestamp`, `event_id`, `session_id`, `participant_id`, `restaurant_id`, `table_token`, `event_type`, `event_data`
   - Persist unknown-participant events, and back-fill `session_id` when the session is created.

3. **Queries first, dashboards later**
   - Write the 3–5 canonical reports as SQL views first.
   - If they are slow, add rollup tables alongside raw rows.

---

### 5. Multiple sessions on one table + detection of off-table / photo QR use.

**Status:** Mostly supported; concurrent sessions are explicitly allowed in Single Mode, and groups are isolated by `session_group_id`.

**Current reality**
- Concurrent singles on the same table token: YES.
  - `getSessionByTable` returns *only* waiting dual sessions so singles don’t block singles:
    [sessionController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/sessionController.js#L527-L550)
- Dual pair + Phone C new session: YES (C gets new session; C cannot steal existing A+B pair).
- Deck progress per group: isolated (session_group_id is used in `getDeckSession` now).

**Limitations / risk**
- **Setup lock is in-memory.**
  - In a multi-instance deployment you can get two simultaneous “Phone A winners” on one table.
  - For test week, keep `instance_count: 1`.
- **No GPS / guest location collected.**
  - Correct per privacy rules; we never collect guest GPS.
  - So the dashboard *cannot* today detect “phone at restaurant vs photo at home” from GPS.

**Practical ways to detect off-table patterns without breaking privacy**
1. Pure behavior heuristics (no new data):
   - session with very long uptime > 3h
   - partner never connects in dual
   - sessions created on one table token at 2:00 AM vs a restaurant’s operating hours
2. Server-only coarse network bucket:
   - Compute a 24h-TTL hash of a /24 IP prefix + user-agent bucket *in memory only*, and log an aggregated `suspicious_session_patterns` daily summary row. Never persist raw IPs or UA strings.
3. Explicit restaurant admin “location anchor” checkbox for the day’s active hours to compare event timing.

**Suggested dashboard signals (low cost, low risk)**
- Peak concurrent sessions per table (over 15-min windows).
- Tables with >2 distinct sessions in <30 minutes.
- “Dead-end dual waits” (created, partner never joined, ended by cleanup).

---

### 6. Website + transfer to MadeToConnectCo.com

#### 6a. App on Catalyst.MadeToConnectCo.com and dashboard on CatalystDashboard.MadeToConnectCo.com

**Status:** Fully supported by the deployment architecture. The easiest and recommended setup for the next 60 days is:

**One subdomain, one unified DO App**
- `Catalyst.MadeToConnectCo.com` hosts:
  - customer scanner
  - restaurant login
  - super admin login
  - dashboards (role-gated after login)

Why:
- Single origin means `VITE_API_URL=/api` works perfectly.
- No cross-origin CORS or Socket.io path confusion.
- Existing optimized spec already supports this pattern exactly: [app-spec-optimized.yaml](file:///c:/Users/Public/Documents/Table-Talk/app-spec-optimized.yaml#L13-L23).

How to do it:
1. In DO App Platform, add the custom domain `Catalyst.MadeToConnectCo.com`.
2. DNS at registrar: `CNAME` (or DO ALIAS) `Catalyst` → the DO app hostname.
3. Set env vars:
   - Backend `FRONTEND_URL=https://Catalyst.MadeToConnectCo.com`
   - Frontend `VITE_API_URL=/api`
4. Regenerate any test restaurant QRs so they point to the new branded domain (QR URL builder already uses `FRONTEND_URL`).

**If you insist on two separate subdomains (Catalyst vs CatalystDashboard)**
- Possible, but more work. Current frontend has dashboards + scanner/login in one SPA.
- To split cleanly you’d need:
  - a second Vite entrypoint or a second static app
  - host-based routing on DO or separate apps
  - broader CORS + shared cookies/SameSite strategy

Recommendation: delay the split. The admin surface is role-based, so you don’t gain meaningful isolation by splitting the host.

#### 6b. Creation of the website in general

**Status:** Repo today contains no marketing site. The current “Home” page (`Home.jsx`) is a product-scan landing, not a brand home.

Lowest-friction plan:
1. Build MadeToConnectCo.com separately (static site generator, or AI-stitched HTML), then:
   - `MadeToConnectCo.com` → marketing / brand home
   - `Catalyst.MadeToConnectCo.com` → product app
   - Optional later: `CatalystDashboard.MadeToConnectCo.com` as above
2. Repoint `FRONTEND_URL` to `Catalyst.MadeToConnectCo.com` immediately after DNS cuts over so new QRs brand correctly.

---

### 7. Per-question resonance feedback (Yes / No)

**Status:** Not implemented. Do not add this before the funnel instrumentation in item 4.

**UX risk assessment**
- Forcing a Yes/No after every card is likely to:
  - make the app feel survey-like
  - interrupt the conversation ritual
  - reduce the average session depth
- Low-participation rate would muddy the data anyway (only very opinionated users tap).

**Recommended roll-out order (lowest UX damage → highest signal)**
1. First: rely on dwell + completion signals from item 4.
2. Second: add a single positive tap *on the card periphery* only after reveal/hint is used.
   - Tiny chip: `Useful? ⭐`
   - No second option; absence of tap is its own signal.
3. Third (after observing sessions consistently reach 8+ questions): add density-controlled full rating.
   - Ask every N questions (N default 6–8).
   - Dual-only: show the prompt *during partner wait states* so it doesn’t block sync.

Storage suggestion:
- `event_type = question_feedback`
- `event_data = { question_id, value: 'like'|'dislike'|null, dwell_seconds, position_in_deck, mode, context }`
- Keep only anonymous session/participant UUIDs (already policy-compliant).

---

### 8. Replace Exploring/Established with “How long together?” 4 buckets mapped to contexts.

**Status:** Not implemented; current UI is explicit two-choice in [ContextSelection.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/ContextSelection.jsx#L9-L111).

**Assessment**
- Correct on product/awkwardness grounds.
- Technically very low cost: it’s a UI + analytics change; deck logic still consumes `context: Exploring|Established`.

**Plan**
1. Add a new DB column (or just an event) for `relationship_length_bucket`:
   - `under_6_months`
   - `6_months_to_2_years`
   - `2_to_10_years`
   - `10_plus_years`
2. UI: one 4-option screen instead of the current context screen.
3. Mapping (per the memo, but keep it configurable):
   - Under 6 months → Exploring
   - 6 months - 2 years → Exploring
   - 2 - 10 years → Established
   - 10+ years → Established
4. Collect raw buckets for at least 6 weeks before splitting content further.
5. Do not hardcode the mapping inside React; keep it server-side (or a deploy-time constant) so we can adjust mid-cycle without releasing a client build.

---

### 8 (bis). Mid-session NPS 0–10 recommendation question.

**Status:** Not implemented. High value / low effort. Recommend doing *before* per-question feedback.

**Design matching your constraints**
- Exact wording: `How likely are you to recommend this to a friend?` (0–10, 11 points)
- Trigger: configurable, not a fixed question number.
  - Best initial rule: `questions_viewed >= 5 AND session_elapsed >= 6 min`.
  - Store the trigger settings used *alongside* each submission so later cohorts are comparable.
- Storage:
  - `event_type = nps_submitted`
  - `event_data = { score, trigger: { min_questions_viewed, min_elapsed_seconds, trigger_name }, questions_viewed_at_submit, session_elapsed_seconds, context, mode }`
- Dual Mode placement:
  - Present after one partner has already clicked “Next Question” while waiting (dead time anyway), not during a reveal/answer sync.

---

## Priority 3 — Operational

### 9. Data export abilities today.

**Status:** Partial coverage; very usable for analytics summaries and the question library, but raw event exports are missing.

#### Exports that exist today
1. **Super Admin Metrics (range-based)**
   - CSV + JSON from dashboard.
   - CSV columns `[section, label, value]` covering overview, live restaurants, context mix, recent activity.
2. **Global Question Library CSV**
   - Print-ready headers per your spreadsheet spec.
3. **Tenant Sessions List (raw)**
   - Last 200 sessions per restaurant via endpoint.

#### Exports missing and recommended soon
1. Raw `analytics_events` CSV export (Super Admin).
   - Filters: date range, restaurant, event types.
2. Question performance CSV.
   - Per question: views, median dwell, reveal rate, dual-mode completion ratio, NPS cohort rating of session, and (if added) like/dislike counts.
3. Table URL list export per restaurant.

---

### 10. Table numbers + QR codes: project name + table count → get back a Table N/URL list.

**Status:** The pieces exist individually; the one-click exact deliverable you described is not yet a single button.

#### What does exist
- `restaurant_tables.table_number` uniquely per restaurant.
- Sessions already carry that table identifier (so Table 7 shows up in data).
- Print displays show the table number.
- URLs are deterministic and stable under domain change (because they are built from `FRONTEND_URL`).

#### What to add to match your ops flow exactly
1. **Bulk table creator** in Super Admin per tenant:
   - Input: `start=1 end=30 pattern=table-{nnn}`
   - Backend batch inserts 30 rows and returns the flat list.
2. **Table URL list exporter** per restaurant (CSV):
   - Columns:
     - `Table Number`
     - `Public URL`
     - `QR PNG Filename`
     - `Dashboard Table ID`
3. Optionally, attach a ZIP of QR PNGs alongside the CSV (nice-to-have).

---

# Prioritized Action Roadmap

## Do before the first couples test (this week)
- [ ] Redeploy backend on DO and verify `/api/health`, `/api/admin/login`, and a full dual-phone scan → partner join end-to-end.
- [ ] Create Test Restaurant tenant, 10 tables, print QRs.
- [ ] Keep `instance_count: 1` for backend.
- [ ] Confirm session resumes after 1 minute backgrounding on both phones.

## Highest ROI engineering next (in order)
- [ ] **Implement full per-step event funnel (item 4)**
  - Raw events only
  - Standardize schema
  - Pre-session anonymous IDs
- [ ] **Add raw analytics events export button (item 9 gap)**
- [ ] **Mid-session NPS prompt (item 8bis)**
  - Configurable trigger
  - 0–10 scale exactly as specified
- [ ] **Bulk table creator + Table/URL list export (item 10)**
  - One-step: specify restaurant + table count → get CSV

## Next, when steady sessions consistently reach question 5+
- [ ] Relationship length 4-bucket screen replacing context selection (map to Exploring/Established server-side)
- [ ] Low-density per-question resonance chip
- [ ] Code-split dashboards and scanner to shrink first load

## Brand + infra move
- [ ] Point `Catalyst.MadeToConnectCo.com` at DO unified app
- [ ] Update `FRONTEND_URL` globally and regenerate any printed test QRs
- [ ] Build separate marketing MadeToConnectCo.com outside this repo

## Scale-up only (once multi-restaurant, multi-session load is real)
- [ ] Redis Socket.io adapter + shared setup locks (cluster-safe)
- [ ] JSONB indexes on `analytics_events.event_data`
- [ ] Dashboard rollup tables (alongside raw events, not in place of them)
- [ ] Optional: split dashboards onto `CatalystDashboard.MadeToConnectCo.com`

---

## Code Index

| Topic | File(s) |
|---|---|
| Production API route aliases + Socket.io | [backend/index.js](file:///c:/Users/Public/Documents/Table-Talk/backend/index.js#L109-L139) |
| Session creation, pairing, resume, resolve, menu updates, state | [backend/controllers/sessionController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/sessionController.js) |
| Question view / next / prev / reveal events | [backend/controllers/questionController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/questionController.js) |
| Super Admin metrics, import/export, tables/QR | [backend/controllers/adminController.js](file:///c:/Users/Public/Documents/Table-Talk/backend/controllers/adminController.js) |
| Session cleanup / retention / termination | [backend/jobs/cleanup.js](file:///c:/Users/Public/Documents/Table-Talk/backend/jobs/cleanup.js) |
| Frontend scanner + QR parse | [frontend/src/pages/Home.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/Home.jsx#L20-L75) |
| Welcome screen (continue / resume / auto-join) | [frontend/src/pages/WelcomeScreen.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/WelcomeScreen.jsx) |
| Context selection screen | [frontend/src/pages/ContextSelection.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/ContextSelection.jsx#L9-L111) |
| Mode selection screen (single/dual) | [frontend/src/pages/ModeSelection.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/ModeSelection.jsx) |
| Session game + dual sync logic | [frontend/src/pages/SessionGame.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/SessionGame.jsx) |
| In-session menu (Start Fresh, mode/context switches) | [frontend/src/components/SessionMenu.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/components/SessionMenu.jsx#L27-L228) |
| Super Admin dashboard UI | [frontend/src/pages/SuperAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/SuperAdminDashboard.jsx) |
| Restaurant Admin dashboard | [frontend/src/pages/RestaurantAdminDashboard.jsx](file:///c:/Users/Public/Documents/Table-Talk/frontend/src/pages/RestaurantAdminDashboard.jsx) |
| Optimized DO app spec | [app-spec-optimized.yaml](file:///c:/Users/Public/Documents/Table-Talk/app-spec-optimized.yaml) |
| Deployment checklist | [docs/DEPLOYMENT_CHECKLIST.md](file:///c:/Users/Public/Documents/Table-Talk/docs/DEPLOYMENT_CHECKLIST.md) |
