import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { atomicWriteFile } from './verify-run.js';
import { readLiveSlices, parseSubagentJsonInput } from './verify-derive-check.js';
import { resolveCitedSlices } from './chunk-provenance.js';
import { scanSourceForSandboxViolations, type SandboxViolation } from '../lib/sandbox-scan.js';
import { workedExampleId } from './example-derivation.js';
import { readExampleReplayVerdicts, type ExampleReplayRecord } from './verify-example-replay.js';

/**
 * `example-test-emit.ts` — TEST-01's build-side write surface (178-CONTEXT.md decision 8): one
 * generated test file per chunk, written idempotently and atomically into the generated game
 * project's own `tests/examples/` directory.
 *
 * This is the FIRST check in the milestone that writes AND then executes generated code inside a
 * real project (178-RESEARCH Pitfall 6) — every prior CHECK-0x only ever reported. The
 * model-generated test code that lands here has already been through two prior dispatches
 * (`example-derivation.ts`'s extraction/translation payload builders, `verify-example-replay.ts`'s
 * `verifyExampleTranslateCommand`), but NEITHER of those steps writes anything: this module is
 * where the third dispatch's actual runnable test CODE — carried on `--translated`, keyed by the
 * SAME `workedExampleId({ slicePath, lineNumber })` every other CHECK-06 command uses — first
 * touches disk, and only after it survives `scanGeneratedTestCode`.
 *
 * This command reads the CHECK-06 ledger (`readExampleReplayVerdicts`) to learn WHICH worked
 * examples exist for a chunk's cited slices and what verdict/reason each already carries — it
 * never re-judges `unexecutable`/`example-inconsistent` (178-CONTEXT.md decision 7: those are
 * first-class, never a failing test, never silently dropped) and never writes the ledger itself.
 * `verify-example-record` (plan 178-04) is the ONLY ledger write surface; this module writes ONLY
 * under `tests/examples/` — the two write surfaces never overlap, enforced by test.
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
  /** Path to the third dispatch's structured JSON return — required only when the chunk has at
   * least one example recorded `agrees`/`disagrees` (i.e. needs real runnable code). */
  translated?: string;
  json?: boolean;
}

/**
 * One entry of the third dispatch's raw JSON return — the translator turned a `WorkedExampleSpec`
 * into runnable test code, and this is that code plus the citation fields
 * (`buildExampleTranslationPayload`'s prompt already carries `pageCitation`/`sourceText`, so the
 * model producing code has them in context) a header comment needs to trace a failing test back to
 * its rulebook line without opening the ledger.
 */
interface RawExampleEmitEntry {
  slicePath: string;
  lineNumber: number;
  pageCitation: string;
  sourceText: string;
  code: string;
}

export interface VerifyExampleEmitResult {
  projectDir: string;
  chunk: string;
  testFilePath: string;
  relTestFilePath: string;
  /** Records with verdict `agrees`/`disagrees` — emitted as real, runnable tests. */
  emittedCount: number;
  /** Records with verdict `unexecutable`/`example-inconsistent` — a named-reason comment, never a
   * test. */
  exemptCount: number;
  /** True when the chunk's cited slices carry zero recorded worked examples at all. */
  chunkExempt: boolean;
}

async function readRequiredTranslatedJsonFile(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`verify-example-emit could not read --translated at "${filePath}".`);
  }
  return parseSubagentJsonInput(text, '--translated', filePath);
}

function escapeTestTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function indentCode(code: string, prefix: string): string {
  return code
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

function renderCitationComment(entry: RawExampleEmitEntry): string[] {
  const lines: string[] = [];
  lines.push(`  // ${entry.slicePath}:${entry.lineNumber} (${entry.pageCitation})`);
  const sourceLines = entry.sourceText.split('\n');
  lines.push(`  // Source: ${sourceLines[0]}`);
  for (const extra of sourceLines.slice(1)) lines.push(`  //         ${extra}`);
  return lines;
}

function renderExampleTestFile(input: {
  chunkSlug: string;
  citedSlicePaths: string[];
  exempt: ExampleReplayRecord[];
  executable: ExampleReplayRecord[];
  codeByExampleId: Map<string, RawExampleEmitEntry>;
}): string {
  const { chunkSlug, citedSlicePaths, exempt, executable, codeByExampleId } = input;
  const lines: string[] = [];

  lines.push('// GENERATED FILE — do not hand-edit. Regenerate with:');
  lines.push(`//   boardsmith verify-example-emit --chunk ${chunkSlug}`);
  lines.push(
    '// One example test file per chunk (178-CONTEXT.md decision 8) — re-running this command ' +
      "for this chunk regenerates ONLY this file, never another chunk's.",
  );
  lines.push('');
  lines.push("import { describe, it, expect } from 'vitest';");
  lines.push('');

  if (executable.length === 0 && exempt.length === 0) {
    lines.push(
      `// EXEMPT: chunk "${chunkSlug}" cites ${citedSlicePaths.length} rulebook slice(s) ` +
        `(${citedSlicePaths.join(', ') || 'none'}) and no worked examples were found in any of ` +
        `them — this chunk has no worked examples to test.`,
    );
    lines.push(`describe('${chunkSlug} — worked examples', () => {`);
    lines.push(
      `  it('names its exemption: no worked examples in this chunk\\'s cited slices', () => {`,
    );
    lines.push('    expect(true).toBe(true);');
    lines.push('  });');
    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`describe('${chunkSlug} — worked examples', () => {`);

  for (const record of exempt) {
    lines.push(
      `  // ${record.verdict.toUpperCase()} — ${record.slicePath}:${record.lineNumber}: ` +
        `${record.reason}`,
    );
    lines.push('');
  }

  for (const record of executable) {
    const entry = codeByExampleId.get(record.exampleId);
    if (!entry) continue; // unreachable — validated by the caller before this function runs.
    lines.push(...renderCitationComment(entry));
    lines.push(indentCode(entry.code, '  '));
    lines.push('');
  }

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * `boardsmith verify-example-emit` — writes the ONE generated example-test file for `--chunk`.
 *
 * 1. Resolves `--chunk` to the rulebook slices its `CHUNK.md` cites (`resolveCitedSlices`, the
 *    SAME mechanism `verifyExampleReplayCommand`'s own `--chunk` option uses).
 * 2. Reads every recorded `ExampleReplayRecord` for those slices from the CHECK-06 ledger
 *    (`readExampleReplayVerdicts`) — this command never dispatches a subagent and never writes
 *    the ledger.
 * 3. Splits records into EXEMPT (`unexecutable`/`example-inconsistent` — named reason, never a
 *    test, decision 7) and EXECUTABLE (`agrees`/`disagrees` — needs real translated code).
 * 4. For every executable record, requires a matching `--translated` entry (keyed by
 *    `workedExampleId`, never by prose) and scans its code via `scanGeneratedTestCode` — a
 *    violation of `GENERATED_TEST_SANDBOX_RULES` anywhere REJECTS THE WHOLE EMISSION (validate-
 *    everything-then-write; nothing is written).
 * 5. Composes the one file deterministically (slices/examples sorted by slicePath+lineNumber) and
 *    writes it via `atomicWriteFile` — the ONLY write this command performs. Re-running for the
 *    same chunk with the same ledger/`--translated` input reproduces byte-identical output;
 *    re-running for a DIFFERENT chunk never touches this chunk's file.
 * 6. A chunk whose cited slices carry zero recorded worked examples still gets a file — the
 *    exemption is named explicitly in a comment, never a silently absent file.
 */
export async function verifyExampleEmitCommand(
  options: VerifyExampleEmitOptions = {},
): Promise<VerifyExampleEmitResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  if (!options.chunk) {
    throw new Error('verify-example-emit requires --chunk <slug>.');
  }
  const chunkSlug = options.chunk;

  // Path containment guard for `--chunk` reads — mirrors `verifyExampleReplayCommand`'s own
  // `--chunk` guard verbatim in shape and message.
  const chunksDir = join(projectDir, 'chunks');
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
  const { resolved: citedSlicePaths } = resolveCitedSlices(chunkText, sliceFilenames);
  const citedSet = new Set(citedSlicePaths);

  const allVerdicts = await readExampleReplayVerdicts(projectDir);
  const records = allVerdicts
    .filter((v) => citedSet.has(v.slicePath))
    .slice()
    .sort((a, b) => a.slicePath.localeCompare(b.slicePath) || a.lineNumber - b.lineNumber);

  const exempt = records.filter(
    (r) => r.verdict === 'unexecutable' || r.verdict === 'example-inconsistent',
  );
  const executable = records.filter((r) => r.verdict === 'agrees' || r.verdict === 'disagrees');

  const codeByExampleId = new Map<string, RawExampleEmitEntry>();
  if (executable.length > 0) {
    if (!options.translated) {
      throw new Error(
        `verify-example-emit requires --translated <file>: ${executable.length} example(s) in ` +
          `chunk "${chunkSlug}" are recorded agrees/disagrees and need translated test code to ` +
          `emit. Writing nothing.`,
      );
    }
    const raw = await readRequiredTranslatedJsonFile(options.translated);
    if (!Array.isArray(raw)) {
      throw new Error(`--translated at "${options.translated}" must contain a JSON array.`);
    }
    for (const entry of raw as RawExampleEmitEntry[]) {
      const id = workedExampleId({ slicePath: entry.slicePath, lineNumber: entry.lineNumber });
      const existing = codeByExampleId.get(id);
      if (existing) {
        throw new Error(
          `--translated contains two entries resolving to the same slicePath+lineNumber ` +
            `("${id}"). Entries are keyed by slicePath+lineNumber, never by prose — remove or ` +
            `merge the duplicate. Writing nothing.`,
        );
      }
      codeByExampleId.set(id, entry);
    }
    for (const record of executable) {
      if (!codeByExampleId.has(record.exampleId)) {
        throw new Error(
          `No --translated entry for the worked example at ${record.slicePath}:` +
            `${record.lineNumber} (id "${record.exampleId}").\n` +
            `Every recorded example with verdict "${record.verdict}" needs translated code ` +
            `before emitting. Writing nothing.`,
        );
      }
    }
  }

  // Validate-everything-then-write: scan EVERY translated code snippet against
  // GENERATED_TEST_SANDBOX_RULES before composing or writing anything. A single violation
  // rejects the whole emission.
  const testFilePath = generatedTestFilePath(projectDir, chunkSlug);
  const relTestFilePath = relative(projectDir, testFilePath);
  for (const record of executable) {
    const entry = codeByExampleId.get(record.exampleId)!;
    const violations = scanGeneratedTestCode(entry.code, relTestFilePath);
    if (violations.length > 0) {
      const v = violations[0];
      throw new Error(
        `Translated test code for ${record.slicePath}:${record.lineNumber} (id ` +
          `"${record.exampleId}") violates ${v.ruleId} at line ${v.line} of its own translated ` +
          `snippet: ${v.message}\nRe-dispatch the translator; writing nothing.`,
      );
    }
  }

  const fileText = renderExampleTestFile({
    chunkSlug,
    citedSlicePaths: [...citedSet].sort(),
    exempt,
    executable,
    codeByExampleId,
  });

  await fs.mkdir(dirname(testFilePath), { recursive: true });
  await atomicWriteFile(testFilePath, fileText);

  const result: VerifyExampleEmitResult = {
    projectDir,
    chunk: chunkSlug,
    testFilePath,
    relTestFilePath,
    emittedCount: executable.length,
    exemptCount: exempt.length,
    chunkExempt: records.length === 0,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(
      `✓ Emitted ${relTestFilePath} — ${result.emittedCount} test(s), ` +
        `${result.exemptCount} exempt example(s)${result.chunkExempt ? ' (chunk-wide exemption)' : ''}.`,
    ),
  );
  return result;
}
