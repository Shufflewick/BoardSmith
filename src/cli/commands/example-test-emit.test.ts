import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
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
} from './verify-example-replay.js';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at src/cli/commands/example-test-emit.test.ts — repo root is three levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..');

async function mkProject(dir: string, opts: { chunkSlug: string; slicePath: string; sliceText: string }) {
  const project = join(dir, 'project');
  const sliceName = opts.slicePath.slice('rulebook/'.length);
  await fs.mkdir(join(project, 'rulebook'), { recursive: true });
  await fs.writeFile(join(project, 'rulebook', sliceName), opts.sliceText);
  await fs.mkdir(join(project, 'chunks', opts.chunkSlug), { recursive: true });
  await fs.writeFile(
    join(project, 'chunks', opts.chunkSlug, 'CHUNK.md'),
    `# ${opts.chunkSlug}\n\n## Verified Against\n\nCites ${opts.slicePath}.\n`,
  );
  return project;
}

function agreesRecord(overrides: Partial<Parameters<typeof createExampleReplayRecord>[0]> = {}) {
  return createExampleReplayRecord({
    exampleId: 'rulebook/02-punch.md:2',
    slicePath: 'rulebook/02-punch.md',
    lineNumber: 2,
    kind: 'transition',
    verdict: 'agrees',
    reason: 'The generated test executed and matched the expected outcome.',
    provenance: 'quote-verified',
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
});

describe('verifyExampleEmitCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-example-emit-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
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
    // `node_modules` is symlinked from the repo — the same live-symlink layout every real
    // BoardSmithGames project uses (CLAUDE.md's `~/BoardSmithGames/` note), so 'vitest' resolves
    // exactly as it would for a real generated game.
    await fs.symlink(join(REPO_ROOT, 'node_modules'), join(project, 'node_modules'), 'dir');
    const vitestBin = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');
    const { stdout, stderr } = await execFileAsync(vitestBin, ['run'], { cwd: project }).catch(
      (err) => err,
    );
    const output = `${stdout ?? ''}${stderr ?? ''}`;
    expect(output).toMatch(/1 passed|1 test/i);
  });

  it('emits one file per chunk; regenerating chunk A never touches chunk B (D-08)', async () => {
    const project = join(dir, 'project');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, 'rulebook', '01-a.md'), 'Slice A, no examples.\n');
    await fs.writeFile(join(project, 'rulebook', '01-b.md'), 'Slice B, no examples.\n');
    for (const slug of ['chunk-a', 'chunk-b']) {
      await fs.mkdir(join(project, 'chunks', slug), { recursive: true });
    }
    await fs.writeFile(
      join(project, 'chunks', 'chunk-a', 'CHUNK.md'),
      '# chunk-a\n\n## Verified Against\n\nCites rulebook/01-a.md.\n',
    );
    await fs.writeFile(
      join(project, 'chunks', 'chunk-b', 'CHUNK.md'),
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

  it('emits a real runnable test for an agrees-verdict example, citing slicePath/lineNumber/pageCitation/sourceText', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-punch',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [
      agreesRecord({
        exampleId: 'rulebook/02-punch.md:2',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
      }),
    ]);

    const translated = [
      {
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
        pageCitation: 'p.2, Punch Examples',
        sourceText: 'If you are punched while READY, you become EXHAUSTED.',
        code:
          "it('a READY guard becomes EXHAUSTED when punched', () => {\n  expect(true).toBe(true);\n});",
      },
    ];
    const translatedPath = join(dir, 'translated.json');
    await fs.writeFile(translatedPath, JSON.stringify(translated, null, 2));

    const result = await verifyExampleEmitCommand({
      project,
      chunk: 'chunk-punch',
      translated: translatedPath,
    });
    expect(result.emittedCount).toBe(1);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');
    expect(bytes).toContain('rulebook/02-punch.md:2');
    expect(bytes).toContain('p.2, Punch Examples');
    expect(bytes).toContain('If you are punched while READY, you become EXHAUSTED.');
    expect(bytes).toContain('a READY guard becomes EXHAUSTED when punched');
  });

  it('hoists translated imports to file scope, deduplicated across examples, and the emitted file actually executes them (178-11 fix)', async () => {
    // Regression for a live-proof finding (178-11): `code` alone has nowhere to put an `import`
    // statement — putting one inside a `describe()` body is a syntax error — so a translated
    // example that needs a project import could never actually run once emitted. This proves the
    // hoisted-imports path fixes that: two examples share one duplicate import, plus each has its
    // own distinct import, and the emitted file is executed by a real vitest process.
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-imports',
      slicePath: 'rulebook/02-punch.md',
      sliceText:
        'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n' +
        'p.2, Punch Examples:\nA second example, also about Guards.\n',
    });
    await recordExampleReplayVerdicts(project, [
      agreesRecord({
        exampleId: 'rulebook/02-punch.md:2',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
      }),
      agreesRecord({
        exampleId: 'rulebook/02-punch.md:4',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 4,
      }),
    ]);

    const translated = [
      {
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
        pageCitation: 'p.2, Punch Examples',
        sourceText: 'If you are punched while READY, you become EXHAUSTED.',
        code: "it('asserts strictly using the shared import', () => {\n  strictEqual(1 + 1, 2);\n});",
        imports: ["import { strictEqual } from 'node:assert';"],
      },
      {
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 4,
        pageCitation: 'p.2, Punch Examples',
        sourceText: 'A second example, also about Guards.',
        code: "it('uses a second, distinct import', () => {\n  strictEqual(basename('/a/b.ts'), 'b.ts');\n});",
        imports: [
          "import { strictEqual } from 'node:assert';", // duplicate of example 1's import
          "import { basename } from 'node:path';",
        ],
      },
    ];
    const translatedPath = join(dir, 'translated.json');
    await fs.writeFile(translatedPath, JSON.stringify(translated, null, 2));

    const result = await verifyExampleEmitCommand({
      project,
      chunk: 'chunk-imports',
      translated: translatedPath,
    });
    expect(result.emittedCount).toBe(2);

    const bytes = await fs.readFile(result.testFilePath, 'utf-8');
    // Hoisted once each, deduplicated — not once per example.
    expect(bytes.match(/import \{ strictEqual \} from 'node:assert';/g)?.length).toBe(1);
    expect(bytes).toContain("import { basename } from 'node:path';");
    // Never rendered inside the describe body — an import line never appears indented.
    expect(bytes).not.toMatch(/^[ \t]+import /m);

    await fs.symlink(join(REPO_ROOT, 'node_modules'), join(project, 'node_modules'), 'dir');
    const vitestBin = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');
    const { stdout, stderr } = await execFileAsync(vitestBin, ['run'], { cwd: project }).catch(
      (err) => err,
    );
    const output = `${stdout ?? ''}${stderr ?? ''}`;
    expect(output).toMatch(/2 passed|2 tests/i);
  });

  it('rejects a malformed translated import statement, naming the entry; writes nothing', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-bad-import',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [
      agreesRecord({
        exampleId: 'rulebook/02-punch.md:2',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
      }),
    ]);
    const translated = [
      {
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
        pageCitation: 'p.2, Punch Examples',
        sourceText: 'If you are punched while READY, you become EXHAUSTED.',
        code: "it('bad', () => { expect(true).toBe(true); });",
        imports: ["import { x } from 'y'; process.exit(1);"],
      },
    ];
    const translatedPath = join(dir, 'translated.json');
    await fs.writeFile(translatedPath, JSON.stringify(translated, null, 2));

    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-bad-import', translated: translatedPath }),
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
      agreesRecord({
        exampleId: 'rulebook/02-punch.md:2',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
      }),
    ]);
    const translated = [
      {
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
        pageCitation: 'p.2, Punch Examples',
        sourceText: 'If you are punched while READY, you become EXHAUSTED.',
        code: "it('bad', async () => { await fetch('/x'); });",
      },
    ];
    const translatedPath = join(dir, 'translated.json');
    await fs.writeFile(translatedPath, JSON.stringify(translated, null, 2));

    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-net', translated: translatedPath }),
    ).rejects.toThrow('boardsmith/no-network');

    await expect(
      fs.access(join(project, 'tests', 'examples', 'chunk-net.examples.test.ts')),
    ).rejects.toThrow();
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

  it('requires --translated when at least one example needs it, naming the count', async () => {
    const project = await mkProject(dir, {
      chunkSlug: 'chunk-needs-code',
      slicePath: 'rulebook/02-punch.md',
      sliceText: 'p.2, Punch Examples:\nIf you are punched while READY, you become EXHAUSTED.\n',
    });
    await recordExampleReplayVerdicts(project, [
      agreesRecord({
        exampleId: 'rulebook/02-punch.md:2',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
      }),
    ]);

    await expect(
      verifyExampleEmitCommand({ project, chunk: 'chunk-needs-code' }),
    ).rejects.toThrow('--translated');
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
    await recordExampleReplayVerdicts(project, [
      agreesRecord({
        exampleId: 'rulebook/02-punch.md:99',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 99,
      }),
    ]);
    await expect(
      fs.access(join(project, 'tests', 'examples', 'chunk-boundary.examples.test.ts', '..', 'phantom')),
    ).rejects.toThrow();
    const examplesDirEntries = await fs.readdir(join(project, 'tests', 'examples')).catch(() => []);
    // Only the file THIS test's own emit call wrote should exist — recordExampleReplayVerdicts
    // must not have added a second one.
    expect(examplesDirEntries).toEqual(['chunk-boundary.examples.test.ts']);
  });
});
