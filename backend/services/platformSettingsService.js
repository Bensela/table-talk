const crypto = require('crypto');
const db = require('../db');

const ROOT_SECRET = process.env.JWT_SECRET || process.env.APP_SECRET || 'tabletalk_secure_secret_key_123';

function deriveKey() {
  return crypto.createHash('sha256').update(String(ROOT_SECRET)).digest().slice(0, 32);
}

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

function encryptSecret(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([iv, tag, enc]).toString('base64');
  return `ENC@AES256GCM:${out}`;
}

function decryptSecret(token) {
  if (!token || typeof token !== 'string') return '';
  if (!token.startsWith('ENC@AES256GCM:')) return token;
  try {
    const buf = Buffer.from(token.slice('ENC@AES256GCM:'.length), 'base64');
    const iv = buf.slice(0, IV_LEN);
    const tag = buf.slice(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const enc = buf.slice(IV_LEN + AUTH_TAG_LEN);
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (err) {
    console.warn('[platformSettings] Could not decrypt stored secret; falling back to empty.', err.message);
    return '';
  }
}

async function tableExists() {
  try {
    const res = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name = 'platform_settings'
       ) AS t`
    );
    return Boolean(res.rows[0]?.t);
  } catch (_) {
    return false;
  }
}

let _rowCache = null;
let _cacheAt = 0;
const CACHE_MS = 15000;

async function readRowsRaw() {
  const exists = await tableExists();
  if (!exists) return [];
  try {
    const res = await db.query(`SELECT setting_key, setting_value, value_kind, is_secret, source, updated_at FROM platform_settings`);
    return res.rows || [];
  } catch (_) {
    return [];
  }
}

async function getAllRaw() {
  const now = Date.now();
  if (_rowCache && (now - _cacheAt) < CACHE_MS) return _rowCache;
  const rows = await readRowsRaw();
  const out = rows.reduce((acc, row) => {
    acc[row.setting_key] = row;
    return acc;
  }, {});
  _rowCache = out;
  _cacheAt = now;
  return out;
}

function invalidateCache() {
  _rowCache = null;
  _cacheAt = 0;
}

const ENV_FALLBACKS = {
  'payment_gateway.provider': () => (process.env.STRIPE_SECRET_KEY ? 'stripe' : 'manual'),
  'payment_gateway.mode': () => /^sk_test_/.test(process.env.STRIPE_SECRET_KEY || '') ? 'test' : 'live',
  'payment_gateway.stripe_publishable_key': () => process.env.STRIPE_PUBLISHABLE_KEY || '',
  'payment_gateway.stripe_secret_key': () => process.env.STRIPE_SECRET_KEY || '',
  'payment_gateway.stripe_webhook_secret': () => process.env.STRIPE_WEBHOOK_SECRET || '',
  'payment_gateway.frontend_url': () => process.env.FRONTEND_URL || ''
};

function resolveValue(row, key) {
  const fallback = typeof ENV_FALLBACKS[key] === 'function' ? ENV_FALLBACKS[key]() : '';
  if (!row || !row.setting_value || row.setting_value === '') return fallback;
  if (row.is_secret) return decryptSecret(row.setting_value) || fallback;
  return row.setting_value;
}

async function getPaymentGatewayPublic() {
  const rows = await getAllRaw();
  const provider = resolveValue(rows['payment_gateway.provider'], 'payment_gateway.provider');
  const mode = resolveValue(rows['payment_gateway.mode'], 'payment_gateway.mode');
  const publishable = resolveValue(rows['payment_gateway.stripe_publishable_key'], 'payment_gateway.stripe_publishable_key');
  const frontendUrl = resolveValue(rows['payment_gateway.frontend_url'], 'payment_gateway.frontend_url');
  const secretRow = rows['payment_gateway.stripe_secret_key'];
  const webhookRow = rows['payment_gateway.stripe_webhook_secret'];
  const hasSecret = Boolean(resolveValue(secretRow, 'payment_gateway.stripe_secret_key'));
  const hasWebhook = Boolean(resolveValue(webhookRow, 'payment_gateway.stripe_webhook_secret'));
  return {
    provider,
    mode,
    stripe_publishable_key: publishable,
    frontend_url: frontendUrl,
    has_stripe_secret_key: hasSecret,
    has_stripe_webhook_secret: hasWebhook,
    sources: {
      provider: sourceLabel(rows['payment_gateway.provider'], 'payment_gateway.provider'),
      mode: sourceLabel(rows['payment_gateway.mode'], 'payment_gateway.mode'),
      stripe_publishable_key: sourceLabel(rows['payment_gateway.stripe_publishable_key'], 'payment_gateway.stripe_publishable_key'),
      stripe_secret_key: sourceLabel(secretRow, 'payment_gateway.stripe_secret_key'),
      stripe_webhook_secret: sourceLabel(webhookRow, 'payment_gateway.stripe_webhook_secret'),
      frontend_url: sourceLabel(rows['payment_gateway.frontend_url'], 'payment_gateway.frontend_url')
    }
  };
}

function sourceLabel(row, key) {
  if (!row || !row.setting_value || row.setting_value === '') {
    return typeof ENV_FALLBACKS[key] === 'function' && ENV_FALLBACKS[key]() ? 'env' : 'none';
  }
  return row.source === 'default' ? 'default' : 'super_admin';
}

async function getPaymentGatewaySecretOnlyForSuperAdmin() {
  const rows = await getAllRaw();
  const provider = resolveValue(rows['payment_gateway.provider'], 'payment_gateway.provider');
  const mode = resolveValue(rows['payment_gateway.mode'], 'payment_gateway.mode');
  const publishable = resolveValue(rows['payment_gateway.stripe_publishable_key'], 'payment_gateway.stripe_publishable_key');
  const frontendUrl = resolveValue(rows['payment_gateway.frontend_url'], 'payment_gateway.frontend_url');
  const secret = resolveValue(rows['payment_gateway.stripe_secret_key'], 'payment_gateway.stripe_secret_key');
  const webhook = resolveValue(rows['payment_gateway.stripe_webhook_secret'], 'payment_gateway.stripe_webhook_secret');
  return {
    provider,
    mode,
    stripe_publishable_key: publishable,
    stripe_secret_key_masked: maskSecret(secret),
    stripe_webhook_secret_masked: maskSecret(webhook),
    frontend_url: frontendUrl,
    has_stripe_secret_key: Boolean(secret),
    has_stripe_webhook_secret: Boolean(webhook),
    webhook_endpoint_url: deriveWebhookEndpointUrl(frontendUrl),
    sources: {
      provider: sourceLabel(rows['payment_gateway.provider'], 'payment_gateway.provider'),
      mode: sourceLabel(rows['payment_gateway.mode'], 'payment_gateway.mode'),
      stripe_publishable_key: sourceLabel(rows['payment_gateway.stripe_publishable_key'], 'payment_gateway.stripe_publishable_key'),
      stripe_secret_key: sourceLabel(rows['payment_gateway.stripe_secret_key'], 'payment_gateway.stripe_secret_key'),
      stripe_webhook_secret: sourceLabel(rows['payment_gateway.stripe_webhook_secret'], 'payment_gateway.stripe_webhook_secret'),
      frontend_url: sourceLabel(rows['payment_gateway.frontend_url'], 'payment_gateway.frontend_url')
    }
  };
}

function maskSecret(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

function deriveWebhookEndpointUrl(frontendUrl) {
  // Prefer a backend env URL, else synthesize from frontend URL by swapping typical host conventions.
  if (process.env.BACKEND_URL) {
    const base = process.env.BACKEND_URL.replace(/\/+$/, '');
    return `${base}/billing/stripe/webhook`;
  }
  const publicApiUrl = process.env.PUBLIC_API_URL || process.env.VITE_API_URL;
  if (publicApiUrl && publicApiUrl.startsWith('http')) {
    const base = publicApiUrl.replace(/\/+$/, '');
    return `${base}/billing/stripe/webhook`;
  }
  if (frontendUrl) {
    // Heuristic: frontend.example.com → api.example.com; localhost:5173 → localhost:5000
    try {
      const u = new URL(frontendUrl);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        return `${u.protocol}//${u.hostname}:${process.env.PORT || 5000}/billing/stripe/webhook`;
      }
      u.hostname = u.hostname.replace(/^www\./, '').replace(/^stingray-.*\.ondigitalocean\.app/, (_m) => _m);
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}/api/billing/stripe/webhook`;
    } catch (_) {
      return '';
    }
  }
  return '';
}

async function upsertSetting({ key, value, isSecret = false, actorUserId, source = 'super_admin' }) {
  const exists = await tableExists();
  if (!exists) throw new Error('platform_settings table has not been created yet. Run migration 015.');
  invalidateCache();
  const storedValue = isSecret && value ? encryptSecret(value) : value ?? '';
  await db.query(
    `INSERT INTO platform_settings (setting_key, setting_value, value_kind, is_secret, source, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (setting_key) DO UPDATE
     SET setting_value = EXCLUDED.setting_value,
         value_kind = EXCLUDED.value_kind,
         is_secret = EXCLUDED.is_secret,
         source = EXCLUDED.source,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
    [key, storedValue, isSecret ? 'secret' : 'string', isSecret, source, actorUserId || null]
  );
}

async function setPaymentGatewaySettings(input, actorUserId) {
  const rows = await getAllRaw();
  const existingSecret = resolveValue(rows['payment_gateway.stripe_secret_key'], 'payment_gateway.stripe_secret_key');
  const existingWebhook = resolveValue(rows['payment_gateway.stripe_webhook_secret'], 'payment_gateway.stripe_webhook_secret');
  const getOr = (rawVal, def) => {
    const v = resolveValue(rawVal, '') || '';
    return v || def;
  };
  const keys = [
    ['payment_gateway.provider', input.provider ?? getOr(rows['payment_gateway.provider'], ''), false],
    ['payment_gateway.mode', input.mode ?? getOr(rows['payment_gateway.mode'], ''), false],
    ['payment_gateway.stripe_publishable_key', input.stripe_publishable_key ?? getOr(rows['payment_gateway.stripe_publishable_key'], ''), false],
    [
      'payment_gateway.frontend_url',
      String(input.frontend_url ?? getOr(rows['payment_gateway.frontend_url'], '')).replace(/\/+$/, ''),
      false
    ]
  ];

  const nextSecret = (input.stripe_secret_key && input.stripe_secret_key.trim())
    ? isMaskedToken(input.stripe_secret_key) ? existingSecret : input.stripe_secret_key.trim()
    : existingSecret || '';
  const nextWebhook = (input.stripe_webhook_secret && input.stripe_webhook_secret.trim())
    ? isMaskedToken(input.stripe_webhook_secret) ? existingWebhook : input.stripe_webhook_secret.trim()
    : existingWebhook || '';

  keys.push(['payment_gateway.stripe_secret_key', nextSecret, true]);
  keys.push(['payment_gateway.stripe_webhook_secret', nextWebhook, true]);

  for (const [k, v, s] of keys) {
    await upsertSetting({ key: k, value: v, isSecret: s, actorUserId });
  }

  invalidateCache();
  return getPaymentGatewaySecretOnlyForSuperAdmin();
}

function isMaskedToken(str) {
  return typeof str === 'string' && /\*{4,}/.test(str);
}

module.exports = {
  encryptSecret,
  decryptSecret,
  getPaymentGatewayPublic,
  getPaymentGatewaySecretOnlyForSuperAdmin,
  setPaymentGatewaySettings,
  invalidateCache,
  deriveWebhookEndpointUrl,
  maskSecret
};
