import {
  designChunksDir,
} from '../lib/project-paths.js';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { parse as parseTypeScript } from '@typescript-eslint/parser';
import { atomicWriteFile } from './verify-run.js';
import { readLiveSlices } from './verify-derive-check.js';
import { resolveCitedSlices } from './chunk-provenance.js';
import { scanSourceForSandboxViolations, type SandboxViolation } from '../lib/sandbox-scan.js';
import {
  describeUnanchoredExamples,
  findUnanchoredExamples,
  readExampleReplayVerdicts,
  type ExampleReplayRecord,
  type ExampleTranslation,
} from './verify-example-replay.js';

/**
 * `example-test-emit.ts` — TEST-01's build-side write surface (178-CONTEXT.md decision 8): one
 * generated test file per chunk, written idempotently and atomically into the generated game
 * project's own `tests/examples/` directory.
 *
 * This is the FIRST check in the milestone that writes AND then executes generated code inside a
 * real project (178-RESEARCH Pitfall 6) — every prior CHECK-0x only ever reported. The
 * translator's test code reaches the ledger through `verify-example-record`, which stores it on
 * the example's record (`ExampleReplayRecord.translation`); this module is where that code first
 * touches a test file, and only after it survives `scanGeneratedTestCode`.
 *
 * This command reads the CHECK-06 ledger (`readExampleReplayVerdicts`) and nothing else — it
 * never re-judges `unexecutable`/`example-inconsistent` (178-CONTEXT.md decision 7: those are
 * first-class, never a failing test, never silently dropped) and never writes the ledger.
 * `verify-example-record` and `verify-example-run` write the ledger; this module writes ONLY
 * under `tests/examples/` — the write surfaces never overlap, enforced by test.
 */

// -------------------------------------------------------------------------------------------
// GENERATED_TEST_SANDBOX_RULES — the measured subset (Task 1)
// -------------------------------------------------------------------------------------------

/**
 * The sandbox rules a generated example test must obey, MEASURED (not assumed) against the three
 * reference games' real, legitimate, hand-written test suites —
 * `.planning/phases/178-worked-example-tests/178-06-MEASUREMENT/RESULTS.md`. `boardsmith/no-
 * filesystem` (37 hits: ordinary fixture-loading `fs`/`path` imports) and `boardsmith/no-
 * nondeterministic` (1 hit: a randomized-property test's own `Math.random()`) both fire on real
 * legitimate test code and are excluded per 178-CONTEXT.md decision 14 — a gate no correct
 * implementation could ever pass is a defect in the gate, not a defect in the code it scans. Test
 * files run under `vitest`, never inside the executor sandbox `src/rules` code is held to, so
 * filesystem access and non-determinism inside a TEST are not the hazard those two rules exist to
 * guard against.
 */
export const GENERATED_TEST_SANDBOX_RULES = Object.freeze([
  'boardsmith/no-network',
  'boardsmith/no-timers',
  'boardsmith/no-eval',
  'boardsmith/no-element-identity-comparison',
  'boardsmith/no-element-array-state',
] as const);

/**
 * Scans one translated test-code snippet against exactly `GENERATED_TEST_SANDBOX_RULES` — never
 * the full seven-rule set `scanSandboxViolations`/`scanSourceForSandboxViolations` (unrestricted)
 * report, and never a re-declared config or rule list of its own.
 */
export function scanGeneratedTestCode(code: string, relPath: string): SandboxViolation[] {
  return scanSourceForSandboxViolations(code, relPath, GENERATED_TEST_SANDBOX_RULES);
}

// -------------------------------------------------------------------------------------------
// The one legal shape of a translated snippet: a self-contained `it(...)`/`test(...)` block
// -------------------------------------------------------------------------------------------

/**
 * B19: `renderExampleTestFile` renders a translated snippet VERBATIM inside a `describe()`
 * block named for its example. Bare statements there execute at collect time and register no
 * test, so vitest reports `Error: No test found in suite` for a file whose assertions all
 * "passed" — a run that is simultaneously green and empty. The emitter never adds a test of its
 * own around the translator's bytes, which makes the self-contained `it(...)`/`test(...)` block
 * the ONE shape that can work. This check is what makes that the
 * contract instead of a hope: anything else is rejected before a byte is written, exactly like a
 * malformed hoisted import (`collectHoistedImports`).
 */
type TestBlockCheck = { ok: true; count: number } | { ok: false; problem: string };

/** Minimal structural view of the parser's AST — this module reads shape, never types. */
type TSESTreeNode = {
  type: string;
  [key: string]: unknown;
};

/**
 * The root identifier a (possibly chained/curried) call expression is ultimately calling:
 * `it(...)` → `it`, `it.each([...])(...)` → `it`, `foo.bar()` → `foo`. Returns null for anything
 * whose callee is not rooted in a plain identifier.
 */
function rootCalleeName(expression: TSESTreeNode): string | null {
  let node: TSESTreeNode = expression;
  while (node.type === 'CallExpression') node = node.callee as TSESTreeNode;
  while (node.type === 'MemberExpression') node = node.object as TSESTreeNode;
  return node.type === 'Identifier' && typeof node.name === 'string' ? node.name : null;
}

/**
 * Counts the top-level `it(...)`/`test(...)` blocks in ONE translated snippet, or names why it
 * has none. Parses with the same TypeScript parser the sandbox scan uses, so a snippet that does
 * not parse is caught here rather than becoming an unrunnable generated file.
 */
function checkTopLevelTestBlock(code: string): TestBlockCheck {
  let ast: { body: TSESTreeNode[] };
  try {
    ast = parseTypeScript(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as {
      body: TSESTreeNode[];
    };
  } catch (err) {
    return { ok: false, problem: `it does not parse as TypeScript (${(err as Error).message})` };
  }

  let count = 0;
  for (const statement of ast.body) {
    if (statement.type !== 'ExpressionStatement') continue;
    const expression = statement.expression as TSESTreeNode;
    if (expression.type !== 'CallExpression') continue;
    const name = rootCalleeName(expression);
    if (name === 'it' || name === 'test') count += 1;
  }

  if (count === 0) {
    return { ok: false, problem: 'it declares no top-level `it(...)` or `test(...)` block' };
  }
  return { ok: true, count };
}

// -------------------------------------------------------------------------------------------
// generatedTestFilePath — the one-file-per-chunk write target
// -------------------------------------------------------------------------------------------

/**
 * Resolves the ONE generated test file a chunk's worked examples live in:
 * `<projectDir>/tests/examples/<chunkSlug>.examples.test.ts`. Rejects a slug containing a path
 * separator or `..` BEFORE any path is composed — `--chunk` is caller-supplied and this is the
 * only place that string reaches a filesystem write target (T-178-13).
 */
export function generatedTestFilePath(projectDir: string, chunkSlug: string): string {
  if (!chunkSlug || /[\\/]/.test(chunkSlug) || chunkSlug === '..' || chunkSlug === '.') {
    throw new Error(
      `Invalid --chunk slug "${chunkSlug}": must not contain a path separator or "..", and must ` +
        `not be empty.`,
    );
  }
  return join(resolve(projectDir), 'tests', 'examples', `${chunkSlug}.examples.test.ts`);
}

// -------------------------------------------------------------------------------------------
// verifyExampleEmitCommand
// -------------------------------------------------------------------------------------------

export interface VerifyExampleEmitOptions {
  project?: string;
  chunk?: string;
  json?: boolean;
}

/**
 * A single-line `import ... ;` statement — the only shape a hoisted import may take. Rejects
 * anything else (multi-statement smuggling via `;` mid-line, non-import content disguised as an
 * "import") BEFORE it ever reaches the top of the generated file, where it would execute with
 * top-level, unindented, unscanned authority. This is a narrower shape check than
 * `scanGeneratedTestCode` performs — that scan still runs on every import line too (see below);
 * this regex exists to fail loudly on garbage before the linter even sees it.
 */
const SINGLE_IMPORT_STATEMENT_RE = /^import\s[^\n;]+;\s*$/;

/** A record the emitter turns into a test: one whose translator wrote one. */
type TranslatedRecord = ExampleReplayRecord & { translation: ExampleTranslation };

function isTranslatedRecord(record: ExampleReplayRecord): record is TranslatedRecord {
  return record.translation !== undefined;
}

/**
 * Validates and deduplicates the hoisted import statements for ONE chunk's generated file.
 * Every string must be a single well-formed `import ... ;` statement (`SINGLE_IMPORT_STATEMENT_RE`)
 * — a violation REJECTS THE WHOLE EMISSION, naming the offending entry, before anything is
 * written (the same validate-everything-then-write discipline this module holds everywhere
 * else). Deduplicated and sorted for a deterministic, byte-identical re-emission.
 */
function collectHoistedImports(records: readonly TranslatedRecord[]): string[] {
  const seen = new Set<string>();
  for (const record of records) {
    for (const imp of record.translation.imports) {
      const trimmed = imp.trim();
      if (!SINGLE_IMPORT_STATEMENT_RE.test(trimmed)) {
        throw new Error(
          `Translated import for ${record.slicePath}:${record.lineNumber} is not a single ` +
            `well-formed "import ... ;" statement: ${JSON.stringify(imp)}\n` +
            `Re-dispatch the translator; writing nothing.`,
        );
      }
      seen.add(trimmed);
    }
  }
  return [...seen].sort();
}

export interface VerifyExampleEmitResult {
  projectDir: string;
  chunk: string;
  testFilePath: string;
  relTestFilePath: string;
  /** Records carrying a translated test — emitted as real, runnable tests. */
  emittedCount: number;
  /**
   * How many `it(...)`/`test(...)` blocks the emitted FILE actually declares — i.e. what vitest
   * will collect when it runs it. `emittedCount` counts ledger records, which is a different
   * question (B19: an emission once reported "1 test(s)" for a file vitest collected zero tests
   * from). This is the number the success message prints, so the number a reader sees is a claim
   * about the file, not about the ledger.
   */
  testBlockCount: number;
  /** Records with verdict `unexecutable`/`example-inconsistent` — a named-reason comment, never a
   * test. */
  exemptCount: number;
  /** True when the chunk's cited slices carry zero recorded worked examples at all. */
  chunkExempt: boolean;
}

/**
 * CR-02/WR-03 (178-REVIEW.md) fix: makes a piece of model/caller-controlled text safe to
 * interpolate onto ONE `//`-prefixed comment line — a newline in the source value would otherwise
 * close the comment and let everything after it land as live, unscanned TypeScript source in the
 * generated file. Every field interpolated into a single-line `//` comment below MUST be routed
 * through this function first.
 */
function commentSafeLine(text: string): string {
  return text.replace(/\r?\n/g, ' ');
}

/**
 * CR-02 (178-REVIEW.md) fix: makes a piece of model/caller-controlled text safe to interpolate
 * inside a single-quoted JS string literal (e.g. a `describe('...')` title) — escapes backslashes
 * and single quotes so the value cannot break out of the string literal, and strips newlines so it
 * cannot otherwise smuggle live code onto a new line.
 */
function stringLiteralSafe(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function indentCode(code: string, prefix: string): string {
  return code
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

function renderCitationComment(record: TranslatedRecord): string[] {
  const lines: string[] = [];
  lines.push(
    `  // ${commentSafeLine(record.slicePath)}:${record.lineNumber} ` +
      `(${commentSafeLine(record.translation.pageCitation)})`,
  );
  const sourceLines = record.translation.sourceText.split('\n');
  lines.push(`  // Source: ${commentSafeLine(sourceLines[0])}`);
  for (const extra of sourceLines.slice(1)) lines.push(`  //         ${commentSafeLine(extra)}`);
  return lines;
}

/** The title of the chunk-level `describe(...)` every emitted file opens with. */
export function chunkDescribeTitle(chunkSlug: string): string {
  return `${chunkSlug} — worked examples`;
}

function renderExampleTestFile(input: {
  chunkSlug: string;
  citedSlicePaths: string[];
  exempt: ExampleReplayRecord[];
  executable: TranslatedRecord[];
  /** Deduplicated, sorted `import ... ;` statements every executable example's `testCode` may
   * use — hoisted to file scope (`collectHoistedImports`). Never rendered per-example: an
   * `import` statement inside a `describe()` body is a syntax error. */
  hoistedImports: string[];
}): string {
  const { chunkSlug, citedSlicePaths, exempt, executable, hoistedImports } = input;
  const lines: string[] = [];

  lines.push('// GENERATED FILE — do not hand-edit. Regenerate with:');
  lines.push(`//   boardsmith verify-example-emit --chunk ${commentSafeLine(chunkSlug)}`);
  lines.push(
    '// One example test file per chunk (178-CONTEXT.md decision 8) — re-running this command ' +
      "for this chunk regenerates ONLY this file, never another chunk's.",
  );
  lines.push('');
  lines.push("import { describe, it, expect } from 'vitest';");
  for (const imp of hoistedImports) lines.push(imp);
  lines.push('');

  const describeOpen = `describe('${stringLiteralSafe(chunkDescribeTitle(chunkSlug))}', () => {`;

  if (executable.length === 0 && exempt.length === 0) {
    lines.push(
      `// EXEMPT: chunk "${commentSafeLine(chunkSlug)}" cites ${citedSlicePaths.length} ` +
        `rulebook slice(s) (${citedSlicePaths.map(commentSafeLine).join(', ') || 'none'}) and no ` +
        `worked examples were found in any of them — this chunk has no worked examples to test.`,
    );
    lines.push(describeOpen);
    lines.push(
      `  it('names its exemption: no worked examples in this chunk\\'s cited slices', () => {`,
    );
    lines.push('    expect(true).toBe(true);');
    lines.push('  });');
    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(describeOpen);

  for (const record of exempt) {
    lines.push(
      `  // ${record.verdict.toUpperCase()} — ${commentSafeLine(record.slicePath)}:` +
        `${record.lineNumber}: ${commentSafeLine(record.reason)}`,
    );
    lines.push('');
  }

  // B19: an exempt-only chunk would otherwise emit a describe() body of nothing but comments —
  // zero tests, so vitest fails the file with `No test found in suite`, the exact failure this
  // whole gate exists to prevent. The exemption is ASSERTED here, not merely commented, and its
  // test name carries the record dispositions so a CI log alone tells the real state.
  if (executable.length === 0) {
    const unexecutable = exempt.filter((r) => r.verdict === 'unexecutable').length;
    const inconsistent = exempt.filter((r) => r.verdict === 'example-inconsistent').length;
    lines.push(
      `  it('names its exemption: ${exempt.length} worked example(s) in this chunk\\'s cited ` +
        `slices, none executable — ${unexecutable} unexecutable, ${inconsistent} ` +
        `example-inconsistent (each named with its reason above)', () => {`,
    );
    lines.push('    expect(true).toBe(true);');
    lines.push('  });');
    lines.push('');
    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  // Each example's test sits in a describe() titled with its exampleId, so a test result names
  // the example it belongs to (`verify-example-run` reads the verdict back that way).
  for (const record of executable) {
    lines.push(...renderCitationComment(record));
    lines.push(`  describe('${stringLiteralSafe(record.exampleId)}', () => {`);
    lines.push(indentCode(record.translation.testCode, '    '));
    lines.push('  });');
    lines.push('');
  }

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/** What a chunk's generated example-test file is, computed from the ledger without writing it. */
export interface ChunkExampleTests {
  testFilePath: string;
  relTestFilePath: string;
  fileText: string;
  /** Records carrying a translated test, in file order. */
  executable: TranslatedRecord[];
  exempt: ExampleReplayRecord[];
  testBlockCount: number;
  /** True when the chunk's cited slices carry zero recorded worked examples at all. */
  chunkExempt: boolean;
}

/**
 * Computes `--chunk`'s generated example-test file from the CHECK-06 ledger — the ONE rendering
 * both `verify-example-emit` (which writes it) and `verify-example-run` (which checks the file on
 * disk is still this before running it) use.
 *
 * 1. Resolves `--chunk` to the rulebook slices its `CHUNK.md` cites (`resolveCitedSlices`).
 * 2. Reads every recorded `ExampleReplayRecord` for those slices, and throws when one no longer
 *    sits on the slice line whose text it recorded (#350): its test would name the wrong line.
 * 3. Splits them into EXEMPT (`unexecutable`/`example-inconsistent` — a named-reason comment,
 *    never a test, decision 7) and EXECUTABLE (every record carrying a translated test).
 * 4. Scans every translated snippet via `scanGeneratedTestCode`, and requires it to declare a
 *    top-level `it(...)`/`test(...)` (`checkTopLevelTestBlock` — B19). Any violation throws,
 *    naming the example.
 */
export async function renderChunkExampleTests(
  projectDir: string,
  chunkSlug: string,
): Promise<ChunkExampleTests> {
  const citedSlices = await readChunkCitedSlices(projectDir, chunkSlug);
  const citedSet = new Set(citedSlices.map((s) => s.path));

  const allVerdicts = await readExampleReplayVerdicts(projectDir);
  const records = allVerdicts
    .filter((v) => citedSet.has(v.slicePath))
    .slice()
    .sort((a, b) => a.slicePath.localeCompare(b.slicePath) || a.lineNumber - b.lineNumber);
  assertExamplesAnchored(chunkSlug, records, citedSlices);

  const executable = records.filter(isTranslatedRecord);
  const exempt = records.filter((r) => !isTranslatedRecord(r));

  // Hoisted imports (collectHoistedImports validates shape and rejects the whole emission on a
  // malformed entry — before any scan or write) — computed once, over every executable record.
  const hoistedImports = collectHoistedImports(executable);

  const testFilePath = generatedTestFilePath(projectDir, chunkSlug);
  const relTestFilePath = relative(projectDir, testFilePath);
  const snippetTestCount = countTranslatedTests(executable, relTestFilePath);

  const fileText = renderExampleTestFile({
    chunkSlug,
    citedSlicePaths: [...citedSet].sort(),
    exempt,
    executable,
    hoistedImports,
  });

  return {
    testFilePath,
    relTestFilePath,
    fileText,
    executable,
    exempt,
    // An exemption file — no executable records, whether or not any exempt ones exist — is the
    // one file whose single test the renderer writes itself (the named-exemption `it(...)`).
    testBlockCount: executable.length === 0 ? 1 : snippetTestCount,
    chunkExempt: records.length === 0,
  };
}

/**
 * Throws, naming each example and the fix, when a record's slice line no longer holds the text
 * it was recorded against — so a test is never emitted or run under a stale line reference.
 */
function assertExamplesAnchored(
  chunkSlug: string,
  records: readonly ExampleReplayRecord[],
  citedSlices: readonly { path: string; text: string }[],
): void {
  const unanchored = findUnanchoredExamples(records, citedSlices);
  if (unanchored.length === 0) return;
  throw new Error(
    [
      `${unanchored.length} worked example(s) chunk "${chunkSlug}" cites no longer sit on the ` +
        `slice line they were recorded on, so no test file was written or run:`,
      ...describeUnanchoredExamples(unanchored),
    ].join('\n'),
  );
}

/** The rulebook slices `--chunk`'s CHUNK.md cites, after checking the slug stays in chunks/. */
async function readChunkCitedSlices(
  projectDir: string,
  chunkSlug: string,
): Promise<{ path: string; text: string }[]> {
  // Path containment guard for `--chunk` reads — mirrors `verifyExampleReplayCommand`'s own
  // `--chunk` guard verbatim in shape and message.
  const chunksDir = designChunksDir(projectDir);
  const chunkAbs = resolve(chunksDir, chunkSlug);
  const chunkRel = relative(chunksDir, chunkAbs);
  if (chunkRel === '' || chunkRel.startsWith('..') || isAbsolute(chunkRel)) {
    throw new Error(
      `--chunk "${chunkSlug}" resolves outside ${relative(projectDir, chunksDir)}.\n` +
        `Pass a chunk slug relative to the project's chunks directory.`,
    );
  }
  const chunkPath = join(chunksDir, chunkSlug, 'CHUNK.md');
  let chunkText: string;
  try {
    chunkText = await fs.readFile(chunkPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(
      `No chunk named "${chunkSlug}" under ${relative(projectDir, chunksDir)} in ${projectDir} ` +
        `(${code ?? 'unknown error'}).\n` +
        `Pass a chunk slug matching a directory under chunks/ that contains a CHUNK.md.`,
    );
  }

  const liveSlices = await readLiveSlices(projectDir);
  const sliceFilenames = liveSlices.map((s) => s.path.slice('rulebook/'.length));
  const cited = new Set(resolveCitedSlices(chunkText, sliceFilenames).resolved);
  return liveSlices.filter((s) => cited.has(s.path));
}

/**
 * Scans every translated snippet (imports and test code) against `GENERATED_TEST_SANDBOX_RULES`
 * and requires it to declare a top-level `it(...)`/`test(...)` (B19), throwing on the first that
 * fails, naming its example. Returns how many tests the snippets declare between them.
 */
function countTranslatedTests(executable: readonly TranslatedRecord[], relTestFilePath: string): number {
  let testBlockCount = 0;
  for (const record of executable) {
    const { testCode, imports } = record.translation;
    const violations = scanGeneratedTestCode([...imports, testCode].join('\n'), relTestFilePath);
    if (violations.length > 0) {
      const v = violations[0];
      throw new Error(
        `Translated test code for ${record.slicePath}:${record.lineNumber} (id ` +
          `"${record.exampleId}") violates ${v.ruleId} at line ${v.line} of its own translated ` +
          `snippet (imports+code): ${v.message}\nRe-dispatch the translator and record its ` +
          `return again; writing nothing.`,
      );
    }

    // B19: a snippet that declares no test of its own produces a suite vitest refuses to collect
    // ("No test found in suite") while every assertion in it still runs and "passes".
    const shape = checkTopLevelTestBlock(testCode);
    if (!shape.ok) {
      throw new Error(
        `Translated test code for ${record.slicePath}:${record.lineNumber} (id ` +
          `"${record.exampleId}") is not a self-contained test: ${shape.problem}.\n` +
          `The emitter renders your code inside a describe() block and never adds a test of its ` +
          `own, so bare statements would run at collect time and register no test — vitest ` +
          `reports "No test found in suite" for a file whose assertions all passed. Return the ` +
          `whole example inside a single self-contained it('...', () => { ... }) block.\n` +
          `Re-dispatch the translator and record its return again; writing nothing.`,
      );
    }
    testBlockCount += shape.count;
  }
  return testBlockCount;
}

/**
 * `boardsmith verify-example-emit` — writes the ONE generated example-test file for `--chunk`,
 * exactly as `renderChunkExampleTests` computes it from the ledger, via `atomicWriteFile` — the
 * ONLY write this command performs. It never dispatches a subagent and never writes the ledger.
 * Re-running for the same chunk with the same ledger reproduces byte-identical output;
 * re-running for a DIFFERENT chunk never touches this chunk's file. A chunk with no executable
 * examples still gets a file, and that file still declares one test: the exemption is named
 * explicitly and ASSERTED.
 */
export async function verifyExampleEmitCommand(
  options: VerifyExampleEmitOptions = {},
): Promise<VerifyExampleEmitResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  if (!options.chunk) {
    throw new Error('verify-example-emit requires --chunk <slug>.');
  }
  const chunkSlug = options.chunk;
  const tests = await renderChunkExampleTests(projectDir, chunkSlug);

  await fs.mkdir(dirname(tests.testFilePath), { recursive: true });
  await atomicWriteFile(tests.testFilePath, tests.fileText);

  const result: VerifyExampleEmitResult = {
    projectDir,
    chunk: chunkSlug,
    testFilePath: tests.testFilePath,
    relTestFilePath: tests.relTestFilePath,
    emittedCount: tests.executable.length,
    testBlockCount: tests.testBlockCount,
    exemptCount: tests.exempt.length,
    chunkExempt: tests.chunkExempt,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(
      `✓ Emitted ${result.relTestFilePath} — ${result.testBlockCount} test(s), ` +
        `${result.exemptCount} exempt example(s)${result.chunkExempt ? ' (chunk-wide exemption)' : ''}.`,
    ),
  );
  if (result.emittedCount > 0) {
    console.log(`  Run boardsmith verify-example-run --chunk ${chunkSlug} to record their verdicts.`);
  }
  return result;
}
