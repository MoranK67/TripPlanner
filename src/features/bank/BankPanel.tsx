import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityBlock, Button, cx, useCanEdit } from '@/components/ui';
import { isInBank, matchesTag, tripTags, type Activity, type Trip } from '@/domain';
import { ImportDialog } from '@/features/import';
import { dragSourceProps, useBankDropZone } from '@/features/schedule';
import { TagFilter, type TagChip } from './TagFilter';
import { useTagFilter } from './tagFilterStore';
import { useActivityDialogs } from './useActivityDialogs';

export interface BankPanelProps {
  trip: Trip;
  /** All of the trip's activities; the panel shows the unplaced ones in bank order. */
  activities: readonly Activity[];
  /**
   * `panel` (default): a card with its own title, for the side panel (tablet / desktop).
   * `sheet`: inside the phone's bottom sheet (UX-7), whose handle already shows the title and
   * count, and which is itself the card. The title is kept for screen readers only (the sheet's
   * `aside` is named by its own label) and the panel drops its border and shadow.
   */
  variant?: 'panel' | 'sheet';
}

/** After a delete: which block gets focus once the deleted one has left the list. */
interface FocusAfterDelete {
  deletedId: string;
  /** The next block, else the previous one; `null` = the bank heading. */
  targetId: string | null;
}

/**
 * The activity bank (prototype `.bank`, FR-3.1–FR-3.5): unplaced activities ordered by
 * `bankPosition`, add / edit dialog, delete with confirmation. Blocks use the shared height scale
 * (FR-3.3). Phones show two blocks per row, as in the prototype.
 */
export function BankPanel({ trip, activities, variant = 'panel' }: BankPanelProps) {
  const sheet = variant === 'sheet';
  const { t } = useTranslation();
  const focusAfterDelete = useRef<FocusAfterDelete | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Offline the bank is read-only (M7.3): blocks still open (to view), but nothing can change.
  const { canEdit, reason } = useCanEdit();
  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  // Drag and drop (FR-5.1): blocks drag onto the timetable; placed blocks drop back here.
  const setDropZone = useBankDropZone();

  const bank = useMemo(
    () => activities.filter(isInBank).sort((a, b) => a.bankPosition - b.bankPosition),
    [activities],
  );

  // Tag filter (FEAT-2): chips for the tags of bank activities (colour = the trip-wide group
  // colour); the selected chip stays even when its last activity leaves the bank.
  const [tagFilter, setTagFilter] = useTagFilter(trip.id);
  const chips = useMemo<TagChip[]>(
    () =>
      tripTags(activities)
        .map((tag) => ({ ...tag, bankCount: bank.filter((a) => matchesTag(a, tag.key)).length }))
        .filter((chip) => chip.bankCount > 0 || chip.key === tagFilter),
    [activities, bank, tagFilter],
  );
  const activeChip = chips.find((chip) => chip.key === tagFilter) ?? null;
  // A selected tag that no activity has any more (renamed / deleted) shows everything.
  const activeKey = activeChip?.key ?? null;
  const shown = bank.filter((a) => matchesTag(a, activeKey));

  const { openAdd, openEdit, openDelete, dialogs } = useActivityDialogs(trip, activities, {
    onDeleteStart: (activity) => {
      const index = shown.findIndex((a) => a.id === activity.id);
      const neighbor = shown[index + 1] ?? shown[index - 1] ?? null;
      focusAfterDelete.current = { deletedId: activity.id, targetId: neighbor?.id ?? null };
    },
    onDeleteError: () => {
      focusAfterDelete.current = null;
    },
  });

  // Move focus off the deleted block (keyboard users would otherwise land on <body>).
  useEffect(() => {
    const pending = focusAfterDelete.current;
    if (!pending || bank.some((a) => a.id === pending.deletedId)) return;
    focusAfterDelete.current = null;
    const target =
      pending.targetId === null
        ? null
        : blockRefs.current.get(pending.targetId)?.querySelector('button');
    // In the sheet the heading is visually hidden but still announced by screen readers.
    (target ?? headingRef.current)?.focus();
  }, [bank]);

  return (
    <div
      ref={setDropZone}
      data-variant={variant}
      className={cx(
        'flex min-h-0 flex-1 flex-col bg-panel',
        !sheet && 'rounded-[var(--radius-card)] border border-line shadow-[var(--shadow-card)]',
      )}
    >
      <div
        className={cx(
          'flex flex-wrap items-center gap-2 border-b border-line',
          sheet ? 'justify-center px-2 pt-1 pb-2' : 'justify-between px-4 pt-3.5 pb-2.5',
        )}
      >
        <h2
          ref={headingRef}
          tabIndex={-1}
          className={cx('m-0 text-base font-semibold outline-none', sheet && 'sr-only')}
        >
          {t('bank.title')}
          {bank.length > 0 && ' '}
          {bank.length > 0 && (
            <span className="ms-1 text-xs font-normal text-ink-soft">
              {t('bank.count', { count: bank.length })}
            </span>
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* FR-6.1: paste a list. The accessible name starts with the visible word. */}
          <Button
            size="sm"
            aria-label={t('import.openLabel')}
            disabled={!canEdit}
            title={reason}
            onClick={() => setImportOpen(true)}
          >
            {t('import.open')}
          </Button>
          <Button variant="primary" size="sm" disabled={!canEdit} title={reason} onClick={openAdd}>
            {t('bank.add')}
          </Button>
        </div>
      </div>

      {chips.length > 0 && (
        <TagFilter chips={chips} selected={activeKey} onSelect={setTagFilter} scroll={sheet} />
      )}

      {bank.length === 0 ? (
        <p className="m-0 flex-1 px-2 py-6 text-center text-[13.5px] leading-relaxed whitespace-pre-line text-ink-soft">
          {t('bank.empty')}
        </p>
      ) : shown.length === 0 ? (
        <p className="m-0 flex-1 px-2 py-6 text-center text-[13.5px] leading-relaxed text-ink-soft">
          {t('bank.filter.empty', { tag: activeChip?.tag ?? '' })}
        </p>
      ) : (
        <ul
          aria-label={t('bank.listLabel')}
          className={cx(
            'm-0 flex min-h-0 flex-1 list-none flex-row flex-wrap content-start items-start gap-2 overflow-auto tablet:flex-col tablet:flex-nowrap tablet:items-stretch',
            sheet ? 'px-1 py-2' : 'p-3',
          )}
        >
          {shown.map((activity) => (
            <li key={activity.id} className="w-[calc(50%-4px)] shrink-0 tablet:w-auto">
              <ActivityBlock
                {...dragSourceProps(activity.id)}
                ref={(el) => {
                  if (el) blockRefs.current.set(activity.id, el);
                  else blockRefs.current.delete(activity.id);
                }}
                name={activity.name}
                tag={activity.tag}
                durationMinutes={activity.durationMinutes}
                color={activity.color}
                onOpen={() => openEdit(activity)}
                onDelete={() => openDelete(activity)}
                // Offline the × stays (no layout shift, no focus loss) but is disabled (M7.3).
                deleteDisabledReason={reason}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="m-0 hidden border-t border-line px-4 pt-2 pb-3 text-xs leading-normal text-ink-soft tablet:block">
        {t('bank.hint')}
      </p>

      {dialogs}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        trip={trip}
        activities={activities}
      />
    </div>
  );
}
