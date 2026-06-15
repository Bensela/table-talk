# ================================================================
# Table-Talk — Multi-Restaurant: Exact Edits to Existing Files
# Apply each block in the file shown. Search for the BEFORE line
# and replace with the AFTER block.
# ================================================================


# ────────────────────────────────────────────────────────────────
# FILE: backend/index.js
# ────────────────────────────────────────────────────────────────

# ADD after the existing requires at the top (after line with sessionRoutes):

const { resolveRestaurant } = require('./middleware/resolveRestaurant');
const restaurantRoutes = require('./routes/restaurantRoutes');


# ADD after the existing route registrations (after the two `app.use('/sessions', …)` lines):

app.use('/restaurants', restaurantRoutes);
if (API_PREFIX) {
  app.use(`${API_PREFIX}/restaurants`, restaurantRoutes);
}


# ────────────────────────────────────────────────────────────────
# FILE: backend/routes/sessionRoutes.js
# ────────────────────────────────────────────────────────────────

# ADD at the top (after existing requires):

const { resolveRestaurant } = require('../middleware/resolveRestaurant');


# CHANGE (line with router.post('/', sessionController.createSession)):

BEFORE:
router.post('/', sessionController.createSession);

AFTER:
router.post('/', resolveRestaurant, sessionController.createSession);


# ────────────────────────────────────────────────────────────────
# FILE: backend/controllers/sessionController.js
# ────────────────────────────────────────────────────────────────

# In createSession(), find the INSERT statement arguments.
# CHANGE the restaurant_id argument (appears twice — in the INSERT and the VALUES):

BEFORE (in the INSERT VALUES array):
        restaurant_id || 'default', 

AFTER:
        req.restaurant?.slug || restaurant_id || 'default',


# In resolveSession(), find:

BEFORE:
    const restaurantId = restaurant_id || 'default';

AFTER:
    const restaurantId = req.restaurant?.slug || restaurant_id || 'default';


# ────────────────────────────────────────────────────────────────
# FILE: frontend/src/App.jsx
# ────────────────────────────────────────────────────────────────

# ADD three new routes BEFORE the existing /t/:tableToken routes.
# The existing routes stay — they handle legacy QR codes.

BEFORE:
          {/* Entry point from QR code */}
          <Route path="/t/:tableToken" element={<WelcomeScreen />} />
          
          {/* Flow steps */}
          <Route path="/t/:tableToken/context" element={<ContextSelection />} />
          <Route path="/t/:tableToken/mode" element={<ModeSelection />} />

AFTER:
          {/* Multi-restaurant routes (new QR codes: /t/:slug/:table) */}
          <Route path="/t/:restaurantSlug/:tableToken" element={<WelcomeScreen />} />
          <Route path="/t/:restaurantSlug/:tableToken/context" element={<ContextSelection />} />
          <Route path="/t/:restaurantSlug/:tableToken/mode" element={<ModeSelection />} />

          {/* Legacy single-restaurant routes (existing QR codes: /t/:table) */}
          <Route path="/t/:tableToken" element={<WelcomeScreen />} />
          <Route path="/t/:tableToken/context" element={<ContextSelection />} />
          <Route path="/t/:tableToken/mode" element={<ModeSelection />} />


# ────────────────────────────────────────────────────────────────
# FILE: frontend/src/pages/WelcomeScreen.jsx
# ────────────────────────────────────────────────────────────────

# CHANGE the useParams() destructure:

BEFORE:
  const { tableToken } = useParams();

AFTER:
  const { tableToken, restaurantSlug } = useParams();


# CHANGE the resolveSession call (inside handleContinue):

BEFORE:
      const resolveRes = await resolveSession({ 
          table_token: tableToken, 
          device_token: deviceToken 
      });

AFTER:
      const resolveRes = await resolveSession({ 
          restaurant_slug: restaurantSlug || 'default',
          table_token: tableToken, 
          device_token: deviceToken 
      });


# ────────────────────────────────────────────────────────────────
# FILE: frontend/src/pages/ContextSelection.jsx
# ────────────────────────────────────────────────────────────────

# CHANGE the useParams() destructure (find it near the top):

BEFORE:
  const { tableToken } = useParams();

AFTER:
  const { tableToken, restaurantSlug } = useParams();


# CHANGE the createSession call (find it in the submit handler):

BEFORE:
    await createSession({
      table_token: tableToken,
      context,
      mode

AFTER:
    await createSession({
      restaurant_slug: restaurantSlug || 'default',
      table_token: tableToken,
      context,
      mode


# ────────────────────────────────────────────────────────────────
# FILE: frontend/src/api/index.js
# ────────────────────────────────────────────────────────────────

# CHANGE createSession:

BEFORE:
export const createSession = ({ table_token, context, mode }) => 
  api.post('/sessions', { table_token, context, mode });

AFTER:
export const createSession = ({ restaurant_slug, table_token, context, mode }) => 
  api.post('/sessions', { restaurant_slug, table_token, context, mode });


# CHANGE resolveSession:

BEFORE:
export const resolveSession = ({ restaurant_id, table_token, device_token }) =>
  api.post('/sessions/resolve', { restaurant_id, table_token, device_token });

AFTER:
export const resolveSession = ({ restaurant_slug, table_token, device_token }) =>
  api.post('/sessions/resolve', { restaurant_slug, table_token, device_token });


# ────────────────────────────────────────────────────────────────
# FILE: backend/scripts/generate_qr.js  (optional upgrade)
# ────────────────────────────────────────────────────────────────

# CHANGE the BASE_URL and add a RESTAURANT_SLUG constant:

BEFORE:
const BASE_URL = 'https://tabletalk.app/t';

AFTER:
const RESTAURANT_SLUG = process.env.RESTAURANT_SLUG || 'default';
const BASE_URL = `https://tabletalk.app/t/${RESTAURANT_SLUG}`;


# ────────────────────────────────────────────────────────────────
# FILE: .trae/rules/tabletalkrules.md  — DATABASE SCHEMA UPDATE
# ────────────────────────────────────────────────────────────────
# Add to the Database Schema section:

restaurants: id (UUID PK), slug (unique), name, plan, secret_key, active, created_at
