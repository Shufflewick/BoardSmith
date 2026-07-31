import { describe, it, expect } from 'vitest';
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
      await fs.mkdir(join(project, 'rulebook'), { recursive: true });
      await fs.writeFile(
        join(project, 'rulebook', '01-x.md'),
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
