import { SWIPE_MAX_MS, SWIPE_MIN_PX, swipeDayDelta } from './swipe';

describe('swipeDayDelta', () => {
  it('RTL: swiping right shows the next day, swiping left the previous one', () => {
    expect(swipeDayDelta(80, 5, 200, 'rtl')).toBe(1);
    expect(swipeDayDelta(-80, 5, 200, 'rtl')).toBe(-1);
  });

  it('LTR is mirrored', () => {
    expect(swipeDayDelta(-80, 0, 200, 'ltr')).toBe(1);
    expect(swipeDayDelta(80, 0, 200, 'ltr')).toBe(-1);
  });

  it('needs a minimum distance', () => {
    expect(swipeDayDelta(SWIPE_MIN_PX - 1, 0, 100, 'rtl')).toBe(0);
    expect(swipeDayDelta(SWIPE_MIN_PX, 0, 100, 'rtl')).toBe(1);
  });

  it('rejects mostly vertical moves (scrolling) and slow pans', () => {
    expect(swipeDayDelta(80, 60, 200, 'rtl')).toBe(0);
    expect(swipeDayDelta(90, 60, 200, 'rtl')).toBe(1);
    expect(swipeDayDelta(200, 0, SWIPE_MAX_MS + 1, 'rtl')).toBe(0);
  });
});
