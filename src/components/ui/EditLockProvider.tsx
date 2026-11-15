import type { ReactNode } from 'react';
import { EditLockContext } from './editLockContext';

/**
 * Turns every `useCanEdit()` below it off with `reason` (Hebrew); `undefined` = no lock (M7.3b).
 * AuthProvider sets it while only a stored, not yet renewed session is known.
 */
export function EditLockProvider({
  reason,
  children,
}: {
  reason: string | undefined;
  children: ReactNode;
}) {
  return <EditLockContext.Provider value={reason}>{children}</EditLockContext.Provider>;
}
