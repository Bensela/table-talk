const request = require('supertest');
const app = require('../../index');
const db = require('../../db');

jest.mock('../../db', () => {
  const mockQuery = jest.fn();
  return {
    query: mockQuery
  };
});

describe('Public Handshake Endpoint', () => {
  const originalGuestGeofenceEnabled =
    process.env.GUEST_GEOFENCE_ENABLED;

  const makeActiveRestaurant = (slug) => ({
    id: `r-${slug}`,
    name: 'Test Cafe',
    slug,
    billing_status: 'active',
    latitude: 40.7128,
    longitude: -74.0060,
    geofence_radius_meters: 100
  });

  const mockTable = {
    id: 't-123',
    table_number: '5'
  };

  function mockValidRestaurantAndTable(restaurant) {
    db.query
      .mockResolvedValueOnce({ rows: [restaurant] })
      .mockResolvedValueOnce({ rows: [mockTable] });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GUEST_GEOFENCE_ENABLED;
  });

  afterAll(() => {
    if (originalGuestGeofenceEnabled === undefined) {
      delete process.env.GUEST_GEOFENCE_ENABLED;
    } else {
      process.env.GUEST_GEOFENCE_ENABLED =
        originalGuestGeofenceEnabled;
    }
  });

  it('should return 400 if slug or table query parameter is missing', async () => {
    const res = await request(app).get(
      '/api/public/handshake'
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should return 404 if restaurant slug is not found', async () => {
    db.query.mockResolvedValueOnce({
      rows: []
    });

    const res = await request(app).get(
      '/api/public/handshake?slug=missing-restaurant&table=1'
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty(
      'error',
      'Restaurant not found'
    );
  });

  it('should return 403 if restaurant billing_status is suspended', async () => {
    const mockRestaurant = {
      id: 'r-billing-suspended',
      name: 'Test Cafe',
      slug: 'billing-suspended',
      billing_status: 'suspended'
    };

    db.query.mockResolvedValueOnce({
      rows: [mockRestaurant]
    });

    const res = await request(app).get(
      '/api/public/handshake?slug=billing-suspended&table=1'
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toHaveProperty(
      'error',
      'Service is temporarily undergoing maintenance'
    );
  });

  it('should return 404 if table number does not exist for restaurant', async () => {
    const restaurant =
      makeActiveRestaurant('table-missing');

    db.query
      .mockResolvedValueOnce({
        rows: [restaurant]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const res = await request(app).get(
      '/api/public/handshake?slug=table-missing&table=99'
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty(
      'error',
      'Table not registered'
    );
  });

  it('should default guest geofencing OFF and succeed without coordinates', async () => {
    const restaurant =
      makeActiveRestaurant('geo-default-off');

    mockValidRestaurantAndTable(restaurant);

    const res = await request(app).get(
      '/api/public/handshake?slug=geo-default-off&table=5'
    );

    expect(res.statusCode).toBe(200);

    expect(res.body).toHaveProperty(
      'restaurant_name',
      'Test Cafe'
    );

    expect(res.body).toHaveProperty(
      'restaurant_slug',
      'geo-default-off'
    );

    expect(res.body).toHaveProperty(
      'table_number',
      '5'
    );

    expect(res.body).toHaveProperty(
      'session_token'
    );

    expect(res.body).toHaveProperty(
      'branding'
    );

    expect(res.body.features).toEqual({
      guest_geofence_enabled: false
    });

    expect(res.body.geofence).toMatchObject({
      requires_geolocation: false,
      inside: true,
      distance_m: null
    });
  });

  it('should not reject denied geolocation while guest geofencing is OFF', async () => {
    process.env.GUEST_GEOFENCE_ENABLED = 'false';

    const restaurant =
      makeActiveRestaurant('geo-denied-off');

    mockValidRestaurantAndTable(restaurant);

    const res = await request(app).get(
      '/api/public/handshake?slug=geo-denied-off&table=5&geolocation_status=denied'
    );

    expect(res.statusCode).toBe(200);

    expect(
      res.body.features.guest_geofence_enabled
    ).toBe(false);

    expect(
      res.body.geofence.requires_geolocation
    ).toBe(false);
  });

  it('should ignore outside coordinates while guest geofencing is OFF', async () => {
    process.env.GUEST_GEOFENCE_ENABLED = 'false';

    const restaurant =
      makeActiveRestaurant('geo-outside-off');

    mockValidRestaurantAndTable(restaurant);

    const res = await request(app).get(
      '/api/public/handshake?slug=geo-outside-off&table=5&client_lat=0&client_lng=0&geolocation_status=granted'
    );

    expect(res.statusCode).toBe(200);

    expect(
      res.body.features.guest_geofence_enabled
    ).toBe(false);

    expect(
      res.body.geofence.inside
    ).toBe(true);

    expect(
      res.body.geofence.distance_m
    ).toBeNull();
  });

  it('should ignore an invalid legacy temp-access token while guest geofencing is OFF', async () => {
    process.env.GUEST_GEOFENCE_ENABLED = 'false';

    const restaurant =
      makeActiveRestaurant('geo-token-off');

    mockValidRestaurantAndTable(restaurant);

    const res = await request(app)
      .get(
        '/api/public/handshake?slug=geo-token-off&table=5'
      )
      .set(
        'Authorization',
        'Bearer definitely-not-a-valid-jwt'
      );

    expect(res.statusCode).toBe(200);

    expect(
      res.body.features.guest_geofence_enabled
    ).toBe(false);
  });

  it('should preserve location-denied rejection when guest geofencing is ON', async () => {
    process.env.GUEST_GEOFENCE_ENABLED = 'true';

    const restaurant =
      makeActiveRestaurant('geo-denied-on');

    db.query.mockResolvedValueOnce({
      rows: [restaurant]
    });

    const res = await request(app).get(
      '/api/public/handshake?slug=geo-denied-on&table=5&geolocation_status=denied'
    );

    expect(res.statusCode).toBe(403);

    expect(res.body).toHaveProperty(
      'geofence_code',
      'LOCATION_PERMISSION_DENIED'
    );
  });

  it('should reject clearly outside coordinates when guest geofencing is ON', async () => {
    process.env.GUEST_GEOFENCE_ENABLED = 'true';

    const restaurant =
      makeActiveRestaurant('geo-outside-on');

    db.query.mockResolvedValueOnce({
      rows: [restaurant]
    });

    const res = await request(app).get(
      '/api/public/handshake?slug=geo-outside-on&table=5&client_lat=0&client_lng=0&geolocation_status=granted'
    );

    expect(res.statusCode).toBe(403);

    expect(res.body).toHaveProperty(
      'geofence_code',
      'OUTSIDE_RADIUS'
    );
  });

  it('should succeed with in-radius coordinates when guest geofencing is ON', async () => {
    process.env.GUEST_GEOFENCE_ENABLED = 'true';

    const restaurant =
      makeActiveRestaurant('geo-inside-on');

    mockValidRestaurantAndTable(restaurant);

    const res = await request(app).get(
      '/api/public/handshake?slug=geo-inside-on&table=5&client_lat=40.7128&client_lng=-74.0060&geolocation_status=granted'
    );

    expect(res.statusCode).toBe(200);

    expect(
      res.body.features.guest_geofence_enabled
    ).toBe(true);

    expect(
      res.body.geofence.requires_geolocation
    ).toBe(false);

    expect(
      res.body.geofence.inside
    ).toBe(true);
  });
});