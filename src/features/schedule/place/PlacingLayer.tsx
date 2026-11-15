import { memo, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { activityBlockHeight, cx, SLOT_HEIGHT_PX } from '@/components/ui';
import {
  formatShortDate,
  formatWeekday,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  type Activity,
  type IsoDate,
  type PlacementCheck,
  type TripWindow,
} from '@/domain';
import { timeRangeLabel } from '../timetableLayout';
import {
  dayChecks,
  isCursorKey,
  placedByDate,
  validRuns,
  type CursorKey,
  type SlotCursor,
} from './placingModel';

/** Ask the layer to focus the cursor's slot button after the next render. */
export interface FocusRequest {
  /** Each request is a new object; it is served once. */
  preventScroll: boolean;
  /**
   * The day the cursor will be on. On a phone the shown day changes a render later (the timetable
   * reports its view in an effect), so focus waits until the layer shows that day.
   */
  dayIndex: number;
}

export interface PlacingLayerProps {
  /** All trip days. */
  days: readonly IsoDate[];
  /** Trip day index of the first visible column and the number of visible columns. */
  firstDay: number;
  dayCount: number;
  tripWindow: TripWindow;
  activities: readonly Activity[];
  /** The activity being placed. */
  subject: Activity;
  /** Keyboard cursor. Its day gets the slot buttons; other visible days take pointer taps. */
  cursor: SlotCursor;
  focusRequest: FocusRequest | null;
  /** A slot was chosen (tap, click, Enter or Space). The caller checks it with `canPlace`. */
  onChoose: (dayIndex: number, slot: number) => void;
  onCursorKey: (key: CursorKey) => void;
}

/**
 * The tap-to-place layer (FR-5.5, FR-5.6) inside the timetable's day-columns layer, under the
 * blocks: valid start slots of every visible day are tinted (one element per run, not per slot),
 * a tap on a day column chooses the slot under the finger. The cursor's day also gets one button
 * per half hour (a roving tab stop: one Tab stop, arrow keys move) so keyboard and screen-reader
 * users can choose too; invalid slots stay focusable but are `aria-disabled` and say why not.
 * Only one day has buttons, so a 90-day trip adds 48 buttons, not 4,320 (NFR-3).
 */
export function PlacingLayer({
  days,
  firstDay,
  dayCount,
  tripWindow,
  activities,
  subject,
  cursor,
  focusRequest,
  onChoose,
  onCursorKey,
}: PlacingLayerProps) {
  const { t } = useTranslation();
  const layerRef = useRef<HTMLDivElement>(null);
  const byDate = useMemo(() => placedByDate(activities), [activities]);
  const visible = useMemo(
    () => days.slice(firstDay, firstDay + dayCount),
    [days, firstDay, dayCount],
  );
  // Validity of every visible start slot; recomputed only when the data or the visible days change.
  const checks = useMemo(
    () => visible.map((date) => dayChecks(tripWindow, byDate.get(date) ?? [], subject, date)),
    [visible, tripWindow, byDate, subject],
  );

  const served = useRef<FocusRequest | null>(null);
  useLayoutEffect(() => {
    if (!focusRequest || served.current === focusRequest) return;
    if (cursor.dayIndex !== focusRequest.dayIndex) return;
    const button = layerRef.current?.querySelector<HTMLButtonElement>('[data-cursor="true"]');
    if (!button) return;
    served.current = focusRequest;
    button.focus({ preventScroll: focusRequest.preventScroll });
  }, [focusRequest, cursor.dayIndex, cursor.slot]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isCursorKey(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    onCursorKey(e.key);
  };

  return (
    <div
      ref={layerRef}
      data-testid="placing-layer"
      className="pointer-events-none absolute inset-0 z-[1]"
      onKeyDown={onKeyDown}
    >
      {visible.map((date, column) => {
        const dayIndex = firstDay + column;
        const dayChecksOf = checks[column];
        if (!dayChecksOf) return null;
        const dayLabel = t('schedule.day.option', {
          weekday: formatWeekday(date),
          date: formatShortDate(date),
          n: dayIndex + 1,
        });
        return (
          <PlacingDay
            key={date}
            column={column}
            columnCount={dayCount}
            dayIndex={dayIndex}
            dayLabel={dayLabel}
            checks={dayChecksOf}
            subject={subject}
            cursorSlot={cursor.dayIndex === dayIndex ? cursor.slot : null}
            onChoose={onChoose}
          />
        );
      })}
    </div>
  );
}

interface PlacingDayProps {
  column: number;
  columnCount: number;
  dayIndex: number;
  dayLabel: string;
  checks: PlacementCheck[];
  subject: Activity;
  /** Slot of the keyboard cursor when it is on this day; `null` = no buttons on this day. */
  cursorSlot: number | null;
  onChoose: (dayIndex: number, slot: number) => void;
}

const PlacingDay = memo(function PlacingDay({
  column,
  columnCount,
  dayIndex,
  dayLabel,
  checks,
  subject,
  cursorSlot,
  onChoose,
}: PlacingDayProps) {
  const { t } = useTranslation();
  const runs = useMemo(() => validRuns(checks), [checks]);

  // A tap anywhere in the column (outside the slot buttons) chooses the slot under the pointer.
  const onColumnClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    const top = e.currentTarget.getBoundingClientRect().top;
    const slot = Math.floor((e.clientY - top) / SLOT_HEIGHT_PX);
    if (slot >= 0 && slot < SLOTS_PER_DAY) onChoose(dayIndex, slot);
  };

  const cursorCheck = cursorSlot === null ? null : checks[cursorSlot];

  return (
    <div
      data-testid="placing-day"
      data-day-index={dayIndex}
      className="group/day pointer-events-auto absolute inset-y-0 cursor-pointer"
      style={{
        insetInlineStart: `calc(${column} * 100% / ${columnCount})`,
        width: `calc(100% / ${columnCount})`,
      }}
      onClick={onColumnClick}
    >
      {runs.map((run) => (
        <div
          key={run.start}
          aria-hidden="true"
          data-valid-run=""
          className="absolute inset-x-1 rounded-[var(--radius-block)] border border-dashed border-ok bg-ok/20"
          style={{
            top: run.start * SLOT_HEIGHT_PX + 1,
            height: (run.end - run.start) * SLOT_HEIGHT_PX - 2,
          }}
        />
      ))}
      {cursorSlot !== null && (
        <div
          role="group"
          aria-label={t('schedule.place.slots', { name: subject.name, day: dayLabel })}
        >
          {checks.map((check, slot) => {
            const time = timeRangeLabel(slot * SLOT_MINUTES, subject.durationMinutes);
            const isCursor = slot === cursorSlot;
            return (
              <button
                key={slot}
                type="button"
                data-slot={slot}
                data-cursor={isCursor || undefined}
                tabIndex={isCursor ? 0 : -1}
                aria-disabled={!check.ok || undefined}
                aria-label={t(check.ok ? 'schedule.place.slot' : 'schedule.place.slotUnavailable', {
                  time,
                  day: dayLabel,
                })}
                onClick={() => onChoose(dayIndex, slot)}
                className={cx(
                  'absolute inset-x-0 block cursor-pointer border-0 bg-transparent p-0',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ink',
                )}
                style={{ top: slot * SLOT_HEIGHT_PX, height: SLOT_HEIGHT_PX }}
              />
            );
          })}
        </div>
      )}
      {cursorCheck && cursorSlot !== null && (
        // Where Enter would put the block; shown while a slot button has keyboard focus.
        <div
          aria-hidden="true"
          data-testid="placing-cursor"
          data-valid={cursorCheck.ok}
          className={cx(
            'pointer-events-none absolute inset-x-1 hidden rounded-[var(--radius-block)] border-2 border-dashed',
            'group-has-[button:focus-visible]/day:block',
            cursorCheck.ok ? 'border-ok bg-ok/25' : 'border-danger-ink/40 bg-danger/40',
          )}
          style={{
            top: cursorSlot * SLOT_HEIGHT_PX + 1,
            height: activityBlockHeight(subject.durationMinutes),
          }}
        />
      )}
    </div>
  );
});
