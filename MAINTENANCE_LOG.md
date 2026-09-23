# Table-Talk Project Maintenance Log

## Incident TT-2026-0829-A — SA Dashboard Total Outage (4-Way JWT Header Conflict)

**Date:** 2026-08-29
**Severity:** Critical — Super Admin Dashboard rendered completely non-functional for any admin user who had previously scanned a restaurant table QR (which left a `temp_access_token` in `sessionStorage`).

### Root Cause

A four-way collision between the new temp-geofence JWT class and the existing SUPER_ADMIN JWT class:

1. **Validator misclassification.** `validateTempGeoAccessToken()` in `publicController.js` treated **any** Bearer token (including `SUPER_ADMIN` JWTs) as a candidate temp-access token. A valid SUPER_ADMIN JWT carries `payload.role=SUPER_ADMIN + id` but `payload.purpose=undefined`; the validator returned `{valid:false, token_present:true, error_code:TOKEN_INVALID}` instead of `token_present:false`.

2. **Session-helper silent 401.** The reusable `validateSessionTempGeoAccess()` helper in `sessionController.js` returned HTTP 401 `TEMP_ACCESS_INVALID` whenever a token was present-but-not-valid. Because admin session APIs also route through this helper, a valid SUPER_ADMIN Bearer was getting blocked by the temp-geo gate **before** the admin auth middleware had a chance to evaluate it.

3. **Frontend header leak.** `attachAdminAuthHeaders()` in `frontend/src/api/index.js` unconditionally appended `Temp <geo_token>` whenever a leftover temp-access token existed in `sessionStorage` from a prior QR scan, **including** requests to `/admin/*` routes. This caused admin fetches to always carry the exact token pattern that tripped bug (1) and (2).

4. **Axios interceptor logout cascade.** The global response interceptor classified **any** HTTP 401 as "admin auth expired" and called `clearAdminAuth()`, redirecting the admin to the login page. Additionally, the TEMP_GEO 410 handler called `window.location.assign(currentPath)` on **any** path, including `/admin/*`, causing reload loops.

Combined effect: an admin who had previously used the customer-facing QR flow could never load `/admin/` — every `/admin/metrics` / `/admin/tenants` / `/admin/questions` call returned 401 → admin got silently logged out and redirected to login → zero metrics cards showing 0/0/0/0 (no render crash, data just never populated).

### Resolution Steps (Layered, additive-only where possible)

A. **Backend token pre-classification (`publicController.js`)**
   - Added `peekPayloadClaims(token)` (unsigned base64url JWT payload decode, no signature verify) — classifies tokens into role JWT (has `id + role, no purpose`) vs temp-geo JWT (has `purpose === 'temp_geo_access'`) before any HMAC/verify step.
   - Added dedicated `__verifyTempTokenSignature(rawToken)` — `timingSafeEqual` HMAC-SHA256 with `JWT_SECRET`, no `id/role` requirement — used specifically for the temp-geo token class because the existing `verifyTokenDetailed` hard-requires `id+role` claims that temp tokens never carry.
   - Rewrote `validateTempGeoAccessToken()` to a 3-path classifier:
     - **Path A** — peek shows role JWT → demote to `{token_present:false, _not_a_temp_token:true}` (let normal auth handle it).
     - **Path B** — peek shows `purpose === 'temp_geo_access'` → direct HMAC verify via `__verifyTempTokenSignature`, then scope checks (restaurant/table match).
     - **Path C** — unclassified → run `verifyTokenDetailed`, then demote on `TOKEN_INVALID + no purpose` as fallback.

B. **Session-helper passthrough (`sessionController.js`)**
   - Explicit guard in `validateSessionTempGeoAccess()`: when `check._not_a_temp_token === true`, return `{passed:true}` immediately — role bearers never get 401'd by the temp-geo gate.

C. **Frontend `/admin/*` path-scoped isolation (`frontend/src/api/index.js`)**
   - Added `isAdminPath(url)` classifier (`/admin` not `/admin-login`).
   - `attachAdminAuthHeaders(url)`:
     - Short-circuits on `/admin/*` and never attaches `Temp <geo_token>`.
     - Short-circuits after setting `Authorization: Bearer <admin>` — no leftover temp header append.
   - `apiFetch` + axios response interceptors:
     - `TEMP_ACCESS_EXPIRED` handler skips `window.location.assign` when `isAdminPath`.
     - Auth-expired 401 handler skips `clearAdminAuth()` when the event was already handled as a temp-geo event on an admin path.

D. **SA Dashboard fetch resilience (`SuperAdminDashboard.jsx`)**
   - `fetchData`: `Promise.all` → `Promise.allSettled` with 6 labeled parallel requests; each request has its own `try/catch` parser with `ok:false` + fallback (empty metrics, empty tenants, empty questions on individual module failure).
   - Added top-level `fetchError` state → amber `AlertTriangle` banner listing which modules failed + `Refresh Dashboard` retry CTA. Prevents transient payment-gateway 5xx from causing a total metrics blackout.

### Preventive Rules

1. **Header path-scope rule.** Any new auth header class must include an `isXPath(url)` classifier so headers are attached only where they're semantically meaningful. Never attach a token to `/admin/*` unless it's the admin token.

2. **JWT class pre-classification rule.** Whenever a second JWT class shares the same `Authorization: Bearer` header space (role tokens, temp-geo tokens, future invite tokens), add a `peekPayloadClaims`-style **unsigned** pre-classifier before the `verifyTokenDetailed` gate. Demotion (`token_present:false, _not_a_temp_token:true`) is safer than over-blocking.

3. **Multi-fetch dashboard rule.** Any dashboard page with ≥ 3 parallel API fetches must use `Promise.allSettled` (not `Promise.all`) with per-request try/catch + fallback + aggregated error banner so one bad module never blacks out the entire page.

4. **401 responder never single-owner.** Any global HTTP 401 response interceptor must route through a per-path classifier before calling `clearAdminAuth()` or `window.location.assign`.

5. **Dedicated verifier per JWT class.** Temp tokens that legitimately lack `id/role` claims get their own HMAC verifier, never routed through the role-JWT `verifyTokenDetailed` that will always reject them.

---

## Incident TT-2026-0829-B — PostgreSQL `08P01` Bind Mismatch in SA Metrics

**Date:** 2026-08-29
**Severity:** Critical — `GET /admin/metrics/overview?range=24h` returned HTTP 500 for ALL admins on ALL preset ranges, and `GET /admin/metrics/export` had the same class of error (timeline hard-coded `$5` when relative ranges had no `$1..$4`). All 6 range variants (24h/7d/30d/MTD/custom-7d/custom-93d) affected.

### Root Cause

Classic SQL placeholder-numbering reuse bug when refactoring from `Promise.all` of 3 separate `db.query()` calls into a **single combined** `db.query()` with 3 inlined subqueries:

- Original code (parallel):
  ```js
  const [sessions, qr, qv] = await Promise.all([
    db.query(`SELECT ... WHERE ${sWhere}`,  sParams),   // sWhere  uses $1..$N
    db.query(`SELECT ... WHERE ${aeWhere}`, aeParams),  // aeWhere uses $1..$M (independent)
    db.query(`SELECT ... WHERE ${aeWhere}`, aeParams)   // aeWhere uses $1..$M (independent)
  ]);
  ```
- Refactored code (broken combined, before fix):
  ```js
  await db.query(
    `SELECT
       (SELECT ... WHERE ${sWhere})  AS sessions_window,
       (SELECT ... WHERE ${aeWhere}) AS qr_scans_window,
       (SELECT ... WHERE ${aeWhere}) AS question_views_window`,
    [...sParams, ...aeParams, ...aeParams]  // 3 params, but every WHERE uses $1 → COLLISION
  );
  ```
  Result: PostgreSQL sees `$1` referenced in every subquery but receives 3 bind values → `code:08P01 — le message bind fournit 3 paramètres, mais l'instruction préparée « » en requiert 1`.

Additionally, in `exportSuperAdminMetrics` the timeline SQL had a hard-coded `<> $5` for the `GLOBAL_RESTAURANT_ID` exclude. Relative ranges (24h/7d/30d) produce only 1 placeholder total (the global exclude), so `$2..$4` don't exist → Postgres sees max `$5` referenced but bind array length is 1 → identical `08P01` class error.

### Affected Locations (both fixed)

1. `getSuperAdminMetrics` → `intervalQuery` (the exact location in the bug report: L1452).
2. `exportSuperAdminMetrics` → `overviewQuery` (same `$1` reuse pattern).
3. `exportSuperAdminMetrics` → `timelineQuery` (hard-coded `$5` bug).

### Resolution Steps

A. **Sequential `paramOffset` chaining in `buildRangeWhere`** — already present in the helper, just unused by the combined queries. For every combined query, each inlined WHERE clause is built with `paramOffset = cumulative length of ALL previous params` so placeholder numbers are monotonic and unique across the entire SQL string:

   ```
   getSuperAdminMetrics intervalQuery layout:
     Subquery 1 (sessions_window):     buildRangeWhere(paramOffset: 0)
     Subquery 2 (qr_scans_window):     buildRangeWhere(paramOffset: sParams.length)
     Subquery 3 (question_views):      buildRangeWhere(paramOffset: sParams.length + qrParams.length)
   ```
   Result:
   - Relative ranges (24h/7d/30d): 3 placeholders ($1, $2, $3) → params.length = 3 ✅
   - Explicit bounds (MTD/custom): 9 placeholders ($1..$9) → params.length = 9 ✅

B. **Export overviewQuery shared-same-$ optimization.** 3 inlined `live_now` subqueries all compare `restaurant_id <> GLOBAL_RESTAURANT_ID` — they all reference the **same** `$1` (single value in bind array, referenced 3 times) instead of 3 separate slots. Saves 2 params, consistent numbering.

C. **Export timelineQuery dynamic globalIdx.** Replaced hard-coded `<> $5` with:
   ```js
   const tl_aeRange = buildRangeWhere(range, 'ae.timestamp', {
     paramOffset: range.useExplicitBounds ? 2 : 0
   });
   const tl_globalIdx = tl_aeRange.nextParamIdx + 1;  // relative→$1, explicit→$5
   ```
   Result:
   - Relative ranges: 1 placeholder ($1) → params.length = 1 ✅
   - Explicit bounds: 5 placeholders ($1..$5) → params.length = 5 ✅

D. **Static verification harness.** Wrote a transient node script that mirrors EXACTLY the runtime SQL/params construction for all 6 range variants across:
   - Section 1: getSuperAdminMetrics intervalQuery (36/36 assertions).
   - Section 2: export overviewQuery / contextQuery / timelineQuery (108/108 assertions).
   - 144/144 pass. Validates: `max($N) === params.length`, no placeholder gaps 1..N, no `$0`.
   - Deleted after run — not committed to source tree.

E. **Live smoke test — all 8 HTTP calls return 200.**
   ```
   overview 24h rel      → 200  bodyLen=771
   overview 7d rel       → 200  bodyLen=771
   overview 30d rel      → 200  bodyLen=771
   overview MTD exp      → 200  bodyLen=771
   export 24h json       → 200  bodyLen=1,804,988
   export 7d json        → 200  bodyLen=1,941,901
   export MTD json       → 200  bodyLen=2,052,873
   export 24h csv        → 200  bodyLen=2,773
   ```

### Preventive Rules

1. **Never re-use WHERE strings across combined queries.** A `whereSql` string built with `$1` for a **standalone** `db.query` must NEVER be copy-pasted into a combined parent query. Always rebuild the WHERE clause with sequential `paramOffset`.

2. **Placeholder count harness for ≥ 2 inlined WHERE.** For any combined query that inlines ≥ 2 `buildRangeWhere` calls into the same `db.query`, write and run a transient static harness that validates `max($N) === params.length` and no gaps 1..N for all range variants. This catches the 08P01 deterministically with zero DB dependency.

3. **No hard-coded `$N` literals in SQL.** Any `$N` reference must come from `$()` helper (controlled by `paramOffset`) or from a computed `.nextParamIdx + 1` value. Literal `$5` inside template SQL is always a bug waiting to happen when a new range variant only has 1 placeholder.

4. **Shared-same-$ when identical value.** Multiple subqueries filtering on the exact same constant (e.g. `restaurant_id <> GLOBAL_RESTAURANT_ID`) can ALL reference the same `$1` slot — pass the value once, not once per subquery. Reduces bind array size and simplifies placeholder accounting.

5. **Live smoke test for every 08P01-class fix.** After any SQL/params change in admin metrics, re-run: hit endpoint with valid SUPER_ADMIN Bearer for at least (24h relative + MTD explicit) and confirm HTTP 200. This catches regressions immediately before commit.
