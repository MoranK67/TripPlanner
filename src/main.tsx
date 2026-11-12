import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Rubik is bundled with the app (works offline, no request to Google).
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import '@/styles/index.css';
import '@/i18n';

import { App } from '@/app/App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
