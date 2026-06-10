const request = require('supertest');
const app = require('../../index');
const db = require('../../db');

jest.mock('../../db', () => {
  const mockQuery = jest.fn((text, params) => {
    if (text && text.includes('SELECT id FROM restaurants')) {
      return Promise.resolve({ rows: [{ id: 'r1-uuid', slug: 'test-restaurant' }] });
    }
    if (text && text.includes('SELECT * FROM deck_sessions')) {
      return Promise.resolve({ rows: [{ deck_context_id: 'd1' }] });
    }
    const nextMock = mockQuery._queue.shift();
    if (nextMock) return nextMock;
    return Promise.resolve({ rows: [] });
  });
  mockQuery._queue = [];
  mockQuery.mockResolvedValueOnce = (val) => {
    mockQuery._queue.push(Promise.resolve(val));
    return mockQuery;
  };
  mockQuery.mockResolvedValue = (val) => {
    mockQuery._queue = [Promise.resolve(val)];
    return mockQuery;
  };
  return {
    query: mockQuery
  };
});

describe('Multi-Tenancy Isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query._queue = [];
  });

  it('should resolve restaurant by slug and create session', async () => {
    const mockRestaurant = { id: 'r1-uuid', slug: 'test-restaurant' };
    const mockSession = { session_id: 's1', restaurant_id: 'r1-uuid', table_token: 't1' };

    // 2. Insert session query
    db.query.mockResolvedValueOnce({ rows: [mockSession] });
    // 3. Analytics query
    db.query.mockResolvedValueOnce({ rows: [] });
    // 4. Participant insert query
    db.query.mockResolvedValueOnce({ rows: [] });
    // 5. Analytics query 2
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/sessions')
      .send({ table_token: 't1', restaurant_slug: 'test-restaurant', context: 'Exploring', mode: 'single-phone' });

    expect(res.statusCode).toBe(201);
    expect(res.body.restaurant_id).toBe('r1-uuid');
  });
});
