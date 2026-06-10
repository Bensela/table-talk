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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if slug or table query parameter is missing', async () => {
    const res = await request(app).get('/api/public/handshake');
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should return 404 if restaurant slug is not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // Restaurant lookup returns empty

    const res = await request(app).get('/api/public/handshake?slug=invalid-slug&table=1');
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error', 'Restaurant not found');
  });

  it('should return 403 if restaurant billing_status is suspended', async () => {
    const mockRestaurant = {
      id: 'r-123',
      name: 'Test Cafe',
      slug: 'test-cafe',
      billing_status: 'suspended'
    };
    db.query.mockResolvedValueOnce({ rows: [mockRestaurant] });

    const res = await request(app).get('/api/public/handshake?slug=test-cafe&table=1');
    expect(res.statusCode).toBe(403);
    expect(res.body).toHaveProperty('error', 'Service is temporarily undergoing maintenance');
  });

  it('should return 404 if table number does not exist for restaurant', async () => {
    const mockRestaurant = {
      id: 'r-123',
      name: 'Test Cafe',
      slug: 'test-cafe',
      billing_status: 'active'
    };
    db.query
      .mockResolvedValueOnce({ rows: [mockRestaurant] }) // Restaurant lookup
      .mockResolvedValueOnce({ rows: [] }); // Table lookup returns empty

    const res = await request(app).get('/api/public/handshake?slug=test-cafe&table=99');
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error', 'Table not registered');
  });

  it('should return success payload and session token on valid handshake', async () => {
    const mockRestaurant = {
      id: 'r-123',
      name: 'Test Cafe',
      slug: 'test-cafe',
      billing_status: 'active'
    };
    const mockTable = {
      id: 't-123',
      table_number: '5'
    };
    db.query
      .mockResolvedValueOnce({ rows: [mockRestaurant] }) // Restaurant lookup
      .mockResolvedValueOnce({ rows: [mockTable] }); // Table lookup

    const res = await request(app).get('/api/public/handshake?slug=test-cafe&table=5');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('restaurant_name', 'Test Cafe');
    expect(res.body).toHaveProperty('restaurant_slug', 'test-cafe');
    expect(res.body).toHaveProperty('table_number', '5');
    expect(res.body).toHaveProperty('session_token');
    expect(res.body).toHaveProperty('branding');
  });
});
