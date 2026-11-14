// Platform adapter (contract — PROJECT_PLAN §7.4).
// Features never check the platform themselves; they call `platform.*`.
// Web is implemented; Tauri / Capacitor are stubs until the native shells return (DEC-027).

export type { OnlineListener, Platform, PlatformKind, SaveResult } from './types';
export { PlatformNotImplementedError } from './types';
export { platform } from './platform';
export { useOnlineStatus } from './useOnlineStatus';
