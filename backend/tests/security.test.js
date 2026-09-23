const request = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn()
}));

const db = require('../db');
const app = require('../index');

describe('Security & Isolation Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    db.query.mockImplementation((text, params) => {
      if (
        text &&
        text.includes('FROM restaurants') &&
        text.includes('billing_status') &&
        text.includes('WHERE slug = $1')
      ) {
        return Promise.resolve({
          rows: [{
            id: 'd0000000-0000-0000-0000-000000000000',
            slug: params?.[0] || 'security-test',
            name: 'Security Test Restaurant',
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

      if (
        text &&
        text.includes('SELECT id FROM restaurants')
      ) {
        return Promise.resolve({
          rows: [{
            id: 'd0000000-0000-0000-0000-000000000000'
          }]
        });
      }

      if (
        text &&
        text.includes('FROM deck_sessions')
      ) {
        return Promise.resolve({ rows: [] });
      }

      if (
        text &&
        text.includes('INSERT INTO deck_sessions')
      ) {
        return Promise.resolve({
          rows: [{
            deck_session_id: 'deck-security-test',
            position_index: 0
          }]
        });
      }

      if (
        text &&
        text.includes('INSERT INTO sessions')
      ) {
        return Promise.resolve({
          rows: [{
            session_id: params[0],
            table_token: params[1],
            restaurant_id: params[2],
            context: params[3],
            mode: params[4],
            session_group_id: params[5],
            expires_at: params[9]
          }]
        });
      }

      return Promise.resolve({ rows: [], rowCount: 1 });
    });
  });

  describe('Session Group Isolation', () => {
    test('Two groups at same restaurant table get different session_group_ids', async () => {
      const payload = {
        restaurant_slug: 'security-test',
        table_token: 'table_sec_test',
        context: 'Exploring',
        mode: 'single-phone'
      };

      const resA = await request(app)
        .post('/sessions')
        .send(payload);

      expect(resA.status).toBe(201);

      const resB = await request(app)
        .post('/sessions')
        .send(payload);

      expect(resB.status).toBe(201);

      expect(resA.body.session_group_id).toBeDefined();
      expect(resB.body.session_group_id).toBeDefined();

      expect(resA.body.session_group_id)
        .not.toBe(resB.body.session_group_id);

      const sessionInsertCalls = db.query.mock.calls.filter(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO sessions')
      );

      expect(sessionInsertCalls).toHaveLength(2);

      expect(sessionInsertCalls[0][1][5])
        .not.toBe(sessionInsertCalls[1][1][5]);
    });
  });
});
