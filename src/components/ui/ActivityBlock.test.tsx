import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ActivityBlock } from './ActivityBlock';
import { SlotHeightContext } from './activityBlockLayout';

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

  it('takes the slot height from SlotHeightContext unless passed (phone scale, PHONE-2)', () => {
    const { container, rerender } = render(
      <SlotHeightContext.Provider value={22}>
        <ActivityBlock name="א" durationMinutes={60} color="#FFD6E0" />
      </SlotHeightContext.Provider>,
    );
    expect(block(container).style.height).toBe('41px');
    // Too low to stack name and time: one row, so both stay visible.
    expect(block(container)).toHaveAttribute('data-short', 'true');
    rerender(
      <SlotHeightContext.Provider value={22}>
        <ActivityBlock name="א" durationMinutes={60} color="#FFD6E0" slotHeight={28} />
      </SlotHeightContext.Provider>,
    );
    expect(block(container).style.height).toBe('53px');
    expect(block(container)).not.toHaveAttribute('data-short');
  });

  it('shrinks the × and the time line to fit a one-slot block at the phone scale', () => {
    const { container, rerender } = render(
      <ActivityBlock
        name="קפה"
        durationMinutes={30}
        color="#FFD6E0"
        slotHeight={22}
        onDelete={() => {}}
      />,
    );
    expect(block(container).style.height).toBe('19px');
    expect(screen.getByRole('button', { name: 'מחיקת קפה' })).toHaveClass('size-4');
    expect(screen.getByText('חצי שעה')).toHaveClass('leading-[1.3]');
    rerender(<ActivityBlock name="קפה" durationMinutes={30} color="#FFD6E0" onDelete={() => {}} />);
    expect(screen.getByRole('button', { name: 'מחיקת קפה' })).toHaveClass('size-5');
    expect(screen.getByText('חצי שעה')).toHaveClass('leading-[1.5]');
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

  it('clamps a long name in a one-hour block so the duration stays visible (UX-8)', () => {
    const longName = 'סיור מודרך ארוך במיוחד ברחובות העיר העתיקה ובשוק';
    const { container, rerender } = render(
      <ActivityBlock name={longName} durationMinutes={60} color="#FFD6E0" onOpen={() => {}} />,
    );
    const nameEl = screen.getByText(longName);
    expect(nameEl).toHaveClass('line-clamp-(--name-lines)');
    expect(nameEl.style.getPropertyValue('--name-lines')).toBe('1');
    expect(screen.getByText('שעה')).toBeInTheDocument();
    // The full name stays available: as the block's title and in the button's accessible name.
    expect(block(container)).toHaveAttribute('title', longName);
    expect(screen.getByRole('button', { name: `${longName} שעה` })).toBeInTheDocument();
    // The height still maps to time.
    expect(block(container).style.height).toBe('53px');

    rerender(<ActivityBlock name={longName} durationMinutes={90} color="#FFD6E0" />);
    expect(screen.getByText(longName).style.getPropertyValue('--name-lines')).toBe('2');
    rerender(<ActivityBlock name={longName} durationMinutes={30} color="#FFD6E0" />);
    expect(screen.getByText(longName).style.getPropertyValue('--name-lines')).toBe('');
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

  it('names the open button from its visible text, in order (WCAG 2.5.3 Label in Name)', () => {
    render(
      <ActivityBlock
        name="קפה"
        durationMinutes={60}
        color="#FFD6E0"
        meta="09:00–10:00"
        onOpen={() => {}}
        onDelete={() => {}}
      />,
    );
    const open = screen.getByRole('button', { name: 'קפה 09:00–10:00' });
    // No author label that could diverge from what is shown (axe label-content-name-mismatch).
    expect(open).not.toHaveAttribute('aria-label');
    expect(open).not.toHaveAttribute('aria-labelledby');
    expect(open.textContent).toBe('קפה 09:00–10:00');
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

  it('keeps a disabled × focusable, with the reason, and ignores clicks', () => {
    const onDelete = vi.fn();
    render(
      <ActivityBlock
        name="קפה"
        durationMinutes={60}
        color="#FFD6E0"
        onOpen={() => {}}
        onDelete={onDelete}
        deleteDisabledReason="אין חיבור לאינטרנט"
      />,
    );
    const remove = screen.getByRole('button', { name: 'מחיקת קפה' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveAccessibleDescription('אין חיבור לאינטרנט');
    expect(remove).toBeEnabled();
    remove.focus();
    expect(remove).toHaveFocus();
    fireEvent.click(remove);
    expect(onDelete).not.toHaveBeenCalled();
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

  it('is relative by default, but lets a caller position it (class or inline style)', () => {
    const { container, rerender } = render(
      <ActivityBlock name="א" durationMinutes={60} color="#FFD6E0" />,
    );
    expect(block(container)).toHaveClass('relative');

    rerender(
      <ActivityBlock
        name="א"
        durationMinutes={60}
        color="#FFD6E0"
        className="absolute inset-x-1"
      />,
    );
    expect(block(container)).toHaveClass('absolute');
    expect(block(container)).not.toHaveClass('relative');

    rerender(
      <ActivityBlock
        name="א"
        durationMinutes={60}
        color="#FFD6E0"
        className="inset-x-1"
        style={{ position: 'absolute', top: 10 }}
      />,
    );
    expect(block(container)).not.toHaveClass('relative');
    expect(block(container).style.position).toBe('absolute');

    // A variant-only position keeps the base fallback (the variant wins where it applies).
    rerender(
      <ActivityBlock name="א" durationMinutes={60} color="#FFD6E0" className="tablet:absolute" />,
    );
    expect(block(container)).toHaveClass('relative');
  });

  it('adds the tag to the title and, after the visible text, to the accessible name (FEAT-2)', () => {
    const { container } = render(
      <ActivityBlock
        name="קפה"
        tag="מרכז העיר"
        durationMinutes={60}
        color="#FFD6E0"
        meta="09:00–10:00"
        onOpen={() => {}}
      />,
    );
    expect(block(container)).toHaveAttribute('title', 'קפה · מרכז העיר');
    expect(screen.getByRole('button', { name: /^קפה/ })).toHaveAccessibleName(
      'קפה 09:00–10:00 (תגית: מרכז העיר)',
    );
    // Not visible: the block relies on the group colour (layout unchanged, UX-8).
    expect(screen.getByText('(תגית: מרכז העיר)', { exact: false })).toHaveClass('sr-only');
  });

  it('keeps the plain name as the title without a tag', () => {
    const { container } = render(
      <ActivityBlock name="קפה" tag={null} durationMinutes={60} color="#FFD6E0" />,
    );
    expect(block(container)).toHaveAttribute('title', 'קפה');
  });
});
