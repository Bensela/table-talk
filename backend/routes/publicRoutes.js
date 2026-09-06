const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

router.get('/handshake', publicController.handshake);
router.get('/geofence', publicController.preflightGeofence);
router.get('/restaurant-invites/:token', publicController.getRestaurantInvite);
router.post('/restaurant-invites/:token/complete', publicController.completeRestaurantInvite);
router.post('/events', publicController.postPublicEvent);
router.post('/temp-access', publicController.issueTempGeoAccess);

module.exports = router;
