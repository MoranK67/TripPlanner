import { parseHhmm } from './parseHhmm';

const DURATION = { min: 30, max: 1440 };
const START = { min: 0, max: 1410 };
const END = { min: 30, max: 1440 };

describe('parseHhmm — accepted forms', () => {
  it.each([
    ['0130', 90],
    ['0800', 480],
    ['2200', 1320],
    ['930', 570],
    ['9:30', 570],
    ['09:30', 570],
    ['8', 480],
    ['08', 480],
    ['22', 1320],
    ['  0800 ', 480],
    ['2400', 1440],
    ['24', 1440],
    ['24:00', 1440],
  ])('%j → %i minutes, not rounded', (text, minutes) => {
    expect(parseHhmm(text, END)).toEqual({ minutes, rounded: false });
  });
});

describe('parseHhmm — rounding to the half hour (ties round up)', () => {
  it.each([
    ['0015', 30],
    ['0014', 0],
    ['0044', 30],
    ['0045', 60],
    ['0115', 90],
    ['0110', 60],
    ['0145', 120],
    ['0144', 90],
    ['1:20', 90],
    ['2345', 1440],
  ])('%j → %i', (text, minutes) => {
    expect(parseHhmm(text, { min: 0, max: 1440 })).toEqual({ minutes, rounded: true });
  });

  it('respects a custom step', () => {
    expect(parseHhmm('0010', { min: 0, max: 1440, step: 15 })).toEqual({
      minutes: 15,
      rounded: true,
    });
  });
});

describe('parseHhmm — ranges (checked after rounding)', () => {
  it.each([
    ['0000', DURATION, 'below_min'],
    ['0014', DURATION, 'below_min'],
    ['0', DURATION, 'below_min'],
    ['2415', DURATION, 'above_max'],
    ['2430', DURATION, 'above_max'],
    ['2400', START, 'above_max'],
    ['2345', START, 'above_max'],
    ['0000', END, 'below_min'],
    ['25', END, 'above_max'],
    ['99:00', END, 'above_max'],
  ] as const)('%j with %o → %s', (text, range, error) => {
    expect(parseHhmm(text, range)).toEqual({ error });
  });

  it.each([
    ['0015', DURATION, 30],
    ['2400', DURATION, 1440],
    ['2414', DURATION, 1440],
    ['0000', START, 0],
    ['2330', START, 1410],
    ['2344', START, 1410],
    ['0030', END, 30],
    ['2400', END, 1440],
  ] as const)('%j with %o is allowed (%i)', (text, range, minutes) => {
    expect(parseHhmm(text, range).minutes).toBe(minutes);
  });
});

describe('parseHhmm — rejected text', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'format'],
    ['8a', 'format'],
    ['08.30', 'format'],
    ['8:3', 'format'],
    ['123:00', 'format'],
    ['12345', 'format'],
    ['-130', 'format'],
    ['1 30', 'format'],
    ['٠٨٠٠', 'format'],
    ['0860', 'minutes'],
    ['960', 'minutes'],
    ['9:75', 'minutes'],
  ])('%j → %s', (text, error) => {
    expect(parseHhmm(text, END)).toEqual({ error });
  });
});
