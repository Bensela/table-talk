import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const sessionApi = {
  createSession: async () => {
    const response = await apiClient.post('/sessions');
    return response.data;
  },
  getSession: async (sessionId: string) => {
    const response = await apiClient.get(`/sessions/${sessionId}`);
    return response.data;
  },
  setMode: async (sessionId: string, mode: 'single_phone' | 'dual_phone') => {
    const response = await apiClient.post(`/sessions/${sessionId}/mode`, { mode });
    return response.data;
  },
  revealQuestion: async (sessionId: string) => {
    const response = await apiClient.post(`/sessions/${sessionId}/reveal`);
    return response.data;
  },
  nextQuestion: async (sessionId: string) => {
    const response = await apiClient.post(`/sessions/${sessionId}/next`);
    return response.data;
  },
};
