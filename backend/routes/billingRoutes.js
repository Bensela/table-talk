const express = require('express');
const router = express.Router();
const db = require('../db');
const billingService = require('../services/billingService');

const {
  listPublicPlans,
  listAllPlans,
  getPlan,
  getRestaurantBilling,
  setRestaurantPlan,
  provisionTrialQrForTable,
  canRestaurantGenerateQr,
  createStripeCheckoutSession,
  createStripeBillingPortalSession,
  handleStripeWebhook,
  listRestaurantInvoices,
  listBillingOverviewForSuperAdmin
} = require('../services/billingService');

const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// --- Public plan catalog -----------------------------------------------------

router.get('/plans', async (req, res) => {
  res.json({
    plans: listPublicPlans(),
    billing_provider: (await billingService.hasBillingProvider()) ? 'stripe' : 'manual'
  });
});

// --- Stripe Webhook (raw body required) --------------------------------------
// Mounted separately in index.js with express.raw({type: '*/*'}) at this path.
// The handler here is a fallback; index.js can also invoke it directly.
router.post('/stripe/webhook', async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody ? req.rawBody : req.body;
    const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(JSON.stringify(rawBody));
    const result = await handleStripeWebhook({ signature, rawBody: buf });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[billing] Stripe webhook failed:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Webhook failed' });
  }
});

// --- Restaurant Admin Billing ------------------------------------------------

router.get('/tenant', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({ error: 'No restaurant attached to user' });
    }
    const billing = await getRestaurantBilling(restaurantId);
    if (!billing) return res.status(404).json({ error: 'Restaurant not found' });
    const invoices = await listRestaurantInvoices(restaurantId, 24);
    return res.json({
      billing,
      invoices,
      billing_provider: (await billingService.hasBillingProvider()) ? 'stripe' : 'manual'
    });
  } catch (err) {
    console.error('[billing /tenant] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/tenant/checkout', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'No restaurant attached to user' });
    const frontendUrl = await billingService.getFrontendUrl();
    const { plan, successUrl, cancelUrl } = req.body || {};
    const planObj = getPlan(plan);
    if (!planObj || !planObj.public) {
      return res.status(400).json({ error: 'Invalid plan for checkout' });
    }
    const safeSuccessUrl = successUrl && /^https?:\/\//.test(successUrl)
      ? successUrl
      : `${frontendUrl}/dashboard?billing=success`;
    const safeCancelUrl = cancelUrl && /^https?:\/\//.test(cancelUrl)
      ? cancelUrl
      : `${frontendUrl}/dashboard?billing=canceled`;
    const result = await createStripeCheckoutSession({
      restaurantId,
      planKey: planObj.key,
      successUrl: safeSuccessUrl,
      cancelUrl: safeCancelUrl
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[billing checkout] failed:', err);
    return res.status(400).json({ error: err.message || 'Checkout unavailable' });
  }
});

router.post('/tenant/portal', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'No restaurant attached to user' });
    const frontendUrl = await billingService.getFrontendUrl();
    const { returnUrl } = req.body || {};
    const safeReturn = returnUrl && /^https?:\/\//.test(returnUrl)
      ? returnUrl
      : `${frontendUrl}/dashboard?billing=portal`;
    const result = await createStripeBillingPortalSession({
      restaurantId,
      returnUrl: safeReturn
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[billing portal] failed:', err);
    return res.status(400).json({ error: err.message || 'Billing portal unavailable' });
  }
});

router.get('/tenant/invoices', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'No restaurant attached to user' });
    const limit = Math.min(100, Number(req.query.limit || 24));
    const invoices = await listRestaurantInvoices(restaurantId, limit);
    return res.json({ invoices });
  } catch (err) {
    console.error('[billing invoices] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Super Admin Billing -----------------------------------------------------

router.get('/overview', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { search, limit } = req.query;
    const overview = await listBillingOverviewForSuperAdmin({
      search: typeof search === 'string' ? search : '',
      limit: Number.isFinite(Number(limit)) ? Number(limit) : 500
    });
    const agg = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE plan = 'trial') AS trial_count,
         COUNT(*) FILTER (WHERE plan = 'starter') AS starter_count,
         COUNT(*) FILTER (WHERE plan = 'premium') AS premium_count,
         COUNT(*) FILTER (WHERE plan = 'enterprise') AS enterprise_count,
         COUNT(*) FILTER (WHERE billing_status = 'active' AND plan IN ('starter','premium','enterprise','pro','free')) AS active_paid,
         COUNT(*) FILTER (WHERE billing_status = 'suspended') AS suspended,
         COUNT(*) FILTER (WHERE billing_status = 'past_due') AS past_due,
         COUNT(*) AS total
       FROM restaurants
       WHERE slug <> 'default'`
    );
    return res.json({
      tenants: overview,
      summary: agg.rows[0] || {},
      plan_catalog: listAllPlans(),
      billing_provider: (await billingService.hasBillingProvider()) ? 'stripe' : 'manual'
    });
  } catch (err) {
    console.error('[billing overview] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/restaurant/:restaurantId', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const billing = await getRestaurantBilling(req.params.restaurantId);
    if (!billing) return res.status(404).json({ error: 'Restaurant not found' });
    const invoices = await listRestaurantInvoices(req.params.restaurantId, 24);
    return res.json({ billing, invoices });
  } catch (err) {
    console.error('[billing admin restaurant] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/restaurant/:restaurantId/plan', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { plan, trialDays, stripePriceId, setActive } = req.body || {};
    const result = await setRestaurantPlan(restaurantId, {
      planKey: plan,
      actorSuperAdminId: req.user.id || null,
      trialDays: Number.isInteger(trialDays) ? trialDays : undefined,
      stripePriceIdOverride: stripePriceId || undefined,
      setActive: typeof setActive === 'boolean' ? setActive : true
    });
    return res.status(200).json({ billing: result });
  } catch (err) {
    console.error('[billing admin set plan] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to update plan' });
  }
});

router.post('/admin/restaurant/:restaurantId/trial/table', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { table_number } = req.body || {};
    if (!table_number) return res.status(400).json({ error: 'table_number is required' });
    const qr = await provisionTrialQrForTable(restaurantId, String(table_number).trim(), {
      superAdminUserId: req.user.id || null
    });
    return res.status(201).json(qr);
  } catch (err) {
    console.error('[billing admin trial qr] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to provision trial QR' });
  }
});

router.post('/admin/restaurant/:restaurantId/trial/tables', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { start = 1, end = 10, pattern = 'Table {n}' } = req.body || {};
    const s = Math.max(1, Number.isInteger(Number(start)) ? Number(start) : 1);
    const e = Math.max(s, Math.min(1000, Number.isInteger(Number(end)) ? Number(end) : 10));
    const results = [];
    for (let i = s; i <= e; i += 1) {
      const tableNumber = String(pattern).replace(/\{n\}/g, String(i));
      const qr = await provisionTrialQrForTable(restaurantId, tableNumber, {
        superAdminUserId: req.user.id || null
      });
      results.push(qr);
    }
    return res.status(201).json({ tables: results });
  } catch (err) {
    console.error('[billing admin trial qrs] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to provision trial QRs' });
  }
});

// Utility: Super Admin can flip QR entitlement for trial restaurants manually.
router.patch('/admin/restaurant/:restaurantId/entitlements', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const allowed = new Set([
      'max_tables',
      'max_monthly_sessions',
      'can_generate_qr',
      'can_export_analytics',
      'can_use_custom_qr_branding',
      'can_use_dual_phone_sessions',
      'can_access_support',
      'support_tier',
      'billing_status'
    ]);
    const fields = [];
    const params = [restaurantId];
    let i = 2;
    for (const key of Object.keys(req.body || {})) {
      if (!allowed.has(key)) continue;
      fields.push(`${key} = $${i++}`);
      params.push(req.body[key]);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No supported entitlement fields provided' });
    fields.push('updated_at = NOW()');
    const q = `UPDATE restaurants SET ${fields.join(', ')} WHERE id = $1 RETURNING id`;
    await db.query(q, params);
    const billing = await getRestaurantBilling(restaurantId);
    return res.json({ billing });
  } catch (err) {
    console.error('[billing entitlements] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to update entitlements' });
  }
});

// Permission helper exposed for downstream middleware.
router.canGenerateQr = canRestaurantGenerateQr;

module.exports = router;
