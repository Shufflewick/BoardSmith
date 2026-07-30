import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { isPresentationLine } from './verify-classify.js';

/**
 * `verify-derive-recheck.ts` — CHECK-04's mechanical core (177-CONTEXT.md decision 2/5): the
 * frozen four-verdict enum, the single verdict-construction choke point, the live-slice
 * enumeration, and the quote-lines-only payload filter that makes the check's "independent
 * second opinion" guarantee STRUCTURAL rather than a prompt instruction.
 *
 * This module contains NO rule-bearingness keyword or phrase list anywhere. Recognizing whether a
 * surviving `Derived` line is actually rule-bearing (versus a page-layout/art description with no
 * qualifier, per 177-RESEARCH.md's measured `seven`-side examples) is subagent judgment, never a
 * string match here — the same defect class 176-RESEARCH.md Pitfall 4 named for an absence-phrase
 * list.
 *
 * This module's `buildBlindDerivePayload` is the ONE construction site for the blind-derivation
 * dispatch prompt, and it is structurally incapable of emitting the `Derived (p.` line under test:
 * `quoteLinesOnly` strips every `Derived`/`Visual`/`Named-but-undefined` line from a slice before
 * any payload is assembled, and `buildBlindDerivePayload` never touches an entry's own text. A
 * re-derivation that has seen the original is not a second opinion — it is a confirmation, and it
 * would report high agreement whether or not the original derivation was sound. Independence must
 * be structural: the original line is not in the dispatch payload at all.
 *
 * This module reads the LIVE `rulebook/*.md` tree directly, never a staged `.verify/<runId>/`
 * tree (177-CONTEXT.md decision 12; 177-RESEARCH.md Pitfall 3) — `resolveFreshTranscription`
 * (`verify-ruling-recheck.ts`) resolves the STAGED transcription for a different question (Phase
 * 176's ruling re-check) and must not be reused here.
 */

// -------------------------------------------------------------------------------------------
// DERIVE_VERDICTS — the frozen four-member enum (177-CONTEXT.md decision 6)
// -------------------------------------------------------------------------------------------

/**
 * The verdict set is FOUR, not two or three. `underivable` is first-class and load-bearing: the
 * original transcription had the source PDF (component images, tables, card faces) while
 * re-derivation has only the quote lines a slice captured. A derivation that legitimately drew on
 * something the quote lines never recorded simply CANNOT be re-derived — neither agreement nor
 * disagreement. Collapsing it into `agrees` would report false confirmation; collapsing it into
 * `disagrees` would manufacture a false finding. `not-rule-bearing` is likewise first-class: the
 * mechanical presentation filter (`isPresentationLine`, reused verbatim from `verify-classify.ts`)
 * does not catch every presentation-shaped line (177-RESEARCH.md measured at least 3 unqualified
 * `seven`-side lines it misses entirely), so the surviving candidate set genuinely includes lines
 * that are not rule-bearing at all. Never collapse either into `agrees`/`disagrees` — the same
 * first-class-blindness principle this milestone has already applied to `drift-unknown`, `unknown`
 * provenance, `unclassified`, `unknown-drift`, and `undetermined`.
 */
export const DERIVE_VERDICTS = Object.freeze([
  'agrees',
  'disagrees',
  'underivable',
  'not-rule-bearing',
] as const);

export type DeriveVerdict = (typeof DERIVE_VERDICTS)[number];

function isDeriveVerdict(value: string): value is DeriveVerdict {
  return (DERIVE_VERDICTS as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------------------
// DeriveVerdictRecord — the CLI-validated, subagent-supplied verdict record
// -------------------------------------------------------------------------------------------

export interface DeriveVerdictRecord {
  slicePath: string;
  lineNumber: number;
  /** The original `Derived (p.N): ...` line, verbatim — never mutated. */
  originalLine: string;
  verdict: DeriveVerdict;
  /** The reasoning IS the artifact, mirroring `verify-ruling-recheck.ts`'s decision 4 rule. */
  reasoning: string;
  /**
   * For a `disagrees` verdict, the original derivation quoted verbatim (177-CONTEXT.md decision
   * 8 — SC-2 requires findings that cite BOTH derivations, not a summary of the difference).
   * Optional for every other verdict.
   */
  originalReading?: string;
  /**
   * For a `disagrees` verdict, the blind re-derivation's own reading quoted verbatim. Optional
   * for every other verdict (an `underivable`/`not-rule-bearing` verdict has no second reading to
   * cite; an `agrees` verdict may still carry one for the report, but it is not required here).
   */
  rederivedReading?: string;
  /** The quote lines the blind-derivation dispatch actually cited in support of its answer. */
  sourceQuotes: string[];
}

/**
 * Validates and constructs a `DeriveVerdictRecord` from a subagent's returned verdict. This is
 * the ONLY place a verdict string is checked against `DERIVE_VERDICTS`; every recording path in
 * this module routes through it. Throws when:
 *
 *   - the verdict is outside `DERIVE_VERDICTS` (message names all four legal verdicts)
 *   - `reasoning` is empty or whitespace-only
 *   - the verdict is `disagrees` and `originalReading` is empty/missing (decision 8 — a
 *     disagreement without the original derivation quoted verbatim loses exactly the material a
 *     designer needs to adjudicate)
 *   - the verdict is `disagrees` and `rederivedReading` is empty/missing (same reason, the other
 *     side)
 *
 * Modeled as additional `if` blocks inside this same function — never a second validator
 * elsewhere in the module.
 */
export function createDeriveVerdictRecord(input: {
  slicePath: string;
  lineNumber: number;
  originalLine: string;
  verdict: string;
  reasoning: string;
  originalReading?: string;
  rederivedReading?: string;
  sourceQuotes?: string[];
}): DeriveVerdictRecord {
  const location = `${input.slicePath}:${input.lineNumber}`;

  if (!isDeriveVerdict(input.verdict)) {
    throw new Error(
      `Invalid verdict "${input.verdict}" for ${location}.\n` +
        `Expected one of: ${DERIVE_VERDICTS.join(', ')}.`,
    );
  }
  if (input.reasoning.trim().length === 0) {
    throw new Error(
      `${location}'s verdict has no recorded reasoning.\n` +
        `The reasoning is the artifact this check exists to produce — a verdict label with no ` +
        `reasoning is not a valid record.`,
    );
  }
  if (input.verdict === 'disagrees') {
    if (!input.originalReading || input.originalReading.trim().length === 0) {
      throw new Error(
        `${location}'s "disagrees" verdict has no originalReading quoted verbatim.\n` +
          `SC-2 requires a finding citing BOTH derivations verbatim — a designer adjudicating a ` +
          `disagreement needs to see exactly what the original line said, not a summary.`,
      );
    }
    if (!input.rederivedReading || input.rederivedReading.trim().length === 0) {
      throw new Error(
        `${location}'s "disagrees" verdict has no rederivedReading quoted verbatim.\n` +
          `SC-2 requires a finding citing BOTH derivations verbatim — a designer adjudicating a ` +
          `disagreement needs to see exactly what the blind re-derivation produced, not a summary.`,
      );
    }
  }

  return {
    slicePath: input.slicePath,
    lineNumber: input.lineNumber,
    originalLine: input.originalLine,
    verdict: input.verdict,
    reasoning: input.reasoning,
    ...(input.originalReading !== undefined ? { originalReading: input.originalReading } : {}),
    ...(input.rederivedReading !== undefined
      ? { rederivedReading: input.rederivedReading }
      : {}),
    sourceQuotes: input.sourceQuotes ?? [],
  };
}

// -------------------------------------------------------------------------------------------
// readLiveSlices — the live `rulebook/*.md` tree (177-CONTEXT.md decision 12)
// -------------------------------------------------------------------------------------------

/**
 * Reads the LIVE `rulebook/*.md` tree directly — the same source `verify-classify.ts`'s
 * `computeRunPairs` already reads (excluding `INDEX.md`, the archive manifest, and
 * `00-visual-survey.md`, `ingest-archive.ts`'s presentation-by-design UI-ask handoff artifact).
 * This is the correct "which files are slices" definition for a source-free, run-less check
 * (177-CONTEXT.md decision 14): CHECK-04 targets live slices with NO staged prerequisite, so it
 * must NOT call `resolveFreshTranscription` (`verify-ruling-recheck.ts`), which resolves the
 * STAGED tree and would falsely report scope-limited on a project that has never staged a run.
 */
export async function readLiveSlices(
  projectDir: string,
): Promise<{ path: string; text: string }[]> {
  const rulebookDir = join(projectDir, 'rulebook');
  let names: string[];
  try {
    const entries = await fs.readdir(rulebookDir, { withFileTypes: true });
    names = entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith('.md') &&
          e.name !== 'INDEX.md' &&
          e.name !== '00-visual-survey.md',
      )
      .map((e) => e.name)
      .sort();
  } catch {
    throw new Error(
      `No rulebook/ directory in ${projectDir}.\n` +
        `CHECK-04 re-derives Derived lines against the live rulebook — nothing to read here.`,
    );
  }
  return Promise.all(
    names.map(async (name) => ({
      path: `rulebook/${name}`,
      text: await fs.readFile(join(rulebookDir, name), 'utf-8'),
    })),
  );
}

// -------------------------------------------------------------------------------------------
// quoteLinesOnly — the genuinely new payload filter (177-RESEARCH.md Question 1)
// -------------------------------------------------------------------------------------------

const DERIVED_LINE_RE = /^Derived \(p\.\d+\)/i;
const VISUAL_LINE_RE = /^Visual \(p\.\d+\)/i;
/**
 * A `Named-but-undefined` line is an ingest-time INFERENCE about undefined terminology, not
 * directly-quoted rulebook prose (177-RESEARCH.md's answer to Question 1 names it alongside
 * `Derived`/`Visual` as a line the blind-derivation payload must exclude entirely). Excluding it
 * is not required to satisfy this plan's `Derived (p.`/`Visual (p.` zero-leak assertions, but
 * leaving an inferential line in a payload whose entire purpose is "quote lines only" would
 * silently reintroduce the same anchoring risk decision 5 exists to prevent, one line at a time.
 */
const NAMED_BUT_UNDEFINED_LINE_RE = /^Named-but-undefined \(p\.\d+\)/i;

/**
 * Selects ONLY directly-quoted rulebook content and its citation headers from `sliceText` — the
 * deliberate INVERSE of `ruleBearingLines()` (`verify-classify.ts`), which KEEPS unqualified
 * `Derived` lines because they are rule-bearing for classification purposes. CHECK-04 needs the
 * opposite selection: `Derived`/`Visual`/`Named-but-undefined` lines are excluded ENTIRELY here,
 * not merely the presentation-tagged subset `isPresentationLine` excludes, because decision 5
 * forbids the blind-deriving subagent from seeing ANY `Derived` line — not just the one under
 * test.
 *
 * Drops blank lines and markdown headings (`#`) the same way `ruleBearingLines()` does. Bare
 * `p.N, <label>:` citation headers are RETAINED (they carry no rule content of their own, but a
 * blind-derivation subagent needs them to know which page a quote comes from) along with the
 * directly-quoted prose beneath them.
 *
 * This is the single construction site for what counts as a "quote line" in this module — no
 * caller re-derives its own subset of a slice's content.
 */
export function quoteLinesOnly(sliceText: string): string[] {
  return sliceText
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('#') &&
        !DERIVED_LINE_RE.test(line) &&
        !VISUAL_LINE_RE.test(line) &&
        !NAMED_BUT_UNDEFINED_LINE_RE.test(line),
    );
}

// -------------------------------------------------------------------------------------------
// enumerateDerivedLines — enumerate-and-report, never silently drop (177-RESEARCH.md decision 2)
// -------------------------------------------------------------------------------------------

export interface DerivedLineEntry {
  slicePath: string;
  /** 1-based, matching the file's own line numbering. */
  lineNumber: number;
  /** The line's own verbatim, trimmed text. */
  text: string;
}

export interface EnumerateDerivedLinesResult {
  /** Every `Derived (p.` line surviving `isPresentationLine` exclusion — reaches the subagent. */
  candidates: DerivedLineEntry[];
  /** `Derived (p.` lines the mechanical presentation filter excluded, reported not dropped. */
  excluded: DerivedLineEntry[];
}

/**
 * Enumerates every `Derived (p.` line in the live tree, split into the mechanically-excluded
 * presentation subset and the surviving candidates a judgment subagent evaluates. Mirrors
 * `enumerateRulingsForRecheck`'s (`verify-ruling-recheck.ts`) enumerate-and-report-never-
 * silently-drop posture — the excluded set is reported alongside the candidates, not discarded.
 *
 * Does NOT decide rule-bearingness here — that is the subagent's job (177-CONTEXT.md decision 2).
 * `isPresentationLine` only catches the QUALIFIED presentation forms (`— diagram description:`,
 * `— art:`, `Visual (p.N):`); 177-RESEARCH.md measured at least 3 `seven`-side lines that are
 * presentation-shaped with no qualifier at all and therefore reach `candidates` by design,
 * depending entirely on a competent subagent returning `not-rule-bearing` for them.
 */
export function enumerateDerivedLines(
  slices: { path: string; text: string }[],
): EnumerateDerivedLinesResult {
  const candidates: DerivedLineEntry[] = [];
  const excluded: DerivedLineEntry[] = [];

  for (const slice of slices) {
    const rawLines = slice.text.split('\n');
    rawLines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!DERIVED_LINE_RE.test(line)) return;
      const entry: DerivedLineEntry = {
        slicePath: slice.path,
        lineNumber: index + 1,
        text: line,
      };
      if (isPresentationLine(line)) {
        excluded.push(entry);
      } else {
        candidates.push(entry);
      }
    });
  }

  return { candidates, excluded };
}

// -------------------------------------------------------------------------------------------
// buildBlindDerivePayload — the single construction site (177-CONTEXT.md decision 5)
// -------------------------------------------------------------------------------------------

/** Handshake token proving a dispatch prompt was copied, not composed from memory. */
export const BLIND_DERIVE_TOKEN = 'BS-DERIVE-V1';

/**
 * Builds the blind-derivation dispatch prompt for ONE `Derived` line's slice. This is the SINGLE
 * construction site for that prompt — no caller may append to its output before dispatch. It
 * receives `entry` for identity/ordering ONLY (`entry.slicePath`/`entry.lineNumber` name which
 * line the dispatch is for); `entry.text` — the original `Derived` line itself — is NEVER read
 * or emitted here. The payload's only source material is `quoteLinesOnly(slice.text)`, which has
 * already stripped every `Derived`/`Visual`/`Named-but-undefined` line from the slice.
 *
 * A derivation that has seen the original `Derived` line is not a second opinion, it is a
 * confirmation — it would report high agreement whether or not the original derivation was
 * sound. This function is where that independence guarantee is either upheld or broken; it is
 * upheld here by construction, not by instruction, because `entry.text` is structurally absent
 * from the assembled string.
 */
export function buildBlindDerivePayload(
  slice: { path: string; text: string },
  entry: DerivedLineEntry,
): string {
  const quotes = quoteLinesOnly(slice.text);
  return [
    BLIND_DERIVE_TOKEN,
    `Slice: ${slice.path}`,
    `Target line: ${entry.slicePath}:${entry.lineNumber}`,
    'Quoted rulebook content for this slice — your ONLY source material. No Derived or Visual',
    'line from this slice, or any other slice, is included below or anywhere in this prompt:',
    ...quotes,
  ].join('\n');
}
