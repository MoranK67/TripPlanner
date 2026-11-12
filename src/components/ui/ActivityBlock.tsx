import { forwardRef, useId, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDurationHe, isHexColor, normalizeHexColor, PALETTE } from '@/domain';
import { activityBlockHeight, isShortBlock, SLOT_HEIGHT_PX } from './activityBlockLayout';
import { cx } from './cx';

export interface ActivityBlockProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'color' | 'children' | 'onClick'
> {
  /** Activity name (1–60 characters). */
  name: string;
  /** Duration in minutes; sets the block height (FR-3.3). */
  durationMinutes: number;
  /** Block color — one of `PALETTE`. Anything that is not `#RRGGBB` falls back to the last one. */
  color: string;
  /**
   * Second line. Defaults to the duration ("שעה וחצי") as in the bank; placed blocks pass their
   * time range ("09:00–10:30", FR-4.5).
   */
  meta?: ReactNode;
  /** Opens the edit dialog (FR-3.5). When set, the block body is a button. */
  onOpen?: () => void;
  /** Shows the × button. The caller must confirm with ConfirmDialog before deleting (FR-3.4). */
  onDelete?: () => void;
  /** Pixel height of one slot. Keep the default so bank and timetable share one scale. */
  slotHeight?: number;
}

const FALLBACK_COLOR = PALETTE[PALETTE.length - 1];

/**
 * A colored activity block, used in the bank and in the timetable (prototype `.block`).
 * Height is proportional to the duration; a one-slot block switches to a single-line "short"
 * layout. Text uses the `block-ink` tokens, which pass WCAG AA on every palette color.
 *
 * Structure: an outer `div` (gets `ref`, `style`, `className` and any extra props — position it,
 * or attach drag handlers to it), an inner open button, and a sibling × button (buttons can't nest).
 */
export const ActivityBlock = forwardRef<HTMLDivElement, ActivityBlockProps>(function ActivityBlock(
  {
    name,
    durationMinutes,
    color,
    meta,
    onOpen,
    onDelete,
    slotHeight = SLOT_HEIGHT_PX,
    className,
    style,
    ...rest
  },
  ref,
) {
  const { t } = useTranslation();
  const id = useId();
  const short = isShortBlock(durationMinutes);
  const blockColor = isHexColor(color) ? normalizeHexColor(color) : FALLBACK_COLOR;
  const subtitle = meta ?? formatDurationHe(durationMinutes);

  const bodyClass = cx(
    'flex size-full min-w-0 px-2.5 text-start text-block-ink',
    short ? 'flex-row items-center gap-1.5 py-0' : 'flex-col items-stretch justify-start py-1.5',
    onDelete && 'pe-7',
  );

  const content = (
    <>
      <span
        id={`${id}-name`}
        className={cx(
          'block text-[13px] leading-[1.3] font-semibold',
          short ? 'min-w-0 flex-1 truncate' : '[overflow-wrap:anywhere]',
        )}
      >
        {name}
      </span>
      <span
        id={`${id}-meta`}
        className={cx(
          'block text-[11.5px] text-block-ink-soft',
          short ? 'shrink-0 whitespace-nowrap' : 'mt-px',
        )}
      >
        {subtitle}
      </span>
    </>
  );

  return (
    <div
      ref={ref}
      title={name}
      data-short={short || undefined}
      className={cx(
        'group relative shrink-0 overflow-hidden rounded-[var(--radius-block)] border',
        'border-[color-mix(in_srgb,var(--block-color),var(--color-block-edge)_16%)] bg-(--block-color)',
        'shadow-[var(--shadow-block)] transition-shadow hover:shadow-[var(--shadow-block-hover)]',
        className,
      )}
      style={
        {
          height: activityBlockHeight(durationMinutes, slotHeight),
          '--block-color': blockColor,
          ...style,
        } as CSSProperties
      }
      {...rest}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          // Name + meta as separate words ("קפה 09:00–10:00"), independent of CSS display.
          aria-labelledby={`${id}-name ${id}-meta`}
          className={cx(
            bodyClass,
            'cursor-pointer border-0 bg-transparent',
            // Inset outline: the block clips its overflow, an outer outline would be cut off.
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ink',
          )}
        >
          {content}
        </button>
      ) : (
        <div className={bodyClass}>{content}</div>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('common.activityBlock.delete', { name })}
          className={cx(
            'absolute end-1 grid size-5 cursor-pointer place-items-center rounded-full border-0 bg-panel/75 p-0',
            'text-sm leading-none text-ink-soft transition hover:bg-panel hover:text-danger-ink',
            // Hidden until the block is hovered or focused; always visible on touch screens.
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-85',
            'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent-ink',
            // Larger hit area for fingers than the 20 px circle.
            "before:absolute before:-inset-1.5 before:content-['']",
            short ? 'top-1/2 -translate-y-1/2' : 'top-1',
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
});
