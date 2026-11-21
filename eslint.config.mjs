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
    files: ['src/engine/element/**/*.ts', 'src/engine/player/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'PropertyDefinition[value=null][declare=false]:not([key.type="PrivateIdentifier"])',
        message:
          'A class field with no initializer exists on a new element only when its compiler defines class fields, and Vite compiles ' +
          'BoardSmith without that when a game installs it, so create() would refuse the attribute there (#1786). ' +
          'Give it an initializer (`= undefined` for an optional field), or write `declare` when the constructor assigns it.',
      }],
    },
  },
  {
    files: [
      'src/cli/commands/verify-*.ts',
      'src/cli/commands/chunk-signoff.ts',
      'src/cli/commands/chunk-gate-transition.ts',
      'src/cli/lib/verify-result.ts',
    ],
    ignores: ['**/*.test-helper.ts'],
    rules: {
      'no-restricted-properties': ['error',
        ...['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'].map((property) => ({
          property,
          message: 'Write verify ledger files with atomicWriteFile from src/cli/lib/atomic-write-file.ts, so a crash mid-write cannot leave a truncated ledger.',
        })),
      ],
      'no-restricted-imports': ['error', {
        paths: ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'].map((name) => ({
          name,
          importNames: ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'],
          message: 'Write verify ledger files with atomicWriteFile from src/cli/lib/atomic-write-file.ts, so a crash mid-write cannot leave a truncated ledger.',
        })),
      }],
    },
  },
];
