# 178-11 OUTCOMES — per-example run-1 / run-2 verdicts and generated-test PASS/FAIL

All verdicts below were RECORDED from the ledger written by real `verify-example-record` calls
against real live `claude -p` extraction/translation dispatches. Every `agrees`/`disagrees` verdict
was determined by ACTUALLY EXECUTING the generated test with the project's own `vitest` — never
from the translator's own `verdictHint` (per `build/test.md` (f) and this plan's Task 2 mandate).
`PASS`/`FAIL` below is that observed vitest result; `unexecutable`/`example-inconsistent` rows never
produced a test to run.

Columns: game | slice | line | kind | run-1 verdict | run-1 test PASS/FAIL | run-2 verdict | run-2
test PASS/FAIL | note.

## `seven`

| slice | line | kind | run-1 verdict | run-1 PASS/FAIL | run-2 verdict | run-2 PASS/FAIL | note |
|---|---|---|---|---|---|---|---|
| 01-definitions-and-components.md | 6 | predicate | unexecutable (no-matching-symbol) | n/a — no test generated | unexecutable (no-matching-symbol) | n/a | Run 2 cited this same content at line 5 — an off-by-one line-citation defect (content verbatim-matched; line number did not). Outcome stable. |
| 01-definitions-and-components.md | **12 (the designated adversarial fixture)** | — | **example-inconsistent**, `contradictionA`="example: 5, 6, 7", `contradictionB`=Visual line naming "1, 2, 3" | never a test — by design | example-inconsistent (same, cited at line 11 — same off-by-one) | never a test | **IN-SET, exactly as pre-registered.** Both contradicting excerpts recorded both runs. |
| 01-overview-setup-and-play.md | — | — | 0 examples | — | 0 examples | — | Matches pre-registration `{no-extraction}` both runs. |
| 02-solo-variant.md | — | — | 0 examples | — | 0 examples | — | Matches pre-registration `{no-extraction}` both runs. |

## `one-two-punch`

| slice | line | kind | run-1 verdict | run-1 PASS/FAIL | run-2 verdict | run-2 PASS/FAIL | note |
|---|---|---|---|---|---|---|---|
| 01-setup-and-round-structure.md | 51-52 | transition | unexecutable (unmodeled-component-state) | n/a | unexecutable (unmodeled-component-state) | n/a | Stable. IN-SET. |
| 01-setup-and-round-structure.md | 78-79 (FIGHT) | transition | **disagrees** | **FAIL** — `TypeError: Cannot read properties of undefined (reading 'sequence')` (run 1) | **disagrees** | **FAIL** — `TypeError: Cannot read properties of undefined (reading 'map')` in `createActionCards` (run 2) | **Outcome-stable (both FAIL/disagrees).** Different failure modes each run — both real construction-API guesses that don't match the real element-tree API. IN-SET (`{agrees, disagrees, unexecutable}`). |
| 02-action-cards-and-resolution.md | 36-37 (ADVANCE) | transition | unexecutable→**disagrees** (code produced, FAILED) | **FAIL** — `No player in seat blue` | **disagrees** | **FAIL** — `TypeError: cornerOf is not a function` | Outcome-stable (both FAIL). Cited at line 37 (run 1) vs 36 (run 2) — same off-by-one pattern. IN-SET. |
| 02-action-cards-and-resolution.md | 65-66 (PUNCH) | transition | unexecutable (no-matching-symbol) | n/a | unexecutable (no-matching-symbol) | n/a | Stable. IN-SET. |
| 02-action-cards-and-resolution.md | 86-89 (Punch Ex. 1) | transition | unexecutable (no-matching-symbol) | n/a | unexecutable (no-matching-symbol) | n/a | Stable. IN-SET. |
| 02-action-cards-and-resolution.md | 91-94 (Punch Ex. 2) | transition | **disagrees** | **FAIL** — `TypeError: Cannot read properties of undefined (reading 'sequence')` | unexecutable (no-matching-symbol) | n/a — no test generated | **UNSTABLE at the translation-attempt level.** Run 1 attempted real code and it failed; run 2 declined the same example as unexecutable. Both are legitimate members of the permitted set `{agrees, disagrees, unexecutable}`, so neither is individually OUT-OF-SET — but the DISAGREEMENT between runs on whether a test can even be attempted is a real, honestly-reported instability distinct from decision 15's strict PASS/FAIL-outcome definition (which only applies when both runs produce a test to run). |
| 02-action-cards-and-resolution.md | 113/114/115 (Tips section) | transition/predicate | unexecutable ×3 | n/a | unexecutable ×3 (run 2 found equivalent extras at 113-115 too) | n/a | **OUT-OF-SET relative to the pre-registered corpus — reported plainly, not suppressed.** These three lines are NOT in `178-PRE-REGISTRATION.md`'s Section 1 table; the live extractor judged them concrete enough to count as worked examples on BOTH runs (identification variance the extraction contract calls a legitimate judgment call). All three ended up `unexecutable` both runs — no test was ever generated from them, so they never affected TEST-01/CHECK-06's pass/fail claims, but the *identification* itself diverges from the human-corrected pre-registration. |

## `doom-machine`

| slice | line | kind | run-1 verdict | run-1 PASS/FAIL | run-2 verdict | run-2 PASS/FAIL | note |
|---|---|---|---|---|---|---|---|
| 01-destroying-a-machine-part.md | 13 | predicate | unexecutable (image-derived-indeterminate) | n/a | unexecutable (image-derived-indeterminate) | n/a | Stable. IN-SET. |
| 01-dice-roll-symbology.md | 6 (symbol 1) | predicate | unexecutable | n/a | unexecutable | n/a | Stable both runs. |
| 01-dice-roll-symbology.md | 9 (symbol 2) | predicate | unexecutable | n/a | **agrees** | **PASS** | Run 2 attempted and PASSED a candidate run 1 declined. |
| 01-dice-roll-symbology.md | 12 (symbol 3) | predicate | unexecutable | n/a | unexecutable | n/a | Stable both runs. |
| 01-dice-roll-symbology.md | 15 (symbol 4) | predicate | unexecutable | n/a | unexecutable | n/a | Stable both runs. |
| 01-dice-roll-symbology.md | 18 (symbol 5) | predicate | **agrees** | **PASS** — `isSatisfiedBy(diceRequired([4,5]), [4,5])` returned `true` as expected | unexecutable | n/a | Run 1 PASSED this one; run 2 declined it. |
| 01-dice-roll-symbology.md | 21 (symbol 6) | predicate | unexecutable | n/a | **disagrees** | **FAIL** — `TypeError: Cannot read properties of undefined (reading 'kind')` inside `diceRequired` | Run 2 attempted and FAILED a candidate run 1 declined. |
| — dice-roll-symbology block overall — | | | | **1 of 6 candidates PASSED (line 18)** | | **2 of 6 candidates attempted, 1 PASS (line 9) + 1 FAIL (line 21)** | **Composite-block identification & translation-attempt variance — the pre-registration explicitly flagged this granularity call as the subagent's judgment (Section 1); both runs found at least one real, passing, project-import-resolving generated test in this block, which is itself a positive, reproducible signal, but WHICH specific symbol resolves varies run to run.** IN-SET at the slice level (`{unexecutable, example-inconsistent, agrees, disagrees}` was the pre-registered permitted set for this whole block); not comparable example-by-example because identification itself diverges. |
| 02-machine-phase.md | 9-10 (SOUL HARVESTER) | transition | unexecutable (no-matching-symbol) | n/a | unexecutable (no-matching-symbol) | n/a | Stable (off-by-one line citation: 10 vs 9). IN-SET. |
| 02-player-actions.md | — | — | 0 examples (matches pre-registration `{no-extraction}`) | — | **1 example found (line 42, unexecutable)** | n/a | **OUT-OF-SET relative to the pre-registered corpus.** Pre-registration expected zero examples here; run 2's extractor judged a `Diagram description` line concrete enough to count. Never became a test (unexecutable both by the honest judgment and by construction, since it was never even found in run 1). Reported plainly per decision 17's spirit (identification variance is a real finding, not smoothed over). |
| 4 remaining zero-content-line slices (01-cards-parts-set-1, 01-cards-trackers, 02-cards-tracker-player-hp-b-side, 03-cards-parts-set-1) | — | — | 3 of 4 returned valid `{examples: []}`; 1 malformed (see REJECTIONS) | — | 2 of 4 returned valid `{examples: []}`; 2 malformed (see REJECTIONS) | — | **A real, reproducible reliability finding, separate from the worked-example corpus itself:** across 8 dispatches of the 4 slices whose extraction payload carries zero content lines (only the `BS-EXAMPLE-EXTRACT-V1` token + slice header), 3/8 (37.5%) returned a non-JSON, unparseable response instead of the contractually-required `{examples: []}`. The extraction contract (`extract-example.md`) never explicitly addresses the "payload has zero content lines" case; a genuinely empty extraction payload is a live, reproducible failure mode worth naming for future contract hardening — never repaired or hand-fixed here per the plan's explicit "no repair utility" instruction (177.1-03's recorded decision, reused). |
| 12 remaining `{no-extraction}` slices | — | — | 0 examples, matches pre-registration | — | 0 examples, matches pre-registration | — | Stable both runs, all IN-SET. |

## Malformed dispatch returns (never hand-repaired — recorded verbatim)

See `REJECTIONS-run1.json` (1 entry) and `REJECTIONS-run2.json` (2 entries) for the verbatim raw
text of every malformed extraction return. All three occurred on slices whose extraction payload
carries zero content lines.

## Stability summary (decision 15 — PASS/FAIL outcome of the SAME example, run twice)

Directly comparable pairs (same content, both runs produced a generated test to execute):

- `one-two-punch` FIGHT example (line 78-79): **FAIL / FAIL — stable.**
- `one-two-punch` ADVANCE example (line 36-37): **FAIL / FAIL — stable.**

Both directly-comparable, code-producing pairs agreed on outcome (2/2 stable). Two runs phrasing
the generated code differently (different constructor guesses, different failure messages) while
both agreeing the test FAILS is counted as a SUCCESS per decision 15 — not a flip.

Beyond the strict definition, this run surfaced three real, honestly-reported forms of variance
that decision 15 does not directly cover (identification and translation-attempt variance, not
executed-outcome variance):

1. **Translation-attempt instability** (one-two-punch line 91-94: code+FAIL in run 1, declined-unexecutable in run 2).
2. **Composite-block identification variance** (doom-machine dice-roll-symbology: different specific symbol chosen for the one PASS each run; run 2 additionally attempted and failed a second symbol).
3. **Slice-level identification variance** (doom-machine 02-player-actions: 0 examples run 1, 1 example run 2; one-two-punch Tips-section lines 113-115: found both runs but not pre-registered).

None of these are silently smoothed over or treated as failures of the mechanism — decision 17's
standard (a game/slice with a different example count than expected is a real finding about the
ingest/extraction contract, never a tuning signal) is applied to each.
