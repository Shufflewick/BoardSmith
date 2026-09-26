/**
 * `boardsmith claim-quote-check <slug>` (issue #289): every rule claim in a chunk's
 * `## Interpretation` must carry the exact source passage it rests on and where that passage
 * lives, and the passage must actually be there.
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * The sotf build run showed a claim's paraphrase drifting from its source and then being reviewed
 * against itself: red team and the fidelity audit passed misreadings because nothing made them
 * re-open the source, and a gap the source did not fill was filled by invention. A rule that
 * lives only in a skill file is followed by some models and not others, so the two mechanical
 * halves of the fix live here: a claim with no quote is refused, and a quote that is not at its
 * cited location is refused. Whether the quote SUPPORTS the claim is judgment, and stays with the
 * red team and the fidelity lens, which this command hands the quotes to (`--json`).
 *
 * THE FORMAT (also stated in `templates/CHUNK.template.md` and `build/investigate.md`)
 *
 *   1. **Claim text.** Any further prose.
 *      > the exact source text, copied character for character
 *      Source: rulebook/08-combat.md §"The exchange"
 *
 *   Q1. **An open question for the designer.** Why the source does not settle it.
 *      Searched: rulebook/08-combat.md §"Armour"
 *
 * A claim may carry several quote + `Source:` pairs. A `Source:` path is relative to the design
 * directory, like every other citation in the design docs; archived code outside it is reached
 * with `../`, but never outside the project. A Markdown source is cited by heading (`§"..."`) or
 * by line range; any other file is cited by line range (`path:N` or `path:N-M`). A quote matches
 * when it appears inside the cited section or lines, with runs of whitespace (line wrapping)
 * treated as one space. A claim that a later claim supersedes ("supersedes claim N") is not
 * checked: it is kept only as the record of what was corrected.
 *
 * A CHUNK VERIFIED BEFORE THIS CHECK EXISTED (#397) has claims with no quotes. The one-time
 * `boardsmith chunk-gate-transition` records each of them, by number, with a hash of its text, in
 * `design/GATE-TRANSITION.md`. Such a claim is accepted (reported `preGate`) while its text is
 * unchanged; once its text changes, or for any claim added since, the quote is owed like any other.
 *
 * READ-ONLY: never writes a file.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import chalk from 'chalk';
import { extractSection } from './build-manifest.js';
import { assertBareName } from '../lib/user-name.js';
import { DESIGN_DIR, GATE_TRANSITION_MD, chunkMdPath, designDir, relChunkMdPath } from '../lib/project-paths.js';
import { readGateTransition } from '../lib/gate-transition.js';

interface QuotedPassage {
  quote: string;
  source: string;
}

interface ParsedClaim {
  number: number;
  /** The claim's own lines, from its number to the next item. */
  lines: string[];
  quotes: QuotedPassage[];
  /** Claim numbers this claim's own text says it supersedes. */
  supersedes: number[];
  problems: string[];
}

interface ParsedQuestion {
  id: string;
  searched: string[];
  problems: string[];
}

interface ParsedInterpretation {
  claims: ParsedClaim[];
  questions: ParsedQuestion[];
}

interface CheckedQuote extends QuotedPassage {
  found: boolean;
}

interface CheckedClaim {
  number: number;
  superseded: boolean;
  /** Recorded without a quote by the gate transition (#397), and unchanged since. */
  preGate: boolean;
  quotes: CheckedQuote[];
}

interface ClaimQuoteCheckResult {
  claims: CheckedClaim[];
  questions: { id: string; searched: string[] }[];
  /** One human-readable, actionable sentence per problem. Empty means the chunk passes. */
  refusals: string[];
}

const CLAIM_START = /^(\d+)\.\s+\*\*/;
const QUESTION_START = /^Q(\d+)\.\s+\*\*/;
const SUBHEADING = /^#{3,}\s/;
const QUOTE_LINE = /^\s*>\s?(.*)$/;
const SOURCE_LINE = /^\s*Source:\s*(.+?)\s*$/;
const SEARCHED_LINE = /^\s*Searched:\s*(.+?)\s*$/;
const SUPERSEDES = /supersedes\s+claims?\s+(\d+)/gi;

const FORMAT_HINT =
  'Write the exact source text as `> ` lines under the claim, followed by ' +
  '`Source: <file> §"<heading>"` for a Markdown source or `Source: <file>:<line>-<line>` for code.';

type Item = { kind: 'claim'; claim: ParsedClaim } | { kind: 'question'; question: ParsedQuestion };

/** Parser state for one pass over the `## Interpretation` body. */
interface ParseState {
  result: ParsedInterpretation;
  current: Item | undefined;
  pendingQuote: string[];
}

function label(item: Item): string {
  return item.kind === 'claim' ? `Claim ${item.claim.number}` : item.question.id;
}

function problemsOf(item: Item): string[] {
  return item.kind === 'claim' ? item.claim.problems : item.question.problems;
}

/** A quote that reaches anything other than its `Source:` line is a quote with no location. */
function closePendingQuote(state: ParseState): void {
  if (state.current && state.pendingQuote.length > 0) {
    problemsOf(state.current).push(
      `${label(state.current)}: a quoted passage is not followed by a \`Source:\` line. ${FORMAT_HINT}`,
    );
  }
  state.pendingQuote = [];
}

/** Handles a line that starts a claim, starts an open question, or ends the current item. */
function startItem(state: ParseState, line: string): boolean {
  const claimMatch = CLAIM_START.exec(line);
  const questionMatch = QUESTION_START.exec(line);
  if (!claimMatch && !questionMatch && !SUBHEADING.test(line)) return false;
  closePendingQuote(state);
  state.current = undefined;
  if (claimMatch) {
    const claim: ParsedClaim = { number: Number(claimMatch[1]), lines: [line], quotes: [], supersedes: [], problems: [] };
    noteSupersession(claim, line);
    state.result.claims.push(claim);
    state.current = { kind: 'claim', claim };
  } else if (questionMatch) {
    const question: ParsedQuestion = { id: `Q${questionMatch[1]}`, searched: [], problems: [] };
    state.result.questions.push(question);
    state.current = { kind: 'question', question };
  }
  return true;
}

function takeSource(state: ParseState, item: Item, source: string): void {
  if (item.kind === 'claim' && state.pendingQuote.length > 0) {
    item.claim.quotes.push({ quote: normalize(state.pendingQuote.join('\n')), source });
  } else {
    problemsOf(item).push(`${label(item)}: a \`Source:\` line has no quoted passage above it. ${FORMAT_HINT}`);
  }
  state.pendingQuote = [];
}

/** Handles a line inside the current claim or open question. */
function continueItem(state: ParseState, item: Item, line: string): void {
  if (item.kind === 'claim') item.claim.lines.push(line);
  const quoteMatch = QUOTE_LINE.exec(line);
  if (quoteMatch) {
    state.pendingQuote.push(quoteMatch[1]);
    return;
  }
  const sourceMatch = SOURCE_LINE.exec(line);
  if (sourceMatch) {
    takeSource(state, item, sourceMatch[1]);
    return;
  }
  closePendingQuote(state);
  const searchedMatch = SEARCHED_LINE.exec(line);
  if (item.kind === 'question' && searchedMatch) item.question.searched.push(searchedMatch[1]);
  if (item.kind === 'claim') noteSupersession(item.claim, line);
}

/**
 * Parses `## Interpretation` into claims and open questions. Returns `undefined` when the section
 * is absent. HTML comments are removed first, so the template's own example text is never read.
 */
export function parseInterpretationQuotes(chunkText: string): ParsedInterpretation | undefined {
  const rawBody = extractSection(chunkText, '## Interpretation');
  if (rawBody === undefined) return undefined;
  const body = rawBody.replace(/<!--[\s\S]*?-->/g, '');

  const state: ParseState = { result: { claims: [], questions: [] }, current: undefined, pendingQuote: [] };
  for (const line of body.split('\n')) {
    if (startItem(state, line)) continue;
    if (state.current) continueItem(state, state.current, line);
  }
  closePendingQuote(state);
  return state.result;
}

function noteSupersession(claim: ParsedClaim, line: string): void {
  for (const m of line.matchAll(SUPERSEDES)) claim.supersedes.push(Number(m[1]));
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** What a claim's text is recorded as: line wrapping and blank lines do not change it. */
function claimTextHash(claim: ParsedClaim): string {
  return createHash('sha256').update(normalize(claim.lines.join('\n'))).digest('hex');
}

function supersededNumbers(parsed: ParsedInterpretation): Set<number> {
  return new Set(parsed.claims.flatMap((c) => c.supersedes));
}

/**
 * Every claim in force that carries no quote, by number, with the hash of its text. This is what
 * `boardsmith chunk-gate-transition` records for a chunk verified before this check existed.
 */
export function unquotedClaims(chunkText: string): Record<number, string> {
  const parsed = parseInterpretationQuotes(chunkText);
  if (!parsed) return {};
  const superseded = supersededNumbers(parsed);
  return Object.fromEntries(
    parsed.claims
      .filter((c) => !superseded.has(c.number) && c.quotes.length === 0)
      .map((c) => [c.number, claimTextHash(c)]),
  );
}

type Located = { ok: true; text: string } | { ok: false; problem: string };

const SOURCE_SPEC = /^`?([^`§]+?)`?\s*(?:§\s*"([^"]+)")?$/;
const LINE_RANGE = /^(.+?):(\d+)(?:-(\d+))?$/;

interface SourceSpec {
  spec: string;
  path: string;
  heading?: string;
  range?: [number, number];
}

function parseSpec(spec: string): SourceSpec | undefined {
  const parsed = SOURCE_SPEC.exec(spec.trim());
  if (!parsed) return undefined;
  const path = parsed[1].trim();
  const rangeMatch = LINE_RANGE.exec(path);
  if (!rangeMatch) return { spec, path, heading: parsed[2] };
  return {
    spec,
    path: rangeMatch[1],
    heading: parsed[2],
    range: [Number(rangeMatch[2]), Number(rangeMatch[3] ?? rangeMatch[2])],
  };
}

/** Reads the cited file, refusing a path that is absolute, leaves the project, or is missing. */
async function readSourceFile(projectDir: string, path: string): Promise<Located> {
  if (isAbsolute(path)) {
    return { ok: false, problem: `"${path}" is an absolute path. Source paths are relative to ${DESIGN_DIR}/.` };
  }
  const abs = resolve(designDir(projectDir), path);
  const fromProject = relative(resolve(projectDir), abs);
  if (fromProject === '' || fromProject.startsWith('..') || isAbsolute(fromProject)) {
    return {
      ok: false,
      problem: `"${path}" is outside this project. Copy or archive the source inside the project and cite it there.`,
    };
  }
  try {
    return { ok: true, text: await fs.readFile(abs, 'utf8') };
  } catch {
    return {
      ok: false,
      problem:
        `there is no file at ${DESIGN_DIR}/${path}. Source paths are relative to ${DESIGN_DIR}/ ` +
        '(for example rulebook/08-combat.md or RULINGS.md).',
    };
  }
}

function linesInRange(lines: string[], source: SourceSpec, range: [number, number]): Located {
  const [from, to] = range;
  if (from < 1 || to < from) {
    return { ok: false, problem: `"${source.spec}" has an invalid line range. Write it as :N or :N-M with N <= M.` };
  }
  if (to > lines.length) {
    return {
      ok: false,
      problem: `"${source.spec}" cites line ${to}, but ${DESIGN_DIR}/${source.path} has ${lines.length} lines.`,
    };
  }
  return { ok: true, text: lines.slice(from - 1, to).join('\n') };
}

/** Picks the text a parsed location names out of its file's lines. */
function locateWithin(lines: string[], source: SourceSpec): Located {
  const shown = `${DESIGN_DIR}/${source.path}`;
  if (source.range && source.heading) {
    return { ok: false, problem: `"${source.spec}" gives both a heading and a line range. Give one.` };
  }
  if (source.range) return linesInRange(lines, source, source.range);
  if (!source.heading) {
    return {
      ok: false,
      problem: `"${source.spec}" names a file but does not say where in the file. Add §"<heading>" or :<line>-<line>.`,
    };
  }
  if (!source.path.endsWith('.md')) {
    return {
      ok: false,
      problem: `${shown} is not a Markdown file, so it has no headings: cite it by line (${source.path}:N-M).`,
    };
  }
  return sectionUnder(lines, source.heading, shown);
}

/**
 * Resolves a `Source:`/`Searched:` location to the text it names: a Markdown heading's section
 * (the heading line down to the next heading of the same or higher level) or a line range.
 */
async function locate(projectDir: string, spec: string): Promise<Located> {
  if (spec.trim() === '') return { ok: false, problem: `a location line is empty. ${FORMAT_HINT}` };
  const source = parseSpec(spec);
  if (!source) return { ok: false, problem: `"${spec}" is not a location. ${FORMAT_HINT}` };
  const file = await readSourceFile(projectDir, source.path);
  if (!file.ok) return file;
  return locateWithin(file.text.split('\n'), source);
}

const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function sectionUnder(lines: string[], heading: string, shown: string): Located {
  const headings = lines
    .map((line, index) => {
      const m = HEADING_LINE.exec(line);
      return m ? { index, level: m[1].length, text: m[2] } : undefined;
    })
    .filter((h): h is { index: number; level: number; text: string } => h !== undefined);
  const matches = headings.filter((h) => h.text === heading);
  if (matches.length === 0) {
    const available = headings.map((h) => `"${h.text}"`).join(', ') || 'none';
    return { ok: false, problem: `${shown} has no heading "${heading}". Its headings are: ${available}.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      problem: `${shown} has ${matches.length} headings named "${heading}". Cite the passage by line range instead.`,
    };
  }
  const start = matches[0];
  const next = headings.find((h) => h.index > start.index && h.level <= start.level);
  return { ok: true, text: lines.slice(start.index, next ? next.index : lines.length).join('\n') };
}

function shownChunkPath(slug: string): string {
  return `${DESIGN_DIR}/${relChunkMdPath(slug)}`.split(sep).join('/');
}

/** Checks one quoted passage at its cited location, adding a refusal when it is not there. */
async function checkPassage(
  projectDir: string,
  claimNumber: number,
  passage: QuotedPassage,
  refusals: string[],
): Promise<CheckedQuote> {
  const located = await locate(projectDir, passage.source);
  if (!located.ok) {
    refusals.push(`Claim ${claimNumber}: ${located.problem}`);
    return { ...passage, found: false };
  }
  const found = normalize(located.text).includes(passage.quote);
  if (!found) {
    refusals.push(
      `Claim ${claimNumber}: the quote "${passage.quote}" was not found at ${passage.source}. ` +
        'Re-open that location and copy the text exactly, correct the location, or, if the source ' +
        'does not say this, rewrite the claim as an open question for the designer.',
    );
  }
  return { ...passage, found };
}

/**
 * What the gate transition means for this chunk's unquoted claims: `recorded` holds the claims it
 * recorded (by number, text hash), and `offer` says a verified chunk may still take the
 * transition, so a refusal names it.
 */
interface PreGateClaims {
  recorded: Record<number, string>;
  offer: boolean;
}

function noQuoteRefusal(claim: ParsedClaim, preGate: PreGateClaims): string {
  const recordedHash = preGate.recorded[claim.number];
  if (recordedHash !== undefined) {
    return (
      `Claim ${claim.number} changed since the gate transition recorded it without a quote ` +
      `(design/${GATE_TRANSITION_MD}), so it now needs one. ${FORMAT_HINT}`
    );
  }
  const offer = preGate.offer
    ? ' This chunk is verified: if its claims were written before claims carried quotes, the ' +
      'designer records them once for the whole project with ' +
      '`boardsmith chunk-gate-transition --by "<designer>"`, after which only a claim added or ' +
      'changed needs a quote.'
    : '';
  return (
    `Claim ${claim.number} has no quoted passage. ${FORMAT_HINT} If no source text backs it, it is ` +
    'not a claim: rewrite it as an open question (`Q1. **...**`) with `Searched:` lines naming where ' +
    `you looked, and the ask step puts it to the designer.${offer}`
  );
}

async function checkClaim(
  projectDir: string,
  claim: ParsedClaim,
  superseded: boolean,
  preGate: PreGateClaims,
  refusals: string[],
): Promise<CheckedClaim> {
  const checked: CheckedClaim = { number: claim.number, superseded, preGate: false, quotes: [] };
  if (superseded) return checked;
  if (claim.quotes.length === 0 && preGate.recorded[claim.number] === claimTextHash(claim)) {
    return { ...checked, preGate: true };
  }
  refusals.push(...claim.problems);
  if (claim.quotes.length === 0 && claim.problems.length === 0) {
    refusals.push(noQuoteRefusal(claim, preGate));
  }
  for (const passage of claim.quotes) {
    checked.quotes.push(await checkPassage(projectDir, claim.number, passage, refusals));
  }
  return checked;
}

async function checkQuestion(projectDir: string, question: ParsedQuestion, refusals: string[]): Promise<void> {
  refusals.push(...question.problems);
  if (question.searched.length === 0) {
    refusals.push(
      `${question.id} does not show where it looked. Add a \`Searched: <file> §"<heading>"\` or ` +
        '`Searched: <file>:<line>-<line>` line for every place the source was checked.',
    );
  }
  for (const spec of question.searched) {
    const located = await locate(projectDir, spec);
    if (!located.ok) refusals.push(`${question.id}: ${located.problem}`);
  }
}

/** A section with nothing checkable in it is refused rather than passed. */
function emptyInterpretationRefusal(slug: string, parsed: ParsedInterpretation | undefined): string | undefined {
  const shownChunk = shownChunkPath(slug);
  if (parsed === undefined) {
    return `${shownChunk} has no "## Interpretation" section. The investigate step writes it.`;
  }
  if (parsed.claims.length === 0 && parsed.questions.length === 0) {
    return (
      `${shownChunk}'s "## Interpretation" has no claims and no open questions. Claims start with ` +
      '`1. **`, open questions with `Q1. **`.'
    );
  }
  return undefined;
}

/** Checks one chunk's claims and open questions against the files they cite. */
export async function checkClaimQuotes(projectDir: string, slug: string): Promise<ClaimQuoteCheckResult> {
  const chunkText = await fs.readFile(chunkMdPath(projectDir, slug), 'utf8');
  const parsed = parseInterpretationQuotes(chunkText);
  const empty = emptyInterpretationRefusal(slug, parsed);
  if (empty !== undefined || parsed === undefined) {
    return { claims: [], questions: [], refusals: empty === undefined ? [] : [empty] };
  }

  const transition = await readGateTransition(projectDir);
  const preGate: PreGateClaims = {
    recorded: transition?.claims[slug] ?? {},
    offer: transition === undefined && /^Status:\s*verified/m.test(chunkText),
  };
  const superseded = supersededNumbers(parsed);
  const refusals: string[] = [];
  const claims: CheckedClaim[] = [];
  for (const claim of parsed.claims) {
    claims.push(await checkClaim(projectDir, claim, superseded.has(claim.number), preGate, refusals));
  }
  for (const question of parsed.questions) {
    await checkQuestion(projectDir, question, refusals);
  }
  return {
    claims,
    questions: parsed.questions.map((q) => ({ id: q.id, searched: q.searched })),
    refusals,
  };
}

function passLine(shownChunk: string, result: ClaimQuoteCheckResult): string {
  const live = result.claims.filter((c) => !c.superseded).length;
  const preGate = result.claims.filter((c) => c.preGate).length;
  const preGateNote = preGate
    ? ` ${preGate} of them recorded without a quote by the gate transition and unchanged since;`
    : '';
  return (
    `✓ ${shownChunk}: ${live} claim(s), every quote found at its source;${preGateNote} ` +
    `${result.questions.length} open question(s) for the ask step.`
  );
}

/**
 * The CLI entry. Exits non-zero when any claim or open question is refused. `--json` prints the
 * checked quotes and their sources WITHOUT the claims' own text, which is what the fidelity audit
 * lens is given so it re-opens the source rather than reading the interpretation.
 */
export async function claimQuoteCheckCommand(
  slug: string,
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  try {
    assertBareName(
      '<slug>',
      slug,
      'Pass the slug of a chunk in this project, which is the name of a directory under design/chunks/ holding a CHUNK.md.',
    );
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
    return;
  }

  const shownChunk = shownChunkPath(slug);
  try {
    await fs.access(chunkMdPath(projectDir, slug));
  } catch {
    console.error(
      chalk.red(`No CHUNK.md at ${shownChunk}. Check the slug, or pass --project <dir> for a different project.`),
    );
    process.exitCode = 1;
    return;
  }

  const result = await checkClaimQuotes(projectDir, slug);
  const ok = result.refusals.length === 0;

  if (options.json) {
    console.log(JSON.stringify({ slug, ok, ...result }, null, 2));
  } else if (ok) {
    console.log(chalk.green(passLine(shownChunk, result)));
  }

  if (!ok) {
    if (!options.json) {
      console.error(chalk.red(`${shownChunk}: ${result.refusals.length} claim problem(s):`));
      for (const refusal of result.refusals) console.error(`  • ${refusal}`);
    }
    process.exitCode = 1;
  }
}
