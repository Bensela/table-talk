const db = require('../db');
const platformSettings = require('./platformSettingsService');

const ENV_FRONTEND_URL = (process.env.FRONTEND_URL || 'https://tabletalk.app').replace(/\/+$/, '');
const ENV_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const ENV_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// DB-backed values are preferred when set; otherwise we fall back to process.env
// so existing deployments continue to work without any migration applied.
let stripe = null;
let stripeKeySnapshot = '';
let stripeClientAt = 0;
const STRIPE_CLIENT_TTL_MS = 10000;

async function resolveStripeKeys() {
  try {
    const pub = await platformSettings.getPaymentGatewayPublic();
    return {
      provider: pub.provider || (ENV_STRIPE_SECRET_KEY ? 'stripe' : 'manual'),
      mode: pub.mode || 'live',
      publishableKey: pub.stripe_publishable_key || process.env.STRIPE_PUBLISHABLE_KEY || '',
      secretKey: pub.has_stripe_secret_key ? (await resolveSecretKeyFromDbFallback()) : ENV_STRIPE_SECRET_KEY,
      webhookSecret: pub.has_stripe_webhook_secret ? (await resolveWebhookSecretFromDbFallback()) : ENV_STRIPE_WEBHOOK_SECRET,
      frontendUrl: pub.frontend_url || ENV_FRONTEND_URL
    };
  } catch (_) {
    return {
      provider: ENV_STRIPE_SECRET_KEY ? 'stripe' : 'manual',
      mode: /^sk_test_/.test(ENV_STRIPE_SECRET_KEY) ? 'test' : 'live',
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      secretKey: ENV_STRIPE_SECRET_KEY,
      webhookSecret: ENV_STRIPE_WEBHOOK_SECRET,
      frontendUrl: ENV_FRONTEND_URL
    };
  }
}

let _lastSecret = '';
let _lastWebhook = '';
let _cachedSecrets = null;
let _cachedSecretsAt = 0;

async function resolveSecretsFromDb() {
  const rows = await readRawPlatformRows();
  const secretRow = rows['payment_gateway.stripe_secret_key'];
  const webhookRow = rows['payment_gateway.stripe_webhook_secret'];
  const secret = secretRow && secretRow.setting_value && secretRow.is_secret
    ? platformSettings.decryptSecret(secretRow.setting_value)
    : (secretRow && secretRow.setting_value ? secretRow.setting_value : ENV_STRIPE_SECRET_KEY);
  const webhook = webhookRow && webhookRow.setting_value && webhookRow.is_secret
    ? platformSettings.decryptSecret(webhookRow.setting_value)
    : (webhookRow && webhookRow.setting_value ? webhookRow.setting_value : ENV_STRIPE_WEBHOOK_SECRET);
  return { secret: secret || ENV_STRIPE_SECRET_KEY, webhook: webhook || ENV_STRIPE_WEBHOOK_SECRET };
}

async function readRawPlatformRows() {
  try {
    const existsRes = await db.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_settings') AS t`);
    if (!existsRes.rows[0]?.t) return {};
    const res = await db.query(`SELECT setting_key, setting_value, is_secret FROM platform_settings`);
    return (res.rows || []).reduce((acc, r) => { acc[r.setting_key] = r; return acc; }, {});
  } catch (_) {
    return {};
  }
}

async function resolveSecretKeyFromDbFallback() {
  const now = Date.now();
  if (_cachedSecrets && (now - _cachedSecretsAt) < STRIPE_CLIENT_TTL_MS) {
    _lastSecret = _cachedSecrets.secret;
    _lastWebhook = _cachedSecrets.webhook;
    return _cachedSecrets.secret;
  }
  const both = await resolveSecretsFromDb();
  _cachedSecrets = both;
  _cachedSecretsAt = now;
  _lastSecret = both.secret;
  _lastWebhook = both.webhook;
  return both.secret;
}

async function resolveWebhookSecretFromDbFallback() {
  const now = Date.now();
  if (_cachedSecrets && (now - _cachedSecretsAt) < STRIPE_CLIENT_TTL_MS) {
    return _cachedSecrets.webhook;
  }
  const both = await resolveSecretsFromDb();
  _cachedSecrets = both;
  _cachedSecretsAt = now;
  _lastSecret = both.secret;
  _lastWebhook = both.webhook;
  return both.webhook;
}

async function getStripeClient() {
  const now = Date.now();
  const secretKey = await resolveSecretKeyFromDbFallback();
  if (stripe && stripeKeySnapshot === secretKey && (now - stripeClientAt) < STRIPE_CLIENT_TTL_MS) {
    return stripe;
  }
  stripe = null;
  if (secretKey) {
    try {
      // eslint-disable-next-line global-require
      const Stripe = require('stripe');
      stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
    } catch (err) {
      console.warn('[billingService] Stripe SDK unavailable; manual billing mode enabled.', err.message);
      stripe = null;
    }
  }
  stripeKeySnapshot = secretKey || '';
  stripeClientAt = now;
  return stripe;
}

async function getWebhookSecret() {
  return resolveWebhookSecretFromDbFallback();
}

async function getPublishableKey() {
  try {
    const info = await platformSettings.getPaymentGatewayPublic();
    return info.stripe_publishable_key || process.env.STRIPE_PUBLISHABLE_KEY || '';
  } catch (_) {
    return process.env.STRIPE_PUBLISHABLE_KEY || '';
  }
}

async function getFrontendUrl() {
  try {
    const info = await platformSettings.getPaymentGatewayPublic();
    return (info.frontend_url || ENV_FRONTEND_URL).replace(/\/+$/, '');
  } catch (_) {
    return ENV_FRONTEND_URL;
  }
}

// Legacy inlined constants for code that referenced these at module load time.
// Please use the async resolvers above instead — they honor Super Admin DB settings.
const FRONTEND_URL = ENV_FRONTEND_URL;
const STRIPE_SECRET_KEY = ENV_STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = ENV_STRIPE_WEBHOOK_SECRET;

// Backwards compat: attempt to build a stripe client synchronously at boot using env vars only.
// At runtime, `getStripeClient()` above will re-evaluate with DB values.
if (STRIPE_SECRET_KEY) {
  try {
    // eslint-disable-next-line global-require
    const Stripe = require('stripe');
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    stripeKeySnapshot = STRIPE_SECRET_KEY;
    stripeClientAt = Date.now();
  } catch (err) {
    console.warn('[billingService] Stripe SDK unavailable at boot; manual billing mode enabled.', err.message);
    stripe = null;
  }
}

async function isBillingEnabled() {
  return Boolean(await getStripeClient());
}

const SUPPORTED_PLANS = ['trial', 'starter', 'premium', 'enterprise'];

// Defensive: cache which restaurants columns exist so endpoints can degrade gracefully
// before 014_billing_subscriptions.sql is applied (avoids 500s on fresh or outdated DBs).
const BILLING_REQUIRED_COLUMNS = [
  'plan',
  'billing_provider',
  'trial_ends_at',
  'subscription_current_period_end',
  'subscription_cancel_at_period_end',
  'subscription_started_at',
  'trial_started_by_super_admin_id',
  'stripe_customer_id',
  'stripe_subscription_id',
  'stripe_price_id',
  'max_tables',
  'max_monthly_sessions',
  'can_generate_qr',
  'can_export_analytics',
  'can_use_custom_qr_branding',
  'can_use_dual_phone_sessions',
  'can_access_support',
  'support_tier'
];

let _columnsCache = null;
async function restaurantsColumns() {
  if (_columnsCache) return _columnsCache;
  try {
    const res = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'restaurants'`
    );
    const set = new Set(res.rows.map((r) => r.column_name));
    _columnsCache = set;
    return set;
  } catch (_) {
    _columnsCache = new Set();
    return _columnsCache;
  }
}

function col(columnsSet, name, fallback = 'NULL') {
  return columnsSet.has(name) ? `"${name}"` : fallback;
}

const PLAN_CATALOG = {
  trial: {
    key: 'trial',
    name: 'Trial',
    description: 'Evaluation plan provisioned and activated manually by Super Admin.',
    monthly_amount_cents: 0,
    currency: 'usd',
    interval: 'trial',
    public: false,
    features: [
      'Up to 10 tables',
      'Up to 300 sessions per month',
      'Dual-phone and Single-phone sessions',
      'Standard analytics',
      'Super Admin provisions QR codes'
    ],
    defaults: {
      billing_provider: 'manual',
      max_tables: 10,
      max_monthly_sessions: 300,
      can_generate_qr: false, // restaurant admins cannot generate QR in trial
      can_export_analytics: false,
      can_use_custom_qr_branding: false,
      can_use_dual_phone_sessions: true,
      can_access_support: true,
      support_tier: 'standard'
    }
  },
  starter: {
    key: 'starter',
    name: 'Starter',
    description: 'Perfect for small venues getting started with Catalyst table conversations.',
    monthly_amount_cents: 7900,
    currency: 'usd',
    interval: 'month',
    public: true,
    features: [
      'Up to 20 tables',
      'Up to 5,000 sessions/month',
      'Single & Dual phone modes',
      'Restaurant admin can generate standard QR codes',
      'CSV analytics export',
      'Standard email support'
    ],
    defaults: {
      billing_provider: 'manual',
      max_tables: 20,
      max_monthly_sessions: 5000,
      can_generate_qr: true,
      can_export_analytics: true,
      can_use_custom_qr_branding: false,
      can_use_dual_phone_sessions: true,
      can_access_support: true,
      support_tier: 'standard'
    }
  },
  premium: {
    key: 'premium',
    name: 'Premium',
    description: 'Full-featured for larger restaurants, multi-locations, and branded QR prints.',
    monthly_amount_cents: 24900,
    currency: 'usd',
    interval: 'month',
    public: true,
    features: [
      'Up to 200 tables',
      'Unlimited sessions/month',
      'Custom QR branding (print-ready logos & themes)',
      'Priority email + chat support',
      'Advanced analytics exports',
      'Dual phone + smart reconnect'
    ],
    defaults: {
      billing_provider: 'manual',
      max_tables: 200,
      max_monthly_sessions: null,
      can_generate_qr: true,
      can_export_analytics: true,
      can_use_custom_qr_branding: true,
      can_use_dual_phone_sessions: true,
      can_access_support: true,
      support_tier: 'priority'
    }
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Custom pricing for chains, hospitality groups, and white-label partners.',
    monthly_amount_cents: 0,
    currency: 'usd',
    interval: 'custom',
    public: false,
    features: [
      'Unlimited tables & sessions',
      'Dedicated support + SLA',
      'Custom branding & domain',
      'Bespoke question decks & onboarding',
      'SSO, audit logs, and billing consolidation'
    ],
    defaults: {
      billing_provider: 'manual',
      max_tables: null,
      max_monthly_sessions: null,
      can_generate_qr: true,
      can_export_analytics: true,
      can_use_custom_qr_branding: true,
      can_use_dual_phone_sessions: true,
      can_access_support: true,
      support_tier: 'dedicated'
    }
  }
};

function listPublicPlans() {
  return SUPPORTED_PLANS.filter((k) => PLAN_CATALOG[k].public).map((k) => serializePlan(PLAN_CATALOG[k]));
}

function listAllPlans() {
  return SUPPORTED_PLANS.map((k) => serializePlan(PLAN_CATALOG[k]));
}

function getPlan(planKey) {
  return PLAN_CATALOG[String(planKey || '').toLowerCase()] || null;
}

function serializePlan(plan) {
  return {
    key: plan.key,
    name: plan.name,
    description: plan.description,
    monthly_amount_cents: plan.monthly_amount_cents,
    currency: plan.currency,
    interval: plan.interval,
    public: plan.public,
    features: plan.features,
    defaults: plan.defaults
  };
}

function deriveBillingStatusFromPlanAndDates(row) {
  const status = row.billing_status;
  if (status === 'suspended') return 'suspended';

  const now = new Date();
  const plan = row.plan;

  if (row.trial_ends_at) {
    if (now < new Date(row.trial_ends_at)) return 'trialing';
    // trial expired but not yet flipped over: treat gracefully as past-due until rectified
    if (status === 'pending' || status === 'active') return 'past_due';
  }

  if (row.subscription_current_period_end && row.plan !== 'trial') {
    const endDate = new Date(row.subscription_current_period_end);
    if (now <= endDate) {
      if (row.subscription_cancel_at_period_end) return 'cancel_at_period_end';
      return 'active';
    }
    return 'past_due';
  }

  if (status === 'active') return 'active';
  if (status === 'pending') return plan === 'trial' ? 'trialing' : 'pending';

  return status || 'pending';
}

async function getRestaurantBilling(restaurantId) {
  const cols = await restaurantsColumns();
  const safeSelect = [
    'id',
    'name',
    'slug',
    `${col(cols, 'manager_name')} AS manager_name`,
    `${col(cols, 'contact_email')} AS contact_email`,
    `${col(cols, 'contact_phone')} AS contact_phone`,
    `${col(cols, 'address')} AS address`,
    `${col(cols, 'latitude')} AS latitude`,
    `${col(cols, 'longitude')} AS longitude`,
    `${col(cols, 'plan', "'starter'")} AS plan`,
    `${col(cols, 'billing_status', "'pending'")} AS billing_status`,
    `${col(cols, 'billing_provider', "'manual'")} AS billing_provider`,
    `${col(cols, 'trial_ends_at')} AS trial_ends_at`,
    `${col(cols, 'subscription_current_period_end')} AS subscription_current_period_end`,
    `${col(cols, 'subscription_cancel_at_period_end', 'FALSE')} AS subscription_cancel_at_period_end`,
    `${col(cols, 'subscription_started_at')} AS subscription_started_at`,
    `${col(cols, 'stripe_customer_id')} AS stripe_customer_id`,
    `${col(cols, 'stripe_subscription_id')} AS stripe_subscription_id`,
    `${col(cols, 'stripe_price_id')} AS stripe_price_id`,
    `${col(cols, 'max_tables')} AS max_tables`,
    `${col(cols, 'max_monthly_sessions')} AS max_monthly_sessions`,
    `${col(cols, 'can_generate_qr', cols.has('plan') ? `CASE WHEN plan = 'trial' THEN FALSE ELSE TRUE END` : 'TRUE')} AS can_generate_qr`,
    `${col(cols, 'can_export_analytics', 'TRUE')} AS can_export_analytics`,
    `${col(cols, 'can_use_custom_qr_branding', 'FALSE')} AS can_use_custom_qr_branding`,
    `${col(cols, 'can_use_dual_phone_sessions', 'TRUE')} AS can_use_dual_phone_sessions`,
    `${col(cols, 'can_access_support', 'TRUE')} AS can_access_support`,
    `${col(cols, 'support_tier', "'standard'")} AS support_tier`,
    'created_at',
    'updated_at'
  ].join(', ');
  const result = await db.query(
    `SELECT ${safeSelect} FROM restaurants WHERE id = $1`,
    [restaurantId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const plan = getPlan(row.plan);
  const computed_status = deriveBillingStatusFromPlanAndDates(row);

  return {
    ...row,
    plan_meta: plan ? serializePlan(plan) : null,
    computed_status
  };
}

async function setRestaurantPlan(restaurantId, { planKey, actorSuperAdminId, stripePriceIdOverride, trialDays, setActive = true }) {
  const plan = getPlan(planKey);
  if (!plan) {
    throw new Error(`Unsupported plan: ${planKey}`);
  }

  const fields = [];
  const params = [restaurantId];
  let i = 2;

  fields.push(`plan = $${i++}`); params.push(plan.key);

  const now = new Date();
  const defaults = plan.defaults;

  if (planKey === 'trial') {
    const days = Number.isInteger(trialDays) ? trialDays : 14;
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    fields.push(`trial_ends_at = $${i++}`); params.push(endDate);
    fields.push(`trial_started_by_super_admin_id = $${i++}`); params.push(actorSuperAdminId || null);
    if (setActive) {
      fields.push(`billing_status = $${i++}`); params.push('active');
    }
  } else {
    // Keep any existing trial dates for audit, but do not treat as trial.
    fields.push(`subscription_started_at = COALESCE(subscription_started_at, $${i++})`); params.push(now);
    if (setActive) {
      fields.push(`billing_status = $${i++}`); params.push('active');
    }
  }

  if (stripePriceIdOverride) {
    fields.push(`stripe_price_id = $${i++}`); params.push(stripePriceIdOverride);
  }

  fields.push(`billing_provider = $${i++}`); params.push(defaults.billing_provider);
  fields.push(`max_tables = $${i++}`); params.push(defaults.max_tables);
  fields.push(`max_monthly_sessions = $${i++}`); params.push(defaults.max_monthly_sessions);
  fields.push(`can_generate_qr = $${i++}`); params.push(defaults.can_generate_qr);
  fields.push(`can_export_analytics = $${i++}`); params.push(defaults.can_export_analytics);
  fields.push(`can_use_custom_qr_branding = $${i++}`); params.push(defaults.can_use_custom_qr_branding);
  fields.push(`can_use_dual_phone_sessions = $${i++}`); params.push(defaults.can_use_dual_phone_sessions);
  fields.push(`can_access_support = $${i++}`); params.push(defaults.can_access_support);
  fields.push(`support_tier = $${i++}`); params.push(defaults.support_tier);
  fields.push(`updated_at = NOW()`);

  const query = `UPDATE restaurants SET ${fields.join(', ')} WHERE id = $1 RETURNING id`;
  const res = await db.query(query, params);
  if (res.rows.length === 0) throw new Error('Restaurant not found');
  return getRestaurantBilling(restaurantId);
}

async function provisionTrialQrForTable(restaurantId, tableNumber, { superAdminUserId }) {
  const billing = await getRestaurantBilling(restaurantId);
  if (!billing) throw new Error('Restaurant not found');
  if (billing.plan !== 'trial') {
    throw new Error('Trial QR provisioning is only for trial restaurants. For paid plans, use normal QR generation.');
  }
  const slugRes = await db.query('SELECT slug FROM restaurants WHERE id = $1', [restaurantId]);
  const slug = slugRes.rows[0]?.slug;
  if (!slug) throw new Error('Restaurant slug not found');

  const frontendUrl = await getFrontendUrl();
  const qrUrl = `${frontendUrl}/r/${slug}/t/${encodeURIComponent(String(tableNumber).trim())}`;

  const row = await db.query(
    `INSERT INTO restaurant_tables (restaurant_id, table_number, qr_code_url, provisioned_by_super_admin_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (restaurant_id, table_number) DO UPDATE SET
       qr_code_url = EXCLUDED.qr_code_url,
       provisioned_by_super_admin_id = EXCLUDED.provisioned_by_super_admin_id
     RETURNING id, table_number, qr_code_url, created_at`,
    [restaurantId, String(tableNumber).trim(), qrUrl, superAdminUserId || null]
  );

  // eslint-disable-next-line global-require
  const QRCode = require('qrcode');
  const qrPngDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 600,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#FFFFFF' }
  });

  return { ...row.rows[0], qr: qrPngDataUrl, url: qrUrl };
}

async function generateTenantQrDataUrls(restaurantId, { tableIds = null, tableNumbers = null } = {}) {
  if (!restaurantId) throw new Error('Restaurant ID required');
  const slugRes = await db.query('SELECT slug FROM restaurants WHERE id = $1', [restaurantId]);
  const slug = slugRes.rows[0]?.slug;
  if (!slug) throw new Error('Restaurant slug not found');
  const frontendUrl = await getFrontendUrl();

  const params = [restaurantId];
  let whereClauses = ['restaurant_id = $1'];
  let idx = 2;
  if (Array.isArray(tableIds) && tableIds.length > 0) {
    whereClauses.push(`id = ANY($${idx++})`);
    params.push(tableIds.map((x) => Number(x)).filter(Number.isFinite));
  }
  if (Array.isArray(tableNumbers) && tableNumbers.length > 0) {
    whereClauses.push(`table_number = ANY($${idx++})`);
    params.push(tableNumbers.map((x) => String(x).trim()));
  }
  const rows = await db.query(
    `SELECT id, table_number, qr_code_url
     FROM restaurant_tables
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY
       CASE WHEN table_number ~ '^[0-9]+$' THEN LPAD(table_number, 10, '0') ELSE table_number END
       ASC NULLS LAST, id ASC`,
    params
  );

  // eslint-disable-next-line global-require
  const QRCode = require('qrcode');

  const out = [];
  for (const t of rows.rows) {
    const baseUrl = t.qr_code_url || `${frontendUrl}/r/${slug}/t/${encodeURIComponent(String(t.table_number).trim())}`;
    const qr = await QRCode.toDataURL(baseUrl, {
      width: 600,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#FFFFFF' }
    });
    out.push({ id: t.id, table_number: t.table_number, qr_code_url: baseUrl, qr });
  }
  return out;
}

function canRestaurantGenerateQr(billing, { isSuperAdminProvisioning = false } = {}) {
  if (!billing) return false;
  if (isSuperAdminProvisioning) {
    return billing.plan === 'trial' || billing.plan !== 'trial';
  }
  if (billing.billing_status === 'suspended') return false;
  if (billing.plan === 'trial') {
    return Boolean(billing.can_generate_qr); // only if SA explicitly flipped it
  }
  return Boolean(billing.can_generate_qr);
}

async function hasBillingProvider() {
  return isBillingEnabled();
}

async function createStripeCheckoutSession({ restaurantId, planKey, successUrl, cancelUrl }) {
  const stripeClient = await getStripeClient();
  if (!stripeClient) {
    throw new Error('Billing provider is not configured. Please contact support.');
  }
  const billing = await getRestaurantBilling(restaurantId);
  if (!billing) throw new Error('Restaurant not found');

  const plan = getPlan(planKey);
  if (!plan || !plan.public) {
    throw new Error('Unsupported plan for checkout');
  }

  let customerId = billing.stripe_customer_id;
  if (!customerId) {
    const customer = await stripeClient.customers.create({
      email: billing.contact_email || undefined,
      name: billing.name || undefined,
      metadata: {
        restaurant_id: String(restaurantId),
        restaurant_slug: billing.slug || ''
      }
    });
    customerId = customer.id;
    await db.query(
      `UPDATE restaurants SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1`,
      [restaurantId, customerId]
    );
  }

  // If configured, use the restaurant's explicit price ID override; otherwise create an ad-hoc line item.
  const lineItem = billing.stripe_price_id
    ? { price: billing.stripe_price_id, quantity: 1 }
    : {
        price_data: {
          currency: plan.currency,
          product_data: {
            name: `Catalyst ${plan.name}`,
            metadata: { plan: plan.key }
          },
          unit_amount: plan.monthly_amount_cents,
          recurring: { interval: 'month' }
        },
        quantity: 1
      };

  const checkoutSession = await stripeClient.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      restaurant_id: String(restaurantId),
      plan: plan.key
    },
    subscription_data: {
      metadata: {
        restaurant_id: String(restaurantId),
        plan: plan.key
      }
    },
    line_items: [lineItem]
  });

  return {
    checkout_session_id: checkoutSession.id,
    checkout_url: checkoutSession.url,
    plan: plan.key
  };
}

async function createStripeBillingPortalSession({ restaurantId, returnUrl }) {
  const stripeClient = await getStripeClient();
  if (!stripeClient) {
    throw new Error('Billing provider is not configured.');
  }
  const billing = await getRestaurantBilling(restaurantId);
  if (!billing) throw new Error('Restaurant not found');
  if (!billing.stripe_customer_id) {
    throw new Error('No billing customer on file. Start a checkout first.');
  }

  const portal = await stripeClient.billingPortal.sessions.create({
    customer: billing.stripe_customer_id,
    return_url: returnUrl
  });

  return { portal_url: portal.url };
}

async function handleStripeWebhook({ signature, rawBody }) {
  const stripeClient = await getStripeClient();
  if (!stripeClient) throw new Error('Stripe webhook disabled');
  const secret = await getWebhookSecret();
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    const e = new Error(`Webhook signature verification failed: ${err.message}`);
    e.status = 400;
    throw e;
  }

  // Idempotently record the event first.
  try {
    await db.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type, payload) VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.type, event]
    );
  } catch (err) {
    // ignore if event already logged
  }

  const data = event.data?.object || {};
  const restaurantId = data.metadata?.restaurant_id
    || data.customer?.metadata?.restaurant_id
    || null;

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        if (!restaurantId) break;
        const subscription = event.type.startsWith('customer.subscription')
          ? data
          : (data.subscription ? await (await getStripeClient()).subscriptions.retrieve(typeof data.subscription === 'string' ? data.subscription : data.subscription.id) : null);
        if (!subscription) break;

        const planKey = (subscription.metadata?.plan && getPlan(subscription.metadata.plan) && subscription.metadata.plan)
          || 'starter';
        const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;
        const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);

        await db.query(
          `UPDATE restaurants
           SET plan = $2,
               billing_status = 'active',
               billing_provider = 'stripe',
               stripe_subscription_id = $3,
               stripe_customer_id = COALESCE(stripe_customer_id, $4),
               stripe_price_id = $5,
               subscription_current_period_end = $6,
               subscription_cancel_at_period_end = $7,
               subscription_started_at = COALESCE(subscription_started_at, NOW()),
               max_tables = $8,
               max_monthly_sessions = $9,
               can_generate_qr = TRUE,
               can_export_analytics = TRUE,
               can_use_custom_qr_branding = $10,
               can_access_support = TRUE,
               support_tier = $11,
               updated_at = NOW()
           WHERE id = $1`,
          [
            restaurantId,
            planKey,
            subscription.id || null,
            typeof subscription.customer === 'string' ? subscription.customer : (subscription.customer?.id || null),
            subscription.items?.data?.[0]?.price?.id || null,
            periodEnd,
            cancelAtPeriodEnd,
            planKey === 'premium' ? 200 : 20,
            planKey === 'premium' ? null : 5000,
            planKey === 'premium',
            planKey === 'premium' ? 'priority' : 'standard'
          ]
        );
        break;
      }

      case 'invoice.paid': {
        const invoiceRestaurantId = restaurantId || (await findRestaurantByInvoice(data)).id || null;
        if (!invoiceRestaurantId) break;
        await db.query(
          `INSERT INTO subscription_invoices
             (invoice_id, restaurant_id, billing_provider, provider_invoice_number, plan,
              amount_cents, currency, status, period_start, period_end, paid_at)
           VALUES ($1, $2, 'stripe', $3, $4, $5, $6, 'paid', $7, $8, NOW())
           ON CONFLICT (invoice_id) DO UPDATE SET
             status = 'paid',
             paid_at = NOW()`,
          [
            data.id,
            invoiceRestaurantId,
            data.number || null,
            data.lines?.data?.[0]?.metadata?.plan || data.metadata?.plan || 'starter',
            Number.isInteger(data.amount_paid) ? data.amount_paid : 0,
            data.currency || 'usd',
            data.period_start ? new Date(data.period_start * 1000) : null,
            data.period_end ? new Date(data.period_end * 1000) : null
          ]
        );
        break;
      }

      case 'invoice.payment_failed': {
        const invoiceRestaurantId = restaurantId || (await findRestaurantByInvoice(data)).id || null;
        if (!invoiceRestaurantId) break;
        await db.query(`UPDATE restaurants SET billing_status = 'past_due', updated_at = NOW() WHERE id = $1`, [invoiceRestaurantId]);
        break;
      }

      case 'customer.subscription.deleted': {
        if (!restaurantId) break;
        await db.query(
          `UPDATE restaurants SET billing_status = 'suspended', subscription_cancel_at_period_end = TRUE, updated_at = NOW() WHERE id = $1`,
          [restaurantId]
        );
        break;
      }

      default:
        break;
    }
  } catch (err) {
    await db.query(
      `UPDATE stripe_webhook_events SET processing_error = $2 WHERE event_id = $1`,
      [event.id, String(err.message).slice(0, 1000)]
    );
    throw err;
  }

  return { handled: true, event_id: event.id, event_type: event.type };
}

async function findRestaurantByInvoice(invoiceObject) {
  const customerId = typeof invoiceObject.customer === 'string' ? invoiceObject.customer : invoiceObject.customer?.id;
  if (!customerId) return { id: null };
  const res = await db.query(
    `SELECT id FROM restaurants WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId]
  );
  return res.rows[0] || { id: null };
}

async function listRestaurantInvoices(restaurantId, limit = 24) {
  const res = await db.query(
    `SELECT invoice_id, provider_invoice_number, plan, amount_cents, currency, status,
            period_start, period_end, paid_at, created_at
     FROM subscription_invoices
     WHERE restaurant_id = $1
     ORDER BY period_start DESC NULLS LAST, created_at DESC
     LIMIT $2`,
    [restaurantId, limit]
  );
  return res.rows;
}

async function listBillingOverviewForSuperAdmin({ search = '', limit = 500 } = {}) {
  const cols = await restaurantsColumns();
  const params = [];
  const clauses = [];
  let i = 1;
  if (search) {
    clauses.push(`(LOWER(name) LIKE $${i++} OR LOWER(slug) LIKE $${i++} OR LOWER(COALESCE(${col(cols, 'contact_email', 'NULL')}, '')) LIKE $${i++})`);
    const like = `%${String(search).toLowerCase().trim()}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const safeSelect = [
    'id',
    'name',
    'slug',
    `${col(cols, 'contact_email')} AS contact_email`,
    `${col(cols, 'plan', "'starter'")} AS plan`,
    `${col(cols, 'billing_status', "'pending'")} AS billing_status`,
    `${col(cols, 'billing_provider', "'manual'")} AS billing_provider`,
    `${col(cols, 'trial_ends_at')} AS trial_ends_at`,
    `${col(cols, 'subscription_current_period_end')} AS subscription_current_period_end`,
    `${col(cols, 'subscription_cancel_at_period_end', 'FALSE')} AS subscription_cancel_at_period_end`,
    `${col(cols, 'stripe_customer_id')} AS stripe_customer_id`,
    `${col(cols, 'stripe_subscription_id')} AS stripe_subscription_id`,
    `${col(cols, 'support_tier', "'standard'")} AS support_tier`,
    `${col(cols, 'max_tables')} AS max_tables`,
    `${col(cols, 'max_monthly_sessions')} AS max_monthly_sessions`,
    `${col(cols, 'can_generate_qr', cols.has('plan') ? `CASE WHEN plan = 'trial' THEN FALSE ELSE TRUE END` : 'TRUE')} AS can_generate_qr`,
    `${col(cols, 'can_export_analytics', 'TRUE')} AS can_export_analytics`,
    `${col(cols, 'can_use_custom_qr_branding', 'FALSE')} AS can_use_custom_qr_branding`,
    `${col(cols, 'can_use_dual_phone_sessions', 'TRUE')} AS can_use_dual_phone_sessions`,
    `${col(cols, 'can_access_support', 'TRUE')} AS can_access_support`,
    `(SELECT COUNT(*) FROM restaurant_tables rt WHERE rt.restaurant_id = r.id) AS table_count`,
    `(SELECT COUNT(*) FROM sessions s WHERE s.restaurant_id = r.id AND s.created_at > NOW() - INTERVAL '30 days') AS sessions_30d`,
    'created_at',
    'updated_at'
  ].join(', ');
  const res = await db.query(
    `SELECT ${safeSelect}
     FROM restaurants r
     ${where}
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT $${i++}`,
    [...params, limit]
  );
  return res.rows.map((row) => ({
    ...row,
    computed_status: deriveBillingStatusFromPlanAndDates(row)
  }));
}

module.exports = {
  SUPPORTED_PLANS,
  PLAN_CATALOG,
  listPublicPlans,
  listAllPlans,
  getPlan,
  getRestaurantBilling,
  setRestaurantPlan,
  provisionTrialQrForTable,
  canRestaurantGenerateQr,
  hasBillingProvider,
  getStripeClient,
  getWebhookSecret,
  getFrontendUrl,
  getPublishableKey: async () => {
    try {
      const info = await platformSettings.getPaymentGatewayPublic();
      return info.stripe_publishable_key || process.env.STRIPE_PUBLISHABLE_KEY || '';
    } catch (_) {
      return process.env.STRIPE_PUBLISHABLE_KEY || '';
    }
  },
  invalidateCaches: () => {
    try {
      platformSettings.invalidateCache && platformSettings.invalidateCache();
    } catch (_) {
      // ignore
    }
    _cachedSecrets = null;
    _cachedSecretsAt = 0;
    stripeClientAt = 0;
    stripeKeySnapshot = '';
  },
  createStripeCheckoutSession,
  createStripeBillingPortalSession,
  handleStripeWebhook,
  listRestaurantInvoices,
  listBillingOverviewForSuperAdmin,
  generateTenantQrDataUrls
};
