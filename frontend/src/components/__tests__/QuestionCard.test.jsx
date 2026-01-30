import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import QuestionCard from '../QuestionCard';

describe('QuestionCard', () => {
  const mockQuestion = {
    question_id: 1,
    question_text: 'Test Question?',
    answer_text: 'Test Answer',
    category: 'Test Category'
  };

  const defaultProps = {
    question: mockQuestion,
    onReveal: vi.fn(),
    isRevealed: false,
    onNext: vi.fn(),
    waitingForPartner: false,
    mode: 'single'
  };

  it('renders question text', () => {
    render(<QuestionCard {...defaultProps} />);
    expect(screen.getByText('Test Question?')).toBeInTheDocument();
    expect(screen.getByText('Test Category')).toBeInTheDocument();
  });

  it('reveals answer when clicked', () => {
    render(<QuestionCard {...defaultProps} />);
    
    // Find the card container (it has the click handler)
    const card = screen.getByText('Test Question?').closest('div');
    fireEvent.click(card);
    
    expect(defaultProps.onReveal).toHaveBeenCalled();
  });

  it('shows answer when revealed', () => {
    render(<QuestionCard {...defaultProps} isRevealed={true} />);
    expect(screen.getByText('Test Answer')).toBeInTheDocument();
  });

  it('disables next button when waiting for partner', () => {
    render(<QuestionCard {...defaultProps} waitingForPartner={true} />);
    
    const nextButton = screen.getByRole('button', { name: /syncing.../i });
    expect(nextButton).toBeDisabled();
  });

  it('calls onNext when next button clicked', () => {
    render(<QuestionCard {...defaultProps} />);
    
    const nextButton = screen.getByRole('button', { name: /next question/i });
    fireEvent.click(nextButton);
    
    expect(defaultProps.onNext).toHaveBeenCalled();
  });
});
