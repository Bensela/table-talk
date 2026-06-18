const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireRole, verifyTenantAccess } = require('../middleware/authMiddleware');

// Public Login Endpoint
router.post('/login', adminController.login);
router.post('/forgot-password', adminController.requestPasswordReset);
router.post('/reset-password', adminController.resetPassword);
router.post('/geocode-address', authenticateToken, requireRole(['SUPER_ADMIN', 'RESTAURANT_ADMIN']), adminController.geocodeRestaurantAddress);

// Super Admin Route group
router.get('/tenants', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.getTenants);
router.post('/tenants/invites', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.createTenantInvite);
router.post('/tenants', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.createTenant);
router.patch('/tenants/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.updateTenant);
router.delete('/tenants/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.deleteTenantPermanent);
router.get('/metrics/overview', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.getSuperAdminMetrics);
router.get('/questions', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.getGlobalQuestions);
router.post('/questions/import', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.importGlobalQuestions);
router.patch('/questions/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.updateGlobalQuestion);
router.delete('/questions/:id', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.deleteGlobalQuestion);
router.post('/questions/bulk-delete', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.bulkDeleteGlobalQuestions);
router.patch('/questions/reshuffle', authenticateToken, requireRole(['SUPER_ADMIN']), adminController.reshuffleGlobalQuestions);

// Restaurant Admin Route group
router.get('/billing', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.getTenantBilling);
router.patch('/profile', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.updateTenantProfile);
router.get('/tables', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.getTenantTables);
router.post('/qr', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.generateTenantQr);
router.patch('/tables/:id/qr', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.regenerateTableQr);
router.post('/tables', authenticateToken, requireRole(['RESTAURANT_ADMIN']), adminController.createTenantTable);

module.exports = router;
