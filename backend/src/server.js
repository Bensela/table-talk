import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import sessionRoutes from './routes/sessionRoutes.js';
import dotenv from 'dotenv';
import { setupSocket } from './services/socketService.js';
import { cleanupSessions } from './services/sessionService.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all for dev/MVP
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Pass io to routes via middleware or just use a service singleton
// A cleaner way is to have a socketService that exports a broadcast function
// But for now, we can attach io to req to use it in controllers if needed, 
// OR better: use the socketService to handle events and the controller calls the service which calls broadcast.
setupSocket(io);

// Routes
app.use('/api/sessions', sessionRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Cleanup interval (every minute)
setInterval(cleanupSessions, 60 * 1000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
