import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import QuestionCard from '../components/QuestionCard';

describe('QuestionCard Component', () => {
  const mockQuestion = {
    question_id: 1,
    question_text: 'Test Question?',
    answer_text: 'Test Hint',
    context: 'Exploring',
    question_type: 'open-ended'
  };

  const mockSocket = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  };

  it('renders question text', () => {
    render(
      <QuestionCard 
        question={mockQuestion}
        isRevealed={false}
        mode="single-phone"
        socket={mockSocket}
      />
    );
    expect(screen.getByText('Test Question?')).toBeInTheDocument();
  });

  it('reveals hint on tap in single mode', () => {
    const onReveal = vi.fn();
    render(
      <QuestionCard 
        question={mockQuestion}
        isRevealed={false}
        onReveal={onReveal}
        mode="single-phone"
        socket={mockSocket}
      />
    );

    const card = screen.getByText('Test Question?').closest('div').parentElement;
    fireEvent.click(card);

    expect(onReveal).toHaveBeenCalled();
  });

  it('reveals hint on tap in dual mode', () => {
    const onReveal = vi.fn();
    render(
      <QuestionCard 
        question={mockQuestion}
        isRevealed={false}
        onReveal={onReveal}
        mode="dual-phone"
        socket={mockSocket}
      />
    );

    const card = screen.getByText('Test Question?').closest('div').parentElement;
    fireEvent.click(card);

    expect(onReveal).toHaveBeenCalled();
  });

  it('shows next button when revealed', () => {
    render(
      <QuestionCard 
        question={mockQuestion}
        isRevealed={true}
        mode="single-phone"
        socket={mockSocket}
      />
    );

    expect(screen.getByText('Next Question')).toBeInTheDocument();
  });
});
