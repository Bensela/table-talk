const request = require('supertest');
const app = require('../../index'); // Assuming app is exported from index.js
const db = require('../../db');

jest.mock('../../db', () => {
  const mockQuery = jest.fn((text, params) => {
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

describe('Session Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query._queue = [];
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const mockSession = {
        session_id: 'sess1',
        table_token: 'table1',
        context: 'Exploring',
        mode: 'single-phone'
      };

      // 2. Check deck session (in createSession -> deckService.getDeckSession -> db.query)
      // This is tricky because createSession calls deckService which calls db.query.
      // We might need to mock deckService or mock db responses carefully.
      // createSession flow:
      // - Check active session (mocked above)
      // - getDeckSession -> check existing deck (mock below)
      // - Insert session (mock below)
      // - Insert analytics (mock below)

      db.query
        .mockResolvedValueOnce({ rows: [mockSession] }) // Insert Session
        .mockResolvedValueOnce({ rows: [] }); // Analytics

      const res = await request(app)
        .post('/api/sessions')
        .send({ table_token: 'table1', context: 'Exploring', mode: 'single-phone' });

      expect(res.statusCode).toBe(201);
      expect(res.body.session_id).toBe('sess1');
      expect(res.body.table_token).toBe('table1');
    });

  });

  describe('GET /api/sessions/:session_id', () => {
    it('should return session details', async () => {
      const mockSession = { session_id: 'sess1', table_token: 't1' };
      db.query.mockResolvedValueOnce({ rows: [mockSession] }); // Get Session
      // It also fetches position_index if context exists
      // Let's assume context is null for simplicity or mock it
      
      const res = await request(app).get('/api/sessions/sess1');
      expect(res.statusCode).toBe(200);
      expect(res.body.session_id).toBe('sess1');
    });

    it('should return 404 if not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/api/sessions/sess999');
      expect(res.statusCode).toBe(404);
    });
  });
});
