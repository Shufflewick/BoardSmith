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
  {
    files: ['src/cli/commands/verify-*.ts', 'src/cli/lib/verify-result.ts'],
    rules: {
      'no-restricted-properties': ['error',
        ...['writeFile', 'writeFileSync'].map((property) => ({
          property,
          message: 'Write verify ledger files with atomicWriteFile from src/cli/lib/atomic-write-file.ts, so a crash mid-write cannot leave a truncated ledger.',
        })),
      ],
      'no-restricted-imports': ['error', {
        paths: ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'].map((name) => ({
          name,
          importNames: ['writeFile', 'writeFileSync'],
          message: 'Write verify ledger files with atomicWriteFile from src/cli/lib/atomic-write-file.ts, so a crash mid-write cannot leave a truncated ledger.',
        })),
      }],
    },
  },
];
