const request = require('supertest');
const app = require('../../index'); // Assuming app is exported from index.js
const db = require('../../db');

jest.mock('../../db');

describe('Session Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const mockSession = {
        session_id: 'sess1',
        table_token: 'table1',
        context: 'Exploring',
        mode: 'single-phone'
      };

      // 1. Check existing session (none)
      db.query.mockResolvedValueOnce({ rows: [] });
      // 2. Check deck session (in createSession -> deckService.getDeckSession -> db.query)
      // This is tricky because createSession calls deckService which calls db.query.
      // We might need to mock deckService or mock db responses carefully.
      // createSession flow:
      // - Check active session (mocked above)
      // - getDeckSession -> check existing deck (mock below)
      // - Insert session (mock below)
      // - Insert analytics (mock below)

      db.query
        .mockResolvedValueOnce({ rows: [] }) // getDeckSession (check existing)
        .mockResolvedValueOnce({ rows: [{ deck_context_id: 'd1' }] }) // getDeckSession (insert)
        .mockResolvedValueOnce({ rows: [mockSession] }) // Insert Session
        .mockResolvedValueOnce({ rows: [] }); // Analytics

      const res = await request(app)
        .post('/api/sessions')
        .send({ table_token: 'table1', context: 'Exploring', mode: 'single-phone' });

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(mockSession);
    });

    it('should return existing session if active', async () => {
      const mockExisting = { session_id: 'sess1', expires_at: new Date(Date.now() + 10000) };
      db.query.mockResolvedValueOnce({ rows: [mockExisting] });

      const res = await request(app)
        .post('/api/sessions')
        .send({ table_token: 'table1' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        ...mockExisting,
        expires_at: mockExisting.expires_at.toISOString()
      });
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
