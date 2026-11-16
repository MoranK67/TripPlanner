import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import '@/i18n';

// TEST-1: findBy*/waitFor get 5 s instead of 1 s, so a busy machine (parallel agents, CI) does not
// fail tests that are only slow. Still well under the 15 s testTimeout.
configure({ asyncUtilTimeout: 5_000 });
