import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { isPresentationLine } from './verify-classify.js';
import { atomicWriteFile } from './verify-run.js';
import { DERIVED_LINE_RE } from './derived-line-pattern.js';

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
 * INDEPENDENCE IS DECORATION-INDEPENDENT AND BACKSTOPPED (177-08, closing GAP 2/CR-01): the
 * `^`-anchored trimmed-line matching this module originally used only stripped a `Derived`/
 * `Visual`/`Named-but-undefined` line when it was line-initial after trimming — an ordinary
 * blockquote (`> Derived (p.1): ...`) or list decoration (`- Derived (p.1): ...`) defeated it,
 * leaking the line into the blind payload AND silently dropping it from enumeration. `annotationBody`
 * is now the single decoration-normalization site both `quoteLinesOnly` and `enumerateDerivedLines`
 * route through before every prefix test, so the two can never diverge on what counts as decoration.
 * That alone is still a (wider) deny-list, so `buildBlindDerivePayload` additionally backstops at
 * the construction site: it throws on any assembled string matching an annotation family,
 * independent of which prefix regex missed it. A decoration form nobody anticipated fails loudly
 * instead of leaking — that is what makes the guarantee structural rather than incidental.
 *
 * THE TARGET IDENTIFIER IS AN OPAQUE HANDLE, NEVER A RESOLVABLE COORDINATE (177-11, closing
 * CR-07): a Claude Code subagent has file-read tools, so the pre-fix pair of a bare slice-path
 * line and a `Target line: {path}:{lineNumber}` line was a pointer the blind dispatch could
 * follow straight back to the withheld line — one tool call away from confirmation, not
 * independence.
 * `blindDeriveHandle` replaces both with an opaque sha256-truncated digest; the mapping back to
 * `(slicePath, lineNumber)` lives with the orchestrator, never inside the prompt. `focusQuoteWindow`
 * additionally narrows the payload to the target's own citation passage — positionally, from the
 * quote lines `quoteLinesOnly` already retained, never from `entry.text` — so per-candidate
 * payloads for a shared slice genuinely differ where the underlying passages differ, closing the
 * targeting-collapse artifact `177-PROOF.md` §3 measured (every multi-candidate slice in the real
 * corpus re-deriving the same dominant fact regardless of nominal target). Two candidates that
 * genuinely share one citation passage cannot be told apart without leaking the inference — that
 * residual is real and is reported per-finding (`targetingAmbiguous`/`sharedFocusWith`), never
 * hidden behind a payload that merely looks different.
 *
 * This module reads the LIVE `rulebook/*.md` tree directly, never a staged `.verify/<runId>/`
 * tree (177-CONTEXT.md decision 12; 177-RESEARCH.md Pitfall 3) — `resolveFreshTranscription`
 * (`verify-ruling-recheck.ts`) resolves the STAGED transcription for a different question (Phase
 * 176's ruling re-check) and must not be reused here.
 *
 * SOURCE-FREE BY CONSTRUCTION, not by flag (177-CONTEXT.md decision 4, mirroring `trace-check.ts`'s
 * CHECK-03 posture): this module has no code path that opens the archived source rulebook
 * (`rulebook/source/*`) at all — `readLiveSlices` reads only `rulebook/*.md`, and no function in
 * this file ever joins `projectDir` with `rulebook/source`. Source-freeness is structural, never a
 * `--source-free` mode toggle a caller could forget to pass.
 *
 * The ledger this module writes (`recordDeriveVerdict`/`replaceDeriveVerdicts`/
 * `readDeriveVerdicts`) is PROJECT-LEVEL — `rulebook/.derive-recheck/DERIVE-VERDICTS.md`, no
 * `.verify/<runId>/` segment, no `runId`
 * parameter anywhere in either function's signature (177-CONTEXT.md decision 14). CHECK-04 has
 * nothing to scope to a run: it is source-free by construction and independent of any verify run's
 * staleness verdicts, exactly like CHECK-03 (`trace-check.ts`) and CHECK-05 (`drift-check.ts`).
 * Every durable write in this module goes through `atomicWriteFile` (`verify-run.ts`) — the ONE
 * atomic write path in the repo (`173-REVIEW.md` CR-01's defect class) — never a second
 * `fs.writeFile`/`writeFileSync` call.
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
// factAlignment — a FIELD, never a fifth verdict (177-11; 177-CONTEXT.md decision 6 stays frozen
// at exactly four DERIVE_VERDICTS members)
// -------------------------------------------------------------------------------------------

/**
 * Answers exactly one question, separate from `verdict`: did the blind stage's rederived reading
 * actually address the fact the original line asserts? `177-PROOF.md` §3 measured that most of a
 * real run's `disagrees` verdicts were NOT genuine content disagreements — they were the blind
 * stage re-deriving a DIFFERENT fact than the one nominally under test, an artifact of the
 * pre-177-11 payload carrying no usable targeting information in a multi-candidate slice.
 * `same-fact` is `one-two-punch:52`'s shape (a real numeric conflict about the SAME subject);
 * `different-fact` is every one of the `seven` art/imagery lines whose collapsed re-derivation
 * landed on shared deck-arithmetic instead. Required on every `agrees`/`disagrees` record; not
 * meaningful for the two terminal blind outcomes (`underivable`/`not-rule-bearing`), which have no
 * rederived reading to align in the first place.
 */
export const FACT_ALIGNMENTS = Object.freeze(['same-fact', 'different-fact'] as const);
export type FactAlignment = (typeof FACT_ALIGNMENTS)[number];

function isFactAlignment(value: string): value is FactAlignment {
  return (FACT_ALIGNMENTS as readonly string[]).includes(value);
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
  /**
   * The blind-derivation dispatch's own `rederivedValue`, verbatim (177-09, closing WR-04): either
   * the literal sentinel `underivable`/`not-rule-bearing`, or the blind stage's actual derived
   * reading text. Persisted so the pass-through rule (decision below) is auditable in the ledger,
   * not merely enforced in memory at construction time.
   */
  rederivedValue: string;
  /**
   * Required for `agrees`/`disagrees` (177-11): did the rederived reading address the SAME fact
   * the original line asserts (`same-fact`), or a different one the payload's targeting collapsed
   * onto (`different-fact`)? A separate measurement field, never a fifth `DERIVE_VERDICTS` member
   * (177-CONTEXT.md decision 6 stays frozen at four). Optional for `underivable`/`not-rule-bearing`
   * — those have no rederived reading to align.
   */
  factAlignment?: FactAlignment;
}

/**
 * Validates and constructs a `DeriveVerdictRecord` from a subagent's returned verdict. This is
 * the ONLY place a verdict string is checked against `DERIVE_VERDICTS`; every recording path AND
 * the read path (`readDeriveVerdicts`, 177-09 closing CR-02) route through it. Throws when:
 *
 *   - the verdict is outside `DERIVE_VERDICTS` (message names all four legal verdicts)
 *   - `reasoning` is empty or whitespace-only
 *   - the verdict is `disagrees` and `originalReading` is empty/missing (decision 8 — a
 *     disagreement without the original derivation quoted verbatim loses exactly the material a
 *     designer needs to adjudicate)
 *   - the verdict is `disagrees` and `rederivedReading` is empty/missing (same reason, the other
 *     side)
 *   - `reasoning`, `originalReading`, or `rederivedReading` contains the ledger's own begin/end
 *     fence marker (177-09, closing CR-04 — `reasoning` is model-controlled free prose and
 *     `JSON.stringify` does not escape `<`, so an unrejected fence permanently corrupts the ledger)
 *   - the verdict is `agrees`/`disagrees` and `sourceQuotes` has no non-empty entry (177-09,
 *     closing WR-05 — a confirmation or disagreement citing no material is not a valid record)
 *   - `rederivedValue` is `underivable`/`not-rule-bearing` and `verdict` differs from it (177-09,
 *     closing WR-04 — the blind stage's two terminal outcomes are passed through unchanged by the
 *     comparison stage, never re-adjudicated)
 *   - the verdict is `agrees`/`disagrees` and `factAlignment` is missing or not one of
 *     `FACT_ALIGNMENTS` (177-11 — the instrument that separates a targeting-collapse artifact from
 *     a genuine content disagreement is only trustworthy if it is required, not optional, on every
 *     record that can carry it)
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
  rederivedValue: string;
  originalReading?: string;
  rederivedReading?: string;
  sourceQuotes?: string[];
  factAlignment?: string;
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

  // 177-09 (closing CR-04): reject any field carrying the ledger's own fence marker at the one
  // construction site — the read path (`readDeriveVerdicts`) re-enters this same choke point, so
  // a fence can never reach a ledger, written by any caller, through any path.
  for (const [field, value] of [
    ['reasoning', input.reasoning],
    ['originalReading', input.originalReading],
    ['rederivedReading', input.rederivedReading],
  ] as const) {
    if (value && (value.includes(DERIVE_LEDGER_BEGIN) || value.includes(DERIVE_LEDGER_END))) {
      throw new Error(
        `${location}'s ${field} contains a ledger fence marker.\n` +
          `Re-dispatch the subagent; a verdict field may never carry the ledger's own delimiters.`,
      );
    }
  }

  // 177-09 (closing WR-05): an agrees/disagrees verdict citing no material is not a valid record.
  if (
    (input.verdict === 'agrees' || input.verdict === 'disagrees') &&
    (!input.sourceQuotes || input.sourceQuotes.every((q) => q.trim().length === 0))
  ) {
    throw new Error(
      `${location}'s "${input.verdict}" verdict has no sourceQuotes cited.\n` +
        `An agrees/disagrees verdict must cite at least one non-empty source quote — a ` +
        `confirmation or disagreement citing no material is not a valid record.`,
    );
  }

  // 177-09 (closing WR-04): the blind stage's two terminal outcomes are passed through unchanged
  // by the comparison stage — a compare subagent may never re-adjudicate an underivable/
  // not-rule-bearing blind return into agrees/disagrees.
  if (
    (input.rederivedValue === 'underivable' || input.rederivedValue === 'not-rule-bearing') &&
    input.verdict !== input.rederivedValue
  ) {
    throw new Error(
      `${location}: the blind derivation returned "${input.rederivedValue}" but the comparison ` +
        `returned "${input.verdict}". That verdict is passed through unchanged, never ` +
        `re-adjudicated.`,
    );
  }

  // 177-11: factAlignment is required on agrees/disagrees — the mechanical instrument that tells
  // a targeting-collapse artifact (different-fact) apart from a genuine content disagreement
  // (same-fact) from the recorded ledger alone, per-record, with no threshold and no re-reading of
  // free-prose reasoning to guess at it after the fact.
  if (input.verdict === 'agrees' || input.verdict === 'disagrees') {
    if (!input.factAlignment || !isFactAlignment(input.factAlignment)) {
      throw new Error(
        `${location}'s "${input.verdict}" verdict has no valid factAlignment.\n` +
          `Expected one of: ${FACT_ALIGNMENTS.join(', ')}. factAlignment answers whether the ` +
          `blind stage's rederived reading addressed the fact the original line asserts — ` +
          `required so a targeting-collapse artifact can be told apart from a genuine content ` +
          `disagreement mechanically, from the ledger alone.`,
      );
    }
  }

  return {
    slicePath: input.slicePath,
    lineNumber: input.lineNumber,
    originalLine: input.originalLine,
    verdict: input.verdict,
    reasoning: input.reasoning,
    rederivedValue: input.rederivedValue,
    ...(input.originalReading !== undefined ? { originalReading: input.originalReading } : {}),
    ...(input.rederivedReading !== undefined
      ? { rederivedReading: input.rederivedReading }
      : {}),
    ...(input.factAlignment !== undefined && isFactAlignment(input.factAlignment)
      ? { factAlignment: input.factAlignment }
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
  } catch (err) {
    // 177-10 (closing WR-02/WR-10): this is the ONE "no rulebook/" message left in the module —
    // the redundant directory pre-check in `verifyDeriveRecheckCommand` is gone, and this is
    // the sole place the `--project` sentence lives. Only ENOENT means "does not exist"; any
    // other errno (EACCES, ENOTDIR, ...) is a real, different condition and must say so, never be
    // reported as a missing directory.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `No rulebook/ directory in ${projectDir}.\n` +
          `Pass --project <dir> to target the bs-project this check should read.`,
      );
    }
    throw new Error(
      `rulebook/ exists at ${rulebookDir} but could not be read (${code ?? 'unknown error'}).\n` +
        `Pass --project <dir> to target the bs-project this check should read, and confirm the ` +
        `directory is accessible.`,
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

/**
 * Leading blockquote markers, list bullets, and ordered-list markers, repeatable (a line can be
 * both quoted AND bulleted, e.g. `> - Derived (p.1): ...`) — stripped before every prefix test.
 * This is the ONE decoration-normalization site (`annotationBody`, immediately below); no caller
 * re-derives its own trim/strip logic.
 */
const LINE_DECORATION_RE = /^(?:[>\-*+]\s*|\d+\.\s+)*/;

/**
 * Trims `line` and strips any leading markdown decoration (blockquote markers, list bullets,
 * ordered-list markers), returning the annotation-testable body. `quoteLinesOnly` and
 * `enumerateDerivedLines` both route through this single function before testing any of the three
 * prefix regexes below, so the two can never diverge on what counts as decoration (177-08,
 * closing CR-01). Not applied to anything else — a directly-quoted sentence's own leading `"` is
 * never decoration and must never be stripped.
 */
export function annotationBody(line: string): string {
  return line.trim().replace(LINE_DECORATION_RE, '');
}

/**
 * Citation body widened to `\(p\.[^)]*\)` (WR-01) — matches `ingest-archive.ts`'s relabeller
 * exactly, so a multi-page citation (`Derived (p.1, continues on p.2):`) is recognized identically
 * by both modules. Defined in `derived-line-pattern.ts` (a dependency-free leaf module) and
 * re-exported here so this module's own consumers, and any existing importer of `DERIVED_LINE_RE`
 * from this file, keep working unchanged.
 */
export { DERIVED_LINE_RE };
const VISUAL_LINE_RE = /^Visual \(p\.[^)]*\)/i;
/**
 * A `Named-but-undefined` line is an ingest-time INFERENCE about undefined terminology, not
 * directly-quoted rulebook prose (177-RESEARCH.md's answer to Question 1 names it alongside
 * `Derived`/`Visual` as a line the blind-derivation payload must exclude entirely). Excluding it
 * is not required to satisfy this plan's `Derived (p.`/`Visual (p.` zero-leak assertions, but
 * leaving an inferential line in a payload whose entire purpose is "quote lines only" would
 * silently reintroduce the same anchoring risk decision 5 exists to prevent, one line at a time.
 */
const NAMED_BUT_UNDEFINED_LINE_RE = /^Named-but-undefined \(p\.[^)]*\)/i;

/** All three annotation families, for the payload-level construction-site backstop below. */
const ANY_ANNOTATION_LINE_RE = /Derived \(p\.|Visual \(p\.|Named-but-undefined \(p\./i;

/**
 * True when `line` (already `.trim()`ed) belongs in a "quote lines only" payload: not blank, not
 * a markdown heading, and not one of the three annotation-family lines (via `annotationBody`, the
 * single decoration-normalization site). This is the ONE predicate `quoteLinesOnly` and
 * `focusQuoteWindow` both route through, so the two can never diverge on what counts as a quote
 * line — the same single-choke-point shape `annotationBody` itself established (177-08).
 */
function isQuoteLine(line: string): boolean {
  if (line.length === 0 || line.startsWith('#')) return false;
  const body = annotationBody(line);
  return (
    !DERIVED_LINE_RE.test(body) && !VISUAL_LINE_RE.test(body) && !NAMED_BUT_UNDEFINED_LINE_RE.test(body)
  );
}

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
    .filter(isQuoteLine);
}

// -------------------------------------------------------------------------------------------
// focusQuoteWindow — quote-local passage narrowing (177-11, closing CR-07 together with
// blindDeriveHandle below)
// -------------------------------------------------------------------------------------------

/**
 * A bare `p.N, <label>:` citation header — the SAME shape `verify-classify.ts`'s own
 * (unexported) `CITATION_HEADER_RE` tests for. Not imported from there: that module's constant is
 * private, and duplicating a one-line regex literal here is cheaper than widening that module's
 * export surface for a single shared pattern.
 */
const CITATION_HEADER_RE = /^p\.\d+,.*:$/;

/**
 * A markdown heading — a passage boundary `focusQuoteWindow` treats identically to a citation
 * header (plan-checker's required fix, keyed to the real fixture
 * `174-FIXTURES/seven/live/01-definitions-and-components.md:33`). `quoteLinesOnly` already strips
 * headings entirely before any prefix test runs, so a heading carries no quote-line content of its
 * own — but it still marks a real section break in the ORIGINAL file, and a citation header from a
 * PRECEDING section must never be treated as governing a target line that sits in a different
 * section with no citation header of its own.
 */
const MARKDOWN_HEADING_RE = /^#/;

/**
 * Partitions `quoteLinesOnly(sliceText)` into the quote lines belonging to the target line's own
 * citation passage (`focus`) and everything else (`rest`) — positionally, from `sliceText`'s raw
 * line structure, never from `entry.text` (which this function never receives at all).
 *
 * The passage is: walk UPWARD from `lineNumber` to the nearest citation header, THEN walk DOWNWARD
 * from that header through the line before the next citation header, the next markdown heading, or
 * end of slice — whichever comes first.
 *
 * MARKDOWN HEADINGS ARE PASSAGE BOUNDARIES TOO, not just citation headers (plan-checker's required
 * fix): walking upward, a heading encountered BEFORE any citation header SEVERS the target from
 * whatever citation header sits above that heading — that header governs a different section and
 * must never be picked up as this target's passage. Proven against the real fixture
 * `174-FIXTURES/seven/live/01-definitions-and-components.md:33` (`Derived (p.1): Card art is
 * minimal...`, one of `177-PROOF.md` §3's own cited collapse artifacts): the nearest citation
 * header ABOVE line 33 is `p.1, Play Testers:` (line 28), but a `## Visual notes (p.1)` heading
 * (line 31) sits between them — without the heading-boundary check, the focus window would
 * silently attach line 33 to the semantically unrelated Play Testers passage. With it, this case
 * is correctly reported as the DEGRADED empty-focus case below, never a wrong-but-distinct one.
 *
 * Returns `{ focus: [], rest: quoteLinesOnly(sliceText) }` — the honest degraded case — when no
 * citation header governs the target line at all, whether because the target sits above the first
 * citation header in the slice, or because a heading severs it from one that would otherwise
 * apply. The caller (`buildBlindDerivePayload`) labels this explicitly in the payload rather than
 * silently presenting the whole slice as if it were the focus passage.
 */
export function focusQuoteWindow(
  sliceText: string,
  lineNumber: number,
): { focus: string[]; rest: string[] } {
  const rawLines = sliceText.split('\n').map((line) => line.trim());
  const targetIdx = lineNumber - 1;

  let headerIdx = -1;
  for (let i = targetIdx - 1; i >= 0; i--) {
    const line = rawLines[i];
    if (line === undefined) continue;
    if (MARKDOWN_HEADING_RE.test(line)) break; // severed — a heading governs first, stop scanning
    if (CITATION_HEADER_RE.test(line)) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return { focus: [], rest: quoteLinesOnly(sliceText) };
  }

  let boundaryIdx = rawLines.length;
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    if (CITATION_HEADER_RE.test(rawLines[i]) || MARKDOWN_HEADING_RE.test(rawLines[i])) {
      boundaryIdx = i;
      break;
    }
  }

  const focus: string[] = [];
  const rest: string[] = [];
  rawLines.forEach((line, i) => {
    if (!isQuoteLine(line)) return;
    if (i >= headerIdx && i < boundaryIdx) {
      focus.push(line);
    } else {
      rest.push(line);
    }
  });

  return { focus, rest };
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
      const body = annotationBody(line);
      if (!DERIVED_LINE_RE.test(body)) return;
      const entry: DerivedLineEntry = {
        slicePath: slice.path,
        lineNumber: index + 1,
        text: line,
      };
      if (isPresentationLine(body)) {
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
 * Returns a stable, opaque short hex digest of `${entry.slicePath}:${entry.lineNumber}` — the
 * ONLY target identifier a blind dispatch prompt may carry (177-11, closing CR-07). The same
 * entry always maps to the same handle; two different entries never collide within one slice's
 * candidate set (sha256 truncated to 12 hex chars, ~2^48 space, over a candidate count in the
 * tens per slice — collision risk is not a real concern at this scale). The mapping back to
 * `(slicePath, lineNumber)` lives with the orchestrator dispatching the prompt, never inside the
 * prompt itself — that is what makes the pointer unresolvable to the subagent holding it: nothing
 * a file-read tool could act on, because a hash is not a path.
 */
export function blindDeriveHandle(entry: DerivedLineEntry): string {
  return createHash('sha256')
    .update(`${entry.slicePath}:${entry.lineNumber}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Builds the blind-derivation dispatch prompt for ONE `Derived` line's slice. This is the SINGLE
 * construction site for that prompt — no caller may append to its output before dispatch.
 * `entry.text` — the original `Derived` line itself — is NEVER read or emitted here; the ONLY use
 * of `entry` is `blindDeriveHandle(entry)` (an opaque handle, not a path) and
 * `entry.lineNumber` fed positionally into `focusQuoteWindow` (which itself never reads
 * `entry.text` either — the partition is computed from `slice.text`'s own line structure).
 *
 * A derivation that has seen the original `Derived` line is not a second opinion, it is a
 * confirmation — it would report high agreement whether or not the original derivation was
 * sound. This function is where that independence guarantee is either upheld or broken. Three
 * things uphold it, all structural, none a prompt instruction alone (177-11, closing CR-07):
 *
 *   (a) `entry.text` is structurally absent from the assembled string — grep the source, it is
 *       never interpolated anywhere in this function;
 *   (b) the construction-site backstop below (177-08, unchanged) throws on any assembled payload
 *       still matching an annotation family, independent of which prefix regex missed it;
 *   (c) the target is identified ONLY by `blindDeriveHandle` — no resolvable `Slice:`/
 *       `Target line:` coordinate is ever emitted, so a subagent with file-read tools has nothing
 *       in the prompt to act on even if it tried.
 *
 * The payload is narrowed by `focusQuoteWindow` to the target's own citation passage where one can
 * be found (closing the targeting-collapse artifact `177-PROOF.md` §3 measured — every
 * multi-candidate slice in the real corpus previously re-deriving the same dominant fact
 * regardless of nominal target, because the raw line number carried no locatable meaning inside a
 * quote-only payload). When no citation passage governs the target line, the payload says so
 * explicitly and falls back to the full quote set labelled DEGRADED — never silently identical to
 * a case where narrowing succeeded.
 */
export function buildBlindDerivePayload(
  slice: { path: string; text: string },
  entry: DerivedLineEntry,
): string {
  const handle = blindDeriveHandle(entry);
  const { focus, rest } = focusQuoteWindow(slice.text, entry.lineNumber);

  const lines = [BLIND_DERIVE_TOKEN, `Target: ${handle}`];

  if (focus.length > 0) {
    lines.push(
      'Focus passage — the fact under test is the one THIS passage supports. Derive your answer',
      'from these lines. No Derived or Visual line from this slice, or any other slice, is',
      'included below or anywhere in this prompt:',
      ...focus,
      '',
      "Context — the rest of this slice's quoted content, for resolving terminology ONLY. This is",
      'NOT the passage under test:',
      ...rest,
    );
  } else {
    lines.push(
      'No citation-header passage could be located for this target line — it sits above the',
      "first citation header in its slice, or a section heading severs it from one that would",
      'otherwise apply. Falling back to the full slice below as DEGRADED context: every quote',
      'line here is background only, none of it is labelled as the passage under test. No',
      'Derived or Visual line from this slice, or any other slice, is included below or anywhere',
      'in this prompt:',
      ...rest,
    );
  }

  const payload = lines.join('\n');

  if (ANY_ANNOTATION_LINE_RE.test(payload)) {
    throw new Error(
      `buildBlindDerivePayload assembled a payload for ${entry.slicePath}:${entry.lineNumber} ` +
        `that still matches an annotation family (Derived (p./Visual (p./Named-but-undefined (p.).\n` +
        `The payload construction site, not the prompt text, is where independence is upheld — ` +
        `quoteLinesOnly()/annotationBody() missed a decoration form. Fix the strip filter; never ` +
        `relax this check to let the payload through.`,
    );
  }

  return payload;
}

// -------------------------------------------------------------------------------------------
// derivePayloadSet — the per-slice construction site that also computes the residual (177-11)
// -------------------------------------------------------------------------------------------

export interface DerivePayloadSetEntry {
  entry: DerivedLineEntry;
  payload: string;
  focus: string[];
  /**
   * Locations (`slicePath:lineNumber`) of OTHER candidates in this same slice whose focus passage
   * is byte-for-byte identical to this one's — computed mechanically, with no threshold and no
   * model involvement. Empty focus windows (the degraded case) are never counted as "shared" with
   * one another: two independently-degraded candidates are not proven to be about the same fact,
   * only that neither could be narrowed — a real passage collision requires a real, non-empty,
   * identical passage.
   */
  sharedFocusWith: string[];
  /** `true` exactly when `sharedFocusWith` is non-empty. */
  targetingAmbiguous: boolean;
}

/**
 * Builds every candidate's payload for ONE slice via `buildBlindDerivePayload`, and computes,
 * mechanically, which candidates share an identical non-empty focus passage. Two `Derived` lines
 * under the same citation passage are a case where no payload can distinguish them without
 * leaking the inference itself — that residual is real, and the correct engineering answer is to
 * REPORT it per-finding (`targetingAmbiguous`/`sharedFocusWith`), never to hide it behind a
 * payload that merely looks different because its opaque handle always differs.
 */
export function derivePayloadSet(
  slice: { path: string; text: string },
  candidates: DerivedLineEntry[],
): DerivePayloadSetEntry[] {
  const computed = candidates.map((entry) => ({
    entry,
    payload: buildBlindDerivePayload(slice, entry),
    focus: focusQuoteWindow(slice.text, entry.lineNumber).focus,
  }));

  return computed.map((c, i) => {
    const focusKey = c.focus.join('\n');
    const sharedFocusWith =
      focusKey.length === 0
        ? []
        : computed
            .filter((other, j) => j !== i && other.focus.join('\n') === focusKey)
            .map((other) => `${other.entry.slicePath}:${other.entry.lineNumber}`);
    return {
      entry: c.entry,
      payload: c.payload,
      focus: c.focus,
      sharedFocusWith,
      targetingAmbiguous: sharedFocusWith.length > 0,
    };
  });
}

// -------------------------------------------------------------------------------------------
// replaceDeriveVerdicts / recordDeriveVerdict / readDeriveVerdicts — the PROJECT-LEVEL ledger
// (decision 14; 177-09 closing CR-02/CR-04/CR-06)
// -------------------------------------------------------------------------------------------

const DERIVE_LEDGER_BEGIN = '<!-- boardsmith:derive-verdicts:begin -->';
const DERIVE_LEDGER_END = '<!-- boardsmith:derive-verdicts:end -->';

/**
 * The project-level ledger path — `rulebook/.derive-recheck/DERIVE-VERDICTS.md`. No `.verify/`
 * segment, no `runId` anywhere in this path: CHECK-04 has nothing to scope to a run (decision 14).
 */
function deriveVerdictsLedgerPath(projectDir: string): string {
  return join(projectDir, 'rulebook', '.derive-recheck', 'DERIVE-VERDICTS.md');
}

function deriveVerdictKey(r: Pick<DeriveVerdictRecord, 'slicePath' | 'lineNumber'>): string {
  return `${r.slicePath}:${r.lineNumber}`;
}

/**
 * Persists a batch of already-validated `DeriveVerdictRecord`s (every record MUST have already
 * passed through `createDeriveVerdictRecord` — this function accepts validated records and does
 * not re-parse verdict strings) to the project-level ledger, through `atomicWriteFile` — the ONE
 * atomic write path in the repo. `atomicWriteFile`'s temp-write-then-rename means no partial file
 * is ever observable.
 *
 * REPLACES the ENTIRE ledger body with exactly the `records` array supplied — this is a full
 * rewrite, not the callable the workflow uses (177-09, closing CR-06). `verify-game.md` Step 7
 * describes recording as something that happens PER `Derived` line; the obvious, documented call
 * pattern against this function would silently destroy every previously-recorded verdict on each
 * call. Use `recordDeriveVerdict` (singular) for that — it upserts through this function rather
 * than replacing directly. This function remains exported for the one legitimate full-rewrite use
 * case (e.g. re-seeding a ledger from a fresh batch) and for `recordDeriveVerdict`'s own use.
 *
 * Accepts no `runId` parameter (2-arity: `projectDir`, `records`) — the ledger path contains no
 * run-id segment.
 */
export async function replaceDeriveVerdicts(
  projectDir: string,
  records: DeriveVerdictRecord[],
): Promise<{ ledgerPath: string }> {
  const ledgerPath = deriveVerdictsLedgerPath(projectDir);
  const lines = records.map((r) => JSON.stringify(r));
  const content =
    `# Derive Verdicts (CHECK-04) — project-level, no run-id\n\n` +
    `${DERIVE_LEDGER_BEGIN}\n` +
    lines.join('\n') +
    (lines.length > 0 ? '\n' : '') +
    `${DERIVE_LEDGER_END}\n`;
  await fs.mkdir(dirname(ledgerPath), { recursive: true });
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
}

/**
 * Records ONE verdict, upserting by `slicePath:lineNumber` (177-09, closing CR-06): reads the
 * ledger's existing records, replaces any record already recorded for the same location (keeping
 * every other record untouched, in existing order, with the new record appended last so the
 * ledger diff stays reviewable), then writes the merged set through `replaceDeriveVerdicts` — so
 * there is still exactly ONE durable write path in the module, just no longer the destructive
 * default. This is the callable `verify-game.md` Step 7's per-line recording pattern actually
 * needs: calling it twice for two different lines leaves BOTH readable; calling it twice for the
 * SAME line leaves exactly one record, carrying the second call's content.
 */
export async function recordDeriveVerdict(
  projectDir: string,
  record: DeriveVerdictRecord,
): Promise<{ ledgerPath: string }> {
  const existing = await readDeriveVerdicts(projectDir);
  const merged = [
    ...existing.filter((r) => deriveVerdictKey(r) !== deriveVerdictKey(record)),
    record,
  ];
  return replaceDeriveVerdicts(projectDir, merged);
}

// -------------------------------------------------------------------------------------------
// verifyDeriveRecordCommand — the write surface (177-10, closing CR-05)
// -------------------------------------------------------------------------------------------

export interface VerifyDeriveRecordResult {
  record: DeriveVerdictRecord;
  ledgerPath: string;
}

/**
 * `boardsmith verify-derive-record` — the ONLY write surface for CHECK-04's ledger (177-10,
 * closing CR-05: `cli.ts` previously registered only the read-only `verify-derive-recheck`
 * report, so nothing outside a test file could ever populate a verdict — `verifyDeriveRecheckCommand`
 * would report every candidate `pending` forever).
 *
 * Parses `options`, delegates ALL verdict validation to `createDeriveVerdictRecord` (the one
 * choke point — this command adds no second validator), and persists through `recordDeriveVerdict`
 * (177-09's upsert-append callable — never `replaceDeriveVerdicts`, the destructive full-rewrite
 * path). Registers no `--run-id` (177-CONTEXT.md decision 14 — CHECK-04 is project-level) and no
 * `--force`/`--skip`/`--overwrite`/env-var bypass of any kind, matching every sibling write
 * command's posture (`verify-classify-record`, `verify-impact-adjudicate`).
 */
export async function verifyDeriveRecordCommand(
  options: {
    project?: string;
    slicePath?: string;
    lineNumber?: string | number;
    originalLine?: string;
    verdict?: string;
    reasoning?: string;
    rederivedValue?: string;
    originalReading?: string;
    rederivedReading?: string;
    sourceQuote?: string[];
    factAlignment?: string;
    json?: boolean;
  } = {},
): Promise<VerifyDeriveRecordResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  // Missing-option guards only — never a second pass over verdict semantics. Every check below is
  // "was the CLI flag supplied at all", not "is the supplied value a legal verdict" (that is
  // createDeriveVerdictRecord's job, delegated to below, never re-implemented here).
  if (!options.slicePath) {
    throw new Error('verify-derive-record requires --slice-path <path>.');
  }
  if (options.lineNumber === undefined) {
    throw new Error('verify-derive-record requires --line-number <n>.');
  }
  const lineNumber = Number(options.lineNumber);
  if (!Number.isFinite(lineNumber)) {
    throw new Error(`--line-number must be a number, got "${options.lineNumber}".`);
  }
  if (!options.originalLine) {
    throw new Error('verify-derive-record requires --original-line <text>.');
  }
  if (!options.rederivedValue) {
    throw new Error('verify-derive-record requires --rederived-value <text>.');
  }
  if (!options.verdict) {
    throw new Error(
      `verify-derive-record requires --verdict <${DERIVE_VERDICTS.join('|')}>.`,
    );
  }
  if (!options.reasoning) {
    throw new Error('verify-derive-record requires --reasoning <text>.');
  }

  const record = createDeriveVerdictRecord({
    slicePath: options.slicePath,
    lineNumber,
    originalLine: options.originalLine,
    verdict: options.verdict,
    reasoning: options.reasoning,
    rederivedValue: options.rederivedValue,
    originalReading: options.originalReading,
    rederivedReading: options.rederivedReading,
    sourceQuotes: options.sourceQuote,
    factAlignment: options.factAlignment,
  });

  const { ledgerPath } = await recordDeriveVerdict(projectDir, record);

  const result: VerifyDeriveRecordResult = { record, ledgerPath };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  console.log(
    chalk.green(
      `✓ Recorded derive verdict for ${record.slicePath}:${record.lineNumber}: ${record.verdict}`,
    ),
  );
  console.log(`  Ledger: ${ledgerPath}`);
  return result;
}

/**
 * Round-trips exactly what `replaceDeriveVerdicts`/`recordDeriveVerdict` wrote, including a
 * record whose verdict is `underivable`. Returns an empty array (never throws) when no ledger has
 * been written yet — a project that has never run `verify-derive-recheck`'s recording step has
 * nothing recorded, which is not a tool failure. Accepts no `runId` parameter (1-arity:
 * `projectDir`).
 *
 * RE-ENTERS `createDeriveVerdictRecord` ON EVERY PARSED LINE (177-09, closing CR-02): the module
 * header's "single choke point" claim was previously false for the read path — a hand-edited or
 * out-of-enum ledger record reached the report unvalidated, corrupting `verdictCounts` with a
 * `NaN`/`null` key. The ledger is a second entry path into `DeriveVerdictRecord`, not a bypass of
 * the type: a malformed JSON line throws one actionable message naming the ledger's relative path
 * and the 1-based record index (never a raw `SyntaxError`); a valid-JSON-but-invalid-record line
 * throws through `createDeriveVerdictRecord`'s own checks (out-of-enum verdict, missing evidence,
 * a forged fence, an unlawful pass-through re-adjudication) — never coerced with a default that
 * manufactures a valid-looking record.
 */
export async function readDeriveVerdicts(projectDir: string): Promise<DeriveVerdictRecord[]> {
  const ledgerPath = deriveVerdictsLedgerPath(projectDir);
  let text: string;
  try {
    text = await fs.readFile(ledgerPath, 'utf-8');
  } catch {
    return [];
  }
  const beginIdx = text.indexOf(DERIVE_LEDGER_BEGIN);
  const endIdx = text.indexOf(DERIVE_LEDGER_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Malformed derive-verdicts ledger at ${relative(projectDir, ledgerPath)}: missing ` +
        `begin/end fence.`,
    );
  }
  const relLedgerPath = relative(projectDir, ledgerPath);
  const body = text.slice(beginIdx + DERIVE_LEDGER_BEGIN.length, endIdx);
  const rawLines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return rawLines.map((line, i) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(
        `Malformed derive-verdicts ledger at ${relLedgerPath} (record ${i + 1}): not valid JSON.\n` +
          `Delete the file to re-run CHECK-04 from scratch.`,
      );
    }
    const r = raw as Record<string, unknown>;
    try {
      return createDeriveVerdictRecord({
        slicePath: String(r.slicePath ?? ''),
        lineNumber: Number(r.lineNumber),
        originalLine: String(r.originalLine ?? ''),
        verdict: String(r.verdict ?? ''),
        reasoning: String(r.reasoning ?? ''),
        rederivedValue: r.rederivedValue !== undefined ? String(r.rederivedValue) : '',
        originalReading: r.originalReading !== undefined ? String(r.originalReading) : undefined,
        rederivedReading:
          r.rederivedReading !== undefined ? String(r.rederivedReading) : undefined,
        sourceQuotes: Array.isArray(r.sourceQuotes) ? (r.sourceQuotes as string[]) : [],
        factAlignment: r.factAlignment !== undefined ? String(r.factAlignment) : undefined,
      });
    } catch (err) {
      throw new Error(
        `Malformed derive-verdicts ledger at ${relLedgerPath} (record ${i + 1}): ` +
          `${(err as Error).message}\nDelete the file to re-run CHECK-04 from scratch.`,
      );
    }
  });
}

// -------------------------------------------------------------------------------------------
// verifyDeriveRecheckCommand — the report command (decisions 8, 15)
// -------------------------------------------------------------------------------------------

export interface DeriveRecheckFinding {
  slicePath: string;
  lineNumber: number;
  /** The original `Derived (p.N): ...` line, verbatim. */
  originalLine: string;
  verdict: DeriveVerdict | 'pending';
  reasoning: string;
  /** Present, verbatim, on every `disagrees` finding (decision 8). */
  originalReading?: string;
  /** Present, verbatim, on every `disagrees` finding (decision 8). */
  rederivedReading?: string;
  /** Present on every `agrees`/`disagrees` finding (177-11) — a FIELD, never a fifth verdict. */
  factAlignment?: FactAlignment;
  /**
   * `true` when another candidate in this slice shares this candidate's exact focus passage
   * (177-11) — a residual `focusQuoteWindow` cannot resolve without leaking the withheld
   * inference. Reported per-finding, never absorbed into `verdictCounts`.
   */
  targetingAmbiguous: boolean;
  /** Locations of the other candidate(s) sharing this one's focus passage; empty when unambiguous. */
  sharedFocusWith: string[];
}

export interface VerifyDeriveRecheckResult {
  project: string;
  /** Every `Derived` line surviving `isPresentationLine` exclusion — the subagent's candidate set. */
  enumeratedCount: number;
  /** `Derived` lines the mechanical presentation filter excluded (reported, not silently dropped). */
  presentationExcludedCount: number;
  verdictCounts: Record<DeriveVerdict, number>;
  findings: DeriveRecheckFinding[];
  /**
   * One human-readable line per ledger record whose `originalLine` no longer matches the current
   * candidate's text at that location (177-10, closing CR-03) — the line was edited or shifted
   * since the verdict was recorded, so the finding reports `pending` rather than inheriting a
   * verdict for text that was never re-derived.
   */
  staleRecords: string[];
  /**
   * One human-readable line per ledger record whose location matches no current candidate
   * (177-10, closing WR-03) — a deleted slice, a moved line, or a line the widened presentation
   * markers now exclude. Never silently dropped from the report.
   */
  orphanedRecords: string[];
  /**
   * Count of candidates whose focus passage is shared with at least one other candidate in the
   * same slice (177-11) — computed mechanically from `derivePayloadSet`, independent of any
   * recorded verdict. A non-zero count names a real residual: those candidates cannot be
   * distinguished by payload alone without leaking the withheld inference.
   */
  targetingAmbiguousCount: number;
  /**
   * `disagrees` findings whose recorded `factAlignment` is `different-fact` (177-11) — the blind
   * stage addressed a DIFFERENT fact than the one under test, a targeting artifact rather than a
   * content finding. Reported separately from `genuineDisagreements`, never folded into it.
   */
  offTargetDisagreements: number;
  /**
   * `disagrees` findings whose recorded `factAlignment` is `same-fact` (177-11) — the blind stage
   * addressed the SAME fact under test and still reached an incompatible reading. This is the
   * class of finding SC-2 promises a designer.
   */
  genuineDisagreements: number;
}

function emptyDeriveVerdictCounts(): Record<DeriveVerdict, number> {
  const counts = {} as Record<DeriveVerdict, number>;
  for (const v of DERIVE_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * Renders a `disagrees` finding's `originalReading`/`rederivedReading` for the human report
 * (177-10, closing WR-06). `createDeriveVerdictRecord` + the read path's revalidation
 * (177-09, CR-02) together mean an empty reading cannot reach a `disagrees` finding through any
 * path this module exposes today — but a designer-facing report must never interpolate a
 * possibly-undefined value directly (that path is what produced the literal string `undefined`),
 * so the printer always routes through this explicit fallback rather than trusting the type.
 */
export function formatReading(value: string | undefined): string {
  return value ?? '(missing — re-run the comparison dispatch)';
}

/**
 * `boardsmith verify-derive-recheck` — CHECK-04's report: enumerates every live-tree `Derived`
 * line, joins each surviving candidate to whatever verdict `recordDeriveVerdict` has already
 * persisted to the project-level ledger, and reports one finding per candidate (verdict `pending`
 * when nothing has been recorded for it yet). `verdictCounts` includes all four `DERIVE_VERDICTS`
 * with zeros written explicitly — never an omitted key for a verdict that happened not to occur.
 *
 * A `disagrees` finding always carries BOTH `originalReading` and `rederivedReading` verbatim
 * (decision 8 — SC-2 requires citing both derivations, and `createDeriveVerdictRecord` already
 * guarantees neither field is empty on a `disagrees` record reaching the ledger).
 *
 * Runs project-wide with no `--run-id` and no staged run present (decision 14) — this is a
 * READ-ONLY report: it never calls `recordDeriveVerdict`/`replaceDeriveVerdicts` itself. Findings exit 0 (this module
 * never sets `process.exitCode` anywhere — a disagreement is a finding, not a gate, decision 15).
 * Only an unreadable project/rulebook throws, with a single actionable line naming `--project` —
 * no stack frame, no `.ts:` reference.
 */
export async function verifyDeriveRecheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<VerifyDeriveRecheckResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  // 177-10 (closing WR-10): the redundant directory pre-check that used to live here is gone —
  // it succeeded for a regular file named `rulebook` and so never established what its message
  // claimed. `readLiveSlices` is now the ONE "no rulebook/" throw site in this module (see also
  // WR-02, closed there).
  const slices = await readLiveSlices(projectDir);
  const { candidates, excluded } = enumerateDerivedLines(slices);
  const recorded = await readDeriveVerdicts(projectDir);
  const recordedByLocation = new Map(recorded.map((r) => [deriveVerdictKey(r), r] as const));
  const candidateLocations = new Set(candidates.map((c) => deriveVerdictKey(c)));

  // 177-11: targetingAmbiguous/sharedFocusWith are computed per-SLICE (a shared focus passage is
  // only meaningful among candidates that came from the same slice), via the same
  // derivePayloadSet the dispatch driver itself calls — never a second, divergent computation.
  const sliceByPath = new Map(slices.map((s) => [s.path, s] as const));
  const candidatesBySlice = new Map<string, DerivedLineEntry[]>();
  for (const c of candidates) {
    const list = candidatesBySlice.get(c.slicePath) ?? [];
    list.push(c);
    candidatesBySlice.set(c.slicePath, list);
  }
  const ambiguityByLocation = new Map<string, { targetingAmbiguous: boolean; sharedFocusWith: string[] }>();
  for (const [slicePath, sliceCandidates] of candidatesBySlice) {
    const slice = sliceByPath.get(slicePath);
    if (!slice) continue;
    for (const payloadEntry of derivePayloadSet(slice, sliceCandidates)) {
      ambiguityByLocation.set(deriveVerdictKey(payloadEntry.entry), {
        targetingAmbiguous: payloadEntry.targetingAmbiguous,
        sharedFocusWith: payloadEntry.sharedFocusWith,
      });
    }
  }

  const verdictCounts = emptyDeriveVerdictCounts();
  const staleRecords: string[] = [];
  let offTargetDisagreements = 0;
  let genuineDisagreements = 0;
  const findings: DeriveRecheckFinding[] = candidates.map((entry) => {
    const record = recordedByLocation.get(deriveVerdictKey(entry));
    const ambiguity = ambiguityByLocation.get(deriveVerdictKey(entry)) ?? {
      targetingAmbiguous: false,
      sharedFocusWith: [],
    };
    // 177-10 (closing CR-03): the join is on LOCATION + TEXT, never location alone. A record
    // whose `originalLine` no longer matches the current candidate's text was recorded against
    // text that has since been edited or shifted — inheriting its verdict would report a false
    // confirmation of text that was never re-derived. Report it `pending` and surface the
    // mismatch in `staleRecords` instead of silently reusing the stale verdict.
    if (record && record.originalLine === entry.text) {
      verdictCounts[record.verdict]++;
      if (record.verdict === 'disagrees') {
        if (record.factAlignment === 'different-fact') offTargetDisagreements++;
        else if (record.factAlignment === 'same-fact') genuineDisagreements++;
      }
      return {
        slicePath: entry.slicePath,
        lineNumber: entry.lineNumber,
        originalLine: entry.text,
        verdict: record.verdict,
        reasoning: record.reasoning,
        ...(record.originalReading !== undefined
          ? { originalReading: record.originalReading }
          : {}),
        ...(record.rederivedReading !== undefined
          ? { rederivedReading: record.rederivedReading }
          : {}),
        ...(record.factAlignment !== undefined ? { factAlignment: record.factAlignment } : {}),
        ...ambiguity,
      };
    }
    if (record) {
      staleRecords.push(
        `${entry.slicePath}:${entry.lineNumber} has a recorded verdict for different text ` +
          `("${record.originalLine}") — reporting it pending, never inheriting a verdict for a ` +
          `line that changed.`,
      );
    }
    return {
      slicePath: entry.slicePath,
      lineNumber: entry.lineNumber,
      originalLine: entry.text,
      verdict: 'pending' as const,
      reasoning: '',
      ...ambiguity,
    };
  });

  // 177-10 (closing WR-03): a ledger record whose location matches no current candidate (a
  // deleted slice, a moved line, a line the widened presentation markers now exclude) is reported
  // as an orphan, never silently discarded — enumerate-and-report, the module's stated posture.
  const orphanedRecords = recorded
    .filter((r) => !candidateLocations.has(deriveVerdictKey(r)))
    .map(
      (r) =>
        `${r.slicePath}:${r.lineNumber} has a recorded verdict ("${r.verdict}") for a location ` +
        `that matches no current candidate.`,
    );

  const targetingAmbiguousCount = findings.filter((f) => f.targetingAmbiguous).length;

  const result: VerifyDeriveRecheckResult = {
    project: projectDir,
    enumeratedCount: candidates.length,
    presentationExcludedCount: excluded.length,
    verdictCounts,
    findings,
    staleRecords,
    orphanedRecords,
    targetingAmbiguousCount,
    offTargetDisagreements,
    genuineDisagreements,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(
      `✓ Derive re-check — ${candidates.length} rule-bearing candidate(s), ` +
        `${excluded.length} presentation-excluded`,
    ),
  );
  for (const v of DERIVE_VERDICTS) {
    console.log(`  ${v}: ${verdictCounts[v]}`);
  }
  console.log(`  Genuine disagreements (same-fact): ${genuineDisagreements}`);
  console.log(`  Off-target disagreements (different-fact, targeting artifact): ${offTargetDisagreements}`);
  console.log(`  Targeting-ambiguous candidates (shared focus passage): ${targetingAmbiguousCount}`);
  for (const finding of findings) {
    if (finding.verdict === 'disagrees') {
      console.log(chalk.yellow(`  ⚠ DISAGREES — ${finding.slicePath}:${finding.lineNumber}`));
      console.log(`    Original:   ${formatReading(finding.originalReading)}`);
      console.log(`    Rederived:  ${formatReading(finding.rederivedReading)}`);
      console.log(`    Reasoning:  ${finding.reasoning}`);
      console.log(`    FactAlignment: ${finding.factAlignment ?? '(missing)'}`);
    }
    if (finding.targetingAmbiguous) {
      console.log(
        chalk.yellow(
          `  ⚠ TARGETING-AMBIGUOUS — ${finding.slicePath}:${finding.lineNumber} shares its ` +
            `focus passage with: ${finding.sharedFocusWith.join(', ')}`,
        ),
      );
    }
  }
  for (const stale of staleRecords) {
    console.log(chalk.yellow(`  ⚠ STALE — ${stale}`));
  }
  for (const orphan of orphanedRecords) {
    console.log(chalk.yellow(`  ⚠ ORPHANED — ${orphan}`));
  }

  return result;
}
