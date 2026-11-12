import { act, fireEvent, render, screen } from '@testing-library/react';
import { Button } from './Button';
import { TOAST_MS, ToastProvider } from './ToastProvider';
import { useToast } from './toastContext';

function Trigger() {
  const toast = useToast();
  return (
    <>
      <Button onClick={() => toast.show('נשמר')}>info</Button>
      <Button onClick={() => toast.show('נכשל', { tone: 'error', durationMs: 5000 })}>error</Button>
      <Button onClick={() => toast.show('קבוע', { durationMs: Infinity })}>sticky</Button>
      <Button onClick={() => toast.dismiss()}>dismiss</Button>
    </>
  );
}

function setup() {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  return screen.getByRole('status');
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces a message in a polite live region and hides it after the timeout', () => {
    const region = setup();
    expect(region).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    expect(region).toHaveTextContent('נשמר');
    expect(region.className).toContain('opacity-100');

    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(region.className).toContain('opacity-0');
    expect(screen.getByText('נשמר')).toHaveAttribute('aria-hidden', 'true');
  });

  it('supports an error tone and a custom duration', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'error' }));
    expect(region).toHaveTextContent('נכשל');
    expect(region.className).toContain('bg-danger-ink');
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(region.className).toContain('opacity-100');
    act(() => {
      vi.advanceTimersByTime(5000 - TOAST_MS);
    });
    expect(region.className).toContain('opacity-0');
  });

  it('keeps an Infinity-duration toast until dismiss()', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'sticky' }));
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(region.className).toContain('opacity-100');
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    expect(region.className).toContain('opacity-0');
  });

  it('dismisses on demand', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    expect(region.className).toContain('opacity-0');
  });

  it('useToast throws outside the provider', () => {
    // Silence React's and jsdom's reporting of the expected render error.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    window.removeEventListener('error', swallow);
    spy.mockRestore();
  });
});
