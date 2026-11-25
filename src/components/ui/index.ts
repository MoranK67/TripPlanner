// Public API of the UI primitives (contract — PROJECT_PLAN §10.2).
// Owned by frontend-engineer. Import from '@/components/ui', never from individual files.
export { ActivityBlock, type ActivityBlockProps } from './ActivityBlock';
export {
  activityBlockHeight,
  BLOCK_GAP_PX,
  blockSlots,
  isShortBlock,
  SLOT_HEIGHT_PX,
  SlotHeightContext,
  useSlotHeight,
} from './activityBlockLayout';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Card } from './Card';
export { ColorSwatches, type ColorSwatchesProps } from './ColorSwatches';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { Field, type FieldProps } from './Field';
export { FormError } from './FormError';
export { useFieldControlProps } from './fieldContext';
export { HeaderActions, HeaderSlotProvider } from './HeaderActions';
export {
  HeaderAction,
  HeaderMenuButton,
  HeaderMenuProvider,
  type HeaderActionProps,
} from './HeaderMenu';
export { useHeaderMenuCollapsed, useHeaderMenuNote } from './headerMenuContext';
export { Input, type InputProps } from './Input';
export { LoadingState, type LoadingStateProps } from './LoadingState';
export { MenuButton, type MenuButtonProps, type MenuItem } from './MenuButton';
export {
  Modal,
  ModalActions,
  type ModalPhoneLayout,
  type ModalProps,
  type ModalSize,
} from './Modal';
export { MODAL_FORM_CLASS } from './modalLayout';
export { OfflineNote } from './OfflineNote';
export { PALETTE_COLOR_KEYS } from './paletteColorKeys';
export { PagePlaceholder } from './PagePlaceholder';
export { Select, type SelectProps } from './Select';
export { SidebarLayout, type SidebarLayoutProps } from './SidebarLayout';
export { Textarea, type TextareaProps } from './Textarea';
export { TimeInput, type TimeInputProps } from './TimeInput';
export { parseHhmm, type HhmmError, type HhmmOptions, type HhmmResult } from './parseHhmm';
export { ToastProvider } from './ToastProvider';
export { useToast, type ToastApi, type ToastOptions, type ToastTone } from './toastContext';
export { cx } from './cx';
export { BREAKPOINTS, useBreakpoint, type Breakpoint } from './useBreakpoint';
export { EditLockProvider } from './EditLockProvider';
export { useCanEdit, type CanEdit } from './useCanEdit';
