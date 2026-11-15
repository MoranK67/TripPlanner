import { createContext, useContext } from 'react';

/**
 * Why editing is switched off for a reason other than "offline" (M7.3b), or undefined. Set by
 * the auth feature while the app only shows a stored, not yet renewed session: the user is not
 * verified by the server then, so nothing may be written (read-only cached view).
 */
export const EditLockContext = createContext<string | undefined>(undefined);

/** The current lock reason (undefined when editing is not locked). */
export function useEditLock(): string | undefined {
  return useContext(EditLockContext);
}
