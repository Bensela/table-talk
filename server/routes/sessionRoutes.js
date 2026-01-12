const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const questionController = require('../controllers/questionController');

router.post('/', sessionController.createSession);
router.get('/:session_id', sessionController.getSession);
router.patch('/:session_id', sessionController.updateSessionMode);

// Question routes
router.get('/:session_id/questions/current', questionController.getCurrentQuestion);
router.post('/:session_id/questions/next', questionController.nextQuestion);
router.post('/:session_id/answer/reveal', questionController.revealAnswer);

module.exports = router;
