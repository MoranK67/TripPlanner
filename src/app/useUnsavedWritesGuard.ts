import { useIsMutating, type Mutation } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Mutation keys that change data on the server: trips (create / update / delete), activities
 * (bank create / update / delete, text import), timetable placement and the backup import.
 * Reads that happen to be mutations (building the backup file) and sign-in / sign-out are left out.
 */
export function isDataWrite(mutationKey: readonly unknown[] | undefined): boolean {
  const [scope, action] = mutationKey ?? [];
  if (scope === 'trips' || scope === 'activities' || scope === 'placement') return true;
  return scope === 'backup' && action === 'import';
}

const pendingWrite = (mutation: Mutation<unknown, Error, unknown, unknown>) =>
  isDataWrite(mutation.options.mutationKey);

/**
 * While a write is still on its way (incl. queued placement writes, DEC-031), closing or reloading
 * the tab asks "leave the site?" (UX-4). Best effort: desktop browsers show their own generic
 * text; mobile browsers often skip the prompt.
 */
export function useUnsavedWritesGuard() {
  const writing = useIsMutating({ predicate: pendingWrite }) > 0;
  useEffect(() => {
    if (!writing) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Chromium / Safari only prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [writing]);
}
