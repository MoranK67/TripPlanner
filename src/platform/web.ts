// Web implementation of the platform adapter (desktop browsers, Android Chrome, iPhone Safari / PWA).
import type { OnlineListener, Platform, SaveResult } from './types';

/** How long the object URL stays alive after the download click (Safari needs it to outlive the click). */
export const REVOKE_DELAY_MS = 4000;

/**
 * True on phones / tablets, where a share sheet is the natural way to keep a file
 * (on iOS a plain download only opens a preview). Desktop browsers — including
 * touch-screen laptops whose primary pointer is a mouse/trackpad — get a download.
 */
export function isTouchContext(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function withType(blob: Blob, mime: string | undefined): Blob {
  if (!mime || blob.type) return blob;
  return new Blob([blob], { type: mime });
}

/** Returns a File ready to share, or null when the share path must not be used. */
function shareableFile(blob: Blob, name: string): File | null {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return null;
  }
  if (!isTouchContext()) return null;
  const file = new File([blob], name, { type: blob.type });
  try {
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

export function downloadBlob(blob: Blob, suggestedName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Revoking synchronously can abort the download in Safari / Firefox.
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}

async function saveFile(blob: Blob, suggestedName: string, mime?: string): Promise<SaveResult> {
  const typed = withType(blob, mime);
  const file = shareableFile(typed, suggestedName);
  if (file) {
    try {
      await navigator.share({ files: [file], title: suggestedName });
      return 'shared';
    } catch (error) {
      if (isAbortError(error)) return 'cancelled';
      // NotAllowedError (user activation expired), DataError, etc. → plain download.
    }
  }
  downloadBlob(typed, suggestedName);
  return 'saved';
}

export function browserIsOnline(): boolean {
  // Treat a missing API as online so nothing is blocked by mistake.
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
}

export function browserSubscribeOnline(listener: OnlineListener): () => void {
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

export const webPlatform: Platform = {
  kind: 'web',
  saveFile,
  isOnline: browserIsOnline,
  subscribeOnline: browserSubscribeOnline,
};
