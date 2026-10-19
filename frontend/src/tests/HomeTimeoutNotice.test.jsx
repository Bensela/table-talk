import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route, createMemoryRouter, RouterProvider } from 'react-router-dom';
import Home from '../pages/Home';

vi.mock('../hooks/useAnalytics', () => ({
  default: () => ({ firePublic: vi.fn(), fireSession: vi.fn(), trackPublic: vi.fn(), trackSession: vi.fn() })
}));

function renderHome(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Home — startup-stage timeout explanation', () => {
  it('shows no notice on an ordinary visit', () => {
    renderHome(undefined);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains a Context Selection timeout in friendly language', () => {
    renderHome({ timedOutStage: 'context' });
    expect(screen.getByRole('status')).toHaveTextContent(/scan the qr code again/i);
  });

  it('explains a Mode Selection timeout in friendly language', () => {
    renderHome({ timedOutStage: 'mode' });
    expect(screen.getByRole('status')).toHaveTextContent(/scan the qr code again/i);
  });

  it('is dismissible and does not block scanning', () => {
    renderHome({ timedOutStage: 'context' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Scan button is present and enabled regardless of the notice.
    expect(screen.getByText('Scan QR Code')).toBeEnabled();

    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Scan QR Code')).toBeEnabled();
  });

  it('ignores an unrecognized stage value', () => {
    renderHome({ timedOutStage: 'bogus' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  describe('retention: consuming the one-time navigation state', () => {
    function renderHomeWithDataRouter(state) {
      const router = createMemoryRouter(
        [
          { path: '/', element: <Home /> },
          { path: '/elsewhere', element: <div>Elsewhere</div> }
        ],
        { initialEntries: [{ pathname: '/', state }] }
      );
      const utils = render(<RouterProvider router={router} />);
      return { ...utils, router };
    }

    it('clears the history entry state right after showing the notice', async () => {
      const { router } = renderHomeWithDataRouter({ timedOutStage: 'context' });
      expect(screen.getByRole('status')).toBeInTheDocument();

      await waitFor(() => {
        expect(router.state.location.state).toBeNull();
      });
      // The already-displayed notice is unaffected by consuming the state.
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('does not resurrect the notice when the user leaves Home and returns via Back', async () => {
      const { router } = renderHomeWithDataRouter({ timedOutStage: 'mode' });
      expect(screen.getByRole('status')).toBeInTheDocument();
      await waitFor(() => expect(router.state.location.state).toBeNull());

      await act(async () => {
        await router.navigate('/elsewhere');
      });
      expect(screen.getByText('Elsewhere')).toBeInTheDocument();

      await act(async () => {
        await router.navigate(-1); // Back button, same history entry as before
      });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByText('Scan QR Code')).toBeEnabled();
    });

    it('leaves an ordinary (stateless) visit to Home untouched', async () => {
      const { router } = renderHomeWithDataRouter(undefined);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      // No spurious replace navigation when there was nothing to consume.
      await waitFor(() => expect(router.state.historyAction).not.toBe('REPLACE'));
    });
  });
});
