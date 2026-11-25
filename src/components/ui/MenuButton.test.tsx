import { fireEvent, render, screen } from '@testing-library/react';
import { MenuButton, type MenuItem } from './MenuButton';

function setup(overrides: Partial<MenuItem>[] = []) {
  const edit = vi.fn();
  const remove = vi.fn();
  const leave = vi.fn();
  const items: MenuItem[] = [
    { id: 'edit', label: 'עריכה', onSelect: edit, ...overrides[0] },
    { id: 'delete', label: 'מחיקה', onSelect: remove, tone: 'danger', ...overrides[1] },
    { id: 'out', label: 'יציאה', onSelect: leave, ...overrides[2] },
  ];
  render(
    <>
      <MenuButton label="פעולות נוספות" items={items} note="1.5–3.5 · 3 ימים" />
      <button type="button">אחר</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: 'פעולות נוספות' });
  return { trigger, edit, remove, leave };
}

const menuItem = (name: string) => screen.getByRole('menuitem', { name });

describe('MenuButton', () => {
  it('is a collapsed menu button until opened', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on click: a labelled menu with the note as its description, first item focused', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'פעולות נוספות' });
    expect(menu).toHaveAccessibleDescription('1.5–3.5 · 3 ימים');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'עריכה',
      'מחיקה',
      'יציאה',
    ]);
    expect(menuItem('עריכה')).toHaveFocus();
  });

  it.each(['Enter', ' ', 'ArrowDown'])('opens with %j on the first item', (key) => {
    const { trigger } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    expect(menuItem('עריכה')).toHaveFocus();
  });

  it('opens with ArrowUp on the last item', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(menuItem('יציאה')).toHaveFocus();
  });

  it('moves with the arrows (wrapping), Home and End', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menuItem('מחיקה')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menuItem('עריכה')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(menuItem('יציאה')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(menuItem('עריכה')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(menuItem('יציאה')).toHaveFocus();
  });

  it('choosing an item closes the menu, returns focus to the trigger, then runs the action', () => {
    const { trigger, remove } = setup();
    let focusedDuringSelect: Element | null = null;
    remove.mockImplementation(() => {
      focusedDuringSelect = document.activeElement;
    });
    fireEvent.click(trigger);
    fireEvent.click(menuItem('מחיקה'));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(focusedDuringSelect).toBe(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Escape and Tab close the menu and return focus to the trigger', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('a press outside closes it; the trigger toggles it', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'אחר' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a disabled item stays reachable, shows its reason and does nothing', () => {
    const { trigger, edit } = setup([{ disabled: true, disabledReason: 'אין חיבור לאינטרנט' }]);
    fireEvent.click(trigger);
    const item = menuItem('עריכה');
    expect(item).toHaveFocus();
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('אין חיבור לאינטרנט');
    fireEvent.click(item);
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
