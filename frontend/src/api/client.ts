import axios from 'axios';
import { Session } from '../types';

// Use environment variable for API URL in production
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const client = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const sessionApi = {
  createSession: async (): Promise<Session> => {
    const response = await client.post<Session>('/sessions');
    return response.data;
  },

  getSession: async (sessionId: string): Promise<Session> => {
    const response = await client.get<Session>(`/sessions/${sessionId}`);
    return response.data;
  },

  setMode: async (sessionId: string, mode: 'single_phone' | 'dual_phone'): Promise<Session> => {
    const response = await client.post<Session>(`/sessions/${sessionId}/mode`, { mode });
    return response.data;
  },

  revealQuestion: async (sessionId: string): Promise<Session> => {
    const response = await client.post<Session>(`/sessions/${sessionId}/reveal`);
    return response.data;
  },

  nextQuestion: async (sessionId: string): Promise<Session> => {
    const response = await client.post<Session>(`/sessions/${sessionId}/next`);
    return response.data;
  },
};
