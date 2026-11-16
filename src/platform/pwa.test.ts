import type { RegisterSWOptions } from 'virtual:pwa-register';
import { createPwaUpdater, UPDATE_CHECK_INTERVAL_MS, type RegisterSW } from './pwa';

function fakeRegister() {
  let options: RegisterSWOptions = {};
  const updateSW = vi.fn(() => Promise.resolve());
  const register = vi.fn<RegisterSW>((opts) => {
    options = opts;
    return updateSW;
  });
  return { register, updateSW, options: () => options };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPwaUpdater', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('registers once, even when started several times', async () => {
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    updater.start();
    updater.start();
    await flush();
    expect(fake.register).toHaveBeenCalledTimes(1);
  });

  it('never lets the plugin reload the page on its own', async () => {
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    updater.start();
    await flush();
    // Providing onNeedReload is what stops registerSW from calling location.reload().
    expect(fake.options().onNeedReload).toEqual(expect.any(Function));
  });

  it('reports a waiting version, hides it on dismiss and notifies subscribers', async () => {
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    const listener = vi.fn();
    updater.subscribe(listener);
    updater.start();
    await flush();

    fake.options().onNeedRefresh?.();
    expect(updater.getState()).toEqual({ needRefresh: true, reloadNeeded: false });
    expect(listener).toHaveBeenCalledTimes(1);

    updater.dismiss();
    expect(updater.getState().needRefresh).toBe(false);
  });

  it('marks the page for reload when the new version takes control', async () => {
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    updater.start();
    await flush();
    fake.options().onNeedReload?.();
    expect(updater.getState().reloadNeeded).toBe(true);
  });

  it('applyUpdate activates the waiting version through updateSW', async () => {
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    updater.start();
    await updater.applyUpdate();
    expect(fake.updateSW).toHaveBeenCalledTimes(1);
  });

  it('applyUpdate before start does nothing', async () => {
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    await updater.applyUpdate();
    expect(fake.updateSW).not.toHaveBeenCalled();
  });

  it('checks for a new deployment periodically while online', async () => {
    vi.useFakeTimers();
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    updater.start();
    await vi.advanceTimersByTimeAsync(0);
    const update = vi.fn(() => Promise.resolve());
    fake.options().onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('skips the periodic check while offline', async () => {
    vi.useFakeTimers();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fake = fakeRegister();
    const updater = createPwaUpdater(() => Promise.resolve(fake.register));
    updater.start();
    await vi.advanceTimersByTimeAsync(0);
    const update = vi.fn(() => Promise.resolve());
    fake.options().onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(update).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    onLine.mockRestore();
  });

  it('survives a failing registration (app keeps working online)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const updater = createPwaUpdater(() => Promise.reject(new Error('no sw')));
    updater.start();
    await flush();
    await expect(updater.applyUpdate()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
