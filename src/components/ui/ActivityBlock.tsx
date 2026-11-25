import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDurationHe, isHexColor, normalizeHexColor, PALETTE } from '@/domain';
import {
  activityBlockHeight,
  isShortBlock,
  nameLineLimit,
  SLOT_HEIGHT_PX,
} from './activityBlockLayout';
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
  /**
   * Set while deleting is impossible (e.g. offline, M7.3): the × stays in place and focusable but
   * is `aria-disabled`, ignores clicks, and offers this reason as its title / description.
   */
  deleteDisabledReason?: string;
  /** Pixel height of one slot. Keep the default so bank and timetable share one scale. */
  slotHeight?: number;
}

const FALLBACK_COLOR = PALETTE[PALETTE.length - 1];

// Unprefixed only: a variant such as `tablet:absolute` already sorts after a base `relative`.
const POSITION_CLASS = /(?:^|\s)(?:absolute|fixed|sticky|relative)(?:\s|$)/;

/** True if the caller positions the block itself (a position class or `style.position`). */
function hasOwnPosition(className: string | undefined, style: CSSProperties | undefined): boolean {
  return Boolean(style?.position) || (className !== undefined && POSITION_CLASS.test(className));
}

/**
 * A colored activity block, used in the bank and in the timetable (prototype `.block`).
 * Height is proportional to the duration; a one-slot block switches to a single-line "short"
 * layout; taller blocks clamp the name (ellipsis, full name in `title`) so the meta line always
 * stays visible (UX-8). Text uses the `block-ink` tokens, which pass WCAG AA on every palette color.
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
    deleteDisabledReason,
    slotHeight = SLOT_HEIGHT_PX,
    className,
    style,
    ...rest
  },
  ref,
) {
  const { t } = useTranslation();
  const short = isShortBlock(durationMinutes);
  const blockColor = isHexColor(color) ? normalizeHexColor(color) : FALLBACK_COLOR;
  const subtitle = meta ?? formatDurationHe(durationMinutes);
  const deleteDisabled = deleteDisabledReason !== undefined;

  const bodyClass = cx(
    'flex size-full min-w-0 px-2.5 text-start text-block-ink',
    short ? 'flex-row items-center gap-1.5 py-0' : 'flex-col items-stretch justify-start py-1.5',
    onDelete && 'pe-7',
  );

  const content = (
    <>
      <span
        className={cx(
          'text-[13px] leading-[1.3] font-semibold',
          short
            ? 'block min-w-0 flex-1 truncate'
            : // UX-8: clamp the name so the meta line below always fits the fixed height.
              'line-clamp-(--name-lines) shrink-0 [overflow-wrap:anywhere]',
        )}
        style={
          short
            ? undefined
            : ({ '--name-lines': nameLineLimit(durationMinutes, slotHeight) } as CSSProperties)
        }
      >
        {name}
      </span>
      {/* A real space so the name computed from content reads "קפה 09:00–10:00" whatever the CSS
          display. Whitespace-only text between flex items is not rendered, so layout is unchanged. */}{' '}
      <span
        className={cx(
          'block text-[11.5px] leading-[1.5] text-block-ink-soft',
          short ? 'shrink-0 whitespace-nowrap' : 'mt-px shrink-0',
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
        // The × is positioned against the block, so it needs a containing block — but a caller's
        // own positioning (e.g. `absolute` in the timetable) must win, and Tailwind's CSS order
        // would let `relative` override it. So `relative` is only the fallback.
        !hasOwnPosition(className, style) && 'relative',
        'group shrink-0 overflow-hidden rounded-[var(--radius-block)] border',
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
          // The accessible name comes from the visible content ("name meta"), so it always
          // contains the visible text in order (WCAG 2.5.3 Label in Name; axe
          // label-content-name-mismatch). Don't add aria-label / aria-labelledby here.
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
          // aria-disabled (not `disabled`), so a focused × keeps focus when the connection drops.
          onClick={deleteDisabled ? undefined : onDelete}
          aria-disabled={deleteDisabled || undefined}
          title={deleteDisabledReason}
          aria-label={t('common.activityBlock.delete', { name })}
          // The timetable's pointer engine (M5) never starts a drag from elements marked like this.
          data-no-drag=""
          className={cx(
            'absolute end-1 grid size-5 place-items-center rounded-full border-0 bg-panel/75 p-0',
            'text-sm leading-none text-ink-soft transition',
            deleteDisabled
              ? 'cursor-not-allowed'
              : 'cursor-pointer hover:bg-panel hover:text-danger-ink',
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
