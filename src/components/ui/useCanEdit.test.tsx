import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EditLockProvider } from './EditLockProvider';
import { OfflineNote } from './OfflineNote';
import { useCanEdit } from './useCanEdit';

const REASON = 'אין חיבור לאינטרנט, אז אי אפשר לשמור שינויים כרגע. העריכה תחזור כשהחיבור יחזור.';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCanEdit (M7.3)', () => {
  it('allows editing online, without a reason', () => {
    const { result } = renderHook(() => useCanEdit());
    expect(result.current).toEqual({ canEdit: true, reason: undefined });
  });

  it('blocks editing offline with a Hebrew reason, and follows connectivity changes', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useCanEdit());
    expect(result.current).toEqual({ canEdit: false, reason: REASON });

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.canEdit).toBe(true);
  });
});

describe('OfflineNote', () => {
  it('renders nothing online', () => {
    const { container } = render(<OfflineNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains why saving is off while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<OfflineNote />);
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });
});

describe('EditLockProvider (M7.3b)', () => {
  const LOCK = 'החיבור לחשבון עדיין מתחדש';
  const locked = ({ children }: { children: ReactNode }) => (
    <EditLockProvider reason={LOCK}>{children}</EditLockProvider>
  );

  it('turns editing off online, with the lock reason', () => {
    const { result } = renderHook(() => useCanEdit(), { wrapper: locked });
    expect(result.current).toEqual({ canEdit: false, reason: LOCK });
  });

  it('offline, the offline reason wins', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useCanEdit(), { wrapper: locked });
    expect(result.current).toEqual({ canEdit: false, reason: REASON });
  });

  it('no lock (undefined) leaves editing on', () => {
    const { result } = renderHook(() => useCanEdit(), {
      wrapper: ({ children }) => <EditLockProvider reason={undefined}>{children}</EditLockProvider>,
    });
    expect(result.current.canEdit).toBe(true);
  });

  it('OfflineNote shows the lock reason in dialogs', () => {
    render(<OfflineNote />, { wrapper: locked });
    expect(screen.getByText(LOCK)).toBeInTheDocument();
  });
});
