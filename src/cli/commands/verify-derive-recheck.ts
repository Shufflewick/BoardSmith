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
 * This module's `buildBlindDerivePayload` (added in a later plan task) will be the ONE
 * construction site for the blind-derivation dispatch prompt, and it must be structurally
 * incapable of emitting the `Derived (p.` line under test. A re-derivation that has seen the
 * original is not a second opinion — it is a confirmation, and it would report high agreement
 * whether or not the original derivation was sound. Independence must be structural: the original
 * line is not in the dispatch payload at all.
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
