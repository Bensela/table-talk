const request = require('supertest');
const app = require('../../index');
const db = require('../../db');

jest.mock('../../db', () => ({
  query: jest.fn()
}));

describe('API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      // Mock db response for existing session check (none found)
      db.query.mockResolvedValueOnce({ rows: [] });
      
      // Mock db response for insert
      const mockSession = { 
        session_id: 'uuid-123', 
        table_id: '123',
        expires_at: new Date().toISOString()
      };
      db.query.mockResolvedValueOnce({ rows: [mockSession] });
      // Mock db response for analytics insert
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/sessions')
        .send({ table_id: '123' });

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(mockSession);
    });

    it('should return existing session if valid', async () => {
      const mockSession = { 
        session_id: 'uuid-existing', 
        table_id: '123' 
      };
      
      // Mock db response finding existing session
      db.query.mockResolvedValueOnce({ rows: [mockSession] });

      const res = await request(app)
        .post('/api/sessions')
        .send({ table_id: '123' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(mockSession);
    });

    it('should return 400 if table_id missing', async () => {
      const res = await request(app).post('/api/sessions').send({});
      expect(res.statusCode).toBe(400);
    });
  });
});
