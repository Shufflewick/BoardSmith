# Phase 177: Derived-Line Re-Derivation - Research

**Researched:** 2026-07-30
**Domain:** CLI (TypeScript) verification pipeline + Claude-Code skill-text judgment contracts (no frontend)
**Confidence:** HIGH — every claim below is grounded in a direct code read, a direct grep of the real
reference-game slice files, or a live regex test run in this session. No web/Context7 lookups were
needed; this is an internal-codebase-only phase.

## Summary

CHECK-04 adds a fourth verification check to the same `verify-run`/`verify-classify`/
`verify-ruling-recheck` family Phases 173–176 built. The mechanism is a near-exact structural clone of
Phase 176's `verify-ruling-recheck.ts` + `ruling-recheck.md`: a frozen four-verdict enum, a CLI that
enumerates and records, and a fresh-context judgment subagent that never sees the thing it must
independently confirm. The one genuinely new engineering problem is **decision 5's blind-derivation
requirement** — the deriving subagent must never see the original `Derived` line, which is a stricter
structural-independence bar than any prior phase in this milestone has had to build (174/176's subagents
see BOTH sides of a comparison; this one must NOT).

Direct measurement in this session found two things the planner needs before writing tasks:

1. **`PRESENTATION_EXCLUSION_MARKERS` (decision 1's verbatim-reuse target) has a real, verified
   regex gap.** Live-tested against real slice text: the marker for `— diagram description:` does
   NOT match `— diagram description (Plan phase):` or `— diagram description (Fight phase):` — the
   parenthetical qualifier one-two-punch's real transcription actually uses on 4 of its 6
   dash-qualified lines. This is not a hypothetical edge case — it is present in the committed
   reference game today. It does not break CHECK-04's own correctness (decision 2's judgment
   subagent is the actual safety net; anything the mechanical filter misses simply reaches the
   subagent and can be returned `not-rule-bearing`), but it means the "mechanically excluded" set
   this phase inherits is **smaller than Area 1's measured-reality narrative implies**, and the
   subagent will see more raw `Derived` lines than the marker alone would suggest.

2. **Several of `seven`'s 10 `Derived` lines are pure presentation content that the reused marker
   does NOT catch at all** (no `— diagram description`/`— art` qualifier exists on `seven`'s side —
   all 10 lines are bare `Derived (p.N):`). At least 3 of the 10 (page-layout/art descriptions, not
   qualified) will reach the subagent as raw candidates and depend entirely on decision 2's judgment
   step to be excluded. This directly validates decision 2's design (rule-bearingness must be
   judgment, not a keyword list) with fresh, concrete evidence — it is not just a theoretical
   defense against future borderline cases, it is needed for lines the game already has.

**Primary recommendation:** Build `verify-derive-recheck.ts` as a near-line-for-line structural mirror
of `verify-ruling-recheck.ts` (same enumerate → dispatch → validate → record shape, same atomic
ledger reuse), but split the single judgment dispatch of `ruling-recheck.md` into TWO separate
subagent contracts per decision 7 (blind-derive first, then a separate comparison dispatch) — do not
attempt to reuse Phase 176's one-dispatch-per-item shape unmodified, since 176's subagent both reads
and judges in one call and this phase's independence guarantee depends on those being different
processes with different inputs.

   **RESOLVED — reports, does not gate Close.** See `177-CONTEXT.md` decision 15. Findings exit 0;
   non-zero is reserved for tool failure (172 decision 6: these are advisory sweeps a verify pipeline
   consumes, not gates, and a check that fires on correct work gets waived). CHECK-04 may be invoked
   from the pipeline and its `--json` formatted there, but a disagreement finding never blocks a close.
   Phase 179 assembles the source-free mode from checks of exactly this shape.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Presentation-line exclusion (mechanical) | API/Backend (CLI) | — | Pure string/regex function, reused verbatim from `verify-classify.ts` |
| Rule-bearingness judgment | Judgment subagent (dispatched via Claude Code `claude -p`) | — | Requires semantic reading of borderline prose; a keyword rule would silently misjudge (176 decision-4 precedent) |
| Blind re-derivation | Judgment subagent (separate dispatch, quote-lines-only payload) | — | Structural independence requires a fresh subagent invocation whose context never contained the original line |
| Agreement comparison | Judgment subagent (second, separate dispatch) | — | Decision 7: comparing must not happen in the same pass as deriving, to avoid post-hoc rationalization |
| Enumeration, ledger recording, finding formatting | API/Backend (CLI) | — | Same `verify-run.ts` atomic ledger family; mechanical and total |
| Human-readable report | API/Backend (CLI, `--json`) → skill text formats | — | PROV-03's compute/format split, held since Phase 171 |

This phase has no browser/client or CDN tier at all — it is 100% CLI + skill-text, consistent with the
`<additional_context>` framing.

## Standard Stack

### Core
No new external packages. This phase extends the existing internal command family
(`src/cli/commands/verify-*.ts`) and slash-command skill-text tree
(`src/cli/slash-command/bs/verify/*.md`). No `npm install` is needed.

### Package Legitimacy Audit

Not applicable — this phase installs no external packages. Skipping the slopcheck/registry-verification
protocol; nothing to gate behind `checkpoint:human-verify`.

## Reused Assets (concrete, with line numbers)

### `PRESENTATION_EXCLUSION_MARKERS` — export status and exact behavior

`src/cli/commands/verify-classify.ts:93-97`:

```ts
export const PRESENTATION_EXCLUSION_MARKERS = Object.freeze([
  '^Visual \\(p\\.\\d+\\):',
  '^Derived \\(p\\.\\d+\\) — diagram description:',
  '^Derived \\(p\\.\\d+\\) — art:',
] as const);
```

Already **exported** (unlike the seven ledger helpers Phase 174 had to export from `verify-run.ts`) —
no export change is needed to reuse it verbatim, satisfying decision 1 with zero source modification
to `verify-classify.ts`.

`isPresentationLine()` (`verify-classify.ts:103-106`) is also exported and driven entirely by the
constant above:

```ts
export function isPresentationLine(line: string): boolean {
  const trimmed = line.trim();
  return PRESENTATION_EXCLUSION_MARKERS.some((source) => new RegExp(source, 'i').test(trimmed));
}
```

`ruleBearingLines()` (`verify-classify.ts:130-141`) also exported; it additionally strips blank lines,
markdown headings, and bare `p.N,` citation headers before applying `isPresentationLine`. **CHECK-04
should reuse `isPresentationLine` directly for line-level filtering rather than re-deriving a filter**,
per decision 1.

**VERIFIED regex gap (live-tested this session, not assumed):**

```
isPresentationLine("Derived (p.1) — diagram description: A layout diagram...")            → true
isPresentationLine("Derived (p.1) — diagram description (Plan phase): Two boxer cards...") → false
isPresentationLine("Derived (p.1) — diagram description (Fight phase): Two action cards...") → false
isPresentationLine("Derived (p.2) — art: A full-color illustration...")                    → true
isPresentationLine("Derived (p.1): The rules page is a single wide, landscape panel...")   → false
```

The regex requires `diagram description:` immediately — no parenthetical qualifier tolerated. Real
`one-two-punch` data has FOUR lines using the `(Plan phase)`/`(Fight phase)`/`(first Punch example)`/
`(second Punch example)` qualified form, all of which the current constant misses. **This is not this
phase's bug to fix** (decision 1 locks verbatim reuse; do not add a 177-local pattern), but the planner
must know it exists so a plan doesn't accidentally assume the mechanical filter alone determines the
27-of-22-line "surviving" set with 100% accuracy. It doesn't — decision 2's subagent step is the actual
correctness guarantee, and this gap is direct evidence of exactly why decision 2 exists.

### `verify-ruling-recheck.ts` (Phase 176) — the structural analog to mirror

File: `src/cli/commands/verify-ruling-recheck.ts` (389 lines). Key shapes to mirror for CHECK-04:

- **Frozen four-value enum** (`verify-ruling-recheck.ts:28-33`):
  ```ts
  export const RULING_VERDICTS = Object.freeze([
    'still-needed', 'resolved-by-source', 'contradicted', 'undetermined',
  ] as const);
  export type RulingVerdict = (typeof RULING_VERDICTS)[number];
  ```
  CHECK-04's equivalent per 177-CONTEXT.md decision 6:
  ```ts
  export const DERIVE_VERDICTS = Object.freeze([
    'agrees', 'disagrees', 'underivable', 'not-rule-bearing',
  ] as const);
  ```

- **Validation-and-construction gate, single choke point** (`createRulingVerdictRecord`, lines 59-84):
  throws on an out-of-enum verdict OR empty `reasoning`. CHECK-04's equivalent must likewise reject a
  verdict with empty reasoning — decision 8 requires **both derivations quoted verbatim** in the
  record, which is a stricter version of 176's "reasoning is the artifact" rule: here the record
  needs `originalReading`/`rederivedReading` fields quoted verbatim, not just free prose.

- **Enumeration with skip/report split** (`enumerateRulingsForRecheck`, lines 124-146): mirrors
  `trace-check.ts`'s supersession-skip condition. CHECK-04's enumeration is simpler — there is no
  supersession concept for `Derived` lines — but the shape (enumerate everything surviving a
  mechanical filter, report anything ambiguous rather than silently dropping it) is the pattern to
  reuse. For CHECK-04 the two-stage split is: (a) enumerate every `Derived` line surviving
  `isPresentationLine` exclusion; (b) each line still needs a **rule-bearingness judgment** before
  re-derivation is even attempted (decision 2) — this is a NEW enumeration stage 176 didn't need,
  because 176's rulings are rule-bearing by construction (they exist specifically to record a rule
  interpretation) while CHECK-04's raw survivor set includes genuinely ambiguous lines (the
  "Publisher logo reads..." and "This section marks no rules..." examples CONTEXT.md's Measured
  Reality section names, plus the newly-found seven-side page-layout lines above).

- **`resolveFreshTranscription` — decision 12's override.** `verify-ruling-recheck.ts:186-251` resolves
  the **staged** run transcription (`rulebook/.verify/<runId>/slices/`), scope-limited if none exists.
  **CHECK-04 must NOT reuse this function as-is** — 177-CONTEXT.md decision 12 explicitly targets
  **live slices on `cp -R` copies**, not staged pass-2 output (that is Phase 175's fixture use case,
  reused for pass-1-vs-pass-2 comparison, which is a different question from "does this Derived line
  hold up to independent re-derivation from its own quote material"). The planner should have CHECK-04
  read `rulebook/*.md` directly (the live tree), the same source `verify-classify.ts`'s
  `computeRunPairs` already reads at `verify-classify.ts:585-613` (excluding `INDEX.md` and
  `00-visual-survey.md`, the existing convention). No new resolution function is needed for the
  "which transcription" question — CHECK-04 is source-free by construction (decision 4) and slice-only,
  simpler than 176's staged-vs-live distinction.

- **Atomic ledger reuse** (`recordRulingVerdicts`, lines 372-388): writes through `atomicWriteFile`
  (imported from `verify-run.ts`) into a run-scoped sibling ledger file
  (`rulebook/.verify/<runId>/RULING-VERDICTS.md`). CHECK-04's discretion area ("finding record's exact
  shape... reuses the single atomic ledger write path") should follow this exact precedent: a sibling
  `DERIVE-VERDICTS.md` (or similar) under the run's `.verify/<runId>/` directory, written via the SAME
  `atomicWriteFile` import — never a second write path. **Caveat:** CHECK-04 runs against live slices
  with NO staged run required (decision 12 — "live slices on `cp -R` copies"), so if there is no
  `verify-run-init` for this pass, the planner must decide whether CHECK-04 requires its own run-id
  scope or writes to a project-level ledger. This is genuinely open — see Open Questions below.

### `ruling-recheck.md` — the judgment-contract shape to mirror, and the no-phrase-list discipline

File: `src/cli/slash-command/bs/verify/ruling-recheck.md` (178 lines). Structure CHECK-04's contract
(or contracts — see below on the two-dispatch split) should mirror:

1. **Dispatch-token validation FIRST** (lines 18-37) — `BS-RULING-RECHECK-V1` handshake, reject-and-stop
   on a composed (non-copied) prompt. CHECK-04 needs its own token(s), e.g. `BS-DERIVE-V1` for the
   blind-derivation dispatch and `BS-DERIVE-COMPARE-V1` for the separate comparison dispatch (decision
   7 requires two distinct dispatches — they should almost certainly carry two distinct tokens, since
   a single token risks one contract accidentally serving both roles).
2. **"Your inputs" section stating EXACTLY what is and is not supplied** (lines 40-52) — this is where
   decision 5's structural independence must be enforced in prose: the blind-derivation dispatch's
   contract must state, unambiguously, that the subagent receives ONLY the slice's quote lines (never
   the `Derived` line, never any other `Derived`/`Visual` line from the same or any slice). This
   mirrors `classification-subagent.md`'s "Your inputs" section (lines 40-52) which lists exactly three
   things a classify dispatch receives — CHECK-04's blind-derive dispatch should list exactly as few.
3. **The verdict set stated with a worked absence-of-source-style trap, NOT a phrase list** (lines
   73-133) — `ruling-recheck.md`'s "absence-of-source trap" section is the direct precedent for how
   `underivable` (decision 6) must be taught: via ONE worked example naming the two plausible WRONG
   answers and why each is catastrophic, never via a list of trigger phrases. CHECK-04's contract
   needs an equivalent worked example — a real `Derived` line whose quote-line source material the
   subagent will not have (e.g. a component-count or card-face `Derived` line whose source is a PDF
   image, not transcribed prose) is the natural candidate, and Area 2/3's measured-reality section
   already names good real candidates (see "Slice-locality" below).
4. **RETURN shape, single object, one enumerated field** (lines 147-165) — CHECK-04's blind-derive
   dispatch returns `{ rederivedValue: string, sourceQuotes: string[] }` (no verdict at all — the
   verdict is decided in the SEPARATE comparison dispatch, per decision 7); the comparison dispatch
   then returns `{ verdict: 'agrees'|'disagrees'|'underivable'|'not-rule-bearing', reasoning: string }`.
   Neither should return slice bodies verbatim beyond the specific quotes the verdict turns on — same
   discipline `classification-subagent.md:178` and `ruling-recheck.md:164` both already state.
5. **Scope limit paragraph** (lines 169-177) — states the subagent never writes any file and never
   decides downstream consequence. CHECK-04's two contracts each need their own version of this.

### `verify-run.ts` — the ONE atomic ledger write path

`atomicWriteFile` (`verify-run.ts:301`, exported), `appendLedgerLine` (`:414`, exported),
`ledgerFilePath` (`:278`, exported), `stagingSlicesDir` (`:256`, exported), `readLedgerOrThrow`
(`:870`, exported), `parseLedgerBody` (`:476`, exported), `resolveLedgerState` (`:687`, exported) —
all already public (Phase 174 had to export these; they remain exported for 177 to reuse without
further export changes). `RUN_ID_RE` (`:91`) validates the `YYYY-MM-DDTHH-MM-SSZ` run-id shape used
throughout. **CHECK-04, if it needs no staged run at all (source-free, live-slices-only per decision
12), may not need a `run-id` scope in the same sense** — this is the same open question flagged above
under `resolveFreshTranscription`.

### `trace-check.ts` / `drift-check.ts` — source-free-by-construction posture

`trace-check.ts:1-15` states its own zero-rulebook-access guarantee explicitly in a doc comment and is
pinned by a "before/after whole-project byte-hash test" (the `T-171-19` class, `chunk-provenance.ts:
706-714`). `FINDING_KINDS` (`build-manifest.ts:20-30`) is the enumerated-finding-kind convention:
frozen array + derived type, no hand-written union. CHECK-04 should follow the identical "no rulebook
PDF access, no config flag — structurally incapable" posture (decision 4), and should pin it with the
same style of before/after project-hash test these prior phases use, proving CHECK-04 never opens the
archived source even though the archive may exist in the project.

### `verify-game.md` — current 8-step structure and sweep for stale claims

Confirmed via direct read (`src/cli/slash-command/bs/verify-game.md`, 201 lines): the skill is
currently **Step 0 through Step 7** (8 steps, 0-indexed, contiguous — pinned by
`verify.test.ts:626-634`'s "step headings are contiguous and 0-indexed" test). Current steps:

- Step 0: State Detection and Lock (VERIFY-01)
- Step 1: Source Resolution (VERIFY-01)
- Step 2: Staging Run and Re-Transcription (VERIFY-02/07/08)
- Step 3: Classification (VERIFY-03/07)
- Step 4: Adjudication Gate and Impact Map (VERIFY-04/05/06)
- Step 5: Ruling Re-Check (CHECK-01)
- Step 6: Repair Dispatch (CHECK-02)
- Step 7: Close (VERIFY-02)

**CHECK-04 needs a new step** (or a subsection of an existing step) — most naturally an insertion
between Step 6 (Repair Dispatch) and Step 7 (Close), since CHECK-04 is explicitly independent of
staleness/repair (177-CONTEXT.md "Out of scope" list: "This check is independent of a verify run's
staleness verdicts and does not consume them"). Inserting it would push Close to Step 8, and the
`does not reintroduce a hardcoded step count` test (`verify.test.ts:636-640`) already guards against a
literal "eight-step"/"nine-step" phrase reappearing — but the **specific regex there only checks for
the words `five`/`six`/`seven`/`eight`/`nine`** (`verify.test.ts:638`); it does NOT check for `four` or
numeric digits, so a plan inserting Step 7 (pushing Close to Step 8) must still sweep the file's prose
for any spelled-out or digit count of steps that isn't caught by that regex.

**Stale-claim sweep performed directly (per the instruction to check claims found still TRUE too, not
only fixable ones):**

- Line 20-21 ("no flag or path anywhere in this skill that writes staged output into a live
  location") — **confirmed still TRUE**, no source contradicting it found in this read.
- Line 25 ("Comparison happens in Step 3... no staged slice ever takes a live one's place") — **still
  TRUE** as written; CHECK-04 does not touch staged output at all (decision 12: live slices only), so
  this sentence needs no revision, but a plan should verify it remains accurate once CHECK-04's step
  is inserted (it will — CHECK-04 introduces no staged-to-live promotion path).
- Line 113 ("cite `verify-impact.ts`'s `REPAIR_GATE_DISPOSITIONS`... rather than restating its
  members") — **still TRUE**, no restatement found.
- Line 146-149 ("the pass closes" when `verify-run-status` AND `verify-classify-status` both report
  complete) — **this sentence will become STALE the moment CHECK-04 is wired in**, IF CHECK-04's own
  completion should also gate Close (an open design question — CONTEXT.md does not lock this). If the
  plan decides CHECK-04 gates Close, this sentence needs a third condition added; if CHECK-04 runs
  independently of the close gate (matching its "independent of a verify run's staleness verdicts"
  framing), this line stays accurate as-is and CHECK-04 is invoked as its own, ungated step. **Flag
  this decision explicitely for the planner — it is exactly the kind of cross-file claim this
  milestone has broken five times before** (see `additional_context`'s own warning).
- Line 163-189 (Reference Files list) — **will need a new bullet** for whichever new skill-text file
  CHECK-04 adds (e.g. `verify/derive-recheck.md`), mirroring the existing one-line bullet style; the
  existing test at `verify.test.ts:619-624` ("lists both new routes in Reference Files") is the
  precedent pattern a CHECK-04-specific version of that test should follow.
- `## Context-Economics Hard Rule` (lines 37-46) — states the orchestrator's transcript should never
  contain a quoted-rule line, a `Derived (p.` line, or a `Visual (p.` line. **This claim needs
  re-examination for CHECK-04's specific proof, not revision of its text** — CHECK-04's own dispatch
  prompts legitimately DO need to carry quote lines (to the blind-derive subagent) and DO need to carry
  a `Derived (p.` line (to the comparison subagent, per decision 8's "citing both derivations"
  requirement). This is the SAME `quotedPass1`/`quotedPass2` exception 174-PROOF.md §3 already
  documented for the classification subagent's raw RETURN (not its dispatch prompt) — the orchestrator
  transcript itself should still show zero slice-body lines; the exception belongs to the subagent's
  raw RETURN and dispatch-prompt CONSTRUCTION, exactly as 174 handled it. State this distinction
  explicitly in CHECK-04's proof rather than assuming the existing sentence is falsified by it.

### `verify.test.ts` guards that must stay true

- `verify.test.ts:626-634` — step-heading contiguity (0-indexed, no gaps). A new CHECK-04 step number
  must fit this pattern.
- `verify.test.ts:636-640` — no hardcoded step-count word (`five` through `nine`) reappearing; a
  9-step skill (after CHECK-04 insertion) is not itself forbidden by this regex, but any prose
  spelling out "nine steps" would need the SAME drift-guard treatment 176-04 already gave the
  8-step case (cite structure, never restate a count).
- `verify.test.ts:642-650` — no restated `REPAIR_GATE_DISPOSITIONS` list; cites the source array.
  Not directly CHECK-04's concern but must not regress.
- The broader companion-presence / no-fork guard pattern (176-04's technique, reading marker phrases
  live from `build/audit.md`/`build/repair.md`) is the precedent CHECK-04 should follow if it reuses
  any existing lens/contract text by reference — pin the reference, not a restatement.

## Specific research questions, answered

### 1. The quote-line format

A "quote line" in the real live slices is a bare page-citation header immediately followed by
directly-quoted prose, OR an inline citation inside prose. Concretely (from `seven` and
`one-two-punch`):

```
p.1, Distribution of Cards:
"The deck contains 112 cards numbered 1 through 7 in four colors..."
```

and inline forms like `(p.2)` asides inside a sentence (used by `livePageSpan()`,
`verify-classify.ts:201-210`, to derive page spans). The parser distinguishing a quoted rulebook line
from a `Derived`/`Visual` line is exactly the existing machinery: `CITATION_HEADER_RE` (`verify-
classify.ts:115`, `^p\.\d+,.*:$`) identifies a bare citation header; anything NOT matching
`isPresentationLine`, `CITATION_HEADER_RE`, a markdown heading (`#`), or a blank line, and NOT
starting with `Derived (p.` or `Visual (p.`, is either a directly quoted rulebook sentence or prose.
**CHECK-04's blind-dispatch payload construction needs a NEW filter, not an existing one**: it must
select ONLY the quoted-rulebook-content lines (excluding `Derived`/`Visual`/`Named-but-undefined`
lines entirely, not merely the presentation-tagged subset of `Derived`). None of the existing
functions do exactly this — `ruleBearingLines()` KEEPS `Derived` lines (they are rule-bearing for
classification purposes); CHECK-04 needs the opposite selection (quote lines only, `Derived` lines
excluded entirely, since decision 5 forbids the deriving subagent from seeing any `Derived` line,
not just the one under test). **This is new code the plan must scope, not a reuse.**

### 2. Slice-locality — can `Derived` lines actually be re-derived from their own slice's quotes?

Sampled directly against real files. Two representative cases:

- **`one-two-punch/01-setup-and-round-structure.md:30`**: `Derived (p.1): The box contains 2 Boxer
  Cards, 16 Action Cards, 6 Guard Cards, and 1 Rules Sheet.` — checking the same file's quoted
  content around it (component list section) shows this is very likely a straightforward summation
  of individually-quoted component counts already present in the slice (a components list is
  standard rulebook content). **Plausibly derivable from the same slice's quotes.**
- **`seven/01-definitions-and-components.md:21`**: `Derived (p.1): The full deck is therefore 7
  numbers x 4 colors x 4 copies = 112 numbered cards, plus 7 "+1" bonus point cards.` — this is
  explicit arithmetic over quoted component facts (`Derived (p.1): The Distribution of Cards diagram
  shows four rows of cards numbered 1 through 7... x 4... a single black card...x 7`) — but that
  supporting fact is ITSELF a `Derived` line describing a diagram/image, not a directly quoted
  sentence. **This is the crux of decision 11's `underivable` prediction**: several `Derived` lines
  depend on OTHER `Derived` lines (diagram-image descriptions) rather than on directly quoted
  rulebook prose. If the blind-derivation dispatch's payload is quote-lines-only (excluding ALL
  `Derived` lines, per the answer to Question 1), then a line whose only real evidentiary basis is
  another `Derived` line's diagram description is **structurally underivable by construction** — not
  a soft judgment call but a hard fact about what material the dispatch payload contains.

**Honest assessment for the planner: expect a MEANINGFUL `underivable` share, plausibly higher than a
casual read of CONTEXT.md's "several... plausibly came from PDF images" framing suggests** — because
it is not only card-face/component-image derivations that are underivable, but also any `Derived`
line whose supporting evidence is itself a diagram-description `Derived` line rather than directly
quoted prose. This affects at least: `seven`'s line 21 (deck math, if line 19's diagram description is
excluded from the payload) and several `one-two-punch` lines whose Interpretation depends on
diagram-only illustrations (the Punch-example diagram descriptions at `02-action-cards-and-resolution
.md:56/61` support the "Punch reduces one Guard to exhausted" rule, and lines 82/95 similarly reference
non-quote-line context). This is exactly decision 11's territory — report it as a real finding about
the ingest contract, do not manufacture a derivable-looking answer by leaking diagram descriptions
into the payload to make the numbers look better.

### 3. Structural independence — how to prove the deriving subagent never saw the original

Mirror the exact technique 173/174/176 already used for their own transcript observables (174-PROOF.md
§3, VERIFY-07's grep protocol): grep the raw DISPATCH PROMPT sent to the blind-derivation subagent for
the literal string `Derived (p.` — zero matches proves the original line was never in the payload.
This is a STRONGER and simpler check than VERIFY-07's own (which had to carve out an exception for the
`quotedPass1`/`quotedPass2` RETURN fields) because here the exclusion applies to the DISPATCH PROMPT
only, not the return — the comparison-step's dispatch prompt and RETURN legitimately DO need to
contain the original `Derived (p.` line (decision 8, citing both derivations), so the observable must
be split into two: (a) the blind-derivation dispatch prompt — zero `Derived (p.` matches, no exception
needed; (b) the comparison dispatch prompt and its RETURN — `Derived (p.` matches expected and
accounted for, mirroring the `quotedPass1`/`quotedPass2` precedent exactly. State both explicitly in
the proof; do not apply one blanket check to both dispatch kinds.

### 4. Two-step dispatch cost

22 lines × 2 dispatches = 44 real `claude -p` subprocess dispatches if every line proceeds past the
rule-bearingness filter. Given decision 2 (rule-bearingness is ALSO a subagent judgment, not free),
the realistic total is closer to **~22 (rule-bearingness judgment, which decision 2 folds into either
the same dispatch as blind-derivation or a separate one — CONTEXT.md's sort table lists it as a
distinct sub-part) + 22 (blind derivation) + 22 (comparison) ≈ 66 dispatches**, unless
rule-bearingness judgment is folded into the blind-derivation dispatch itself (a subagent handed only
quote lines and asked to derive a value can naturally return `not-rule-bearing` as one of its possible
outcomes without a separate call — this is the more economical design and appears to be what
CONTEXT.md's decision 6 four-verdict RETURN shape already implies, since `not-rule-bearing` is listed
as one of the SAME four verdicts alongside `agrees`/`disagrees`/`underivable`, suggesting a single
per-line pipeline of (blind-derive-or-reject) → (compare) rather than three separate stages). Under
that reading: ~22 blind-derivation dispatches (each capable of returning `not-rule-bearing` in lieu of
a value) + up to 22 comparison dispatches (skipped for any line the first stage already rejected) ≈
**44 dispatches at most, likely fewer** once `not-rule-bearing` and `underivable` lines short-circuit
the second dispatch. Real Phase 173/176 dispatch wall-clock has run several minutes per `claude -p`
subprocess call in this milestone's own proofs (per `173-PROOF.md`'s documented dispatch timings) — at
that rate, 44 dispatches sequential is a substantial, multi-hour proof run if run serially; the plan
should consider whether dispatches can be batched/parallelized (as 176 did for 60 ruling dispatches)
rather than serialized one-by-one. **The comparison step can plausibly read the blind derivation from
a recorded artifact (the ledger record from stage 1) rather than re-dispatching context** — this
matches decision 7's requirement that the two steps be separate PASSES, not that the second pass
re-fetch anything beyond the first pass's own recorded output plus the original line (which the
comparison step is explicitly allowed to see, unlike the first).

### 5. What real material exists RIGHT NOW (checked directly, not assumed)

- `~/BoardSmithGames/seven`: `git log -1` → `a03f38d4792af9dfc7c798be69686fc3230f54dd`, matching the
  pinned commit in CONTEXT.md exactly. `git status --short` → clean, no local modifications.
- `~/BoardSmithGames/one-two-punch`: `git log -1` → `7e69471bd8980a854f3e351f2f486e1fb6f712b9`,
  matching CONTEXT.md exactly. `git status --short` → two deleted files
  (`.boardsmith/runtime-bundle.mjs`, `.boardsmith/runtime-entry.ts`) — this is the SAME pre-existing,
  previously-documented exception from Phase 173 that 176-VERIFICATION.md's Independent Verifier
  Checks section already names ("the one-two-punch `.boardsmith/` deletions are the pre-existing,
  previously-documented exception from Phase 173"). Not new, not this phase's concern.
- Neither game has a `rulebook/.verify/` directory yet (`ls` returned "No such file or directory" for
  both) — confirming CONTEXT.md decision 12's framing that this check targets LIVE slices directly, no
  staged run exists or is required as a prerequisite.
- `seven/rulebook/`: `00-visual-survey.md`, `01-definitions-and-components.md`,
  `01-overview-setup-and-play.md`, `02-solo-variant.md`, `INDEX.md`.
- `one-two-punch/rulebook/`: `00-visual-survey.md`, `01-setup-and-round-structure.md`,
  `02-action-cards-and-resolution.md`, `INDEX.md`.
- **Exact `Derived` line count re-verified by direct grep in this session: `seven` = 10, `one-two-punch`
  = 12, total 22 — matches CONTEXT.md's Measured Reality exactly.** Zero `Visual (p.` lines in either
  game, also confirmed exactly.

## Architecture Patterns

### System Architecture Diagram

```
                          /bs-verify-game  (Step N, new — after Step 6 Repair Dispatch)
                                   │
                                   ▼
                  ┌────────────────────────────────┐
                  │ verify-derive-recheck.ts (CLI)  │
                  │  1. read rulebook/*.md live tree│
                  │  2. isPresentationLine() filter │◄── reused verbatim from verify-classify.ts
                  │     (excludes qualified Derived │
                  │      + Visual lines)            │
                  │  3. enumerate surviving Derived  │
                  │     lines project-wide (all 22) │
                  └───────────────┬─────────────────┘
                                  │  per surviving line
                                  ▼
                  ┌────────────────────────────────────────┐
                  │ Dispatch 1: BS-DERIVE-V1 (blind)         │
                  │  Payload: quote lines from the SAME      │
                  │  slice ONLY — zero Derived/Visual lines  │
                  │  anywhere in the prompt.                 │
                  │  Returns: { rederivedValue | not-rule-   │
                  │            bearing | underivable, quotes }│
                  └───────────────┬──────────────────────────┘
                                  │  (skip dispatch 2 if not-rule-bearing/underivable)
                                  ▼
                  ┌────────────────────────────────────────┐
                  │ Dispatch 2: BS-DERIVE-COMPARE-V1         │
                  │  Payload: original Derived line +        │
                  │  stage-1's recorded rederivedValue        │
                  │  Returns: { verdict: agrees|disagrees,    │
                  │            reasoning }                    │
                  └───────────────┬──────────────────────────┘
                                  │
                                  ▼
                  ┌────────────────────────────────┐
                  │ recordDeriveVerdicts()          │──► atomicWriteFile (verify-run.ts, SAME
                  │  through the ONE atomic ledger   │    path every prior phase reuses)
                  │  write path                      │
                  └───────────────┬─────────────────┘
                                  │
                                  ▼
                    Findings report: verdict counts,
                    disagreements citing BOTH derivations
                    verbatim (SC-2)
```

### Recommended Project Structure

```
src/cli/commands/
├── verify-derive-recheck.ts       # new: enumerate, mechanical filter, ledger record/read/status
└── verify-derive-recheck.test.ts  # colocated, mirrors verify-ruling-recheck.test.ts's shape

src/cli/slash-command/bs/verify/
├── derive-recheck.md              # new: the two-dispatch judgment contract (or two files, one per
│                                     dispatch kind, if the contracts are cleanly separable — see
│                                     Open Questions)
└── (verify-game.md gets a new Step N + Reference Files bullet)
```

### Pattern: Enumerate → mechanical-filter → judgment-dispatch → validate-and-record

Established across `trace-check.ts`, `verify-classify.ts`, `verify-ruling-recheck.ts`; CHECK-04 is the
fourth instance. Reuse the shape, not the specific enum values.

### Anti-Patterns to Avoid

- **Do not fold the blind-derivation and comparison steps into one dispatch.** Decision 7 exists
  specifically to prevent post-hoc rationalization; a single-pass "derive and also tell me if you
  agree" dispatch defeats the entire phase goal even if it is architecturally simpler.
- **Do not construct a keyword/phrase list for rule-bearingness.** Decision 2 explicitly rejects this
  (176 decision-4 precedent — a hardcoded keyword rule is the same defect class as an absence-phrase
  list). Real borderline lines exist RIGHT NOW in both games (CONTEXT.md's Measured Reality examples,
  plus this research's newly-found `seven`-side page-layout lines) that a keyword list would
  mis-sort.
- **Do not let the comparison dispatch's payload leak into the blind-derivation dispatch's payload.**
  The two contracts must be genuinely separate files or genuinely separate, non-overlapping prompt
  sections — a shared "context" block reused across both would risk the blind step accidentally
  receiving the original line through prompt-construction sloppiness (exactly the anchoring risk
  decision 5 exists to prevent).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Presentation-line filtering | A new 177-local regex/keyword set | `PRESENTATION_EXCLUSION_MARKERS` / `isPresentationLine` (`verify-classify.ts`, exported) | Decision 1 locks verbatim reuse; a third definition drifts from the other two (174/176 already share one) |
| Atomic durable writes | A second `fs.writeFile` path | `atomicWriteFile` (`verify-run.ts`, exported) | Exactly ONE atomic write path must remain in the repo (173-REVIEW.md CR-01's defect class) |
| Enumerated verdict validation | Ad-hoc string checks scattered across call sites | A single `createDeriveVerdictRecord`-style choke point, mirroring `createRulingVerdictRecord` (`verify-ruling-recheck.ts:59-84`) | One place a verdict string is checked against the enum; every recording path routes through it |
| Dispatch-prompt-copied-not-composed proof | Trusting the model to compose a faithful prompt from memory | The `BS-<NAME>-V1` handshake-token pattern (`ruling-recheck.md:16-37`, `classification-subagent.md:16-37`) | A composed prompt cannot be trusted to carry the independence rule intact; the token is proof of copy-not-recall |

**Key insight:** every mechanism this phase needs already has a working precedent exactly two phases
back (176) or three phases back (174). The only genuinely novel engineering is the two-dispatch split
and the quote-lines-only payload filter (Question 1 above) — everything else is disciplined reuse.

## Common Pitfalls

### Pitfall 1: Assuming the marker-based filter fully determines the "rule-bearing candidate" set

**What goes wrong:** A plan that treats `isPresentationLine`'s survivors as "the rule-bearing lines"
undercounts the judgment work decision 2 requires — several `seven`-side lines with no qualifier at
all (page-layout, card-art descriptions) will reach the subagent and depend entirely on it returning
`not-rule-bearing`.
**Why it happens:** `seven`'s live slices predate Phase 170 AND use no `— diagram description`/`— art`
qualifier at all on presentation-shaped lines — they are indistinguishable from rule-bearing lines by
regex alone.
**How to avoid:** Design the rule-bearingness dispatch (or the blind-derivation dispatch's
`not-rule-bearing` outcome) assuming it WILL be exercised on real data, not merely as defensive
coverage for hypothetical future ambiguity.
**Warning signs:** A proof run reporting zero `not-rule-bearing` verdicts on the real 22-line corpus
would be suspicious given this research's direct finding of at least 3 unqualified presentation-shaped
lines in `seven` alone.

### Pitfall 2: Under-predicting `underivable`

**What goes wrong:** Committing (per decision 10) to a low `underivable` prediction, then discovering
post-hoc that a meaningful fraction of lines depend on OTHER `Derived` (diagram-description) lines
rather than directly quoted prose — structurally excluded from the blind-derivation payload by
construction.
**Why it happens:** CONTEXT.md's framing ("several real Derived lines... plausibly came from PDF
images") reads as a modest caveat; this research's line-by-line sampling shows the dependency chain is
broader (Derived-depends-on-Derived, not just Derived-depends-on-PDF-image).
**How to avoid:** Predict a genuinely substantial `underivable` share (not a token few) before
measuring, per decision 10's git-ordering discipline — and do not treat a high `underivable` count as
a design failure per decision 11.
**Warning signs:** A committed prediction of <20% underivable, contradicted by a >40% measured result,
would look like the prediction was made without sampling real lines first.

### Pitfall 3: Reusing `resolveFreshTranscription` (Phase 176) as-is

**What goes wrong:** `resolveFreshTranscription` resolves the STAGED transcription tree
(`rulebook/.verify/<runId>/slices/`), scope-limited when absent. CHECK-04 targets LIVE slices
(decision 12) with no staged run prerequisite — reusing this function verbatim would make CHECK-04
falsely report scope-limited on a project that has never run a staging pass, even though CHECK-04's own
inputs (the live `rulebook/*.md` tree) are fully present.
**How to avoid:** Read the live tree directly, mirroring `verify-classify.ts:585-613`'s existing
`computeRunPairs` live-slice read, not `resolveFreshTranscription`'s staged-tree resolution.
**Warning signs:** CHECK-04 reporting scope-limited on a project where `rulebook/*.md` clearly exists
and is readable.

### Pitfall 4: One dispatch-mechanism claim silently drifting

**What goes wrong:** Stating CHECK-04's dispatch mechanism as "native Task-tool dispatch" without
verifying, when every prior real dispatch in this milestone (173–176) used a `claude -p` OS subprocess
instead.
**Why it happens:** It is the path of least resistance to describe dispatch generically in skill text.
**How to avoid:** State explicitly, in the eventual PROOF.md, which mechanism was actually used — per
`173-PROOF.md` §6's precedent and the `additional_context`'s own instruction.
**Warning signs:** A proof document that never mentions `claude -p` or Task-tool explicitly.

## Code Examples

### Presentation-exclusion reuse (verified working)

```ts
// Source: src/cli/commands/verify-classify.ts:93-106 (exported, reuse directly — decision 1)
import { PRESENTATION_EXCLUSION_MARKERS, isPresentationLine } from './verify-classify.js';

// isPresentationLine("Derived (p.1) — diagram description: ...") === true
// isPresentationLine("Derived (p.1) — diagram description (Plan phase): ...") === false  <- gap
// isPresentationLine("Derived (p.1): The rules page is a single wide, landscape panel...") === false
```

### Enumerated-verdict validation choke point (pattern to mirror)

```ts
// Source: src/cli/commands/verify-ruling-recheck.ts:59-84 (createRulingVerdictRecord)
// CHECK-04's equivalent should mirror this exact shape: validate against DERIVE_VERDICTS,
// require non-empty reasoning AND (per decision 8) non-empty originalReading/rederivedReading
// quotes for any 'disagrees' verdict.
```

### The dispatch-token handshake (pattern to mirror, two tokens needed)

```
// Source: src/cli/slash-command/bs/verify/ruling-recheck.md:16-37 (BS-RULING-RECHECK-V1)
// CHECK-04 needs two: e.g. BS-DERIVE-V1 (blind derivation) and BS-DERIVE-COMPARE-V1 (comparison) —
// a single shared token risks one contract accidentally serving both roles.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Rulings/classifications judged and recorded in one dispatch | Blind-derive-then-separately-compare (two dispatches) | This phase, decision 7 | First instance in this milestone requiring genuine dispatch-to-dispatch independence, not just a subagent/orchestrator split |

**Deprecated/outdated:** None — this phase does not deprecate or replace anything in the existing
verify pipeline; it is purely additive (a new, independent check).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Rule-bearingness judgment can be folded into the blind-derivation dispatch's own RETURN (via a `not-rule-bearing` outcome) rather than requiring a third, separate dispatch stage | Question 4 (dispatch cost) | If the planner instead builds three fully separate dispatch stages, wall-clock roughly doubles (66 vs ~44 dispatches) and the CLI's enumeration/recording shape needs a third recorded stage per line |
| A2 | CHECK-04 needs no `verify-run-init`-scoped run-id at all, since it targets live slices directly with no staged prerequisite | Pitfall 3 / Open Questions | If a run-id scope IS required (e.g. to tie CHECK-04's ledger into the same run as Steps 2-6), the CLI needs `--run-id` plumbing this research did not scope |
| A3 | `seven`'s three unqualified page-layout/art `Derived` lines (36/42 area, `02-solo-variant.md:17`, `01-definitions-and-components.md:33`) will be judged `not-rule-bearing` by a competent subagent | Pitfall 1 | If the subagent instead attempts to derive a "value" for a pure art/layout description, the resulting `underivable` or spurious-agreement verdict would misrepresent what happened — worth naming as a specific worked example in the contract text, mirroring the absence-of-source trap's style |

## Open Questions (RESOLVED)

> Both were resolved before task planning; the original text is retained as the reasoning trail and
> the `RESOLVED` line under each is authoritative.


1. **Does CHECK-04 need its own `--run-id` scope, or does it operate project-wide with no run
   concept at all?**
   - What we know: Decision 12 targets live slices, no staged prerequisite. `verify-ruling-recheck.ts`
     still writes to a run-scoped ledger sibling file even though its OWN judgment reads the staged
     tree (a run does exist for it, from Step 2/3).
   - What's unclear: If a designer runs `/bs-verify-game` fresh with no staging (or CHECK-04 is
     invoked standalone, independent of the rest of the pipeline per its "independent of a verify
     run's staleness verdicts" framing), is there a `run-id` to scope the ledger under at all?
   - Recommendation: Either (a) require CHECK-04 to run within an active verify-run's `.verify/<runId>/`
     scope regardless of whether it consumes staged content (simplest, matches every existing
     ledger's shape), or (b) design a project-level ledger location outside any run-id (e.g.
     `rulebook/.derive-recheck/`) if the phase goal implies this check should be runnable with zero
     interaction with the staging pipeline. Decide this explicitly before planning the CLI surface.


   **RESOLVED — project-level, no `--run-id` scope.** See `177-CONTEXT.md` decision 14. CHECK-04 is
   source-free by construction and independent of any verify run's staleness verdicts, so it has
   nothing to scope to a run. This matches CHECK-03/CHECK-05 (`trace-check`, `drift-check`) exactly:
   read-only project-level sweeps with no run identity. Ledger records are project-scoped and reuse the
   single atomic write path.

2. **Does CHECK-04 gate `/bs-verify-game`'s Close step (Step 7/8), or run independently?**
   - What we know: `verify-game.md`'s current Close condition checks only
     `verify-run-status`/`verify-classify-status`. CHECK-04 is framed as independent of staleness.
   - What's unclear: Whether "independent of staleness verdicts" also means "independent of the
     close gate" (i.e., CHECK-04 can be incomplete when the pass otherwise closes) or whether it
     should still be a completeness condition for Close, just not a STALENESS input.
   - Recommendation: Given CHECK-06 (worked-example replay, Phase 178) and VERIFY-09 (Phase 179, mode
     assembly) both come later and likely also need a similar "does this check gate close" answer,
     resolve this now with a stated rule (e.g. "a check gates close" vs "a check runs and reports,
     Close is unconditional on report-only checks") that the later phases can follow consistently
     rather than each improvising their own answer.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI (`claude -p` subprocess dispatch) | Real proof dispatches (both blind-derive and compare stages) | ✓ (used successfully in Phases 173-176) | — | none needed — already the established mechanism |
| `~/BoardSmithGames/seven` at pinned commit | Proof target 1 | ✓ confirmed `a03f38d4792af9dfc7c798be69686fc3230f54dd`, clean | — | — |
| `~/BoardSmithGames/one-two-punch` at pinned commit | Proof target 2 | ✓ confirmed `7e69471bd8980a854f3e351f2f486e1fb6f712b9`, pre-existing `.boardsmith/` deletions only | — | — |
| Node/npm/vitest toolchain | Unit tests | ✓ (`vitest run` configured in `package.json`, `vitest.config.ts` present) | — | — |

No missing dependencies. This phase needs no new environment setup.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed via `package.json`'s `"test": "vitest run"` and `vitest.config.ts`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` (once created) |
| Full suite command | `npm test` (currently 3893/3893 green per `176-VERIFICATION.md`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHECK-04 (SC-1) | Every rule-bearing `Derived` line re-derived using only current-slice quote lines | unit + real dispatch | `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` (unit); real `claude -p` proof for the live-data claim | ❌ new file, Wave 0 |
| CHECK-04 (SC-2) | Disagreement reported as finding citing both derivations | unit | pinning test on `createDeriveVerdictRecord`-equivalent requiring non-empty `originalReading`/`rederivedReading` on `disagrees` | ❌ new file, Wave 0 |
| CHECK-04 (SC-3) | Runs with no source rulebook present; ignores `Visual` lines | unit | before/after whole-project byte-hash test (mirroring `trace-check.ts`'s T-171-19 style) + `isPresentationLine` reuse pin | ❌ new file, Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/commands/verify-derive-recheck.test.ts`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a real `claude -p` dispatch proof
  against both reference games per the established 171-176 discipline (real runs, `cp -R` copies,
  measured counts never "ran clean", originals confirmed byte-identical).

### Wave 0 Gaps
- [ ] `src/cli/commands/verify-derive-recheck.test.ts` — new file, no existing coverage for any of
      CHECK-04's mechanics.
- [ ] `src/cli/slash-command/bs/verify.test.ts` — needs new pins for the CHECK-04 step insertion
      (contiguity, no-hardcoded-count, Reference Files bullet, dispatch-token drift guards), mirroring
      176-04's existing pattern for Steps 5/6.
- Framework install: none needed — vitest already configured project-wide.

## Security Domain

N/A for this phase per project convention — `security_enforcement` was not found set in
`.planning/config.json` and this milestone's prior phases (172-176) have not included a Security
Domain section; this phase touches no auth, session, network, or crypto surface (it reads local
markdown files and dispatches local subprocess CLI calls). Omitting per the same precedent the sibling
phases in this milestone already set.

## Sources

### Primary (HIGH confidence — direct code read or live regex test, this session)
- `src/cli/commands/verify-classify.ts` (full read, 1190 of 1504 lines directly inspected; remainder
  is the `computeChunkVerdicts` continuation, not needed for this phase's scope)
- `src/cli/commands/verify-ruling-recheck.ts` (full read, 389 lines)
- `src/cli/slash-command/bs/verify/ruling-recheck.md` (full read, 178 lines)
- `src/cli/slash-command/bs/verify/classification-subagent.md` (full read, 195 lines)
- `src/cli/slash-command/bs/verify-game.md` (full read, 201 lines)
- `src/cli/slash-command/bs/verify.test.ts` (targeted read, lines 329-651, plus grep for step-related
  guard tests)
- `src/cli/commands/verify-run.ts` (export inventory via grep, all relevant helpers confirmed exported)
- `src/cli/commands/trace-check.ts` (head read, 80 lines, for `FINDING_KINDS` convention)
- Live grep of `~/BoardSmithGames/{seven,one-two-punch}/rulebook/*.md` for every `Derived (p.` and
  `Visual (p.` line, this session — exact counts re-verified against CONTEXT.md's Measured Reality.
- Live `node -e` regex test of `PRESENTATION_EXCLUSION_MARKERS` against five real line samples, this
  session — the "(Plan phase)"/"(Fight phase)" gap is a directly observed test result, not an
  inference.
- Live `git log -1`/`git status --short` against both reference-game repos, this session.

### Secondary (MEDIUM confidence)
- 173-PROOF.md / 174-PROOF.md / 176-PROOF.md / 176-VERIFICATION.md (read via the required-files list)
  for dispatch-mechanism history (`claude -p` subprocess, never native Task/Agent-tool) and the
  precedent proof structures this phase should mirror.

### Tertiary (LOW confidence)
None — this phase required no external/web research; everything is internal-codebase verification.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, pure internal-codebase reuse, every reused symbol's export
  status directly confirmed.
- Architecture: HIGH — the enumerate/filter/dispatch/record shape is a direct, verified structural
  precedent (176), and the two-dispatch split is a straightforward extension of a documented decision
  (decision 7), not a novel design.
- Pitfalls: HIGH — both the presentation-marker regex gap and the `seven`-side unqualified-line gap
  are directly observed, reproducible facts from this session's own tool calls, not inferred.

**Research date:** 2026-07-30
**Valid until:** Stable for the life of this milestone (v4.9) — the reused mechanisms
(`PRESENTATION_EXCLUSION_MARKERS`, `verify-run.ts`'s atomic ledger family) are locked artifacts from
completed, closed phases (172-176) unlikely to change before Phase 177 executes. Treat as stale if
Phase 178/179 modify `verify-classify.ts` or `verify-run.ts` before this phase starts.
