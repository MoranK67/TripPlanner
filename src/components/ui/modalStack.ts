import { createContext } from 'react';

/**
 * Module-level stack of open modals. Keyboard (Esc / Tab) and focus containment are handled by
 * document-level listeners for the top-most modal only, so they keep working when focus has
 * fallen to <body> (e.g. the focused button became disabled or its row was deleted).
 */
export interface ModalEntry {
  /** The modal that renders this one (React tree), if any — used to order same-render opens. */
  parent: ModalEntry | null;
  getDialog: () => HTMLElement | null;
  /** Latest onClose, kept current by the Modal component. */
  close: () => void;
  /** Where focus goes when this modal closes. */
  restoreTo: HTMLElement | null;
  /** Focus the preferred element inside this modal. */
  focusInitial: () => void;
}

/** Lets a nested Modal know which modal renders it. */
export const ModalParentContext = createContext<ModalEntry | null>(null);

const stack: ModalEntry[] = [];
let savedOverflow = '';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

function isAncestor(maybeAncestor: ModalEntry, entry: ModalEntry): boolean {
  for (let p = entry.parent; p; p = p.parent) if (p === maybeAncestor) return true;
  return false;
}

export function topModal(): ModalEntry | undefined {
  return stack[stack.length - 1];
}

function onKeyDown(e: KeyboardEvent) {
  const top = topModal();
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    top.close();
    return;
  }
  if (e.key !== 'Tab') return;
  const dialog = top.getDialog();
  if (!dialog) return;
  const items = getFocusable(dialog);
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && dialog.contains(active);
  if (!first || !last) {
    e.preventDefault();
    dialog.focus();
  } else if (e.shiftKey && (!inside || active === first || active === dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

function onFocusIn(e: FocusEvent) {
  const top = topModal();
  const dialog = top?.getDialog();
  if (!top || !dialog) return;
  if (e.target instanceof Node && !dialog.contains(e.target)) top.focusInitial();
}

/**
 * Adds an opening modal. A parent whose effect runs after its child's (same render) is placed
 * below that child, so the innermost modal stays on top. Records the element to restore focus to.
 * Returns true if `entry` is now on top.
 */
export function pushModal(entry: ModalEntry): boolean {
  const active = document.activeElement;
  entry.restoreTo = active instanceof HTMLElement && active !== document.body ? active : null;
  if (stack.length === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
  }
  const childIndex = stack.findIndex((m) => isAncestor(entry, m));
  if (childIndex === -1) {
    stack.push(entry);
  } else {
    // Opened in the same commit as its child: the child already captured the focus to restore.
    const child = stack[childIndex] as ModalEntry;
    entry.restoreTo = child.restoreTo;
    child.restoreTo = null;
    stack.splice(childIndex, 0, entry);
  }
  return topModal() === entry;
}

/** Removes a closing modal and moves focus to the right place. */
export function removeModal(entry: ModalEntry): void {
  const index = stack.indexOf(entry);
  if (index === -1) return;
  const wasTop = index === stack.length - 1;
  stack.splice(index, 1);

  if (stack.length === 0) {
    document.body.style.overflow = savedOverflow;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn);
  }

  if (!wasTop) {
    // A parent closed under an open child (both are unmounting): hand the restore target up.
    const above = stack[index];
    if (above && isAncestor(entry, above)) above.restoreTo = entry.restoreTo;
    return;
  }

  const next = topModal();
  const target = entry.restoreTo;
  const nextDialog = next?.getDialog();
  if (next && nextDialog) {
    if (target?.isConnected && nextDialog.contains(target)) target.focus();
    else next.focusInitial();
  } else if (target?.isConnected) {
    target.focus();
  }
}
