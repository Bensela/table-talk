// Centralized resolver for Catalyst's canonical public application origin.
//
// Every server-generated absolute URL (QR codes, onboarding/invite links,
// password-reset links, billing checkout/portal redirects) should resolve
// its origin through this module instead of re-deriving its own
// process.env.FRONTEND_URL fallback — those independent, ad-hoc fallbacks
// are exactly how several call sites drifted onto the unrelated legacy
// https://tabletalk.app domain and kept ignoring the Super Admin-configured
// frontend_url setting (which only billingService.getFrontendUrl() honored).
//
// Resolution order (first usable value wins):
//   1. Super Admin-configured payment_gateway.frontend_url (platform_settings)
//   2. process.env.FRONTEND_URL
//   3. DEFAULT_PUBLIC_ORIGIN — the configured application domain
//
// Deliberately never derived from a request's Host / X-Forwarded-* headers:
// those are client-supplied and must not decide what absolute URL gets
// embedded in an email, QR code, or payment redirect.
const platformSettings = require('./platformSettingsService');

const DEFAULT_PUBLIC_ORIGIN = 'https://catalyst.madetoconnect.co';

// Origin-only, http(s)-only. Rejects anything with a path/query/fragment so
// a stray trailing slash or pasted full URL can't silently become part of
// every generated link.
function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) return '';
  return parsed.origin;
}

async function getPublicOrigin() {
  try {
    const pub = await platformSettings.getPaymentGatewayPublic();
    const configured = normalizeOrigin(pub.frontend_url);
    if (configured) return configured;
  } catch (_) {
    // Settings table unreachable/missing — fall through to env/default.
  }
  return normalizeOrigin(process.env.FRONTEND_URL) || DEFAULT_PUBLIC_ORIGIN;
}

function buildPublicUrl(origin, path) {
  const base = normalizeOrigin(origin) || DEFAULT_PUBLIC_ORIGIN;
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

/**
 * True when `candidate` is an absolute http(s) URL whose origin exactly
 * matches one of `trustedOrigins`. Use this to decide whether a
 * caller-supplied absolute URL (a QR baseUrl override, a Stripe
 * success/cancel/return URL) may be trusted, instead of accepting any
 * https:// value — the "untrusted host" class of bug this module exists to
 * close off. Never pass request Host/X-Forwarded-Host values as the
 * candidate or as a trusted origin.
 */
function isTrustedOrigin(candidate, trustedOrigins) {
  const normalizedCandidate = normalizeOrigin(candidate);
  if (!normalizedCandidate) return false;
  return (trustedOrigins || []).some((origin) => normalizeOrigin(origin) === normalizedCandidate);
}

/**
 * Like `isTrustedOrigin`, but for a full absolute URL that legitimately
 * carries a path/query (a redirect target), rather than an origin-only
 * value. Checks only the URL's origin against `trustedOrigins` — the
 * path/query are not restricted.
 */
function hasTrustedOrigin(candidateUrl, trustedOrigins) {
  if (!candidateUrl || typeof candidateUrl !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return (trustedOrigins || []).some((origin) => normalizeOrigin(origin) === parsed.origin);
}

module.exports = {
  DEFAULT_PUBLIC_ORIGIN,
  normalizeOrigin,
  getPublicOrigin,
  buildPublicUrl,
  isTrustedOrigin,
  hasTrustedOrigin
};
