/**
 * Geofence helper using the haversine formula to compute the great-circle
 * distance between two (lat, lng) points on Earth in meters.
 *
 * Accuracy is ~0.5% which is more than sufficient for in-restaurant
 * proximity checks (typical radius 50–200m).
 */

const EARTH_RADIUS_METERS = 6371008.8;
const COORD_DECIMALS = 6;
const GEO_CACHE_TTL_MS = 15_000;
const GEO_CACHE_MAX_ENTRIES = 200;

/** In-memory slug → geo row soft TTL cache. Bounded by LRU eviction. */
const geoCache = new Map();

function _evictCacheIfNeeded() {
  if (geoCache.size <= GEO_CACHE_MAX_ENTRIES) return;
  // LRU: remove oldest (first inserted / first key returned by iterator)
  const oldestKey = geoCache.keys().next().value;
  if (oldestKey != null) geoCache.delete(oldestKey);
}

function getCachedRestaurantGeo(slug) {
  if (!slug) return null;
  const entry = geoCache.get(String(slug));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    geoCache.delete(String(slug));
    return null;
  }
  return entry.value;
}

function setCachedRestaurantGeo(slug, value) {
  if (!slug || value == null) return;
  const key = String(slug);
  geoCache.delete(key);
  geoCache.set(key, {
    expiresAt: Date.now() + GEO_CACHE_TTL_MS,
    value
  });
  _evictCacheIfNeeded();
}

function invalidateCachedRestaurantGeo(slug) {
  if (!slug) return;
  geoCache.delete(String(slug));
}

function toRadians(deg) {
  return (Number(deg) * Math.PI) / 180;
}

/**
 * Rough bounding-box short-circuit using approximate per-degree meters.
 * Returns true if the client is *definitely* outside the radius;
 * returns false if it could be inside (and we need a real haversine call).
 *
 * At the equator, 1 deg ≈ 111320m. For 1 deg of longitude at lat L, multiply
 * by cos(L). Conservative: use the worst-case cos(0) = 1 for longitude.
 */
function definitelyOutsideBoundingBox(lat1, lng1, lat2, lng2, radiusMeters) {
  const R = Math.max(0, Number(radiusMeters) || 0);
  const degreesLat = R / 110574; // ~meters per degree latitude
  const degreesLng = R / 111320;  // worst case equator
  const dLat = Math.abs(Number(lat1) - Number(lat2));
  const dLng = Math.abs(Number(lng1) - Number(lng2));
  if (dLat > degreesLat) return true;
  if (dLng > degreesLng) return true;
  return false;
}

function clampCoordinate(value, min, max, decimals = COORD_DECIMALS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(Math.max(n, min), max);
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

/**
 * @param {number|null|undefined} lat1
 * @param {number|null|undefined} lng1
 * @param {number|null|undefined} lat2
 * @param {number|null|undefined} lng2
 * @returns {number|null} great-circle distance in meters; null if any input is invalid
 */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const aLat = clampCoordinate(lat1, -90, 90);
  const aLng = clampCoordinate(lng1, -180, 180);
  const bLat = clampCoordinate(lat2, -90, 90);
  const bLng = clampCoordinate(lng2, -180, 180);
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;

  // Fast short-circuit: if points are more than R-meters apart in lat or lng
  // degrees (using a generous per-degree meter value), we can skip the trig.
  // Haversine is called without the radius in general, so this is an optional
  // exposed helper. Below the general-purpose calculation still runs.

  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const latARad = toRadians(aLat);
  const latBRad = toRadians(bLat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latARad) * Math.cos(latBRad) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 100) / 100;
}

/**
 * Evaluate whether the client coordinates fall within the configured
 * geofence of a restaurant.
 *
 * Policy:
 *   - If either side lacks coordinates (lat/lng is null on the restaurant
 *     or the caller did not supply client_lat/client_lng), the result is
 *     { requires_geolocation: true, inside: null, distance_m: null }.
 *     The caller decides if this is passable.
 *   - Otherwise returns { inside: true/false, distance_m, radius_m,
 *     suggest_high_accuracy: bool }. suggest_high_accuracy=true signals
 *     to the frontend that distance is large enough (>2× radius, or
 *     absolute distance >500m) that a stale cell-tower / IP-derived fix
 *     is likely, and a GPS high-accuracy retry should be run before
 *     failing closed on the end user.
 *
 * Options:
 *   - effectiveRadiusOverride: when provided (non-negative, meters), use
 *     the MAX of this value and restaurant.radius. Used for known-bad
 *     accuracy environments (localhost, http:) where the GPS chip is
 *     unavailable and IP lookups are ± several km.
 */
function evaluateGeofence(restaurant = {}, clientLat, clientLng, { effectiveRadiusOverride } = {}) {
  const radiusMetersRaw = restaurant.geofence_radius_meters;
  const baseRadius = Number.isFinite(Number(radiusMetersRaw))
    ? Math.max(25, Math.min(5000, Math.floor(Number(radiusMetersRaw))))
    : 100;
  const overrideRadius =
    Number.isFinite(Number(effectiveRadiusOverride)) && Number(effectiveRadiusOverride) >= 0
      ? Math.floor(Number(effectiveRadiusOverride))
      : null;
  const radiusMeters = overrideRadius != null
    ? Math.max(baseRadius, overrideRadius)
    : baseRadius;
  const radiusOverridden = overrideRadius != null && overrideRadius > baseRadius;

  const rLatRaw = restaurant.latitude;
  const rLngRaw = restaurant.longitude;
  const restaurantHasCoords =
    rLatRaw != null && rLngRaw != null &&
    Number.isFinite(Number(rLatRaw)) &&
    Number.isFinite(Number(rLngRaw));

  const cLatRaw = clientLat;
  const cLngRaw = clientLng;
  const clientHasCoords =
    cLatRaw != null && cLngRaw != null &&
    Number.isFinite(Number(cLatRaw)) &&
    Number.isFinite(Number(cLngRaw));

  if (!restaurantHasCoords || !clientHasCoords) {
    return {
      requires_geolocation: true,
      inside: null,
      distance_m: null,
      radius_m: radiusMeters,
      configured_radius_m: baseRadius,
      radius_overridden: radiusOverridden,
      suggest_high_accuracy: false,
      restaurant_coords_present: restaurantHasCoords,
      client_coords_present: clientHasCoords
    };
  }

  const rLat = clampCoordinate(rLatRaw, -90, 90);
  const rLng = clampCoordinate(rLngRaw, -180, 180);
  const cLat = clampCoordinate(cLatRaw, -90, 90);
  const cLng = clampCoordinate(cLngRaw, -180, 180);

  if (rLat == null || rLng == null || cLat == null || cLng == null) {
    return {
      requires_geolocation: true,
      inside: null,
      distance_m: null,
      radius_m: radiusMeters,
      configured_radius_m: baseRadius,
      radius_overridden: radiusOverridden,
      suggest_high_accuracy: false,
      restaurant_coords_present: false,
      client_coords_present: false
    };
  }

  const distanceMeters = haversineDistanceMeters(rLat, rLng, cLat, cLng);

  if (distanceMeters == null) {
    return {
      requires_geolocation: true,
      inside: null,
      distance_m: null,
      radius_m: radiusMeters,
      configured_radius_m: baseRadius,
      radius_overridden: radiusOverridden,
      suggest_high_accuracy: false,
      restaurant_coords_present: true,
      client_coords_present: true
    };
  }

  const roundedDistance = Math.round(distanceMeters);
  const inside = roundedDistance <= radiusMeters;
  // Safety net: IP / coarse cell-tower fixes typically report "50-100m
  // accuracy" while actually being miles from the restaurant. When the
  // computed distance is far enough outside the radius we instruct the
  // frontend to upgrade to GPS high-accuracy *once* before showing the
  // "Please visit us in person" block. Thresholds:
  //   - small configured radius (<250m): distance > 500m OR >2× BASE radius
  //     (not the overridden one — an overridden localhost radius should
  //     never trigger the upgrade suggestion).
  //   - large configured radius (≥250m): distance > configured + 500m
  const suggestHighAccuracy = inside || radiusOverridden
    ? false
    : baseRadius < 250
      ? roundedDistance > Math.max(500, baseRadius * 2)
      : roundedDistance > baseRadius + 500;

  return {
    requires_geolocation: false,
    inside,
    distance_m: roundedDistance,
    radius_m: radiusMeters,
    configured_radius_m: baseRadius,
    radius_overridden: radiusOverridden,
    suggest_high_accuracy: suggestHighAccuracy,
    restaurant_coords_present: true,
    client_coords_present: true
  };
}

module.exports = {
  haversineDistanceMeters,
  evaluateGeofence,
  definitelyOutsideBoundingBox,
  clampCoordinate,
  getCachedRestaurantGeo,
  setCachedRestaurantGeo,
  invalidateCachedRestaurantGeo
};
