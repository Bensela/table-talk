/**
 * Thin wrappers around navigator.geolocation with standardised result
 * envelopes. No tracking; used exclusively to pass client coords to the
 * backend geofence validator.
 *
 * Every function is safe under non-browser / SSR contexts (never throws).
 */

const GEOLOCATION_TIMEOUT_MS = 8000;
const MAX_AGE_MS = 30_000;
const COORD_DECIMALS = 6;
const IN_FLIGHT = new Map();

function roundToDecimals(value, decimals = COORD_DECIMALS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function clampAndRoundCoords(latitude, longitude, accuracy) {
  const lat = roundToDecimals(latitude);
  const lng = roundToDecimals(longitude);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const acc = Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy) * 100) / 100 : undefined;
  return { latitude: lat, longitude: lng, accuracy: acc };
}

function isGeolocationSupported() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return typeof navigator.geolocation !== 'undefined';
}

/**
 * Read the current Geolocation permission state without triggering a prompt.
 * Returns "unsupported" when the Geolocation API is not exposed.
 */
export async function readGeolocationPermissionState() {
  if (!isGeolocationSupported()) return 'unsupported';
  try {
    if (typeof navigator.permissions?.query === 'function') {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state; // "granted" | "denied" | "prompt"
    }
  } catch {
    // fall through to default
  }
  // If Permissions API is unavailable we can't distinguish prompt vs granted
  // without triggering a position request; the caller will do that as a next step.
  return 'prompt';
}

/**
 * Request the current position. Promise-based wrapper around getCurrentPosition
 * with a bounded timeout. Coordinates are rounded to 6 decimals (~10cm) and
 * validated before being returned.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'granted'|'denied'|'prompt'|'unsupported'|'timeout'|'error',
 *   coords?: { latitude: number, longitude: number, accuracy?: number }
 *   error?: string
 * }>}
 */
export function requestCurrentPosition({
  enableHighAccuracy = false,
  timeoutMs = GEOLOCATION_TIMEOUT_MS,
  maximumAgeMs = MAX_AGE_MS,
  dedupeKey = 'default'
} = {}) {
  if (!isGeolocationSupported()) {
    return Promise.resolve({ ok: false, status: 'unsupported' });
  }

  // Dedupe in-flight requests so the user never sees 2 permission dialogs
  // from racing call sites.
  const flightKey = `${dedupeKey}:${enableHighAccuracy ? 'high' : 'coarse'}:${timeoutMs}:${maximumAgeMs}`;
  const pending = IN_FLIGHT.get(flightKey);
  if (pending) return pending.promise;

  const promise = new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      IN_FLIGHT.delete(flightKey);
      resolve(result);
    };

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = clampAndRoundCoords(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.accuracy
          );
          if (!coords) {
            done({ ok: false, status: 'error', error: 'Invalid coordinates returned by browser' });
            return;
          }
          done({ ok: true, status: 'granted', coords });
        },
        (err) => {
          switch (err && err.code) {
            case 1:
              done({ ok: false, status: 'denied', error: err.message || 'Permission denied' });
              break;
            case 3:
              done({ ok: false, status: 'timeout', error: err.message || 'Timed out' });
              break;
            case 2:
            default:
              done({ ok: false, status: 'error', error: err && err.message ? err.message : 'Position unavailable' });
          }
        },
        {
          enableHighAccuracy: Boolean(enableHighAccuracy),
          timeout: Math.max(1000, Math.min(60_000, Number(timeoutMs) || GEOLOCATION_TIMEOUT_MS)),
          maximumAge: Math.max(0, Number(maximumAgeMs) || MAX_AGE_MS)
        }
      );
    } catch (err) {
      done({
        ok: false,
        status: 'error',
        error: err && err.message ? err.message : 'Unexpected error requesting geolocation'
      });
    }

    // Hard safety timeout: browsers sometimes fail to honour timeout on
    // permission-prompt races. This wait is long-ish (up to 20s) to give
    // users time to accept the dialog.
    window.setTimeout(() => {
      done({ ok: false, status: 'timeout', error: 'Safety timeout exceeded' });
    }, Math.min(20_000, Math.max(10_000, Number(timeoutMs) * 2.5)));
  });

  IN_FLIGHT.set(flightKey, { promise, ts: Date.now() });
  return promise;
}

/**
 * Best-effort two-stage position request.
 *
 * 1. Start a coarse, fast query first (low power, returns within ~8s).
 * 2. If coarse result is within `acceptIfWithinMeters` → return immediately.
 * 3. Otherwise, kick off a high-accuracy pass (keeps GPS on longer; may
 *    prompt the user a second time if coarse only gave us a cell-tower
 *    fix). Returns whichever result is better when both settle.
 *
 * Intended for QR landing / geofence entry: "get a good-enough location
 * fast; upgrade only if it matters."
 */
export async function requestCurrentPositionWithFallback({
  acceptIfWithinMeters = 250,
  coarseTimeoutMs = 8000,
  highAccuracyTimeoutMs = 14000,
  maximumAgeMs = MAX_AGE_MS,
  dedupeKey = 'fallback'
} = {}) {
  if (!isGeolocationSupported()) {
    return { ok: false, status: 'unsupported' };
  }

  const coarse = await requestCurrentPosition({
    enableHighAccuracy: false,
    timeoutMs: coarseTimeoutMs,
    maximumAgeMs,
    dedupeKey
  });

  // Fast path: permission was denied or unsupported — no point upgrading
  if (coarse.status === 'denied' || coarse.status === 'unsupported') return coarse;

  // Fast path: coarse success
  if (coarse.ok && coarse.coords) {
    const accuracy = Number(coarse.coords.accuracy);
    const acceptable =
      !Number.isFinite(acceptIfWithinMeters) ||
      !Number.isFinite(accuracy) ||
      accuracy <= Math.max(20, Number(acceptIfWithinMeters));
    if (acceptable) return coarse;
  }

  // Upgrade path: coarse is too fuzzy OR timed out, and we still have the
  // user's attention. Try high accuracy with a longer bound.
  const accurate = await requestCurrentPosition({
    enableHighAccuracy: true,
    timeoutMs: highAccuracyTimeoutMs,
    maximumAgeMs: 0, // do not cache a coarse cell-tower result
    dedupeKey: `${dedupeKey}:high`
  });

  if (accurate.ok) return accurate;
  // Fall back to coarse if the upgraded call didn't produce anything
  // usable. Prefer a coarse-but-present location over nothing (the
  // geofence gate still runs with the actual distance calculation).
  if (coarse.ok) return coarse;
  return accurate;
}

export { roundToDecimals, clampAndRoundCoords };

/**
 * Straight GPS high-accuracy request used in the "upgrade from coarse" flow
 * when the backend returns suggest_high_accuracy on OUTSIDE_RADIUS.
 *
 * Longer timeout than the coarse lookup (we want to give the GPS chip time
 * to settle — 14s) and forces a fresh read (no maximumAge).
 */
export function requestHighAccuracyPosition({
  timeoutMs = 14000,
  dedupeKey = 'highAccuracy'
} = {}) {
  return requestCurrentPosition({
    enableHighAccuracy: true,
    timeoutMs,
    maximumAgeMs: 0,
    dedupeKey
  });
}
