import { promises as fs } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { findHeadingIndex, parseRulings } from './build-manifest.js';
import {
  VERIFIED_AGAINST_HEADING,
  VERIFIED_AGAINST_END,
  chunkProvenanceStatusCommand,
} from './chunk-provenance.js';
import { RULE_DELTA_KINDS, type RuleDelta, type ChunkVerdict, verifyClassifyStatusCommand } from './verify-classify.js';
import { driftCheckCommand, type ChunkDrift } from './drift-check.js';
import {
  atomicWriteFile,
  appendLedgerLine,
  ledgerFilePath,
  readLedgerOrThrow,
  parseLedgerBody,
  resolveLedgerState,
  type ClassificationRecord,
  type AdjudicationRecord,
  type ImpactRecord,
} from './verify-run.js';

/**
 * `verify-impact.ts` — Phase 175's impact-map / repair-gating surface: VERIFY-05's
 * rules-staleness marker.
 *
 * ORTHOGONAL TO THE STATUS ENUM (175-CONTEXT.md decision 1). A chunk's `Status:` line
 * (`proposed` | `approved` | `built` | `verified` | `verified (user-waived)`, plus the
 * unrelated `stale — re-derive before build` insert-chunk marker) is left completely alone by
 * everything in this file. Rules-staleness is a SECOND, INDEPENDENT axis: a `verified` chunk
 * stays `verified` — a human really did playtest it — even while its rules basis has moved
 * underneath it. Folding the two together would multiply the enum combinatorially and is
 * exactly what this file exists to avoid. If a future change to this module ever needs to touch
 * `state-machine.md`'s Status Enum, `CHUNK.template.md`/`SKETCH.template.md`'s Status line, or
 * their pinning tests, that is a signal that orthogonality broke somewhere upstream — not
 * expected work (175-CONTEXT.md decision 18).
 *
 * NEVER RE-DERIVES STALENESS. Phase 174's `deriveStale` (`verify-classify.ts`) is the only
 * authority for whether a classification renders a chunk stale; this file only renders, parses,
 * and (plan Task 2) writes the marker a caller already decided to set. `deriveStale` is
 * deliberately single-argument so provenance can never leak into that decision — this module
 * does not change that.
 *
 * DO NOT CONFLATE with the existing `stale — re-derive before build` marker (`/bs-insert-chunk`,
 * `state-machine.md` "Status Enum"): that marker means "a PENDING chunk's CHUNK.md was
 * invalidated by a sketch change — never built." The rules-staleness marker here means the
 * opposite situation: an already-built, already-playtested chunk whose rulebook basis has since
 * moved. Both remain independently recognizable — see `RULES_STALE_MARKER`'s doc comment below.
 */

// -------------------------------------------------------------------------------------------
// The marker's own machine-owned fenced section (175-CONTEXT.md decisions 2, 18) — the shape
// copied from `chunk-provenance.ts`'s `## Verified Against` (the ONLY existing precedent for a
// second machine-owned fenced field alongside `Status:`).
// -------------------------------------------------------------------------------------------

/** The heading text. A new sibling of `## Verified Against` in the CHUNK.md template. */
export const RULES_STALENESS_HEADING = '## Rules Staleness';

/**
 * Fences delimiting the machine-owned body of `## Rules Staleness`. A DISTINCT fence pair from
 * `VERIFIED_AGAINST_BEGIN`/`END` (same discipline as `VERIFIED_AGAINST_BEGIN`/`GAPS_BEGIN` being
 * distinct in `chunk-provenance.ts`) — two unrelated machine-owned sections sharing one fence
 * pair is a data-corruption risk, not a convenience.
 */
export const RULES_STALENESS_BEGIN = '<!-- boardsmith:rules-staleness:begin -->';
export const RULES_STALENESS_END = '<!-- boardsmith:rules-staleness:end -->';

/**
 * The placeholder body a freshly scaffolded CHUNK.md carries before this chunk has ever been
 * flagged rules-stale — matching `VERIFIED_AGAINST_EMPTY`'s role for `## Verified Against`.
 */
export const RULES_STALENESS_EMPTY = '_Not rules-stale._';

/**
 * The two values this marker can carry — frozen array + derived type, never a hand-written
 * union (the established enumerated-set pattern: `FINDING_KINDS`, `RULE_DELTA_KINDS`,
 * `PROVENANCE_KINDS`).
 *
 * `RULES_STALE_MARKER`'s em-dash is U+2014, matching the existing `stale — re-derive before
 * build` marker's em-dash convention (`state-machine.md`) — but the two strings are otherwise
 * unmistakably distinct: "never built" vs. "built against rules that have since moved."
 */
export const RULES_STALENESS_VALUES = Object.freeze([
  'clear',
  'rules-stale — rulebook moved since this chunk was verified',
] as const);

export type RulesStalenessValue = (typeof RULES_STALENESS_VALUES)[number];

export const RULES_STALENESS_CLEAR = RULES_STALENESS_VALUES[0];
export const RULES_STALE_MARKER = RULES_STALENESS_VALUES[1];

/**
 * The exact parsed label strings this block renders, in the order they are rendered. `Marker:`
 * is deliberately LAST — mirroring `state-machine.md` "Write Order"'s rule that the
 * status-analogous field is written last, so a crash mid-write never leaves a half-written
 * marker looking valid (this ordering is what plan Task 2's writer relies on). A simple append
 * pattern for future extension: destructured positionally below, never restructured.
 */
export const RULES_STALENESS_LABELS = Object.freeze([
  'Run:',
  'Rule delta:',
  'Attributed slices:',
  'Prior reading:',
  'Changed reading:',
  'Adjudication:',
  'Marker:',
] as const);

const [
  LABEL_RUN,
  LABEL_RULE_DELTA,
  LABEL_ATTRIBUTED,
  LABEL_PRIOR,
  LABEL_CHANGED,
  LABEL_ADJUDICATION,
  LABEL_MARKER,
] = RULES_STALENESS_LABELS;

/** The exact grammar SKETCH.md's derived pointer line uses, per chunk slug. */
export const SKETCH_RULES_STALENESS_GRAMMAR = 'Rules Staleness (derived from chunks/<slug>/CHUNK.md):';

export interface RulesStalenessRecord {
  marker: RulesStalenessValue;
  /** The verify run that set (or last touched) this marker. */
  runId: string;
  ruleDelta: RuleDelta;
  /** Phase 174's per-chunk attribution ladder output — the specific slices attributed here. */
  attributedSlices: string[];
  /** Verbatim quote of the reading BEFORE the change. Omitted (not rendered) when absent. */
  priorReading?: string;
  /** Verbatim quote of the reading AFTER the change. Omitted (not rendered) when absent. */
  changedReading?: string;
  adjudication: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pure — returns only the body that lives BETWEEN the fences, mirroring
 * `renderVerifiedAgainst`'s shape exactly. `Attributed slices:` renders as a `| slice |`
 * markdown table when non-empty and as `RULES_STALENESS_EMPTY` when empty (mirroring
 * `renderVerifiedAgainst`'s `Cited slices:` handling). `Prior reading:`/`Changed reading:` are
 * rendered verbatim and OMITTED when absent (mirroring how `renderVerifiedAgainst` omits
 * `Reason:` on `full` scope).
 */
export function renderRulesStaleness(record: RulesStalenessRecord): string {
  const lines: string[] = [];
  lines.push(`${LABEL_RUN} ${record.runId}`);
  lines.push(`${LABEL_RULE_DELTA} ${record.ruleDelta}`);
  lines.push('');
  lines.push(LABEL_ATTRIBUTED);
  lines.push('');
  if (record.attributedSlices.length) {
    lines.push('| slice |');
    lines.push('|---|');
    for (const s of record.attributedSlices) lines.push(`| ${s} |`);
  } else {
    lines.push(RULES_STALENESS_EMPTY);
  }
  if (record.priorReading !== undefined) {
    lines.push('');
    lines.push(`${LABEL_PRIOR} ${record.priorReading}`);
  }
  if (record.changedReading !== undefined) {
    lines.push('');
    lines.push(`${LABEL_CHANGED} ${record.changedReading}`);
  }
  lines.push('');
  lines.push(`${LABEL_ADJUDICATION} ${record.adjudication}`);
  lines.push('');
  lines.push(`${LABEL_MARKER} ${record.marker}`);
  return `\n${lines.join('\n')}\n`;
}

/**
 * Heading + a machine-owned explanatory comment (`renderVerifiedAgainstSection`'s voice) + the
 * two fences. Naming `boardsmith verify-impact-apply` as the sole writer.
 */
export function renderRulesStalenessSection(record: RulesStalenessRecord): string {
  return `${RULES_STALENESS_HEADING}

<!-- MACHINE-OWNED. Do not write between the fences below, and do not move or delete them.

     \`boardsmith verify-impact-apply\` computes this block: which run flagged this chunk stale,
     the classified rule delta, the specific rulebook slices attributed to this chunk (Phase
     174's quoted-fragment/cited-page attribution ladder), the prior/changed readings verbatim,
     the adjudication outcome, and the Marker itself. Anything you write here is overwritten on
     the next run.

     This marker is ORTHOGONAL to the Status: line above (175-CONTEXT.md decision 1) — a
     \`verified\` chunk stays \`verified\`; a human really did playtest it. That its rules basis
     has since moved is a second, independent axis, tracked here and nowhere else. It is fenced
     for the same reason \`## Verified Against\` is (see that section's own comment): a
     hand-authored machine-owned block is indistinguishable from a correct one by reading it, so
     it is made structurally impossible instead. -->

${RULES_STALENESS_BEGIN}${renderRulesStaleness(record)}${RULES_STALENESS_END}
`;
}

export interface ParsedRulesStaleness {
  state: 'clear' | 'rules-stale' | 'unknown';
  /** Only present when `state` is `clear` or `rules-stale` — a partial parse is never valid. */
  record?: RulesStalenessRecord;
}

/**
 * Pure. Parses a chunk's full CHUNK.md text for its `## Rules Staleness` block, using ONLY the
 * exported `RULES_STALENESS_*` constants — never a second hand-copied label string.
 *
 * Strict by design: a missing heading, a missing fence, the not-yet-recorded sentinel body, an
 * unrecognized `Marker:` value, or a missing required label all yield `state: 'unknown'` with no
 * `record` — a PARTIALLY parsed block is never returned as valid.
 *
 * Line-anchored heading location via `findHeadingIndex` (`./build-manifest.js`), never a bare
 * `indexOf` — the `f73153a3` defect class this guards against: a prose mention of
 * `## Rules Staleness` inside `CHUNK.template.md`'s PARSE CONTRACT comment must NOT be mistaken
 * for the real section.
 */
export function parseRulesStaleness(chunkText: string): ParsedRulesStaleness {
  const headingIdx = findHeadingIndex(chunkText, RULES_STALENESS_HEADING);
  if (headingIdx === -1) return { state: 'unknown' };

  const beginIdx = chunkText.indexOf(RULES_STALENESS_BEGIN, headingIdx);
  const endIdx = chunkText.indexOf(RULES_STALENESS_END, headingIdx);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return { state: 'unknown' };

  const body = chunkText.slice(beginIdx + RULES_STALENESS_BEGIN.length, endIdx).trim();
  if (body === RULES_STALENESS_EMPTY) return { state: 'unknown' };

  const readLabel = (label: string): string | undefined => {
    const match = new RegExp(`^${escapeRegExp(label)}\\s*(.*)$`, 'm').exec(body);
    return match ? match[1].trim() : undefined;
  };

  const runId = readLabel(LABEL_RUN);
  const ruleDeltaRaw = readLabel(LABEL_RULE_DELTA);
  const adjudication = readLabel(LABEL_ADJUDICATION);
  const markerRaw = readLabel(LABEL_MARKER);
  const priorReading = readLabel(LABEL_PRIOR);
  const changedReading = readLabel(LABEL_CHANGED);

  if (
    !runId ||
    !ruleDeltaRaw ||
    !(RULE_DELTA_KINDS as readonly string[]).includes(ruleDeltaRaw) ||
    !adjudication ||
    !markerRaw ||
    !(RULES_STALENESS_VALUES as readonly string[]).includes(markerRaw) ||
    !body.includes(LABEL_ATTRIBUTED)
  ) {
    return { state: 'unknown' };
  }

  const followingAlternation = [LABEL_PRIOR, LABEL_CHANGED, LABEL_ADJUDICATION]
    .map(escapeRegExp)
    .join('|');
  const attributedMatch = new RegExp(
    `${escapeRegExp(LABEL_ATTRIBUTED)}\\s*\\n\\n([\\s\\S]*?)(?:\\n\\n(?:${followingAlternation})|$)`,
  ).exec(body);
  const attributedSlices: string[] = [];
  if (attributedMatch) {
    for (const row of attributedMatch[1].matchAll(/^\|\s*([^\s|]+)\s*\|/gm)) {
      const value = row[1];
      if (value === 'slice' || /^-+$/.test(value)) continue; // header row / separator row
      attributedSlices.push(value);
    }
  }

  const record: RulesStalenessRecord = {
    marker: markerRaw as RulesStalenessValue,
    runId,
    ruleDelta: ruleDeltaRaw as RuleDelta,
    attributedSlices,
    priorReading,
    changedReading,
    adjudication,
  };

  return { state: markerRaw === RULES_STALENESS_CLEAR ? 'clear' : 'rules-stale', record };
}

// -------------------------------------------------------------------------------------------
// The CHUNK-first / SKETCH-second marker writer (175-CONTEXT.md decisions 3, 4, 5, 18)
// -------------------------------------------------------------------------------------------

function findSketchEntryRange(
  sketchText: string,
  slug: string,
): { start: number; end: number } | undefined {
  const headingIdx = findHeadingIndex(sketchText, `### ${slug}`);
  if (headingIdx === -1) return undefined;

  const headingLineEnd = sketchText.indexOf('\n', headingIdx);
  const bodyStart = headingLineEnd === -1 ? sketchText.length : headingLineEnd + 1;
  const rest = sketchText.slice(bodyStart);
  const nextMatch = /^### /m.exec(rest);
  const end = nextMatch ? bodyStart + nextMatch.index : sketchText.length;
  return { start: headingIdx, end };
}

/**
 * `boardsmith verify-impact-apply <slug>`'s core write path — the marker writer.
 *
 * `input` deliberately EXCLUDES `marker` (`Omit<RulesStalenessRecord, 'marker'>`): this function
 * always writes `RULES_STALE_MARKER`, structurally. There is no parameter, flag, or code path by
 * which it can write `RULES_STALENESS_CLEAR` (175-CONTEXT.md decision 4 — only a successful
 * Phase 176 repair close clears the marker, and there is no manual clear path).
 *
 * Sequence, citing `state-machine.md` "Write Order" / "Authority" rather than restating them:
 * CHUNK.md is read, its `## Rules Staleness` section located by line (Task 1's parser helpers);
 * a section present but missing a fence THROWS the fence-refusal error below and touches
 * nothing; a section entirely absent is inserted immediately after `## Verified Against` (its
 * documented end-of-file position); persisted with `atomicWriteFile` (`verify-run.ts`) — never a
 * bare `fs.writeFile`. `Marker:` is the LAST line inside the fenced body (see
 * `RULES_STALENESS_LABELS`'s doc comment).
 *
 * Only AFTER the CHUNK.md write lands does SKETCH.md's derived pointer get written/repaired —
 * CHUNK.md wins on contradiction and is never repaired to match SKETCH.md (the TMPL-03 rule). A
 * sketch-level tail entry (no `chunks/<slug>/` directory, so no `### <slug>` detailed entry) has
 * no CHUNK.md to derive from and is skipped and reported, never written.
 */
export async function writeRulesStalenessMarker(
  projectDir: string,
  input: Omit<RulesStalenessRecord, 'marker'> & { slug: string },
): Promise<{ chunkWritten: boolean; sketchWritten: boolean; sketchRepaired: boolean }> {
  const { slug, ...rest } = input;
  const record: RulesStalenessRecord = { ...rest, marker: RULES_STALE_MARKER };

  const dir = resolve(projectDir);
  const chunkPath = join(dir, 'chunks', slug, 'CHUNK.md');
  const relChunkPath = join('chunks', slug, 'CHUNK.md');

  const chunkText = await fs.readFile(chunkPath, 'utf-8');
  const headingIdx = findHeadingIndex(chunkText, RULES_STALENESS_HEADING);
  const newBody = renderRulesStaleness(record);

  let updatedChunk: string;
  let chunkChanged: boolean;

  if (headingIdx === -1) {
    // Insert immediately after "## Verified Against" — its documented end-of-file position.
    const vaHeadingIdx = findHeadingIndex(chunkText, VERIFIED_AGAINST_HEADING);
    const vaEndIdx =
      vaHeadingIdx === -1 ? -1 : chunkText.indexOf(VERIFIED_AGAINST_END, vaHeadingIdx);
    const insertAt = vaEndIdx === -1 ? chunkText.length : vaEndIdx + VERIFIED_AGAINST_END.length;
    const before = chunkText.slice(0, insertAt);
    const after = chunkText.slice(insertAt);
    const separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    updatedChunk = before + separator + renderRulesStalenessSection(record) + after;
    chunkChanged = true;
  } else {
    const beginIdx = chunkText.indexOf(RULES_STALENESS_BEGIN, headingIdx);
    const endIdx = chunkText.indexOf(RULES_STALENESS_END, headingIdx);
    if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
      throw new Error(
        `${relChunkPath}'s "${RULES_STALENESS_HEADING}" section is missing its machine-owned fences.\n` +
          `Expected ${RULES_STALENESS_BEGIN} ... ${RULES_STALENESS_END}.\n` +
          `This section is written by \`boardsmith verify-impact-apply\`, never by hand. Restore it\n` +
          `by deleting the entire "${RULES_STALENESS_HEADING}" section from ${relChunkPath},\n` +
          `then re-run \`boardsmith verify-impact-apply ${slug}\`.`,
      );
    }
    const previousBody = chunkText.slice(beginIdx + RULES_STALENESS_BEGIN.length, endIdx);
    chunkChanged = previousBody !== newBody;
    updatedChunk =
      chunkText.slice(0, beginIdx + RULES_STALENESS_BEGIN.length) + newBody + chunkText.slice(endIdx);
  }

  if (chunkChanged) {
    await atomicWriteFile(chunkPath, updatedChunk);
  }

  // CHUNK.md first, SKETCH.md second — never the reverse, never SKETCH.md alone
  // (state-machine.md "Write Order"). Everything above this line must have already landed on
  // disk before SKETCH.md is even read.
  const sketchPath = join(dir, 'SKETCH.md');
  const sketchText = await fs.readFile(sketchPath, 'utf-8');

  const entryRange = findSketchEntryRange(sketchText, slug);
  if (!entryRange) {
    console.warn(
      `${slug} has no detailed SKETCH.md entry (sketch-level tail entry) — rules-staleness ` +
        `pointer skipped; there is no chunks/${slug}/ directory to derive it from yet.`,
    );
    return { chunkWritten: chunkChanged, sketchWritten: false, sketchRepaired: false };
  }

  const entryText = sketchText.slice(entryRange.start, entryRange.end);
  const pointerLine = `- Rules Staleness (derived from chunks/${slug}/CHUNK.md): ${record.marker}`;
  const pointerRegex = new RegExp(
    `^- Rules Staleness \\(derived from chunks/${escapeRegExp(slug)}/CHUNK\\.md\\):.*$`,
    'm',
  );
  const existingMatch = pointerRegex.exec(entryText);

  let updatedSketch = sketchText;
  let sketchWritten = false;
  let sketchRepaired = false;

  if (existingMatch) {
    if (existingMatch[0] !== pointerLine) {
      sketchRepaired = true;
      sketchWritten = true;
      const matchStart = entryRange.start + existingMatch.index;
      const matchEnd = matchStart + existingMatch[0].length;
      updatedSketch = sketchText.slice(0, matchStart) + pointerLine + sketchText.slice(matchEnd);
    }
  } else {
    const statusRegex = new RegExp(
      `^- Status \\(derived from chunks/${escapeRegExp(slug)}/CHUNK\\.md\\):.*$`,
      'm',
    );
    const statusMatch = statusRegex.exec(entryText);
    if (!statusMatch) {
      throw new Error(
        `SKETCH.md's "### ${slug}" entry has no "- Status (derived from ...)" line to insert the\n` +
          `rules-staleness pointer after — this entry does not match SKETCH.template.md's shape.`,
      );
    }
    const statusLineEnd = entryRange.start + statusMatch.index + statusMatch[0].length;
    const hasNewline = sketchText[statusLineEnd] === '\n';
    updatedSketch =
      sketchText.slice(0, statusLineEnd) +
      (hasNewline ? '\n' : '\n') +
      pointerLine +
      sketchText.slice(hasNewline ? statusLineEnd + 1 : statusLineEnd);
    sketchWritten = true;
  }

  if (sketchWritten) {
    await atomicWriteFile(sketchPath, updatedSketch);
  }

  return { chunkWritten: chunkChanged, sketchWritten, sketchRepaired };
}

// -------------------------------------------------------------------------------------------
// VERIFY-04's gate: contradiction collection, both-readings formatting, and the RULINGS.md
// append / UNADJUDICATED record (175-CONTEXT.md decisions 6, 7, 8, 9, 14, 15)
//
// NO BYPASS ANYWHERE IN THIS SECTION (decision 9). VERIFY-04 says a contradictory classification
// ALWAYS stops and asks; the pit-of-success reading of "always" is that no representable option
// skips it — no `force`/`skip`/`yes`/`assumeResolved`/`autoAdjudicate` flag, and no
// `process.env` read anywhere in this module. `verifyImpactAdjudicateCommand`'s `outcome:
// 'resolved'` path REQUIRES the human's own `decision`/`citation`/`rationale` prose — there is no
// code path that marks a contradiction resolved without it, exactly as `build/ask.md`'s
// Gate-Before-Write never writes a durable record before an explicit yes.
// -------------------------------------------------------------------------------------------

/**
 * The placeholder rendered for a missing verbatim reading — a contradictory classification
 * record missing `quotedPass1`/`quotedPass2` is still surfaced (decision 6/14 — "always stops the
 * pass"), never dropped, and never silently synthesized into a fabricated quote.
 */
const NO_VERBATIM_READING = '(no verbatim reading recorded)';

/**
 * One collected contradiction — one entry per PAIR (finding), never per affected chunk
 * (175-CONTEXT.md decision 14). `adjudication` mirrors the recorded `AdjudicationRecord.outcome`
 * for this pair, or `'pending'` when no adjudication has been recorded yet. `rulingNumber` is
 * present only when `adjudication === 'resolved'`.
 */
export interface Contradiction {
  pairId: string;
  liveSlices: string[];
  stagedSlices: string[];
  provenance: string;
  quotedPass1: string;
  quotedPass2: string;
  evidence: string;
  affectedSlugs: string[];
  adjudication: 'pending' | 'resolved' | 'UNADJUDICATED';
  rulingNumber?: number;
}

/**
 * Pure. Selects every `ClassificationRecord` whose `ruleDelta === 'contradictory'` and joins each
 * to its recorded `AdjudicationRecord` (if any) by `pairId`.
 *
 * ONE ENTRY PER FINDING, NEVER PER CHUNK (decision 14): Phase 174 measured a single finding
 * touching 6+ chunks (`174-PROOF.md` §8) — per-chunk prompting would ask the same question six
 * times and train the designer to click through it. `affectedSlugs` instead carries every chunk
 * this one finding touches, derived from `chunkVerdicts` by membership of `pairId` in
 * `ChunkVerdict.pairIds`.
 *
 * A pair whose recorded adjudication `outcome` is `'resolved'` is marked `adjudication:
 * 'resolved'` (excluded from the PENDING set a caller derives from the result — see
 * `verifyImpactGateCommand`'s `pending`). A pair whose recorded outcome is `'UNADJUDICATED'`
 * stays `adjudication: 'UNADJUDICATED'` and remains pending — a deferral is not a resolution and
 * does not close the gate on a later run (decision 8). A pair with no recorded adjudication at
 * all is `'pending'`.
 *
 * A contradictory record missing `quotedPass1` or `quotedPass2` is still returned, with the
 * missing side rendered as `NO_VERBATIM_READING` — never dropped, never silently synthesized.
 */
export function collectContradictions(input: {
  classifications: ClassificationRecord[];
  adjudications: AdjudicationRecord[];
  chunkVerdicts: ChunkVerdict[];
}): Contradiction[] {
  const adjudicationByPairId = new Map(input.adjudications.map((a) => [a.pairId, a] as const));

  return input.classifications
    .filter((c) => c.ruleDelta === 'contradictory')
    .map((c): Contradiction => {
      const adjudicationRecord = adjudicationByPairId.get(c.pairId);
      const affectedSlugs = input.chunkVerdicts
        .filter((v) => v.pairIds.includes(c.pairId))
        .map((v) => v.slug);

      let adjudication: Contradiction['adjudication'] = 'pending';
      let rulingNumber: number | undefined;
      if (adjudicationRecord?.outcome === 'resolved') {
        adjudication = 'resolved';
        rulingNumber = adjudicationRecord.rulingNumber;
      } else if (adjudicationRecord?.outcome === 'UNADJUDICATED') {
        adjudication = 'UNADJUDICATED';
      }

      return {
        pairId: c.pairId,
        liveSlices: c.liveSlices,
        stagedSlices: c.stagedSlices,
        provenance: c.provenance,
        quotedPass1: c.quotedPass1 ?? NO_VERBATIM_READING,
        quotedPass2: c.quotedPass2 ?? NO_VERBATIM_READING,
        evidence: c.evidence,
        affectedSlugs,
        adjudication,
        ...(rulingNumber !== undefined ? { rulingNumber } : {}),
      };
    });
}

/**
 * Pure. Formats one contradiction's both-readings block: pair id, provenance, each verbatim
 * reading under its own distinct label, then every affected chunk slug — UNCAPPED, no ellipsis,
 * no "and N more" (decision 15 — report VOLUME must never be suppressed).
 */
export function formatBothReadings(c: Contradiction): string {
  const lines: string[] = [];
  lines.push(`Pair ${c.pairId} (provenance: ${c.provenance})`);
  lines.push('');
  lines.push('Reading as built (pass 1):');
  lines.push(`  "${c.quotedPass1}"`);
  lines.push('');
  lines.push('Reading in the fresh transcription (pass 2):');
  lines.push(`  "${c.quotedPass2}"`);
  lines.push('');
  lines.push(`Affected chunks (${c.affectedSlugs.length}):`);
  if (c.affectedSlugs.length > 0) {
    for (const slug of c.affectedSlugs) lines.push(`  - ${slug}`);
  } else {
    lines.push('  (none recorded)');
  }
  return lines.join('\n');
}

export interface VerifyImpactGateResult {
  runId: string;
  contradictions: Contradiction[];
  pending: string[];
  summary: { contradictory: number; pending: number; resolved: number; unadjudicated: number };
  warnings: string[];
}

/**
 * `boardsmith verify-impact-gate` — VERIFY-04's read side: collects every un-adjudicated
 * `contradictory` verdict in a run and formats both readings side by side.
 *
 * Read-only. Reads the run's classifications and adjudications through the SAME ledger authority
 * every other command in this milestone shares (`readLedgerOrThrow` / `parseLedgerBody` /
 * `resolveLedgerState` — `verify-run.ts`) and gets `chunkVerdicts` from
 * `verifyClassifyStatusCommand` (`verify-classify.ts`) — never re-derives staleness or
 * re-classifies a pair.
 *
 * NEVER SETS `process.exitCode`. A pending contradiction is a finding, not a tool failure — exit
 * 0 always (172-CONTEXT.md decision 6). Throws only for a structural tool failure (unknown run,
 * no `rulebook/`), matching `drift-check.ts`'s convention, never from the normal report path.
 *
 * The options object has EXACTLY `project`, `runId`, and `json` — no `force`/`skip`/`yes`/
 * `assumeResolved`/`bypass`/`autoAdjudicate` option exists here or anywhere else in this module,
 * and no `process.env` is read anywhere in it (decision 9 — no representable bypass).
 */
export async function verifyImpactGateCommand(
  options: { project?: string; runId?: string; json?: boolean } = {},
): Promise<VerifyImpactGateResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  // `verifyClassifyStatusCommand` is the single existing authority for both the resolved runId
  // (most-recent-run resolution) and the per-chunk verdict roll-up — never re-derived here.
  const classifyStatus = await verifyClassifyStatusCommand({
    project: projectDir,
    runId: options.runId,
    // json: false — this is an internal composition call. verifyClassifyStatusCommand's own
    // json:true path prints its OWN JSON.stringify(result) to stdout as a side effect
    // (verify-classify.ts's convention), independent of whatever this caller's own --json
    // handling does below. Passing json:true here would print a second, unrelated top-level
    // JSON object ahead of this command's own result on every invocation (found live while
    // producing 175-PROOF.md's real verify-impact-gate --json output: stdout contained two
    // concatenated JSON objects instead of one, breaking a real caller's JSON.parse(stdout)).
    json: false,
  });
  const runId = classifyStatus.runId;

  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);
  const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { adjudications } = resolveLedgerState(lines);

  const contradictions = collectContradictions({
    classifications: classifyStatus.classified,
    adjudications,
    chunkVerdicts: classifyStatus.chunkVerdicts,
  });

  const pending = contradictions.filter((c) => c.adjudication !== 'resolved').map((c) => c.pairId);
  const summary = {
    contradictory: contradictions.length,
    pending: pending.length,
    resolved: contradictions.filter((c) => c.adjudication === 'resolved').length,
    unadjudicated: contradictions.filter((c) => c.adjudication === 'UNADJUDICATED').length,
  };

  const result: VerifyImpactGateResult = {
    runId,
    contradictions,
    pending,
    summary,
    warnings: classifyStatus.warnings,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (contradictions.length === 0) {
    console.log(chalk.green(`✓ No contradictory findings pending adjudication — run ${runId}`));
    return result;
  }

  console.log(
    chalk.yellow(
      `⚠ ${pending.length} of ${contradictions.length} contradictory finding(s) pending adjudication — run ${runId}`,
    ),
  );
  for (const c of contradictions) {
    console.log('');
    console.log(formatBothReadings(c));
  }
  return result;
}

// -------------------------------------------------------------------------------------------
// The RULINGS.md append and the UNADJUDICATED record — decision 6/14's gate's write side
// (175-CONTEXT.md decisions 7, 8, 9)
// -------------------------------------------------------------------------------------------

/** `RULINGS.md`'s real, human-authored `### Ruling N` entry's three field labels, in order. */
const RULING_LABELS = Object.freeze([
  '- Decision:',
  '- Citation interpreted or overridden:',
  '- Rationale:',
] as const);

/**
 * `nextRulingNumber` is implemented on top of `parseRulings` (`build-manifest.ts`) — the ONE
 * existing `### Ruling (\d+)` matching authority. Two different `### Ruling (\d+)` regexes
 * existing simultaneously is the defect this import exists to prevent (Pitfall 2,
 * 175-RESEARCH.md): a second, subtly-different regex could disagree with `parseRulings` about
 * which number is highest, silently mis-numbering a new entry or colliding with an existing one.
 */
export function nextRulingNumber(rulingsText: string): number {
  const parsed = parseRulings(rulingsText);
  if (parsed.length === 0) return 1;
  return Math.max(...parsed.map((r) => r.number)) + 1;
}

/**
 * Pure. Renders one `### Ruling N` block using EXACTLY the three field labels this corpus already
 * uses (`- Decision:` / `- Citation interpreted or overridden:` / `- Rationale:`) — never a
 * structured supersession field, never a `supersedes`/`superseded by` construction. Research
 * measured that only ~3 of 62 real rulings across both reference games use a supersede verb at
 * all, and one of those is direction-reversed — inventing syntax the corpus does not use would
 * break CHECK-01's ruling re-validation (Phase 176), which reads this same corpus.
 */
export function renderRuling(input: {
  number: number;
  decision: string;
  citation: string;
  rationale: string;
}): string {
  return (
    `### Ruling ${input.number}\n` +
    `${RULING_LABELS[0]} ${input.decision}\n` +
    `${RULING_LABELS[1]} ${input.citation}\n` +
    `${RULING_LABELS[2]} ${input.rationale}\n`
  );
}

/**
 * `boardsmith verify-impact-adjudicate`'s core write path for `outcome: 'resolved'` — appends a
 * new `### Ruling N` entry to `RULINGS.md`, `N` assigned by `nextRulingNumber`.
 *
 * APPEND-ONLY (T-175-09): reads the existing text, computes the new block, and writes
 * `existingText + separator + newBlock` through `atomicWriteFile` (`verify-run.ts`) — the ONE
 * atomic write path this repo has, never a second `fs.writeFile`. A caller-side test proves this
 * is truly append-only by asserting the new file content `startsWith` the original byte-for-byte.
 *
 * `RULINGS.md`'s absence is a TOOL FAILURE, not a case to paper over: a bs-built project always
 * has one (scaffolded at `init` time), so a missing file here means this command is being run
 * against the wrong project directory, or the corpus was deleted — either way, this throws an
 * actionable error rather than silently creating a fresh, empty `RULINGS.md` that would erase the
 * project's own convention header and every prior human decision it never had.
 */
export async function appendRuling(
  projectDir: string,
  entry: { decision: string; citation: string; rationale: string },
): Promise<{ number: number; path: string }> {
  const dir = resolve(projectDir);
  const rulingsPath = join(dir, 'RULINGS.md');
  const relRulingsPath = 'RULINGS.md';

  let rulingsText: string;
  try {
    rulingsText = await fs.readFile(rulingsPath, 'utf-8');
  } catch {
    throw new Error(
      `No ${relRulingsPath} found in ${dir}.\n` +
        `A bs-built project always has one, scaffolded at \`boardsmith init\` time — this command\n` +
        `never creates it. Confirm --project points at the right game directory, or restore\n` +
        `${relRulingsPath} before recording an adjudication resolution.`,
    );
  }

  const number = nextRulingNumber(rulingsText);
  const block = renderRuling({ number, ...entry });
  const separator = rulingsText.endsWith('\n\n') ? '' : rulingsText.endsWith('\n') ? '\n' : '\n\n';
  const newText = rulingsText + separator + block;

  await atomicWriteFile(rulingsPath, newText);

  return { number, path: relRulingsPath };
}

export interface VerifyImpactAdjudicateResult {
  pairId: string;
  outcome: 'resolved' | 'UNADJUDICATED';
  rulingNumber?: number;
}

/**
 * `boardsmith verify-impact-adjudicate` — records the human's answer for one contradictory
 * finding. There is NO option, environment variable, or argument on this command — or anywhere
 * else in this module — that marks a contradiction resolved without a supplied human decision
 * (decision 9). `outcome: 'resolved'` REQUIRES non-empty `decision`/`citation`/`rationale`; the
 * absence of any is a thrown, actionable tool failure naming the missing field, never a silent
 * default or a tool-authored ruling — exactly `build/ask.md`'s Gate-Before-Write discipline: only
 * an explicit human answer authorizes the durable write.
 *
 * `outcome: 'UNADJUDICATED'` writes NO `RULINGS.md` entry: it is decision 8's honest terminal
 * state for a deferred or aborted adjudication, recorded as a first-class `AdjudicationRecord`
 * so the pair stays PENDING on a later run — never silence, never treated as resolved.
 *
 * IDEMPOTENT PER PAIR: if this pair already carries a recorded `outcome: 'resolved'`
 * `AdjudicationRecord` with a `rulingNumber`, a second `resolved` call reuses that SAME ruling
 * number and does NOT call `appendRuling` again — a re-run (or a retried call after a partial
 * crash) never appends a second `### Ruling N` entry for one already-recorded resolution. A new
 * `AdjudicationRecord` ledger line is still appended (last-write-wins per pairId, 175-02),
 * matching the run ledger's own append-only discipline.
 *
 * WRITE ORDER: `RULINGS.md` first, the ledger record second (T-175-13) — a crash between the two
 * leaves the ruling durable and the pair still PENDING (re-runnable), never a recorded resolution
 * with no ruling behind it.
 */
export async function verifyImpactAdjudicateCommand(options: {
  project?: string;
  runId?: string;
  pairId: string;
  outcome: 'resolved' | 'UNADJUDICATED';
  decision?: string;
  citation?: string;
  rationale?: string;
  json?: boolean;
}): Promise<VerifyImpactAdjudicateResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const { pairId, outcome } = options;

  if (outcome !== 'resolved' && outcome !== 'UNADJUDICATED') {
    throw new Error(
      `--outcome must be exactly "resolved" or "UNADJUDICATED" — got "${outcome}".\n` +
        `There is no other representable adjudication outcome. A deferred or aborted\n` +
        `adjudication must be recorded explicitly as "UNADJUDICATED", never left unset.`,
    );
  }

  if (outcome === 'resolved') {
    const missing = (['decision', 'citation', 'rationale'] as const).filter(
      (field) => !options[field] || !options[field]!.trim(),
    );
    if (missing.length > 0) {
      throw new Error(
        `--outcome resolved requires non-empty --${missing.join(', --')}.\n` +
          `A resolution is the human's own words recorded in RULINGS.md — never inferred, never\n` +
          `supplied by the tool. Provide the missing field(s), or record --outcome UNADJUDICATED\n` +
          `to defer this adjudication to a later run.`,
      );
    }
  }

  // `verifyClassifyStatusCommand` is the single existing authority for both the resolved runId
  // and the recorded classification verdicts — never re-derived here.
  const classifyStatus = await verifyClassifyStatusCommand({
    project: projectDir,
    runId: options.runId,
    // json: false — this is an internal composition call. verifyClassifyStatusCommand's own
    // json:true path prints its OWN JSON.stringify(result) to stdout as a side effect
    // (verify-classify.ts's convention), independent of whatever this caller's own --json
    // handling does below. Passing json:true here would print a second, unrelated top-level
    // JSON object ahead of this command's own result on every invocation (found live while
    // producing 175-PROOF.md's real verify-impact-gate --json output: stdout contained two
    // concatenated JSON objects instead of one, breaking a real caller's JSON.parse(stdout)).
    json: false,
  });
  const runId = classifyStatus.runId;

  const classification = classifyStatus.classified.find((c) => c.pairId === pairId);
  if (!classification || classification.ruleDelta !== 'contradictory') {
    throw new Error(
      `Pair "${pairId}" has no recorded "contradictory" classification in run ${runId}.\n` +
        `Run \`boardsmith verify-impact-gate --run-id ${runId}\` to list pending contradictions.`,
    );
  }

  const quotedPass1 = classification.quotedPass1 ?? NO_VERBATIM_READING;
  const quotedPass2 = classification.quotedPass2 ?? NO_VERBATIM_READING;

  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);
  const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { adjudications } = resolveLedgerState(lines);
  const existing = adjudications.find((a) => a.pairId === pairId);

  let rulingNumber: number | undefined;

  if (outcome === 'resolved') {
    if (existing?.outcome === 'resolved' && existing.rulingNumber !== undefined) {
      // Idempotent: this pair already has a recorded ruling — reuse it, never append a second
      // RULINGS.md entry for an already-recorded resolution.
      rulingNumber = existing.rulingNumber;
    } else {
      // RULINGS.md write FIRST (T-175-13) — both verbatim readings embedded into the Citation
      // field, matching the real corpus's own convention of quoting the interpreted rulebook
      // text inside "Citation interpreted or overridden:" (e.g. one-two-punch Ruling 22).
      const appended = await appendRuling(projectDir, {
        decision: options.decision!.trim(),
        citation:
          `${options.citation!.trim()} — Reading as built (pass 1): "${quotedPass1}" | ` +
          `Reading in the fresh transcription (pass 2): "${quotedPass2}"`,
        rationale: options.rationale!.trim(),
      });
      rulingNumber = appended.number;
    }
  }

  const record: AdjudicationRecord = {
    kind: 'adjudication',
    pairId,
    outcome,
    ...(rulingNumber !== undefined ? { rulingNumber } : {}),
    quotedPass1,
    quotedPass2,
    recordedAt: new Date().toISOString(),
  };

  // Ledger record SECOND (T-175-13) — a crash between the RULINGS.md write above and this append
  // leaves the ruling durable and the pair still pending, never a recorded resolution with no
  // ruling behind it.
  const newLedgerText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(record));
  await atomicWriteFile(ledgerFile, newLedgerText);

  const result: VerifyImpactAdjudicateResult = {
    pairId,
    outcome,
    ...(rulingNumber !== undefined ? { rulingNumber } : {}),
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (outcome === 'resolved') {
    console.log(
      chalk.green(`✓ Recorded Ruling ${rulingNumber} for pair ${pairId} (run ${runId})`),
    );
  } else {
    console.log(
      chalk.yellow(`⚠ Pair ${pairId} deferred as UNADJUDICATED — remains pending (run ${runId})`),
    );
  }
  return result;
}

// -------------------------------------------------------------------------------------------
// `computeRepairGate` + the impact-map status command (175-CONTEXT.md decisions 10, 11, 12, 13,
// 15, 16)
// -------------------------------------------------------------------------------------------

/**
 * The four possible repair-gate outcomes — frozen array + derived type, never a hand-written
 * union (the established `FINDING_KINDS`/`RULE_DELTA_KINDS`/`PROVENANCE_KINDS` pattern).
 */
export const REPAIR_GATE_DISPOSITIONS = Object.freeze([
  'reopen-playtest',
  'close-without-replaytest',
  'unknown-drift',
  'not-applicable',
] as const);

export type RepairGateDisposition = (typeof REPAIR_GATE_DISPOSITIONS)[number];

export interface RepairGate {
  disposition: RepairGateDisposition;
  /** Present only for `reopen-playtest` / `close-without-replaytest`. */
  nextStatus?: string;
  clearMarker: boolean;
  reverifyStamp: boolean;
  reason: string;
}

/**
 * Pure, total, no I/O. Decides which of the four repair-gate dispositions applies to one chunk,
 * given: its literal `Status:` value, whether Phase 174 classified it stale, and `drift-check`'s
 * three-state code-movement verdict (175-CONTEXT.md decision 10 — the SOLE authority for "did
 * this chunk's code move"; this function never re-derives that fact).
 *
 * BRANCH ORDER IS LOAD-BEARING (blindness-before-narrowing, the same discipline 174-04's
 * guardrail-2 pins): a blind input can never produce a confident disposition.
 *
 *   1. `driftState === 'unknown'` is checked FIRST, before anything else — including `stale` and
 *      `status`. A caller who does not know whether the code moved cannot be told there is
 *      nothing to gate (a `built`/non-verified status) OR that the gate is closed (`clean`) OR
 *      that it re-opens (`drifted`) — all three of those are claims about code movement this
 *      function has no basis for. `unknown-drift` never yields a `nextStatus` and never clears
 *      the marker (decision 10 — never collapsed into `clean`).
 *   2. `!stale` — nothing is being repaired, so there is no repair-gate decision to make
 *      (symmetric with step 3's "no playtest gate to re-open on a chunk that never had one").
 *   3. `!status.startsWith('verified')` (matching `chunk-provenance.ts` line 766's existing
 *      check) — a `built`/`approved`/`proposed` chunk has no playtest gate to re-open or close.
 *   4. `driftState === 'drifted'` — the code moved: `built`, marker cleared, playtest gate
 *      RE-OPENS (decision 12). A `verified (user-waived)` status is NOT preserved here — decision
 *      13's waiver is about a specific state of the code, not a standing exemption; the human may
 *      waive again, explicitly, as a fresh decision.
 *   5. `driftState === 'clean'` — the code did not move: `nextStatus` preserves `status`
 *      VERBATIM (including `verified (user-waived)` — decision 13's waiver is not upgraded to a
 *      bare `verified` just because a later pass re-confirmed no code changed), marker cleared,
 *      and a re-verification stamp with no code change is recorded (decision 11).
 */
export function computeRepairGate(input: {
  status: string;
  stale: boolean;
  driftState: 'clean' | 'drifted' | 'unknown';
}): RepairGate {
  const { status, stale, driftState } = input;

  if (driftState === 'unknown') {
    return {
      disposition: 'unknown-drift',
      clearMarker: false,
      reverifyStamp: false,
      reason:
        'drift-check could not determine whether this chunk\'s code moved (state: unknown) — ' +
        'the playtest-gate decision is deferred until code movement can be resolved. Never ' +
        'collapsed into "clean" or "drifted".',
    };
  }

  if (!stale) {
    return {
      disposition: 'not-applicable',
      clearMarker: false,
      reverifyStamp: false,
      reason: 'This chunk was not flagged rules-stale — there is nothing to repair-gate.',
    };
  }

  if (!status.startsWith('verified')) {
    return {
      disposition: 'not-applicable',
      clearMarker: false,
      reverifyStamp: false,
      reason: `Status "${status}" has no playtest gate to re-open or close — this chunk was never verified.`,
    };
  }

  if (driftState === 'drifted') {
    return {
      disposition: 'reopen-playtest',
      nextStatus: 'built',
      clearMarker: true,
      reverifyStamp: false,
      reason:
        `This chunk's code changed since it was last verified (drift-check: drifted) — the ` +
        `playtest gate re-opens; status moves to "built" (the code exists and passes automated ` +
        `test, but no human has confirmed the new behavior). A prior "${status}" waiver, if any, ` +
        `is not auto-renewed — the human may waive again, explicitly, as a fresh decision.`,
    };
  }

  // driftState === 'clean'
  return {
    disposition: 'close-without-replaytest',
    nextStatus: status,
    clearMarker: true,
    reverifyStamp: true,
    reason:
      `This chunk's code did not change (drift-check: clean) — closes without re-playtesting; ` +
      `status "${status}" is preserved verbatim (a waiver, if any, is not upgraded) and a ` +
      `re-verification with no code change is stamped into "## Verified Against".`,
  };
}

/** One row of the impact map — Phase 176's `--json` input contract (decision 16). */
export interface ImpactMapEntry {
  slug: string;
  ruleDelta: string;
  stale: boolean;
  status: string;
  driftState: 'clean' | 'drifted' | 'unknown';
  changedFiles: string[];
  missingFiles: string[];
  attributions: ChunkVerdict['attributions'];
  gate: RepairGate;
  markerState: 'clear' | 'rules-stale' | 'unknown';
}

export interface VerifyImpactStatusResult {
  runId: string;
  entries: ImpactMapEntry[];
  /** Decision 15 — never capped or truncated. */
  staleFraction: { stale: number; total: number };
  staleSlugs: string[];
  dispositionCounts: Record<RepairGateDisposition, number>;
  contradictionsPending: string[];
  warnings: string[];
}

/**
 * Pure. Builds one `ImpactMapEntry` from a `ChunkVerdict` plus the drift/provenance/marker facts
 * already looked up for its slug — no I/O, so `verifyImpactStatusCommand`'s per-chunk assembly is
 * directly testable without a real project fixture.
 */
function buildImpactMapEntry(
  verdict: ChunkVerdict,
  drift: ChunkDrift | undefined,
  status: string,
  markerState: 'clear' | 'rules-stale' | 'unknown',
): ImpactMapEntry {
  const driftState = drift?.state ?? 'unknown';
  const gate = computeRepairGate({ status, stale: verdict.stale, driftState });
  return {
    slug: verdict.slug,
    ruleDelta: verdict.ruleDelta,
    stale: verdict.stale,
    status,
    driftState,
    changedFiles: drift?.changedFiles ?? [],
    missingFiles: drift?.missingFiles ?? [],
    attributions: verdict.attributions,
    gate,
    markerState,
  };
}

function emptyDispositionCounts(): Record<RepairGateDisposition, number> {
  const counts = {} as Record<RepairGateDisposition, number>;
  for (const d of REPAIR_GATE_DISPOSITIONS) counts[d] = 0;
  return counts;
}

function printImpactHumanReport(result: VerifyImpactStatusResult): void {
  const { staleFraction, staleSlugs, dispositionCounts, contradictionsPending, entries } = result;

  console.log(chalk.green(`✓ Verify-impact status — run ${result.runId}`));
  console.log(`  ${chalk.gray('rules-stale:')} ${staleFraction.stale} of ${staleFraction.total} chunks rules-stale`);
  if (staleSlugs.length > 0) {
    // Decision 15: EVERY stale slug, no cap, no "and N more".
    console.log(`  ${chalk.yellow('stale chunks:')} ${staleSlugs.join(', ')}`);
  }
  if (contradictionsPending.length > 0) {
    console.log(
      `  ${chalk.yellow('contradictions pending adjudication:')} ${contradictionsPending.join(', ')}`,
    );
  }

  for (const disposition of REPAIR_GATE_DISPOSITIONS) {
    const inGroup = entries.filter((e) => e.gate.disposition === disposition);
    if (inGroup.length === 0) continue;
    console.log(`\n  ${disposition} (${dispositionCounts[disposition]}):`);
    for (const e of inGroup) {
      console.log(`    ${e.slug} — ${e.gate.reason}`);
    }
  }
}

/**
 * `boardsmith verify-impact-status` — VERIFY-06's read side: the run's impact map. Composes
 * `verifyClassifyStatusCommand` (chunk verdicts + resolved run id), `driftCheckCommand`
 * (decision 10's code-movement authority), `chunkProvenanceStatusCommand` (each chunk's literal
 * `Status:`), `parseRulesStaleness` (each CHUNK.md's current marker state), and
 * `collectContradictions` (the pending adjudication gate list) — never re-derives any of them.
 *
 * `driftCheckCommand`/`chunkProvenanceStatusCommand` are called with `{ project, json: false }`;
 * both print their own human-readable report as a side effect of that call (neither offers a
 * "return only, print nothing" mode) — this is accepted, not suppressed: this command's own
 * report below is what a human actually reads, and the printed side effect is otherwise inert
 * (read-only, no state carried between calls).
 *
 * Read-only. Never sets `process.exitCode`; throws only for a structural tool failure (unknown
 * run, not a git repo, no `chunks/`) — the same failures the composed commands already throw.
 */
export async function verifyImpactStatusCommand(
  options: { project?: string; runId?: string; json?: boolean } = {},
): Promise<VerifyImpactStatusResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  const classifyStatus = await verifyClassifyStatusCommand({
    project: projectDir,
    runId: options.runId,
    // json: false — this is an internal composition call. verifyClassifyStatusCommand's own
    // json:true path prints its OWN JSON.stringify(result) to stdout as a side effect
    // (verify-classify.ts's convention), independent of whatever this caller's own --json
    // handling does below. Passing json:true here would print a second, unrelated top-level
    // JSON object ahead of this command's own result on every invocation (found live while
    // producing 175-PROOF.md's real verify-impact-gate --json output: stdout contained two
    // concatenated JSON objects instead of one, breaking a real caller's JSON.parse(stdout)).
    json: false,
  });
  const runId = classifyStatus.runId;

  const [driftResult, provenanceResult] = await Promise.all([
    driftCheckCommand({ project: projectDir, json: false }),
    chunkProvenanceStatusCommand({ project: projectDir, json: false }),
  ]);

  const driftBySlug = new Map(driftResult.chunks.map((c) => [c.chunk, c] as const));
  const statusBySlug = new Map(provenanceResult.chunks.map((c) => [c.slug, c.status] as const));

  const warnings = [...classifyStatus.warnings];
  const entries: ImpactMapEntry[] = [];

  for (const verdict of classifyStatus.chunkVerdicts) {
    const status = statusBySlug.get(verdict.slug);
    if (status === undefined) {
      warnings.push(
        `[impact-status] chunk "${verdict.slug}" has a classification verdict but no ` +
          `chunk-provenance-status entry (no chunks/${verdict.slug}/CHUNK.md Status: line found) ` +
          `— its marker state and gate could not be computed.`,
      );
      continue;
    }

    let markerState: 'clear' | 'rules-stale' | 'unknown' = 'unknown';
    try {
      const chunkText = await fs.readFile(
        join(projectDir, 'chunks', verdict.slug, 'CHUNK.md'),
        'utf-8',
      );
      markerState = parseRulesStaleness(chunkText).state;
    } catch {
      // No CHUNK.md to read — markerState stays 'unknown' (never collapsed into 'clear').
    }

    entries.push(buildImpactMapEntry(verdict, driftBySlug.get(verdict.slug), status, markerState));
  }

  const staleSlugs = entries.filter((e) => e.stale).map((e) => e.slug);
  const staleFraction = { stale: staleSlugs.length, total: entries.length };

  const dispositionCounts = emptyDispositionCounts();
  for (const e of entries) dispositionCounts[e.gate.disposition]++;

  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);
  const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { adjudications } = resolveLedgerState(lines);
  const contradictions = collectContradictions({
    classifications: classifyStatus.classified,
    adjudications,
    chunkVerdicts: classifyStatus.chunkVerdicts,
  });
  const contradictionsPending = contradictions
    .filter((c) => c.adjudication !== 'resolved')
    .map((c) => c.pairId);

  const result: VerifyImpactStatusResult = {
    runId,
    entries,
    staleFraction,
    staleSlugs,
    dispositionCounts,
    contradictionsPending,
    warnings,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  printImpactHumanReport(result);
  return result;
}

// -------------------------------------------------------------------------------------------
// `verify-impact-apply` — the staleness write, gated (175-CONTEXT.md decisions 3, 6, 8, 9, 17)
// -------------------------------------------------------------------------------------------

export interface VerifyImpactApplyResult {
  runId: string;
  blocked: boolean;
  pendingPairs: string[];
  marked: Array<{ slug: string; chunkWritten: boolean; sketchWritten: boolean }>;
  skippedTailEntries: string[];
  warnings: string[];
}

/**
 * `boardsmith verify-impact-apply` — VERIFY-05's write orchestration: the staleness write,
 * refusing structurally while any contradiction is un-adjudicated.
 *
 * There is no `--clear`, `--force`, `--skip-gate`, or `--yes` option, and no `process.env` read
 * anywhere in this function (decision 9's no-bypass discipline, extended from the adjudication
 * gate to the write it guards).
 *
 * Sequence (`build/ask.md`'s Gate-Before-Write applied to a CLI):
 *   1. Resolve the run, compute `collectContradictions`. Any `adjudication === 'pending'` blocks
 *      the ENTIRE write — nothing is touched, and the result names every pending pair plus the
 *      exact next command (decision 6 — the gate fires BEFORE any staleness write).
 *   2. Otherwise, for each `ChunkVerdict` with `stale === true`: write the marker
 *      (`writeRulesStalenessMarker`), then append one `ImpactRecord` to the run ledger — CHUNK.md
 *      then SKETCH.md then the ledger record, so a crash leaves a chunk either
 *      fully-written-and-recorded or not recorded (never a torn state), and a re-run is
 *      idempotent (`writeRulesStalenessMarker`'s own idempotent-body-replace semantics).
 *   3. A stale chunk with no `chunks/<slug>/` directory (a sketch-level tail entry) is collected
 *      into `skippedTailEntries`, never written — the same skip `writeRulesStalenessMarker`
 *      itself already performs for `SKETCH.md`, surfaced here at the caller boundary too.
 *
 * A recorded `UNADJUDICATED` adjudication does NOT block: the affected chunks are still marked
 * stale and the marker's `Adjudication:` line reads `UNADJUDICATED` (decision 8 — never silently
 * clean).
 *
 * Never sets `process.exitCode` for a finding; throws only for a structural tool failure.
 */
export async function verifyImpactApplyCommand(
  options: { project?: string; runId?: string; json?: boolean } = {},
): Promise<VerifyImpactApplyResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  const classifyStatus = await verifyClassifyStatusCommand({
    project: projectDir,
    runId: options.runId,
    // json: false — this is an internal composition call. verifyClassifyStatusCommand's own
    // json:true path prints its OWN JSON.stringify(result) to stdout as a side effect
    // (verify-classify.ts's convention), independent of whatever this caller's own --json
    // handling does below. Passing json:true here would print a second, unrelated top-level
    // JSON object ahead of this command's own result on every invocation (found live while
    // producing 175-PROOF.md's real verify-impact-gate --json output: stdout contained two
    // concatenated JSON objects instead of one, breaking a real caller's JSON.parse(stdout)).
    json: false,
  });
  const runId = classifyStatus.runId;

  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);
  const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { adjudications } = resolveLedgerState(lines);

  const contradictions = collectContradictions({
    classifications: classifyStatus.classified,
    adjudications,
    chunkVerdicts: classifyStatus.chunkVerdicts,
  });
  const pendingContradictions = contradictions.filter((c) => c.adjudication === 'pending');

  if (pendingContradictions.length > 0) {
    const pendingPairs = pendingContradictions.map((c) => c.pairId);
    const result: VerifyImpactApplyResult = {
      runId,
      blocked: true,
      pendingPairs,
      marked: [],
      skippedTailEntries: [],
      warnings: classifyStatus.warnings,
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    console.log(
      chalk.yellow(
        `⚠ ${pendingPairs.length} contradictory finding(s) still pending adjudication — writes ` +
          `nothing until every one is resolved.\n` +
          pendingPairs
            .map(
              (p) =>
                `    boardsmith verify-impact-adjudicate --run-id ${runId} --pair-id ${p} ` +
                `--outcome resolved|UNADJUDICATED ...`,
            )
            .join('\n'),
      ),
    );
    return result;
  }

  const [driftResult, provenanceResult] = await Promise.all([
    driftCheckCommand({ project: projectDir, json: false }),
    chunkProvenanceStatusCommand({ project: projectDir, json: false }),
  ]);
  const driftBySlug = new Map(driftResult.chunks.map((c) => [c.chunk, c] as const));
  const statusBySlug = new Map(provenanceResult.chunks.map((c) => [c.slug, c.status] as const));

  const adjudicationByPairId = new Map(adjudications.map((a) => [a.pairId, a] as const));
  const classificationByPairId = new Map(classifyStatus.classified.map((c) => [c.pairId, c] as const));

  const marked: VerifyImpactApplyResult['marked'] = [];
  const skippedTailEntries: string[] = [];
  const warnings = [...classifyStatus.warnings];

  for (const verdict of classifyStatus.chunkVerdicts) {
    if (!verdict.stale) continue;

    const chunkDir = join(projectDir, 'chunks', verdict.slug);
    try {
      await fs.stat(join(chunkDir, 'CHUNK.md'));
    } catch {
      skippedTailEntries.push(verdict.slug);
      continue;
    }

    // The "governing pair" is the classified pair driving this chunk's rolled-up ruleDelta —
    // preferring one whose ruleDelta matches the chunk-level roll-up, falling back to the first
    // classified pair this chunk cites, never fabricated.
    const governingClassification =
      classifyStatus.classified.find(
        (c) => verdict.pairIds.includes(c.pairId) && c.ruleDelta === verdict.ruleDelta,
      ) ?? verdict.pairIds.map((id) => classificationByPairId.get(id)).find((c) => c !== undefined);

    let adjudication: string;
    if (!governingClassification || governingClassification.ruleDelta !== 'contradictory') {
      adjudication = 'n/a';
    } else {
      const recorded = adjudicationByPairId.get(governingClassification.pairId);
      if (recorded?.outcome === 'resolved') {
        adjudication = `resolved (Ruling ${recorded.rulingNumber})`;
      } else if (recorded?.outcome === 'UNADJUDICATED') {
        adjudication = 'UNADJUDICATED';
      } else {
        adjudication = 'n/a';
      }
    }

    const attributedSlices = verdict.attributions
      .filter((a) => a.attributed)
      .map((a) => a.liveSlice);

    const writeResult = await writeRulesStalenessMarker(projectDir, {
      slug: verdict.slug,
      runId,
      ruleDelta: verdict.ruleDelta,
      attributedSlices,
      priorReading: governingClassification?.quotedPass1,
      changedReading: governingClassification?.quotedPass2,
      adjudication,
    });

    const chunkStatus = statusBySlug.get(verdict.slug) ?? 'unknown';
    const driftState = driftBySlug.get(verdict.slug)?.state ?? 'unknown';

    const impactRecord: ImpactRecord = {
      kind: 'impact',
      slug: verdict.slug,
      ruleDelta: verdict.ruleDelta,
      stale: verdict.stale,
      attributions: verdict.attributions,
      chunkStatus,
      driftState,
      markerWritten: writeResult.chunkWritten || writeResult.sketchWritten,
      recordedAt: new Date().toISOString(),
    };

    // Ledger append AFTER this chunk's writes land (decision 17) — a crash leaves a chunk either
    // fully-written-and-recorded or not recorded, never a half-written chunk falsely recorded.
    const currentLedgerText = await fs.readFile(ledgerFile, 'utf-8');
    const newLedgerText = appendLedgerLine(currentLedgerText, relLedgerPath, JSON.stringify(impactRecord));
    await atomicWriteFile(ledgerFile, newLedgerText);

    marked.push({
      slug: verdict.slug,
      chunkWritten: writeResult.chunkWritten,
      sketchWritten: writeResult.sketchWritten,
    });
  }

  const result: VerifyImpactApplyResult = {
    runId,
    blocked: false,
    pendingPairs: [],
    marked,
    skippedTailEntries,
    warnings,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(chalk.green(`✓ Marked ${marked.length} chunk(s) rules-stale — run ${runId}`));
  if (skippedTailEntries.length > 0) {
    console.log(`  ${chalk.yellow('skipped (sketch-level tail entries):')} ${skippedTailEntries.join(', ')}`);
  }
  return result;
}
