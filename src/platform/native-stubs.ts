// Placeholders for the native shells (Tauri desktop, Capacitor Android / iOS).
// Deferred by DEC-027 (web-only MVP). They are selected only inside a native shell,
// never on the web. Connectivity uses the WebView's browser APIs, which native
// WebViews support; file saving must get a real native implementation.
import { browserIsOnline, browserSubscribeOnline } from './web';
import { PlatformNotImplementedError, type Platform, type PlatformKind } from './types';

export function createNativeStub(kind: Exclude<PlatformKind, 'web'>): Platform {
  return {
    kind,
    saveFile() {
      return Promise.reject(new PlatformNotImplementedError(kind, 'saveFile'));
    },
    isOnline: browserIsOnline,
    subscribeOnline: browserSubscribeOnline,
  };
}
