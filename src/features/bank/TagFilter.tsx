import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/components/ui';
import type { TripTag } from '@/domain';

/** A chip: a tag of the trip with the number of bank activities that have it. */
export interface TagChip extends TripTag {
  /** Activities in the bank with this tag (the trip-wide `count` includes placed ones). */
  bankCount: number;
}

export interface TagFilterProps {
  chips: readonly TagChip[];
  /** Selected `TripTag.key`; `null` = "הכול". */
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** The phone sheet: one row that scrolls sideways instead of wrapping. */
  scroll?: boolean;
}

/**
 * The bank's tag chips (FEAT-2): "הכול", then each tag with its group colour and count. A toggle
 * group (buttons with `aria-pressed`): pressing the selected tag again shows all.
 */
export function TagFilter({ chips, selected, onSelect, scroll = false }: TagFilterProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('bank.filter.label')}
      className={cx(
        'flex gap-1.5',
        scroll
          ? 'flex-nowrap overflow-x-auto overscroll-x-contain px-1 pt-2 pb-1 [scrollbar-width:thin]'
          : 'flex-wrap px-3 pt-2.5',
      )}
    >
      <Chip pressed={selected === null} onClick={() => onSelect(null)}>
        {t('bank.filter.all')}
      </Chip>
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          pressed={selected === chip.key}
          onClick={() => onSelect(selected === chip.key ? null : chip.key)}
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full border border-line-strong"
            style={{ backgroundColor: chip.color }}
          />
          <span className="max-w-40 truncate">{chip.tag}</span>{' '}
          <span className="text-ink-soft">{t('bank.count', { count: chip.bankCount })}</span>
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px] whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-ink',
        pressed
          ? 'border-accent-strong bg-accent-soft font-semibold text-accent-ink'
          : 'border-line-strong bg-panel text-ink hover:bg-accent-soft-hover',
      )}
    >
      {children}
    </button>
  );
}
