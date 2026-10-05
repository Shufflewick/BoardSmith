import { promises as fs } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import {
  CONSTRAINTS_MD,
  DESIGN_DIR,
  RULINGS_MD,
  chunkMdPath,
  designPath,
  relChunkMdPath,
} from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';
import { testRunScopeProblem } from '../lib/test-run-scope.js';
import { extractSection, parseRulings } from './build-manifest.js';
import { ENTRY_NUMBER, entryHeadingPattern } from '../lib/ledger-entries.js';
import { escapeRegExp } from '../lib/regexp.js';

/**
 * `boardsmith constraint-check [slug]`: does the project hold its own hard constraints (#288)?
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * In the sotf build run four chunks closed with state that grew without limit against a 512 KiB
 * partition budget, and one swallowed an undeclared-partition refusal. The audit's lenses checked
 * rules fidelity, visibility and undo; nothing checked the project's own hard constraints, and a
 * harness that does not follow prose exactly would skip a prose-only check anyway. So:
 *
 *   - `design/CONSTRAINTS.md` lists every hard constraint (each quoting the project's CLAUDE.md,
 *     so none can be dropped silently) and every piece of persistent state that grows with
 *     players or time.
 *   - A growing structure with no cap is refused unless a RULINGS.md ruling allows it. A cap must
 *     appear in the file said to enforce it, and its measurement test must use it, so the budget
 *     is measured at the cap the code enforces rather than at a number someone picked.
 *   - A measured constraint names a test, and this command runs those tests. With no slug it
 *     checks the whole tree, which is what a merge re-runs on the combined result.
 *   - With a slug it also checks that chunk's `## Constraints Review`: a verdict with a citation
 *     for every constraint, none of them `violated`. `chunk-signoff` refuses while it does not.
 *
 * The rules are the same whether the project came from a rulebook or from existing code: they
 * read CLAUDE.md, the ledger and the code, never the rulebook.
 */

const TEMPLATE_HINT =
  'Copy the bs- skills\' templates/CONSTRAINTS.template.md to design/CONSTRAINTS.md and fill it ' +
  'from the constraints lens (build/audit.md).';

const CONSTRAINTS_REVIEW_HEADING = '## Constraints Review';

const VERDICTS = ['held', 'violated', 'not applicable'] as const;
type Verdict = (typeof VERDICTS)[number];

interface HardConstraint {
  id: string;
  quote: string;
  source: string;
  kind: string;
  test: string;
}

interface GrowingStructure {
  id: string;
  state: string;
  growsWith: string;
  chunk: string;
  cap: string;
  measuredBy: string;
  ruling: string;
}

/**
 * What a test run reports back: whether it passed, its output for the refusal, and the test files
 * that actually ran (project-relative, `/`-separated), or, when the tests could not be run as asked,
 * the sentence that says why. `ran` matters because vitest skips a named file its config excludes
 * and still exits 0 (#479): only `ran` shows a file was left out. A runner that cannot tell leaves
 * it out, and a check that must know refuses.
 */
type TestRunResult = { ok: boolean; output: string; ran?: string[] } | { refused: string };

/** Runs the named test files (relative to the project) and reports whether they all passed. */
export type TestRunner = (projectDir: string, files: readonly string[]) => Promise<TestRunResult>;

interface ConstraintCheckOptions {
  /** Also check this chunk's `## Constraints Review`. */
  slug?: string;
  /** Run the measured tests with this. Omitted, no tests run (the sign-off gate's static check). */
  runTests?: TestRunner;
}

interface ConstraintCheckResult {
  constraints: HardConstraint[];
  structures: GrowingStructure[];
  /** The test files a full check runs. */
  tests: string[];
  refusals: string[];
}

// ---------------------------------------------------------------------------------------------
// Reading the ledger
// ---------------------------------------------------------------------------------------------

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** Whitespace collapsed and emphasis markup dropped, so a quote survives re-wrapping. */
function normalize(text: string): string {
  return text.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
}

/** Splits a section into its `### <id>` entries and reads each entry's `- Field: value` lines. */
function readEntries(section: string | undefined, prefix: 'C' | 'G'): Array<Record<string, string>> {
  const body = stripComments(section ?? '');
  const starts = [...body.matchAll(entryHeadingPattern(prefix, '', ENTRY_NUMBER))];
  return starts.map((match, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : body.length;
    const fields: Record<string, string> = { id: `${prefix}${match[1]}` };
    for (const line of body.slice(match.index, end).split('\n')) {
      const field = /^- ([A-Za-z ]+):\s*(.*)$/.exec(line.trim());
      if (field) fields[field[1].toLowerCase()] = field[2].trim();
    }
    return fields;
  });
}

function parseLedger(text: string): { constraints: HardConstraint[]; structures: GrowingStructure[] } {
  const constraints = readEntries(extractSection(text, '## Hard Constraints'), 'C').map((f) => ({
    id: f.id,
    quote: f.quote ?? '',
    source: f.source ?? '',
    kind: (f.kind ?? '').toLowerCase(),
    test: f.test ?? '',
  }));
  const structures = readEntries(extractSection(text, '## Growing Structures'), 'G').map((f) => ({
    id: f.id,
    state: f.state ?? '',
    growsWith: f['grows with'] ?? '',
    chunk: f.chunk ?? '',
    cap: f.cap ?? '',
    measuredBy: f['measured by'] ?? '',
    ruling: f.ruling ?? '',
  }));
  return { constraints, structures };
}

/**
 * The bullets of CLAUDE.md's hard-constraints section, one string per top-level bullet with its
 * continuation lines joined. Empty when the file or the section is absent: a project with no
 * stated hard constraints still has its growing structures checked.
 */
function hardConstraintBullets(claudeMd: string | undefined): string[] {
  if (claudeMd === undefined) return [];
  const heading = /^#{1,3} Hard (constraints|rules)\b.*$/im.exec(claudeMd);
  if (!heading) return [];
  const rest = claudeMd.slice(heading.index + heading[0].length);
  const next = /^#{1,3} /m.exec(rest);
  const lines = stripComments(next ? rest.slice(0, next.index) : rest).split('\n');
  const bullets: string[] = [];
  for (const line of lines) {
    if (/^[-*] /.test(line)) bullets.push(line.slice(2));
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return bullets.map(normalize);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------

/** True when `identifier` appears in the file as a whole word. */
async function fileMentions(projectDir: string, file: string, identifier: string): Promise<boolean | undefined> {
  const text = await readOptional(join(projectDir, file));
  if (text === undefined) return undefined;
  return new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(identifier)}($|[^A-Za-z0-9_$])`).test(text);
}

function quoteRefusal(c: HardConstraint, source: string | undefined): string | undefined {
  if (source === undefined) {
    return `${c.id} quotes ${c.source}, which does not exist. Give the file it is quoted from, relative to the project root.`;
  }
  if (normalize(source).includes(normalize(c.quote))) return undefined;
  return `${c.id}'s quote "${c.quote}" is not in ${c.source}. Copy the constraint's exact words from ${c.source}.`;
}

async function kindRefusal(projectDir: string, c: HardConstraint): Promise<string | undefined> {
  if (c.kind === 'reviewed') return undefined;
  if (c.kind !== 'measured') {
    return `${c.id} has Kind "${c.kind}". Use "measured" (a test proves it) or "reviewed" (the constraints lens judges it).`;
  }
  if (!c.test) return `${c.id} is measured but names no "- Test:". Name the test file that proves it.`;
  if ((await readOptional(join(projectDir, c.test))) !== undefined) return undefined;
  return `${c.id} is measured by ${c.test}, which does not exist. Write the test, or fix the path.`;
}

async function constraintRefusals(projectDir: string, constraints: HardConstraint[]): Promise<string[]> {
  const refusals: Array<string | undefined> = [];
  for (const c of constraints) {
    if (!c.quote || !c.source) {
      refusals.push(`${c.id} needs both "- Quote:" and "- Source:" lines in design/${CONSTRAINTS_MD}.`);
    } else {
      refusals.push(quoteRefusal(c, await readOptional(join(projectDir, c.source))));
    }
    refusals.push(await kindRefusal(projectDir, c));
  }
  return refusals.filter((r): r is string => r !== undefined);
}

/** Every hard-constraint bullet in CLAUDE.md must be quoted by some ledger entry. */
function coverageRefusals(claudeMd: string | undefined, constraints: HardConstraint[]): string[] {
  const quotes = constraints
    .filter((c) => c.source === 'CLAUDE.md' && c.quote)
    .map((c) => normalize(c.quote));
  return hardConstraintBullets(claudeMd)
    .filter((bullet) => !quotes.some((q) => bullet.includes(q)))
    .map(
      (bullet) =>
        `CLAUDE.md states the hard constraint "${bullet}", and no entry in design/${CONSTRAINTS_MD} ` +
        `quotes it. Add a "### C<n>" entry quoting it, so the constraints lens checks every chunk against it.`,
    );
}

/** Every ruling id a structure may cite: real numbers, and a parallel branch's provisional ids (#294). */
/** One refusal per id used by more than one entry: a citation of it would mean two things. */
function duplicateIdRefusals(entries: ReadonlyArray<{ id: string }>): string[] {
  const counts = new Map<string, number>();
  for (const { id } of entries) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(
      ([id, count]) =>
        `${id} is used by ${count} entries in design/${CONSTRAINTS_MD}. Keep the first, give each later ` +
        'one the next unused id, and update every citation that meant it.',
    );
}

async function rulingNumbers(projectDir: string): Promise<Set<string>> {
  const text = stripComments((await readOptional(designPath(projectDir, RULINGS_MD))) ?? '');
  return new Set(parseRulings(text).map((r) => `Ruling ${r.id}`));
}

async function capRefusals(projectDir: string, g: GrowingStructure, name: string): Promise<string[]> {
  const cap = /^([A-Za-z_$][\w$.]*) in (\S+)$/.exec(g.cap);
  if (!cap) {
    return [`${name} has "- Cap: ${g.cap}". Write it as "<CONSTANT> in <file>", naming the constant the code enforces and the file enforcing it.`];
  }
  const [, identifier, file] = cap;
  const refusals: string[] = [];
  const enforced = await fileMentions(projectDir, file, identifier);
  if (enforced !== true) {
    refusals.push(
      `${name}'s cap ${identifier} is not in ${file}${enforced === undefined ? ' (the file does not exist)' : ''}. ` +
        'A cap only counts where the code enforces it.',
    );
  }
  if (!g.measuredBy) {
    refusals.push(
      `${name} has a cap but no "- Measured by:" test. Name a test that fills it to ${identifier} at the ` +
        'declared maximum population, with every per-seat list full, and checks the size budget.',
    );
    return refusals;
  }
  const measured = await fileMentions(projectDir, g.measuredBy, identifier);
  if (measured === undefined) {
    refusals.push(`${name} is measured by ${g.measuredBy}, which does not exist. Write the test, or fix the path.`);
  } else if (!measured) {
    refusals.push(
      `${name} is measured by ${g.measuredBy}, which never uses ${identifier}. Measure at the cap the code ` +
        'enforces, not at a count chosen for the test.',
    );
  }
  return refusals;
}

function rulingRefusal(g: GrowingStructure, name: string, rulings: Set<string>): string[] {
  if (rulings.has(g.ruling)) return [];
  return [
    `${name} cites "${g.ruling}", which is not a ruling in design/${RULINGS_MD}. Only a recorded ` +
      'designer ruling lets a structure grow without a cap; put the question to the designer (build/ask.md).',
  ];
}

function uncappedRefusal(g: GrowingStructure, name: string): string[] {
  return [
    `${name} grows with ${g.growsWith || 'play'} and has no cap. Enforce a cap in code and add ` +
      '"- Cap: <CONSTANT> in <file>" with a "- Measured by:" test, or ask the designer (build/ask.md) and ' +
      'cite their decision as "- Ruling: Ruling <n>".',
  ];
}

/** A structure is bounded by exactly one of: a cap the code enforces, or a designer ruling. */
async function boundRefusals(projectDir: string, g: GrowingStructure, name: string, rulings: Set<string>): Promise<string[]> {
  if (g.cap && g.ruling) return [`${name} names both a cap and a ruling. Keep the one that holds.`];
  if (g.cap) return capRefusals(projectDir, g, name);
  if (g.ruling) return rulingRefusal(g, name, rulings);
  return uncappedRefusal(g, name);
}

async function structureRefusals(projectDir: string, structures: GrowingStructure[]): Promise<string[]> {
  const rulings = await rulingNumbers(projectDir);
  const refusals: string[] = [];
  for (const g of structures) {
    const name = `${g.id} (${g.state || 'no "- State:" given'})`;
    if (!g.state || !g.growsWith || !g.chunk) {
      refusals.push(`${name} needs "- State:", "- Grows with:" and "- Chunk:" lines in design/${CONSTRAINTS_MD}.`);
    }
    refusals.push(...(await boundRefusals(projectDir, g, name, rulings)));
  }
  return refusals;
}

interface ReviewVerdict {
  verdict: string;
  citation: string;
}

/** `- C1: held. <citation>` lines, by constraint id. */
function parseVerdicts(section: string): Map<string, ReviewVerdict> {
  const verdicts = new Map<string, ReviewVerdict>();
  for (const line of stripComments(section).split('\n')) {
    const m = new RegExp(`^- (C${ENTRY_NUMBER}):\\s*([a-z ]+?)\\.\\s*(.*)$`, 'i').exec(line.trim());
    if (m) verdicts.set(m[1], { verdict: m[2].toLowerCase(), citation: m[3].trim() });
  }
  return verdicts;
}

function verdictRefusal(rel: string, c: HardConstraint, v: ReviewVerdict | undefined): string | undefined {
  if (!v) {
    return `design/${rel} has no constraints-review verdict for ${c.id} ("${c.quote}"). Write "- ${c.id}: held. <citation>", or "not applicable" or "violated".`;
  }
  if (!VERDICTS.includes(v.verdict as Verdict)) {
    return `design/${rel} gives ${c.id} the verdict "${v.verdict}". Use one of: ${VERDICTS.join(', ')}.`;
  }
  if (v.verdict === 'violated') {
    return `design/${rel} records ${c.id} as violated: ${v.citation || 'no citation given'}. Repair it, or take it to the designer as a question (build/ask.md).`;
  }
  if (v.citation) return undefined;
  return `design/${rel}'s verdict for ${c.id} has no citation. Name the file and line, or the test, that shows it.`;
}

/** The chunk's `## Constraints Review`: one verdict with a citation per ledger constraint. */
async function reviewRefusals(projectDir: string, slug: string, constraints: HardConstraint[]): Promise<string[]> {
  const rel = relChunkMdPath(slug);
  const text = await readOptional(chunkMdPath(projectDir, slug));
  if (text === undefined) return [`No CHUNK.md at design/${rel}. Check the slug.`];
  const section = extractSection(text, CONSTRAINTS_REVIEW_HEADING);
  if (section === undefined && constraints.length) {
    return [`design/${rel} has no "${CONSTRAINTS_REVIEW_HEADING}" section. The audit step writes it from the constraints lens.`];
  }
  const verdicts = parseVerdicts(section ?? '');
  return constraints
    .map((c) => verdictRefusal(rel, c, verdicts.get(c.id)))
    .filter((r): r is string => r !== undefined);
}

/**
 * Runs the project's own vitest over the named files, or its whole suite when none are named.
 *
 * Refuses a project whose vitest config would also collect the chunk worktrees under
 * `.boardsmith/worktrees/`: that config is the one place the exclusion lives (`test-run-scope.ts`).
 */
export const runVitest: TestRunner = async (projectDir, files) => {
  const problem = await testRunScopeProblem(projectDir);
  if (problem !== undefined) return { refused: problem };
  const reportDir = await fs.mkdtemp(join(tmpdir(), 'boardsmith-constraint-run-'));
  const reportPath = join(reportDir, 'report.json');
  try {
    const args = ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`, ...files];
    const { ok, output } = await new Promise<{ ok: boolean; output: string }>((done) => {
      const child = spawn('npx', args, { cwd: projectDir, shell: process.platform === 'win32' });
      let text = '';
      child.stdout.on('data', (d: Buffer) => (text += d.toString()));
      child.stderr.on('data', (d: Buffer) => (text += d.toString()));
      child.on('error', (error) => done({ ok: false, output: error.message }));
      child.on('close', (code) => done({ ok: code === 0, output: text }));
    });
    const report = await fs.readFile(reportPath, 'utf-8').catch(() => undefined);
    return { ok, output, ran: testFilesInReport(report, await fs.realpath(projectDir)) };
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
};

/**
 * The test files vitest's JSON report says it ran, relative to `root`, or `undefined` when there is
 * no report or it is not one vitest wrote whole (a run cut short can leave it truncated). Undefined
 * says nothing about which files ran, so a caller that needs to know refuses on it.
 */
export function testFilesInReport(text: string | undefined, root: string): string[] | undefined {
  if (text === undefined) return undefined;
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return undefined;
  }
  const results = (report as { testResults?: unknown } | null)?.testResults;
  if (!Array.isArray(results) || !results.every((r) => typeof (r as { name?: unknown })?.name === 'string')) return undefined;
  return results.map((r: { name: string }) => relative(root, r.name).split(sep).join(posix.sep));
}

/** The last lines of a test run, which is where vitest says what failed. */
function tail(output: string, lines = 25): string {
  return output.trimEnd().split('\n').slice(-lines).join('\n');
}

/**
 * The check. Returns every reason the project does not hold its constraints, as sentences a
 * designer or agent can act on; no refusals means it holds. Tests run only when `runTests` is
 * given and the ledger itself passed, so a broken ledger is reported before anything slow runs.
 */
export async function checkConstraints(
  projectDir: string,
  options: ConstraintCheckOptions = {},
): Promise<ConstraintCheckResult> {
  const dir = resolve(projectDir);
  const text = await readOptional(designPath(dir, CONSTRAINTS_MD));
  if (text === undefined) {
    return {
      constraints: [],
      structures: [],
      tests: [],
      refusals: [`This project has no ${DESIGN_DIR}/${CONSTRAINTS_MD}, so nothing records its hard constraints or what grows. ${TEMPLATE_HINT}`],
    };
  }
  const { constraints, structures } = parseLedger(text);
  const refusals = [
    ...duplicateIdRefusals([...constraints, ...structures]),
    ...coverageRefusals(await readOptional(join(dir, 'CLAUDE.md')), constraints),
    ...(await constraintRefusals(dir, constraints)),
    ...(await structureRefusals(dir, structures)),
    ...(options.slug === undefined ? [] : await reviewRefusals(dir, options.slug, constraints)),
  ];
  const tests = [
    ...new Set([
      ...constraints.filter((c) => c.kind === 'measured' && c.test).map((c) => c.test),
      ...structures.filter((g) => g.cap && g.measuredBy).map((g) => g.measuredBy),
    ]),
  ];
  if (options.runTests && refusals.length === 0 && tests.length) {
    const run = await options.runTests(dir, tests);
    if ('refused' in run) {
      refusals.push(run.refused);
    } else if (!run.ok) {
      refusals.push(`The constraint tests failed (${tests.join(', ')}). A measured constraint does not hold:\n${tail(run.output)}`);
    }
  }
  return { constraints, structures, tests, refusals };
}

function slugProblem(slug: string | undefined): string | undefined {
  if (slug === undefined) return undefined;
  try {
    assertBareName('<slug>', slug, 'Pass the slug of a chunk in this project: a directory under design/chunks/ holding a CHUNK.md.');
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

function report(result: ConstraintCheckResult, slug: string | undefined, json: boolean | undefined): void {
  const ok = result.refusals.length === 0;
  if (json) {
    console.log(JSON.stringify({ slug: slug ?? null, ok, ...result }, null, 2));
    return;
  }
  if (!ok) {
    console.error(chalk.red(`${result.refusals.length} constraint problem(s):`));
    for (const refusal of result.refusals) console.error(`  • ${refusal}`);
    return;
  }
  const tests = result.tests.length ? `; ${result.tests.length} measurement test file(s) passed.` : '.';
  console.log(
    chalk.green(`✓ ${result.constraints.length} hard constraint(s) and ${result.structures.length} growing structure(s) hold${tests}`),
  );
}

/**
 * The CLI entry. Exits non-zero on any refusal. Always runs the measured tests: with no slug this
 * is the whole-tree check a merge re-runs on the combined result, and with a slug it is what the
 * audit step runs after the constraints lens has written the chunk's review.
 */
export async function constraintCheckCommand(
  slug: string | undefined,
  options: { project?: string; json?: boolean; runTests?: TestRunner } = {},
): Promise<void> {
  const problem = slugProblem(slug);
  if (problem !== undefined) {
    console.error(chalk.red(problem));
    process.exitCode = 1;
    return;
  }
  const projectDir = resolve(options.project ?? process.cwd());
  const result = await checkConstraints(projectDir, { slug, runTests: options.runTests ?? runVitest });
  report(result, slug, options.json);
  if (result.refusals.length) process.exitCode = 1;
}
