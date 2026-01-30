import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProgressBar from '../ProgressBar';

describe('ProgressBar', () => {
  it('renders correctly', () => {
    render(<ProgressBar current={5} total={10} />);
    expect(screen.getByText('Question 5')).toBeInTheDocument();
    expect(screen.getByText('10 Total')).toBeInTheDocument();
  });

  it('calculates width correctly', () => {
    // We can't easily check the width style directly in jsdom without computed styles sometimes,
    // but we can check the inline style attribute.
    const { container } = render(<ProgressBar current={5} total={10} />);
    const bar = container.querySelector('.bg-black');
    expect(bar).toHaveStyle('width: 50%');
  });

  it('caps width at 100%', () => {
    const { container } = render(<ProgressBar current={15} total={10} />);
    const bar = container.querySelector('.bg-black');
    expect(bar).toHaveStyle('width: 100%');
  });
});
