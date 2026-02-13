const request = require('supertest');
const app = require('../index');
const db = require('../db');
const crypto = require('crypto');

describe('Security & Isolation Tests', () => {
  let tableToken = 'table_sec_test';
  
  beforeAll(async () => {
    // Setup clean state if needed
    await db.query('DELETE FROM sessions WHERE table_token = $1', [tableToken]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM sessions WHERE table_token = $1', [tableToken]);
    await db.pool.end(); // Close DB connection
  });

  describe('Join Code Security', () => {
    test('Rate limiting blocks after 5 attempts', async () => {
      // Note: This test depends on the rate limiter state. 
      // If run multiple times, it might fail if IP is already blocked.
      // Ideally we mock the rate limiter or use a fresh IP.
      // For this integration test, we assume a fresh start or reset.
      
      // Simulate 5 failed attempts
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/sessions/join-dual')
          .send({ table_token: tableToken, code: '000000' });
          
        // Either 403 (invalid code) or 429 (rate limited if we hit it already)
        expect([403, 429]).toContain(res.status);
      }

      // 6th attempt MUST be rate limited
      const res = await request(app)
        .post('/sessions/join-dual')
        .send({ table_token: tableToken, code: '000000' });
      
      expect(res.status).toBe(429);
    });
  });

  describe('Session Group Isolation', () => {
    test('Two groups at same table get different session_group_ids', async () => {
      // Group A
      const resA = await request(app)
        .post('/sessions')
        .send({ 
          table_token: tableToken, 
          context: 'Exploring',
          mode: 'single-phone'
        });
      expect(resA.status).toBe(201);
      const sessionA = resA.body;

      // Simulate Inactivity for Group A (force it to be "old" so next group is new)
      // Update last_activity_at to > 15 mins ago
      await db.query(`
        UPDATE sessions 
        SET last_activity_at = NOW() - INTERVAL '20 minutes' 
        WHERE session_id = $1
      `, [sessionA.session_id]);

      // Group B
      const resB = await request(app)
        .post('/sessions')
        .send({ 
          table_token: tableToken, 
          context: 'Exploring',
          mode: 'single-phone'
        });
      expect(resB.status).toBe(201);
      const sessionB = resB.body;

      // Verify Isolation
      expect(sessionA.session_group_id).toBeDefined();
      expect(sessionB.session_group_id).toBeDefined();
      expect(sessionA.session_group_id).not.toBe(sessionB.session_group_id);
    });
  });
});
