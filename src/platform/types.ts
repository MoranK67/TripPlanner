// Platform adapter contract (PROJECT_PLAN §7.4).
// Features never check the platform themselves; they call `platform.*`.

export type PlatformKind = 'web' | 'desktop' | 'android' | 'ios';

/**
 * Outcome of `saveFile`:
 * - `saved`     — the file was handed to the browser download / written to disk.
 * - `shared`    — the user completed the system share sheet.
 * - `cancelled` — the user dismissed the share sheet or save dialog.
 */
export type SaveResult = 'saved' | 'shared' | 'cancelled';

export type OnlineListener = (online: boolean) => void;

export interface Platform {
  kind: PlatformKind;
  /**
   * Save or share a generated file (PDF, JSON, ...).
   * `mime` is optional; it is applied only when the blob has no type of its own.
   */
  saveFile(blob: Blob, suggestedName: string, mime?: string): Promise<SaveResult>;
  isOnline(): boolean;
  /**
   * Subscribe to connectivity changes. The listener receives the new state.
   * Returns an unsubscribe function.
   */
  subscribeOnline(listener: OnlineListener): () => void;
}

export class PlatformNotImplementedError extends Error {
  constructor(kind: PlatformKind, method: string) {
    super(
      `platform.${method} is not implemented for "${kind}" yet ` +
        '(web-only MVP, DEC-027). Add the native implementation in src/platform.',
    );
    this.name = 'PlatformNotImplementedError';
  }
}
