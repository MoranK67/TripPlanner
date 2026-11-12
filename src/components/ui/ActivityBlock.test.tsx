import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ActivityBlock } from './ActivityBlock';

function block(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('no block');
  return el;
}

describe('ActivityBlock', () => {
  it('shows the name and a Hebrew duration by default', () => {
    render(<ActivityBlock name="שוק האיכרים" durationMinutes={90} color="#FFD6E0" />);
    expect(screen.getByText('שוק האיכרים')).toBeInTheDocument();
    expect(screen.getByText('שעה וחצי')).toBeInTheDocument();
  });

  it('shows custom meta (time range) instead of the duration', () => {
    render(<ActivityBlock name="קפה" durationMinutes={60} color="#CDE5FF" meta="09:00–10:00" />);
    expect(screen.getByText('09:00–10:00')).toBeInTheDocument();
    expect(screen.queryByText('שעה')).not.toBeInTheDocument();
  });

  it('has a height proportional to the duration (FR-3.3)', () => {
    const { container, rerender } = render(
      <ActivityBlock name="א" durationMinutes={60} color="#FFD6E0" />,
    );
    expect(block(container).style.height).toBe('53px');
    rerender(<ActivityBlock name="א" durationMinutes={180} color="#FFD6E0" />);
    expect(block(container).style.height).toBe('165px');
    rerender(<ActivityBlock name="א" durationMinutes={60} color="#FFD6E0" slotHeight={40} />);
    expect(block(container).style.height).toBe('77px');
  });

  it('uses the short single-line layout for one slot only', () => {
    const { container, rerender } = render(
      <ActivityBlock name="קפה" durationMinutes={30} color="#FFD6E0" />,
    );
    expect(block(container)).toHaveAttribute('data-short', 'true');
    expect(screen.getByText('קפה').className).toContain('truncate');
    rerender(<ActivityBlock name="קפה" durationMinutes={60} color="#FFD6E0" />);
    expect(block(container)).not.toHaveAttribute('data-short');
  });

  it('sets the block color, normalized, with a palette fallback for bad values', () => {
    const { container, rerender } = render(
      <ActivityBlock name="א" durationMinutes={30} color="#cde5ff" />,
    );
    expect(block(container).style.getPropertyValue('--block-color')).toBe('#CDE5FF');
    rerender(<ActivityBlock name="א" durationMinutes={30} color="red; background: url(x)" />);
    expect(block(container).style.getPropertyValue('--block-color')).toBe('#E6E1DA');
  });

  it('is a plain element without onOpen / onDelete', () => {
    render(<ActivityBlock name="קפה" durationMinutes={60} color="#FFD6E0" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens on click and with the keyboard via a named button (FR-3.5)', () => {
    const onOpen = vi.fn();
    render(<ActivityBlock name="קפה" durationMinutes={60} color="#FFD6E0" onOpen={onOpen} />);
    const open = screen.getByRole('button', { name: 'קפה שעה' });
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
    open.focus();
    expect(open).toHaveFocus();
  });

  it('has a named delete × that does not trigger open', () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <ActivityBlock
        name="קפה"
        durationMinutes={60}
        color="#FFD6E0"
        onOpen={onOpen}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת קפה' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks only the delete × with data-no-drag, so pressing it never starts a drag', () => {
    render(
      <ActivityBlock
        name="קפה"
        durationMinutes={60}
        color="#FFD6E0"
        onOpen={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'מחיקת קפה' })).toHaveAttribute('data-no-drag');
    expect(screen.getByRole('button', { name: /^קפה/ })).not.toHaveAttribute('data-no-drag');
  });

  it('forwards ref, className, style and extra props to the outer element', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <ActivityBlock
        ref={ref}
        name="א"
        durationMinutes={60}
        color="#FFD6E0"
        className="absolute"
        style={{ top: 29 }}
        data-activity-id="a1"
      />,
    );
    const el = block(container);
    expect(ref.current).toBe(el);
    expect(el).toHaveClass('absolute');
    expect(el.style.top).toBe('29px');
    expect(el.style.height).toBe('53px');
    expect(el).toHaveAttribute('data-activity-id', 'a1');
    expect(el).toHaveAttribute('title', 'א');
  });
});
