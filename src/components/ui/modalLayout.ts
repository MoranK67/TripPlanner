import { createContext } from 'react';

/**
 * True inside a Modal that becomes full-screen on phones (PHONE-1); read by <ModalActions> to
 * stick the action row to the bottom.
 */
export const ModalLayoutContext = createContext(false);

/**
 * Put on a <form> (or other wrapper) that holds a dialog's <ModalActions>, so that in a
 * full-screen phone dialog it fills the height and the action row reaches the bottom. Only
 * `max-tablet:` classes: no effect on tablet / desktop.
 */
export const MODAL_FORM_CLASS = 'max-tablet:flex max-tablet:grow max-tablet:flex-col';
