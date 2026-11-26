import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, cx, MenuButton, type MenuItem } from '@/components/ui';
import type { TripTag } from '@/domain';

/** A tag of the trip with the number of bank activities that have it. */
export interface TagChip extends TripTag {
  /** Activities in the bank with this tag (the trip-wide `count` includes placed ones). */
  bankCount: number;
}

export interface TagFilterProps {
  chips: readonly TagChip[];
  /** Selected `TripTag.key`; `null` = "הכול". */
  selected: string | null;
  onSelect: (key: string | null) => void;
}

function TagDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full border border-line-strong"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * The bank's tag filter (FEAT-2, compact since DES-1): one menu button in the bank header,
 * "סינון: הכול ▾", whose menu offers "הכול" and each tag with its group colour and count
 * (`menuitemradio`, the current choice checked). Choosing closes the menu. While a tag is
 * selected the trigger shows it, followed by a separate "✕" that clears the filter.
 */
export function TagFilter({ chips, selected, onSelect }: TagFilterProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const optionLabel = (chip: TagChip) =>
    t('bank.filter.option', { tag: chip.tag, count: t('bank.count', { count: chip.bankCount }) });
  const active = chips.find((chip) => chip.key === selected) ?? null;

  const items: MenuItem[] = [
    {
      id: 'all',
      label: t('bank.filter.all'),
      checked: active === null,
      onSelect: () => onSelect(null),
    },
    ...chips.map((chip) => ({
      id: chip.key,
      label: optionLabel(chip),
      checked: chip.key === active?.key,
      icon: <TagDot color={chip.color} />,
      onSelect: () => onSelect(chip.key),
    })),
  ];

  return (
    <div ref={wrapperRef} className="flex min-w-0 items-center gap-0.5">
      <MenuButton
        label={t('bank.filter.label')}
        triggerVariant="text"
        items={items}
        className="min-w-0"
        trigger={
          <>
            {/* While a tag is chosen the trigger shows only the tag, to stay on one row with the
                bank's buttons; "סינון:" stays in its name for screen readers. */}
            <span className={cx(active && 'sr-only')}>{t('bank.filter.trigger')}</span>{' '}
            {active ? (
              <>
                <TagDot color={active.color} />
                <span className="max-w-24 truncate">{active.tag}</span>{' '}
                <span className="text-ink-soft">
                  {t('bank.count', { count: active.bankCount })}
                </span>
              </>
            ) : (
              <span>{t('bank.filter.all')}</span>
            )}
            <span aria-hidden="true" className="text-[10px] text-ink-soft">
              ▾
            </span>
          </>
        }
      />
      {active && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('bank.filter.clear')}
          title={t('bank.filter.clear')}
          onClick={() => {
            onSelect(null);
            // The ✕ leaves with the filter: keep keyboard focus on the trigger, not on <body>.
            wrapperRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus();
          }}
          className="px-2"
        >
          <span aria-hidden="true">✕</span>
        </Button>
      )}
    </div>
  );
}
