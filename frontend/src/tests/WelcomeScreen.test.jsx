import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import WelcomeScreen from '../pages/WelcomeScreen';
import * as api from '../api';

// Mock API module
vi.mock('../api', () => ({
  getSessionByTable: vi.fn(),
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}));

describe('WelcomeScreen Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to context selection if no active session', async () => {
    api.getSessionByTable.mockRejectedValue({ response: { status: 404 } });
    
    // Mock navigate
    const mockedNavigate = vi.fn();
    
    // We need to test the effect of navigation. 
    // Since we are using MemoryRouter, we can check if the new route is rendered.
    // Or we can mock `useNavigate`.
    // Let's use real router behavior.

    render(
      <MemoryRouter initialEntries={['/t/table1']}>
        <Routes>
          <Route path="/t/:tableToken" element={<WelcomeScreen />} />
          <Route path="/t/:tableToken/context" element={<div>Context Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    const continueBtn = screen.getByText('Continue');
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(screen.getByText('Context Page')).toBeInTheDocument();
    });
  });

  it('navigates to game if active session exists', async () => {
    api.getSessionByTable.mockResolvedValue({ 
      data: { session_id: 'sess123' } 
    });

    render(
      <MemoryRouter initialEntries={['/t/table1']}>
        <Routes>
          <Route path="/t/:tableToken" element={<WelcomeScreen />} />
          <Route path="/session/:sessionId/game" element={<div>Game Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    const continueBtn = screen.getByText('Continue');
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(screen.getByText('Game Page')).toBeInTheDocument();
    });
  });
});
