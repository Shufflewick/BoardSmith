# 177.1-06 Task 2 — Diff Report: product-path replay vs. pre-registration vs. `analysis-run1.json`

Replayed 177-22 run1's recorded `seven` returns through the real product CLI
(`boardsmith verify-derive-check` / `boardsmith verify-derive-record`, invoked via `node
bin/boardsmith.js`) against the staged copy at `.../scratchpad/177.1-06/seven`. Inputs were
transformed independently (not copied) from `177-22-MEASUREMENT/run1/enum/*.json` and
`run1/reconcile/*.json` — `.facts`/`.reconcile` extracted, generic unescaped-quote repair applied
if needed (0 repairs needed — see `repair-log.json`), `arithmeticSpec` injected per the
pre-registration's disclosure and nothing else — then cross-checked byte-for-byte identical
(after JSON re-serialization) against `src/cli/commands/__fixtures__/177-22-run1-seven/*` (177.1-03's
own independently-hand-amended fixtures for the same corpus). Zero `claude -p` and zero
Task-tool dispatches occurred during this task.

Commands run, in order:
1. `boardsmith verify-derive-record --project <staged> --slice-path rulebook/01-definitions-and-components.md --enumerator-a ... --enumerator-b ... --reconciler ... --json`
2. `boardsmith verify-derive-record --project <staged> --slice-path rulebook/01-overview-setup-and-play.md --enumerator-a ... --enumerator-b ... --reconciler ... --json`
3. `boardsmith verify-derive-check --project <staged> --json` → saved to `replay-result.json`

---

## 1. Enumerator payload sha256

| Slice | PREDICTED (pre-registration) | ACTUAL (`replay-result.json` / dry-run.json) | Verdict |
|---|---|---|---|
| `rulebook/01-definitions-and-components.md` | `96cb16f3...9ff` | `96cb16f3...9ff` (dry-run.json, unchanged — same rulebook text) | **MATCH** |
| `rulebook/01-overview-setup-and-play.md` | `b5f627b0...7e8` | `b5f627b0...7e8` (dry-run.json, unchanged) | **MATCH** |

(`verify-derive-check --json`'s final report, run AFTER both slices are fully recorded, no
longer emits `enumeratorPayload` for either slice — both are now `pendingCount: 0` — which is
itself the expected, correct behavior: `enumeratorPayload` is documented to appear only for
slices with at least one PENDING candidate. This is not a divergence; the payload-byte comparison
was already made against the pre-recorded dry-run, per the pre-registration's own item 1.)

## 2. Candidate-line selection

| Slice | PREDICTED | ACTUAL | Verdict |
|---|---|---|---|
| `01-definitions-and-components` | `[{21, "...112 numbered cards..."}]` | `[{21, "...112 numbered cards..."}]` | **MATCH** |
| `01-overview-setup-and-play` | `[{36,...}, {38,...}]` | `[{36,...}, {38,...}]` | **MATCH** |

## 3. Grounded / rejected counts

| Slice | PREDICTED | ACTUAL (`verify-derive-record --json`'s `rejected` + inferred grounded count from `groundedQuotes`) | Verdict |
|---|---|---|---|
| `01-definitions-and-components` | 9 grounded / 0 rejected | `rejected: []` (0); `groundedQuotes` for L21 references 2 distinct grounded facts across 3 cited slots (matches the tie-break disclosure below), consistent with `analysis-run1.json`'s `groundedBothCount: 9` | **MATCH** |
| `01-overview-setup-and-play` | 19 grounded / 0 rejected | `rejected: []` (0); consistent with `analysis-run1.json`'s `groundedBothCount: 19` | **MATCH** |

Exact `groundedBothCount` is not directly re-emitted by `verify-derive-record --json`'s output
shape (only `records`/`ledgerPath`/`rejected`), so this line is confirmed via the independent
direct `reconcileSlice` call already performed in the pre-registration (item 3 there), which
DOES expose `result.grounding.grounded.length`/`.rejected.length` and returned exactly 9/0 and
19/0 — the CLI's `verify-derive-record` runs the identical `reconcileSlice` function internally,
so `rejected: []` in both replay invocations is the CLI-surfaced confirmation of the same
zero-rejection result. **MATCH, both slices.**

## 4. Composed-fact ids

| Line | PREDICTED | ACTUAL (`records[].citedFactIds`, cross-checked against the pre-registration's independently-computed composed id) | Verdict |
|---|---|---|---|
| L21 | `ccb54c72d6b176e1` | `citedFactIds: [cbaa8750d8f3b1f1, ad79d5ad4e533e81, ad79d5ad4e533e81]` — identical operand-id triple to `analysis-run1.json`'s recorded `composeAttempts[0].outcome.composed.operandIds`, and the pre-registration's own direct `reconcileSlice` call (item 4) computed the composed id from these exact operands as `ccb54c72d6b176e1` | **MATCH** |
| L36 | `580cab72645565db` | `citedFactIds: [536aed6525420431, 46a14b21380ac276, 776977029a57add9, e0612a230eb50563]` — identical to `analysis-run1.json`'s recorded `operandIds`, matching the pre-registration's `580cab72645565db` | **MATCH** |

(`verify-derive-record --json`'s `records[]` shape reports `citedFactIds`, not a bare composed-fact
id string; the composed-fact id itself was independently confirmed via the pre-registration's
direct `reconcileSlice` call using the identical transformed inputs. The operand-id sequences —
which fully determine the composed id, since it is a deterministic hash of derivedLineText +
operand magnitudes + operation — match `analysis-run1.json` exactly for both lines.)

## 5. Per-line classifications

| Line | PREDICTED | ACTUAL (`records[].verdict` / `findings[].verdict`) | Verdict |
|---|---|---|---|
| L21 | `corroborated-by-composition` | `corroborated-by-composition` | **MATCH** |
| L36 | `corroborated-by-composition` | `corroborated-by-composition` | **MATCH** |
| L38 | `corroborated` | `corroborated` | **MATCH** |

`replay-result.json`'s `verdictCounts`: `{corroborated: 1, corroborated-by-composition: 2, all
others: 0}` — exactly 1 `corroborated` (L38) + 2 `corroborated-by-composition` (L21, L36), no
`uncorroborated`/`contradicted`/other verdict anywhere. **MATCH.**

## 6. citedFactIds

| Line | PREDICTED | ACTUAL | Verdict |
|---|---|---|---|
| L21 | `[cbaa8750d8f3b1f1, ad79d5ad4e533e81, ad79d5ad4e533e81]` | `[cbaa8750d8f3b1f1, ad79d5ad4e533e81, ad79d5ad4e533e81]` | **MATCH** |
| L36 | `[536aed6525420431, 46a14b21380ac276, 776977029a57add9, e0612a230eb50563]` | `[536aed6525420431, 46a14b21380ac276, 776977029a57add9, e0612a230eb50563]` | **MATCH** |
| L38 | `[a36165c83c49a071]` | `[a36165c83c49a071]` | **MATCH** |

## 7. Exit codes

| Invocation | PREDICTED | ACTUAL | Verdict |
|---|---|---|---|
| `verify-derive-check` (dry run, Task 1) | 0 | 0 | **MATCH** |
| `verify-derive-record` (slice 1) | 0 | 0 | **MATCH** |
| `verify-derive-record` (slice 2) | 0 | 0 | **MATCH** |
| `verify-derive-check --json` (final report) | 0 | 0 | **MATCH** |

---

## Zero divergences

Every one of the seven mechanical categories the pre-registration committed to matched exactly.
**No prediction diverged from the actual replay result.** `.planning/phases/177.1-wire-check04-closed-design/177.1-PRE-REGISTRATION.md`
is unmodified by this task (`git diff HEAD~1 -- .../177.1-PRE-REGISTRATION.md` is empty, verified
below).

## `validateGrounding` tie-break — re-observed, not a divergence

Consistent with 177.1-03's Finding 2 (carried forward and disclosed in the pre-registration): L21's
recorded `groundedQuotes` for the composed proposal shows the SAME underlying "4 copies" grounded
fact (statement `"There are 4 copies of each card."`) cited twice — once for the "4 colors"
operand slot and once for the "4 copies" operand slot — because both `arithmeticSpec.operandStatements`
entries for the magnitude-4 slots resolve, via `validateGrounding`'s deterministic tie-break, to
the identical grounded fact object (same underlying source sentence quoted by both). This is the
exact, expected behavior 177.1-03 already characterized as a real, load-bearing property of the
design, not a bug — and it reproduces `analysis-run1.json`'s own recorded `operandIds` (which
also list the SAME id, `ad79d5ad4e533e81`, twice). **Re-observed exactly as predicted, not a
finding requiring further action here.**

## Original reference game — untouched

`shasum -a 256 -c 177.1-REPLAY-PROOF/baseline-seven.sha256`, re-run AFTER the full replay
(Task 2 completion), against the ORIGINAL `~/BoardSmithGames/seven` tree (never the staged copy):
**263 of 263 entries report OK.** All work in this task operated exclusively on the `cp -R`
staged copy at `.../scratchpad/177.1-06/seven`; the ledger write (`rulebook/.derive-check/verdicts.md`)
landed only inside that staged copy, never in `~/BoardSmithGames/seven`.

## Scope of the exactness claim (restated, per this plan's own instructions)

This replay proves the product CLI's MECHANICAL pipeline (`buildEnumeratorPayload` →
`validateGrounding` → `composeArithmeticClaim`/`composeArithmeticChain` → `classifyDerivedLines`
→ ledger write → ledger read/report) reproduces `analysis-run1.json`'s exact recorded numbers
when given EQUIVALENT recorded input, including a hand-amended `arithmeticSpec` this exact corpus
never carried until 177.1-03 invented the field. **It does NOT prove that a live Sonnet-5
reconciler dispatch, following the now-wired `reconcile-facts.md` prompt, will independently
produce a well-formed `arithmeticSpec` that resolves to these same operand ids** — no live
dispatch has ever populated this field for any corpus. That live-dispatch proof is plan 08's, not
this plan's.
