import { useTranslation } from 'react-i18next';
import { cx } from '@/components/ui';
import { formatShortDate, formatWeekday, type IsoDate } from '@/domain';

export interface DaySwitcherProps {
  /** All trip days. */
  days: readonly IsoDate[];
  /** Trip day index shown now. */
  index: number;
  onChange: (index: number) => void;
  /** Id of the (visually hidden) day heading that labels the day column. */
  headingId: string;
}

/**
 * Header of the phone's single-day timetable (M7.1): previous / next day buttons around a day
 * picker (a native select, so a long trip can jump straight to any day). Lives in the sticky header
 * cell, so it costs no extra height. The day change is announced through a polite status region.
 */
export function DaySwitcher({ days, index, onChange, headingId }: DaySwitcherProps) {
  const { t } = useTranslation();
  const date = days[index];
  if (!date) return null;
  const label = (d: IsoDate, i: number) =>
    t('schedule.day.option', { weekday: formatWeekday(d), date: formatShortDate(d), n: i + 1 });
  const first = index === 0;
  const last = index === days.length - 1;
  return (
    <div className="flex h-full items-center gap-1">
      <h3 id={headingId} className="sr-only">
        {label(date, index)}
      </h3>
      <StepButton
        label={t('schedule.day.previous')}
        disabled={first}
        onClick={() => onChange(index - 1)}
        towards="start"
      />
      <div className="relative flex min-w-0 flex-1">
        <select
          aria-label={t('schedule.day.choose')}
          value={index}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cx(
            'min-h-10 min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-lg bg-transparent ps-1 pe-5 text-center text-sm font-semibold text-ink',
            'hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent-ink',
          )}
        >
          {days.map((d, i) => (
            <option key={d} value={i}>
              {label(d, i)}
            </option>
          ))}
        </select>
        {/* Small "opens a list" cue; clicks go through to the select. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="pointer-events-none absolute end-1.5 top-1/2 size-3 -translate-y-1/2 text-ink-soft"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <StepButton
        label={t('schedule.day.next')}
        disabled={last}
        onClick={() => onChange(index + 1)}
        towards="end"
      />
      <span role="status" className="sr-only">
        {t('schedule.day.status', {
          n: index + 1,
          total: days.length,
          weekday: formatWeekday(date),
          date: formatShortDate(date),
        })}
      </span>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  towards,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  /** Inline direction the arrow points to: the previous day lies at the start (right in RTL). */
  towards: 'start' | 'end';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // aria-disabled instead of disabled: the button keeps focus at the first / last day.
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cx(
        'grid size-10 shrink-0 place-items-center rounded-full text-ink',
        'hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent-ink',
        'aria-disabled:cursor-default aria-disabled:opacity-35 aria-disabled:hover:bg-transparent',
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className={cx(
          'size-5',
          // Drawn pointing left (the start side in LTR); mirrored to the right in RTL.
          towards === 'start' ? 'rtl:-scale-x-100' : 'ltr:-scale-x-100',
        )}
      >
        <path
          d="M12.5 4.5 7 10l5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
