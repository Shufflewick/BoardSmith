import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import chalk from 'chalk';
import {
  GATE_TRANSITION_MD,
  SKETCH_MD,
  WAIVERS_MD,
  chunkMdPath,
  chunkSlugs,
  designDir,
  designPath,
  relChunkMdPath,
} from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';
import { type GateTransition, readGateTransition } from '../lib/gate-transition.js';
import { type MergeSignoff, readMergeSignoffs } from '../lib/merge-signoffs.js';
import {
  extractSection,
  findHeadingIndex,
  parseBuildManifest,
  resolveManifestPath,
} from './build-manifest.js';
import { atomicWriteFile } from './verify-run.js';
import { checkConstraints } from './constraint-check.js';
import { verifiedProblem } from '../lib/verify-result.js';

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
 *   - A sign-off is bound to the chunk as it was signed (#295): it records a content hash of each
 *     source file the chunk's Build Manifest names. `boardsmith chunk-reopen` voids it outright,
 *     so a reopened chunk whose Status is typed back to verified is refused even when no code
 *     moved.
 *   - An edit to one of those files after the sign-off must be accounted for (#396). Chunks share
 *     files (one rules module, one test support file), so a later chunk editing its own part of a
 *     shared file is the normal course of a build, not a change to the signed chunk. An edit is
 *     accounted for when a LATER sign-off of another chunk recorded the file exactly as it is now,
 *     or when another chunk that names the file is being built (Status approved or built), whose
 *     own sign-off will have to cover it, or when `boardsmith chunk-merge` vouched for the file as
 *     it is now after two chunks built at the same time both edited it (#403,
 *     `design/MERGE-SIGNOFFS.md`). Accounted edits are reported as `sharedEdits`, which is
 *     information, not a refusal. An edit nothing accounts for (a signed chunk reworked without a
 *     reopen, or an edit left behind by nobody's chunk) voids every sign-off naming that file.
 *   - A sign-off is a done claim, so it is refused unless the commit checked out, on a clean
 *     tree, passed `boardsmith verify` with this chunk's whole change measured (#452,
 *     `verifiedProblem`): the result's base is the chunk's verify base or a commit before it, so a
 *     `--base HEAD` run, which mutates nothing, does not count. Commit the chunk's work, run
 *     `boardsmith verify --chunk <slug>`, then sign off.
 *   - A chunk verified before this gate existed gets through it once, by `boardsmith
 *     chunk-gate-transition` (#397): the designer records it in `design/GATE-TRANSITION.md`, and
 *     the chunk's block reads `Basis: transition`. That basis counts only for a chunk the ledger
 *     names, so it cannot be typed into a chunk verified since.
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

export const VERIFIED = 'verified';
const VERIFIED_WAIVED = 'verified (user-waived)';

/**
 * The ways a chunk can be done, and nothing else.
 *
 * - `designer`: the designer played the script and confirmed every checklist item.
 * - `waiver`: the designer granted a waiver that names this chunk and has not expired.
 * - `automated`: the chunk has no designer playtest (not a milestone, or no visible UI), so the
 *   automated test and sim pass stands in; the evidence names that pass.
 * - `transition`: the chunk was verified before this gate existed, and the designer recorded it
 *   in the project's one-time gate transition; `status` is the verified Status it kept.
 */
type SignoffBasis =
  | { basis: 'designer'; by: string; when: string; observed: number[] }
  | { basis: 'waiver'; waiver: string; by: string; when: string }
  | { basis: 'automated'; when: string; evidence: string }
  | { basis: 'transition'; by: string; when: string; status: string };

/**
 * Each source file the Build Manifest names, mapped to its content at sign-off: a SHA-256, or
 * `missing`, or `outside-project` for a path that leaves the project (`chunkCodeFiles`).
 */
type CodeFiles = Record<string, string>;

/** Every basis also records `code`: the chunk's source files as they were at sign-off. */
export type SignoffRecord = SignoffBasis & { code: CodeFiles };

interface ParsedSignoff {
  /**
   * `absent`: no section. `empty`: scaffolded, never signed. `reopened`: signed once, then voided
   * by `boardsmith chunk-reopen`. `malformed`: present but unreadable. `whole-file`: a sign-off
   * recorded before #396, with one hash over all its files, which cannot say which file moved.
   */
  state: 'absent' | 'empty' | 'reopened' | 'malformed' | 'whole-file' | 'recorded';
  record?: SignoffRecord;
  /** A `whole-file` sign-off: its basis, and the one hash it recorded over all its files. */
  wholeFile?: { basis: SignoffBasis; hash: string };
  reopened?: { when: string; reason: string };
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

export function designerNameProblem(by: string, flag: string): string | undefined {
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

export function readStatus(chunkText: string): string | undefined {
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
// What a sign-off is bound to
// ---------------------------------------------------------------------------------------------

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

const MISSING = 'missing';
const OUTSIDE_PROJECT = 'outside-project';

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * The chunk's code as a sign-off sees it: every source file its `## Build Manifest` names, each
 * with its own content hash. Anything under `design/` is left out however the manifest writes it
 * (`DECISIONS.md` or `design/DECISIONS.md`, a rulebook slice, a chunk's evidence): close writes
 * the ledgers after the sign-off, and none of it is the code the designer played.
 */
export async function chunkCodeFiles(projectDir: string, chunkText: string): Promise<CodeFiles> {
  const design = designDir(projectDir);
  const files: CodeFiles = {};
  const paths = [...new Set(parseBuildManifest(chunkText).entries.map((e) => e.path))].sort();
  for (const path of paths) {
    const abs = resolveManifestPath(projectDir, path);
    if (abs === 'escapes') {
      files[path] = OUTSIDE_PROJECT;
      continue;
    }
    if (isInside(design, abs)) continue;
    const content = await fs.readFile(abs).catch(() => undefined);
    files[path] = content ? sha256(content) : MISSING;
  }
  return files;
}

// ---------------------------------------------------------------------------------------------
// The sign-off block
// ---------------------------------------------------------------------------------------------

/** The fields each basis records, in the order they are written. `Code:` lines follow them. */
const BASIS_FIELDS = {
  designer: ['By', 'When', 'Observed'],
  waiver: ['Waiver', 'By', 'When'],
  automated: ['When', 'Evidence'],
  transition: ['By', 'When', 'Status'],
} as const;

function fieldValues(record: SignoffBasis): Record<string, string> {
  switch (record.basis) {
    case 'designer':
      return { By: record.by, When: record.when, Observed: record.observed.join(', ') };
    case 'waiver':
      return { Waiver: record.waiver, By: record.by, When: record.when };
    case 'automated':
      return { When: record.when, Evidence: record.evidence };
    case 'transition':
      return { By: record.by, When: record.when, Status: record.status };
  }
}

/** One `Code: <path> <content>` line per file, or `Code: none` for a manifest with no source. */
function renderCode(code: CodeFiles): string[] {
  const paths = Object.keys(code).sort();
  return paths.length ? paths.map((p) => `Code: ${p} ${code[p]}`) : ['Code: none'];
}

export function renderSignoff(record: SignoffRecord): string {
  const values = fieldValues(record);
  const lines = [
    `Basis: ${record.basis}`,
    ...BASIS_FIELDS[record.basis].map((f) => `${f}: ${values[f]}`),
    ...renderCode(record.code),
  ];
  return `\n${lines.join('\n')}\n`;
}

/** The body `boardsmith chunk-reopen` leaves: the old sign-off is gone, and why is on record. */
function renderReopened(when: string, reason: string): string {
  return `\nReopened: ${when}\nReason: ${reason}\n`;
}

function renderSignoffSection(body: string): string {
  return `${SIGNOFF_HEADING}

<!-- MACHINE-OWNED. Written by \`boardsmith chunk-signoff <slug>\` and \`boardsmith chunk-reopen
     <slug>\` and by nothing else. The Status line above is derived from this block;
     \`boardsmith chunk-check\` refuses a verified Status that this block does not back. -->

${SIGNOFF_BEGIN}${body}${SIGNOFF_END}
`;
}

function parseObserved(raw: string): number[] | undefined {
  const observed = raw.split(',').map((n) => Number(n.trim()));
  return observed.every((n) => Number.isInteger(n)) ? observed : undefined;
}

function buildBasis(basis: keyof typeof BASIS_FIELDS, f: Record<string, string>): SignoffBasis | undefined {
  if (basis === 'waiver') return { basis, waiver: f.Waiver, by: f.By, when: f.When };
  if (basis === 'automated') return { basis, when: f.When, evidence: f.Evidence };
  if (basis === 'transition') return { basis, by: f.By, when: f.When, status: f.Status };
  const observed = parseObserved(f.Observed);
  return observed ? { basis, by: f.By, when: f.When, observed } : undefined;
}

const WHOLE_FILE_HASH = /^[0-9a-f]{64}$/;

/**
 * The block's `Code:` lines. `whole-file` is the pre-#396 form, a single bare hash; anything else
 * that is not `none` or `<path> <content>` lines is unreadable (`undefined`).
 */
function readCode(body: string): CodeFiles | 'whole-file' | undefined {
  const values = [...body.matchAll(/^Code:[ \t]*(.*)$/gm)].map((m) => m[1].trim());
  if (values.length === 1 && WHOLE_FILE_HASH.test(values[0])) return 'whole-file';
  if (values.length === 1 && values[0] === 'none') return {};
  if (values.length === 0) return undefined;
  const code: CodeFiles = {};
  for (const value of values) {
    const match = /^(\S+)[ \t]+(\S+)$/.exec(value);
    if (!match) return undefined;
    code[match[1]] = match[2];
  }
  return code;
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

function basisFromFields(fields: Record<string, string>): SignoffBasis | undefined {
  const basis = fields.Basis ?? '';
  if (!(basis in BASIS_FIELDS)) return undefined;
  const key = basis as keyof typeof BASIS_FIELDS;
  return BASIS_FIELDS[key].every((f) => fields[f]) ? buildBasis(key, fields) : undefined;
}

/** Pure. Strict: a block missing any field its basis needs is `malformed`, never half-read. */
export function parseSignoff(chunkText: string): ParsedSignoff {
  if (findHeadingIndex(chunkText, SIGNOFF_HEADING) === -1) return { state: 'absent' };
  const body = signoffBody(chunkText);
  if (body === undefined) return { state: 'malformed' };
  if (body === SIGNOFF_EMPTY) return { state: 'empty' };
  const fields = readFields(body);
  if (fields.Reopened) {
    return { state: 'reopened', reopened: { when: fields.Reopened, reason: fields.Reason ?? '' } };
  }
  const basis = basisFromFields(fields);
  const code = readCode(body);
  if (!basis || code === undefined) return { state: 'malformed' };
  if (code === 'whole-file') {
    return { state: 'whole-file', wholeFile: { basis, hash: /^Code:[ \t]*(\S+)/m.exec(body)![1] } };
  }
  return { state: 'recorded', record: { ...basis, code } };
}

/** The Status a sign-off derives. Never typed by a session. */
function derivedStatus(record: SignoffBasis): string {
  if (record.basis === 'transition') return record.status;
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
  transition: GateTransition | undefined;
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

function transitionProblems(record: { by: string; when: string; status: string }, ctx: SignoffContext): string[] {
  if (!ctx.transition) {
    return [
      `${ctx.slug}'s sign-off cites the gate transition, but design/${GATE_TRANSITION_MD} does not ` +
        `exist. Only \`boardsmith chunk-gate-transition\` writes a transition sign-off.`,
    ];
  }
  const entry = ctx.transition.signoffs.find((s) => s.slug === ctx.slug);
  if (!entry) {
    return [
      `The gate transition (design/${GATE_TRANSITION_MD}) does not name ${ctx.slug}. It covers only ` +
        `the chunks verified before the gates when it was recorded; a chunk verified since is ` +
        `signed off with \`boardsmith chunk-signoff ${ctx.slug} ...\`.`,
    ];
  }
  const recorded = { By: ctx.transition.by, When: ctx.transition.recorded, Status: entry.status };
  const given = { By: record.by, When: record.when, Status: record.status };
  const problems = (Object.keys(recorded) as Array<keyof typeof recorded>)
    .filter((k) => recorded[k] !== given[k])
    .map(
      (k) =>
        `The sign-off says ${k} "${given[k]}" but design/${GATE_TRANSITION_MD} records ` +
        `"${recorded[k]}" for ${ctx.slug}.`,
    );
  if (![VERIFIED, VERIFIED_WAIVED].includes(record.status)) {
    problems.push(`A transition sign-off keeps a verified Status; "${record.status}" is not one.`);
  }
  return problems;
}

function signoffProblems(record: SignoffBasis, ctx: SignoffContext): string[] {
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
    case 'transition':
      return [...whenProblems, ...transitionProblems(record, ctx)];
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
    transition: await readGateTransition(projectDir),
  };
}

// ---------------------------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------------------------

/** One chunk as the check reads it. `code` is its source files as they are now. */
interface ChunkState {
  slug: string;
  text: string;
  status: string;
  parsed: ParsedSignoff;
  code: CodeFiles;
}

/** A later edit to a file this chunk's sign-off names, and what accounts for it (#396). */
export interface SharedEdit {
  path: string;
  /**
   * The chunk whose later sign-off saw the file as it is now, or which is building it; for a
   * merge, the chunks whose own checks it re-ran on the combined file, comma-separated.
   */
  coveredBy: string;
  how: 'signed-off' | 'being-built' | 'merged';
}

interface SignoffAssessment {
  /** Every reason this chunk's Status is not backed by a valid sign-off. Empty means it is. */
  problems: string[];
  /** Accounted-for edits to files this chunk shares. Information, never a refusal. */
  sharedEdits: SharedEdit[];
}

/** Statuses of a chunk whose build is under way, so its own sign-off is still to come. */
const BEING_BUILT = new Set(['approved', 'built']);

async function readProjectState(dir: string): Promise<ProjectState> {
  return { chunks: await readChunkStates(dir), merges: await readMergeSignoffs(dir) };
}

async function readChunkStates(dir: string): Promise<ChunkState[]> {
  const states: ChunkState[] = [];
  for (const slug of await chunkSlugs(dir)) {
    const text = await fs.readFile(chunkMdPath(dir, slug), 'utf-8').catch(() => undefined);
    if (text === undefined) continue;
    states.push({
      slug,
      text,
      status: readStatus(text) ?? '',
      parsed: parseSignoff(text),
      code: await chunkCodeFiles(dir, text),
    });
  }
  return states;
}

/** The project as the sign-off check reads it: every chunk, and every file a merge vouched for. */
interface ProjectState {
  chunks: ChunkState[];
  merges: MergeSignoff[];
}

/** What accounts for `path` reading `now` in a chunk other than `self`, if anything does. */
function coverFor(path: string, now: string, self: ChunkState, signedAt: number, project: ProjectState): SharedEdit | undefined {
  const others = project.chunks.filter((c) => c.slug !== self.slug);
  const signed = others.find((c) => {
    const record = c.status.startsWith(VERIFIED) ? c.parsed.record : undefined;
    return record !== undefined && new Date(record.when).getTime() > signedAt && record.code[path] === now;
  });
  if (signed) return { path, coveredBy: signed.slug, how: 'signed-off' };
  const merged = project.merges.find(
    (m) => m.path === posix.normalize(path) && m.content === now && new Date(m.when).getTime() > signedAt,
  );
  if (merged) return { path, coveredBy: merged.chunks.join(', '), how: 'merged' };
  const building = others.find((c) => BEING_BUILT.has(c.status) && path in c.code);
  return building ? { path, coveredBy: building.slug, how: 'being-built' } : undefined;
}

function listFiles(paths: string[]): string {
  return paths.join(', ');
}

/** Compares the sign-off's files with the chunk's files now, applying the rule in the header. */
function codeAssessment(self: ChunkState, record: SignoffRecord, project: ProjectState, resign: string): SignoffAssessment {
  const rel = relChunkMdPath(self.slug);
  const problems: string[] = [];
  const signedPaths = Object.keys(record.code);
  const added = Object.keys(self.code).filter((p) => !(p in record.code));
  const removed = signedPaths.filter((p) => !(p in self.code));
  if (added.length || removed.length) {
    const changes = [
      ...(added.length ? [`added ${listFiles(added)}`] : []),
      ...(removed.length ? [`removed ${listFiles(removed)}`] : []),
    ];
    problems.push(
      `${rel}'s sign-off (${record.when}) was for a different chunk: its Build Manifest has since ` +
        `${changes.join(' and ')}. A sign-off applies only to the chunk as it was signed. ${resign}`,
    );
  }

  const signedAt = new Date(record.when).getTime();
  const sharedEdits: SharedEdit[] = [];
  const unaccounted: string[] = [];
  for (const path of signedPaths.filter((p) => p in self.code && self.code[p] !== record.code[p])) {
    const cover = coverFor(path, self.code[path], self, signedAt, project);
    if (cover) sharedEdits.push(cover);
    else unaccounted.push(path);
  }
  if (unaccounted.length) {
    problems.push(
      `${rel}'s sign-off (${record.when}) was for different code: ${listFiles(unaccounted)} ` +
        `changed after it, and no later sign-off or merge saw that change and no chunk being built ` +
        `names the file. A sign-off applies only to the chunk as it was signed. ${resign}`,
    );
  }
  return { problems, sharedEdits };
}

/** The refusal's pointer to the one-time transition, while the project has not recorded it. */
function transitionHint(transitioned: boolean): string {
  if (transitioned) return '';
  return (
    ` If this chunk was verified before BoardSmith recorded sign-offs, the designer records that ` +
    `once for the whole project with \`boardsmith chunk-gate-transition --by "<designer>"\`.`
  );
}

/** Everything wrong with one chunk's sign-off, given every chunk in the project. */
async function assessChunk(dir: string, self: ChunkState, project: ProjectState): Promise<SignoffAssessment> {
  const none: SignoffAssessment = { problems: [], sharedEdits: [] };
  const { slug, status, parsed } = self;
  if (!status.startsWith(VERIFIED)) return none;

  const rel = relChunkMdPath(slug);
  const resign =
    `Set Status back to built, then record the designer's sign-off with ` +
    `\`boardsmith chunk-signoff ${slug} ...\`.`;
  const transitioned = (await readGateTransition(dir)) !== undefined;
  if (parsed.reopened) {
    return {
      ...none,
      problems: [
        `${rel} says "Status: ${status}" but it was reopened on ${parsed.reopened.when} ` +
          `(${parsed.reopened.reason}), which voided its sign-off. Nobody has signed off the ` +
          `reworked chunk. ${resign}`,
      ],
    };
  }
  if (parsed.state === 'whole-file') {
    return {
      ...none,
      problems: [
        `${rel}'s sign-off records one hash over all its files, the form used before a sign-off ` +
          `was tracked file by file, so it cannot tell a later chunk's edit from a change to this ` +
          `chunk. ` +
          (transitioned
            ? resign
            : `Convert it with the one-time \`boardsmith chunk-gate-transition --by "<designer>"\`, ` +
              `which keeps a sign-off whose code still matches it.`),
      ],
    };
  }
  if (!parsed.record) {
    const damaged = parsed.state === 'malformed' ? ' (its "## Sign-off" block is damaged)' : '';
    // A CHUNK.md with no "## Sign-off" section at all was made before #291 scaffolded one; a
    // chunk made since carries the section from its template, so it gets no transition hint.
    const hint = parsed.state === 'absent' ? transitionHint(transitioned) : '';
    return {
      ...none,
      problems: [
        `${rel} says "Status: ${status}" but has no designer sign-off entry${damaged}. A verified ` +
          `status is derived from a sign-off and cannot be set by hand. ${resign}${hint}`,
      ],
    };
  }

  const record = parsed.record;
  const code = codeAssessment(self, record, project, resign);
  const problems = [...signoffProblems(record, await loadContext(dir, slug, self.text)), ...code.problems];
  const expected = derivedStatus(record);
  if (status !== expected) {
    problems.push(
      `${rel} says "Status: ${status}" but its sign-off (basis: ${record.basis}) derives ` +
        `"${expected}". Status is written only by \`boardsmith chunk-signoff\`.`,
    );
  }
  return { problems, sharedEdits: code.sharedEdits };
}

/**
 * Every chunk's sign-off, checked against every other chunk's (a later sign-off or a chunk being
 * built can account for an edit to a shared file). Read-only. `chunk-merge` and
 * `chunk-provenance-status` read the whole project this way.
 */
export async function assessSignoffs(projectDir: string): Promise<Map<string, SignoffAssessment>> {
  const dir = resolve(projectDir);
  const project = await readProjectState(dir);
  const result = new Map<string, SignoffAssessment>();
  for (const chunk of project.chunks) result.set(chunk.slug, await assessChunk(dir, chunk, project));
  return result;
}

/**
 * The check for one chunk. Returns every reason its Status is not backed by a valid sign-off, as
 * sentences a designer can act on; `[]` means it is backed, or that the chunk is not verified.
 * Read-only. `chunk-check` fails on a non-empty result.
 */
export async function checkSignoff(projectDir: string, slug: string): Promise<string[]> {
  const dir = resolve(projectDir);
  const project = await readProjectState(dir);
  const self = project.chunks.find((c) => c.slug === slug);
  if (!self) {
    throw new Error(`No chunk found at ${relChunkMdPath(slug)} in ${dir}.\n${SLUG_REMEDY}`);
  }
  return (await assessChunk(dir, self, project)).problems;
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

function designerRecord(options: SignoffOptions, when: string): SignoffBasis {
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

function automatedRecord(evidence: string, ctx: SignoffContext, when: string): SignoffBasis {
  if (!evidence.trim()) {
    throw new Error('--automated needs the evidence: the test and sim pass that exercised this chunk.');
  }
  if (ctx.needsDesigner instanceof Error) throw ctx.needsDesigner;
  return { basis: 'automated', when, evidence: evidence.trim() };
}

/** Turns the command's flags into the one record they describe, or refuses. */
function recordFromOptions(options: SignoffOptions, ctx: SignoffContext, when: string): SignoffBasis {
  const designerGiven = options.by !== undefined || options.observed !== undefined;
  const given = [designerGiven, options.waiver !== undefined, options.automated !== undefined];
  if (given.filter(Boolean).length !== 1) throw new Error(ONE_BASIS);
  if (designerGiven) return designerRecord(options, when);
  if (options.automated !== undefined) return automatedRecord(options.automated, ctx, when);
  const waiver = ctx.waivers.find((w) => w.id === options.waiver);
  return { basis: 'waiver', waiver: options.waiver!, by: waiver?.grantedBy ?? '', when };
}

/** A chunk's CHUNK.md, or a refusal naming the slug fix when there is none. */
async function readChunkText(dir: string, slug: string): Promise<string> {
  return fs.readFile(chunkMdPath(dir, slug), 'utf-8').catch(() => {
    throw new Error(`No chunk found at ${relChunkMdPath(slug)} in ${dir}.\n${SLUG_REMEDY}`);
  });
}

async function readBuiltChunk(dir: string, slug: string): Promise<string> {
  const rel = relChunkMdPath(slug);
  const chunkText = await readChunkText(dir, slug);
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
  const record: SignoffRecord = {
    ...recordFromOptions(options, ctx, (options.now ?? new Date()).toISOString()),
    code: await chunkCodeFiles(dir, chunkText),
  };

  // #288: a chunk is not done while the project's hard constraints do not hold for it, whoever
  // signs. Only the ledger and the chunk's review are read here; the measurement tests ran at
  // audit (`boardsmith constraint-check <slug>`) and run again in the accumulated suite.
  const constraints = await checkConstraints(dir, { slug });
  // #452: nobody says a chunk is done on a word. HEAD, on a clean tree, must have passed
  // `boardsmith verify` with the chunk's whole change measured: the full suite, typecheck, build,
  // validate and the mutation check of everything since the chunk began.
  const unverified = await verifiedProblem(dir, slug);
  const problems = [...signoffProblems(record, ctx), ...constraints.refusals, ...(unverified ? [unverified] : [])];
  if (problems.length) {
    throw new Error(`${slug} was not signed off:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  const status = derivedStatus(record);
  const sketchPath = designPath(dir, SKETCH_MD);
  const updatedSketch = sketchWithStatus(await readSketch(dir), slug, status);
  const updatedChunk = writeSignoffBlock(chunkText, renderSignoff(record), relChunkMdPath(slug)).replace(
    /^Status:.*$/m,
    `Status: ${status}`,
  );
  await atomicWriteFile(chunkMdPath(dir, slug), updatedChunk);
  await atomicWriteFile(sketchPath, updatedSketch);
  return record;
}

/** A chunk made before this section existed gets it inserted ahead of `## Verified Commit Hash`. */
function insertSignoffSection(chunkText: string, body: string): string {
  const anchor = findHeadingIndex(chunkText, '## Verified Commit Hash');
  const at = anchor === -1 ? chunkText.length : anchor;
  const before = chunkText.slice(0, at).replace(/\n*$/, '\n\n');
  const after = anchor === -1 ? '' : `\n${chunkText.slice(at)}`;
  return before + renderSignoffSection(body) + after;
}

export function writeSignoffBlock(chunkText: string, body: string, rel: string): string {
  if (parseSignoff(chunkText).state === 'absent') return insertSignoffSection(chunkText, body);
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
  return chunkText.slice(0, begin) + body + chunkText.slice(end);
}

interface ReopenOptions {
  project?: string;
  /** Why the chunk goes back for rework. Recorded in the voided sign-off block. */
  reason: string;
  /** Tests only. */
  now?: Date;
}

/**
 * Sends a verified chunk back to built for rework: voids its sign-off (the block keeps only when
 * and why it was reopened), sets Status to built, then mirrors SKETCH.md's pointer. From then on
 * `checkSignoff` refuses a verified Status until `chunk-signoff` records a fresh sign-off.
 */
export async function recordReopen(slug: string, options: ReopenOptions): Promise<void> {
  assertBareName('<slug>', slug, SLUG_REMEDY);
  const dir = resolve(options.project ?? process.cwd());
  const rel = relChunkMdPath(slug);
  const chunkText = await readChunkText(dir, slug);
  const status = readStatus(chunkText) ?? '';
  if (!status.startsWith(VERIFIED)) {
    throw new Error(
      `${rel} is "${status || 'missing a Status line'}", not verified, so there is no sign-off to ` +
        `reopen. Only a verified chunk is reopened.`,
    );
  }
  const reason = (options.reason ?? '').trim();
  if (!reason) throw new Error('--reason is empty. Record why this chunk goes back for rework.');

  const body = renderReopened((options.now ?? new Date()).toISOString(), reason);
  const updatedSketch = sketchWithStatus(await readSketch(dir), slug, 'built');
  const updatedChunk = writeSignoffBlock(chunkText, body, rel).replace(/^Status:.*$/m, 'Status: built');
  await atomicWriteFile(chunkMdPath(dir, slug), updatedChunk);
  await atomicWriteFile(designPath(dir, SKETCH_MD), updatedSketch);
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

/** `boardsmith chunk-reopen <slug>`. Throws (clean one-line message via cli.ts) on refusal. */
export async function chunkReopenCommand(slug: string, options: Omit<ReopenOptions, 'now'>): Promise<void> {
  await recordReopen(slug, options);
  console.log(chalk.green(`✓ ${slug} reopened; its sign-off is void and Status: built`));
}

/** `boardsmith chunk-waiver`. Prints the new waiver's id. */
export async function chunkWaiverCommand(options: Omit<WaiverOptions, 'now'>): Promise<void> {
  const id = await recordWaiver(options);
  console.log(chalk.green(`✓ Waiver ${id} recorded for ${options.chunks}, until ${options.expires}`));
}
