// File names for exported timetables.

export type ExportFormat = 'png' | 'pdf';

export const EXPORT_MIME: Readonly<Record<ExportFormat, string>> = {
  png: 'image/png',
  pdf: 'application/pdf',
};

/** Characters Windows, macOS, Android or iOS refuse in a file name, plus control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
/** Keeps names well below file-system limits (255 bytes; Hebrew is 2 bytes per letter in UTF-8). */
const MAX_BASE_LENGTH = 80;

/**
 * `<trip name>.<ext>`, with characters that are not allowed in file names removed (as in the
 * prototype's `safeName`). Falls back to `fallback` (e.g. "טיול") when nothing is left.
 */
export function exportFileName(tripName: string, format: ExportFormat, fallback: string): string {
  const cleaned = Array.from(tripName.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_BASE_LENGTH)
    .join('')
    .trim()
    // Windows drops trailing dots; a leading dot hides the file on macOS / Linux.
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return `${cleaned || fallback}.${format}`;
}
