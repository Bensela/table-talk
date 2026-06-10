const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

router.get('/handshake', publicController.handshake);

module.exports = router;
