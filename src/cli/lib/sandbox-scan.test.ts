import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSandboxViolations } from './sandbox-scan.js';

describe('scanSandboxViolations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bs-sandbox-'));
    mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
    mkdirSync(join(dir, 'src', 'ui', 'components'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(rel: string, content: string) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }

  it('flags forbidden APIs in src/rules', () => {
    write('src/rules/game.ts', 'export const x: number = Math.random();\n');
    const violations = scanSandboxViolations(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('boardsmith/no-nondeterministic');
    expect(violations[0].file).toBe('src/rules/game.ts');
    expect(violations[0].line).toBe(1);
  });

  // Security rules (network/filesystem/eval) are enforced everywhere, including
  // UI helpers outside src/rules.
  it('flags security violations in UI helpers outside src/rules', () => {
    write('src/ui/helper.ts', 'export function load(): Promise<Response> {\n  return fetch("/data");\n}\n');
    const violations = scanSandboxViolations(dir);
    expect(violations.map((v) => v.ruleId)).toContain('boardsmith/no-network');
    expect(violations.find((v) => v.ruleId === 'boardsmith/no-network')?.file).toBe('src/ui/helper.ts');
  });

  // .vue single-file components are scanned, with correct line numbers.
  it('flags violations inside .vue <script> blocks with correct line numbers', () => {
    write(
      'src/ui/components/Board.vue',
      '<template>\n  <div />\n</template>\n\n<script setup lang="ts">\nconst data = fetch("/data");\n</script>\n',
    );
    const violations = scanSandboxViolations(dir);
    const net = violations.find((v) => v.ruleId === 'boardsmith/no-network');
    expect(net).toBeDefined();
    expect(net?.file).toBe('src/ui/components/Board.vue');
    // fetch() is on line 6 of the SFC.
    expect(net?.line).toBe(6);
  });

  // Determinism rules are scoped to executor code. Timers and randomness in the
  // browser-only UI bundle are legitimate (e.g. requestAnimationFrame-driven
  // animations) and must NOT be flagged; the same APIs in src/rules still are.
  it('does not flag determinism APIs in src/ui but does in src/rules', () => {
    write(
      'src/ui/anim.ts',
      'export function go() {\n  requestAnimationFrame(() => {});\n  setTimeout(() => {}, 16);\n  return Math.random();\n}\n',
    );
    write('src/rules/logic.ts', 'export const r = Math.random();\n');
    const violations = scanSandboxViolations(dir);
    expect(violations.some((v) => v.file === 'src/ui/anim.ts')).toBe(false);
    expect(
      violations.some(
        (v) => v.file === 'src/rules/logic.ts' && v.ruleId === 'boardsmith/no-nondeterministic',
      ),
    ).toBe(true);
  });

  // Security rules remain enforced inside src/ui even though determinism is not.
  it('still flags security APIs in src/ui', () => {
    write('src/ui/net.ts', 'export function go() { return fetch("/x"); }\n');
    const violations = scanSandboxViolations(dir);
    expect(
      violations.some((v) => v.file === 'src/ui/net.ts' && v.ruleId === 'boardsmith/no-network'),
    ).toBe(true);
  });

  // AST accuracy: commented-out / string occurrences must NOT trip the scanner
  // (the old naive-regex scanner produced false positives here).
  it('does not flag forbidden APIs that appear only in comments or strings', () => {
    write(
      'src/rules/clean.ts',
      [
        '// Math.random() is forbidden, but this comment must not trip the scan.',
        'export const note = "do not call fetch() here";',
        'export const safe = 1;',
      ].join('\n') + '\n',
    );
    expect(scanSandboxViolations(dir)).toHaveLength(0);
  });

  it('returns nothing for clean source', () => {
    write('src/rules/game.ts', 'export const score = 42;\n');
    write('src/ui/App.ts', 'export const name = "ok";\n');
    expect(scanSandboxViolations(dir)).toHaveLength(0);
  });

  it('catches every forbidden category across the whole src tree', () => {
    write('src/rules/a.ts', 'export const r = Math.random();\n');
    write('src/rules/b.ts', "import fs from 'node:fs';\nexport const _ = fs;\n");
    write('src/ui/c.ts', 'export function go() { return fetch("/x"); }\n');
    write('src/rules/d.ts', 'export function go() { setTimeout(() => {}, 1); }\n');
    write('src/ui/e.ts', 'export const v = eval("1");\n');
    const rules = new Set(scanSandboxViolations(dir).map((v) => v.ruleId));
    expect(rules).toContain('boardsmith/no-nondeterministic');
    expect(rules).toContain('boardsmith/no-filesystem');
    expect(rules).toContain('boardsmith/no-network');
    expect(rules).toContain('boardsmith/no-timers');
    expect(rules).toContain('boardsmith/no-eval');
  });

  // F51: network access via module imports must be caught, not just bare fetch().
  it('flags networking module imports and member-expression fetch', () => {
    write('src/rules/a.ts', "import https from 'node:https';\nexport const _ = https;\n");
    write('src/ui/b.ts', "const net = require('net');\nexport const __ = net;\n");
    write('src/ui/c.ts', 'export function go() { return window.fetch("/x"); }\n');
    write('src/rules/d.ts', "export const p = import('dgram');\n");
    const network = scanSandboxViolations(dir).filter(
      (v) => v.ruleId === 'boardsmith/no-network',
    );
    const files = new Set(network.map((v) => v.file));
    expect(files).toContain('src/rules/a.ts');
    expect(files).toContain('src/ui/b.ts');
    expect(files).toContain('src/ui/c.ts');
    expect(files).toContain('src/rules/d.ts');
  });
});
