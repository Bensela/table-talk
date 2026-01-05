import express from 'express';
import * as sessionService from '../services/sessionService.js';

const router = express.Router();

// Create a new session
router.post('/', (req, res) => {
  const session = sessionService.createSession();
  res.status(201).json(session);
});

// Get session state
router.get('/:id', (req, res) => {
  const session = sessionService.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

// Set mode
router.post('/:id/mode', (req, res) => {
  try {
    const { mode } = req.body;
    const session = sessionService.setMode(req.params.id, mode);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reveal question
router.post('/:id/reveal', (req, res) => {
  const session = sessionService.revealQuestion(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

// Next question
router.post('/:id/next', (req, res) => {
  try {
    const session = sessionService.nextQuestion(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;