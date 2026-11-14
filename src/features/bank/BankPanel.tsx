import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityBlock, Button } from '@/components/ui';
import { isInBank, type Activity, type Trip } from '@/domain';
import { ImportDialog } from '@/features/import';
import { dragSourceProps, useBankDropZone } from '@/features/schedule';
import { useActivityDialogs } from './useActivityDialogs';

export interface BankPanelProps {
  trip: Trip;
  /** All of the trip's activities; the panel shows the unplaced ones in bank order. */
  activities: readonly Activity[];
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
export function BankPanel({ trip, activities }: BankPanelProps) {
  const { t } = useTranslation();
  const focusAfterDelete = useRef<FocusAfterDelete | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  // Drag and drop (FR-5.1): blocks drag onto the timetable; placed blocks drop back here.
  const setDropZone = useBankDropZone();

  const bank = useMemo(
    () => activities.filter(isInBank).sort((a, b) => a.bankPosition - b.bankPosition),
    [activities],
  );

  const { openAdd, openEdit, openDelete, dialogs } = useActivityDialogs(trip, {
    onDeleteStart: (activity) => {
      const index = bank.findIndex((a) => a.id === activity.id);
      const neighbor = bank[index + 1] ?? bank[index - 1] ?? null;
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
    (target ?? headingRef.current)?.focus();
  }, [bank]);

  return (
    <div
      ref={setDropZone}
      className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 pt-3.5 pb-2.5">
        <h2 ref={headingRef} tabIndex={-1} className="m-0 text-base font-semibold outline-none">
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
          <Button size="sm" aria-label={t('import.openLabel')} onClick={() => setImportOpen(true)}>
            {t('import.open')}
          </Button>
          <Button variant="primary" size="sm" onClick={openAdd}>
            {t('bank.add')}
          </Button>
        </div>
      </div>

      {bank.length === 0 ? (
        <p className="m-0 flex-1 px-2 py-6 text-center text-[13.5px] leading-relaxed whitespace-pre-line text-ink-soft">
          {t('bank.empty')}
        </p>
      ) : (
        <ul
          aria-label={t('bank.listLabel')}
          className="m-0 flex min-h-0 flex-1 list-none flex-row flex-wrap content-start items-start gap-2 overflow-auto p-3 tablet:flex-col tablet:flex-nowrap tablet:items-stretch"
        >
          {bank.map((activity) => (
            <li key={activity.id} className="w-[calc(50%-4px)] shrink-0 tablet:w-auto">
              <ActivityBlock
                {...dragSourceProps(activity.id)}
                ref={(el) => {
                  if (el) blockRefs.current.set(activity.id, el);
                  else blockRefs.current.delete(activity.id);
                }}
                name={activity.name}
                durationMinutes={activity.durationMinutes}
                color={activity.color}
                onOpen={() => openEdit(activity)}
                onDelete={() => openDelete(activity)}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="m-0 hidden border-t border-line px-4 pt-2 pb-3 text-xs leading-normal text-ink-soft tablet:block">
        {t('bank.hint')}
      </p>

      {dialogs}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} trip={trip} />
    </div>
  );
}
