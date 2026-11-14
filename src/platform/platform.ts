import { detectPlatformKind } from './detect';
import { createNativeStub } from './native-stubs';
import type { Platform, PlatformKind } from './types';
import { webPlatform } from './web';

export function selectPlatform(kind: PlatformKind): Platform {
  return kind === 'web' ? webPlatform : createNativeStub(kind);
}

/** The platform the app is running on. Features use only this object. */
export const platform: Platform = selectPlatform(detectPlatformKind());
