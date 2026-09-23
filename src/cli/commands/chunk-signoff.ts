import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  SKETCH_MD,
  WAIVERS_MD,
  chunkMdPath,
  designPath,
  relChunkMdPath,
} from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';
import { extractSection, findHeadingIndex } from './build-manifest.js';
import { atomicWriteFile } from './verify-run.js';

/**
 * `boardsmith chunk-signoff` / `boardsmith chunk-waiver` / `checkSignoff()`: who may say a chunk
 * is done (#291).
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * The sotf build run (2026-09-18 to 2026-09-23) was driven by a harness that read the bs- skills
 * but did not follow their prose exactly. It marked four chunks `verified` with playtest items
 * nobody observed, and it took a designer decision scoped to one chunk ("machine playtest" for
 * world-shell) and applied it to every chunk after it. Every rule it broke was already written in
 * Markdown. So the rules now live here:
 *
 *   - `Status: verified` is DERIVED from a recorded sign-off. `recordSignoff` is the only writer
 *     of it, and `checkSignoff` (run by `chunk-check` at close, and read by
 *     `chunk-provenance-status`) refuses a verified status no sign-off backs.
 *   - A designer sign-off records who, when, and which Verified Checklist items were observed,
 *     and it must cover every item.
 *   - A waiver lives in `design/WAIVERS.md`, names its chunks one by one, and expires. It is good
 *     for exactly the chunks it names; citing it from any other chunk is refused.
 *
 * HONEST LIMITATION: code cannot prove a human typed the name. What it does is make the failure
 * modes the audit found impossible to reach by accident: a run cannot sign as itself, cannot skip
 * an item, cannot stretch a waiver, and cannot type `verified` into a Status line and have it hold.
 */

/** The CHUNK.md section this module owns. A sibling of `## Verified Checklist`. */
export const SIGNOFF_HEADING = '## Sign-off';
export const SIGNOFF_BEGIN = '<!-- boardsmith:signoff:begin -->';
export const SIGNOFF_END = '<!-- boardsmith:signoff:end -->';
/** The body a freshly scaffolded CHUNK.md carries before anyone signs it off. */
const SIGNOFF_EMPTY = '_Not yet signed off._';

const VERIFIED = 'verified';
const VERIFIED_WAIVED = 'verified (user-waived)';

/**
 * The three ways a chunk can be done, and nothing else.
 *
 * - `designer`: the designer played the script and confirmed every checklist item.
 * - `waiver`: the designer granted a waiver that names this chunk and has not expired.
 * - `automated`: the chunk has no designer playtest (not a milestone, or no visible UI), so the
 *   automated test and sim pass stands in; the evidence names that pass.
 */
type SignoffRecord =
  | { basis: 'designer'; by: string; when: string; observed: number[] }
  | { basis: 'waiver'; waiver: string; by: string; when: string }
  | { basis: 'automated'; when: string; evidence: string };

interface ParsedSignoff {
  /** `absent`: no section. `empty`: scaffolded, never signed. `malformed`: present but unreadable. */
  state: 'absent' | 'empty' | 'malformed' | 'recorded';
  record?: SignoffRecord;
}

interface Waiver {
  id: string;
  grantedBy: string;
  granted: string;
  chunks: string[];
  /** `YYYY-MM-DD`. The waiver holds through the end of that day, UTC. */
  expires: string;
}

// ---------------------------------------------------------------------------------------------
// Who counts as the designer
// ---------------------------------------------------------------------------------------------

/**
 * Words that name the run rather than a person. `--by orchestrator`, `--by Claude`, `--by "the
 * run"` are how a run signs its own gate; each is refused. Matched as whole words, so a person
 * whose name merely contains one (`Botham`) is not.
 */
const RUN_IDENTITIES = new Set([
  'orchestrator',
  'run',
  'agent',
  'subagent',
  'claude',
  'assistant',
  'bot',
  'ai',
  'llm',
  'model',
  'automated',
  'automation',
  'machine',
  'system',
]);

function designerNameProblem(by: string, flag: string): string | undefined {
  const name = by.trim();
  if (!name) {
    return `${flag} is empty. Pass the designer's own name: the person who answered.`;
  }
  const words = name.toLowerCase().split(/[^a-z0-9]+/);
  if (!words.some((w) => RUN_IDENTITIES.has(w))) return undefined;
  return (
    `${flag} "${name}" names the run, not the designer. Only the designer signs off a playtest ` +
    `or grants a waiver. If no designer is here, leave the chunk parked at its gate and ask them.`
  );
}

// ---------------------------------------------------------------------------------------------
// Reading a chunk and its sketch entry
// ---------------------------------------------------------------------------------------------

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function readStatus(chunkText: string): string | undefined {
  return /^Status:\s*(.*)$/m.exec(chunkText)?.[1].trim();
}

/** The number of real items in `## Verified Checklist` (template placeholders excluded). */
function countChecklistItems(chunkText: string): number {
  const body = stripComments(extractSection(chunkText, '## Verified Checklist') ?? '');
  return body.split('\n').filter((line) => /^- \[[ xX]\]\s*\S/.test(line.trim())).length;
}

const UI_VALUES = ['none', 'touches', 'major'];
const MILESTONE_VALUES = ['none', 'core-loop', 'scoring', 'final-acceptance'];

function readUi(chunkText: string, slug: string): string {
  const body = stripComments(extractSection(chunkText, '## ui:') ?? '');
  const ui = body.trim().split('\n')[0].trim();
  if (UI_VALUES.includes(ui)) return ui;
  throw new Error(
    `${relChunkMdPath(slug)}'s "## ui:" section does not read none, touches, or major, so it is ` +
      `not known whether this chunk needs a designer playtest. Fix that section, then retry.`,
  );
}

async function readSketch(projectDir: string): Promise<string> {
  try {
    return await fs.readFile(designPath(projectDir, SKETCH_MD), 'utf-8');
  } catch {
    throw new Error(
      `No ${SKETCH_MD} in this project's design/ folder. Run this from the game project, or ` +
        `pass --project <dir>.`,
    );
  }
}

function sketchEntryRange(sketch: string, slug: string): { start: number; end: number } | undefined {
  const start = findHeadingIndex(sketch, `### ${slug}`);
  if (start === -1) return undefined;
  const lineEnd = sketch.indexOf('\n', start);
  const bodyStart = lineEnd === -1 ? sketch.length : lineEnd + 1;
  const next = /^#{2,3} /m.exec(sketch.slice(bodyStart));
  return { start, end: next ? bodyStart + next.index : sketch.length };
}

function readMilestone(sketch: string, slug: string): string {
  const range = sketchEntryRange(sketch, slug);
  const entry = range ? sketch.slice(range.start, range.end) : '';
  const milestone = /^- Milestone:\s*(\S+)\s*$/m.exec(entry)?.[1] ?? '';
  if (MILESTONE_VALUES.includes(milestone)) return milestone;
  throw new Error(
    `${SKETCH_MD} has no "### ${slug}" entry with a "- Milestone:" line reading none, core-loop, ` +
      `scoring, or final-acceptance, so it is not known whether ${slug} needs a designer ` +
      `playtest. Fix that entry, then retry.`,
  );
}

/**
 * Whether this chunk's playtest belongs to the designer: its SKETCH.md `Milestone:` is not `none`
 * AND its CHUNK.md `## ui:` is `touches` or `major` (`build/playtest.md` "Milestone/UI Gate").
 * Throws, with the fix, when either fact cannot be read: guessing here is how a UI chunk gets an
 * automated sign-off.
 */
async function needsDesignerPlaytest(projectDir: string, slug: string, chunkText: string): Promise<boolean> {
  const ui = readUi(chunkText, slug);
  const milestone = readMilestone(await readSketch(projectDir), slug);
  return milestone !== 'none' && ui !== 'none';
}

// ---------------------------------------------------------------------------------------------
// The sign-off block
// ---------------------------------------------------------------------------------------------

/** The fields each basis records, in the order they are written. */
const BASIS_FIELDS = {
  designer: ['By', 'When', 'Observed'],
  waiver: ['Waiver', 'By', 'When'],
  automated: ['When', 'Evidence'],
} as const;

function fieldValues(record: SignoffRecord): Record<string, string> {
  switch (record.basis) {
    case 'designer':
      return { By: record.by, When: record.when, Observed: record.observed.join(', ') };
    case 'waiver':
      return { Waiver: record.waiver, By: record.by, When: record.when };
    case 'automated':
      return { When: record.when, Evidence: record.evidence };
  }
}

function renderSignoff(record: SignoffRecord): string {
  const values = fieldValues(record);
  const lines = [`Basis: ${record.basis}`, ...BASIS_FIELDS[record.basis].map((f) => `${f}: ${values[f]}`)];
  return `\n${lines.join('\n')}\n`;
}

function renderSignoffSection(record: SignoffRecord): string {
  return `${SIGNOFF_HEADING}

<!-- MACHINE-OWNED. Written by \`boardsmith chunk-signoff <slug>\` and by nothing else. The
     Status line above is derived from this block; \`boardsmith chunk-check\` refuses a verified
     Status that this block does not back. -->

${SIGNOFF_BEGIN}${renderSignoff(record)}${SIGNOFF_END}
`;
}

function parseObserved(raw: string): number[] | undefined {
  const observed = raw.split(',').map((n) => Number(n.trim()));
  return observed.every((n) => Number.isInteger(n)) ? observed : undefined;
}

function buildRecord(basis: keyof typeof BASIS_FIELDS, f: Record<string, string>): SignoffRecord | undefined {
  if (basis === 'waiver') return { basis, waiver: f.Waiver, by: f.By, when: f.When };
  if (basis === 'automated') return { basis, when: f.When, evidence: f.Evidence };
  const observed = parseObserved(f.Observed);
  return observed ? { basis, by: f.By, when: f.When, observed } : undefined;
}

function signoffBody(chunkText: string): string | undefined {
  const headingIdx = findHeadingIndex(chunkText, SIGNOFF_HEADING);
  const begin = chunkText.indexOf(SIGNOFF_BEGIN, headingIdx);
  const end = chunkText.indexOf(SIGNOFF_END, headingIdx);
  if (begin === -1 || end < begin) return undefined;
  return chunkText.slice(begin + SIGNOFF_BEGIN.length, end).trim();
}

function readFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of body.matchAll(/^([A-Za-z]+):[ \t]*(.*)$/gm)) {
    if (match[2].trim()) fields[match[1]] = match[2].trim();
  }
  return fields;
}

function recordFromFields(fields: Record<string, string>): SignoffRecord | undefined {
  const basis = fields.Basis ?? '';
  if (!(basis in BASIS_FIELDS)) return undefined;
  const key = basis as keyof typeof BASIS_FIELDS;
  return BASIS_FIELDS[key].every((f) => fields[f]) ? buildRecord(key, fields) : undefined;
}

/** Pure. Strict: a block missing any field its basis needs is `malformed`, never half-read. */
export function parseSignoff(chunkText: string): ParsedSignoff {
  if (findHeadingIndex(chunkText, SIGNOFF_HEADING) === -1) return { state: 'absent' };
  const body = signoffBody(chunkText);
  if (body === undefined) return { state: 'malformed' };
  if (body === SIGNOFF_EMPTY) return { state: 'empty' };
  const record = recordFromFields(readFields(body));
  return record ? { state: 'recorded', record } : { state: 'malformed' };
}

/** The Status a sign-off derives. Never typed by a session. */
function derivedStatus(record: SignoffRecord): string {
  return record.basis === 'waiver' ? VERIFIED_WAIVED : VERIFIED;
}

// ---------------------------------------------------------------------------------------------
// The waiver ledger
// ---------------------------------------------------------------------------------------------

const WAIVERS_HEADER = `# Waivers

<!-- MACHINE-OWNED. Written by \`boardsmith chunk-waiver\` and by nothing else. Each waiver is
     the designer's own decision to skip playtesting the chunks it names, until it expires. It
     covers exactly those chunks: \`boardsmith chunk-signoff --waiver\` refuses it for any other
     chunk, and a decision about one chunk is never a precedent for the next. An ask gate cannot
     be waived at all. -->
`;

function parseWaivers(text: string): Waiver[] {
  const parts = text.split(/^### Waiver (W\d+)[ \t]*$/m);
  const waivers: Waiver[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1] ?? '';
    const field = (label: string): string =>
      new RegExp(`^- ${label}:[ \\t]*(.*)$`, 'm').exec(body)?.[1].trim() ?? '';
    waivers.push({
      id: parts[i],
      grantedBy: field('Granted by'),
      granted: field('Granted'),
      chunks: splitList(field('Chunks')),
      expires: field('Expires'),
    });
  }
  return waivers;
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readWaivers(projectDir: string): Promise<Waiver[]> {
  const text = await fs.readFile(designPath(projectDir, WAIVERS_MD), 'utf-8').catch(() => '');
  return parseWaivers(text);
}

function expiryEnd(expires: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return undefined;
  const end = new Date(`${expires}T23:59:59.999Z`);
  return Number.isNaN(end.getTime()) ? undefined : end;
}

// ---------------------------------------------------------------------------------------------
// Validation: one function, used before writing and when checking
// ---------------------------------------------------------------------------------------------

interface SignoffContext {
  slug: string;
  checklistItems: number;
  /** An Error when the gate could not be read; its message becomes the problem. */
  needsDesigner: boolean | Error;
  waivers: Waiver[];
}

function designerProblems(record: { by: string; observed: number[] }, ctx: SignoffContext): string[] {
  const problems: string[] = [];
  const nameProblem = designerNameProblem(record.by, 'The sign-off By');
  if (nameProblem) problems.push(nameProblem);
  if (ctx.checklistItems === 0) {
    problems.push(
      `${ctx.slug}'s Verified Checklist has no items. Write one line per playtest script item ` +
        `before the designer signs off.`,
    );
  }
  for (let item = 1; item <= ctx.checklistItems; item++) {
    if (record.observed.includes(item)) continue;
    problems.push(
      `Verified Checklist item ${item} has no observation recorded. The designer must confirm ` +
        `every item, or the chunk goes to revise.`,
    );
  }
  for (const item of record.observed.filter((n) => n < 1 || n > ctx.checklistItems)) {
    problems.push(
      `Observed item ${item} is not on ${ctx.slug}'s Verified Checklist (items 1 to ${ctx.checklistItems}).`,
    );
  }
  return problems;
}

function waiverTimeProblems(waiver: Waiver, when: Date, slug: string): string[] {
  const problems: string[] = [];
  const end = expiryEnd(waiver.expires);
  if (!end) {
    problems.push(`Waiver ${waiver.id} has no valid Expires date (YYYY-MM-DD).`);
  } else if (when.getTime() > end.getTime()) {
    problems.push(
      `Waiver ${waiver.id} expired on ${waiver.expires}, before this sign-off. Ask the designer ` +
        `to play ${slug}, or to grant a fresh waiver.`,
    );
  }
  const granted = new Date(waiver.granted);
  if (Number.isNaN(granted.getTime()) || when.getTime() < granted.getTime()) {
    problems.push(`This sign-off is dated before waiver ${waiver.id} was granted.`);
  }
  return problems;
}

function waiverProblems(record: { waiver: string; by: string; when: string }, ctx: SignoffContext): string[] {
  const waiver = ctx.waivers.find((w) => w.id === record.waiver);
  if (!waiver) {
    return [
      `Waiver ${record.waiver} is not in design/${WAIVERS_MD}. Only a waiver the designer ` +
        `granted with \`boardsmith chunk-waiver\` can be cited.`,
    ];
  }
  const problems: string[] = [];
  if (!waiver.chunks.includes(ctx.slug)) {
    problems.push(
      `Waiver ${waiver.id} does not name ${ctx.slug} (it names ${waiver.chunks.join(', ') || 'no chunk'}). ` +
        `A waiver covers only the chunks it names. Ask the designer to play ${ctx.slug}, or to ` +
        `grant a waiver that names it.`,
    );
  }
  if (waiver.grantedBy !== record.by) {
    problems.push(
      `The sign-off says By "${record.by}" but waiver ${waiver.id} was granted by "${waiver.grantedBy}".`,
    );
  }
  return [...problems, ...waiverTimeProblems(waiver, new Date(record.when), ctx.slug)];
}

function automatedProblems(ctx: SignoffContext): string[] {
  if (ctx.needsDesigner instanceof Error) return [ctx.needsDesigner.message];
  if (!ctx.needsDesigner) return [];
  return [
    `${ctx.slug} needs a designer playtest (it is a milestone chunk with visible UI), so an ` +
      `automated pass cannot sign it off. The designer plays it, or grants a waiver naming it.`,
  ];
}

function signoffProblems(record: SignoffRecord, ctx: SignoffContext): string[] {
  const whenProblems = Number.isNaN(new Date(record.when).getTime())
    ? [`The sign-off's When "${record.when}" is not a date and time.`]
    : [];
  switch (record.basis) {
    case 'designer':
      return [...whenProblems, ...designerProblems(record, ctx)];
    case 'waiver':
      return [...whenProblems, ...waiverProblems(record, ctx)];
    case 'automated':
      return [...whenProblems, ...automatedProblems(ctx)];
  }
}

async function loadContext(projectDir: string, slug: string, chunkText: string): Promise<SignoffContext> {
  const needsDesigner = await needsDesignerPlaytest(projectDir, slug, chunkText).catch(
    (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
  );
  return {
    slug,
    checklistItems: countChecklistItems(chunkText),
    needsDesigner,
    waivers: await readWaivers(projectDir),
  };
}

/**
 * The check. Returns every reason this chunk's Status is not backed by a valid sign-off, as
 * sentences a designer can act on; `[]` means it is backed, or that the chunk is not verified.
 * Read-only. `chunk-check` fails on a non-empty result; `chunk-provenance-status` reports it.
 */
export async function checkSignoff(projectDir: string, slug: string): Promise<string[]> {
  const dir = resolve(projectDir);
  const rel = relChunkMdPath(slug);
  const chunkText = await fs.readFile(chunkMdPath(dir, slug), 'utf-8');
  const status = readStatus(chunkText) ?? '';
  if (!status.startsWith(VERIFIED)) return [];

  const parsed = parseSignoff(chunkText);
  if (!parsed.record) {
    const damaged = parsed.state === 'malformed' ? ' (its "## Sign-off" block is damaged)' : '';
    return [
      `${rel} says "Status: ${status}" but has no designer sign-off entry${damaged}. A verified ` +
        `status is derived from a sign-off and cannot be set by hand. Set Status back to built, ` +
        `then record the designer's sign-off with \`boardsmith chunk-signoff ${slug}\`.`,
    ];
  }

  const problems = signoffProblems(parsed.record, await loadContext(dir, slug, chunkText));
  const expected = derivedStatus(parsed.record);
  if (status !== expected) {
    problems.push(
      `${rel} says "Status: ${status}" but its sign-off (basis: ${parsed.record.basis}) derives ` +
        `"${expected}". Status is written only by \`boardsmith chunk-signoff\`.`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The writers
// ---------------------------------------------------------------------------------------------

interface SignoffOptions {
  project?: string;
  /** Designer basis: the designer's name. Requires `observed`. */
  by?: string;
  /** Designer basis: the checklist item numbers observed, e.g. `1,2,3`. */
  observed?: string;
  /** Waiver basis: the waiver id from design/WAIVERS.md, e.g. `W2`. */
  waiver?: string;
  /** Automated basis: the test and sim pass that stands in for a playtest. */
  automated?: string;
  /** Tests only. */
  now?: Date;
}

const SLUG_REMEDY =
  'Pass the slug of a chunk in this project, which is the name of a directory under ' +
  'design/chunks/ holding a CHUNK.md.';

const ONE_BASIS =
  'Give exactly one of: --by <designer> with --observed <items> (the designer played it), ' +
  '--waiver <id> (the designer waived it), or --automated <evidence> (no designer playtest is ' +
  'due for this chunk).';

function designerRecord(options: SignoffOptions, when: string): SignoffRecord {
  if (options.by === undefined || options.observed === undefined) {
    throw new Error(
      'A designer sign-off needs both --by <designer> and --observed <items>, e.g. ' +
        '--observed 1,2,3 for every Verified Checklist item the designer confirmed.',
    );
  }
  const observed = parseObserved(options.observed);
  if (!observed) {
    throw new Error(`--observed "${options.observed}" is not a list of item numbers like 1,2,3.`);
  }
  const unique = [...new Set(observed)].sort((a, b) => a - b);
  return { basis: 'designer', by: options.by.trim(), when, observed: unique };
}

function automatedRecord(evidence: string, ctx: SignoffContext, when: string): SignoffRecord {
  if (!evidence.trim()) {
    throw new Error('--automated needs the evidence: the test and sim pass that exercised this chunk.');
  }
  if (ctx.needsDesigner instanceof Error) throw ctx.needsDesigner;
  return { basis: 'automated', when, evidence: evidence.trim() };
}

/** Turns the command's flags into the one record they describe, or refuses. */
function recordFromOptions(options: SignoffOptions, ctx: SignoffContext, when: string): SignoffRecord {
  const designerGiven = options.by !== undefined || options.observed !== undefined;
  const given = [designerGiven, options.waiver !== undefined, options.automated !== undefined];
  if (given.filter(Boolean).length !== 1) throw new Error(ONE_BASIS);
  if (designerGiven) return designerRecord(options, when);
  if (options.automated !== undefined) return automatedRecord(options.automated, ctx, when);
  const waiver = ctx.waivers.find((w) => w.id === options.waiver);
  return { basis: 'waiver', waiver: options.waiver!, by: waiver?.grantedBy ?? '', when };
}

async function readBuiltChunk(dir: string, slug: string): Promise<string> {
  const rel = relChunkMdPath(slug);
  const chunkText = await fs.readFile(chunkMdPath(dir, slug), 'utf-8').catch(() => {
    throw new Error(`No chunk found at ${rel} in ${dir}.\n${SLUG_REMEDY}`);
  });
  const status = readStatus(chunkText);
  if (status !== 'built') {
    throw new Error(
      `${rel} is "${status ?? 'missing a Status line'}", not built. A chunk is signed off once ` +
        `its build and test steps are done and its playtest (or waiver) has happened.`,
    );
  }
  return chunkText;
}

/** SKETCH.md with this chunk's derived Status pointer rewritten, or a refusal naming the fix. */
function sketchWithStatus(sketch: string, slug: string, status: string): string {
  const range = sketchEntryRange(sketch, slug);
  const pointer = new RegExp(
    `^- Status \\(derived from chunks/${escapeRegExp(slug)}/CHUNK\\.md\\):.*$`,
    'm',
  );
  const match = range ? pointer.exec(sketch.slice(range.start, range.end)) : null;
  if (!range || !match) {
    throw new Error(
      `${SKETCH_MD}'s "### ${slug}" entry has no "- Status (derived from chunks/${slug}/CHUNK.md):" ` +
        `line, so the derived status cannot follow. Repair that entry, then retry.`,
    );
  }
  const at = range.start + match.index;
  return (
    sketch.slice(0, at) +
    `- Status (derived from chunks/${slug}/CHUNK.md): ${status}` +
    sketch.slice(at + match[0].length)
  );
}

/**
 * Records a chunk's sign-off and derives its Status from it: the block and the Status line land
 * in one CHUNK.md write, then SKETCH.md's derived pointer follows (`state-machine.md` "Write
 * Order"). Refuses, touching nothing, when the sign-off would not pass `checkSignoff`.
 */
export async function recordSignoff(slug: string, options: SignoffOptions): Promise<SignoffRecord> {
  assertBareName('<slug>', slug, SLUG_REMEDY);
  const dir = resolve(options.project ?? process.cwd());
  const chunkText = await readBuiltChunk(dir, slug);
  const ctx = await loadContext(dir, slug, chunkText);
  const record = recordFromOptions(options, ctx, (options.now ?? new Date()).toISOString());

  const problems = signoffProblems(record, ctx);
  if (problems.length) {
    throw new Error(`${slug} was not signed off:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  const status = derivedStatus(record);
  const sketchPath = designPath(dir, SKETCH_MD);
  const updatedSketch = sketchWithStatus(await readSketch(dir), slug, status);
  const updatedChunk = writeSignoffBlock(chunkText, record, relChunkMdPath(slug)).replace(
    /^Status:.*$/m,
    `Status: ${status}`,
  );
  await atomicWriteFile(chunkMdPath(dir, slug), updatedChunk);
  await atomicWriteFile(sketchPath, updatedSketch);
  return record;
}

/** A chunk made before this section existed gets it inserted ahead of `## Verified Commit Hash`. */
function insertSignoffSection(chunkText: string, record: SignoffRecord): string {
  const anchor = findHeadingIndex(chunkText, '## Verified Commit Hash');
  const at = anchor === -1 ? chunkText.length : anchor;
  const before = chunkText.slice(0, at).replace(/\n*$/, '\n\n');
  const after = anchor === -1 ? '' : `\n${chunkText.slice(at)}`;
  return before + renderSignoffSection(record) + after;
}

function writeSignoffBlock(chunkText: string, record: SignoffRecord, rel: string): string {
  if (parseSignoff(chunkText).state === 'absent') return insertSignoffSection(chunkText, record);
  if (signoffBody(chunkText) === undefined) {
    throw new Error(
      `${rel}'s "${SIGNOFF_HEADING}" section is missing its machine-owned fences ` +
        `(${SIGNOFF_BEGIN} ... ${SIGNOFF_END}). Delete the whole "${SIGNOFF_HEADING}" section, ` +
        `then retry; this command writes it fresh.`,
    );
  }
  const headingIdx = findHeadingIndex(chunkText, SIGNOFF_HEADING);
  const begin = chunkText.indexOf(SIGNOFF_BEGIN, headingIdx) + SIGNOFF_BEGIN.length;
  const end = chunkText.indexOf(SIGNOFF_END, headingIdx);
  return chunkText.slice(0, begin) + renderSignoff(record) + chunkText.slice(end);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface WaiverOptions {
  project?: string;
  /** Comma-separated chunk slugs, each one a `### <slug>` entry in SKETCH.md. */
  chunks: string;
  by: string;
  /** `YYYY-MM-DD`. */
  expires: string;
  reason: string;
  /** Tests only. */
  now?: Date;
}

/** Refuses a waiver whose grantor, expiry or reason is not a real, bounded designer decision. */
function assertWaiverTerms(options: WaiverOptions, now: Date): void {
  const nameProblem = designerNameProblem(options.by ?? '', '--by');
  if (nameProblem) throw new Error(nameProblem);
  const end = expiryEnd(options.expires ?? '');
  if (!end) {
    throw new Error(`--expires "${options.expires}" is not a date. Use YYYY-MM-DD; every waiver ends.`);
  }
  if (end.getTime() < now.getTime()) {
    throw new Error(`--expires ${options.expires} has already passed. A waiver must expire in the future.`);
  }
  if (!(options.reason ?? '').trim()) {
    throw new Error('--reason is empty. Record why the designer waived these chunks.');
  }
}

/** The named chunks, each checked to be a real SKETCH.md entry: never "all", never a wildcard. */
function waiverChunks(raw: string, sketch: string): string[] {
  const chunks = splitList(raw ?? '');
  if (!chunks.length) throw new Error('--chunks is empty. Name each chunk the waiver covers.');
  for (const slug of chunks) {
    assertBareName('--chunks entry', slug, 'Name each chunk by its slug, separated by commas.');
    if (findHeadingIndex(sketch, `### ${slug}`) !== -1) continue;
    throw new Error(
      `--chunks names "${slug}", which is not a chunk in ${SKETCH_MD}. A waiver names real ` +
        `chunks one by one; it never covers "all" or "every later chunk".`,
    );
  }
  return chunks;
}

/** Appends a designer waiver to design/WAIVERS.md and returns its id. */
export async function recordWaiver(options: WaiverOptions): Promise<string> {
  const dir = resolve(options.project ?? process.cwd());
  const now = options.now ?? new Date();
  assertWaiverTerms(options, now);
  const chunks = waiverChunks(options.chunks, await readSketch(dir));

  const ledgerPath = designPath(dir, WAIVERS_MD);
  const existing = await fs.readFile(ledgerPath, 'utf-8').catch(() => WAIVERS_HEADER);
  const next = parseWaivers(existing).reduce((max, w) => Math.max(max, Number(w.id.slice(1))), 0) + 1;
  const id = `W${next}`;
  const entry = [
    `### Waiver ${id}`,
    `- Granted by: ${options.by.trim()}`,
    `- Granted: ${now.toISOString()}`,
    `- Chunks: ${chunks.join(', ')}`,
    `- Expires: ${options.expires}`,
    `- Reason: ${options.reason.trim()}`,
    '',
  ].join('\n');
  await atomicWriteFile(ledgerPath, `${existing.replace(/\n*$/, '\n\n')}${entry}`);
  return id;
}

// ---------------------------------------------------------------------------------------------
// CLI wrappers
// ---------------------------------------------------------------------------------------------

/** `boardsmith chunk-signoff <slug>`. Throws (clean one-line message via cli.ts) on refusal. */
export async function chunkSignoffCommand(
  slug: string,
  options: Omit<SignoffOptions, 'now'>,
): Promise<void> {
  const record = await recordSignoff(slug, options);
  console.log(chalk.green(`✓ ${slug} signed off (${record.basis}); Status: ${derivedStatus(record)}`));
}

/** `boardsmith chunk-waiver`. Prints the new waiver's id. */
export async function chunkWaiverCommand(options: Omit<WaiverOptions, 'now'>): Promise<void> {
  const id = await recordWaiver(options);
  console.log(chalk.green(`✓ Waiver ${id} recorded for ${options.chunks}, until ${options.expires}`));
}
