import { useSyncExternalStore } from 'react';
import { platform } from './platform';

const subscribe = (onChange: () => void) => platform.subscribeOnline(() => onChange());
const getSnapshot = () => platform.isOnline();
const getServerSnapshot = () => true;

/** React hook: current connectivity, re-rendering on online/offline events (for M7.3). */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
