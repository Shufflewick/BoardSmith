import { DESIGN_DIR } from './lib/project-paths.js';
import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * `cli.test.ts` — registration-level proof that CHECK-04's dual-enumeration read/report and
 * write commands are actually reachable from the real CLI entry point (177.1-04's own stated
 * purpose: "the exact wave that makes the check reachable"), and that the retired
 * `verify-derive-recheck` name is gone.
 *
 * Spawns the real `bin/boardsmith.js` entry point as a child process (mirroring
 * `cli-conformance-commands.test.ts`'s own discipline), never calls a command function
 * in-process — a `--help` invocation and an unknown-command invocation are both real Commander
 * behaviors this suite needs to observe exactly as a user's shell would.
 */

/**
 * Every test in a file that spawns the real CLI needs more than vitest's 5s default: a spawn
 * boots Node, loads tsx, and type-strips the whole command tree, which under full-suite
 * parallelism can exceed 5s on its own. The default turned that latency into a flaky
 * assertion about nothing — these tests assert what the CLI REGISTERS, never how fast it
 * starts. This ceiling is a hang guard, not a performance budget.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at src/cli/cli.test.ts — repo root is two levels up.
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'bin', 'boardsmith.js');

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function spawnCli(args: string[], cwd: string = REPO_ROOT): Promise<SpawnResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('verify-derive-check — registration', () => {
  it('is registered: --help exits 0 and names --project and --json', async () => {
    const result = await spawnCli(['verify-derive-check', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verify-derive-check');
    expect(result.stdout).toContain('--project <dir>');
    expect(result.stdout).toContain('--json');
  });

  it('runs end-to-end against a real project and emits parseable, non-empty JSON, exit 0', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'bs-cli-verify-derive-check-'));
    try {
      const project = join(dir, 'project');
      await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
      await fs.writeFile(
        join(project, DESIGN_DIR, 'rulebook', '01-x.md'),
        'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 7 unique numbers.\n',
      );

      const result = await spawnCli(['verify-derive-check', '--project', project, '--json']);

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed.slices)).toBe(true);
      expect(parsed.slices.length).toBeGreaterThan(0);
      expect(parsed.models).toEqual({
        enumeratorA: 'claude-opus-5',
        enumeratorB: 'claude-haiku-4-5-20251001',
        reconciler: 'claude-sonnet-5',
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('verify-derive-recheck — the retired command is unreachable', () => {
  it('is NOT registered: exits non-zero with commander\'s own "unknown command" error', async () => {
    const result = await spawnCli(['verify-derive-recheck', '--project', REPO_ROOT]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('unknown command');
    expect(result.stderr).toContain('verify-derive-recheck');
  });
});

describe('verify-derive-record — retargeted registration', () => {
  it('lists exactly --project, --slice-path, --enumerator-a, --enumerator-b, --reconciler, --json (plus -h)', async () => {
    const result = await spawnCli(['verify-derive-record', '--help']);
    expect(result.code).toBe(0);

    for (const flag of [
      '--project',
      '--slice-path',
      '--enumerator-a',
      '--enumerator-b',
      '--reconciler',
      '--json',
      '-h, --help',
    ]) {
      expect(result.stdout).toContain(flag);
    }

    // None of the retired four-verdict-set flags survive the retarget.
    for (const retiredFlag of [
      '--line-number',
      '--original-line',
      '--verdict',
      '--reasoning',
      '--rederived-value',
      '--original-reading',
      '--rederived-reading',
      '--source-quote',
      '--fact-alignment',
      '--run-id',
    ]) {
      expect(result.stdout).not.toContain(retiredFlag);
    }
  });
});

describe('verify-example-replay — registration (CHECK-06)', () => {
  it('is registered: --help exits 0 and lists exactly --project, --json, --chunk (plus -h), never --run-id or a bypass flag', async () => {
    const result = await spawnCli(['verify-example-replay', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verify-example-replay');

    for (const flag of ['--project <dir>', '--json', '--chunk <slug>', '-h, --help']) {
      expect(result.stdout).toContain(flag);
    }
    for (const bypassFlag of ['--run-id', '--force', '--skip', '--overwrite']) {
      expect(result.stdout).not.toContain(bypassFlag);
    }
  });

  it('runs end-to-end against a real project and emits parseable, non-empty JSON, exit 0', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'bs-cli-verify-example-replay-'));
    try {
      const project = join(dir, 'project');
      await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
      await fs.writeFile(
        join(project, DESIGN_DIR, 'rulebook', '01-x.md'),
        'p.1, Punch Examples:\n"If you are punched while READY, you become EXHAUSTED."\n',
      );

      const result = await spawnCli(['verify-example-replay', '--project', project, '--json']);

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed.slices)).toBe(true);
      expect(parsed.slices.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.unarchivedSources)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('verify-example-record — registration (CHECK-06, the ONLY write surface)', () => {
  it('is registered: --help exits 0 and lists --slice-path, --extraction, --translation as required, never --run-id or a bypass flag', async () => {
    const result = await spawnCli(['verify-example-record', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verify-example-record');

    for (const flag of [
      '--project <dir>',
      '--slice-path <path>',
      '--extraction <file>',
      '--translation <file>',
      '--json',
      '-h, --help',
    ]) {
      expect(result.stdout).toContain(flag);
    }
    for (const bypassFlag of ['--run-id', '--force', '--skip', '--overwrite']) {
      expect(result.stdout).not.toContain(bypassFlag);
    }
  });

  it('exits non-zero with a message naming the missing required options when none are supplied', async () => {
    const result = await spawnCli(['verify-example-record', '--project', '/tmp']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('required option');
  });
});

describe('verify-example-translate — registration (CHECK-06, the second dispatch\'s byte source)', () => {
  it('is registered: --help exits 0 and lists exactly --project, --slice-path, --extraction, --json (plus -h), never --run-id or a bypass flag', async () => {
    const result = await spawnCli(['verify-example-translate', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verify-example-translate');

    for (const flag of [
      '--project <dir>',
      '--slice-path <path>',
      '--extraction <file>',
      '--json',
      '-h, --help',
    ]) {
      expect(result.stdout).toContain(flag);
    }
    for (const bypassFlag of ['--run-id', '--force', '--skip', '--overwrite']) {
      expect(result.stdout).not.toContain(bypassFlag);
    }
  });

  it('exits non-zero with a message naming the missing required options when none are supplied', async () => {
    const result = await spawnCli(['verify-example-translate', '--project', '/tmp']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('required option');
  });

  it('runs end-to-end against a real project and emits parseable, non-empty JSON, exit 0', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'bs-cli-verify-example-translate-'));
    try {
      const project = join(dir, 'project');
      await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
      await fs.mkdir(join(project, 'src', 'rules'), { recursive: true });
      await fs.writeFile(
        join(project, DESIGN_DIR, 'rulebook', '02-punch.md'),
        'p.2, Punch Examples:\n"If you are punched while READY, you become EXHAUSTED."\n',
      );
      await fs.writeFile(
        join(project, 'src', 'rules', 'index.ts'),
        'export function checkPunch(input: { ready: boolean }): boolean {\n' +
          '  return input.ready;\n' +
          '}\n',
      );
      const extraction = [
        {
          slicePath: 'rulebook/02-punch.md',
          lineNumber: 2,
          pageCitation: 'p.2, Punch Examples',
          kind: 'transition',
          sourceText: 'If you are punched while READY, you become EXHAUSTED.',
          setup: 'Guard is READY.',
          action: 'Guard is punched.',
          expected: 'Guard becomes EXHAUSTED.',
          supportingQuoteLines: ['If you are punched while READY, you become EXHAUSTED.'],
        },
      ];
      const extractionPath = join(dir, 'extraction.json');
      await fs.writeFile(extractionPath, JSON.stringify(extraction, null, 2));

      const result = await spawnCli([
        'verify-example-translate',
        '--project',
        project,
        '--slice-path',
        'rulebook/02-punch.md',
        '--extraction',
        extractionPath,
        '--json',
      ]);

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed.payloads)).toBe(true);
      expect(parsed.payloads.length).toBe(1);
      expect(parsed.payloads[0].translationPayload).toContain('BS-EXAMPLE-TRANSLATE-V1');
      expect(Array.isArray(parsed.notTranslated)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('verify-example-emit — registration (TEST-01, the build-side write surface)', () => {
  it('is registered: --help exits 0 and lists exactly --project, --chunk (required), --translated, --json (plus -h), never --run-id or a bypass flag', async () => {
    const result = await spawnCli(['verify-example-emit', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verify-example-emit');

    for (const flag of [
      '--project <dir>',
      '--chunk <slug>',
      '--translated <file>',
      '--json',
      '-h, --help',
    ]) {
      expect(result.stdout).toContain(flag);
    }
    for (const bypassFlag of ['--run-id', '--force', '--skip', '--overwrite']) {
      expect(result.stdout).not.toContain(bypassFlag);
    }
  });

  it('exits non-zero naming --chunk as required when it is not supplied', async () => {
    const result = await spawnCli(['verify-example-emit', '--project', '/tmp']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('required option');
    expect(result.stderr).toContain('--chunk');
  });

  it('runs end-to-end against a real project with zero worked examples, exit 0, and writes a real file', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'bs-cli-verify-example-emit-'));
    try {
      const project = join(dir, 'project');
      await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
      await fs.writeFile(join(project, DESIGN_DIR, 'rulebook', '01-x.md'), 'No worked examples here.\n');
      await fs.mkdir(join(project, DESIGN_DIR, 'chunks', 'chunk-a'), { recursive: true });
      await fs.writeFile(
        join(project, DESIGN_DIR, 'chunks', 'chunk-a', 'CHUNK.md'),
        '# chunk-a\n\n## Verified Against\n\nCites rulebook/01-x.md.\n',
      );

      const result = await spawnCli([
        'verify-example-emit',
        '--project',
        project,
        '--chunk',
        'chunk-a',
        '--json',
      ]);

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.chunkExempt).toBe(true);
      expect(parsed.emittedCount).toBe(0);
      const bytes = await fs.readFile(
        join(project, 'tests', 'examples', 'chunk-a.examples.test.ts'),
        'utf-8',
      );
      expect(bytes).toContain('chunk-a');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
