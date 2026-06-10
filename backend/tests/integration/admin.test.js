const request = require('supertest');
const app = require('../../index');
const db = require('../../db');
const { signToken } = require('../../middleware/authMiddleware');

jest.mock('../../db', () => {
  const mockQuery = jest.fn();
  return {
    query: mockQuery
  };
});

describe('Admin API & RBAC Security & Data Isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const superAdminToken = signToken({
    id: 'u-super',
    email: 'superadmin@tabletalk.app',
    role: 'SUPER_ADMIN',
    restaurant_id: null
  });

  const restaurantAdminToken = signToken({
    id: 'u-tenant-1',
    email: 'admin1@restaurant.com',
    role: 'RESTAURANT_ADMIN',
    restaurant_id: 'r-tenant-1'
  });

  describe('POST /api/admin/login', () => {
    it('should authenticate user with valid credentials', async () => {
      const mockUser = {
        id: 'u-super',
        email: 'superadmin@tabletalk.app',
        // pbkdf2 hash corresponding to 'superadmin123' with salt 'salt123'
        password_hash: 'salt123.1000.3dd344d4cccc43ac3573926235b0c2abbd24e6f6c2c56188933fbd8048daf4679b3b817af24b0487b650214c3bee4dd30f49af7a77e636cc1f4807b36ef1373e',
        role: 'SUPER_ADMIN',
        restaurant_id: null,
        restaurant_name: null,
        restaurant_slug: null
      };

      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: 'superadmin@tabletalk.app', password: 'superadmin123' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.role).toBe('SUPER_ADMIN');
    });

    it('should return 401 with invalid password', async () => {
      const mockUser = {
        id: 'u-super',
        email: 'superadmin@tabletalk.app',
        password_hash: 'salt123.1000.3dd344d4cccc43ac3573926235b0c2abbd24e6f6c2c56188933fbd8048daf4679b3b817af24b0487b650214c3bee4dd30f49af7a77e636cc1f4807b36ef1373e',
        role: 'SUPER_ADMIN',
        restaurant_id: null
      };

      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: 'superadmin@tabletalk.app', password: 'wrongpassword' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('RBAC Role Restrictions', () => {
    it('should allow Super Admin to get tenants list', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'r1', name: 'Restaurant 1', slug: 'r1', billing_status: 'active' }] });

      const res = await request(app)
        .get('/api/admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body[0].name).toBe('Restaurant 1');
    });

    it('should deny Restaurant Admin from getting tenants list', async () => {
      const res = await request(app)
        .get('/api/admin/tenants')
        .set('Authorization', `Bearer ${restaurantAdminToken}`);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('Data Isolation and Restaurant Admin Controls', () => {
    it('should allow Restaurant Admin to view their own tables', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 't1', table_number: '5', qr_code_url: 'http://...' }] });

      const res = await request(app)
        .get('/api/tenant/tables')
        .set('Authorization', `Bearer ${restaurantAdminToken}`);

      expect(res.statusCode).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE restaurant_id = $1'),
        ['r-tenant-1']
      );
    });

    it('should generate table QR code referencing the correct slug when registering a table', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ slug: 'rest-slug-1' }] }) // Slug fetch
        .mockResolvedValueOnce({ rows: [{ id: 't-new', table_number: '12', qr_code_url: 'https://tabletalk.app/r/rest-slug-1?table=12' }] }); // Table insert

      const res = await request(app)
        .post('/api/tenant/tables')
        .set('Authorization', `Bearer ${restaurantAdminToken}`)
        .send({ table_number: '12' });

      expect(res.statusCode).toBe(201);
      expect(res.body.qr_code_url).toBe('https://tabletalk.app/r/rest-slug-1?table=12');
    });
  });
});
