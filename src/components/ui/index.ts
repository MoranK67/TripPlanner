// Public API of the UI primitives (contract — PROJECT_PLAN §10.2).
// Owned by frontend-engineer. Import from '@/components/ui', never from individual files.
export { ActivityBlock, type ActivityBlockProps } from './ActivityBlock';
export {
  activityBlockHeight,
  BLOCK_GAP_PX,
  blockSlots,
  isShortBlock,
  SLOT_HEIGHT_PX,
} from './activityBlockLayout';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Card } from './Card';
export { ColorSwatches, type ColorSwatchesProps } from './ColorSwatches';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { Field, type FieldProps } from './Field';
export { useFieldControlProps } from './fieldContext';
export { HeaderActions, HeaderSlotProvider } from './HeaderActions';
export { Input, type InputProps } from './Input';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export { PALETTE_COLOR_KEYS } from './paletteColorKeys';
export { PagePlaceholder } from './PagePlaceholder';
export { Select, type SelectProps } from './Select';
export { SidebarLayout, type SidebarLayoutProps } from './SidebarLayout';
export { Textarea, type TextareaProps } from './Textarea';
export { ToastProvider } from './ToastProvider';
export { useToast, type ToastApi, type ToastOptions, type ToastTone } from './toastContext';
export { cx } from './cx';
export { BREAKPOINTS, useBreakpoint, type Breakpoint } from './useBreakpoint';
