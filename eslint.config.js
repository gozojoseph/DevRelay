import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'web/dist/**', 'drizzle/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx}'], rules: { '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
  // The host agent is plain ESM JS with zero runtime deps (it must run on the
  // VPS with no build step), so give its globals explicitly.
  { files: ['agent/**/*.mjs'], languageOptions: { globals: {
    process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  } } },
);
