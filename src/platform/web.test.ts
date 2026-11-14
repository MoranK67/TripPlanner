import { REVOKE_DELAY_MS, webPlatform } from './web';

type NavShare = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

function defineNav<K extends keyof NavShare | 'onLine'>(key: K, value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

function installMatchMedia(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' ? coarse : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function installShare(opts: { canShare: boolean; share?: () => Promise<void> }) {
  const share = vi.fn(opts.share ?? (() => Promise.resolve()));
  const canShare = vi.fn(() => opts.canShare);
  defineNav('share', share);
  defineNav('canShare', canShare);
  return { share, canShare };
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clicks: HTMLAnchorElement[];

beforeEach(() => {
  vi.useFakeTimers();
  createObjectURL = vi.fn(() => 'blob:mock-url');
  revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this);
  });
  installMatchMedia(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const nav = navigator as unknown as Record<string, unknown>;
  delete nav.share;
  delete nav.canShare;
  delete nav.onLine; // falls back to jsdom's prototype getter
});

const pdf = () => new Blob(['%PDF'], { type: 'application/pdf' });

describe('webPlatform.saveFile — download', () => {
  it('downloads via a hidden <a download>, removes it and revokes the URL later', async () => {
    const result = await webPlatform.saveFile(pdf(), 'trip.pdf');

    expect(result).toBe('saved');
    expect(clicks).toHaveLength(1);
    const a = clicks[0]!;
    expect(a.download).toBe('trip.pdf');
    expect(a.getAttribute('href')).toBe('blob:mock-url');
    expect(a.isConnected).toBe(false);

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('applies the mime type only when the blob has none', async () => {
    await webPlatform.saveFile(new Blob(['{}']), 'backup.json', 'application/json');
    expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe('application/json');

    await webPlatform.saveFile(pdf(), 'trip.pdf', 'text/plain');
    expect((createObjectURL.mock.calls[1]![0] as Blob).type).toBe('application/pdf');
  });

  it('does not share on desktop even when the browser could share files', async () => {
    const { share } = installShare({ canShare: true });
    expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('saved');
    expect(share).not.toHaveBeenCalled();
  });

  it('downloads on mobile when canShare({files}) is false', async () => {
    installMatchMedia(true);
    const { share, canShare } = installShare({ canShare: false });
    expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('saved');
    expect(canShare).toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1);
  });

  it('downloads on mobile when the Web Share API is missing', async () => {
    installMatchMedia(true);
    expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('saved');
    expect(clicks).toHaveLength(1);
  });
});

describe('webPlatform.saveFile — share (mobile)', () => {
  beforeEach(() => installMatchMedia(true));

  it('shares the file and returns "shared"', async () => {
    const { share, canShare } = installShare({ canShare: true });
    expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('shared');

    const files = (canShare.mock.calls[0] as unknown as [ShareData])[0].files!;
    expect(files[0]!.name).toBe('trip.pdf');
    expect(files[0]!.type).toBe('application/pdf');
    expect(share).toHaveBeenCalledTimes(1);
    expect(clicks).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('returns "cancelled" when the user dismisses the share sheet (AbortError)', async () => {
    installShare({
      canShare: true,
      share: () => Promise.reject(new DOMException('Share canceled', 'AbortError')),
    });
    expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('cancelled');
    expect(clicks).toHaveLength(0);
  });

  it('falls back to download on other share errors', async () => {
    installShare({
      canShare: true,
      share: () => Promise.reject(new DOMException('No user activation', 'NotAllowedError')),
    });
    expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('saved');
    expect(clicks).toHaveLength(1);
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('falls back to download when canShare throws', async () => {
    defineNav('share', vi.fn());
    defineNav(
      'canShare',
      vi.fn(() => {
        throw new TypeError('bad');
      }),
    );
    expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('saved');
  });

  it('treats userAgentData.mobile as a mobile context', async () => {
    installMatchMedia(false);
    defineNav('userAgentData' as 'share', { mobile: true });
    const { share } = installShare({ canShare: true });
    try {
      expect(await webPlatform.saveFile(pdf(), 'trip.pdf')).toBe('shared');
      expect(share).toHaveBeenCalled();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userAgentData;
    }
  });
});

describe('webPlatform online status', () => {
  it('reads navigator.onLine', () => {
    defineNav('onLine', false);
    expect(webPlatform.isOnline()).toBe(false);
    defineNav('onLine', true);
    expect(webPlatform.isOnline()).toBe(true);
  });

  it('notifies subscribers on online/offline events until unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = webPlatform.subscribeOnline(listener);

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(listener.mock.calls).toEqual([[false], [true]]);

    unsubscribe();
    window.dispatchEvent(new Event('offline'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
