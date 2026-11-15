import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Button } from './Button';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
import { Modal } from './Modal';

type HarnessProps = Partial<ConfirmDialogProps>;

function Harness(props: HarnessProps) {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>מחיקה</Button>
      {deleted && <p>נמחק</p>}
      <ConfirmDialog
        open={open}
        title="מחיקת אטרקציה"
        message='בטוח שרוצים למחוק את "שוק האיכרים"?'
        onConfirm={() => {
          setDeleted(true);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
        {...props}
      />
    </>
  );
}

function open() {
  const trigger = screen.getByRole('button', { name: 'מחיקה' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('alertdialog', { name: 'מחיקת אטרקציה' }) };
}

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is a labelled alertdialog described by the question', () => {
    render(<Harness />);
    const { dialog } = open();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('בטוח שרוצים למחוק את "שוק האיכרים"?');
  });

  it('focuses Cancel by default (FR-3.4)', () => {
    render(<Harness />);
    open();
    expect(screen.getByRole('button', { name: 'ביטול' })).toHaveFocus();
  });

  it('uses the danger style and Hebrew default label for a destructive confirm', () => {
    render(<Harness />);
    open();
    const confirm = screen.getByRole('button', { name: 'כן, למחוק' });
    expect(confirm.className).toContain('bg-danger');
  });

  it('uses the primary style and "אישור" when not destructive', () => {
    render(<Harness destructive={false} />);
    open();
    const confirm = screen.getByRole('button', { name: 'אישור' });
    expect(confirm.className).toContain('bg-accent');
    expect(confirm.className).not.toContain('bg-danger');
  });

  it('accepts custom labels', () => {
    render(<Harness confirmLabel="כן, להסיר" cancelLabel="לא" />);
    open();
    expect(screen.getByRole('button', { name: 'כן, להסיר' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'לא' })).toHaveFocus();
  });

  it('has no close (×) button — the choice is explicit', () => {
    render(<Harness />);
    open();
    expect(screen.queryByRole('button', { name: 'סגירה' })).not.toBeInTheDocument();
  });

  it('confirms with the confirm button', () => {
    render(<Harness />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    expect(screen.getByText('נמחק')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels with Cancel and returns focus to the trigger', () => {
    render(<Harness />);
    const { trigger } = open();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('נמחק')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('cancels on Escape and on a backdrop click', () => {
    render(<Harness />);
    open();
    fireEvent.keyDown(screen.getByRole('button', { name: 'ביטול' }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    open();
    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('נמחק')).not.toBeInTheDocument();
  });

  it('while loading: busy confirm, disabled cancel, Esc and backdrop ignored', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        loading
        title="מחיקת טיול"
        message="בטוח?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'כן, למחוק' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('keeps focus in the dialog while loading and returns it to Cancel afterwards', () => {
    function Slow() {
      const [loading, setLoading] = useState(false);
      return (
        <>
          <ConfirmDialog
            open
            loading={loading}
            title="מחיקת טיול"
            message="בטוח?"
            onConfirm={() => setLoading(true)}
            onCancel={() => {}}
          />
          <button onClick={() => setLoading(false)}>סיום</button>
        </>
      );
    }
    render(<Slow />);
    const dialog = screen.getByRole('alertdialog', { name: 'מחיקת טיול' });
    const cancel = screen.getByRole('button', { name: 'ביטול' });
    expect(cancel).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    expect(cancel).toBeDisabled();
    expect(dialog).toHaveFocus();

    // Loading ends (e.g. the delete failed): the dialog stays open and Cancel is focused again.
    fireEvent.click(screen.getByRole('button', { name: 'סיום', hidden: true }));
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveFocus();
  });

  it('stacks over another dialog: Esc closes only the confirmation', () => {
    function EditWithDelete() {
      const [edit, setEdit] = useState(true);
      const [confirm, setConfirm] = useState(false);
      return (
        <Modal open={edit} onClose={() => setEdit(false)} title="עריכת אטרקציה">
          <Button onClick={() => setConfirm(true)}>מחיקה</Button>
          <ConfirmDialog
            open={confirm}
            title="מחיקת אטרקציה"
            message="בטוח?"
            onConfirm={() => setConfirm(false)}
            onCancel={() => setConfirm(false)}
          />
        </Modal>
      );
    }
    render(<EditWithDelete />);
    const trigger = screen.getByRole('button', { name: 'מחיקה' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'ביטול' })).toHaveFocus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'עריכת אטרקציה' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('disables only the confirm button, with the reason shown, when disabledReason is set', () => {
    render(<Harness disabledReason="אין חיבור לאינטרנט" />);
    fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));
    const confirm = screen.getByRole('button', { name: 'כן, למחוק' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('title', 'אין חיבור לאינטרנט');
    expect(confirm).toHaveAccessibleDescription('אין חיבור לאינטרנט');
    expect(screen.getByText('אין חיבור לאינטרנט')).toBeVisible();
    fireEvent.click(confirm);
    expect(screen.queryByText('נמחק')).not.toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'ביטול' });
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveFocus();
  });
});
