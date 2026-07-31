import { createHash } from 'node:crypto';
import { computeVerificationScope, SCOPE_FULL } from './chunk-provenance.js';
import { quoteLinesOnly } from './verify-derive-recheck.js';

/**
 * `verify-enumerate.ts` — CHECK-04's REPLACEMENT mechanical core (177-EXPERIMENTS/README.md
 * "Direction"). Per-line blind re-derivation asked an unanswerable question: you cannot say
 * "re-derive THIS fact" without naming the fact, which is the one thing that must stay hidden.
 * The measured replacement has no targeting problem because nobody aims at a target: two models
 * independently enumerate every fact a passage supports, a reconciler matches the two lists, and
 * facts found by both are well-supported.
 *
 * THIS MODULE IS PURE COMPUTATION, NO DISPATCH, NO CLI. It builds the enumerator payload and
 * validates a reconciler's output; it never calls a model and is never registered on the CLI
 * (that is later work, tracked outside this plan). Every exported function here is either a pure
 * function or an `async` read of already-on-disk provenance state — there is no network call, no
 * timer, and no `process.env` read anywhere in this file.
 *
 * THREE MEASURED FAILURE MODES DROVE THIS MODULE'S SHAPE, each closed by a specific mechanism:
 *
 *   1. THE RECONCILER FABRICATES (measured twice — credited "5 cards each" to both enumerators
 *      when one never stated it; invented arithmetic operand grounding on an unrelated pairing).
 *      Closed by `validateGrounding`: a genuine "found by both" claim must carry a verbatim quote
 *      the reconciler attributes to EACH enumerator's list, and this module mechanically checks
 *      each quote is actually traceable to that list — a string check, never a judgment call
 *      delegated back to a model.
 *
 *   2. ARITHMETIC MUST HAPPEN IN CODE, NEVER IN A MODEL. `composeArithmeticClaim` is the ONLY
 *      place a numeric composition happens in this module, and it never GENERATES a composition —
 *      it only CHECKS one that the `Derived` line under test already states, conservatively
 *      (177-EXPERIMENTS/README.md's measured failure: a model freely composed "7 players x 10
 *      cards = 70 cards distributed", a quantity the rules never treat as meaningful). It also
 *      refuses outright when any operand is stated as approximate — the measured "about 7
 *      minutes" x 7 = "49 minutes" false-precision fabrication.
 *
 *   3. AN INFERENCE CANNOT BE JUDGED AGAINST UNVERIFIED QUOTES (the CORRECTION in
 *      177-EXPERIMENTS/README.md: `seven:11`'s `Derived` line was CORRECT, but the quote line
 *      above it was truncated, and the design confidently reported the correct inference as
 *      contradicted). Closed by `QuoteVerifiedProvenance`, a class with a PRIVATE constructor —
 *      the only way to obtain an instance is `QuoteVerifiedProvenance.obtain(projectDir)`, which
 *      composes `chunk-provenance.ts`'s EXISTING `computeVerificationScope` (the rulebook
 *      source-hash comparison — not a second provenance notion). `classifyDerivedLines` requires
 *      this value (or its explicit absence, `null`) as a parameter for every "suspect"
 *      (uncorroborated/contradicted) finding; a caller that never verified the source cannot
 *      construct a suspect finding at all — it is downgraded to `quote-unverified` mechanically,
 *      not by a convention a caller could forget to follow.
 *
 * HONESTY NOTE ON WHAT IS STRUCTURAL VERSUS PROBABILISTIC (per this plan's honesty-discipline
 * requirement): the annotation-line backstop in `buildEnumeratorPayload`, the fact-grounding
 * check in `validateGrounding`, and the private-constructor provenance guard are all STRUCTURAL —
 * they cannot be satisfied by accident or bypassed by a forgetful caller. The text-similarity
 * matcher underlying grounding (`isTolerantMatch`) is DELIBERATELY PROBABILISTIC — it tolerates
 * whitespace/punctuation/case/minor-wording restatement so a genuine paraphrase is not rejected as
 * fabrication, and the threshold that draws that line is a documented judgment call (see
 * `MIN_MATCH_LENGTH` below), not a measured constant. Treat it as a heuristic, not a guarantee.
 */

// -------------------------------------------------------------------------------------------
// buildEnumeratorPayload — quote-lines-only, backstopped (177-EXPERIMENTS/README.md Finding 3)
// -------------------------------------------------------------------------------------------

/** Handshake token proving a dispatch prompt was copied, not composed from memory. */
export const ENUMERATE_TOKEN = 'BS-ENUMERATE-V1';

/**
 * Duplicated from `verify-derive-recheck.ts`'s private `ANY_ANNOTATION_LINE_RE` rather than
 * imported — that constant is not exported (mirrors `chunk-provenance.ts`'s own precedent of
 * duplicating a private one-line regex, e.g. `CITATION_HEADER_RE`, rather than widening a
 * sibling module's export surface for a single shared pattern). Any of the three annotation
 * families anywhere in an assembled enumerator payload is a leak this backstop must catch,
 * independent of which upstream filter missed it.
 */
const ANY_ANNOTATION_LINE_RE = /Derived \(p\.|Visual \(p\.|Named-but-undefined \(p\./i;

/**
 * Builds the dual-enumerator dispatch payload for ONE slice: quote lines only, via
 * `quoteLinesOnly` (`verify-derive-recheck.ts`) — the SAME decoration-tolerant, backstop-proofed
 * filter CHECK-04's blind-derivation payload uses, reused rather than re-derived so the two
 * modules can never diverge on what counts as a quote line. Unlike the retired design, this
 * payload names NO target and hides NOTHING beyond the three annotation families — the whole
 * point of dual enumeration is that nobody aims at a withheld fact, so there is nothing else to
 * strip.
 *
 * Throws (construction-site backstop, mirroring `buildBlindDerivePayload`) if the assembled
 * payload still matches an annotation family after `quoteLinesOnly` — a decoration form neither
 * filter anticipated must fail loudly, never leak silently into a dispatch prompt.
 */
export function buildEnumeratorPayload(slice: { path: string; text: string }): string {
  const quotes = quoteLinesOnly(slice.text);
  const lines = [ENUMERATE_TOKEN, `Slice: ${slice.path}`, '', ...quotes];
  const payload = lines.join('\n');

  if (ANY_ANNOTATION_LINE_RE.test(payload)) {
    throw new Error(
      `buildEnumeratorPayload assembled a payload for ${slice.path} that still matches an ` +
        `annotation family (Derived (p./Visual (p./Named-but-undefined (p.).\n` +
        `The payload construction site, not the prompt text, is where the quote-only guarantee ` +
        `is upheld — quoteLinesOnly() missed a decoration form. Fix the strip filter; never relax ` +
        `this check to let the payload through.`,
    );
  }

  return payload;
}

// -------------------------------------------------------------------------------------------
// EnumeratedFact — the structured fact record
// -------------------------------------------------------------------------------------------

/**
 * A structured numeric value. `approximate` is load-bearing (177-EXPERIMENTS/README.md's
 * measured "about 7 minutes" x 7 = "49 minutes" false-precision fabrication): code must refuse to
 * compose an approximate value into a precise conclusion, and `composeArithmeticClaim` is the one
 * place that refusal is enforced.
 */
export interface NumericValue {
  magnitude: number;
  unit: string;
  /** True when the source text stated this value with a hedge word ("about", "roughly", "~"). */
  approximate: boolean;
}

export interface EnumeratedFact {
  /** Stable, deterministic — derived from `statement` + `sourceSentence`, never random. */
  id: string;
  statement: string;
  /** The source sentence this fact was drawn from, verbatim (or as close as the enumerator gets). */
  sourceSentence: string;
  numericValue?: NumericValue;
  /** Which slice this fact was enumerated from, for traceability. Optional — not every caller needs it. */
  slicePath?: string;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function validateNumericValue(value: NumericValue, context: string): void {
  if (!isFiniteNumber(value.magnitude)) {
    throw new Error(`${context}: numericValue.magnitude must be a finite number, got ${String(value.magnitude)}.`);
  }
  if (typeof value.unit !== 'string' || value.unit.trim().length === 0) {
    throw new Error(`${context}: numericValue.unit must be a non-empty string.`);
  }
  if (typeof value.approximate !== 'boolean') {
    throw new Error(`${context}: numericValue.approximate must be a boolean.`);
  }
}

/**
 * Validates and constructs an `EnumeratedFact`. This is the ONE construction site for a fact
 * record — every fact this module accepts elsewhere (`validateGrounding`, `composeArithmeticClaim`,
 * `classifyDerivedLines`) is expected to have passed through this constructor first, so a
 * malformed numeric value can never reach an arithmetic composition unvalidated.
 *
 * The id is DETERMINISTIC (sha256 of `${statement}\n${sourceSentence}`, truncated), never random —
 * two independently-constructed facts describing the same statement/sentence pair collide on id
 * by design, which is a useful (not accidental) property for de-duplication callers may want, but
 * is NOT what `validateGrounding` relies on for matching (that uses tolerant text matching,
 * because two independent enumerators will not phrase identical facts byte-for-byte).
 */
export function createEnumeratedFact(input: {
  statement: string;
  sourceSentence: string;
  numericValue?: NumericValue;
  slicePath?: string;
}): EnumeratedFact {
  if (input.statement.trim().length === 0) {
    throw new Error('createEnumeratedFact requires a non-empty statement.');
  }
  if (input.sourceSentence.trim().length === 0) {
    throw new Error('createEnumeratedFact requires a non-empty sourceSentence.');
  }
  if (input.numericValue !== undefined) {
    validateNumericValue(input.numericValue, 'createEnumeratedFact');
  }

  const id = createHash('sha256')
    .update(`${input.statement}\n${input.sourceSentence}`)
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    statement: input.statement,
    sourceSentence: input.sourceSentence,
    ...(input.numericValue !== undefined ? { numericValue: input.numericValue } : {}),
    ...(input.slicePath !== undefined ? { slicePath: input.slicePath } : {}),
  };
}

// -------------------------------------------------------------------------------------------
// Tolerant-but-not-loose text matching — the shared primitive behind grounding
// -------------------------------------------------------------------------------------------

/**
 * Lowercases, collapses whitespace, and strips punctuation that carries no semantic content
 * (commas, periods, quotes, brackets). Digits and words are preserved verbatim — a numeric
 * fabrication ("5 cards" vs "7 cards") must NEVER normalize away into the same string, because
 * that is exactly the class of fabrication this module exists to catch (177-EXPERIMENTS/README.md's
 * measured "5 cards each" credited to both enumerators when one never stated it).
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?"'()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Below this normalized length, a containment match is refused outright. A short substring like
 * "guard" would spuriously "match" any fact that merely mentions guards at all — loose enough to
 * rubber-stamp a fabrication, which is the one failure mode this module cannot tolerate. This is a
 * documented judgment call, not a measured constant: raising it makes benign short-restatement
 * matches fail (too strict, the design becomes unusable per this plan's own instructions);
 * lowering it reopens the fabrication hole. 12 characters was chosen because it exceeds any single
 * common short-noun match ("guard card" is 10) while still permitting a short but specific
 * restatement ("seven bonus cards" is 18) to match.
 */
const MIN_MATCH_LENGTH = 12;

/**
 * True when `quote` and `candidate` are the same fact, tolerating benign restatement (whitespace,
 * punctuation, case, minor wording) but refusing anything shorter than `MIN_MATCH_LENGTH`
 * normalized characters and anything that is not an exact match or a containment match. This is
 * deliberately NOT a fuzzy/edit-distance matcher — edit distance would tolerate a single-digit
 * numeric substitution ("5 cards" vs "7 cards" is edit-distance 1), which is precisely the
 * fabrication class this module must catch. Containment-of-normalized-strings is stricter: every
 * word of the shorter string must appear, in order, inside the longer one.
 */
function isTolerantMatch(quote: string, candidate: string): boolean {
  const nq = normalizeForMatch(quote);
  const nc = normalizeForMatch(candidate);
  if (nq.length === 0 || nc.length === 0) return false;
  if (nq === nc) return true;
  if (nq.length < MIN_MATCH_LENGTH || nc.length < MIN_MATCH_LENGTH) return false;
  return nq.includes(nc) || nc.includes(nq);
}

// -------------------------------------------------------------------------------------------
// validateGrounding — the mechanical core (177-EXPERIMENTS/README.md Finding 3's fix)
// -------------------------------------------------------------------------------------------

/**
 * A reconciler's claim that ONE fact was found by both enumerators. `quotedFromA`/`quotedFromB`
 * are the reconciler's own attribution of what each enumerator's list actually said — REQUIRED,
 * not optional, because requiring the reconciler to commit to a specific quote from each side is
 * what makes fabrication mechanically checkable at all. A reconciler that free-associates a
 * "corroborated" statement with no quote to check against cannot be validated; this module
 * therefore has no code path that accepts an unquoted "both" claim.
 */
export interface ReconcilerBothClaim {
  /** The reconciler's own synthesized description of the corroborated fact. */
  statement: string;
  quotedFromA: string;
  quotedFromB: string;
}

/** A "both" claim that passed grounding: both quotes are genuinely traceable to their source list. */
export interface GroundedBothFact {
  id: string;
  statement: string;
  quotedFromA: string;
  quotedFromB: string;
  matchedFactA: EnumeratedFact;
  matchedFactB: EnumeratedFact;
}

export interface GroundingRejection {
  claim: ReconcilerBothClaim;
  reason: string;
}

export interface GroundingResult {
  grounded: GroundedBothFact[];
  rejected: GroundingRejection[];
}

function findMatch(quote: string, list: EnumeratedFact[]): EnumeratedFact | undefined {
  return list.find(
    (fact) => isTolerantMatch(quote, fact.statement) || isTolerantMatch(quote, fact.sourceSentence),
  );
}

/**
 * The mechanical core of this module. Given enumerator A's list, enumerator B's list, and a
 * reconciler's claimed "both" bucket, verifies MECHANICALLY that every claim is genuinely
 * traceable to text present in BOTH lists — a string check, never a judgment call. A claim whose
 * `quotedFromA` matches nothing in `listA`, or whose `quotedFromB` matches nothing in `listB`, is
 * REJECTED AND REPORTED (never silently dropped) — a fabricating reconciler is a signal worth
 * surfacing, per this plan's requirements.
 *
 * Rejection is reported per-claim with a specific, actionable reason naming which side's quote
 * failed to ground — this is the direct fix for the measured "5 cards each" fabrication: had the
 * reconciler been forced to name a `quotedFromB` for that claim, and had that quote been checked
 * against B's actual list, it would have been rejected here instead of silently accepted.
 */
export function validateGrounding(
  listA: EnumeratedFact[],
  listB: EnumeratedFact[],
  claimedBoth: ReconcilerBothClaim[],
): GroundingResult {
  const grounded: GroundedBothFact[] = [];
  const rejected: GroundingRejection[] = [];

  for (const claim of claimedBoth) {
    const matchA = findMatch(claim.quotedFromA, listA);
    if (!matchA) {
      rejected.push({
        claim,
        reason:
          `quotedFromA ("${claim.quotedFromA}") does not match any fact in enumerator A's list — ` +
          `the reconciler attributed text to A that A never stated.`,
      });
      continue;
    }
    const matchB = findMatch(claim.quotedFromB, listB);
    if (!matchB) {
      rejected.push({
        claim,
        reason:
          `quotedFromB ("${claim.quotedFromB}") does not match any fact in enumerator B's list — ` +
          `the reconciler attributed text to B that B never stated.`,
      });
      continue;
    }

    grounded.push({
      id: createHash('sha256').update(`grounded:${matchA.id}:${matchB.id}`).digest('hex').slice(0, 16),
      statement: claim.statement,
      quotedFromA: claim.quotedFromA,
      quotedFromB: claim.quotedFromB,
      matchedFactA: matchA,
      matchedFactB: matchB,
    });
  }

  return { grounded, rejected };
}

// -------------------------------------------------------------------------------------------
// composeArithmeticClaim — arithmetic composed in code only (177-EXPERIMENTS/README.md Finding 3)
// -------------------------------------------------------------------------------------------

export type ArithmeticOp = 'add' | 'subtract' | 'multiply' | 'divide';

/**
 * A composed numeric fact — deliberately a DISTINCT shape from `GroundedBothFact`, never merged
 * into the same bucket, per this plan's requirement that composed vs directly-corroborated facts
 * must never share a bucket. `operandIds` names exactly which `GroundedBothFact`s were composed,
 * so a consumer can always trace a composed result back to its corroborated inputs.
 */
export interface ComposedFact {
  id: string;
  statement: string;
  value: NumericValue;
  operation: ArithmeticOp;
  operandIds: string[];
  /** The `Derived` line's verbatim text this composition was checked against — never generated from. */
  claimText: string;
}

export type ComposeOutcome = { ok: true; composed: ComposedFact } | { ok: false; reason: string };

function reduceOperation(op: ArithmeticOp, magnitudes: number[]): number {
  switch (op) {
    case 'add':
      return magnitudes.reduce((a, b) => a + b, 0);
    case 'subtract':
      return magnitudes.reduce((a, b) => a - b);
    case 'multiply':
      return magnitudes.reduce((a, b) => a * b, 1);
    case 'divide':
      return magnitudes.reduce((a, b) => a / b);
  }
}

/** Tolerance for the claimed-vs-computed comparison — accommodates float division only. */
const ARITHMETIC_EPSILON = 1e-9;

/**
 * Composes numeric facts that are ALL corroborated (in `both` and grounded — enforced by the
 * `GroundedBothFact` type, which only `validateGrounding` can produce) into a derived quantity,
 * and verifies the result against a CLAIMED result. This function CHECKS a proposed composition;
 * it never GENERATES one — `operation` and `claimedResult` are always supplied by the caller,
 * sourced from the `Derived` line under test, never invented here. That is the conservative
 * answer to 177-EXPERIMENTS/README.md's measured failure (a model freely composing "7 players x
 * 10 cards = 70 cards distributed", a quantity the rules never treat as meaningful): verifying a
 * STATED claim is well-posed; generating meaningful ones is not, so this module does not attempt
 * the latter.
 *
 * Refuses (returns `{ ok: false, reason }`, never throws — a failed composition is an expected
 * outcome, not a bug) when:
 *   - fewer than two operands are supplied;
 *   - any operand's matched facts (A and B) disagree on numeric value — an inconsistent operand
 *     cannot be trusted as an input;
 *   - any operand carries no numeric value on either matched fact;
 *   - any operand is stated as approximate — refuses composing an approximate value into a
 *     precise conclusion (the measured "about 7 minutes" x 7 = "49 minutes" fabrication);
 *   - the Derived line under test does not literally mention an operand's magnitude — the
 *     mechanical stand-in for "the source material states this relationship" (conservative: a
 *     real relationship not literally restated as digits in the Derived line is reported
 *     unverifiable rather than composed);
 *   - the computed result does not match the claimed result (within float tolerance).
 */
export function composeArithmeticClaim(input: {
  derivedLineText: string;
  operation: ArithmeticOp;
  operands: GroundedBothFact[];
  claimedResult: NumericValue;
}): ComposeOutcome {
  const { derivedLineText, operation, operands, claimedResult } = input;

  validateNumericValue(claimedResult, 'composeArithmeticClaim.claimedResult');

  if (operands.length < 2) {
    return { ok: false, reason: 'composeArithmeticClaim requires at least two operands.' };
  }

  const operandValues: NumericValue[] = [];
  for (const op of operands) {
    const valueA = op.matchedFactA.numericValue;
    const valueB = op.matchedFactB.numericValue;
    if (valueA && valueB) {
      const disagree =
        valueA.magnitude !== valueB.magnitude ||
        valueA.unit !== valueB.unit ||
        valueA.approximate !== valueB.approximate;
      if (disagree) {
        return {
          ok: false,
          reason:
            `Operand "${op.statement}"'s two matched facts disagree on numeric value ` +
            `(A: ${valueA.magnitude} ${valueA.unit}, B: ${valueB.magnitude} ${valueB.unit}) — ` +
            `refusing to compose from an inconsistent operand.`,
        };
      }
    }
    const value = valueA ?? valueB;
    if (!value) {
      return {
        ok: false,
        reason: `Operand "${op.statement}" carries no numeric value on either matched fact — cannot compose.`,
      };
    }
    if (value.approximate) {
      return {
        ok: false,
        reason:
          `Operand "${op.statement}" is stated as approximate (${value.magnitude} ${value.unit}) — ` +
          `composing an approximate operand into a precise conclusion is exactly the false-` +
          `precision fabrication this module exists to prevent.`,
      };
    }
    operandValues.push(value);
  }

  for (const value of operandValues) {
    if (!derivedLineText.includes(String(value.magnitude))) {
      return {
        ok: false,
        reason:
          `The Derived line under test does not mention the operand value ${value.magnitude} — ` +
          `refusing to compose a relationship the line itself never states. This function checks a ` +
          `claimed composition; it does not generate new ones.`,
      };
    }
  }

  const computed = reduceOperation(operation, operandValues.map((v) => v.magnitude));
  if (Math.abs(computed - claimedResult.magnitude) > ARITHMETIC_EPSILON) {
    return {
      ok: false,
      reason:
        `Computed ${computed} from operands via "${operation}", but the claimed result is ` +
        `${claimedResult.magnitude} — arithmetic does not check out.`,
    };
  }

  const composed: ComposedFact = {
    id: createHash('sha256')
      .update(
        `composed:${derivedLineText}:${operandValues.map((v) => v.magnitude).join(',')}:${operation}`,
      )
      .digest('hex')
      .slice(0, 16),
    statement: `${operandValues
      .map((v) => `${v.magnitude}${v.unit ? ' ' + v.unit : ''}`)
      .join(` ${operation} `)} = ${claimedResult.magnitude}${claimedResult.unit ? ' ' + claimedResult.unit : ''}`,
    value: claimedResult,
    operation,
    operandIds: operands.map((o) => o.id),
    claimText: derivedLineText,
  };

  return { ok: true, composed };
}

// -------------------------------------------------------------------------------------------
// QuoteVerifiedProvenance — the structurally-unbypassable quote-provenance guard
// (177-EXPERIMENTS/README.md CORRECTION section)
// -------------------------------------------------------------------------------------------

/**
 * A proof that a project's rulebook has been checked against its archived source
 * (`computeVerificationScope(projectDir).scope === SCOPE_FULL` — the archived source file exists
 * AND its SHA-256 matches `INDEX.md`'s recorded `Source hash:`). The ONLY way to obtain an
 * instance is the static `obtain()` method; the constructor is PRIVATE, so no caller anywhere in
 * this codebase can construct a value of this type by asserting a plain object shape (`as
 * QuoteVerifiedProvenance`) past a boolean check it forgot to make — the compiler rejects a `new
 * QuoteVerifiedProvenance(...)` call outside this class. This is the same "make it impossible to
 * construct a suspect finding without passing provenance state" posture 177-02 established for a
 * different guard in this codebase.
 *
 * WHY `computeVerificationScope`, NOT `parseVerifiedAgainst`: `parseVerifiedAgainst`
 * (`chunk-provenance.ts`) answers a different question — whether a CODE chunk's `CHUNK.md` was
 * checked against the rulebook. This guard needs to know whether the RULEBOOK's own quote lines
 * were checked against the ARCHIVED SOURCE PDF/text — that is exactly what
 * `computeVerificationScope`'s source-hash comparison computes, reused here rather than
 * reinvented (this plan's explicit instruction: compose the existing machinery, do not invent a
 * second provenance notion).
 */
export class QuoteVerifiedProvenance {
  private constructor(
    readonly sourceHash: string,
    readonly edition: string | undefined,
  ) {}

  static async obtain(projectDir: string): Promise<QuoteVerifiedProvenance | null> {
    const scope = await computeVerificationScope(projectDir);
    if (scope.scope !== SCOPE_FULL || !scope.sourceHash) return null;
    return new QuoteVerifiedProvenance(scope.sourceHash, scope.edition);
  }
}

// -------------------------------------------------------------------------------------------
// classifyDerivedLines — cross-reference against existing Derived lines
// -------------------------------------------------------------------------------------------

/**
 * The five classification outcomes. `quote-unverified` is a DOWNGRADE state, never a verdict a
 * reconciler asserts directly — it is the mechanical result of a `contradicted`/`uncorroborated`
 * proposal reaching this module with no `QuoteVerifiedProvenance` to back it (see
 * `classifyDerivedLines` below).
 */
export type DerivedLineClassification =
  | 'corroborated'
  | 'corroborated-by-composition'
  | 'uncorroborated'
  | 'contradicted'
  | 'quote-unverified';

/**
 * The reconciler's proposed classification for one `Derived` line, citing the grounded facts (or
 * composed fact) it believes support the proposal. This module VALIDATES the citation — it never
 * trusts `proposedClassification` at face value. A `contradicted`/`uncorroborated` proposal is a
 * "suspect" finding and is downgraded to `quote-unverified` unless `provenance` is supplied to
 * `classifyDerivedLines` (see there).
 */
export interface ReconcilerDerivedLineClaim {
  slicePath: string;
  lineNumber: number;
  derivedLineText: string;
  proposedClassification: 'corroborated' | 'corroborated-by-composition' | 'uncorroborated' | 'contradicted';
  /** Grounded-both-bucket fact ids cited as support (corroborated) or conflict (contradicted). */
  citedFactIds: string[];
  /** For corroborated-by-composition only: the composed-fact id being cited. */
  composedFactId?: string;
}

export interface DerivedLineClassificationResult {
  slicePath: string;
  lineNumber: number;
  derivedLineText: string;
  classification: DerivedLineClassification;
  citedFactIds: string[];
  reason: string;
}

/** A fact found by both enumerators (grounding-validated) that NO Derived line's claim covers. */
export interface MissedFact {
  fact: GroundedBothFact;
}

export interface ClassifyDerivedLinesResult {
  classifications: DerivedLineClassificationResult[];
  missed: MissedFact[];
}

/**
 * Cross-references a reconciler's proposed per-line classifications against the grounding-
 * validated evidence, and computes the `missed` set (facts found by both enumerators that no
 * `Derived` line's claim covers at all).
 *
 * VALIDATION, NOT TRUST: every `corroborated`/`corroborated-by-composition` proposal is checked
 * against `groundedBoth`/`composed` — a citation to a fact id absent from those (grounding-
 * validated) collections is downgraded to `uncorroborated`, reported with the specific reason,
 * never silently accepted. This closes the same fabrication class `validateGrounding` closes, one
 * layer up: a reconciler could otherwise cite a fake fact id here even after a genuine grounding
 * pass, and this is the check that catches that.
 *
 * THE QUOTE-PROVENANCE GUARD IS STRUCTURAL: `provenance` is `QuoteVerifiedProvenance | null`, a
 * type only `QuoteVerifiedProvenance.obtain()` can produce. Any `uncorroborated`/`contradicted`
 * proposal reaching this function with `provenance === null` is downgraded to `quote-unverified`
 * unconditionally — there is no code path in this function that can report a "suspect" finding
 * without that value present. This is the fix for 177-EXPERIMENTS/README.md's CORRECTION: a
 * broken quote line upstream of both enumerators must never be allowed to manufacture a confident
 * false accusation against a `Derived` line that was actually correct.
 */
export function classifyDerivedLines(input: {
  claims: ReconcilerDerivedLineClaim[];
  groundedBoth: GroundedBothFact[];
  composed: ComposedFact[];
  provenance: QuoteVerifiedProvenance | null;
}): ClassifyDerivedLinesResult {
  const { claims, groundedBoth, composed, provenance } = input;
  const groundedById = new Map(groundedBoth.map((f) => [f.id, f] as const));
  const composedById = new Map(composed.map((c) => [c.id, c] as const));
  const citedFactIds = new Set<string>();

  const classifications: DerivedLineClassificationResult[] = claims.map((claim) => {
    const base = {
      slicePath: claim.slicePath,
      lineNumber: claim.lineNumber,
      derivedLineText: claim.derivedLineText,
    };

    if (claim.proposedClassification === 'corroborated') {
      const facts = claim.citedFactIds.map((id) => groundedById.get(id));
      if (facts.some((f) => !f) || facts.length === 0) {
        return {
          ...base,
          classification: 'uncorroborated',
          citedFactIds: [],
          reason:
            'Reconciler claimed "corroborated" citing fact id(s) not present in the grounding-' +
            'validated both-bucket — downgraded rather than trusted.',
        };
      }
      for (const f of facts as GroundedBothFact[]) citedFactIds.add(f.id);
      return {
        ...base,
        classification: 'corroborated',
        citedFactIds: claim.citedFactIds,
        reason: 'Every cited fact passed grounding validation (verbatim-traceable to both enumerator lists).',
      };
    }

    if (claim.proposedClassification === 'corroborated-by-composition') {
      const c = claim.composedFactId ? composedById.get(claim.composedFactId) : undefined;
      if (!c || c.claimText !== claim.derivedLineText) {
        return {
          ...base,
          classification: 'uncorroborated',
          citedFactIds: [],
          reason:
            'Reconciler claimed "corroborated-by-composition" citing a composed-fact id that either ' +
            'does not exist or was verified against different Derived-line text — downgraded rather ' +
            'than trusted.',
        };
      }
      for (const id of c.operandIds) citedFactIds.add(id);
      return {
        ...base,
        classification: 'corroborated-by-composition',
        citedFactIds: c.operandIds,
        reason: `Verified in code: ${c.statement} (checked against this Derived line's own stated claim, never freely generated).`,
      };
    }

    // uncorroborated / contradicted — both are "suspect" findings, gated on provenance.
    if (!provenance) {
      return {
        ...base,
        classification: 'quote-unverified',
        citedFactIds: claim.citedFactIds,
        reason:
          "This project's rulebook has not been verified against its archived source " +
          '(computeVerificationScope !== "full"). A suspect finding cannot be reported until quotes ' +
          'are verified — an unverified-quote defect is indistinguishable from a genuinely wrong ' +
          'inference (177-EXPERIMENTS/README.md CORRECTION, seven:11).',
      };
    }

    if (claim.proposedClassification === 'contradicted') {
      const facts = claim.citedFactIds.map((id) => groundedById.get(id));
      if (facts.some((f) => !f) || facts.length === 0) {
        return {
          ...base,
          classification: 'uncorroborated',
          citedFactIds: [],
          reason:
            'Reconciler claimed "contradicted" citing fact id(s) not present in the grounding-' +
            'validated both-bucket — downgraded to uncorroborated rather than trusted as a ' +
            'contradiction.',
        };
      }
      for (const f of facts as GroundedBothFact[]) citedFactIds.add(f.id);
      return {
        ...base,
        classification: 'contradicted',
        citedFactIds: claim.citedFactIds,
        reason: 'Cited contradicting fact(s) passed grounding validation and the rulebook source is quote-verified.',
      };
    }

    return {
      ...base,
      classification: 'uncorroborated',
      citedFactIds: claim.citedFactIds,
      reason:
        'No grounded fact corroborates this Derived line, and the rulebook source is quote-verified, ' +
        'so the gap is reported rather than downgraded.',
    };
  });

  const missed: MissedFact[] = groundedBoth
    .filter((f) => !citedFactIds.has(f.id))
    .map((fact) => ({ fact }));

  return { classifications, missed };
}
