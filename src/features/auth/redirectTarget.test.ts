import { redirectTarget } from './redirectTarget';

const from = (value: unknown) => ({ from: value });

describe('redirectTarget', () => {
  it('returns to the guarded page with its search and hash', () => {
    expect(redirectTarget(from({ pathname: '/trips/abc', search: '?x=1', hash: '#d' }))).toBe(
      '/trips/abc?x=1#d',
    );
    expect(redirectTarget(from({ pathname: '/trips/abc' }))).toBe('/trips/abc');
  });

  it.each([
    ['missing state', undefined],
    ['null state', null],
    ['state without from', { reason: 'expired' }],
    ['non-object from', from('/trips')],
    ['non-string pathname', from({ pathname: 42 })],
    ['protocol-relative URL', from({ pathname: '//evil.com' })],
    ['backslash protocol-relative URL', from({ pathname: '/\\evil.com' })],
    ['absolute URL', from({ pathname: 'https://evil.com' })],
    ['the login page itself', from({ pathname: '/login' })],
    ['non-string search', from({ pathname: '/trips', search: 1 })],
  ])('falls back to /trips for %s', (_label, state) => {
    expect(redirectTarget(state)).toBe('/trips');
  });
});
