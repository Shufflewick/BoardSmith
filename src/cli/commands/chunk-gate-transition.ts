import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  GATE_TRANSITION_MD,
  chunkMdPath,
  chunkSlugs,
  designPath,
  isDesignArtifact,
  relChunkMdPath,
} from '../lib/project-paths.js';
import {
  type GateTransition,
  type KeptSignoff,
  type TransitionedSignoff,
  readGateTransition,
  renderGateTransition,
} from '../lib/gate-transition.js';
import { extractSection, parseBuildManifest, resolveManifestPath } from './build-manifest.js';
import {
  type SignoffRecord,
  VERIFIED,
  chunkCodeFiles,
  designerNameProblem,
  parseSignoff,
  readStatus,
  renderSignoff,
  writeSignoffBlock,
} from './chunk-signoff.js';
import { parseInterpretationQuotes, unquotedClaims } from './claim-quotes.js';
import { atomicWriteFile } from './verify-run.js';
import { verifiedProblem } from '../lib/verify-result.js';

/**
 * `boardsmith chunk-gate-transition --by <designer>` (#397): the one-time transition for chunks a
 * project verified before the sign-off gate (#291), the per-file sign-off (#396) and the
 * claim-quote gate (#289) existed. Every reader of those gates stays strict and names this command.
 *
 * For each verified chunk it decides, before writing anything:
 *
 *   - a CHUNK.md with no `## Sign-off` section at all was made before #291 scaffolded one: it gets
 *     a `transition` sign-off that keeps its verified Status;
 *   - a sign-off in the pre-#396 form (one hash over all its files) whose code still matches that
 *     hash is kept, basis and all, and rewritten file by file; one whose code has moved gets a
 *     `transition` sign-off, and the ledger names the earlier sign-off;
 *   - for each chunk covered above, every claim in force that has no quote is recorded by number
 *     with a hash of its text, so `claim-quote-check` accepts it while that text is unchanged.
 *     A claim is what `claim-quote-check` reads as one (any `N. ` line, #402). A full-ceremony
 *     chunk in which it finds no claim and no open question has its claims in some other form, and
 *     recording nothing for it would leave every one of them owing a quote once they are
 *     renumbered, so the run refuses before writing anything and names those chunks.
 *
 * A verified chunk whose section was scaffolded empty and never signed was verified by hand under
 * the gate; the transition does not cover it, and it stays refused.
 *
 * It records chunks as done, so it is refused unless the commit checked out, on a clean tree, passed
 * `boardsmith verify` (#452).
 *
 * The decisions go to `design/GATE-TRANSITION.md` first, then to each CHUNK.md. The ledger exists
 * once: a second run only completes chunk writes a crash interrupted, from the ledger, and refuses
 * when there are none. Nothing is written when no chunk needs the transition.
 */

interface GateTransitionOptions {
  project?: string;
  /** The designer recording the transition. */
  by: string;
  /** Tests only. */
  now?: Date;
}

interface GateTransitionResult {
  ledgerPath: string;
  /** Chunks given a `transition` sign-off by this run. */
  transitioned: TransitionedSignoff[];
  /** Whole-file sign-offs this run kept, rewritten file by file. */
  kept: KeptSignoff[];
  /** Claims recorded without a quote, per chunk. Empty on a run that completes an earlier one. */
  claims: Record<string, number[]>;
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The single hash a sign-off recorded before #396, computed the way it was: every manifest path
 * that is not a bare design ledger name, each paired with its content hash, in path order. Used
 * only to recognise whether such a sign-off still matches its code.
 */
async function wholeFileHash(projectDir: string, chunkText: string): Promise<string> {
  const paths = [
    ...new Set(
      parseBuildManifest(chunkText)
        .entries.map((e) => e.path)
        .filter((p) => !isDesignArtifact(p)),
    ),
  ].sort();
  const lines: string[] = [];
  for (const path of paths) {
    const abs = resolveManifestPath(projectDir, path);
    const content = abs === 'escapes' ? undefined : await fs.readFile(abs).catch(() => undefined);
    lines.push(`${path}\t${abs === 'escapes' ? 'outside the project' : content ? sha256(content) : 'missing'}`);
  }
  return sha256(lines.join('\n'));
}

async function readChunk(dir: string, slug: string): Promise<string | undefined> {
  return fs.readFile(chunkMdPath(dir, slug), 'utf-8').catch(() => undefined);
}

/**
 * What the transition decides for one verified chunk: a `transition` sign-off, a kept whole-file
 * sign-off, or nothing (its sign-off is current, or it was verified by hand under the gate).
 */
async function decideChunk(
  dir: string,
  slug: string,
  text: string,
  status: string,
): Promise<TransitionedSignoff | KeptSignoff | undefined> {
  const parsed = parseSignoff(text);
  if (parsed.state === 'absent') {
    return {
      slug,
      status,
      reason: 'verified before sign-offs were recorded: its CHUNK.md has no "## Sign-off" section',
    };
  }
  if (!parsed.wholeFile) return undefined;
  const { basis, hash } = parsed.wholeFile;
  if ((await wholeFileHash(dir, text)) === hash) return { slug, basis: basis.basis };
  return {
    slug,
    status,
    reason:
      `its sign-off of ${basis.when} (basis ${basis.basis}) recorded one hash over all its ` +
      `files, and that code has changed since`,
  };
}

/**
 * The chunk's declared ceremony (`full`, `light` or `final-acceptance`, CHUNK.template.md). Only a
 * full-ceremony chunk has an investigate step, so only it owes claims.
 */
function ceremonyOf(text: string): string | undefined {
  const body = extractSection(text, '## Ceremony')?.replace(/<!--[\s\S]*?-->/g, '');
  return body?.trim().split(/\s+/)[0] || undefined;
}

/** A full-ceremony chunk whose `## Interpretation` holds no claim and no open question. */
function hasNoReadableClaims(text: string): boolean {
  if (ceremonyOf(text) === 'light' || ceremonyOf(text) === 'final-acceptance') return false;
  const parsed = parseInterpretationQuotes(text);
  return parsed === undefined || parsed.claims.length + parsed.questions.length === 0;
}

function unreadableClaimsError(slugs: string[]): Error {
  return new Error(
    `The gate transition records every claim of each chunk it covers, and it found no claim in ` +
      `${slugs.map((s) => `design/${relChunkMdPath(s)}`).join(', ')}. A claim is a line starting ` +
      `with its number (\`1. \`), bold or not. Put each of those chunks' claims in that form, keeping ` +
      `their text, and run the transition again. Nothing was written.`,
  );
}

/** Adds one covered chunk's decision and its unquoted claims to the plan. */
function addToPlan(plan: GateTransition, decided: TransitionedSignoff | KeptSignoff, text: string): void {
  if ('status' in decided) plan.signoffs.push(decided);
  else plan.kept.push(decided);
  const claims = unquotedClaims(text);
  if (Object.keys(claims).length) plan.claims[decided.slug] = claims;
}

/** Decides the transition for every verified chunk. Writes nothing. */
async function planTransition(dir: string, recorded: string, by: string): Promise<GateTransition> {
  const plan: GateTransition = { recorded, by, signoffs: [], kept: [], claims: {} };
  const unreadable: string[] = [];
  for (const slug of await chunkSlugs(dir)) {
    const text = (await readChunk(dir, slug)) ?? '';
    const status = readStatus(text) ?? '';
    const decided = status.startsWith(VERIFIED) ? await decideChunk(dir, slug, text, status) : undefined;
    if (!decided) continue;
    addToPlan(plan, decided, text);
    if (hasNoReadableClaims(text)) unreadable.push(slug);
  }
  if (unreadable.length) throw unreadableClaimsError(unreadable);
  return plan;
}

/** The record one ledger decision writes into a chunk, or `undefined` when it is already there. */
async function recordFor(
  dir: string,
  slug: string,
  text: string,
  ledger: GateTransition,
): Promise<SignoffRecord | undefined> {
  const parsed = parseSignoff(text);
  const entry = ledger.signoffs.find((s) => s.slug === slug);
  const code = await chunkCodeFiles(dir, text);
  if (entry) {
    if (parsed.state !== 'absent' && !parsed.wholeFile) return undefined;
    return { basis: 'transition', by: ledger.by, when: ledger.recorded, status: entry.status, code };
  }
  if (!parsed.wholeFile) return undefined;
  if ((await wholeFileHash(dir, text)) !== parsed.wholeFile.hash) {
    throw new Error(
      `${relChunkMdPath(slug)}'s sign-off was recorded in design/${GATE_TRANSITION_MD} as kept, but ` +
        `its code no longer matches it. Set Status back to built and sign it off again with ` +
        `\`boardsmith chunk-signoff ${slug} ...\`.`,
    );
  }
  return { ...parsed.wholeFile.basis, code };
}

/** Writes each chunk the ledger decides and that does not yet carry it. Returns what it wrote. */
async function applyTransition(
  dir: string,
  ledger: GateTransition,
): Promise<{ transitioned: TransitionedSignoff[]; kept: KeptSignoff[] }> {
  const written = { transitioned: [] as TransitionedSignoff[], kept: [] as KeptSignoff[] };
  for (const decided of [...ledger.signoffs, ...ledger.kept]) {
    const text = await readChunk(dir, decided.slug);
    if (text === undefined) continue;
    const record = await recordFor(dir, decided.slug, text, ledger);
    if (!record) continue;
    const updated = writeSignoffBlock(text, renderSignoff(record), relChunkMdPath(decided.slug));
    await atomicWriteFile(chunkMdPath(dir, decided.slug), updated);
    if ('status' in decided) written.transitioned.push(decided);
    else written.kept.push(decided);
  }
  return written;
}

/** A second run: completes the chunk writes the recorded ledger decides, or refuses. */
async function completeTransition(dir: string, existing: GateTransition): Promise<Omit<GateTransitionResult, 'ledgerPath'>> {
  const completed = await applyTransition(dir, existing);
  if (!completed.transitioned.length && !completed.kept.length) {
    throw new Error(
      `The gate transition was already recorded on ${existing.recorded} by ${existing.by} ` +
        `(design/${GATE_TRANSITION_MD}); it runs once per project. A chunk verified since is ` +
        `signed off with \`boardsmith chunk-signoff <slug> ...\`.`,
    );
  }
  return { ...completed, claims: {} };
}

export async function recordGateTransition(options: GateTransitionOptions): Promise<GateTransitionResult> {
  const dir = resolve(options.project ?? process.cwd());
  const nameProblem = designerNameProblem(options.by ?? '', '--by');
  if (nameProblem) throw new Error(nameProblem);
  const ledgerPath = designPath(dir, GATE_TRANSITION_MD);

  const existing = await readGateTransition(dir);
  if (existing) return { ledgerPath, ...(await completeTransition(dir, existing)) };

  // #452: the transition records chunks as done, so the project as it stands must have passed
  // `boardsmith verify`. A run completing an interrupted one (above) already passed this.
  const unverified = await verifiedProblem(dir);
  if (unverified) throw new Error(`The gate transition was not recorded: ${unverified}`);

  const plan = await planTransition(dir, (options.now ?? new Date()).toISOString(), options.by.trim());
  if (!plan.signoffs.length && !plan.kept.length) {
    return { ledgerPath, transitioned: [], kept: [], claims: {} };
  }
  await atomicWriteFile(ledgerPath, renderGateTransition(plan));
  const claims = Object.fromEntries(
    Object.entries(plan.claims).map(([slug, recorded]) => [slug, Object.keys(recorded).map(Number)]),
  );
  return { ledgerPath, ...(await applyTransition(dir, plan)), claims };
}

/** `boardsmith chunk-gate-transition`. Throws (clean one-line message via cli.ts) on refusal. */
export async function chunkGateTransitionCommand(options: {
  project?: string;
  by: string;
  json?: boolean;
}): Promise<void> {
  const result = await recordGateTransition(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const claimCount = Object.values(result.claims).reduce((n, c) => n + c.length, 0);
  if (!result.transitioned.length && !result.kept.length) {
    console.log(
      chalk.green('✓ No chunk needs the gate transition: every verified chunk has a current sign-off. Nothing was written.'),
    );
    return;
  }
  console.log(chalk.green(`✓ Gate transition recorded in design/${GATE_TRANSITION_MD}`));
  if (result.transitioned.length) {
    console.log(`  Transition sign-offs (${result.transitioned.length}): ${result.transitioned.map((t) => t.slug).join(', ')}`);
  }
  if (result.kept.length) {
    console.log(`  Sign-offs kept, now recorded file by file (${result.kept.length}): ${result.kept.map((k) => k.slug).join(', ')}`);
  }
  if (claimCount) {
    console.log(
      `  Claims recorded without a quote: ${claimCount} in ${Object.keys(result.claims).length} chunk(s). ` +
        `A claim added or changed from now on needs its quote.`,
    );
  }
}
