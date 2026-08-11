const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const billingService = require('../services/billingService');
const platformSettings = require('../services/platformSettingsService');
const { authenticateToken, requireRole, verifyTenantAccess } = require('../middleware/authMiddleware');

// Public Login Endpoint
router.post('/login', adminController.login);
router.post('/forgot-password', adminController.requestPasswordReset);
router.post('/reset-password', adminController.resetPassword);
router.post('/geocode-address', authenticateToken, requireRole(['SUPER_ADMIN', 'RESTAURANT_ADMIN']), adminController.geocodeRestaurantAddress);

// Super Admin Route group
router.get('/tenants', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.getTenants);
router.post('/tenants/invites', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.createTenantInvite);
router.post('/tenants', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.createTenant);
router.patch('/tenants/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.updateTenant);
router.delete('/tenants/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.deleteTenantPermanent);
router.get('/metrics/overview', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.getSuperAdminMetrics);
router.get('/questions', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.getGlobalQuestions);
router.post('/questions/import', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.importGlobalQuestions);
router.patch('/questions/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.updateGlobalQuestion);
router.delete('/questions/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.deleteGlobalQuestion);
router.post('/questions/bulk-delete', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.bulkDeleteGlobalQuestions);
router.patch('/questions/reshuffle', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.reshuffleGlobalQuestions);

// Billing: plan catalog
router.get('/plans', async (_req, res) => {
  const provider = (await billingService.hasBillingProvider()) ? 'stripe' : 'manual';
  res.json({
    plans: billingService.listPublicPlans(),
    billing_provider: provider
  });
});

// Payment Gateway Setup: Super Admin only
router.get('/platform/payment-gateway', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const settings = await platformSettings.getPaymentGatewaySecretOnlyForSuperAdmin();
    const liveCheck = { ok: false, message: '' };
    try {
      const stripeClient = await billingService.getStripeClient();
      if (stripeClient) {
        const balance = await stripeClient.balance.retrieve();
        liveCheck.ok = true;
        liveCheck.message = balance?.object === 'balance' ? 'Connected to Stripe successfully.' : 'Connected.';
      } else {
        liveCheck.ok = false;
        liveCheck.message = 'Stripe secret key is not configured.';
      }
    } catch (err) {
      liveCheck.ok = false;
      liveCheck.message = err?.message || 'Unable to connect to Stripe.';
    }
    return res.json({ settings, connectivity: liveCheck });
  } catch (err) {
    console.error('[payment gateway GET] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/platform/payment-gateway', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const body = req.body || {};
    const allowed = [
      'provider',
      'mode',
      'stripe_publishable_key',
      'stripe_secret_key',
      'stripe_webhook_secret',
      'frontend_url'
    ];
    const input = {};
    for (const k of allowed) input[k] = body[k];
    if (input.provider && !['stripe', 'manual'].includes(String(input.provider))) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }
    if (input.mode && !['test', 'live'].includes(String(input.mode))) {
      return res.status(400).json({ error: 'Mode must be test or live' });
    }
    const settings = await platformSettings.setPaymentGatewaySettings(input, req.user?.id || null);
    billingService.invalidateCaches && billingService.invalidateCaches();
    try {
      const stripeClient = await billingService.getStripeClient();
      if (stripeClient) {
        await stripeClient.balance.retrieve();
      }
    } catch (_err) {
      // ignore; reported on GET connectivity
    }
    return res.json({ settings });
  } catch (err) {
    console.error('[payment gateway PUT] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to save payment gateway settings' });
  }
});

router.post('/platform/payment-gateway/verify', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const stripeClient = await billingService.getStripeClient();
    if (!stripeClient) {
      return res.json({ ok: false, message: 'Stripe secret key is not configured. Settings saved; no connectivity yet.' });
    }
    const balance = await stripeClient.balance.retrieve();
    return res.json({
      ok: true,
      message: 'Stripe connection verified.',
      balance_object: balance?.object,
      livemode: Boolean(balance?.livemode)
    });
  } catch (err) {
    return res.json({ ok: false, message: err?.message || 'Verification failed' });
  }
});

// Reveal a single stored key/secret plaintext (SA only) — explicit one-by-one opt-in, audit logged.
const REVEAL_RATE_WINDOW_MS = 60 * 1000;
const REVEAL_RATE_MAX = 5;
const _revealRate = new Map(); // userId -> [{ts: number}]
router.post('/platform/payment-gateway/reveal-field', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const userId = String(req.user?.id || 'anon');
    const now = Date.now();
    const window = _revealRate.get(userId) || [];
    const trimmed = window.filter((ts) => now - ts < REVEAL_RATE_WINDOW_MS);
    if (trimmed.length >= REVEAL_RATE_MAX) {
      return res.status(429).json({ error: 'Too many reveal requests. Please wait 60 seconds.' });
    }
    trimmed.push(now);
    _revealRate.set(userId, trimmed);

    const field = String(req.body?.field || '').trim();
    const revealed = await platformSettings.revealPaymentGatewayField(field, req.user?.id || null);
    return res.json({ field: revealed.field, value: revealed.value });
  } catch (err) {
    console.error('[payment gateway reveal] failed:', err);
    return res.status(400).json({ error: err.message || 'Reveal failed' });
  }
});

// Billing: Super Admin tenant overview
router.get('/billing/tenants', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const db = require('../db');
    const { search, limit } = req.query;
    const tenants = await billingService.listBillingOverviewForSuperAdmin({
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
      tenants,
      summary: agg.rows[0] || {},
      plan_catalog: billingService.listAllPlans(),
      billing_provider: (await billingService.hasBillingProvider()) ? 'stripe' : 'manual'
    });
  } catch (err) {
    console.error('[admin billing tenants] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Billing: Super Admin get one tenant billing detail
router.get('/billing/tenants/:restaurantId', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const db = require('../db');
    const billing = await billingService.getRestaurantBilling(req.params.restaurantId);
    if (!billing) return res.status(404).json({ error: 'Restaurant not found' });
    const invoices = await billingService.listRestaurantInvoices(req.params.restaurantId, 24);
    const tablesRes = await db.query(
      `SELECT id, table_number, qr_code_url, provisioned_by_super_admin_id, created_at
       FROM restaurant_tables
       WHERE restaurant_id = $1
       ORDER BY
         CASE WHEN table_number ~ '^[0-9]+$' THEN LPAD(table_number, 10, '0') ELSE table_number END
         ASC NULLS LAST, id ASC`,
      [req.params.restaurantId]
    );
    return res.json({ billing, invoices, tables: tablesRes.rows });
  } catch (err) {
    console.error('[admin billing tenant detail] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Billing: Super Admin assign/change plan
router.post('/billing/tenants/:restaurantId/plan', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { plan, trialDays, stripePriceId, setActive } = req.body || {};
    const billing = await billingService.setRestaurantPlan(req.params.restaurantId, {
      planKey: plan,
      actorSuperAdminId: req.user.id || null,
      trialDays: Number.isInteger(trialDays) ? trialDays : undefined,
      stripePriceIdOverride: stripePriceId || undefined,
      setActive: typeof setActive === 'boolean' ? setActive : true
    });
    return res.status(200).json({ billing });
  } catch (err) {
    console.error('[admin billing plan assign] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to update plan' });
  }
});

// Billing: Super Admin override entitlements
router.patch('/billing/tenants/:restaurantId/entitlements', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const db = require('../db');
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
    const billing = await billingService.getRestaurantBilling(restaurantId);
    return res.json({ billing });
  } catch (err) {
    console.error('[admin billing entitlements] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to update entitlements' });
  }
});

// Billing: Super Admin provision trial QR for a single table
router.post('/billing/tenants/:restaurantId/trial/table', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { table_number } = req.body || {};
    if (!table_number) return res.status(400).json({ error: 'table_number is required' });
    const qr = await billingService.provisionTrialQrForTable(req.params.restaurantId, String(table_number).trim(), {
      superAdminUserId: req.user.id || null
    });
    return res.status(201).json(qr);
  } catch (err) {
    console.error('[admin billing trial table] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to provision trial QR' });
  }
});

// Billing: Super Admin provision trial QRs in a numbered range
router.post('/billing/tenants/:restaurantId/trial/tables', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { start = 1, end = 10, pattern = 'Table {n}' } = req.body || {};
    const s = Math.max(1, Number.isInteger(Number(start)) ? Number(start) : 1);
    const e = Math.max(s, Math.min(1000, Number.isInteger(Number(end)) ? Number(end) : 10));
    const tables = [];
    for (let i = s; i <= e; i += 1) {
      const tableNumber = String(pattern).replace(/\{n\}/g, String(i));
      const qr = await billingService.provisionTrialQrForTable(req.params.restaurantId, tableNumber, {
        superAdminUserId: req.user.id || null
      });
      tables.push(qr);
    }
    return res.status(201).json({ tables });
  } catch (err) {
    console.error('[admin billing trial tables] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to provision trial QRs' });
  }
});

// Billing: Super Admin delete a single registered table + its QR
router.delete('/billing/tenants/:restaurantId/tables/:tableId', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const db = require('../db');
    const { restaurantId, tableId } = req.params;
    const del = await db.query(
      'DELETE FROM restaurant_tables WHERE id = $1 AND restaurant_id = $2 RETURNING id, table_number',
      [tableId, restaurantId]
    );
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Table not found for this tenant' });
    }
    try {
      await db.query(
        `INSERT INTO analytics_events (event_type, event_data)
         VALUES ('super_admin.table_deleted', $1::jsonb)`,
        [{ super_admin_user_id: req.user.id, restaurant_id: restaurantId, table_id: tableId, table_number: del.rows[0]?.table_number }]
      );
    } catch (_e) { /* non-fatal: analytics insert shouldn't block the response */ }
    return res.json({ deleted: del.rows[0] });
  } catch (err) {
    console.error('[admin billing delete table] failed:', err);
    return res.status(500).json({ error: 'Failed to delete table' });
  }
});

// Billing: Super Admin generate QR PNG data URLs for any registered table(s) on a tenant
// (works for trial + any plan; does NOT create/register tables, only produces printable QR payloads)
router.post('/billing/tenants/:restaurantId/qr', authenticateToken, requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { table_ids, table_numbers } = req.body || {};
    const qrs = await billingService.generateTenantQrDataUrls(req.params.restaurantId, {
      tableIds: Array.isArray(table_ids) ? table_ids : null,
      tableNumbers: Array.isArray(table_numbers) ? table_numbers : null
    });
    return res.json(qrs);
  } catch (err) {
    console.error('[admin billing tenant qr] failed:', err);
    return res.status(400).json({ error: err.message || 'Unable to generate QR codes' });
  }
});

// Restaurant Admin Route group
router.get('/billing', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'User is not associated with any restaurant' });
    const billing = await billingService.getRestaurantBilling(restaurantId);
    if (!billing) return res.status(404).json({ error: 'Restaurant not found' });
    const invoices = await billingService.listRestaurantInvoices(restaurantId, 24);
    const paymentGateway = await platformSettings.getPaymentGatewayPublic();
    return res.json({
      billing,
      invoices,
      payment_gateway: {
        provider: paymentGateway.provider,
        mode: paymentGateway.mode,
        publishable_key_masked: paymentGateway.stripe_publishable_key_masked,
        has_publishable_key: paymentGateway.has_stripe_publishable_key,
        frontend_url: paymentGateway.frontend_url,
        has_webhook_secret: paymentGateway.has_stripe_webhook_secret,
        has_secret_key: paymentGateway.has_stripe_secret_key
      },
      billing_provider: (await billingService.hasBillingProvider()) ? 'stripe' : 'manual'
    });
  } catch (err) {
    console.error('[admin billing tenant] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/billing/payment-gateway', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'User is not associated with any restaurant' });
    const gateway = await platformSettings.getPaymentGatewayPublic();
    const billing = await billingService.getRestaurantBilling(restaurantId);
    return res.json({
      provider: gateway.provider,
      mode: gateway.mode,
      publishable_key_masked: gateway.stripe_publishable_key_masked,
      has_publishable_key: gateway.has_stripe_publishable_key,
      frontend_url: gateway.frontend_url,
      has_secret_key: gateway.has_stripe_secret_key,
      has_webhook_secret: gateway.has_stripe_webhook_secret,
      restaurant_stripe_customer_id: billing?.stripe_customer_id ? `${String(billing.stripe_customer_id).slice(0, 6)}…${String(billing.stripe_customer_id).slice(-4)}` : null,
      restaurant_stripe_subscription_id: billing?.stripe_subscription_id ? `${String(billing.stripe_subscription_id).slice(0, 6)}…${String(billing.stripe_subscription_id).slice(-4)}` : null,
      sources: gateway.sources || {}
    });
  } catch (err) {
    console.error('[tenant payment gateway] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/billing/checkout', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'User is not associated with any restaurant' });
    const frontendUrl = await billingService.getFrontendUrl();
    const { plan, successUrl, cancelUrl } = req.body || {};
    const planObj = billingService.getPlan(plan);
    if (!planObj || !planObj.public) {
      return res.status(400).json({ error: 'Invalid plan for checkout' });
    }
    const safeSuccessUrl = successUrl && /^https?:\/\//.test(successUrl)
      ? successUrl
      : `${frontendUrl}/dashboard?billing=success`;
    const safeCancelUrl = cancelUrl && /^https?:\/\//.test(cancelUrl)
      ? cancelUrl
      : `${frontendUrl}/dashboard?billing=canceled`;
    const result = await billingService.createStripeCheckoutSession({
      restaurantId,
      planKey: planObj.key,
      successUrl: safeSuccessUrl,
      cancelUrl: safeCancelUrl
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[admin billing checkout] failed:', err);
    return res.status(400).json({ error: err.message || 'Checkout unavailable' });
  }
});

router.post('/billing/portal', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'User is not associated with any restaurant' });
    const frontendUrl = await billingService.getFrontendUrl();
    const { returnUrl } = req.body || {};
    const safeReturn = returnUrl && /^https?:\/\//.test(returnUrl)
      ? returnUrl
      : `${frontendUrl}/dashboard?billing=portal`;
    const result = await billingService.createStripeBillingPortalSession({
      restaurantId,
      returnUrl: safeReturn
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[admin billing portal] failed:', err);
    return res.status(400).json({ error: err.message || 'Billing portal unavailable' });
  }
});

router.get('/billing/invoices', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'User is not associated with any restaurant' });
    const limit = Math.min(100, Number(req.query.limit || 24));
    const invoices = await billingService.listRestaurantInvoices(restaurantId, limit);
    return res.json({ invoices });
  } catch (err) {
    console.error('[admin billing invoices] failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/profile', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.updateTenantProfile);
router.get('/profile', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), adminController.getTenantBilling);
router.get('/tables', authenticateToken, requireRole(['RESTAURANT_ADMIN', 'SUPER_ADMIN']), adminController.getTenantTables);
router.post('/tables', authenticateToken, requireRole(['RESTAURANT_ADMIN']), async (req, res, next) => {
  // Prevent trial tenants from provisioning tables without Super Admin when entitlement is off.
  const billing = await billingService.getRestaurantBilling(req.user.restaurant_id);
  if (billing && billing.plan === 'trial' && !billing.can_generate_qr) {
    return res.status(403).json({
      error: 'Trial tables/QRs are provisioned by Super Admin. Contact support or upgrade your plan.'
    });
  }
  return adminController.createTenantTable(req, res, next);
});

router.post('/qr', authenticateToken, requireRole(['RESTAURANT_ADMIN']), async (req, res, next) => {
  // Trial Restaurant Admin cannot generate QR; Super Admin provisions them explicitly.
  const billing = await billingService.getRestaurantBilling(req.user.restaurant_id);
  if (billing && !billingService.canRestaurantGenerateQr(billing)) {
    return res.status(403).json({
      error: 'QR codes are generated by Super Admin during trial. Upgrade to Starter or higher for self-service QR generation.'
    });
  }
  return adminController.generateTenantQr(req, res, next);
});

router.patch('/tables/:id/qr', authenticateToken, requireRole(['RESTAURANT_ADMIN']), async (req, res, next) => {
  const billing = await billingService.getRestaurantBilling(req.user.restaurant_id);
  if (billing && !billingService.canRestaurantGenerateQr(billing)) {
    return res.status(403).json({
      error: 'Regenerating QR codes during trial is handled by Super Admin.'
    });
  }
  return adminController.regenerateTableQr(req, res, next);
});

module.exports = router;
