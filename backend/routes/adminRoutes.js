const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireRole, verifyTenantAccess } = require('../middleware/authMiddleware');

// Public Login Endpoint
router.post('/login', adminController.login);

// Super Admin Route group
router.get('/tenants', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.getTenants);
router.post('/tenants', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.createTenant);
router.patch('/tenants/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.updateTenant);
router.patch('/questions/reshuffle', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.reshuffleGlobalQuestions);

// Restaurant Admin Route group
router.get('/billing', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.getTenantBilling);
router.patch('/profile', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.updateTenantProfile);
router.get('/tables', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.getTenantTables);
router.post('/qr', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.generateTenantQr);
router.patch('/tables/:id/qr', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.regenerateTableQr);
router.post('/tables', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.createTenantTable);

module.exports = router;
