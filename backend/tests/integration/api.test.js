const request = require('supertest');
const app = require('../../index');
const db = require('../../db');

jest.mock('../../db', () => {
  const mockQuery = jest.fn((text, params) => {
    if (
      text &&
      text.includes('FROM restaurants') &&
      text.includes('billing_status') &&
      text.includes('WHERE slug = $1')
    ) {
      return Promise.resolve({
        rows: [{
          id: 'd0000000-0000-0000-0000-000000000000',
          slug: params?.[0] || 'test-cafe',
          name: 'Test Cafe',
          billing_status: 'active',
          contact_email: null,
          contact_phone: null,
          address: null,
          latitude: null,
          longitude: null,
          manager_name: null
        }]
      });
    }
    if (text && text.includes('SELECT id FROM restaurants')) {
      return Promise.resolve({ rows: [{ id: 'd0000000-0000-0000-0000-000000000000' }] });
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

describe('API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query._queue = [];
  });

  describe('GET /health', () => {
    it('should return 200 OK', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      // Mock db response for insert
      const mockSession = { 
        session_id: 'uuid-123', 
        restaurant_id: 'd0000000-0000-0000-0000-000000000000',
        table_token: '123',
        expires_at: new Date().toISOString()
      };
      db.query.mockResolvedValueOnce({ rows: [mockSession] });
      // Mock db response for analytics insert
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/sessions')
        .send({
          table_token: '123',
          restaurant_slug: 'test-cafe',
          context: 'Exploring',
          mode: 'single-phone'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.session_id).toBe('uuid-123');
      expect(res.body.table_token).toBe('123');
      expect(res.body).toHaveProperty('participant_id');
      expect(res.body).toHaveProperty('participant_token');
    });


    it('should return 400 if table_token missing', async () => {
      const res = await request(app).post('/api/sessions').send({ restaurant_slug: 'test-cafe' });
      expect(res.statusCode).toBe(400);
    });
  });
});
