import { act, render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ContextSelection from '../pages/ContextSelection';
import ModeSelection from '../pages/ModeSelection';

// Keep socket interaction inert and observable — neither page should ever
// need a lock token in these tests (sessionStorage is empty), so `io()`
// should not even be called, but stub it defensively so a real connection
// is never attempted either way.
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((_event, _payload, cb) => { if (typeof cb === 'function') cb({ status: 'ignored' }); }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false
  }))
}));

// Stable across calls — mirrors the real hook's useCallback(..., []) identity.
// A mock that hands back a new vi.fn() on every call would make `firePublic`
// (a dependency of the timer-arming effects) change identity on every
// render, which would re-arm the real app's timer too — this mock must not
// introduce a false "it resets" failure that the real hook wouldn't.
vi.mock('../hooks/useAnalytics', () => {
  const firePublic = vi.fn();
  const fireSession = vi.fn();
  const trackPublic = vi.fn();
  const trackSession = vi.fn();
  return {
    default: () => ({ firePublic, fireSession, trackPublic, trackSession })
  };
});

vi.mock('../context/SocketContext', () => ({
  useSocket: () => ({ socket: null, isConnected: false, ensureConnection: vi.fn() }),
  useEnsureSessionRoom: () => {}
}));

vi.mock('../api', () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  updateSessionMode: vi.fn()
}));

function LandedProbe() {
  const location = useLocation();
  return <div data-testid="landed">{JSON.stringify(location.state || null)}</div>;
}

function renderContextSelection() {
  return render(
    <MemoryRouter initialEntries={['/r/cafe/t/table1/context']}>
      <Routes>
        <Route path="/r/:restaurantSlug/t/:tableToken/context" element={<ContextSelection />} />
        <Route path="/" element={<LandedProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderModeSelection() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/r/cafe/t/table1/mode', state: { context: 'Exploring' } }]}>
      <Routes>
        <Route path="/r/:restaurantSlug/t/:tableToken/mode" element={<ModeSelection />} />
        <Route path="/" element={<LandedProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Startup stage timeouts', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('Context Selection does not redirect before 20s elapse', async () => {
    renderContextSelection();
    expect(screen.getByText('What kind of questions?')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19999);
    });

    expect(screen.getByText('What kind of questions?')).toBeInTheDocument();
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();
  });

  it('Context Selection redirects home with a timeout reason at exactly 20s', async () => {
    renderContextSelection();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });

    const landed = screen.getByTestId('landed');
    expect(JSON.parse(landed.textContent)).toEqual({ timedOutStage: 'context' });
  });

  it('Mode Selection does not redirect before its own 20s elapse', async () => {
    renderModeSelection();
    expect(screen.getByText('How are you playing?')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19999);
    });

    expect(screen.getByText('How are you playing?')).toBeInTheDocument();
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();
  });

  it('Mode Selection redirects home with a timeout reason at exactly 20s', async () => {
    renderModeSelection();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });

    const landed = screen.getByTestId('landed');
    expect(JSON.parse(landed.textContent)).toEqual({ timedOutStage: 'mode' });
  });

  it('Mode Selection gets a full fresh 20s window, independent of time already spent on Context Selection', async () => {
    // Spend 12s on Context Selection, then leave it (as a real guest would by
    // clicking a context option) before it expires.
    const { unmount } = renderContextSelection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    unmount();

    // Mount Mode Selection fresh. If time were (incorrectly) carried over,
    // only 8s would remain and this would already have redirected.
    renderModeSelection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19000);
    });
    expect(screen.getByText('How are you playing?')).toBeInTheDocument();
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();

    // Mode Selection's own deadline (20s from ITS mount) fires here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const landed = screen.getByTestId('landed');
    expect(JSON.parse(landed.textContent)).toEqual({ timedOutStage: 'mode' });
  });

  it('does not reset the Context Selection timer on an unrelated rerender', async () => {
    const { rerender } = renderContextSelection();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    // Force React to re-render the same tree (same route params) several
    // times, as an unrelated parent state change would. The arming effect's
    // deps (restaurantSlug, tableToken, stable navigate/firePublic) are
    // unchanged, so it must not re-run or push the deadline out.
    for (let i = 0; i < 3; i += 1) {
      rerender(
        <MemoryRouter initialEntries={['/r/cafe/t/table1/context']}>
          <Routes>
            <Route path="/r/:restaurantSlug/t/:tableToken/context" element={<ContextSelection />} />
            <Route path="/" element={<LandedProbe />} />
          </Routes>
        </MemoryRouter>
      );
    }

    // Only 4s of the ORIGINAL 20s window remain. If rerenders had reset the
    // timer, this would still show the page.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const landed = screen.getByTestId('landed');
    expect(JSON.parse(landed.textContent)).toEqual({ timedOutStage: 'context' });
  });

  it('shows no warning before the final 5 seconds, then a non-blocking warning', async () => {
    renderContextSelection();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14900);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The page's own controls remain fully usable — no overlay, no disabling.
    expect(screen.getByText('Keep it light')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/resets in \d+s/);
    expect(screen.getByText('Keep it light')).toBeInTheDocument();
  });

  it('renders a visible, shrinking progress indicator tied to the real deadline', async () => {
    renderContextSelection();

    const bar = () => screen.getByRole('progressbar');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const early = Number(bar().getAttribute('aria-valuenow'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    const later = Number(bar().getAttribute('aria-valuenow'));

    expect(later).toBeLessThan(early);
  });
});
