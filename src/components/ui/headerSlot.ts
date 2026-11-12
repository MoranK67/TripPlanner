import { createContext } from 'react';

/**
 * The element in the app header where pages render their own controls (trip picker, actions —
 * prototype `.trip-bar`). Provided by the app layout; `null` outside it.
 */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);
