import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { HeaderAction, HeaderMenuButton, HeaderMenuProvider } from './HeaderMenu';
import { useHeaderMenuNote } from './headerMenuContext';

function Page({ onEdit = () => {}, offline = false }: { onEdit?: () => void; offline?: boolean }) {
  useHeaderMenuNote('15.3–18.3 · 4 ימים');
  const [showExtra, setShowExtra] = useState(false);
  return (
    <>
      <HeaderAction label="יציאה" order={100} variant="ghost" onSelect={() => {}} />
      <HeaderAction label="+ טיול חדש" order={40} variant="primary" onSelect={() => {}} />
      <HeaderAction
        label="עריכה"
        order={10}
        disabled={offline}
        title={offline ? 'אין חיבור' : undefined}
        onSelect={onEdit}
      />
      {showExtra && <HeaderAction label="ייצוא" order={20} opensDialog onSelect={() => {}} />}
      <button type="button" onClick={() => setShowExtra(true)}>
        הוספה
      </button>
    </>
  );
}

function renderHeader(collapsed: boolean, page = <Page />) {
  return render(
    <HeaderMenuProvider collapsed={collapsed}>
      <HeaderMenuButton label="פעולות נוספות" />
      {page}
    </HeaderMenuProvider>,
  );
}

describe('HeaderAction / HeaderMenuButton', () => {
  it('tablet / desktop: every action is a button and there is no menu', () => {
    const onEdit = vi.fn();
    renderHeader(false, <Page onEdit={onEdit} />);
    expect(screen.queryByRole('button', { name: 'פעולות נוספות' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '+ טיול חדש' })).toBeInTheDocument();
  });

  it('phone: the actions become items of the "⋯" menu, sorted by order, with the note', () => {
    const onEdit = vi.fn();
    renderHeader(true, <Page onEdit={onEdit} />);
    expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'פעולות נוספות' }));
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'עריכה',
      '+ טיול חדש',
      'יציאה',
    ]);
    expect(screen.getByRole('menu')).toHaveAccessibleDescription('15.3–18.3 · 4 ימים');
    fireEvent.click(screen.getByRole('menuitem', { name: 'עריכה' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('phone: an action added later takes its place by order', () => {
    renderHeader(true);
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));
    fireEvent.click(screen.getByRole('button', { name: 'פעולות נוספות' }));
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'עריכה',
      'ייצוא',
      '+ טיול חדש',
      'יציאה',
    ]);
  });

  it('phone: a disabled action is a disabled item that shows why', () => {
    renderHeader(true, <Page offline />);
    fireEvent.click(screen.getByRole('button', { name: 'פעולות נוספות' }));
    const item = screen.getByRole('menuitem', { name: 'עריכה' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('אין חיבור');
  });

  it('switching to a wider screen turns the items back into buttons', () => {
    const { rerender } = renderHeader(true);
    expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    rerender(
      <HeaderMenuProvider collapsed={false}>
        <HeaderMenuButton label="פעולות נוספות" />
        <Page />
      </HeaderMenuProvider>,
    );
    expect(screen.getByRole('button', { name: 'עריכה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'פעולות נוספות' })).not.toBeInTheDocument();
  });
});
