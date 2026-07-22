# Phase 169: Post-Fix Game De-Workaround Sweep - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Across the FIVE game repos — `~/BoardSmithGames/{lanternfall,seven,one-two-punch,doom-machine}` and `~/BoardSmithGames2/seven` (all symlink `node_modules/boardsmith` → this local checkout, so the v4.8 library fixes are LIVE) — remove every workaround/deferment that existed ONLY because of a now-fixed library bug, gated on each fix being verified present and each game's suite staying green. Re-verify + close the deferred AI opponents (BSR-12), and reclassify the stale Doom BS-10 filing. Requirements: SWEEP-01 (Part E #6), PROC-01. **Spans the GAME repos, NOT the library repo.** MERC is OUT OF SCOPE (not among the 5 listed; separate vendored re-vendor).

**Reconnaissance reality (important):** the actual removable surface is much smaller than the roadmap implied. `.notUndoable()`, function-valued `multiSelect`, `concealFromEverySeat`, and `maxIterations` are LEGITIMATE library APIs — NOT workarounds. The removable part is game-side *compensating logic* + *stale "boardsmith bug" doc comments*. Several hits are explicitly annotated "NOT worked around beyond this guard." The repos track library bugs under their OWN ids (`BUG 3/6/7/8`, `BS-5/9`, `BSR-5`, `BOARDSMITH-BUG-02`), NOT the `Dxx` scheme — a crosswalk must be built first.
</domain>

<decisions>
## Implementation Decisions

### Risk posture — CONSERVATIVE, behavior-preserving
- Remove only **clearly-dead compensating logic** and **stale "boardsmith bug" comments** where the underlying fix is verified present; keep each game's behavior and suite green.
- **DEFER doom-machine's D9/BS-5 single-select enumeration → native panel `multiSelect` rewrite** (it works; the rewrite is a risky game-logic change) — document the deferral with rationale; just refresh its stale BS-5 comment to note the library now supports it.
- **`.notUndoable()` game-side compensating server-re-guards** (seven, one-two-punch, BoardSmithGames2/seven): remove the now-redundant re-guards ONLY IF UNDO-01 (D1, Phase 155) is verified enforcing `.notUndoable()` server-side AND the game's suite stays green after removal; else keep them + note.

### Gating (SC-5 / PROC-01) — every removal is proven
- Before removing any workaround, **verify the specific library fix is present** in the symlinked `boardsmith` checkout (grep the API/behavior that constitutes the fix — e.g. server-side undo executor honoring `hasNonUndoableAction` for D1; function-valued multiSelect in `buildPickMetadata`/panel for D9; `unbounded` loop valve for D29; `suppressFromDock`/contrast/displayedState for D28/D30/D31; Space lifecycle for D22-26). A removal whose fix is NOT verified present is a **BLOCKER — skip it and record why**, never a silent removal.
- After each removal, the game's **full suite (`vitest run`) must stay green**; a regression reverts the removal (no cleanliness traded for a red suite).
- Build the **`Dxx ↔ BUG-n` crosswalk FIRST** from each repo's `BOARDSMITH-BUGS.md` / `BOARDSMITH-REQUESTS.md`, so each removal cites both the repo's own id and the v4.8 defect/fix.

### Out-of-scope / no-op items (record, don't attempt)
- **D32 / `[DRAWDROP]`:** none present in any game `src/` (it's platform-side; Phase 165 deferred it). Nothing to remove — note it.
- **MERC:** not among the 5 repos; separate vendored re-vendor — out of scope for this phase.
- **Two WITHDRAWN Lanternfall filings** (seat display names; seat chips ignoring `--bsg-seat-N`) — already rejected by the maintainer; not open bugs.

### Branch / commit strategy
- Commit each repo's sweep to a **per-repo sweep branch** (e.g. `sweep/v4.8-dework`), NOT master — these are outward-facing shipped repos. Do not push.

### Deferred AI opponents (BSR-12)
- **Re-verify** the AI opponents build + pass now that AI-01 (D9 dynamic multiSelect enumeration) and AI-02 (D8 redacted-view MCTS) shipped (Phase 159). Priority: one-two-punch (BUG 8 — MCTS cloned un-redacted state + sequentialized simultaneous reveal, explicitly "NOT worked around"). lanternfall/seven/BoardSmithGames2-seven also have `src/rules/ai.ts`. doom-machine has NO AI (solo). **Close BSR-12** if the AI now builds+passes; keep-open + note if a residual gap remains.

### Doom BS-10 reclassification
- Reclassify BS-10 as a **game-side art-path fix already handled** (absolute `/cards/`, the repo's own art-path history) — NOT a library bug to re-fix. Fold the scaffold `<base href="/">` gap into a **scaffold-default recommendation** (a note for a future scaffold change), not an open engine defect.

### Claude's Discretion
- Per-repo removal specifics, the sweep-branch name, and the crosswalk doc location are at Claude's discretion within the conservative/gated posture.
</decisions>

<code_context>
## Existing Code Insights (from cross-repo scout) — genuine removable/verify targets per repo

### lanternfall (5 test files; `vitest run`)
- `src/rules/flow.ts:60` `maxIterations: ENGINE_SAFETY_VALVE_ROUNDS` (1e6) — D29/BUG 6. Now that D29 `unbounded:true` shipped, could switch to the valve — but the maxIterations tripwire is legit; conservative = refresh comment only (defer the `unbounded` switch unless trivially safe + green).
- `src/ui/components/GardenBoard.vue:546-548` metadata guard for `availableActions`/`actionMetadata` divergence (SPACE-05/D26, Phase 163). If D26 verified fixed, the guard may be removable — gate on suite green.

### seven (8; `vitest run`)
- `src/rules/actions.ts` `.notUndoable()` ×4 + docblocks calling it INERT server-side (BSR-5 = D1). Remove the game-side reliance/stale commentary IF UNDO-01 verified server-side enforcing.
- `src/rules/elements.ts:565` + `game.ts:141-143` `concealFromEverySeat()` (D24/SPACE-03). SPACE-03 retired the smell — verify the serializer no longer leaks child count, then remove/replace per the fixed API.
- multiSelect assertions (`elements.ts:452`, `game.ts:298`) — defensive barriers around D9; keep unless verified redundant.

### one-two-punch (13; `vitest run`)
- `src/rules/game.ts:308-359` + `guards.ts:199` — reimplemented server-side undo guard (BUG 3 = D1) "must close the undo hole." Prime removal candidate IF UNDO-01 verified server-side + green.
- `src/rules/ai.ts:12-33` (BUG 8 = D8) — MCTS reads un-redacted state + sequentializes reveals; "does NOT try to work around it." Re-verify against AI-02 redacted-view; BSR-12 close candidate.

### doom-machine (38; `vitest run`; SOLO, no AI)
- `src/rules/actions.ts:39-86` + `roll-conditions.ts:273-276` + `App.vue:14-17` — single-select `chooseFrom` enumerating every satisfying subset to dodge BS-5 (D9). **DEFER the native-multiSelect rewrite**; refresh comment.
- `src/rules/flow.ts:70-148` `actionStep({maxMoves})` turn boundaries — related D9/moveCount; keep (legit) unless verified redundant.
- `src/rules/elements.ts:92` + `game.ts:1223` one-slot-one-pile (BS-9 = D23 slot teardown, SPACE-02). Verify SPACE-02 (Space removal/re-parent) then assess.
- Absolute `/cards/*.png` in `cards.ts` + components — BS-10 art paths. Reclassify (see decisions), verify loader relocatability.
- `src/ui/board-height.ts` + `GameTable.vue:55-68` board-height cap (D12-adjacent Fit). ZOOM-01 (Phase 158) re-fit shipped — verify then assess if the cap is still needed.

### BoardSmithGames2/seven (22; `vitest run`)
- `src/rules/actions.ts:64,174,275,354` `.notUndoable()` ×4 + docblocks citing `BOARDSMITH-BUG-02` (= D1). Same UNDO-01 gating as the other seven.
- `multiSelect:{min:7,max:7}` (D9) auto-confirm — legit, keep.
- No `concealFromEverySeat` here (handled differently) — divergence noted.

### Library fixes to verify present (in this repo, symlinked into games)
- D1 UNDO-01 (Phase 155): server undo executor honors `hasNonUndoableAction`. D9 AI-01 (159): function-valued multiSelect in panel + enumeration. D8 AI-02 (159): redacted-view MCTS. D12 ZOOM-01 (158): re-fit. D24 SPACE-03 / D22 SPACE-01 / D23 SPACE-02 / D26 SPACE-05 (163). D29 LIBX-02 (164): `unbounded` valve.

### Established Patterns
- Games consume boardsmith via the symlink → local fixes are live (no re-vendor needed for these 5, unlike MERC).
- Prove-before-fix / no-dummy-hacks / fail-loud apply to the removals too: a removal must be proven safe (fix present + suite green), never assumed.
</code_context>

<specifics>
## Specific Ideas
- Source: post-mortem Part E #6 (`~/BoardSmithLab/findings/BATTERY-POST-MORTEM.md`). BSR-12 (run-003 AI blocked on D9) and BS-10 (Doom art path) are the named closeouts.
- The repos' own `BOARDSMITH-BUGS.md`/`BOARDSMITH-REQUESTS.md` ledgers are the reconciliation targets (SKILLAUTO-08 close-time ledger-reconciliation discipline from Phase 166/167 applies: audit the paperwork, not just the code — update each repo's ledger entry when its workaround is removed).
</specifics>

<deferred>
## Deferred Ideas
- doom-machine D9 single-select enumeration → native panel multiSelect rewrite (risky game-logic change) — deferred with rationale; a future per-game task once the native path is battle-tested.
- MERC re-vendor + sweep — separate manual step, out of scope here.
- Any `unbounded:true` loop-valve adoption in games where the current `maxIterations` tripwire is harmless — deferred unless trivially safe + green.
</deferred>
