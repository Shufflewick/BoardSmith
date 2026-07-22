---
phase: 159-mcts-soundness-dynamic-multiselect
verified: 2026-07-20T21:20:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
---

# Phase 159: MCTS Soundness + Dynamic multiSelect Verification Report

**Phase Goal:** AI opponents are unblocked and sound — dynamic/function-valued `multiSelect`
enumerates and drives through the panel natively (delivering feature C.2), and MCTS reasons over a
per-seat redacted view rather than cloning un-redacted state and sequentializing simultaneous
reveals.

**Verified:** 2026-07-20T21:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Function-valued/dynamic `multiSelect` enumerates in MCTS (no "No available moves" throw) AND completes through the panel without single-select fallback (C.2/D9) | ✓ VERIFIED | `src/engine/utils/resolve-multiselect.ts` exists with tri-state contract (concrete→config, undefined→single-select, throw→propagate). `enumerate-moves.ts:194` calls it in `_enumerateRecursive`. `action-metadata.ts:153,203` call the SAME helper at both `buildPickMetadata` sites (choice + elements). `action-metadata.test.ts` has explicit parity tests ("parity: buildPickMetadata (panel) and resolveMultiSelect (enumeration) agree...") plus a controller-seam test driving `useActionController.toggleMultiSelect` end-to-end. |
| 2 | MCTS bot for hidden-info games clones only a per-seat redacted view and does not sequentialize simultaneous reveals — non-exploitable (D8) | ✓ VERIFIED | `snapshot.ts:173-192` — `createSnapshot` gained opt-in 5th arg `opts?: { forSeat?: number }`; when supplied uses `game.toJSONForPlayer(opts.forSeat)`, default path unchanged (`game.toJSON()`). `runner.ts:527` calls `createSnapshot` with no `opts` — confirmed default untouched. `mcts-bot.ts:1140` `captureSnapshot` passes `{ forSeat: this.playerIndex }`. Simultaneous-reveal fix: `simultaneousBaseline` field + `maybeCaptureSimultaneousBaseline` (mcts-bot.ts:942) snapshots the searchGame before any co-decider mutates it; `enumerateMovesForSimulation` (mcts-bot.ts:881) enumerates against the frozen baseline when present, wired into both `expandIncremental` and `playoutIncremental` call sites (lines 567, 624/627). |
| 3 | Both fixes carry tests that fail pre-fix and pass after; the "un-enumerable→silently skipped" damage case now enumerates (PROC-01 + fail-loud) | ✓ VERIFIED | Three RED commits confirmed in git log with genuine behavioral (not missing-symbol) failures: `4a9ff646` ("expected [] to have a length of 3 but got +0" / "No available moves" thrown on a resolvable function multiSelect), `65954c57` ("expected undefined to deeply equal { min: 2, max: 2 }" — metadata omission), `276f47fb` ("expected 2 to be undefined" — hidden card value leaked; "expected Set{'x','z'} to deeply equal Set{'y','z'}" — co-decider leak). All in-file `Game` subclasses per the `mcts-restore.test.ts` pattern (not the excluded checkers file). Redaction tests use ≥2 moves (3-choice guess action). Restorability test (`mcts-redaction.test.ts:157`) and adversarial 18-trial exploitability sweep (3 values × 3 seeds × 2 seats) both present and green. |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/utils/resolve-multiselect.ts` | Shared `resolveMultiSelect(selection, ctx)` helper, tri-state fail-loud contract | ✓ VERIFIED | Exists, matches contract exactly (no try/catch around function call — throw propagates). |
| `src/engine/utils/enumerate-moves.ts` | Old `typeof multiSelect === 'function'` silent-skip devWarn removed; routes through `resolveMultiSelect` | ✓ VERIFIED | `grep -c devWarn` → 0, `grep -c "cannot be statically enumerated"` → 0, `resolveMultiSelect` called at line 194. |
| `src/engine/element/action-metadata.ts` | Both `buildPickMetadata` sites (choice + elements) call `resolveMultiSelect` | ✓ VERIFIED | Called at lines 153 (choice) and 203 (elements) — same imported helper, single source of truth. |
| `src/engine/utils/snapshot.ts` | Opt-in `forSeat`/redacted path; default unchanged | ✓ VERIFIED | `createSnapshot(game, type, history, seed, opts?: {forSeat?})` — default branch still `game.toJSON()`; `runner.ts:527` (non-bot caller) confirmed calling with no `opts`. |
| `src/ai/mcts-bot.ts` | `captureSnapshot` passes `forSeat: this.playerIndex`; simultaneous-baseline pre-reveal snapshot | ✓ VERIFIED | Line 1140 `forSeat: this.playerIndex`; `simultaneousBaseline` field (line 68) + `maybeCaptureSimultaneousBaseline` (line 942) wired into both `expandIncremental`/`playoutIncremental`. |
| `src/ai/mcts-multiselect.test.ts` | In-file Game subclasses, fail-loud + variable-range cases | ✓ VERIFIED | 4 in-file `Game` subclasses (`ConcretePairGame`, `VariableRangeGame`, `UndefinedResolutionGame`, `ThrowingResolutionGame`). |
| `src/ai/mcts-redaction.test.ts` | In-file Game subclasses, ≥2 moves, restorability + exploitability tests | ✓ VERIFIED | `HiddenInfoGame` (3-choice guess, ≥2 moves) + `SimultaneousGame`; restorability guard, exploitability baseline, non-exploitability, and adversarial 18-trial sweep all present. |
| `src/engine/element/action-metadata.test.ts` | Parity test (enumeration vs metadata resolve identically) | ✓ VERIFIED | Two explicit parity tests at lines 193 and 205 asserting `buildPickMetadata(...).multiSelect` and `resolveMultiSelect(...)` return identical results. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `enumerate-moves.ts` | `resolve-multiselect.ts` | import + call at `_enumerateRecursive` | WIRED | `resolveMultiSelect(selection, { game, player, args: currentArgs })` |
| `action-metadata.ts` (choice site) | `resolve-multiselect.ts` | import + call | WIRED | Same helper, same ctx shape as function-valued choices |
| `action-metadata.ts` (elements site) | `resolve-multiselect.ts` | import + call | WIRED | Same helper |
| `mcts-bot.ts captureSnapshot` | `snapshot.ts createSnapshot` | `forSeat: this.playerIndex` | WIRED | Redacted at the search root |
| `mcts-bot.ts` enumeration | `simultaneousBaseline` | `maybeCaptureSimultaneousBaseline` + `enumerateMovesForSimulation` | WIRED | Baseline captured before any co-decider mutation, cleared once step resolves |
| `runner.ts` (non-bot) | `snapshot.ts createSnapshot` | no `opts` arg | UNCHANGED (verified) | Confirms redaction is opt-in only, doesn't regress the normal snapshot path |

### Anti-Pattern / Scope Scan

- No determinization / world-sampling code found (`grep -rni "determiniz|sample.*hidden.*world|multi-world|world-generation"` across `src/ai` and the touched engine files → 0 matches). Matches the explicit CONTEXT deferral.
- No TBD/FIXME/XXX debt markers introduced in the touched files.
- No stub patterns (`return []`, `return {}`, empty handlers) in the new production code.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AI-01 | 159-01, 159-02 | Function-valued/dynamic multiSelect in MCTS enumeration + panel | ✓ SATISFIED | Both enumeration and metadata sites verified wired to shared helper; panel-completion proven via real `useActionController` seam test |
| AI-02 | 159-03 | MCTS clones per-seat redacted view, no simultaneous-reveal leak | ✓ SATISFIED | `forSeat` redaction + `simultaneousBaseline` both verified in code; 18-trial adversarial exploitability sweep green |
| PROC-01 | all three | fix → RED test → GREEN → adversarial verification | ✓ SATISFIED | All three RED commits (4a9ff646, 65954c57, 276f47fb) show genuine behavioral failures with verbatim output; GREEN commits confirmed; adversarial tasks (leak-free error messages, parity, 18-trial sweep, non-bot-caller guard) present in test files |

### Behavioral Spot-Check

- `npm test` run directly by verifier (not trusted from SUMMARY): **198 files / 2839 tests passed**, 0 failures — matches the expected count exactly.

### Human Verification Required

None. All three success criteria are verifiable via static code inspection (grep/read) plus a green test suite the verifier ran independently.

### Gaps Summary

None. All 3 roadmap success criteria verified in shipped code, not just SUMMARY claims. The shared `resolveMultiSelect` helper is genuinely the single source of truth (same import, same call signature, at both the MCTS enumeration site and both `buildPickMetadata` sites, with an explicit parity test proving byte-identical resolution). The redaction fix is opt-in and verified non-regressive for the existing non-bot `runner.ts` caller. The simultaneous-reveal fix goes to the `continueFlow`-adjacent baseline-snapshot level, not just a reordering of the two originally-named helper functions, matching what CONTEXT anticipated might be required. No determinization code was introduced (correctly out of scope).

---

_Verified: 2026-07-20T21:20:00Z_
_Verifier: Claude (gsd-verifier)_
