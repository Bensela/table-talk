const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

router.get('/handshake', publicController.handshake);
router.get('/restaurant-invites/:token', publicController.getRestaurantInvite);
router.post('/restaurant-invites/:token/complete', publicController.completeRestaurantInvite);

module.exports = router;
