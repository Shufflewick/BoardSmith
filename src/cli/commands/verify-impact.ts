import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { findHeadingIndex } from './build-manifest.js';
import { VERIFIED_AGAINST_HEADING, VERIFIED_AGAINST_END } from './chunk-provenance.js';
import { RULE_DELTA_KINDS, type RuleDelta } from './verify-classify.js';
import { atomicWriteFile } from './verify-run.js';

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
