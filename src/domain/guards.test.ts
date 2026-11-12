import { PALETTE } from './constants';
import {
  isHexColor,
  isInBank,
  isIsoDate,
  isPaletteColor,
  isPlaced,
  isValidActivityName,
  isValidDuration,
  isValidEndMinute,
  isValidMinute,
  isValidStartMinute,
  isValidTripName,
  nameLength,
  normalizeHexColor,
  paletteColorAt,
} from './guards';
import type { Activity } from './types';

describe('minute guards', () => {
  it.each([
    [0, true],
    [30, true],
    [1410, true],
    [1440, true],
    [-30, false],
    [15, false],
    [1470, false],
    [30.5, false],
    [Number.NaN, false],
  ])('isValidMinute(%s) = %s', (value, expected) => {
    expect(isValidMinute(value)).toBe(expected);
  });

  it.each([
    [0, true],
    [600, true],
    [1410, true],
    [1440, false],
    [-30, false],
    [45, false],
  ])('isValidStartMinute(%s) = %s', (value, expected) => {
    expect(isValidStartMinute(value)).toBe(expected);
  });

  it.each([
    [0, false],
    [30, true],
    [1440, true],
    [1470, false],
    [90, true],
    [100, false],
  ])('isValidEndMinute(%s) = %s', (value, expected) => {
    expect(isValidEndMinute(value)).toBe(expected);
  });

  it.each([
    [0, false],
    [30, true],
    [150, true],
    [1440, true],
    [1470, false],
    [40, false],
    [Number.POSITIVE_INFINITY, false],
  ])('isValidDuration(%s) = %s', (value, expected) => {
    expect(isValidDuration(value)).toBe(expected);
  });
});

describe('name guards', () => {
  it('counts code points like Postgres char_length', () => {
    expect(nameLength('abc')).toBe(3);
    expect(nameLength('טיול')).toBe(4);
    expect(nameLength('🏖️')).toBe(2); // emoji + variation selector
    expect(nameLength('😀')).toBe(1); // one code point, two UTF-16 units
  });

  it('validates trip names (1..50, not blank)', () => {
    expect(isValidTripName('הטיול שלי')).toBe(true);
    expect(isValidTripName('a'.repeat(50))).toBe(true);
    expect(isValidTripName('a'.repeat(51))).toBe(false);
    expect(isValidTripName('')).toBe(false);
    expect(isValidTripName('   ')).toBe(false);
  });

  it('validates activity names (1..60, not blank), emoji count once', () => {
    expect(isValidActivityName('Museum מוזיאון')).toBe(true);
    expect(isValidActivityName('😀'.repeat(60))).toBe(true);
    expect(isValidActivityName('😀'.repeat(61))).toBe(false);
    expect(isValidActivityName('a'.repeat(61))).toBe(false);
    expect(isValidActivityName('\t')).toBe(false);
  });
});

describe('color guards', () => {
  it('checks hex format like the DB', () => {
    expect(isHexColor('#FFD6E0')).toBe(true);
    expect(isHexColor('#ffd6e0')).toBe(true);
    expect(isHexColor('FFD6E0')).toBe(false);
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('#GGGGGG')).toBe(false);
  });

  it('recognizes palette colors exactly (case-sensitive)', () => {
    for (const color of PALETTE) expect(isPaletteColor(color)).toBe(true);
    expect(isPaletteColor('#ffd6e0')).toBe(false);
    expect(isPaletteColor('#000000')).toBe(false);
  });

  it('normalizes hex colors to upper case for palette lookup', () => {
    expect(normalizeHexColor('#ffd6e0')).toBe('#FFD6E0');
    expect(isPaletteColor(normalizeHexColor('#ffd6e0'))).toBe(true);
    expect(normalizeHexColor('#FFD6E0')).toBe('#FFD6E0');
  });

  it('assigns colors from the cursor and wraps around', () => {
    expect(paletteColorAt(0)).toBe(PALETTE[0]);
    expect(paletteColorAt(9)).toBe(PALETTE[9]);
    expect(paletteColorAt(10)).toBe(PALETTE[0]);
    expect(paletteColorAt(23)).toBe(PALETTE[3]);
    expect(paletteColorAt(-1)).toBe(PALETTE[9]);
    expect(paletteColorAt(2.7)).toBe(PALETTE[2]);
    expect(paletteColorAt(Number.NaN)).toBe(PALETTE[0]);
  });
});

describe('isIsoDate', () => {
  it.each([
    ['2026-11-12', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-12-31', true],
    ['0050-01-01', true],
    ['0001-01-01', true],
    ['0000-01-01', false],
    ['0004-02-29', true],
    ['0100-02-29', false],
    ['2026-1-1', false],
    ['12/11/2026', false],
    ['', false],
  ])('isIsoDate(%s) = %s', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe('placement guards', () => {
  const base: Activity = {
    id: 'a1',
    tripId: 't1',
    name: 'Louvre',
    durationMinutes: 120,
    color: PALETTE[0],
    placement: null,
    bankPosition: 1,
  };

  it('distinguishes bank and placed activities', () => {
    const placed: Activity = { ...base, placement: { date: '2026-11-12', startMinute: 600 } };
    expect(isInBank(base)).toBe(true);
    expect(isPlaced(base)).toBe(false);
    expect(isPlaced(placed)).toBe(true);
    expect(isInBank(placed)).toBe(false);
    if (isPlaced(placed)) expect(placed.placement.startMinute).toBe(600);
  });
});
