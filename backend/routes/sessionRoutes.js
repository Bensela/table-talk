const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const questionController = require('../controllers/questionController');
const { joinRateLimiter } = require('../middleware/rateLimiter');
const { resolveRestaurant } = require('../middleware/resolveRestaurant');

router.post('/', resolveRestaurant, sessionController.createSession);
router.post('/join-dual', joinRateLimiter, resolveRestaurant, sessionController.joinDualPhoneSession);
router.post('/resolve', resolveRestaurant, sessionController.resolveSession);
router.post('/resume-by-qr', resolveRestaurant, sessionController.resumeSessionByQr);
router.get('/:session_id', sessionController.getSession);
router.get('/:session_id/state', sessionController.getSessionState); // Add state route
router.post('/:session_id/heartbeat', sessionController.heartbeat); // Add heartbeat route
router.get('/by-table/:table_token', sessionController.getSessionByTable);
router.patch('/:session_id', sessionController.updateSession);
router.delete('/:session_id', sessionController.endSession);
router.post('/:session_id/fresh_intent', sessionController.freshIntent);
router.post('/:session_id/upgrade', sessionController.upgradeToDual);

// Question routes
router.get('/:session_id/questions/current', questionController.getCurrentQuestion);
router.post('/:session_id/questions/next', questionController.nextQuestion);
router.post('/:session_id/answer/reveal', questionController.revealAnswer);

module.exports = router;
