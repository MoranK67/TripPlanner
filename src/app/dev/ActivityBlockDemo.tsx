import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityBlock,
  ColorSwatches,
  ConfirmDialog,
  SLOT_HEIGHT_PX,
  useToast,
} from '@/components/ui';
import { PALETTE, type PaletteColor } from '@/domain';
import { Section } from './Section';

// Gallery section for ColorSwatches and ActivityBlock (M3.3).

const SAMPLE_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
const DURATIONS = [90, 60, 180, 30, 120, 150, 60, 30, 90, 240];

interface Sample {
  id: string;
  durationMinutes: number;
  color: PaletteColor;
}

const INITIAL: Sample[] = PALETTE.map((color, i) => ({
  id: SAMPLE_KEYS[i] ?? String(i),
  durationMinutes: DURATIONS[i] ?? 60,
  color,
}));

interface PlacedSample extends Sample {
  /** Sample name key (devUi.sampleNames.*). */
  nameKey: string;
  meta: string;
  /** Slot index within the demo column (column starts at 08:00). */
  slot: number;
}

const INITIAL_PLACED: PlacedSample[] = [
  { id: 'p1', nameKey: 'd', durationMinutes: 30, color: PALETTE[1], meta: '08:00–08:30', slot: 0 },
  { id: 'p2', nameKey: 'h', durationMinutes: 120, color: PALETTE[5], meta: '09:00–11:00', slot: 2 },
  { id: 'p3', nameKey: 'i', durationMinutes: 90, color: PALETTE[8], meta: '11:30–13:00', slot: 7 },
];

export function ActivityBlockDemo() {
  const { t } = useTranslation();
  const toast = useToast();
  const [samples, setSamples] = useState(INITIAL);
  const [pickerColor, setPickerColor] = useState<PaletteColor>(PALETTE[0]);
  const [placed, setPlaced] = useState(INITIAL_PLACED);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const nameOf = (s: Sample) => t(`devUi.sampleNames.${s.id}`);

  function remove() {
    if (!toDelete) return;
    setSamples((list) => list.filter((s) => s.id !== toDelete.id));
    setPlaced((list) => list.filter((s) => s.id !== toDelete.id));
    toast.show(t('devUi.deleted', { name: toDelete.name }));
    setToDelete(null);
  }

  return (
    <Section title={t('devUi.blocks')}>
      <p className="mt-0 mb-4 text-sm text-ink-soft">{t('devUi.blocksIntro')}</p>

      <ColorSwatches
        label={t('devUi.swatchesLabel')}
        value={pickerColor}
        onChange={setPickerColor}
        className="mb-3.5"
      />

      <div className="grid gap-4 tablet:grid-cols-[minmax(0,270px)_1fr]">
        <div>
          <h4 className="mt-0 mb-2 text-sm font-semibold">{t('devUi.bankSample')}</h4>
          {/* Same list layout as the prototype bank (2 columns on phones). */}
          <div className="flex flex-row flex-wrap items-start gap-2 tablet:flex-col tablet:items-stretch">
            <ActivityBlock
              name={t('devUi.swatchPreview')}
              durationMinutes={60}
              color={pickerColor}
              className="w-[calc(50%-4px)] tablet:w-auto"
            />
            {samples.map((s) => (
              <ActivityBlock
                key={s.id}
                name={nameOf(s)}
                durationMinutes={s.durationMinutes}
                color={s.color}
                className="w-[calc(50%-4px)] tablet:w-auto"
                onOpen={() => toast.show(t('devUi.opened', { name: nameOf(s) }))}
                onDelete={() => setToDelete({ id: s.id, name: nameOf(s) })}
              />
            ))}
          </div>
        </div>

        <div>
          <h4 className="mt-0 mb-2 text-sm font-semibold">{t('devUi.placedSample')}</h4>
          {/* One timetable day column, 08:00–14:00, with absolutely placed blocks. */}
          <div
            className="relative rounded-[var(--radius-block)] border border-line bg-[repeating-linear-gradient(to_bottom,transparent_0_27px,var(--color-line)_27px_28px)]"
            style={{ height: 12 * SLOT_HEIGHT_PX }}
          >
            {placed.map((p) => {
              const name = t(`devUi.sampleNames.${p.nameKey}`);
              return (
                <ActivityBlock
                  key={p.id}
                  name={name}
                  durationMinutes={p.durationMinutes}
                  color={p.color}
                  meta={p.meta}
                  className="absolute inset-x-1"
                  style={{ top: p.slot * SLOT_HEIGHT_PX + 1 }}
                  onOpen={() => toast.show(t('devUi.opened', { name }))}
                  onDelete={() => setToDelete({ id: p.id, name })}
                />
              );
            })}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('devUi.confirmTitle')}
        message={toDelete ? t('devUi.confirmMessage', { name: toDelete.name }) : ''}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </Section>
  );
}
