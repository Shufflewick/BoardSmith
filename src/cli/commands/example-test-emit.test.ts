import { DESIGN_DIR } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseTypeScript } from '@typescript-eslint/parser';
import {
  generatedTestFilePath,
  scanGeneratedTestCode,
  verifyExampleEmitCommand,
  GENERATED_TEST_SANDBOX_RULES,
} from './example-test-emit.js';
import {
  createExampleReplayRecord,
  recordExampleReplayVerdicts,
  exampleReplayLedgerPath,
  type ExampleTranslation,
} from './verify-example-replay.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

const execFileAsync = promisify(execFile);

// Running an emitted file in a real vitest process is what several tests here prove, and that
// process can take longer than vitest's 5s default on a loaded machine (#340). This is a hang
// guard, not a performance budget; spawn-cli.test-helper.ts says why.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Run a generated project's tests with a real vitest process and return what it printed.
 *
 * The project gets this checkout's installed packages as its `node_modules`, the live-symlink
 * layout every BoardSmithGames project uses, so 'vitest' resolves exactly as it would for a real
 * generated game. The install is the one Node resolves from here, which in a git worktree is the
 * main checkout's (#287). Rejects on a non-zero exit: a syntax error, an executed `require(...)`
 * or a file vitest collects no test from all fail the calling test.
 */
async function runVitestIn(project: string): Promise<string> {
  await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
  const { stdout } = await execFileAsync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['run'], {
    cwd: project,
  });
  return stdout;
}

async function mkProject(dir: string, opts: { chunkSlug: string; slicePath: string; sliceText: string }) {
  const project = join(dir, 'project');
  const sliceName = opts.slicePath.slice('rulebook/'.length);
  await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
  await fs.writeFile(join(project, DESIGN_DIR, 'rulebook', sliceName), opts.sliceText);
  await fs.mkdir(join(project, DESIGN_DIR, 'chunks', opts.chunkSlug), { recursive: true });
  await fs.writeFile(
    join(project, DESIGN_DIR, 'chunks', opts.chunkSlug, 'CHUNK.md'),
    `# ${opts.chunkSlug}\n\n## Verified Against\n\nCites ${opts.slicePath}.\n`,
  );
  return project;
}

/** A translated example's record, as verify-example-record writes it, on rulebook/02-punch.md. */
function translatedRecord(
  lineNumber: number,
  translation: Partial<ExampleTranslation> = {},
  overrides: Partial<Parameters<typeof createExampleReplayRecord>[0]> = {},
) {
  return createExampleReplayRecord({
    exampleId: `rulebook/02-punch.md:${lineNumber}`,
    slicePath: 'rulebook/02-punch.md',
    lineNumber,
    kind: 'transition',
    verdict: 'not-run',
    reason: 'Translated into a test that has not been run yet.',
    expected: 'Guard becomes EXHAUSTED.',
    provenance: 'quote-verified',
    translation: {
      pageCitation: 'p.2, Punch Examples',
      sourceText: 'If you are punched while READY, you become EXHAUSTED.',
      testCode:
        "it('a READY guard becomes EXHAUSTED when punched', () => {\n  expect(true).toBe(true);\n});",
      imports: [],
      ...translation,
    },
    ...overrides,
  });
}

describe('generatedTestFilePath', () => {
  it('resolves to tests/examples/<chunkSlug>.examples.test.ts under projectDir', () => {
    expect(generatedTestFilePath('/proj', 'my-chunk')).toBe(
      '/proj/tests/examples/my-chunk.examples.test.ts',
    );
  });

  it('rejects a slug containing a path separator', () => {
    expect(() => generatedTestFilePath('/proj', '../evil')).toThrow(/path separator|\.\./);
    expect(() => generatedTestFilePath('/proj', 'a/b')).toThrow(/path separator/);
    expect(() => generatedTestFilePath('/proj', '..')).toThrow(/path separator|\.\./);
  });

  it('rejects an empty slug', () => {
    expect(() => generatedTestFilePath('/proj', '')).toThrow();
  });
});

describe('scanGeneratedTestCode', () => {
  it('reports GENERATED_TEST_SANDBOX_RULES violations (e.g. fetch)', () => {
    const violations = scanGeneratedTestCode(
      'export function go() { return fetch("/x"); }',
      'tests/examples/foo.examples.test.ts',
    );
    expect(violations.some((v) => v.ruleId === 'boardsmith/no-network')).toBe(true);
  });

  it('does NOT report a rule excluded from GENERATED_TEST_SANDBOX_RULES (fs import)', () => {
    expect(GENERATED_TEST_SANDBOX_RULES).not.toContain('boardsmith/no-filesystem');
    const violations = scanGeneratedTestCode(
      "import fs from 'node:fs';\nexport const x = fs;",
      'tests/examples/foo.examples.test.ts',
    );
    expect(violations.some((v) => v.ruleId === 'boardsmith/no-filesystem')).toBe(false);
  });

  it('does NOT report a rule excluded from GENERATED_TEST_SANDBOX_RULES (Math.random)', () => {
    expect(GENERATED_TEST_SANDBOX_RULES).not.toContain('boardsmith/no-nondeterministic');
    const violations = scanGeneratedTestCode(
      'export const x = Math.random();',
      'tests/examples/foo.examples.test.ts',
    );
    expect(violations.some((v) => v.ruleId === 'boardsmith/no-nondeterministic')).toBe(false);
  });

  // CR-01 (178-REVIEW.md): GENERATED_TEST_SANDBOX_RULES named these two rules, but
  // sandbox-scan.ts's FLAT_CONFIG never enabled them, so ESLint never even ran them — restricting
  // the report to a rule id that was never active is a no-op, not a filter. These two cases prove
  // both rules actually FIRE through scanGeneratedTestCode now that FLAT_CONFIG enables them.
  it('reports boardsmith/no-element-identity-comparison (a GENERATED_TEST_SANDBOX_RULES member)', () => {
    expect(GENERATED_TEST_SANDBOX_RULES).toContain('boardsmith/no-element-identity-comparison');
    const violations = scanGeneratedTestCode(
      'class Card extends GameElement {}\n' +
        'function f(card1: Card, card2: Card) {\n' +
        '  return card1 === card2;\n' +
        '}\n',
      'tests/examples/foo.examples.test.ts',
    );
    expect(violations.some((v) => v.ruleId === 'boardsmith/no-element-identity-comparison')).toBe(
      true,
    );
  });

  it('reports boardsmith/no-element-array-state (a GENERATED_TEST_SANDBOX_RULES member)', () => {
    expect(GENERATED_TEST_SANDBOX_RULES).toContain('boardsmith/no-element-array-state');
    const violations = scanGeneratedTestCode(
      'class Card extends GameElement {}\n' +
        'class GameState {\n' +
        '  hand: Card[] = [];\n' +
        '}\n',
      'tests/examples/foo.examples.test.ts',
    );
    expect(violations.some((v) => v.ruleId === 'boardsmith/no-element-array-state')).toBe(true);
  });
});

describe('verifyExampleEmitCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = tempTree('bs-example-emit-');
  });

  it('throws when --chunk is missing', async () => {
    await expect(verifyExampleEmitCommand({ project: dir })).rejects.toThrow('--chunk');
  });

  it('rejects a --chunk that resolves outside the chunks directory', async () => {
    await expect(
      verifyExampleEmitCommand({ project: dir, chunk: '../evil' }),
    ).rejects.toThrow(/resolves outside/);
  });

  it('emits a named exemption file for a chunk with zero recorded worked examples', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-a',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'No worked examples in this slice.\n',
    });

    const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-a' });
    expect(result.chunkExempt).toBe(true);
    expect(result.emittedCount).toBe(0);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');
    expect(bytes).toContain('chunk-a');
    expect(bytes).toContain('no worked examples');
    expect(bytes).not.toContain('it.skip');
  });

  it('a zero-example exemption file is real, runnable, PASSING vitest — proven by running it', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-vitest',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'No worked examples in this slice.\n',
    });
    await verifyExampleEmitCommand({ project, chunk: 'chunk-vitest' });

    // Run the emitted file inside its OWN generated project via the repo's own vitest CLI,
    // exercising REAL vitest execution against a real project layout (not file inspection).
    expect(await runVitestIn(project)).toMatch(/1 passed|1 test/i);
  });

  it('emits one file per chunk; regenerating chunk A never touches chunk B (D-08)', async () => {
    const project = join(dir, 'project');
    await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, DESIGN_DIR, 'rulebook', '01-a.md'), 'Slice A, no examples.\n');
    await fs.writeFile(join(project, DESIGN_DIR, 'rulebook', '01-b.md'), 'Slice B, no examples.\n');
    for (const slug of ['chunk-a', 'chunk-b']) {
      await fs.mkdir(join(project, DESIGN_DIR, 'chunks', slug), { recursive: true });
    }
    await fs.writeFile(
      join(project, DESIGN_DIR, 'chunks', 'chunk-a', 'CHUNK.md'),
      '# chunk-a\n\n## Verified Against\n\nCites rulebook/01-a.md.\n',
    );
    await fs.writeFile(
      join(project, DESIGN_DIR, 'chunks', 'chunk-b', 'CHUNK.md'),
      '# chunk-b\n\n## Verified Against\n\nCites rulebook/01-b.md.\n',
    );

    const resultA1 = await verifyExampleEmitCommand({ project, chunk: 'chunk-a' });
    const bytesA1 = await fs.readFile(resultA1.testFilePath, 'utf-8');

    const resultB = await verifyExampleEmitCommand({ project, chunk: 'chunk-b' });
    expect(resultB.testFilePath).not.toBe(resultA1.testFilePath);

    const bytesA2 = await fs.readFile(resultA1.testFilePath, 'utf-8');
    expect(bytesA2).toBe(bytesA1);
  });

  it('emitting the same chunk twice with the same inputs is byte-identical (idempotent)', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-idem',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'No worked examples.\n',
    });

    const result1 = await verifyExampleEmitCommand({ project, chunk: 'chunk-idem' });
    const bytes1 = await fs.readFile(result1.testFilePath, 'utf-8');

    const result2 = await verifyExampleEmitCommand({ project, chunk: 'chunk-idem' });
    const bytes2 = await fs.readFile(result2.testFilePath, 'utf-8');

    expect(bytes2).toBe(bytes1);
  });

  it('emits a real runnable test for a translated example, citing slicePath/lineNumber/pageCitation/sourceText', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-punch',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [translatedRecord(2)]);

    const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-punch' });
    expect(result.emittedCount).toBe(1);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');
    expect(bytes).toContain('rulebook/02-punch.md:2');
    expect(bytes).toContain('p.2, Punch Examples');
    expect(bytes).toContain('If you are punched while READY, you become EXHAUSTED.');
    expect(bytes).toContain('a READY guard becomes EXHAUSTED when punched');
    // Its test sits in a describe() named for the example, which is how a result names it.
    expect(bytes).toContain("  describe('rulebook/02-punch.md:2', () => {");
  });

  it.each(['not-run', 'agrees', 'disagrees'])(
    'emits the stored test of a %s record, so re-emitting after a run reproduces the same file',
    async (verdict) => {
      const project = await mkProject(dir, {
        chunkSlug: 'chunk-any-verdict',
        slicePath: 'rulebook/02-punch.md',
        sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
      });
      await recordExampleReplayVerdicts(project, [
        translatedRecord(2, {}, { verdict, observed: verdict === 'disagrees' ? 'Y' : '' }),
      ]);

      const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-any-verdict' });
      expect(result.emittedCount).toBe(1);
      expect(result.testBlockCount).toBe(1);
    },
  );

  it('hoists translated imports to file scope, deduplicated across examples, and the emitted file actually executes them (178-11 fix)', async () => {
    // Regression for a live-proof finding (178-11): test code alone has nowhere to put an
    // `import` statement — putting one inside a `describe()` body is a syntax error — so a
    // translated example that needs a project import could never actually run once emitted. This
    // proves the hoisted-imports path fixes that: two examples share one duplicate import, plus
    // each has its own distinct import, and the emitted file is executed by a real vitest process.
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-imports',
      slicePath: 'rulebook/02-punch.md',
      sliceText:
        'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n' +
        'p.2, Punch Examples:\nA second example, also about Guards.\n',
    });
    await recordExampleReplayVerdicts(project, [
      translatedRecord(2, {
        testCode: "it('asserts strictly using the shared import', () => {\n  strictEqual(1 + 1, 2);\n});",
        imports: ["import { strictEqual } from 'node:assert';"],
      }),
      translatedRecord(4, {
        sourceText: 'A second example, also about Guards.',
        testCode:
          "it('uses a second, distinct import', () => {\n  strictEqual(basename('/a/b.ts'), 'b.ts');\n});",
        imports: [
          "import { strictEqual } from 'node:assert';", // duplicate of example 1's import
          "import { basename } from 'node:path';",
        ],
      }),
    ]);

    const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-imports' });
    expect(result.emittedCount).toBe(2);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');
    // Hoisted once each, deduplicated — not once per example.
    expect(bytes.match(/import \{ strictEqual \} from 'node:assert';/g)?.length).toBe(1);
    expect(bytes).toContain("import { basename } from 'node:path';");
    // Never rendered inside the describe body — an import line never appears indented.
    expect(bytes).not.toMatch(/^[ \t]+import /m);

    expect(await runVitestIn(project)).toMatch(/2 passed|2 tests/i);
  });

  it('rejects a malformed translated import statement, naming the entry; writes nothing', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-bad-import',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [
      translatedRecord(2, { imports: ["import { x } from 'y'; process.exit(1);"] }),
    ]);

    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-bad-import' }),
    ).rejects.toThrow(/not a single well-formed "import ... ;" statement/);

    await expect(fs.access(generatedTestFilePath(project, 'chunk-bad-import'))).rejects.toThrow();
  });

  it('rejects translated code violating GENERATED_TEST_SANDBOX_RULES, naming the rule; writes nothing', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-net',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [
      translatedRecord(2, { testCode: "it('bad', async () => { await fetch('/x'); });" }),
    ]);

    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-net' }),
    ).rejects.toThrow('boardsmith/no-network');

    await expect(
      fs.access(join(project, 'tests', 'examples', 'chunk-net.examples.test.ts')),
    ).rejects.toThrow();
  });

  // -----------------------------------------------------------------------------------------
  // B19 — a translated snippet that declares no test of its own once produced a file that was
  // simultaneously "everything passed" and "there are no tests": the assertions ran at collect
  // time inside the describe() body, registered nothing, and vitest failed the file with
  // `No test found in suite` while the command printed `✓ … 1 test(s)`. The emitter never adds a
  // test of its own around the translator's bytes, so the self-contained `it(...)` block is the
  // ONE shape that can work — anything else is rejected before a byte is written.
  // -----------------------------------------------------------------------------------------

  it('rejects translated code with no top-level it()/test(), naming the example; writes nothing (B19)', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-bare',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [
      // The exact shape translate-example.md used to bless: bare statements, no `it(...)`.
      translatedRecord(2, { testCode: "const state = 'READY';\nexpect(state).toBe('READY');" }),
    ]);

    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-bare' }),
    ).rejects.toThrow(/rulebook\/02-punch\.md:2/);
    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-bare' }),
    ).rejects.toThrow(/declares no top-level `it\(\.\.\.\)` or `test\(\.\.\.\)` block/);

    // Nothing written: the file that would have collected zero tests never reaches disk.
    await expect(fs.access(generatedTestFilePath(project, 'chunk-bare'))).rejects.toThrow();
  });

  it('rejects a translated snippet that does not parse, naming the example; writes nothing', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-unparseable',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [
      translatedRecord(2, { testCode: "it('never closes its brace', () => {\n  expect(true).toBe(true);" }),
    ]);

    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-unparseable' }),
    ).rejects.toThrow(/rulebook\/02-punch\.md:2.*does not parse as TypeScript/s);

    await expect(fs.access(generatedTestFilePath(project, 'chunk-unparseable'))).rejects.toThrow();
  });

  it('every emitted file vitest is asked to run declares at least one test, and testBlockCount is that number (B19)', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-counted',
      slicePath: 'rulebook/02-punch.md',
      sliceText:
        'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n' +
        'p.2, Punch Examples:\nA second example, also about Guards.\n',
    });
    await recordExampleReplayVerdicts(project, [
      translatedRecord(2, { testCode: "it('becomes EXHAUSTED', () => {\n  expect(true).toBe(true);\n});" }),
      // One snippet, two tests — the ledger says "1 example" but the FILE carries two `it`s,
      // which is exactly the gap the old `N test(s)` (a ledger count) hid.
      translatedRecord(4, {
        sourceText: 'A second example, also about Guards.',
        testCode:
          "it('first half', () => {\n  expect(true).toBe(true);\n});\n" +
          "it('second half', () => {\n  expect(true).toBe(true);\n});",
      }),
    ]);

    const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-counted' });
    expect(result.emittedCount).toBe(2); // ledger records
    expect(result.testBlockCount).toBe(3); // tests the file actually declares

    // The authority on that number is vitest itself, not our own parse of the file.
    expect(await runVitestIn(project)).toMatch(/3 passed/i);
  });

  it('reports the chunk-wide exemption file as 1 test — the count vitest collects, not the ledger count', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-count-exempt',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'No worked examples in this slice.\n',
    });
    const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-count-exempt' });
    expect(result.emittedCount).toBe(0);
    expect(result.testBlockCount).toBe(1);
  });

  it('an exempt-only chunk asserts its exemption in a real test vitest collects and passes (B19)', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-exempt-only',
      slicePath: 'rulebook/03-seven.md',
      sliceText: 'example: 5, 6, 7\nexample: image-only\n',
    });
    await recordExampleReplayVerdicts(project, [
      createExampleReplayRecord({
        exampleId: 'rulebook/03-seven.md:1',
        slicePath: 'rulebook/03-seven.md',
        lineNumber: 1,
        kind: 'predicate',
        verdict: 'example-inconsistent',
        reason: 'Printed text says 5,6,7 but the card images show 1,2,3 (INDEX.md gap #4).',
        contradictionA: 'text: 5, 6, 7',
        contradictionB: 'images: 1, 2, 3',
        provenance: 'quote-verified',
      }),
      createExampleReplayRecord({
        exampleId: 'rulebook/03-seven.md:2',
        slicePath: 'rulebook/03-seven.md',
        lineNumber: 2,
        kind: 'predicate',
        verdict: 'unexecutable',
        reason: 'Image-derived and indeterminate — no assertable outcome.',
        provenance: 'quote-verified',
      }),
    ]);

    const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-exempt-only' });
    expect(result.emittedCount).toBe(0);
    expect(result.exemptCount).toBe(2);
    expect(result.chunkExempt).toBe(false);
    // The file declares exactly one test — the exemption itself — so the printed count is what
    // vitest will collect, and the file is never the uncollectable "No test found in suite" kind.
    expect(result.testBlockCount).toBe(1);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');
    // The test NAME alone must carry the real state, for a reader who only sees a CI log.
    expect(bytes).toContain('1 unexecutable, 1 example-inconsistent');
    expect(bytes).toContain('none executable');

    // runVitestIn REJECTS on a non-zero exit: a suite vitest collects nothing from exits 1.
    expect(await runVitestIn(project)).toMatch(/1 passed|1 test/i);
  });

  it('an unexecutable/example-inconsistent record is emitted as a named-reason comment, never a test', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-exempt-example',
      slicePath: 'rulebook/03-seven.md',
      sliceText: 'example: 5, 6, 7\n',
    });
    await recordExampleReplayVerdicts(project, [
      createExampleReplayRecord({
        exampleId: 'rulebook/03-seven.md:1',
        slicePath: 'rulebook/03-seven.md',
        lineNumber: 1,
        kind: 'predicate',
        verdict: 'example-inconsistent',
        reason: 'Printed text says 5,6,7 but the card images show 1,2,3 (INDEX.md gap #4).',
        contradictionA: 'text: 5, 6, 7',
        contradictionB: 'images: 1, 2, 3',
        provenance: 'quote-verified',
      }),
    ]);

    const result = await verifyExampleEmitCommand({ project, chunk: 'chunk-exempt-example' });
    expect(result.emittedCount).toBe(0);
    expect(result.exemptCount).toBe(1);
    expect(result.chunkExempt).toBe(false);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');
    expect(bytes).toContain('EXAMPLE-INCONSISTENT');
    expect(bytes).toContain('INDEX.md gap #4');
  });

  // -----------------------------------------------------------------------------------------
  // CR-02 + WR-03 (178-REVIEW.md) — hostile model/agent-controlled text (embedded newline, a
  // `*/`-shaped sequence, and a quote) must never break out of its syntactic context (a
  // single-quoted `describe()` title or a `//` comment line) into live, unscanned TypeScript
  // source. Proven two ways: (1) the emitted file still PARSES as valid TypeScript — not just a
  // string match — and (2) it is actually executed by a real vitest process and still runs
  // exactly the tests it should, proving the injected text never became live code.
  // -----------------------------------------------------------------------------------------

  it('a hostile chunkSlug/reason/pageCitation (newline, quote, "*/") never breaks generated-file syntax, proven by parsing it', async () => {
    // chunkSlug's only structural constraint is "no path separator, no ..": a quote/backtick is
    // legal input here (generatedTestFilePath's own guard, verified above, does not reject it).
    const hostileChunkSlug = "chunk-'hostile'";
    const project = await mkProject(dir, {
      chunkSlug: hostileChunkSlug,
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    const hostileReason =
      'Looks fine at a glance.\n*/ }); process.exit(1); //\nBut secretly hostile.';
    await recordExampleReplayVerdicts(project, [
      createExampleReplayRecord({
        exampleId: 'rulebook/02-punch.md:2',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
        kind: 'predicate',
        verdict: 'unexecutable',
        reason: hostileReason,
        provenance: 'quote-verified',
      }),
    ]);

    const result = await verifyExampleEmitCommand({ project, chunk: hostileChunkSlug });
    expect(result.exemptCount).toBe(1);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');

    // Must not have injected a raw newline into what's meant to be a single `//` comment line —
    // string-search alone (the old, insufficient check): every line the hostile reason produced
    // must itself start with `//`.
    for (const line of bytes.split('\n')) {
      if (line.includes('secretly hostile')) {
        expect(line.trim().startsWith('//')).toBe(true);
      }
    }

    // The authoritative check: the emitted file must still PARSE as valid TypeScript. A
    // pre-CR-02 unescaped interpolation of this reason would inject `*/ }); process.exit(1); //`
    // as live source, breaking the enclosing describe() block — this throws if that happened.
    expect(() =>
      parseTypeScript(bytes, { ecmaVersion: 'latest', sourceType: 'module' }),
    ).not.toThrow();
  });

  it('a hostile chunkSlug/pageCitation and an unescaped-newline reason still produce a file vitest actually runs (end-to-end proof)', async () => {
    const hostileChunkSlug = "chunk-'inject'";
    const project = await mkProject(dir, {
      chunkSlug: hostileChunkSlug,
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    // A real, executable entry, so the `it(...)` this file carries is a TRANSPORTED one — the
    // path where a hostile pageCitation is actually interpolated (an exempt-only file would
    // instead carry the renderer's own named-exemption test, which never touches a citation) —
    // its pageCitation is the hostile WR-03 payload: a newline followed by a `require(...)` call
    // that would run as live code if `commentSafeLine` did not strip the newline first.
    const hostilePageCitation =
      "p.2\n'); require('node:child_process').execSync('touch /tmp/pwned'); //";
    await recordExampleReplayVerdicts(project, [
      translatedRecord(2, { pageCitation: hostilePageCitation }),
    ]);

    const result = await verifyExampleEmitCommand({ project, chunk: hostileChunkSlug });
    expect(result.emittedCount).toBe(1);

    // runVitestIn REJECTS on a non-zero exit code — a syntax error (from an unescaped
    // chunkSlug/pageCitation) or an actually-executed `require(...)` call would make vitest exit
    // non-zero, failing this `await` and the test with it. The strong proof this exists to give:
    // the process must complete with exit code 0 and report the real test passing.
    expect(await runVitestIn(project)).toMatch(/1 passed|1 test/i);
    // And the injected `require('node:child_process').execSync(...)` payload the hostile
    // pageCitation carried must never actually have run as code.
    await expect(fs.access('/tmp/pwned')).rejects.toThrow();
  });

  it('the emitter never writes the ledger, and the ledger writer never writes a test file', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-boundary',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'No worked examples.\n',
    });

    const ledgerPath = exampleReplayLedgerPath(project);
    const before = await fs.stat(ledgerPath).catch(() => null);

    await verifyExampleEmitCommand({ project, chunk: 'chunk-boundary' });

    const after = await fs.stat(ledgerPath).catch(() => null);
    // The ledger file's existence/mtime must be unaffected by the emit command: neither creates
    // it (before === null implies after === null too) nor mutates an existing one.
    expect(after === null).toBe(before === null);
    if (before && after) {
      expect(after.mtimeMs).toBe(before.mtimeMs);
    }

    // recordExampleReplayVerdicts (the write surface's own primitive) never writes a test file.
    await recordExampleReplayVerdicts(project, [translatedRecord(99)]);
    await expect(
      fs.access(join(project, 'tests', 'examples', 'chunk-boundary.examples.test.ts', '..', 'phantom')),
    ).rejects.toThrow();
    const examplesDirEntries = await fs.readdir(join(project, 'tests', 'examples')).catch(() => []);
    // Only the file THIS test's own emit call wrote should exist — recordExampleReplayVerdicts
    // must not have added a second one.
    expect(examplesDirEntries).toEqual(['chunk-boundary.examples.test.ts']);
  });
});
