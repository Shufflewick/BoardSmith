import { DESIGN_DIR } from './lib/project-paths.js';
import { generateTsConfig } from './lib/project-scaffold.js';
import { describe, it, expect, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, readdirSync, readFileSync } from 'node:fs';
import { tempTree } from '../testing/temp-tree.test-helper.js';
import { renderIndex } from './commands/ingest-archive.js';
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
    expect(parsed.roles).toEqual({
      enumeratorA: 'judgement',
      enumeratorB: 'second-opinion',
      reconciler: 'judgement',
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

/**
 * `<command> --help` exits 0 and lists every one of `flags`, and none of the bypass flags a
 * CHECK-06 command must never grow. Returns the help text for a case's own extra checks.
 */
async function expectHelpWithoutBypass(command: string, flags: string[]): Promise<string> {
  const result = await spawnCli([command, '--help']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(command);
  for (const flag of flags) {
    expect(result.stdout).toContain(flag);
  }
  for (const bypassFlag of ['--run-id', '--force', '--skip', '--overwrite']) {
    expect(result.stdout).not.toContain(bypassFlag);
  }
  return result.stdout;
}

describe('verify-example-replay — registration (CHECK-06)', () => {
  it('is registered: --help exits 0 and lists exactly --project, --json, --chunk (plus -h), never --run-id or a bypass flag', async () => {
    await expectHelpWithoutBypass('verify-example-replay', [
      '--project <dir>',
      '--json',
      '--chunk <slug>',
      '-h, --help',
    ]);
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

describe('verify-example-record — registration (CHECK-06, the extraction/translation write surface)', () => {
  it('is registered: --help exits 0 and lists --slice-path, --extraction, --translations as required, never --run-id or a bypass flag', async () => {
    await expectHelpWithoutBypass('verify-example-record', [
      '--project <dir>',
      '--slice-path <path>',
      '--extraction <file>',
      '--translations <file>',
      '--json',
      '-h, --help',
    ]);
  });

  it('exits non-zero with a message naming the missing required options when none are supplied', async () => {
    const result = await spawnCli(['verify-example-record', '--project', '/tmp']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('required option');
  });
});

describe('verify-example-ledger-upgrade — the one-time lineText upgrade (#371)', () => {
  it('is registered with --project and --json, and no bypass flag', async () => {
    await expectHelpWithoutBypass('verify-example-ledger-upgrade', ['--project <dir>', '--json', '-h, --help']);
  });

  it('ingest-check refuses a pre-lineText ledger naming the upgrade, and passes once it has run', async () => {
    const dir = tempTree('bs-cli-example-ledger-upgrade-');
    const project = join(dir, 'project');
    const rulebook = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(join(rulebook, '.example-replay'), { recursive: true });
    const line = 'Example (p.2): "Draw a card, then discard one."';
    await fs.writeFile(join(rulebook, '02-turn.md'), `# Turn\n\np.2, Turn:\n${line}\n`);
    await fs.writeFile(
      join(rulebook, 'INDEX.md'),
      renderIndex({
        gameName: 'interview',
        edition: 'unpublished — designer statement',
        archivedPath: 'not applicable — no source rulebook (interview path)',
        sourceHash: 'not applicable — no source rulebook (interview path)',
        transcribed: '2026-09-24',
      }),
    );
    const oldRecord = {
      exampleId: 'rulebook/02-turn.md:4',
      slicePath: 'rulebook/02-turn.md',
      lineNumber: 4,
      kind: 'transition',
      verdict: 'unexecutable',
      reason: 'no-matching-symbol: nothing draws a card yet.',
      supportingQuoteLines: [line],
      provenance: 'quote-verified',
      recordedAt: '2026-09-24T04:02:35.674Z',
    };
    await fs.writeFile(
      join(rulebook, '.example-replay', 'EXAMPLE-VERDICTS.md'),
      '<!-- boardsmith:example-replay-verdicts:begin -->\n' +
        `${JSON.stringify(oldRecord)}\n` +
        '<!-- boardsmith:example-replay-verdicts:end -->\n',
    );

    const refused = await spawnCli(['ingest-check', '--project', project, '--json']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('npx boardsmith verify-example-ledger-upgrade');
    expect(refused.stderr).not.toMatch(/\bat \S+\.ts:\d+/);

    const upgraded = await spawnCli(['verify-example-ledger-upgrade', '--project', project, '--json']);
    expect(upgraded.code).toBe(0);
    expect(JSON.parse(upgraded.stdout).upgraded).toEqual(['rulebook/02-turn.md:4']);

    const checked = await spawnCli(['ingest-check', '--project', project, '--json']);
    expect(checked.stderr).not.toContain('example-replay ledger');
    expect(JSON.parse(checked.stdout).unanchoredExamples).toEqual([]);
  });
});

describe('chunk-gate-transition — the one-time transition of chunks verified before the gates (#397)', () => {
  it('is registered with --project, --by and --json, and no bypass flag', async () => {
    await expectHelpWithoutBypass('chunk-gate-transition', ['--project <dir>', '--by <designer>', '--json', '-h, --help']);
  });

  it('refuses without the designer, in a readable message', async () => {
    const result = await spawnCli(['chunk-gate-transition', '--project', '/tmp']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--by');
    expect(result.stderr).not.toMatch(/\bat \S+\.ts:\d+/);
  });
});

describe('verify-example-translate — registration (CHECK-06, the second dispatch\'s byte source)', () => {
  it('is registered: --help exits 0 and lists exactly --project, --slice-path, --extraction, --json (plus -h), never --run-id or a bypass flag', async () => {
    await expectHelpWithoutBypass('verify-example-translate', [
      '--project <dir>',
      '--slice-path <path>',
      '--extraction <file>',
      '--json',
      '-h, --help',
    ]);
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
    // Every generated game has one; the API surface resolves modules with it.
    await fs.writeFile(join(project, 'tsconfig.json'), generateTsConfig());
    const extraction = {
      examples: [
        {
          lineNumber: 2,
          pageCitation: 'p.2, Punch Examples',
          kind: 'transition',
          sourceText: 'If you are punched while READY, you become EXHAUSTED.',
          setup: 'Guard is READY.',
          action: 'Guard is punched.',
          expected: 'Guard becomes EXHAUSTED.',
          supportingQuoteLines: ['If you are punched while READY, you become EXHAUSTED.'],
        },
      ],
    };
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
  it('is registered: --help exits 0 and lists exactly --project, --chunk (required), --json (plus -h), never --run-id or a bypass flag', async () => {
    const help = await expectHelpWithoutBypass('verify-example-emit', [
      '--project <dir>',
      '--chunk <slug>',
      '--json',
      '-h, --help',
    ]);
    // The translated tests come from the ledger (#319); there is no side input to pass.
    expect(help).not.toContain('--translated');
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

describe('verify-example-run — registration (the only source of agrees/disagrees)', () => {
  it('is registered: --help exits 0 and lists --project, --chunk (required), --json, never --run-id or a bypass flag', async () => {
    await expectHelpWithoutBypass('verify-example-run', [
      '--project <dir>',
      '--chunk <slug>',
      '--json',
      '-h, --help',
    ]);
  });

  it('exits non-zero naming --chunk as required when it is not supplied', async () => {
    const result = await spawnCli(['verify-example-run', '--project', '/tmp']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--chunk');
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

describe('init --into-existing is a flag on the real command (#304)', () => {
  it('refuses a conflicting scaffold file as one clean line naming it', async () => {
    const repo = tempTree('bs-cli-init-304-');
    await fs.mkdir(join(repo, '.git'));
    await fs.writeFile(join(repo, 'package.json'), '{}\n');

    const result = await spawnCli(['init', 'mygame', '--without-rulebook', '--into-existing'], repo);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('package.json');
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(result.stderr).not.toContain(REPO_ROOT);
    expect(readdirSync(repo).sort()).toEqual(['.git', 'package.json']);
  });
});

/**
 * #551: `boardsmith audit --duplication` ran an unpinned jscpd through npx. It
 * was removed, not pinned: `--dupes-baseline` (the pinned fallow's duplication
 * scan) does the same job with a baseline. The flag must be refused, not
 * silently ignored, so a script still passing it finds out.
 */
describe('audit --duplication — the retired jscpd check is unreachable', () => {
  it('is refused with commander\'s own "unknown option" error', async () => {
    const result = await spawnCli(['audit', '--duplication']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--duplication'");
  });

  it('is not listed in `audit --help`', async () => {
    const result = await spawnCli(['audit', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('--duplication');
  });
});
