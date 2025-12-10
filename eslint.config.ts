import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import EslintImportPlugin from 'eslint-plugin-import';
import EslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import EslintUnusedImportsPlugin from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  {
    plugins: {
      import: EslintImportPlugin,
      'unused-imports': EslintUnusedImportsPlugin,
    },
    rules: {
      ...EslintImportPlugin.configs.typescript.rules,
      'import/no-unresolved': ['off'],
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  EslintPluginPrettierRecommended,
]);
