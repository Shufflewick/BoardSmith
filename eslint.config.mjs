import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [
  // Global ignores (must be a separate config object)
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.test.ts',
      '**/games/**',
    ],
  },
  // TypeScript files config
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      '@typescript-eslint': plugin,
    },
    rules: {
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
    },
  },
];
