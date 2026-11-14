import { PALETTE } from '@/domain';
import { exportTheme, parseColorTokens, parseFontToken } from './theme';
import { testTheme, tokensCss } from './testTheme';

describe('export theme', () => {
  it('reads every colour from the design tokens', () => {
    const theme = testTheme();
    expect(theme.bg).toBe('#fbf8f4');
    expect(theme.blockInk).toBe('#40394f');
    expect(theme.font).toContain('Rubik');
    for (const value of Object.values(theme)) expect(value).toBeTruthy();
  });

  it('parses colour declarations and the font list', () => {
    const css =
      ':root { --color-ink: #4A4458; --color-pastel-pink: #ffd6e0; --font-sans: Rubik, Arial; }';
    expect(parseColorTokens(css).get('ink')).toBe('#4a4458');
    expect(parseFontToken(css)).toBe('Rubik, Arial');
  });

  it('throws when a token the renderer needs is missing', () => {
    expect(() => exportTheme('--font-sans: Rubik;')).toThrow(/--color-bg/);
    expect(() => exportTheme('--color-bg: #fff;')).toThrow(/--font-sans/);
  });

  it('keeps the palette tokens in sync with the domain palette', () => {
    const tokens = [...parseColorTokens(tokensCss).entries()]
      .filter(([name]) => name.startsWith('pastel-'))
      .map(([, value]) => value);
    expect(tokens).toEqual(PALETTE.map((c) => c.toLowerCase()));
  });
});
