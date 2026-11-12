// Platform adapter (contract — PROJECT_PLAN §7.4).
// Features never check the platform themselves; they call `platform.*`.
// Tauri / Capacitor implementations are added in M8–M9.

export type PlatformKind = 'web' | 'desktop' | 'android' | 'ios';
export type SaveResult = 'saved' | 'shared' | 'cancelled';

export interface Platform {
  kind: PlatformKind;
  saveFile(blob: Blob, suggestedName: string): Promise<SaveResult>;
  isOnline(): boolean;
}

const webPlatform: Platform = {
  kind: 'web',
  async saveFile(blob, suggestedName) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'saved';
  },
  isOnline: () => navigator.onLine,
};

export const platform: Platform = webPlatform;
