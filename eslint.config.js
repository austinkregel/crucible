import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '.crucible/**',
      '*.vsix',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],

  {
    // `any` is used deliberately across provider/event boundaries where the
    // shape is dictated by third-party SDKs and webview message passing.
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    // Extension host: Node environment.
    files: ['extension/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    // Webview: browser environment, plus the VS Code webview API global.
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        acquireVsCodeApi: 'readonly',
      },
    },
  },

  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  {
    // Ambient declaration files use library-mandated shapes (e.g. Vue's
    // DefineComponent<{}, {}, any>) that the empty-object rule flags.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  {
    files: ['**/__tests__/**/*.ts', '**/__mocks__/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // vi.hoisted() runs before ESM imports are evaluated, so it must require().
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    files: ['*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
