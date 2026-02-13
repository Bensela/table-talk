const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const questionController = require('../controllers/questionController');
const { joinRateLimiter } = require('../middleware/rateLimiter');

router.post('/', sessionController.createSession);
router.post('/join-dual', joinRateLimiter, sessionController.joinDualPhoneSession);
router.get('/:session_id', sessionController.getSession);
router.get('/by-table/:table_token', sessionController.getSessionByTable);
router.patch('/:session_id', sessionController.updateSession);

// Question routes
router.get('/:session_id/questions/current', questionController.getCurrentQuestion);
router.post('/:session_id/questions/next', questionController.nextQuestion);
router.post('/:session_id/answer/reveal', questionController.revealAnswer);

module.exports = router;
