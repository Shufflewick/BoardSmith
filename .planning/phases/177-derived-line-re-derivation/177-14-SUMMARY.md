---
phase: 177-derived-line-re-derivation
plan: 14
subsystem: cli-verify
tags: [check04-replacement, dual-enumeration, arithmetic-composition, provenance-guard, mechanics-only]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (177-EXPERIMENTS/README.md)
    provides: The measurement that retired per-line blind re-derivation and specified the
      dual-enumeration + reconciliation replacement, including the three failure modes
      (reconciler fabrication, model-side arithmetic, unverified-quote judgment) this plan's code
      exists to close.
  - file: src/cli/commands/verify-derive-recheck.ts
    provides: quoteLinesOnly() — reused unmodified, not re-derived, for the enumerator payload's
      quote-only filter.
  - file: src/cli/commands/chunk-provenance.ts
    provides: computeVerificationScope() — reused unmodified as the quote-provenance guard's sole
      source of truth (SCOPE_FULL = archived rulebook source exists and its hash matches
      INDEX.md's recorded Source hash:).
provides:
  - src/cli/commands/verify-enumerate.ts — the mechanical core of the replacement design:
    buildEnumeratorPayload, createEnumeratedFact, validateGrounding, composeArithmeticClaim,
    QuoteVerifiedProvenance, classifyDerivedLines
  - 42 behavioral tests in src/cli/commands/verify-enumerate.test.ts, run against the real,
    quote-verified 177-FIXTURES corpus (never 174-FIXTURES, the stale pre-2026-07-27 corpus)
affects: [a-future-CHECK-04-resumption-plan, verify-enumerate.ts's eventual CLI registration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A private-constructor class (QuoteVerifiedProvenance) as a structural gate: the only way
      to obtain an instance is an async static factory that checks disk state, so a caller cannot
      fabricate proof of a check it never ran by asserting an object shape."
    - "Composing existing modules (quoteLinesOnly, computeVerificationScope) rather than
      re-deriving equivalent logic, even where the sibling module's helper regex was private and
      had to be duplicated at a documented site (mirrors chunk-provenance.ts's own CITATION_HEADER_RE
      precedent)."
    - "A verification function that CHECKS a caller-supplied claim rather than GENERATING one
      (composeArithmeticClaim never invents an operation or operands) is the conservative answer
      to a measured 'model freely composes meaningless products' failure mode."
key-files:
  created:
    - src/cli/commands/verify-enumerate.ts
    - src/cli/commands/verify-enumerate.test.ts
  modified: []
decisions:
  - "Grounding matching (isTolerantMatch) is exact-or-normalized-containment, deliberately NOT
    edit-distance/fuzzy — edit distance would tolerate a single-digit substitution ('5 cards' vs
    '7 cards' is edit-distance 1), which is exactly the fabrication class this module exists to
    catch. Containment requires the shorter normalized string to appear whole inside the longer
    one, refused below 12 normalized characters (MIN_MATCH_LENGTH) to avoid a short common word
    spuriously matching an unrelated fact."
  - "composeArithmeticClaim requires every operand's magnitude to appear literally (digit
    substring) in the Derived line under test before composing — the mechanical stand-in for 'the
    source material states this relationship.' This is deliberately conservative: a genuine
    relationship not restated as digits in the Derived line is reported unverifiable rather than
    composed. The function CHECKS a claim; it never GENERATES one."
  - "classifyDerivedLines validates every reconciler citation (corroborated/contradicted fact ids,
    corroborated-by-composition's composed-fact id) against the grounding-validated/composed
    collections actually passed in — a citation to a nonexistent id is downgraded and reported,
    never trusted at face value. This closes the same fabrication class validateGrounding closes,
    one layer up."
  - "The quote-provenance guard composes computeVerificationScope, not parseVerifiedAgainst.
    parseVerifiedAgainst answers whether a CODE chunk was checked against the rulebook; this guard
    needs whether the RULEBOOK's own quote lines were checked against the archived source PDF —
    computeVerificationScope's source-hash comparison is the existing machinery that answers that
    exact question."

# Metrics
metrics:
  duration: "~1 session"
  completed: 2026-07-30
---

# Phase 177 Plan 14: CHECK-04 Replacement Mechanics Summary

Built the mechanical core of CHECK-04's dual-enumeration replacement — quote-only payload
construction, structured fact records, a mechanical fabrication check on the reconciler's "both"
claims, code-only arithmetic composition that verifies (never generates) a stated claim, a
structurally-unbypassable quote-provenance guard, and cross-referencing against existing `Derived`
lines with a `missed`-fact report. Pure functions and code-side verification only, per this plan's
scope — no CLI registration, no skill text, no LLM dispatch.

## What was built

**`buildEnumeratorPayload`** — assembles a quote-lines-only dispatch payload for one slice, reusing
`quoteLinesOnly` from `verify-derive-recheck.ts` (not re-derived) and backstopping the assembled
string against all three annotation families (`Derived (p.`/`Visual (p.`/`Named-but-undefined (p.`),
throwing loudly if any leak survives. Proven against both real fixture games, including
`one-two-punch/02-action-cards-and-resolution.md`, the densest real slice in the corpus (10
`Derived`/`Visual` lines).

**`createEnumeratedFact`** — the one construction site for a structured fact (`id`, `statement`,
`sourceSentence`, optional `NumericValue { magnitude, unit, approximate }`). Validates numeric
values eagerly so a malformed value can never reach arithmetic composition.

**`validateGrounding`** — the module's mechanical core. A reconciler's "found by both" claim must
supply a verbatim quote it attributes to EACH enumerator's list (`quotedFromA`/`quotedFromB`); this
function checks each quote is genuinely traceable to that list via tolerant-but-not-loose text
matching, and rejects (reporting, never silently dropping) any claim where either side's quote
matches nothing. Directly closes the measured "5 cards each" fabrication: forcing the reconciler to
commit to a specific quote per side, and checking that quote mechanically, is what makes the
fabrication catchable.

**`composeArithmeticClaim`** — composes numeric facts already proven corroborated (the type system
enforces this: only `validateGrounding`'s output, `GroundedBothFact`, is accepted as an operand)
into a derived quantity, verifying a CALLER-SUPPLIED claim rather than generating one. Refuses
approximate operands (closing the measured "about 7 minutes" x 7 = "49 minutes" false-precision
fabrication), refuses operands whose two matched facts disagree, and — the hardest constraint —
refuses to compose unless every operand's magnitude is literally restated as a digit in the
`Derived` line under test, so the function can only ever CHECK a proposed composition, never
generate a new one on its own initiative. Proven against the real `seven` fixture's own
"7 numbers x 4 colors x 4 copies = 112" `Derived` line.

**`QuoteVerifiedProvenance`** — a class with a PRIVATE constructor; the only way to obtain an
instance is the async static `obtain(projectDir)`, which composes `chunk-provenance.ts`'s existing
`computeVerificationScope` (never a second provenance notion). `classifyDerivedLines` requires this
value (or its explicit `null` absence) for every "suspect" (uncorroborated/contradicted) finding —
there is no code path in that function that can produce a suspect finding without it. This directly
closes the CORRECTION finding in `177-EXPERIMENTS/README.md`: `seven:11`'s `Derived` line was
CORRECT and the design confidently reported it contradicted because the quote line above it was
truncated. Proven `null` against both real fixture games (neither `seven` nor `one-two-punch` has
recorded provenance yet — real, current corpus state) and non-null only when a synthetic project's
archived source hash genuinely matches.

**`classifyDerivedLines`** — cross-references a reconciler's proposed per-line classifications
(`corroborated` / `corroborated-by-composition` / `uncorroborated` / `contradicted`) against the
grounding-validated evidence, validating every citation rather than trusting it, and applies the
provenance guard: any suspect proposal reaching the function with `provenance === null` is
mechanically downgraded to `quote-unverified`. Also computes `missed` — grounded-both facts no
`Derived` line's claim covers at all, the design's measured advantage over the retired design
(it found two facts the transcription missed entirely in the live experiment).

## What is proven vs. assumed

**Proven, by test, against the real 177-FIXTURES corpus and synthetic disk-state fixtures:**
- The payload backstop leaks nothing on the densest real slice in the corpus.
- `validateGrounding` rejects the exact fabrication shapes measured in the experiments (credited-
  quote fabrication, single-digit numeric substitution) while tolerating benign restatement
  (case/punctuation/whitespace).
- `composeArithmeticClaim` reproduces the real `seven` deck-count arithmetic and refuses the three
  measured failure classes (approximate operand, unstated relationship, arithmetic mismatch).
- `QuoteVerifiedProvenance` is `null` for both real reference games today (a true, current fact:
  neither game has run `chunk-check`/recorded rulebook provenance) and non-null only on a genuine
  hash match, mismatching, or missing-file synthetic project.
- `classifyDerivedLines`' provenance downgrade is unconditional — no combination of inputs
  produces a `contradicted`/`uncorroborated` classification with `provenance: null`.

**Assumed / not yet exercised (honest limitation, not a stub):**
- No real dual-enumerator dispatch has been run against this code — the payload builder, grounding
  validator, and composer are proven against hand-constructed and real-corpus-derived fact lists,
  never against a live model's actual enumeration output. Whether real enumerator output shapes
  cleanly into `EnumeratedFact`/`ReconcilerBothClaim` is untested until a dispatch driver exists.
- `isTolerantMatch`'s exact-or-containment matching is a DOCUMENTED HEURISTIC, not a guarantee —
  its `MIN_MATCH_LENGTH = 12` threshold is a judgment call, not a measured constant. A genuine
  paraphrase shorter than 12 normalized characters on either side would be rejected as unmatched
  (a false negative, not a fabrication risk); the module comments say this explicitly rather than
  describing the matcher as a proof.
- Contradiction SEMANTICS (whether a cited fact actually conflicts with a `Derived` line's claim,
  as opposed to merely being grounded) is left to the reconciler's judgment; this module only
  enforces that the cited facts are genuinely grounded, not that the conflict itself is real. That
  split (semantic judgment stays with the model, mechanical grounding is enforced in code) is
  deliberate per this plan's scope, but it means a reconciler could still mislabel a non-conflicting
  grounded fact as "contradicting" and this module would not catch that specific error — only that
  the citation is real.
- No ledger, no `atomicWriteFile` durable write, no CLI command exists yet for this module — by
  design, per this plan's explicit scope (pure functions and code-side verification only). A
  future plan wires dispatch, a ledger, and CLI registration.

## Deviations from Plan

None — plan executed as written. Two test-authoring mistakes (an exact-match short string that
bypassed the length threshold by design, and a derived-line text missing a digit the composer
correctly refused to compose from) were caught by the tests themselves failing and fixed before
commit; these are corrections to the tests, not deviations in the shipped module.

## Full test run

`npm test`: **4075/4075 passed** (baseline 4033 + 42 new tests in `verify-enumerate.test.ts`), full
suite, not a subdirectory subset.

## Self-Check: PASSED

- FOUND: src/cli/commands/verify-enumerate.ts
- FOUND: src/cli/commands/verify-enumerate.test.ts
- FOUND commit: 6a5b33cb (feat(check04-core): dual-enumeration mechanics for CHECK-04 replacement)
- FOUND commit: e42d0fc9 (test(check04-core): behavioral tests for dual-enumeration mechanics)
