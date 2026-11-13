// Catches mistakes the type check cannot: unused code, unsafe Svelte
// patterns and suspicious logic. Formatting is left to each file's style.
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  { ignores: ['dist/', 'target/', 'src-tauri/', 'node_modules/', 'test-results/', 'playwright-report/', 'site/', '.claude/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'], svelteConfig } },
  },
  {
    files: ['**/*.svelte'],
    rules: {
      // `$effect` reads a value on its own line to depend on it.
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['e2e/**'],
    rules: {
      // Tests reach into the page and the mocked backend.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    rules: {
      // Keys matter only for lists that reorder; most lists here are fixed.
      'svelte/require-each-key': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
);
