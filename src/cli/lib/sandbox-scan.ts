/**
 * Sandbox scanner — the single source of truth for determinism/network/timer/
 * filesystem/eval enforcement in BoardSmith games.
 *
 * It runs the AST-based `boardsmith` ESLint plugin rules over ALL game source
 * under `src/` (not just `src/rules`), so a `Math.random()` in a UI helper or a
 * `fetch()` in a shared module is caught just like one in the rules layer.
 *
 * Both `boardsmith validate` and `boardsmith lint` delegate here, so there is
 * exactly one implementation of these guardrails — no duplicated regex scanners.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Linter } from 'eslint';
// Namespace import: @typescript-eslint/parser has no default export under
// native ESM, so `import parser from ...` resolves to undefined.
import * as tsParser from '@typescript-eslint/parser';
import plugin from '../../eslint-plugin/index.js';

export interface SandboxViolation {
  /** Path relative to the project root. */
  file: string;
  line: number;
  column: number;
  ruleId: string;
  message: string;
}

/** The forbidden-API rules enforced for every game. */
const SANDBOX_RULES: Linter.RulesRecord = {
  'boardsmith/no-network': 'error',
  'boardsmith/no-filesystem': 'error',
  'boardsmith/no-timers': 'error',
  'boardsmith/no-nondeterministic': 'error',
  'boardsmith/no-eval': 'error',
};

const FLAT_CONFIG: Linter.Config[] = [
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue'],
    languageOptions: {
      // The parser object is passed directly, so ESLint never has to load the
      // TypeScript plugin from disk — it works whether the CLI runs from source
      // (tsx) or from the bundled dist build.
      parser: tsParser as unknown as Linter.Parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      boardsmith: plugin as unknown as NonNullable<Linter.Config['plugins']>[string],
    },
    rules: SANDBOX_RULES,
  },
];

/**
 * Extract the `<script>` block(s) of a `.vue` SFC into a TypeScript-shaped
 * string, preserving original line numbers so reported locations point at the
 * real source line. Non-script lines are blanked out.
 */
function extractVueScript(content: string): string {
  const lines = content.split('\n');
  const out: string[] = new Array(lines.length).fill('');

  const scriptBlock = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptBlock.exec(content)) !== null) {
    const openTagEnd = match.index + match[0].indexOf('>') + 1;
    const startLine = content.slice(0, openTagEnd).split('\n').length - 1;
    const scriptLines = match[1].split('\n');
    for (let i = 0; i < scriptLines.length; i++) {
      out[startLine + i] = scriptLines[i];
    }
  }

  return out.join('\n');
}

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
      continue;
    }
    if (entry.name.endsWith('.d.ts')) continue;
    if (/\.(ts|tsx|js|jsx|vue)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Scan every game source file under `<cwd>/src` for forbidden APIs.
 * Returns one violation per offending location.
 */
export function scanSandboxViolations(cwd: string): SandboxViolation[] {
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) return [];

  const linter = new Linter();
  const violations: SandboxViolation[] = [];

  for (const filePath of collectSourceFiles(srcDir)) {
    const raw = readFileSync(filePath, 'utf-8');
    const code = filePath.endsWith('.vue') ? extractVueScript(raw) : raw;
    if (code.trim() === '') continue;

    // Pass the cwd-relative path: flat-config `files` globs are matched relative
    // to the project root and do not match absolute paths.
    const relPath = relative(cwd, filePath);
    const messages = linter.verify(code, FLAT_CONFIG, relPath);
    for (const m of messages) {
      // Skip parser errors from exotic syntax — we only enforce sandbox rules,
      // TypeScript compilation is validated separately.
      if (!m.ruleId) continue;
      violations.push({
        file: relPath,
        line: m.line,
        column: m.column,
        ruleId: m.ruleId,
        message: m.message,
      });
    }
  }

  return violations;
}
