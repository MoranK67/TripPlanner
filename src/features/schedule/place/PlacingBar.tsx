import { useTranslation } from 'react-i18next';
import { Button, cx } from '@/components/ui';
import type { Activity } from '@/domain';
import { usePlacing } from './placingContext';

export interface PlacingBarProps {
  /** The timetable's edit opener, used for a placed activity. */
  onOpenActivity: (activity: Activity) => void;
  /**
   * Phone (PHONE-2): one slim row at the bottom of the screen ("משבצים: <name>" and the buttons),
   * no hints — the bank sheet is out of the way, so the day keeps the room.
   */
  compact?: boolean;
}

/**
 * Shown under the timetable while an activity waits for a slot (tap-to-place, FR-5.5): what is
 * being placed, how, and the ways out — edit (a tap now picks blocks up instead of opening them),
 * back to the bank for a placed one, cancel. The mode itself is announced by the drag root's
 * status region, so this bar is not a live region.
 */
export function PlacingBar({ onOpenActivity, compact = false }: PlacingBarProps) {
  const { t } = useTranslation();
  const placing = usePlacing();
  const activity = placing?.activity;
  if (!placing || !activity) return null;
  const buttons = (
    <div className={cx('flex shrink-0', compact ? 'gap-1' : 'flex-wrap gap-1.5')}>
      <Button size="sm" variant="ghost" onClick={() => placing.edit(onOpenActivity)}>
        {t('schedule.place.edit')}
      </Button>
      {activity.placement && (
        <Button size="sm" onClick={placing.unplace}>
          {t('schedule.place.unplace')}
        </Button>
      )}
      <Button size="sm" variant="primary" onClick={placing.cancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
  if (compact) {
    return (
      <div
        data-testid="placing-bar"
        data-compact=""
        className="mt-1.5 mb-[env(safe-area-inset-bottom)] flex shrink-0 items-center gap-2 rounded-[var(--radius-card)] border border-accent-strong bg-accent-soft py-1 ps-3 pe-1"
      >
        <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {t('schedule.place.barShort', { name: activity.name })}
        </p>
        {buttons}
      </div>
    );
  }
  return (
    <div
      data-testid="placing-bar"
      className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-card)] border border-accent-strong bg-accent-soft px-3 py-2"
    >
      <p className="m-0 min-w-0 flex-1 basis-48 text-sm leading-snug text-ink">
        <span className="font-semibold">{t('schedule.place.bar', { name: activity.name })}</span>{' '}
        <span className="text-xs text-ink-soft pointer-coarse:hidden">
          {t('schedule.place.hintKeys')}
        </span>
        <span className="hidden text-xs text-ink-soft pointer-coarse:inline">
          {t('schedule.place.hintTouch')}
        </span>
      </p>
      {buttons}
    </div>
  );
}
