import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import QuestionCard from '../components/QuestionCard';

// Regression coverage for the restored "Conversation in Progress" overlay:
// a faded/blurred backdrop over the QUESTION CARD only, anchored via the
// card's own `relative overflow-hidden` (position: absolute; inset: 0 on
// that card), never `position: fixed` on the viewport. The Next Question
// button lives in a separate sibling element (the action bar below the
// card) and must never be a descendant of the overlay, never dimmed/blurred,
// and always clickable.
describe('Conversation in Progress overlay (dual mode, State 2) — bounded to the question card', () => {
  const mockQuestion = {
    question_id: 'q1',
    question_text: 'What do you value most in a friendship?',
    answer_text: null,
    context: 'Exploring',
    question_type: 'open-ended'
  };

  const mockSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true };

  function renderState2(extraProps = {}) {
    return render(
      <QuestionCard
        question={mockQuestion}
        isRevealed={true}
        mode="dual-phone"
        socket={mockSocket}
        sessionId="s1"
        userId="u1"
        conversationStarted={true}
        onAdvanceTurn={extraProps.onAdvanceTurn}
        {...extraProps}
      />
    );
  }

  function getOverlay() {
    return screen.getByText('Conversation in Progress…').closest('[style]');
  }

  it('shows the "Conversation in Progress…" overlay once both participants are ready', () => {
    renderState2();
    expect(screen.getByText('Conversation in Progress…')).toBeInTheDocument();
  });

  it('bounds the overlay to the question card via position:absolute, never position:fixed on the viewport', () => {
    renderState2();
    const overlay = getOverlay();

    expect(overlay.className).toContain('absolute');
    expect(overlay.className).not.toContain('fixed');
    expect(overlay.className).toContain('inset-0');

    // The overlay's positioning parent must be the question card (the
    // `relative overflow-hidden` rounded card), not a viewport-level wrapper.
    const cardAncestor = overlay.closest('.relative.overflow-hidden');
    expect(cardAncestor).toBeTruthy();
    expect(cardAncestor.className).toContain('rounded-[2rem]');
  });

  it('never lets the overlay cover the Next Question button — the button is a sibling, not a descendant', () => {
    renderState2();
    const overlay = getOverlay();
    const button = screen.getByRole('button', { name: 'Next Question' });

    expect(overlay.contains(button)).toBe(false);
  });

  it('keeps the Next Question button enabled and clickable, with no overlay intercepting the click', () => {
    const onAdvanceTurn = vi.fn();
    renderState2({ onAdvanceTurn });

    const button = screen.getByRole('button', { name: 'Next Question' });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(onAdvanceTurn).toHaveBeenCalledTimes(1);
  });

  it('after one participant clicks Next Question, shows "Waiting for Partner…" and keeps the overlay visible (not hidden/obscured)', () => {
    renderState2({ hasClickedNext: true, advanceIntentCount: 1 });

    // The discussion overlay over the question area is still shown.
    expect(screen.getByText('Conversation in Progress…')).toBeInTheDocument();

    // The local clicker's waiting state lives in the action bar, outside the
    // overlay, and must render as plain, fully visible text (not faded).
    const waitingText = screen.getByText('Waiting for Partner…');
    expect(waitingText).toBeInTheDocument();
    const overlay = getOverlay();
    expect(overlay.contains(waitingText)).toBe(false);
    expect(screen.queryByRole('button', { name: 'Next Question' })).not.toBeInTheDocument();
  });

  it('when the partner clicked first, keeps the overlay visible alongside "Partner is Waiting" and an enabled button', () => {
    renderState2({ hasClickedNext: false, advanceIntentCount: 1 });

    expect(screen.getByText('Conversation in Progress…')).toBeInTheDocument();
    expect(screen.getByText('Partner is Waiting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Question' })).toBeEnabled();
  });

  it('does not show the overlay before both participants are ready (State 1)', () => {
    render(
      <QuestionCard
        question={mockQuestion}
        isRevealed={true}
        mode="dual-phone"
        socket={mockSocket}
        sessionId="s1"
        userId="u1"
        conversationStarted={false}
      />
    );

    expect(screen.queryByText('Conversation in Progress…')).not.toBeInTheDocument();
  });

  it('does not render the dual conversation overlay in single-phone mode', () => {
    render(
      <QuestionCard
        question={mockQuestion}
        isRevealed={true}
        mode="single-phone"
        socket={mockSocket}
      />
    );

    expect(screen.queryByText('Conversation in Progress…')).not.toBeInTheDocument();
  });

  it('never renders a full-viewport fixed backdrop anywhere in the DOM', () => {
    const { container } = renderState2();

    const fixedFullScreenNodes = Array.from(container.querySelectorAll('*')).filter((el) => {
      const cls = el.className || '';
      return typeof cls === 'string' && cls.includes('fixed') && cls.includes('inset-0');
    });
    expect(fixedFullScreenNodes).toHaveLength(0);
  });
});
