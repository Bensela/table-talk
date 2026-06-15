# Table-Talk — Production Phase: Multi-Restaurant Implementation
# Agent Prompt v1.0
# Feed this entire file to your AI coding agent (Cursor, Trae, Copilot Workspace, etc.)

---

## Role

You are the senior engineer on Table-Talk MVP. The app is **fully working**. Your job is
to add multi-restaurant support without touching any existing logic. Every existing
session, QR code, socket event, and test must continue to work unchanged.

---

## Constraints (non-negotiable — from project rules)

- NO PII stored at any point (no emails, names, IPs, raw codes)
- All DB columns: `snake_case`
- All JS variables: `camelCase`
- Parameterised queries ONLY — never string-interpolated SQL
- Touch targets: 48px min on mobile
- Privacy first: anonymous sessions, UUID identifiers only
- DO NOT modify: `deckService.js`, socket event names, session_participants schema,
  cleanup.js rules, any existing migration (001–007)

---

## What you are implementing

### New files to CREATE (copy from /implementation/)

1. `backend/database/migrations/008_multi_restaurant.sql`
2. `backend/middleware/resolveRestaurant.js`
3. `backend/routes/restaurantRoutes.js`
4. `backend/scripts/seed_restaurant.js`

### Existing files to EDIT (surgical changes only)

| File | Change | Lines |
|---|---|---|
| `backend/index.js` | Add 2 requires + 2 route registrations | +5 |
| `backend/routes/sessionRoutes.js` | Add require + resolveRestaurant to POST / | +2 |
| `backend/controllers/sessionController.js` | Read restaurant_id from req.restaurant?.slug | +2 |
| `frontend/src/App.jsx` | Add 3 multi-restaurant routes before existing ones | +6 |
| `frontend/src/pages/WelcomeScreen.jsx` | Read restaurantSlug from useParams, pass to resolveSession | +2 |
| `frontend/src/pages/ContextSelection.jsx` | Read restaurantSlug from useParams, pass to createSession | +2 |
| `frontend/src/api/index.js` | Add restaurant_slug param to createSession + resolveSession | +2 |

**Total: 4 new files, 7 files with minor edits.**

---

## Step-by-step implementation

### Step 1 — Run the migration

```bash
cd backend
psql $DATABASE_URL -f database/migrations/008_multi_restaurant.sql
```

Verify:
```sql
SELECT slug, name, active FROM restaurants;
-- Should return: default | Default Restaurant | true
```

### Step 2 — Create resolveRestaurant middleware

Create `backend/middleware/resolveRestaurant.js`:

```js
const db = require('../db');

const resolveRestaurant = async (req, res, next) => {
  const slug =
    req.params.restaurantSlug ||
    req.body?.restaurant_slug ||
    'default';

  try {
    const result = await db.query(
      `SELECT id, slug, name, plan, active FROM restaurants WHERE slug = $1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Restaurant '${slug}' not found` });
    }

    const restaurant = result.rows[0];
    if (!restaurant.active) {
      return res.status(403).json({ error: 'Restaurant account is inactive' });
    }

    req.restaurant = restaurant;
    next();
  } catch (err) {
    console.error('[resolveRestaurant] DB error:', err);
    next(err);
  }
};

module.exports = { resolveRestaurant };
```

### Step 3 — Create restaurantRoutes.js

Create `backend/routes/restaurantRoutes.js` — see full file in `/implementation/backend/routes/restaurantRoutes.js`.

Key endpoints:
- `GET  /restaurants/:slug/info` — public, used by QR landing
- `GET  /restaurants/:slug` — admin (X-Restaurant-Key header)
- `POST /restaurants` — super-admin (X-Super-Admin-Key header)
- `GET  /restaurants/:slug/sessions` — admin
- `POST /restaurants/:slug/qr` — admin, generates QR data-URLs
- `GET  /restaurants/:slug/analytics` — admin
- `PATCH /restaurants/:slug/deactivate` — admin

### Step 4 — Edit backend/index.js

Add these lines — DO NOT change anything else in this file:

```js
// ADD near top with other requires:
const { resolveRestaurant } = require('./middleware/resolveRestaurant');
const restaurantRoutes = require('./routes/restaurantRoutes');

// ADD after the existing app.use('/sessions', ...) block:
app.use('/restaurants', restaurantRoutes);
if (API_PREFIX) {
  app.use(`${API_PREFIX}/restaurants`, restaurantRoutes);
}
```

### Step 5 — Edit backend/routes/sessionRoutes.js

```js
// ADD at top:
const { resolveRestaurant } = require('../middleware/resolveRestaurant');

// CHANGE POST / (line 1 of routes):
// FROM: router.post('/', sessionController.createSession);
// TO:
router.post('/', resolveRestaurant, sessionController.createSession);
```

### Step 6 — Edit backend/controllers/sessionController.js

In `createSession()`, find the line with `restaurant_id || 'default'` in the INSERT VALUES:

```js
// FROM:
restaurant_id || 'default',
// TO:
req.restaurant?.slug || restaurant_id || 'default',
```

In `resolveSession()`, find `const restaurantId = restaurant_id || 'default'`:

```js
// FROM:
const restaurantId = restaurant_id || 'default';
// TO:
const restaurantId = req.restaurant?.slug || restaurant_id || 'default';
```

### Step 7 — Edit frontend/src/App.jsx

Add multi-restaurant routes BEFORE the existing `/t/:tableToken` routes:

```jsx
{/* Multi-restaurant routes */}
<Route path="/t/:restaurantSlug/:tableToken" element={<WelcomeScreen />} />
<Route path="/t/:restaurantSlug/:tableToken/context" element={<ContextSelection />} />
<Route path="/t/:restaurantSlug/:tableToken/mode" element={<ModeSelection />} />

{/* Keep existing routes for legacy QR codes */}
<Route path="/t/:tableToken" element={<WelcomeScreen />} />
<Route path="/t/:tableToken/context" element={<ContextSelection />} />
<Route path="/t/:tableToken/mode" element={<ModeSelection />} />
```

### Step 8 — Edit frontend/src/pages/WelcomeScreen.jsx

```js
// CHANGE:
const { tableToken } = useParams();
// TO:
const { tableToken, restaurantSlug } = useParams();

// CHANGE resolveSession call:
const resolveRes = await resolveSession({ 
    restaurant_slug: restaurantSlug || 'default',  // ADD THIS LINE
    table_token: tableToken, 
    device_token: deviceToken 
});
```

### Step 9 — Edit frontend/src/pages/ContextSelection.jsx

```js
// CHANGE:
const { tableToken } = useParams();
// TO:
const { tableToken, restaurantSlug } = useParams();

// In the createSession call, add:
restaurant_slug: restaurantSlug || 'default',
```

### Step 10 — Edit frontend/src/api/index.js

```js
// CHANGE createSession:
export const createSession = ({ restaurant_slug, table_token, context, mode }) => 
  api.post('/sessions', { restaurant_slug, table_token, context, mode });

// CHANGE resolveSession:
export const resolveSession = ({ restaurant_slug, table_token, device_token }) =>
  api.post('/sessions/resolve', { restaurant_slug, table_token, device_token });
```

### Step 11 — Create seed script and onboard first restaurant

```bash
node backend/scripts/seed_restaurant.js \
  --name="Client Restaurant Name" \
  --slug="client-restaurant" \
  --tables=15
```

This prints the `secret_key` (save it!) and all QR URLs.

---

## Environment variables to add

In DigitalOcean App Platform → Settings → Environment Variables:

```
SUPER_ADMIN_KEY=<strong random string, 40+ chars>
```

For local `.env`:
```
SUPER_ADMIN_KEY=dev_super_admin_key_replace_in_production
```

---

## Verification checklist

After implementation, verify each of these manually:

### Database
- [ ] `SELECT * FROM restaurants;` returns at least the 'default' row
- [ ] `SELECT restaurant_id, count(*) FROM sessions GROUP BY 1;` shows 'default'
- [ ] FK constraint `fk_sessions_restaurant` exists on sessions table

### Legacy QR codes (must still work)
- [ ] Visit `/t/table-001` → WelcomeScreen loads with "Connected to Table 001"
- [ ] Complete full flow: context → mode → game
- [ ] Session created with `restaurant_id = 'default'`
- [ ] Socket.io dual-phone sync unchanged

### New multi-restaurant QR codes
- [ ] Visit `/t/client-restaurant/table-001` → WelcomeScreen loads
- [ ] Complete full flow — session created with `restaurant_id = 'client-restaurant'`
- [ ] Dual-phone mode works identically on new slug URL
- [ ] `/restaurants/client-restaurant/info` returns `{ slug, name, active }`

### Admin API
- [ ] `GET /restaurants/client-restaurant` with correct key → 200
- [ ] `GET /restaurants/client-restaurant` with wrong key → 403
- [ ] `GET /restaurants/client-restaurant/sessions` → returns session list
- [ ] `POST /restaurants/client-restaurant/qr` → returns QR data-URLs
- [ ] `GET /restaurants/client-restaurant/analytics` → returns stats

### Unknown slug
- [ ] Visit `/t/unknown-slug/table-001` → creates session with 404 (slug validation works)

### Inactive restaurant
- [ ] `PATCH /restaurants/client-restaurant/deactivate` with key → 200
- [ ] Visit `/t/client-restaurant/table-001` → 403 "Restaurant account is inactive"

---

## What NOT to touch

The following files must be left completely unchanged:

- `backend/services/deckService.js`
- `backend/jobs/cleanup.js`
- `backend/middleware/rateLimiter.js`
- `backend/database/migrations/001_*.sql` through `007_*.sql`
- `backend/database/init.sql`
- `frontend/src/pages/SessionGame.jsx`
- `frontend/src/pages/ModeSelection.jsx`
- `frontend/src/components/*`
- `frontend/src/context/SocketContext.jsx`
- All test files

---

## Deployment to DigitalOcean App Platform

1. Commit all changes to `main` branch
2. In DO App Platform → Run Console → run migration:
   ```bash
   psql $DATABASE_URL -f backend/database/migrations/008_multi_restaurant.sql
   ```
3. Redeploy the app (or auto-deploy triggers on push)
4. Run seed script from Run Console:
   ```bash
   node backend/scripts/seed_restaurant.js \
     --name="Client Name" --slug="client-slug" --tables=15
   ```
5. Generate QR PDFs via admin API and hand off to client

---

## How this integrates with the project rules file

Update `.trae/rules/tabletalkrules.md` — add to the Database Schema section:

```
restaurants: id (UUID PK), slug (unique), name, plan, secret_key (64-char hex), active, created_at
```

No other rule changes needed. All existing rules (PII, cleanup timers, session isolation,
dual-phone behaviour, question determinism) are unaffected.
