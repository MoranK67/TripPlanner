import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { PALETTE } from '@/domain';
import { ColorSwatches } from './ColorSwatches';
import { PALETTE_COLOR_KEYS } from './paletteColorKeys';

function Harness({ initial = PALETTE[0] as string }: { initial?: string }) {
  const [color, setColor] = useState(initial);
  return (
    <>
      <ColorSwatches label="צבע" value={color} onChange={setColor} />
      <output>{color}</output>
    </>
  );
}

describe('ColorSwatches', () => {
  it('is a labelled radio group with one named radio per palette color', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'צבע' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(PALETTE.length);
    expect(PALETTE_COLOR_KEYS).toHaveLength(PALETTE.length);
    expect(screen.getByRole('radio', { name: 'ורוד' })).toHaveAttribute('value', PALETTE[0]);
    expect(screen.getByRole('radio', { name: 'אבן' })).toHaveAttribute('value', PALETTE[9]);
  });

  it('checks the current value, case-insensitively', () => {
    render(<Harness initial="#cde5ff" />);
    expect(screen.getByRole('radio', { name: 'תכלת' })).toBeChecked();
    expect(
      screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked),
    ).toHaveLength(1);
  });

  it('selects nothing for a color outside the palette', () => {
    render(<Harness initial="#123456" />);
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });

  it('reports the chosen palette color', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'מנטה' }));
    expect(screen.getByRole('status')).toHaveTextContent(PALETTE[3]);
    expect(screen.getByRole('radio', { name: 'מנטה' })).toBeChecked();
  });

  it('marks the selection with a ✓, not by color alone', () => {
    const { container } = render(<Harness initial={PALETTE[2]} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')[2]).toHaveTextContent('✓');
    expect(container.querySelectorAll('[aria-hidden="true"]')[0]).toHaveTextContent('');
  });

  it('supports aria-label without a visible label, and disabled', () => {
    render(
      <ColorSwatches aria-label="בחירת צבע" value={PALETTE[0]} onChange={() => {}} disabled />,
    );
    expect(screen.getByRole('radiogroup', { name: 'בחירת צבע' })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  it('has no built-in outer margin and passes className through', () => {
    render(
      <ColorSwatches aria-label="צבע" value={PALETTE[0]} onChange={() => {}} className="mb-3.5" />,
    );
    const group = screen.getByRole('radiogroup', { name: 'צבע' });
    expect(group.className).toBe('mb-3.5');
  });

  it('requires a label or an aria-label (type-level)', () => {
    // @ts-expect-error -- an unnamed radio group is not allowed
    const unnamed = <ColorSwatches value={PALETTE[0]} onChange={() => {}} />;
    expect(unnamed).toBeTruthy();
  });
});
