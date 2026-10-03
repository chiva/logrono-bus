import js from '@eslint/js';
import lit from 'eslint-plugin-lit';
import wc from 'eslint-plugin-wc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  wc.configs['flat/recommended'],
  lit.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Lit components declare reactive properties with `declare` + static properties.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['**/test/**', '**/e2e/**', '**/*.config.ts', '**/scripts/**', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
