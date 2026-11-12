import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeHexColor, PALETTE, type PaletteColor } from '@/domain';
import { cx } from './cx';
import { PALETTE_COLOR_KEYS } from './paletteColorKeys';

interface ColorSwatchesBaseProps {
  /** Current color. Compared case-insensitively; a non-palette value simply selects nothing. */
  value: string;
  onChange: (color: PaletteColor) => void;
  /** Radio group name (for forms). Generated when omitted. */
  name?: string;
  disabled?: boolean;
  /** No outer margin is built in; set spacing here (e.g. `mb-3.5` to match a Field). */
  className?: string;
}

/** The group needs an accessible name: either a visible `label` or an `aria-label`. */
export type ColorSwatchesProps = ColorSwatchesBaseProps &
  (
    | {
        /** Visible group label, styled like a Field label. */ label: ReactNode;
        'aria-label'?: never;
      }
    | { label?: never; 'aria-label': string }
  );

/**
 * The 10-color pastel picker from the activity dialog (FR-3.2). Native radio buttons, so arrow
 * keys move between colors and Tab enters / leaves the group. Each color has a Hebrew name, and
 * the selected one shows a ✓ as well as an outline, so the choice never relies on color alone.
 */
export function ColorSwatches({
  value,
  onChange,
  name,
  disabled = false,
  className,
  ...props
}: ColorSwatchesProps) {
  const { t } = useTranslation();
  const { label, 'aria-label': ariaLabel } = props;
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const groupName = name ?? `colors-${baseId}`;
  const selected = normalizeHexColor(value);

  return (
    <div
      role="radiogroup"
      aria-labelledby={label ? labelId : undefined}
      aria-label={label ? undefined : ariaLabel}
      aria-disabled={disabled || undefined}
      className={className}
    >
      {label && (
        <span id={labelId} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
          {label}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        {PALETTE.map((color, i) => {
          const checked = color === selected;
          return (
            <label
              key={color}
              className={cx('relative', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
            >
              <input
                type="radio"
                name={groupName}
                value={color}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(color)}
                aria-label={t(`common.colors.${PALETTE_COLOR_KEYS[i]}`)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                style={{ backgroundColor: color }}
                className={cx(
                  'grid size-[30px] place-items-center rounded-full border border-block-edge/12 text-sm font-bold text-block-ink',
                  'transition-transform motion-safe:hover:scale-[1.08] pointer-coarse:size-9',
                  'peer-checked:outline-[2.5px] peer-checked:outline-offset-2 peer-checked:outline-ink peer-checked:outline-solid',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ink peer-focus-visible:ring-offset-[6px]',
                  disabled && 'opacity-45',
                )}
              >
                {checked ? '✓' : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
