const axios = require('axios');

const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const geocodeCache = new Map();

const COUNTRY_ALIASES = new Map([
  ['etats-unis', 'United States'],
  ['etats unis', 'United States'],
  ['etat-unis', 'United States'],
  ['usa', 'United States'],
  ['u.s.a.', 'United States'],
  ['u.s.', 'United States'],
  ['united states of america', 'United States'],
  ['us', 'United States'],
  ['uk', 'United Kingdom'],
  ['u.k.', 'United Kingdom']
]);

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function removeDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeAddress(address) {
  let normalized = normalizeWhitespace(address);
  if (!normalized) {
    return '';
  }

  normalized = normalized
    .split(',')
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
    .map((part) => {
      const asciiPart = removeDiacritics(part).toLowerCase();
      return COUNTRY_ALIASES.get(asciiPart) || part;
    })
    .join(', ');

  return normalized;
}

function createCacheKey(address) {
  return removeDiacritics(normalizeAddress(address)).toLowerCase();
}

function getCachedGeocode(cacheKey) {
  const cached = geocodeCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    geocodeCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function setCachedGeocode(cacheKey, value) {
  geocodeCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

function isUsAddress(address) {
  const ascii = removeDiacritics(address).toUpperCase();
  return /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/.test(ascii)
    || /\b\d{5}(?:-\d{4})?\b/.test(ascii)
    || /\bUNITED STATES\b/.test(ascii);
}

async function requestGeocoder(url, params, extraHeaders = {}) {
  return axios.get(url, {
    params,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': 'Table-Talk/1.0 (restaurant-geocoding)',
      ...extraHeaders
    }
  });
}

function parseCoordinates(latitude, longitude) {
  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { latitude: lat, longitude: lng };
}

async function geocodeWithUsCensus(address) {
  const response = await requestGeocoder(
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
    {
      address,
      benchmark: 'Public_AR_Current',
      format: 'json'
    }
  );

  const match = response?.data?.result?.addressMatches?.[0];
  if (!match?.coordinates) {
    return null;
  }

  return parseCoordinates(match.coordinates.y, match.coordinates.x);
}

async function geocodeWithNominatim(address, countryCode) {
  const response = await requestGeocoder(
    'https://nominatim.openstreetmap.org/search',
    {
      q: address,
      format: 'jsonv2',
      limit: 1,
      addressdetails: 1,
      countrycodes: countryCode || undefined
    },
    {
      'Accept-Language': 'en'
    }
  );

  const match = Array.isArray(response.data) ? response.data[0] : null;
  if (!match) {
    return null;
  }

  return parseCoordinates(match.lat, match.lon);
}

async function geocodeWithPhoton(address) {
  const response = await requestGeocoder(
    'https://photon.komoot.io/api/',
    {
      q: address,
      limit: 1
    }
  );

  const feature = Array.isArray(response?.data?.features) ? response.data.features[0] : null;
  const [longitude, latitude] = feature?.geometry?.coordinates || [];

  return parseCoordinates(latitude, longitude);
}

async function geocodeAddress(address) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    return null;
  }

  const cacheKey = createCacheKey(normalizedAddress);
  const cached = getCachedGeocode(cacheKey);
  if (cached) {
    return cached;
  }

  const countryCode = isUsAddress(normalizedAddress) ? 'us' : undefined;
  const providers = countryCode
    ? [
        ['us-census', () => geocodeWithUsCensus(normalizedAddress)],
        ['nominatim-us', () => geocodeWithNominatim(normalizedAddress, countryCode)],
        ['photon', () => geocodeWithPhoton(normalizedAddress)],
        ['nominatim-global', () => geocodeWithNominatim(normalizedAddress)]
      ]
    : [
        ['nominatim-global', () => geocodeWithNominatim(normalizedAddress)],
        ['photon', () => geocodeWithPhoton(normalizedAddress)]
      ];

  for (const [providerName, provider] of providers) {
    try {
      const result = await provider();
      if (result) {
        setCachedGeocode(cacheKey, result);
        return result;
      }
    } catch (error) {
      console.error(`[geocodeService] ${providerName} lookup failed:`, error.message);
    }
  }

  return null;
}

module.exports = {
  geocodeAddress,
  normalizeAddress
};
