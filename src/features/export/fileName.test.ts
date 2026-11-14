import { EXPORT_MIME, exportFileName } from './fileName';

describe('exportFileName', () => {
  it('uses the trip name and the format extension', () => {
    expect(exportFileName('רומא 2026', 'png', 'טיול')).toBe('רומא 2026.png');
    expect(exportFileName('רומא', 'pdf', 'טיול')).toBe('רומא.pdf');
  });

  it('removes characters that are not allowed in file names', () => {
    expect(exportFileName('פריז / לונדון: "קיץ"?', 'pdf', 'טיול')).toBe('פריז לונדון קיץ.pdf');
  });

  it('falls back when nothing is left', () => {
    expect(exportFileName(' ?*. ', 'png', 'טיול')).toBe('טיול.png');
  });

  it('has the right MIME types', () => {
    expect(EXPORT_MIME).toEqual({ png: 'image/png', pdf: 'application/pdf' });
  });
});
