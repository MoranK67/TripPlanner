import { act, renderHook } from '@testing-library/react';
import { BREAKPOINTS, useBreakpoint } from './useBreakpoint';

type Listener = () => void;

/** Minimal matchMedia stub driven by a fake viewport width. */
function installMatchMedia(initialWidth: number) {
  let width = initialWidth;
  const listeners = new Set<Listener>();
  const matchMedia = vi.fn((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      get matches() {
        return width >= min;
      },
      media: query,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    };
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    resize(next: number) {
      width = next;
      act(() => listeners.forEach((l) => l()));
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBreakpoint', () => {
  it('matches the plan: phone ≤ 600, desktop ≥ 900', () => {
    expect(BREAKPOINTS).toEqual({ tablet: 601, desktop: 900 });
  });

  it.each([
    [360, 'phone'],
    [600, 'phone'],
    [601, 'tablet'],
    [899, 'tablet'],
    [900, 'desktop'],
    [1440, 'desktop'],
  ])('width %i px → %s', (width, expected) => {
    installMatchMedia(width);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe(expected);
  });

  it('updates live and unsubscribes on unmount', () => {
    const media = installMatchMedia(1200);
    const { result, unmount } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('desktop');
    media.resize(500);
    expect(result.current).toBe('phone');
    media.resize(700);
    expect(result.current).toBe('tablet');
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('falls back to desktop without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('desktop');
  });
});
