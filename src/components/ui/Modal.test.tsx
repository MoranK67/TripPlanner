import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Button } from './Button';
import { Modal, ModalActions, type ModalProps } from './Modal';

type HarnessProps = Partial<ModalProps> & { withInitialFocus?: boolean };

function Harness({ withInitialFocus, ...modalProps }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const secondRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)}>פתיחה</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="אטרקציה חדשה"
        description="תיאור"
        initialFocusRef={withInitialFocus ? secondRef : undefined}
        footer={<Button>שמירה</Button>}
        {...modalProps}
      >
        <input aria-label="ראשון" />
        <input aria-label="שני" ref={secondRef} />
      </Modal>
    </>
  );
}

function openModal() {
  const trigger = screen.getByRole('button', { name: 'פתיחה' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'אטרקציה חדשה' }) };
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled, described modal dialog', () => {
    render(<Harness />);
    const { dialog } = openModal();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('תיאור');
  });

  it('can be rendered as an alertdialog', () => {
    render(<Harness role="alertdialog" />);
    fireEvent.click(screen.getByRole('button', { name: 'פתיחה' }));
    expect(screen.getByRole('alertdialog', { name: 'אטרקציה חדשה' })).toBeInTheDocument();
  });

  it('moves focus to the first field in the body on open', () => {
    render(<Harness />);
    openModal();
    expect(screen.getByLabelText('ראשון')).toHaveFocus();
  });

  it('honours initialFocusRef', () => {
    render(<Harness withInitialFocus />);
    openModal();
    expect(screen.getByLabelText('שני')).toHaveFocus();
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<Harness />);
    const { trigger } = openModal();
    fireEvent.keyDown(screen.getByLabelText('ראשון'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes with the close button, which has a Hebrew accessible name', () => {
    render(<Harness />);
    openModal();
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('traps Tab: wraps from the last element to the first and back', () => {
    render(<Harness />);
    const { dialog } = openModal();
    const close = screen.getByRole('button', { name: 'סגירה' });
    const save = screen.getByRole('button', { name: 'שמירה' });

    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();

    // Focus on the dialog container itself: Shift+Tab goes to the last element.
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
  });

  it('does not interfere with Tab between elements in the middle', () => {
    render(<Harness />);
    openModal();
    const first = screen.getByLabelText('ראשון');
    const event = fireEvent.keyDown(first, { key: 'Tab' });
    // fireEvent returns false when preventDefault was called.
    expect(event).toBe(true);
  });

  it('closes on a backdrop press + click, but not on clicks inside the dialog', () => {
    render(<Harness />);
    const { dialog } = openModal();
    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not close when the press started inside the dialog and ended on the backdrop', () => {
    render(<Harness />);
    const { dialog } = openModal();
    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.mouseDown(dialog);
    fireEvent.click(backdrop);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // A lone click (e.g. a touch ghost click) without a press on the backdrop is ignored too.
    fireEvent.click(backdrop);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('still closes on Esc after the focused footer button becomes disabled', () => {
    function LoadingFooter() {
      const [open, setOpen] = useState(true);
      const [saving, setSaving] = useState(false);
      return (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="שמירה"
          footer={
            <Button loading={saving} onClick={() => setSaving(true)}>
              שמור
            </Button>
          }
        />
      );
    }
    render(<LoadingFooter />);
    const save = screen.getByRole('button', { name: 'שמור' });
    save.focus();
    fireEvent.click(save);
    expect(save).toBeDisabled();
    // Browsers move focus to <body> when the focused element is disabled.
    save.blur();
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Tab from <body> goes back into the dialog', () => {
    render(<Harness />);
    openModal();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'סגירה' })).toHaveFocus();
  });

  it('pulls focus back into the dialog when it lands outside', () => {
    render(
      <>
        <button>בחוץ</button>
        <Harness />
      </>,
    );
    openModal();
    screen.getByRole('button', { name: 'בחוץ', hidden: true }).focus();
    expect(screen.getByLabelText('ראשון')).toHaveFocus();
  });

  it('can disable backdrop close and hide the close button', () => {
    render(<Harness closeOnBackdrop={false} showCloseButton={false} />);
    openModal();
    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'סגירה' })).not.toBeInTheDocument();
  });

  it('locks body scroll while open', () => {
    render(<Harness />);
    openModal();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('with nested modals, Escape closes only the top one', () => {
    function Nested() {
      const [inner, setInner] = useState(true);
      const [outer, setOuter] = useState(true);
      return (
        <Modal open={outer} onClose={() => setOuter(false)} title="חיצוני">
          <Modal open={inner} onClose={() => setInner(false)} title="פנימי">
            <button>פעולה</button>
          </Modal>
        </Modal>
      );
    }
    render(<Nested />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'פעולה' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'פנימי' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'חיצוני' })).toBeInTheDocument();
  });

  it('when parent and child open in the same render, the child gets focus and Esc', () => {
    function Nested() {
      const [inner, setInner] = useState(true);
      const [outer, setOuter] = useState(true);
      return (
        <Modal open={outer} onClose={() => setOuter(false)} title="חיצוני">
          <input aria-label="שדה חיצוני" />
          <Modal open={inner} onClose={() => setInner(false)} title="פנימי">
            <input aria-label="שדה פנימי" />
          </Modal>
        </Modal>
      );
    }
    render(<Nested />);
    expect(screen.getByLabelText('שדה פנימי')).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'פנימי' })).not.toBeInTheDocument();
    // Focus returns into the remaining (outer) dialog.
    expect(screen.getByRole('dialog', { name: 'חיצוני' })).toContainElement(
      document.activeElement as HTMLElement,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('phone layout (PHONE-1)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubPhone() {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: false, // no min-width query matches: phone
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
      );
    }

    it('dialogs go full-screen on phones, confirmations stay cards', () => {
      render(<Harness />);
      expect(openModal().dialog).toHaveAttribute('data-phone-layout', 'fullscreen');
    });

    it('an alertdialog keeps the card unless asked otherwise', () => {
      render(<Harness role="alertdialog" />);
      fireEvent.click(screen.getByRole('button', { name: 'פתיחה' }));
      expect(screen.getByRole('alertdialog')).toHaveAttribute('data-phone-layout', 'card');
    });

    it('can opt out of full screen', () => {
      render(<Harness phoneLayout="card" />);
      expect(openModal().dialog).toHaveAttribute('data-phone-layout', 'card');
    });

    it('the footer and <ModalActions> are action rows inside the dialog', () => {
      render(
        <Modal open onClose={() => {}} title="טופס" footer={<Button>אישור</Button>}>
          <form>
            <ModalActions>
              <Button type="submit">שמירה בטופס</Button>
            </ModalActions>
          </form>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog', { name: 'טופס' });
      for (const name of ['אישור', 'שמירה בטופס']) {
        const button = screen.getByRole('button', { name });
        expect(dialog).toContainElement(button);
        expect(button.parentElement).toHaveAttribute('data-modal-actions');
      }
    });

    it('on a phone with the keyboard open, it fits the visible part of the screen', () => {
      stubPhone();
      const listeners = new Set<() => void>();
      const viewport = {
        height: 844,
        offsetTop: 0,
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      };
      vi.stubGlobal('visualViewport', viewport);
      vi.stubGlobal('innerHeight', 844);
      render(<Harness />);
      openModal();
      const backdrop = screen.getByTestId('modal-backdrop');
      expect(backdrop.style.height).toBe('');

      // The keyboard takes the lower part of the screen and Safari scrolls the page a bit.
      viewport.height = 500;
      viewport.offsetTop = 120;
      act(() => listeners.forEach((l) => l()));
      expect(backdrop.style.top).toBe('120px');
      expect(backdrop.style.height).toBe('500px');

      // The keyboard closes: back to the plain full-screen box (inline style removed).
      viewport.height = 844;
      viewport.offsetTop = 0;
      act(() => listeners.forEach((l) => l()));
      expect(backdrop.style.top).toBe('');
      expect(backdrop.style.height).toBe('');
      expect(backdrop.getAttribute('style') ?? '').not.toMatch(/height|top/);
    });

    it('stops listening to the visual viewport when it closes', () => {
      stubPhone();
      // Listener registrations by event type.
      const listeners = new Map<string, () => void>();
      const add = vi.fn((type: string, l: () => void) => listeners.set(type, l));
      const remove = vi.fn((type: string, l: () => void) => {
        if (listeners.get(type) === l) listeners.delete(type);
      });
      vi.stubGlobal('visualViewport', {
        height: 844,
        offsetTop: 0,
        addEventListener: add,
        removeEventListener: remove,
      });
      vi.stubGlobal('innerHeight', 844);
      render(<Harness />);
      openModal();
      expect(add).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(add).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(listeners.size).toBe(2);

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(listeners.size).toBe(0);
    });

    it('does not listen on tablet / desktop', () => {
      const add = vi.fn();
      vi.stubGlobal('visualViewport', {
        height: 500,
        offsetTop: 0,
        addEventListener: add,
        removeEventListener: vi.fn(),
      });
      render(<Harness />);
      openModal();
      expect(add).not.toHaveBeenCalled();
      expect(screen.getByTestId('modal-backdrop').style.height).toBe('');
    });
  });
});
