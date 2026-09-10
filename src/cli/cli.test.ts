import { DESIGN_DIR } from './lib/project-paths.js';
import { describe, it, expect, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, readdirSync, readFileSync } from 'node:fs';
import { tempTree } from '../testing/temp-tree.test-helper.js';
import { REPO_ROOT, spawnCli } from './spawn-cli.test-helper.js';

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

// A spawn can exceed vitest's 5s default under full-suite parallelism. This is a hang guard,
// not a performance budget; spawn-cli.test-helper.ts says why.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('verify-derive-check — registration', () => {
  it('is registered: --help exits 0 and names --project and --json', async () => {
    const result = await spawnCli(['verify-derive-check', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verify-derive-check');
    expect(result.stdout).toContain('--project <dir>');
    expect(result.stdout).toContain('--json');
  });

  it('runs end-to-end against a real project and emits parseable, non-empty JSON, exit 0', async () => {
    const dir = tempTree('bs-cli-verify-derive-check-');
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
    const dir = tempTree('bs-cli-verify-example-replay-');
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
    const dir = tempTree('bs-cli-verify-example-translate-');
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
    const dir = tempTree('bs-cli-verify-example-emit-');
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
  });
});

/**
 * `cli.ts`'s top-level handler renders a thrown Error as ONE clean line, and that is the whole
 * of what a user is allowed to see when a command fails: CLAUDE.md's error-handling rule forbids
 * leaking implementation details, "line numbers, stack traces, internal paths" by name.
 *
 * #240 found `init` printing `console.error(error)` -- the whole Error object, `at async
 * Command.initCommand (/Users/.../src/cli/commands/init.ts:290:5)` and all -- and exiting before
 * the handler could see it. It was not alone: eleven sites across six commands handed a raw
 * error object to `console.error`, each of which prints Node's own formatting of it, stack
 * included.
 *
 * There are two correct shapes, and no third:
 *   - a TERMINAL failure throws, and the handler above reports it;
 *   - a failure a RUNNING server recovers from (a world reload, a socket message) has nothing to
 *     throw to, so it logs `error.message` and keeps going.
 * Both are one line of prose. Neither is the error object.
 */
describe('no CLI failure reaches a user as a raw error object', () => {
  const cliDir = dirname(fileURLToPath(import.meta.url));

  /** Comments are stripped: several of them quote the defect they replaced. */
  function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  /** Every `console.error(...)` call's argument text, parens balanced. */
  function consoleErrorArguments(text: string): string[] {
    const calls: string[] = [];
    const CALL = 'console.error(';
    for (let at = text.indexOf(CALL); at !== -1; at = text.indexOf(CALL, at + 1)) {
      let depth = 0;
      for (let i = at + CALL.length - 1; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')' && --depth === 0) {
          calls.push(text.slice(at + CALL.length, i).replace(/\s+/g, ' '));
          break;
        }
      }
    }
    return calls;
  }

  const files = readdirSync(cliDir, { recursive: true, encoding: 'utf-8' })
    .filter((path) => path.endsWith('.ts') || path.endsWith('.mjs'))
    .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test-helper.ts'))
    .filter((path) => !path.includes('__fixtures__'))
    .map((path) => ({ path, text: stripComments(readFileSync(join(cliDir, path), 'utf-8')) }));

  it('reads the CLI tree it thinks it is reading', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('never hands a caught error itself to console.error', () => {
    const offenders = files.flatMap(({ path, text }) =>
      consoleErrorArguments(text)
        .filter((args) => /(?:^|[\s,(])(?:error|err|e)\s*(?:,|$)/.test(args))
        .map((args) => `${path}: console.error(${args})`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('init reports a bad <name> as one clean line (#240)', () => {
  it('refuses a path-shaped name with no stack trace and no internal path', async () => {
    const dir = tempTree('bs-cli-init-240-');
    const result = await spawnCli(['init', join(dir, 'mygame'), '--without-rulebook'], dir);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('is a path, not a name');
    // What the issue reported seeing instead: stack frames, a source line
    // inside the CLI, and the absolute path of this repository.
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(result.stderr).not.toMatch(/\.ts:\d+/);
    expect(result.stderr).not.toContain(REPO_ROOT);
    expect(result.stderr).not.toContain('node_modules');
    // And nothing was created where the name would have been joined onto cwd.
    expect(readdirSync(dir)).toEqual([]);
  });
});
