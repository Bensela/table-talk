import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import api, { publicHandshake, preflightGeofence } from '../api';

const decodedQuery = (requestUrl) => new URL(requestUrl, 'http://placeholder.invalid').searchParams;

describe('QR handshake request encoding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const TABLE_NAMES = [
    'table1',
    'Table 1', // default Super Admin bulk-provisioning pattern ("Table {n}")
    'Table 10',
    'Café 3',
    'A&B #2',
    '100%'
  ];

  it.each(TABLE_NAMES)('sends table %j so the server decodes exactly the registered value', async (table) => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });

    await publicHandshake('panini-resraurant', table);

    const [requestUrl] = get.mock.calls[0];
    const params = decodedQuery(requestUrl);
    expect(params.get('table')).toBe(table);
    expect(params.get('slug')).toBe('panini-resraurant');
  });

  it('does not double-encode the restaurant slug', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });

    await publicHandshake('cafe & bar', '5');

    expect(decodedQuery(get.mock.calls[0][0]).get('slug')).toBe('cafe & bar');
  });

  it('geofence preflight encodes the slug once as well', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });

    await preflightGeofence('cafe & bar');

    expect(decodedQuery(get.mock.calls[0][0]).get('slug')).toBe('cafe & bar');
  });

  it('keeps optional handshake parameters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });

    await publicHandshake('default', 'Table 1', {
      location: { latitude: 1.5, longitude: 2.5, accuracy: 12.4 },
      geolocationStatus: 'granted',
      bypass: 'low_accuracy_device'
    });

    const params = decodedQuery(get.mock.calls[0][0]);
    expect(params.get('client_lat')).toBe('1.5');
    expect(params.get('client_lng')).toBe('2.5');
    expect(params.get('client_accuracy_m')).toBe('12');
    expect(params.get('geolocation_status')).toBe('granted');
    expect(params.get('bypass')).toBe('low_accuracy_device');
  });
});

describe('production API base parity', () => {
  it('defaults to same-origin /api outside dev, matching the backend /api route family', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'api', 'index.js'), 'utf8');
    expect(source).toMatch(/VITE_API_URL\s*\|\|\s*\(isDev\s*\?\s*'http:\/\/localhost:5000'\s*:\s*'\/api'\)/);
  });
});
