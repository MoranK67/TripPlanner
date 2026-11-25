import { useId, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { activityBlockHeight, Button, cx } from '@/components/ui';
import { SLOT_MINUTES, SLOTS_PER_DAY, type Activity, type PlacementCheck } from '@/domain';
import { dayPx, timeRangeLabel, type TimetableMetrics } from '../timetableLayout';

export interface PlacingPreviewProps {
  /** Visible column of the previewed day, and the number of visible columns. */
  column: number;
  columnCount: number;
  /** Previewed start slot (0 = 00:00). */
  slot: number;
  subject: Activity;
  /** `canPlace` at the previewed slot. */
  check: PlacementCheck;
  metrics: TimetableMetrics;
  /** A new object asks once for focus on the confirm button (a tap made this preview). */
  focusRequest: object | null;
  onNudge: (delta: -1 | 1) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Room kept for the button row under (or above) the ghost: touch buttons plus a reason line. */
const TOOLBAR_ROOM_PX = 84;
const GAP_PX = 4;

/**
 * Phone tap-to-place preview (PHONE-2): where the activity would go, before anything is saved.
 * A ghost at the tapped slot — green when `canPlace` allows it, red when not — and next to it
 * buttons to move it half an hour earlier / later, to confirm ("שבץ") and to cancel the mode.
 * An invalid slot cannot be confirmed: the confirm button is `aria-disabled` (it keeps focus) and
 * the reason is shown and attached as its description.
 */
export function PlacingPreview({
  column,
  columnCount,
  slot,
  subject,
  check,
  metrics,
  focusRequest,
  onNudge,
  onConfirm,
  onCancel,
}: PlacingPreviewProps) {
  const { t } = useTranslation();
  const reasonId = useId();
  const ghostRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { slotHeight, headerPx } = metrics;

  const top = slot * slotHeight + 1;
  const height = activityBlockHeight(subject.durationMinutes, slotHeight);
  const time = timeRangeLabel(slot * SLOT_MINUTES, subject.durationMinutes);
  // Under the ghost, unless the day ends first: then above it.
  const below = top + height + GAP_PX + TOOLBAR_ROOM_PX <= dayPx(slotHeight);
  const columnBox = {
    insetInlineStart: `calc(${column} * 100% / ${columnCount} + 4px)`,
    width: `calc(100% / ${columnCount} - 8px)`,
  };

  // Keep the preview and its buttons on screen as it moves (the header must not hide the ghost).
  useLayoutEffect(() => {
    toolbarRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    ghostRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [slot]);

  const served = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!focusRequest || served.current === focusRequest) return;
    served.current = focusRequest;
    confirmRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  const first = slot === 0;
  const last = slot === SLOTS_PER_DAY - 1;

  return (
    <>
      <div
        ref={ghostRef}
        aria-hidden="true"
        data-testid="placing-preview"
        data-valid={check.ok}
        className={cx(
          'pointer-events-none absolute z-[3] flex items-center gap-1.5 overflow-hidden rounded-[var(--radius-block)] border-2 border-dashed px-2 text-[12px] leading-tight text-ink',
          check.ok ? 'border-ok bg-ok/30' : 'border-danger-ink/50 bg-danger/50',
        )}
        style={{ ...columnBox, top, height, scrollMarginTop: headerPx }}
      >
        <span className="min-w-0 truncate font-semibold">{subject.name}</span>
        <span className="shrink-0 whitespace-nowrap">{time}</span>
      </div>
      <div
        className="pointer-events-none absolute z-[3] flex justify-start"
        style={{
          ...columnBox,
          ...(below
            ? { top: top + height + GAP_PX }
            : { top: Math.max(0, top - GAP_PX - TOOLBAR_ROOM_PX), height: TOOLBAR_ROOM_PX }),
          alignItems: below ? 'flex-start' : 'flex-end',
        }}
      >
        <div
          ref={toolbarRef}
          role="group"
          aria-label={t('schedule.preview.label', { name: subject.name, time })}
          data-testid="placing-preview-toolbar"
          style={{ scrollMarginTop: headerPx }}
          className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-[var(--radius-card)] border border-line bg-panel p-1 shadow-[var(--shadow-pop)]"
        >
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('schedule.preview.earlier')}
            aria-disabled={first || undefined}
            onClick={first ? undefined : () => onNudge(-1)}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          >
            <span aria-hidden="true">▲</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('schedule.preview.later')}
            aria-disabled={last || undefined}
            onClick={last ? undefined : () => onNudge(1)}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          >
            <span aria-hidden="true">▼</span>
          </Button>
          <Button
            ref={confirmRef}
            size="sm"
            variant="primary"
            aria-disabled={!check.ok || undefined}
            aria-describedby={check.ok ? undefined : reasonId}
            onClick={check.ok ? onConfirm : undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          >
            {t('schedule.preview.confirm')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          {!check.ok && (
            <p
              id={reasonId}
              className="m-0 basis-full px-1 pb-0.5 text-xs leading-snug text-danger-ink"
            >
              {t(`errors.kinds.${check.reason}`)}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
