import { parseDuration, roundToSlot } from './duration';
import { formatDurationHe } from './time';

const RLM = String.fromCodePoint(0x200f);
const LRM = String.fromCodePoint(0x200e);
const NBSP = String.fromCodePoint(0xa0);
const GERESH = String.fromCodePoint(0x5f3);
const MAQAF = String.fromCodePoint(0x5be);
const RIGHT_QUOTE = String.fromCodePoint(0x2019);

describe('parseDuration — FR-6.3 formats', () => {
  it.each([
    ['3', 180],
    ['1.5', 90],
    ['1,5', 90],
    ['2:30', 150],
    ['40 דקות', 40],
    ['2 שעות', 120],
    ['שעתיים', 120],
    ['2 שעות וחצי', 150],
    ['שעה וחצי', 90],
    ['חצי שעה', 30],
  ])('%s → %s minutes', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });
});

describe('parseDuration — prototype formats', () => {
  it.each([
    ['שעה', 60],
    ['שעתיים וחצי', 150],
    ['3 שעה', 180],
    ["2 ש'", 120],
    [`2 ש${GERESH}`, 120],
    ['2h', 120],
    ['2 hr', 120],
    ['2 hrs', 120],
    ['1 hour', 60],
    ['2 hours', 120],
    ["40 דק'", 40],
    [`40 דק${GERESH}`, 40],
    ['40 דק', 40],
    ['40 min', 40],
    ['40 mins', 40],
    ['40 minutes', 40],
    ['2 שעות ו-30 דקות', 150],
    ['2 שעות ו30 דקות', 150],
    ['2 שעות ו 30', 150],
    ['3 וחצי', 210],
    ['3 שעות וחצי', 210],
    ['02:30', 150],
    ['0:40', 40],
  ])('%s → %s minutes', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });
});

describe('parseDuration — hardening', () => {
  it.each([
    ['  2  שעות   וחצי ', 150, 'extra whitespace'],
    [`2${NBSP}שעות`, 120, 'non-breaking space'],
    [`${RLM}2:30${LRM}`, 150, 'bidi marks from RTL documents'],
    ['2:30:00', 150, 'Excel h:mm:ss'],
    ['0:45:30', 46, 'seconds rounded to whole minutes'],
    ['24:00', 1440, '24 hours as a clock'],
    ['.5', 30, 'leading decimal point'],
    ['1.25', 75, 'quarter hours'],
    ['2H', 120, 'upper-case unit'],
    ['1.5 שעות', 90, 'decimal with Hebrew unit'],
    ['2ש', 120, 'unit glued to the number'],
    ['40דקות', 40, 'minutes unit glued'],
    ['40 דקה', 40, 'singular minute unit'],
    ["40 ד'", 40, 'abbreviated minutes'],
    ['90m', 90, 'compact minutes'],
    ['1h30', 90, 'compact h/m'],
    ['1h 30m', 90, 'compact h/m with space'],
    ['1 hour 30 minutes', 90, 'English words'],
    ['2 וחצי שעות', 150, 'fraction before the unit'],
    ['שעתיים ורבע', 135, 'quarter'],
    ['רבע שעה', 15, 'quarter of an hour'],
    ['שעה ו-20 דקות', 80, 'hour word with minutes'],
    ['שעה ו 20', 80, 'hour word with bare minutes'],
    [`2 שעות ו${MAQAF}30 דקות`, 150, 'Hebrew maqaf'],
    ['2 שעות ו - 30 דקות', 150, 'spaced hyphen'],
    [`2 ש${RIGHT_QUOTE}`, 120, 'typographic apostrophe as geresh'],
    ['2 ו30', 150, 'bare hours and minutes'],
    ['0', 0, 'zero (rejected later by range)'],
    ['30', 1800, 'a bare number is hours'],
  ])('%s → %s (%s)', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['זמן'],
    ['duration'],
    ['-2'],
    ['2:75'],
    ['2:30:75'],
    ['1:5'],
    ['2:5'], // rejected on purpose: one-digit minutes are ambiguous (2:05 or 2:50?)
    ['123:00'],
    ['2 שעות ו-60 דקות'],
    ['1h60'],
    ['1.5 וחצי'],
    ['2 שעות וחצי שעות'],
    ['2 3'],
    ['1e3'],
    ['2..5'],
    ['שעות'],
    ['וחצי'],
    ['2 ימים'],
  ])('%s → null', (text) => {
    expect(parseDuration(text)).toBeNull();
  });

  it('round-trips every label produced by formatDurationHe (30 min – 24 h)', () => {
    for (let minutes = 30; minutes <= 1440; minutes += 30) {
      expect(parseDuration(formatDurationHe(minutes))).toBe(minutes);
    }
  });
});

describe('roundToSlot', () => {
  it.each([
    [0, 0],
    [14, 0],
    [15, 30],
    [40, 30],
    [44, 30],
    [45, 60],
    [150, 150],
    [1455, 1470],
  ])('%s → %s', (minutes, rounded) => {
    expect(roundToSlot(minutes)).toBe(rounded);
  });
});
