import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './he.json';

/** The only UI language for now. More languages = add a JSON file + resource entry. */
export const DEFAULT_LANGUAGE = 'he';

void i18n.use(initReactI18next).init({
  resources: { he: { translation: he } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

/** Keep <html lang/dir> in sync with the active language (RTL for Hebrew). */
function syncDocumentDirection(lng: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

syncDocumentDirection(i18n.language || DEFAULT_LANGUAGE);
i18n.on('languageChanged', syncDocumentDirection);

export default i18n;
