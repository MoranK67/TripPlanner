import { act, renderHook } from '@testing-library/react';
import { detectPlatformKind } from './detect';
import { platform, selectPlatform } from './platform';
import { PlatformNotImplementedError } from './types';
import { useOnlineStatus } from './useOnlineStatus';
import { webPlatform } from './web';

describe('detectPlatformKind', () => {
  it('is web in a plain browser (and in jsdom)', () => {
    expect(detectPlatformKind({})).toBe('web');
    expect(detectPlatformKind()).toBe('web');
  });

  it('detects Tauri 2 as desktop', () => {
    expect(detectPlatformKind({ __TAURI_INTERNALS__: {} })).toBe('desktop');
  });

  it('detects native Capacitor Android / iOS', () => {
    const cap = (name: string) => ({ isNativePlatform: () => true, getPlatform: () => name });
    expect(detectPlatformKind({ Capacitor: cap('android') })).toBe('android');
    expect(detectPlatformKind({ Capacitor: cap('ios') })).toBe('ios');
  });

  it('stays web when the Capacitor web runtime is loaded in a browser', () => {
    expect(
      detectPlatformKind({
        Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
      }),
    ).toBe('web');
  });
});

describe('selectPlatform', () => {
  it('uses the web implementation on web', () => {
    expect(selectPlatform('web')).toBe(webPlatform);
    expect(platform.kind).toBe('web');
    expect(platform).toBe(webPlatform);
  });

  it.each(['desktop', 'android', 'ios'] as const)(
    '%s stub rejects saveFile with a clear not-implemented error',
    async (kind) => {
      const stub = selectPlatform(kind);
      expect(stub.kind).toBe(kind);
      const attempt = stub.saveFile(new Blob(['x']), 'a.txt');
      await expect(attempt).rejects.toBeInstanceOf(PlatformNotImplementedError);
      await expect(attempt).rejects.toThrow(/not implemented for "\w+".*DEC-027/);
    },
  );
});

describe('useOnlineStatus', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).onLine;
  });

  it('follows online/offline events', () => {
    const setOnline = (value: boolean) =>
      Object.defineProperty(navigator, 'onLine', { value, configurable: true });

    setOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});
