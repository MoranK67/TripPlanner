// ESLint flat config.
// Besides normal TypeScript/React rules, this file enforces the module
// boundaries from PROJECT_PLAN.md §4.3 and §10.4.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const supabaseOnlyInData = {
  group: ['@supabase/*'],
  message: 'Only src/data may talk to Supabase. Use a repository from @/data instead.',
};

const noFeatureInternals = {
  group: ['@/features/*/*'],
  message: "Import a feature only through its public index (e.g. '@/features/trips').",
};

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'prototype', 'node_modules', 'src-tauri', 'android', 'ios'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { patterns: [supabaseOnlyInData, noFeatureInternals] }],
    },
  },
  // src/data is the only layer allowed to import Supabase.
  {
    files: ['src/data/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noFeatureInternals] }],
    },
  },
  // src/domain must stay pure: no React, no Supabase, no app layers.
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/domain must not depend on React.' },
            { name: 'react-dom', message: 'src/domain must not depend on React.' },
          ],
          patterns: [
            supabaseOnlyInData,
            {
              group: [
                '@/data',
                '@/data/*',
                '@/features',
                '@/features/*',
                '@/components/*',
                '@/platform',
                '@/platform/*',
                '@/app/*',
              ],
              message: 'src/domain is pure logic and may not import app layers.',
            },
          ],
        },
      ],
    },
  },
  // Node-side config files.
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
