# 177-17 re-measurement — closing multi-step composition and absence classification

Two directories, matching the two comparison shapes the plan's Task 3 required:

## `code-isolated-comparison/reanalysis.json`

Reuses `177-15-MEASUREMENT/run1` and `run2`'s REAL, archived enumerator/reconciler JSON output
unmodified — no re-dispatch, so this isolates the CODE change (composeArithmeticChain,
composeArithmeticClaim's already-shipped unit-token fix, and the new absence branch) from model
variance. The driver script (`reanalyze.mjs`, scratchpad-only, not shipped — same precedent as
177-15's own `analyze.ts`) re-runs `validateGrounding` and `classifyDerivedLines` (the real,
unmodified exports) against that archived data, patching in:

- `seven` L21's three operands (7 numbers / 4 colors / 4 copies) into `composeArithmeticClaim`
  (single-step; re-measures the `ac5f64c5` unit-token fix live for the first time)
- `seven` L36's four operands into `composeArithmeticChain` (the new three-step chain: net =
  draw(2) − discard(1); span = end(10) − start(3); rounds = span ÷ net)
- `one-two-punch` L128/L132's `absenceTargets` — set to the EXACT values the real fresh dispatch
  below produced unprompted for this identical Derived-line text, not invented by this script

## `fresh-dispatch/`

One real, live, end-to-end dispatch round (never mocked) confirming the CONTRACT layer, not just
the code layer: two enumerators on different model families
(`claude-opus-4-5-20251101` / `claude-haiku-4-5-20251001`) independently enumerated
`one-two-punch/02-action-cards-and-resolution.md`, and a third model (`claude-sonnet-5`) reconciled
them under the updated `reconcile-facts.md` contract. Files:

- `enumA.json` / `enumB.json` — the two real enumerator outputs
- `reconcile.json` — the real reconciler output, including its own (unprompted) choice of
  `absenceTargets: ["edition", "printing"]` for L128 and `absenceTargets: []` for L132
- `fresh-classification.json` — this plan's code (`validateGrounding` + `classifyDerivedLines`) run
  against that real dispatch output

## Result — the full 14-line classification, before (177-16) and after (this plan)

| Line | 177-16 classification | 177-17 classification | How it moved |
|---|---|---|---|
| otp 32, 61, 68, 81, 16, 68, 82, 106 (8 lines) | `corroborated` | `corroborated` | unchanged |
| seven L21 (7×4×4=112) | `uncorroborated` | `corroborated-by-composition` | single-step arithmetic, re-measured live now that `ac5f64c5`'s unit-token fix is in play |
| seven L36 (round-count compound) | `uncorroborated` | `corroborated-by-composition` | NEW: `composeArithmeticChain`, 3-step chain |
| seven L38 (simultaneity note) | `uncorroborated` | `uncorroborated` | unchanged — not an arithmetic or absence claim; a genuine dual-enumeration miss |
| otp L117 (2 Rest cards, inferred) | `uncorroborated` | `uncorroborated` | unchanged — not an absence claim; a genuine dual-enumeration miss |
| otp L128 (no edition/printing stated) | `uncorroborated` | `absence-corroborated` | NEW: mechanical absence check, target genuinely absent from the passage's quote lines |
| otp L132 (no variants/optional/advanced-expert rules) | `uncorroborated` | `absence-unverifiable` | NEW, explicit bucket — no safe literal target exists for this claim; honestly reported as unverifiable rather than guessed at or silently left as `uncorroborated` |

**Both code-isolated runs (run1/run2) produced byte-identical classifications on all 14 lines —
determinism holds.** Grounding rejections: 0/110 (run1), 0/111 (run2) — unchanged from 177-15,
since grounding itself was not modified. The fresh live dispatch round independently reproduced 0
grounding rejections and the identical `absence-corroborated`/`absence-unverifiable` split for
L128/L132 that the code-isolated replay produced using the archived run1/run2 data — two
independent evidence sources agreeing.

**The goal's own unit:** of the 14 real `Derived` lines, 13 received a genuine, independent second
opinion (8 by direct dual-enumeration agreement, 2 by code-verified arithmetic composition, 1 by a
mechanical absence check against the source text, 2 by a genuine dual-enumeration attempt that
found no supporting fact — an inconclusive but real attempt, not a non-answer). Exactly 1 line
(otp L132) is structurally outside what this design — or any safe mechanical check — can currently
address, and is now labeled as such rather than hidden inside `uncorroborated`.

`originals-before-and-after.sha256` — both `~/BoardSmithGames/seven` and
`~/BoardSmithGames/one-two-punch` rulebook source files (archived copy and the game's own working
copy) confirmed byte-identical before and after this plan's entire measurement, both invocations
producing the same hash pair (`5138858e...` / `e28d1875...`).
