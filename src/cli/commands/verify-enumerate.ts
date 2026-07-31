import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, resolve } from 'node:path';
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
 *      177-19 CLOSED A NARROWER VERSION OF THE SAME GAP: quotes come from per-SOURCE documents,
 *      not per-project, and `QuoteVerifiedProvenance` used to vouch for a project's ENTIRE
 *      rulebook once any one source was archived. A doom-machine measurement (177-18) found this
 *      is exactly wrong for a multi-source project: `rules.pdf` archived, `cards.pdf` not, and
 *      `CARDS.md`'s `cards.pdf`-sourced findings were silently treated as quote-verified anyway.
 *      `QuoteVerifiedProvenance.covers(slicePath)` closes this — see that method's own comment
 *      for the (explicitly heuristic, explicitly fail-closed) attribution it performs.
 *
 * HONESTY NOTE ON WHAT IS STRUCTURAL VERSUS PROBABILISTIC (per this plan's honesty-discipline
 * requirement): the annotation-line backstop in `buildEnumeratorPayload`, the fact-grounding
 * check in `validateGrounding`, and the private-constructor provenance guard's null-gating are all
 * STRUCTURAL — they cannot be satisfied by accident or bypassed by a forgetful caller.
 * `QuoteVerifiedProvenance.covers()`'s filename-substring attribution, by contrast, IS a
 * heuristic — labeled as one at its own definition, and deliberately fail-closed (ambiguous or
 * unattributable cases report `false`, never `true`, per this plan's honesty-discipline
 * requirement). The text-similarity matcher underlying grounding (`isTolerantMatch`) is DELIBERATELY
 * PROBABILISTIC — it tolerates whitespace/punctuation/case/minor-wording restatement so a genuine
 * paraphrase is not rejected as
 * fabrication, and the threshold that draws that line is a documented judgment call (see
 * `MIN_MATCH_LENGTH` below), not a measured constant. Treat it as a heuristic, not a guarantee.
 *
 * TWO STRUCTURAL GAPS CLOSED IN 177-17 (both left open, and named, by 177-15/177-16's live
 * measurement — see `177-EXPERIMENTS/README.md`'s "Its real weakness" section and the task brief
 * that drove this plan):
 *
 *   4. MULTI-STEP ARITHMETIC (`composeArithmeticClaim` performs exactly one operation per call, so
 *      a genuine COMPOUND relationship — `seven` L36's "draw2/discard1 nets +1/round; 10-3=7 span;
 *      7 span / 1 net = 7 rounds" — never reached composition at all). `composeArithmeticChain`
 *      extends the same conservative posture (CHECK a stated relationship, never GENERATE one) to a
 *      bounded sequence of steps, where a later step may consume an earlier step's own computed
 *      result as one of its operands. Every leaf operand still traces to a `GroundedBothFact`; every
 *      intermediate result must itself be a value the `Derived` line literally states (an
 *      intermediate is not a free variable); the chain depth is bounded at
 *      `MAX_ARITHMETIC_CHAIN_DEPTH`, stated and justified where that constant is declared.
 *
 *   5. ABSENCE CLAIMS ("No edition or printing number is stated...", "This section marks no rules
 *      as variants...") assert that something is NOT present. Two enumerators listing facts a
 *      passage SUPPORTS structurally cannot produce "X is absent" — dual enumeration has no
 *      mechanism to corroborate a negative, ever, by construction. Bucketing these as
 *      `uncorroborated` (the old behavior) is misleading: it looks identical to "the enumerators
 *      tried and failed to agree," when in fact this design cannot ask the question at all. The
 *      classifier now recognizes an explicit `'absence'` proposal (the RECONCILER's judgment call —
 *      never a keyword list baked into this module, per 177-01's deliberate precedent of shipping
 *      no absence-detection keyword list) and, ONLY when the reconciler names literal, searchable
 *      target term(s), mechanically scans the passage's own quote lines (never the `Derived` line's
 *      own text, which would trivially self-contradict) for those terms — a string check, same
 *      posture as `validateGrounding`. When no safe target was named, the claim is honestly
 *      reported as `absence-unverifiable`, its own explicit bucket, never silently downgraded to
 *      `uncorroborated`.
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
 * The REAL backstop — deliberately broader than every filter it guards, and deliberately NOT
 * sharing their vocabulary.
 *
 * `ANY_ANNOTATION_LINE_RE` above, and the `quoteLinesOnly` filter it was meant to guard, are BOTH
 * keyed to the `(p.N)` citation form. A "backstop" that recognizes only what its filter already
 * recognizes is the same check run twice — it can catch a decoration variant (`> Derived (p.1):`,
 * which 177-08 fixed) but is blind to a MARKER-FORM variant.
 *
 * That blindness was not hypothetical. The doom-machine measurement (plan 177-18) found
 * `rulebook/CARDS.md` writing bare `Derived:` lines under its own locally-declared convention —
 * no page citation. They passed `quoteLinesOnly` untouched AND passed the backstop silently,
 * landing the transcriber's own inference in the blind enumerator payload. That is precisely the
 * "confirmation, not independence" failure the retired per-line design died of, reintroduced
 * through a marker shape nobody had enumerated.
 *
 * So this pattern keys on the annotation VOCABULARY at line start — the words themselves, with
 * any leading decoration — and requires no citation. It is intentionally over-broad: a false
 * positive costs one loud, fixable throw, while a false negative silently corrupts a dispatch and
 * is invisible in the results. Any future marker form is caught by default rather than by
 * anticipation.
 */
/*
 * Leading decoration is skipped by consuming ALL non-alphanumeric characters, NOT by enumerating a
 * character class. The first version of this pattern read `^[\s>\-*]*` — I picked the decoration
 * characters I could think of, and the 177-20 consolidated run found `(Derived: ...)` in
 * doom-machine's CARDS.md leaking straight past it.
 *
 * That is the same mistake this constant was introduced to fix, made inside the fix itself, and it
 * is now the fourth instance in this milestone: the retired design's "structural" independence that
 * was incidental; a backstop keyed to the same citation vocabulary as the filter it guarded; a test
 * helper that made unit strings match by construction; and this. Every one held for the shapes
 * someone had enumerated and was described as universal.
 *
 * So this deliberately enumerates nothing. Anything that is not a letter or digit is decoration.
 */
const ANNOTATION_VOCABULARY_RE = /^[^A-Za-z0-9]*(?:Derived|Visual|Named-but-undefined)\b/im;

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
  // Drop any surviving annotation line by VOCABULARY before assembly, so a marker form the
  // citation-keyed filter never anticipated (bare `Derived:`, per doom-machine's CARDS.md) is
  // removed rather than merely detected. Detection alone would make such a slice unprocessable.
  const cleaned = quotes.filter((line) => !ANNOTATION_VOCABULARY_RE.test(line));
  const lines = [ENUMERATE_TOKEN, `Slice: ${slice.path}`, '', ...cleaned];
  const payload = lines.join('\n');

  // Two independent backstops. ANY_ANNOTATION_LINE_RE shares the filter's citation vocabulary and
  // catches decoration variants; ANNOTATION_VOCABULARY_RE deliberately does not, and catches
  // marker-form variants. A single check keyed to the filter's own vocabulary is not a backstop —
  // that assumption is what let bare `Derived:` lines reach a live dispatch (plan 177-18).
  if (ANY_ANNOTATION_LINE_RE.test(payload) || ANNOTATION_VOCABULARY_RE.test(payload)) {
    throw new Error(
      `buildEnumeratorPayload assembled a payload for ${slice.path} that still names an ` +
        `annotation family (Derived / Visual / Named-but-undefined), with or without a page ` +
        `citation.\n` +
        `The payload construction site, not the prompt text, is where the quote-only guarantee ` +
        `is upheld — an annotation reaching an enumerator turns independent derivation into ` +
        `confirmation of the transcriber's own inference. Fix the strip filter; never relax this ` +
        `check to let the payload through.`,
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

/**
 * Match strength, lowest = strongest. A quote may legitimately match several facts — most commonly
 * because SEVERAL facts share one `sourceSentence`, which is normal: a single rulebook sentence
 * routinely supports multiple facts.
 */
function matchRank(quote: string, fact: EnumeratedFact): number {
  const nq = normalizeForMatch(quote);
  if (nq.length > 0 && nq === normalizeForMatch(fact.statement)) return 0;
  if (isTolerantMatch(quote, fact.statement)) return 1;
  if (nq.length > 0 && nq === normalizeForMatch(fact.sourceSentence)) return 2;
  if (isTolerantMatch(quote, fact.sourceSentence)) return 3;
  return Number.POSITIVE_INFINITY;
}

/**
 * Resolves a reconciler's quote to the fact it grounds in, DETERMINISTICALLY.
 *
 * This previously used `list.find(...)` — first match wins, so the answer depended on the order the
 * enumerator happened to emit its facts. The 177-20 consolidated run caught the consequence: `seven`
 * L21 classified differently between two runs on unchanged input, because several of that slice's
 * facts share one `sourceSentence` and a different one won each time. Non-determinism is exactly
 * what invalidated the RETIRED design's numbers — a metric that moves on its own cannot be tuned
 * against, and it took thirteen plans there to notice. It is not acceptable here.
 *
 * Selection is now total and order-independent: strongest match rank wins; ties break on the fact's
 * content-derived `id`, which is a sha256 of statement+sourceSentence and therefore stable across
 * runs, processes and list orderings. Two facts can only tie on id by being byte-identical, in which
 * case either choice is the same fact.
 */
function findMatch(quote: string, list: EnumeratedFact[]): EnumeratedFact | undefined {
  let best: EnumeratedFact | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const fact of list) {
    const rank = matchRank(quote, fact);
    if (rank === Number.POSITIVE_INFINITY) continue;
    if (rank < bestRank || (rank === bestRank && best !== undefined && fact.id < best.id)) {
      best = fact;
      bestRank = rank;
    }
  }
  return best;
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
  /**
   * Present when the two enumerators labelled an operand's unit differently but compatibly (e.g.
   * `"4 copies of each card"` / `"4 copies"`). The composition was accepted on magnitude agreement
   * plus token compatibility; this records the wording gap so a reader can weigh it rather than
   * having it silently absorbed. Absent when every operand's units matched after normalization.
   */
  unitVariance?: string[];
  /**
   * Present ONLY for a multi-step composition (`composeArithmeticChain`) — one entry per chain
   * step, in order, recording that step's own magnitudes/operation/result for traceability. Absent
   * for a single-step `composeArithmeticClaim` result.
   */
  chainSteps?: string[];
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
/**
 * The single construction site for "what numeric value does this operand contribute, and is it
 * even eligible to compose at all." Shared, unmodified, between `composeArithmeticClaim` (one
 * step) and `composeArithmeticChain` (a bounded sequence of steps) — the two functions must never
 * diverge on what counts as a trustworthy operand, so the check lives here exactly once.
 */
type ExtractedOperand =
  | { ok: true; value: NumericValue; unitVariance?: string }
  | { ok: false; reason: string };

function extractOperandValue(op: GroundedBothFact): ExtractedOperand {
  const valueA = op.matchedFactA.numericValue;
  const valueB = op.matchedFactB.numericValue;
  let unitVariance: string | undefined;
  if (valueA && valueB) {
    // Magnitude and approximate must agree EXACTLY — both are semantically load-bearing, and a
    // disagreement on either means the two enumerators are not describing the same quantity.
    const disagree =
      valueA.magnitude !== valueB.magnitude || valueA.approximate !== valueB.approximate;
    if (disagree) {
      return {
        ok: false,
        reason:
          `Operand "${op.statement}"'s two matched facts disagree on numeric value ` +
          `(A: ${valueA.magnitude} ${valueA.unit}, B: ${valueB.magnitude} ${valueB.unit}) — ` +
          `refusing to compose from an inconsistent operand.`,
      };
    }
    // Unit wording is NOT compared by string equality. The two enumerators are dispatched
    // independently and never coordinate on vocabulary, so they routinely label the same
    // magnitude differently — real observed pairs from the 177-15 measurement:
    // "highest card number"/"card numbers" and "4 copies of each card"/"4 copies". An exact
    // string check refused every real composition on this corpus (0/2 verified) while every
    // magnitude matched exactly. That was brittleness, not a correctness signal.
    //
    // Units still cannot be ignored outright, or "7 players" would compose with "10 minutes".
    // The rule is token compatibility: one label's tokens must be a subset of the other's, so
    // a narrower phrasing may stand in for a broader one but genuinely different kinds refuse.
    //
    // HONESTY: this is a heuristic, not a guarantee. It admits "cards" against "bonus cards"
    // when magnitudes coincide. Two things bound that risk — magnitude equality is already
    // required, and this function only ever CHECKS a composition the Derived line itself
    // states, never generates one. A surviving variance is reported on the result rather than
    // silently accepted, so a reader can weigh it.
    if (!unitsCompatible(valueA.unit, valueB.unit)) {
      return {
        ok: false,
        reason:
          `Operand "${op.statement}"'s two matched facts describe different kinds of quantity ` +
          `(A: "${valueA.unit}", B: "${valueB.unit}") — refusing to compose across unlike units.`,
      };
    }
    if (normalizeUnitTokens(valueA.unit).join(' ') !== normalizeUnitTokens(valueB.unit).join(' ')) {
      unitVariance = `"${valueA.unit}" / "${valueB.unit}"`;
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
  return { ok: true, value, ...(unitVariance !== undefined ? { unitVariance } : {}) };
}

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
  const unitVariances: string[] = [];
  for (const op of operands) {
    const extracted = extractOperandValue(op);
    if (!extracted.ok) return extracted;
    if (extracted.unitVariance !== undefined) unitVariances.push(extracted.unitVariance);
    operandValues.push(extracted.value);
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
    ...(unitVariances.length > 0 ? { unitVariance: unitVariances } : {}),
  };

  return { ok: true, composed };
}

// -------------------------------------------------------------------------------------------
// composeArithmeticChain — bounded multi-step composition (177-17, closes the measured
// "seven L36" gap: composeArithmeticClaim performs exactly one operation per call, so a genuine
// COMPOUND relationship never reached composition at all)
// -------------------------------------------------------------------------------------------

/**
 * How deep a chain may go. `seven` L36 — the only real multi-step compound measured in this
 * corpus ("draw 2 / discard 1 nets +1 card per round; starting at 3 cards and ending at 10 cards
 * means 7 rounds") — needs exactly 3: (1) net = draw(2) − discard(1); (2) span = end(10) −
 * start(3); (3) rounds = span ÷ net. Bounded at exactly that depth, not padded with headroom —
 * this function CHECKS a stated relationship, never explores one, and a generous bound is an
 * invitation to search for compositions the `Derived` line never actually makes (the same
 * fabrication risk `composeArithmeticClaim`'s single-step design was built to refuse). Extending
 * this bound should require measuring another real multi-step failure, not raising it
 * speculatively "to be safe."
 */
export const MAX_ARITHMETIC_CHAIN_DEPTH = 3;

/** One operand reference inside a chain step: either a leaf grounded fact, or an earlier step's own computed result. */
export type ChainOperandRef = { kind: 'fact'; index: number } | { kind: 'stepResult'; index: number };

/**
 * One step of a bounded arithmetic chain. `operandRefs` may mix leaf facts (`kind: 'fact'`,
 * indexing into the flat `operands` array passed to `composeArithmeticChain`) with references to
 * an EARLIER step's own result (`kind: 'stepResult'`, indexing into `steps` by position, strictly
 * less than the step's own index — a chain is a strict sequence, never a DAG, and never permits a
 * step to reference itself or a step that has not run yet).
 */
export interface ArithmeticChainStep {
  operation: ArithmeticOp;
  operandRefs: ChainOperandRef[];
}

export type ComposeChainOutcome = { ok: true; composed: ComposedFact } | { ok: false; reason: string };

/**
 * Composes a BOUNDED SEQUENCE of arithmetic steps, where a later step may consume an earlier
 * step's own computed result as one of its operands — the shape `composeArithmeticClaim` cannot
 * express (it performs exactly one operation). Every constraint that function enforces on a single
 * step is preserved here, per step:
 *
 *   - every LEAF operand must trace to a `GroundedBothFact` (via `extractOperandValue` — the exact
 *     same magnitude-agreement / unit-compatibility / approximate-refusal checks, never relaxed
 *     for the chain case);
 *   - an INTERMEDIATE result is NOT a free variable: it must itself be a value the `Derived` line
 *     under test literally states (the same "does the line mention this digit" check
 *     `composeArithmeticClaim` applies to every leaf operand), or the chain is refused. This is
 *     what keeps a chain from drifting into inventing an unstated intermediate quantity to bridge
 *     two otherwise-unrelated numbers.
 *   - the chain is bounded at `MAX_ARITHMETIC_CHAIN_DEPTH` steps — see that constant's comment;
 *   - the FINAL step's result must match `claimedResult` (within float tolerance), exactly like
 *     `composeArithmeticClaim`;
 *   - this function CHECKS a chain of operations the caller supplies (sourced from the `Derived`
 *     line under test); it never invents which operations to try or in what order — the same
 *     conservative posture as the single-step function, extended, not loosened, to more than one
 *     step.
 *
 * Refuses (returns `{ ok: false, reason }`, never throws) on any of the same per-operand failures
 * `composeArithmeticClaim` refuses on, plus: fewer than one step; more than `MAX_ARITHMETIC_CHAIN_DEPTH`
 * steps; a step with fewer than two operand references; a `stepResult` reference to a step that
 * has not yet run (self- or forward-reference); an intermediate result the `Derived` line never
 * mentions; a final result that does not match `claimedResult`.
 */
export function composeArithmeticChain(input: {
  derivedLineText: string;
  steps: ArithmeticChainStep[];
  operands: GroundedBothFact[];
  claimedResult: NumericValue;
}): ComposeChainOutcome {
  const { derivedLineText, steps, operands, claimedResult } = input;

  validateNumericValue(claimedResult, 'composeArithmeticChain.claimedResult');

  if (steps.length < 1) {
    return { ok: false, reason: 'composeArithmeticChain requires at least one step.' };
  }
  if (steps.length > MAX_ARITHMETIC_CHAIN_DEPTH) {
    return {
      ok: false,
      reason:
        `composeArithmeticChain refuses a chain of ${steps.length} steps — bounded at ` +
        `${MAX_ARITHMETIC_CHAIN_DEPTH} (see MAX_ARITHMETIC_CHAIN_DEPTH's comment: this bound keeps ` +
        `composition CHECKING a stated relationship, never exploring an open-ended one).`,
    };
  }

  const stepResults: NumericValue[] = [];
  const usedFactIds: string[] = [];
  const unitVariances: string[] = [];
  const chainStepStatements: string[] = [];

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];
    if (step.operandRefs.length < 2) {
      return { ok: false, reason: `Chain step ${stepIdx} requires at least two operand references.` };
    }

    const stepMagnitudes: number[] = [];
    let lastUnit = '';

    for (const ref of step.operandRefs) {
      if (ref.kind === 'fact') {
        const op = operands[ref.index];
        if (!op) {
          return {
            ok: false,
            reason: `Chain step ${stepIdx} references operand index ${ref.index}, out of range.`,
          };
        }
        const extracted = extractOperandValue(op);
        if (!extracted.ok) return extracted;
        if (extracted.unitVariance !== undefined) unitVariances.push(extracted.unitVariance);
        if (!derivedLineText.includes(String(extracted.value.magnitude))) {
          return {
            ok: false,
            reason:
              `The Derived line under test does not mention chain step ${stepIdx}'s operand value ` +
              `${extracted.value.magnitude} (from "${op.statement}") — refusing to compose a ` +
              `relationship the line itself never states.`,
          };
        }
        stepMagnitudes.push(extracted.value.magnitude);
        lastUnit = extracted.value.unit;
        usedFactIds.push(op.id);
      } else {
        if (ref.index >= stepIdx) {
          return {
            ok: false,
            reason:
              `Chain step ${stepIdx} references step ${ref.index}'s result, which has not been ` +
              `computed yet — a chain is a strict sequence; a step may only reference an EARLIER ` +
              `step's own result, never itself or a later one.`,
          };
        }
        const prior = stepResults[ref.index];
        if (!derivedLineText.includes(String(prior.magnitude))) {
          return {
            ok: false,
            reason:
              `The Derived line under test does not mention the intermediate value ` +
              `${prior.magnitude} computed at chain step ${ref.index} — an intermediate is not a ` +
              `free variable; it must be a value the Derived line itself states, or the chain is ` +
              `refused.`,
          };
        }
        stepMagnitudes.push(prior.magnitude);
        lastUnit = prior.unit;
      }
    }

    const computed = reduceOperation(step.operation, stepMagnitudes);
    const resultUnit = stepIdx === steps.length - 1 ? claimedResult.unit : lastUnit;
    stepResults.push({ magnitude: computed, unit: resultUnit, approximate: false });
    chainStepStatements.push(`${stepMagnitudes.join(` ${step.operation} `)} = ${computed}`);
  }

  const finalResult = stepResults[stepResults.length - 1];
  if (Math.abs(finalResult.magnitude - claimedResult.magnitude) > ARITHMETIC_EPSILON) {
    return {
      ok: false,
      reason:
        `Chain computed ${finalResult.magnitude} from its final step, but the claimed result is ` +
        `${claimedResult.magnitude} — arithmetic does not check out.`,
    };
  }

  const composed: ComposedFact = {
    id: createHash('sha256')
      .update(`composed-chain:${derivedLineText}:${chainStepStatements.join('|')}`)
      .digest('hex')
      .slice(0, 16),
    statement:
      `${chainStepStatements.join('; then ')} ` +
      `(final: ${claimedResult.magnitude}${claimedResult.unit ? ' ' + claimedResult.unit : ''})`,
    value: claimedResult,
    operation: steps[steps.length - 1].operation,
    operandIds: usedFactIds,
    claimText: derivedLineText,
    ...(unitVariances.length > 0 ? { unitVariance: unitVariances } : {}),
    chainSteps: chainStepStatements,
  };

  return { ok: true, composed };
}

/**
 * Lowercase alphanumeric tokens of a unit label, with a trailing `s` stripped so trivial plurals
 * collapse (`copies`/`copy` do not, and are not expected to — the subset rule below tolerates that
 * by matching on the tokens that DO agree).
 */
function normalizeUnitTokens(unit: string): string[] {
  return unit
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
    .sort();
}

/**
 * True when two unit labels plausibly name the same kind of quantity: identical token sets, or one
 * a subset of the other (a narrower phrasing standing in for a broader one). Unrelated kinds —
 * `cards` vs `minutes` — share no tokens and are refused.
 *
 * Deliberately a heuristic; see the caller's comment for what it does and does not guarantee.
 */
function unitsCompatible(unitA: string, unitB: string): boolean {
  const a = new Set(normalizeUnitTokens(unitA));
  const b = new Set(normalizeUnitTokens(unitB));
  if (a.size === 0 || b.size === 0) return true;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (!large.has(token)) return false;
  }
  return true;
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
/**
 * Rulebook-source file extensions `boardsmith ingest-archive` is documented to accept ("PDF,
 * images, or text" — `ingest-archive.ts`'s own CLI error message). Used ONLY to detect candidate
 * source documents sitting at the PROJECT ROOT (sibling to `rulebook/`, never inside it — slice
 * files themselves are `.md` and live in `rulebook/`, so scanning the root avoids ever mistaking
 * a slice for a source). This is a closed, documented list, not an attempt to recognize every
 * conceivable source format — a project whose second source uses an extension outside this list
 * is invisible to `detectUnarchivedSources` below, which is exactly the kind of false-negative
 * risk 177-EXPERIMENTS/README.md's CORRECTION warns against; see that function's own comment.
 */
const CANDIDATE_SOURCE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.txt'];

/**
 * Scans the PROJECT ROOT (not `rulebook/`) for files that look like rulebook source documents —
 * every real reference game (`seven`, `one-two-punch`, `doom-machine`) keeps its original
 * source PDF(s) at the project root, and `ingest-archive` copies (never moves) from there into
 * `rulebook/source/`. Returns basenames only (e.g. `"cards.pdf"`), case preserved.
 *
 * MECHANICAL, NOT A GUESS: this is a directory listing filtered by extension — it does not read
 * file contents, does not infer anything about a file's relationship to any slice, and cannot be
 * fooled by a file that merely LOOKS unrelated. What it CANNOT do: prove a listed file is
 * actually a rulebook source (a stray `notes.txt` at project root would also match) or prove that
 * NO further source exists (an extension outside `CANDIDATE_SOURCE_EXTENSIONS`, or a source kept
 * outside the project root entirely, is invisible to it). Both failure directions are named
 * explicitly in `QuoteVerifiedProvenance.covers()`'s own comment, which is the function that
 * actually decides what to trust.
 */
async function detectRootSourceCandidates(projectDir: string): Promise<string[]> {
  let entries: Array<{ name: string; isFile(): boolean }>;
  try {
    entries = await fs.readdir(resolve(projectDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isFile() &&
        CANDIDATE_SOURCE_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)),
    )
    .map((e) => e.name)
    .sort();
}

/**
 * Lowercased basename with its extension stripped. The one normalization step
 * `QuoteVerifiedProvenance.covers()`'s filename-substring heuristic relies on — see that method's
 * comment for what this buys and what it does not.
 */
function fileStem(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/**
 * Below this length, a stem is refused as a substring-match anchor — mirrors `MIN_MATCH_LENGTH`'s
 * rationale above: a short stem ("hp", "d6") would spuriously "match" against unrelated slice
 * names, turning a targeted heuristic into noise. 4 was chosen because it is the shortest real
 * stem this milestone has measured ("cards") minus one character of margin, while still refusing
 * degenerate two/three-letter stems.
 */
const MIN_STEM_MATCH_LENGTH = 4;

export class QuoteVerifiedProvenance {
  private constructor(
    readonly sourceHash: string,
    readonly edition: string | undefined,
    readonly archivedSourceBasename: string | undefined,
    /**
     * Basenames of project-root files that LOOK like rulebook source documents but are NEITHER
     * the primary source this instance's `sourceHash` was computed from NOR one of
     * `computeVerificationScope`'s hash-verified `## Additional Sources` entries (177-19's
     * `ingest-archive.ts` fix — once a second source is genuinely archived-and-verified via
     * `boardsmith ingest-archive <second-file>`, its basename moves OUT of this array). Empty for
     * the ordinary, common case (a genuinely single-source project) — `seven` and
     * `one-two-punch` both resolve to `[]`. Public so a caller (e.g. a future CLI report) can
     * surface "this project has an unarchived source" explicitly, per this plan's requirement,
     * rather than that fact being swallowed inside a silent per-slice `covers()` decision.
     */
    readonly unarchivedSources: readonly string[],
  ) {}

  static async obtain(projectDir: string): Promise<QuoteVerifiedProvenance | null> {
    const scope = await computeVerificationScope(projectDir);
    if (scope.scope !== SCOPE_FULL || !scope.sourceHash) return null;

    // A source is "archived" for THIS guard's purposes when it is either the primary source
    // (`scope.sourcePath`) or one of `computeVerificationScope`'s independently hash-verified
    // `additionalSources` (177-19's `ingest-archive.ts` fix — `boardsmith ingest-archive
    // cards.pdf` after `rules.pdf` no longer silently overwrites the primary; it augments this
    // list instead). A root-level file whose basename matches either is genuinely archived and
    // verified, not merely "present" — it is excluded from `unarchivedSources` on that strength.
    const archivedSourceBasename = scope.sourcePath ? basename(scope.sourcePath) : undefined;
    const archivedBasenames = new Set(
      [archivedSourceBasename, ...(scope.additionalSources ?? []).map((s) => basename(s.sourcePath))]
        .filter((n): n is string => Boolean(n))
        .map((n) => n.toLowerCase()),
    );
    const rootCandidates = await detectRootSourceCandidates(projectDir);
    const unarchivedSources = rootCandidates.filter(
      (name) => !archivedBasenames.has(name.toLowerCase()),
    );

    return new QuoteVerifiedProvenance(
      scope.sourceHash,
      scope.edition,
      archivedSourceBasename,
      unarchivedSources,
    );
  }

  /**
   * Whether THIS instance's archived-and-hash-verified source can honestly be said to cover
   * `slicePath` (e.g. `"rulebook/CARDS.md"`) — the fix for the gap named in this plan's brief:
   * `QuoteVerifiedProvenance` used to answer "has this PROJECT recorded provenance at all", and a
   * project with two source PDFs but only one archived (doom-machine: `rules.pdf` archived,
   * `cards.pdf` not) had EVERY slice, including `CARDS.md`'s (sourced from the unarchived PDF),
   * silently treated as quote-verified. This method is the one place that silent over-vouching is
   * closed.
   *
   * THREE CASES, IN ORDER:
   *
   *  1. `unarchivedSources.length === 0` — genuinely single-source, by the same root-directory
   *     scan that found the archived file itself. Every slice is covered, unconditionally. This is
   *     the common case and matches today's `seven`/`one-two-punch` behavior exactly — neither has
   *     a second root-level source document, so neither game's classification changes.
   *
   *  2. `unarchivedSources.length > 1` — TWO OR MORE unarchived candidates. Refused entirely
   *     (covers nothing) rather than attempted: the filename-substring heuristic below was built
   *     from exactly one measured case (`CARDS.md` / `cards.pdf`) and has no evidence it
   *     discriminates correctly between two or more unknowns at once. Guessing wrong here is
   *     silent — the whole point of this method — so ambiguity above one candidate fails closed
   *     rather than being reasoned about further.
   *
   *  3. `unarchivedSources.length === 1` — the doom-machine shape. A HEURISTIC, explicitly labeled
   *     as one: `slicePath`'s filename stem is compared, as a case-insensitive substring in either
   *     direction, against the one unarchived candidate's filename stem (`fileStem`). A match
   *     (`"CARDS.md"` vs `"cards.pdf"` → both stem to `"cards"`) means this slice is NOT covered —
   *     it looks like it belongs to the OTHER, unarchived document, so it is excluded rather than
   *     vouched for. Every slice that does NOT match is reported covered.
   *
   *     HONESTY, STATED PLAINLY: this is a filename convention, not a content check. It is exactly
   *     right for doom-machine (`CARDS.md`/`cards.pdf` are the one real measured case this was
   *     built from) and can be WRONG in either direction on a project that does not follow that
   *     convention — a slice named unrelatedly to its true source (false negative: reported
   *     covered when it should not be) is invisible to this check entirely, and a slice that
   *     happens to share vocabulary with an unrelated unarchived file (false positive: excluded
   *     when it was genuinely covered) merely loses a real corroboration behind a conservative
   *     `quote-unverified`, which is the safe direction to be wrong in. There is no available data
   *     to do better — slices do not record which source document produced them, which is the
   *     root gap this whole method exists to compensate for, not fully close.
   */
  covers(slicePath: string): boolean {
    if (this.unarchivedSources.length === 0) return true;
    if (this.unarchivedSources.length > 1) return false;

    const sliceStem = fileStem(slicePath);
    const candidateStem = fileStem(this.unarchivedSources[0]);
    if (candidateStem.length < MIN_STEM_MATCH_LENGTH || sliceStem.length < MIN_STEM_MATCH_LENGTH) {
      // Too short to trust a substring match either way — conservative default is UNCOVERED, per
      // this method's fail-closed contract (a short stem proves nothing, so nothing is vouched
      // for on its strength).
      return false;
    }
    const matchesUnarchived = sliceStem.includes(candidateStem) || candidateStem.includes(sliceStem);
    return !matchesUnarchived;
  }
}

// -------------------------------------------------------------------------------------------
// classifyDerivedLines — cross-reference against existing Derived lines
// -------------------------------------------------------------------------------------------

/**
 * The classification outcomes. `quote-unverified` is a DOWNGRADE state, never a verdict a
 * reconciler asserts directly — it is the mechanical result of a `contradicted`/`uncorroborated`
 * proposal reaching this module with no `QuoteVerifiedProvenance` to back it (see
 * `classifyDerivedLines` below).
 *
 * `absence-corroborated`/`absence-contradicted`/`absence-unverifiable` (177-17) exist because dual
 * enumeration STRUCTURALLY cannot corroborate a claim that something is absent — no enumerator
 * ever lists a fact that is not there, by construction. Bucketing an absence claim as plain
 * `uncorroborated` would misleadingly look identical to "both enumerators tried and failed to
 * agree," when the true situation is "this design cannot ask this question at all." See the
 * `'absence'` branch in `classifyDerivedLines` for the mechanical (never keyword-guessed) check
 * that produces `absence-corroborated`/`absence-contradicted`, and for exactly when a claim falls
 * back to the honest `absence-unverifiable` bucket instead.
 */
export type DerivedLineClassification =
  | 'corroborated'
  | 'corroborated-by-composition'
  | 'uncorroborated'
  | 'contradicted'
  | 'quote-unverified'
  | 'absence-corroborated'
  | 'absence-contradicted'
  | 'absence-unverifiable';

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
  proposedClassification:
    | 'corroborated'
    | 'corroborated-by-composition'
    | 'uncorroborated'
    | 'contradicted'
    | 'absence';
  /** Grounded-both-bucket fact ids cited as support (corroborated) or conflict (contradicted). */
  citedFactIds: string[];
  /** For corroborated-by-composition only: the composed-fact id being cited. */
  composedFactId?: string;
  /**
   * For `'absence'` only. Literal, verbatim search term(s) the RECONCILER names as exactly what
   * the `Derived` line claims is absent (e.g. `["edition", "printing"]` for "No edition or
   * printing number is stated..."). NEVER synthesized by this module — recognizing that a
   * `Derived` line is an absence claim, and naming a safe literal target for it, is a judgment
   * call this codebase deliberately leaves to the model (177-01's precedent: no absence-detection
   * keyword list ships in this module). Omit or leave empty when no safe, unambiguous literal
   * target exists (e.g. a claim spanning several synonymous concepts, like "no variants, optional
   * modules, or advanced/expert rules") — that claim is reported `absence-unverifiable` rather
   * than checked with a guessed keyword that would produce false confidence.
   */
  absenceTargets?: string[];
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
 * THE QUOTE-PROVENANCE GUARD IS STRUCTURAL AND NOW PER-SLICE: `provenance` is
 * `QuoteVerifiedProvenance | null`, a type only `QuoteVerifiedProvenance.obtain()` can produce.
 * Any `uncorroborated`/`contradicted` proposal reaching this function with `provenance === null`
 * is downgraded to `quote-unverified` unconditionally — there is no code path in this function
 * that can report a "suspect" finding without that value present. This is the fix for
 * 177-EXPERIMENTS/README.md's CORRECTION: a broken quote line upstream of both enumerators must
 * never be allowed to manufacture a confident false accusation against a `Derived` line that was
 * actually correct.
 *
 * 177-19 CLOSED A SECOND, NARROWER GAP IN THE SAME GUARD: `provenance` used to be treated as a
 * project-wide "yes, verified" flag once non-null. But quotes come from per-SOURCE documents, not
 * per-project — a project with two source PDFs and only one archived (doom-machine: `rules.pdf`
 * archived, `cards.pdf` not) had `CARDS.md`'s `cards.pdf`-sourced findings ALSO silently treated
 * as quote-verified, because `provenance` was non-null for the project as a whole. Every
 * "suspect" branch below now ALSO calls `provenance.covers(claim.slicePath)` — a claim is only
 * exempted from `quote-unverified` when BOTH the project has a verified archived source AND that
 * source can honestly be said to cover this specific slice (see `QuoteVerifiedProvenance.covers()`
 * for exactly how, and how reliably). The SAME two-part guard applies to `'absence'` proposals
 * that resolve to `absence-corroborated`/`absence-contradicted` — that check also reads the
 * passage's quote lines, which carry the identical upstream-transcription risk.
 */
/**
 * The single construction site for a "quote-unverified" downgrade's reason text — shared by the
 * `uncorroborated`/`contradicted` branch and the `'absence'` branch below, which face the
 * identical two cases:
 *
 *  - `provenance` is `null` — this project's rulebook was never verified against ANY archived
 *    source at all (`computeVerificationScope() !== "full"`).
 *  - `provenance` is present but `.covers(slicePath)` is `false` — the project DOES have a
 *    verified archived source, but that source cannot honestly be said to cover THIS slice,
 *    because a second, unarchived source document is present (see `QuoteVerifiedProvenance.
 *    covers()` for exactly how that determination is made and how reliable it is). Naming this
 *    case distinctly, rather than reusing the "never verified at all" message, is the fix for
 *    this plan's brief: silently reusing project-wide vouching for a slice with no evidence
 *    behind it is exactly the gap being closed.
 */
function quoteUnverifiedReason(provenance: QuoteVerifiedProvenance | null, slicePath: string): string {
  if (!provenance) {
    return (
      "This project's rulebook has not been verified against its archived source " +
      '(computeVerificationScope !== "full"). A suspect finding cannot be reported until quotes ' +
      'are verified — an unverified-quote defect is indistinguishable from a genuinely wrong ' +
      'inference (177-EXPERIMENTS/README.md CORRECTION, seven:11).'
    );
  }
  return (
    `This project's archived source is verified, but it does not cover "${slicePath}" — ` +
    `${provenance.unarchivedSources.length} unarchived source document(s) ` +
    `(${provenance.unarchivedSources.join(', ') || 'more than one candidate'}) are also present, ` +
    `and this slice cannot be mechanically attributed to the archived one with confidence ` +
    `(QuoteVerifiedProvenance.covers() — a filename heuristic, not a content check; slices do not ` +
    `record which source document they came from). Downgraded rather than risking a confident ` +
    `false accusation against quotes that were never actually checked (177-EXPERIMENTS/README.md ` +
    'CORRECTION, seven:11).'
  );
}

export function classifyDerivedLines(input: {
  claims: ReconcilerDerivedLineClaim[];
  groundedBoth: GroundedBothFact[];
  composed: ComposedFact[];
  provenance: QuoteVerifiedProvenance | null;
  /**
   * Raw slice markdown text, keyed by `slicePath`, needed ONLY to check `'absence'` proposals.
   * `quoteLinesOnly()` is applied internally before scanning — matching exactly what the real
   * enumerators saw, and deliberately excluding the `Derived` line's OWN text, which always
   * literally contains its own claimed-absent term(s) and would otherwise trivially self-
   * contradict every absence claim. Omit when this batch has no `'absence'` proposals to check.
   */
  passages?: Record<string, string>;
}): ClassifyDerivedLinesResult {
  const { claims, groundedBoth, composed, provenance, passages } = input;
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

    if (claim.proposedClassification === 'absence') {
      if (!claim.absenceTargets || claim.absenceTargets.length === 0) {
        return {
          ...base,
          classification: 'absence-unverifiable',
          citedFactIds: [],
          reason:
            'Reconciler flagged this Derived line as an absence claim but named no explicit, ' +
            'literal, searchable target — dual enumeration structurally cannot corroborate a ' +
            'negative (no enumerator ever lists a fact that is not there), and this module refuses ' +
            'to guess a keyword to scan for on its own (177-01 precedent: recognizing an absence ' +
            'claim and naming a safe target for it is a judgment call, not a keyword list baked ' +
            'into this module). Reported honestly in its own bucket rather than downgraded to ' +
            'uncorroborated.',
        };
      }

      const passage = passages?.[claim.slicePath];
      if (!passage) {
        return {
          ...base,
          classification: 'absence-unverifiable',
          citedFactIds: [],
          reason:
            `No passage text was supplied for "${claim.slicePath}" to check the named absence ` +
            `target(s) against — cannot mechanically verify without it.`,
        };
      }

      // Same provenance guard as uncorroborated/contradicted below, and for the identical reason:
      // the scan below reads this passage's own quote lines, which carry the same upstream-
      // transcription risk (177-EXPERIMENTS/README.md CORRECTION, seven:11) whether the finding is
      // "no grounded fact corroborates this" or "the target term does/doesn't appear in the text."
      if (!provenance || !provenance.covers(claim.slicePath)) {
        return {
          ...base,
          classification: 'quote-unverified',
          citedFactIds: [],
          reason: quoteUnverifiedReason(provenance, claim.slicePath),
        };
      }

      // Scan the REAL quote lines an enumerator actually saw (quoteLinesOnly), never the raw slice
      // text — the Derived line's own annotation text always literally contains its claimed-absent
      // term(s) ("No edition..." contains "edition"), so scanning anything wider than the quote
      // lines would make every absence claim trivially self-contradict.
      const quoteText = quoteLinesOnly(passage).join('\n').toLowerCase();
      const found = claim.absenceTargets.filter((t) => quoteText.includes(t.toLowerCase()));

      if (found.length > 0) {
        return {
          ...base,
          classification: 'absence-contradicted',
          citedFactIds: [],
          reason:
            `The passage's own quote lines literally contain "${found.join('", "')}" — the claimed ` +
            `absence does not hold.`,
        };
      }
      return {
        ...base,
        classification: 'absence-corroborated',
        citedFactIds: [],
        reason:
          `None of the named target term(s) (${claim.absenceTargets.join(', ')}) appear anywhere ` +
          `in this passage's quote lines — mechanically confirms the claimed absence.`,
      };
    }

    // uncorroborated / contradicted — both are "suspect" findings, gated on provenance AND on
    // whether that provenance actually covers THIS slice (see QuoteVerifiedProvenance.covers()).
    if (!provenance || !provenance.covers(claim.slicePath)) {
      return {
        ...base,
        classification: 'quote-unverified',
        citedFactIds: claim.citedFactIds,
        reason: quoteUnverifiedReason(provenance, claim.slicePath),
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
