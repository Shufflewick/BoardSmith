# Phase 169: Dxx ↔ Repo-BUG-n Crosswalk + Library Fix-Present Checklist

**Purpose:** The SC-5/PROC-01 removal gate for plans 169-02..06. No per-repo plan may remove a
workaround unless (a) the workaround's row below maps to a v4.8 `Dxx` defect, AND (b) that `Dxx`'s
fix has a **PRESENT** verdict in the "Library Fix-Present Checklist" section, grep-verified against
the live symlinked `boardsmith` source (`/Users/jtsmith/BoardSmith/src` ≡ `node_modules/boardsmith/src`
in every one of the five game repos). **ABSENT ⇒ the removal is a BLOCKER, not a silent skip** — the
per-repo plan must record it and leave the workaround in place.

This plan makes **zero edits to any game repo**. It is a library-repo-only research/documentation
artifact.

---

## 1. Crosswalk Table

One row per filing across the five repos' own bug/request ledgers. `Disposition-hint` is advisory
for the downstream per-repo plans — it is re-validated (fix-present + green suite) before any
removal actually happens.

### lanternfall (`~/BoardSmithGames/lanternfall/BOARDSMITH-BUGS.md`)

| Repo-id | Filing title | Dxx | v4.8 req | Fix phase | Sweep target file:line (from CONTEXT) | Disposition-hint |
|---|---|---|---|---|---|---|
| BUG 1 | Time-travel view desyncs `#game-board` (historical board, live action state) | D31 | LIBX-04 | 164 | n/a (no lanternfall compensating code identified in CONTEXT inventory — filing itself is the fix request) | no-op (nothing to remove in-game; verify fix landed) |
| BUG 2 | `useAutoZoom` reserves dock height before dock exists | D12 | ZOOM-01 | 158 | `src/ui/board-height.ts` / `GameTable.vue:55-68` equivalents are doom-machine's, not lanternfall's — lanternfall has no board-height-cap workaround called out in CONTEXT | no-op (verify fix; no lanternfall removal target identified) |
| BUG 3 | `scanAssetReachability()` false-positives on `<img` inside comments/prose | — (tooling defect, not in D1-D32 list; a build-gate script bug, not a runtime library defect) | n/a | n/a (not part of v4.8 D1-D32 battery) | n/a | out-of-scope for this phase's Dxx crosswalk (asset-gate tooling, not a game-side workaround) |
| BUG 4 | `PlayerToken` glyph ink hard-coded white — blank chip on light seat color | D30 | LIBX-03 | 164 | n/a (no lanternfall PlayerToken override identified in CONTEXT inventory) | no-op (verify fix; no lanternfall removal target identified) |
| BUG 5 | auto-fill cannot be suppressed for a single pick by a game | — (not in D1-D32 battery; filed but not part of this sweep's defect list) | n/a | n/a | n/a | out-of-scope (not a v4.8 Dxx defect) |
| BUG 6 | `loop()` cannot express a genuinely unbounded game | D29 | LIBX-02 | 164 | `src/rules/flow.ts:60` `maxIterations: ENGINE_SAFETY_VALVE_ROUNDS` | **169-02 OUTCOME: comment refreshed, valve KEPT.** D29 confirmed PRESENT (`unbounded` opt-in in `engine/flow/builders.ts`). Stale docblock in `flow.ts` updated to record the fix and explain why the `maxIterations` tripwire stays (harmless, no test coverage to prove `unbounded:true` swap is safe). BUG 6 closed as fixed-upstream in the game's own ledger. Suite green (214/214) before and after. |
| BUG 7 | `availableActions`/`actionMetadata` divergence — `start(action)` fails "No metadata" | D26 | SPACE-05 | 163 | `src/ui/components/GardenBoard.vue:546-548` metadata guard | **169-02 OUTCOME: kept-and-noted, NOT removed.** D26 confirmed PRESENT (server-side reconciliation in `session/utils.ts` + client defense-in-depth in `useActionController.ts`). Removal was attempted per the gated protocol and turned `tests/a11y.test.ts` RED (the guard's own regression test mocks `getActionMetadata()` to `undefined` directly, independent of server-side timing) — reverted immediately. Guard is genuinely defensive against a client-side broadcast-timing race, not solely a compensating workaround for the now-fixed server divergence; documented in `BOARDSMITH-BUGS.md`. |

**BSR-12 (AI, D9/AI-01 + D8/AI-02) — lanternfall status:** `src/rules/ai.ts` and `tests/ai-smoke.test.ts`
are pre-existing **untracked WIP** in the lanternfall repo (not committed by this sweep, per the plan's
explicit instruction). Read and run only: `npx tsc --noEmit -p .` is clean (AI module type-checks), and
`tests/ai-smoke.test.ts` passes as part of the full `npx vitest run` (5 files / 214 tests green). The AI
implementation wires all five MCTS hooks (objectives, threat response, playout policy, move ordering, UCT
constant) against the game's own public geometry, with no visible workaround language for D9/D8 in the
file. **Verdict for 169-06 Task 3: lanternfall's AI builds + passes; present as untracked WIP, not yet
committed to the repo by any BoardSmith-repo process.**

### seven (`~/BoardSmithGames/seven/BOARDSMITH-REQUESTS.md`)

| Repo-id | Filing title | Dxx | v4.8 req | Fix phase | Sweep target file:line (from CONTEXT) | Disposition-hint |
|---|---|---|---|---|---|---|
| BSR-1 | A hidden `Space` still leaks its exact child count | D24 | SPACE-03 | 163 | `src/rules/elements.ts:565` + `game.ts:141-143` `concealFromEverySeat()` | **169-03 OUTCOME: RESOLVED, removed.** D24 confirmed PRESENT. `Mess.concealFromEverySeat()` now calls only `contentsHidden()`; the redundant `setVisibilityInternal(visibilityFromMode('hidden'))` call and the now-unused `visibilityFromMode` import were removed. `game.ts:141-143` was doc-only (no compensating logic). Suite green before/after (204/205, the 1 remaining failure is unrelated, see below). Ledger marked RESOLVED. |
| BSR-2 | Element class sharing a name with a BoardSmith class silently renamed | D25 | SPACE-04 | 163 | not called out as a compensating-code target in CONTEXT inventory | no-op (verify fix; no removal target identified) |
| BSR-3 | Sole no-argument action is auto-EXECUTED | — (not in D1-D32 battery per CONTEXT/ROADMAP; tracked separately as C.3/LIBX-01 dock-suppression territory, but the auto-execute-on-mount behavior itself is not one of the 32 deduped defects) | n/a | n/a | n/a | **169-03 OUTCOME: PARTIALLY RESOLVED, test-only.** `ActionBuilder.manual()` now exists upstream (its own API-existence tripwire in `tests/game.test.ts` unexpectedly started passing, flipped `it.fails`→`it()`). NOT wired onto `draw` — that is a real UX behavior change (draw becomes click-to-run) and stayed out of scope for this D1/D24-gated sweep per the discretion this row grants. Deferred to a future BSR-3-specific plan. |
| BSR-4 | `boardsmith dev` drops game's color palette | — (dev-host defect, not in D1-D32 list) | n/a | n/a | n/a | out-of-scope (dev tooling, not a game-side runtime workaround) |
| BSR-5 | `.notUndoable()` is INERT — no undo executor enforces it | D1 | UNDO-01 | 155 | `src/rules/actions.ts` `.notUndoable()` ×4 + docblocks calling it inert server-side | **169-03 OUTCOME: RESOLVED, docblocks refreshed.** D1 confirmed PRESENT. seven had NO game-side compensating re-guard LOGIC — only stale "inert server-side" prose across all 4 `.notUndoable()` docblocks in `actions.ts`, now refreshed to cite D1/UNDO-01 + `assertUndoAllowed`. The `.notUndoable()` calls themselves are kept (legit API). All 5 self-cancelling `it.fails` undo tripwires (`game.test.ts` x4, `match.test.ts` x1) flipped to passing plain `it(...)`, empirically confirming the server now refuses the forged undo. Ledger marked RESOLVED. |
| BSR-6 | A `Space` cannot be sealed (no write-only/append-only zone) | D22 | SPACE-01 | 163 | not called out as a compensating-code target in CONTEXT inventory | no-op (verify fix; no removal target identified) — its own `it.fails` tripwire (`tests/game.test.ts:779`) still correctly fails; left untouched |
| BSR-7 | Undo is seat-1-only in `simultaneousActionStep` | D3/D4 (SIM family, not explicitly named D-number in CONTEXT; ROADMAP Phase 156/157 territory) | n/a (outside D1/D9/D8/D12/D22-26/D28-31 scope this crosswalk targets) | n/a | n/a | out-of-scope for this crosswalk's fix-present checklist (no seven compensating-code target identified in CONTEXT inventory). **169-03 note:** a related, unlabeled pre-existing test failure in the same SIM family (`tests/game.test.ts` — "refuses a published-discard undo from every seat EXCEPT seat 1 staging last") was found on baseline (before any 169-03 edit) and left unmodified; logged to `deferred-items.md` in this phase dir. |
| BSR-8 | seat status/dock turn-based in `simultaneousActionStep`, misleading "Your move" | same SIM family as BSR-7 | n/a | n/a | n/a | out-of-scope (no removal target identified) |
| BSR-9 | Game Over panel is an undismissable modal | — (not in D1-D32 battery) | n/a | n/a | n/a | out-of-scope |
| BSR-10 | Forward exits from FINISHED game (Rematch/New Game/restart) are inert | — (not in D1-D32 battery) | n/a | n/a | n/a | out-of-scope |
| BSR-11 | `suppressActionPanel` all-or-nothing | D28 | LIBX-01 | 164 | not called out as a compensating-code target in CONTEXT inventory (dock-suppression is a library-side fix, not a game workaround) | no-op (verify fix; no removal target identified) |
| BSR-12 | MCTS bot cannot play a REQUIRED action with function-based `multiSelect` | D9 | AI-01 | 159 | `src/rules/ai.ts` (seven has `src/rules/ai.ts` per CONTEXT) | **169-03 OUTCOME: CLOSED.** Re-verified via a scratch headless repro matching this filing's own "Repro" steps (`createTestGame` → 7 rounds of draw/discard → `createBot(...).play()` at the `score` step): the bot now resolves `chooseScoring`'s function-based `multiSelect` and returns a legal move instead of throwing "No available moves". `src/rules/ai.ts` also type-checks cleanly (`npx tsc --noEmit -p .`). No permanent AI test exists in seven's committed suite (the filing's own tripwire was never committed); the repro was scratch-only, not committed. **BSR-12 status for 169-06 Task 3: "seven BSR-12: ai.ts builds + re-verified passing against AI-01 (D9) via scratch repro; no committed AI test in the suite."** |

### one-two-punch (`~/BoardSmithGames/one-two-punch/BOARDSMITH-BUGS.md`)

| Repo-id | Filing title | Dxx | v4.8 req | Fix phase | Sweep target file:line (from CONTEXT) | Disposition-hint |
|---|---|---|---|---|---|---|
| BUG 1 | `boardsmith/ui` reads `window.matchMedia` at module scope | — (not in D1-D32 battery; a test-environment shim issue, worked around in `tests/setup-dom.ts`, not `src/`) | n/a | n/a | n/a | out-of-scope (test-env only, not game `src/` runtime workaround) |
| BUG 2 | `scanAssetReachability` not on published export surface | — (not in D1-D32 battery; tooling export surface) | n/a | n/a | n/a | out-of-scope |
| BUG 3 | `.notUndoable()` is a UI hint, not an enforcement boundary — server undo path never consults it | D1 | UNDO-01 | 155 | `src/rules/game.ts:308-359` + `guards.ts:199` reimplemented server-side undo guard | **169-04 OUTCOME: KEPT-AND-NOTED, NOT removed.** D1 confirmed PRESENT (`assertUndoAllowed` + `hasNonUndoableAction`, called by both `state-history.ts` and `stateless-ops.ts` before any undo, independent of `currentPlayer`) — BUG 3's originally-reported gap is fixed. `assertPlanLockHolds()` was probed for removal per the gate: neutering it (immediately reverted) turned 4 committed regression tests RED (`tests/game.test.ts` "the plan lock is OWNED..." block) — the guard pins a SECOND, independent invariant (Decision 9's "no current player, ever" flow shape), not solely the now-closed undo gap. Kept as genuine load-bearing architecture with its own test coverage. Suite green (228/228) before and after the probe. Ledger updated. |
| BUG 4 | `assertNoHiddenInfoLeak` structurally unusable for a SYMMETRIC-DECK game | — (not in D1-D32 battery) | n/a | n/a | n/a | out-of-scope |
| BUG 5 | state rewind resets animation-event id sequence, client dedupes on monotonic id | D6 | UNDO-04 | 155 | not called out as a compensating-code target in CONTEXT inventory | no-op (verify fix; no removal target identified) |
| BUG 6 | state rewind restores `simultaneousActionStep` with every seat `completed` — step can never finish | — (SIM family, not one of the D1/D9/D8/D12/D22-26/D28-31 anchors this crosswalk verifies) | n/a | n/a | n/a | out-of-scope for this crosswalk's fix-present checklist |
| BUG 7 | `simultaneousActionStep` ignores `allDone` when no seat can act | same SIM family as BUG 6 | n/a | n/a | n/a | out-of-scope |
| BUG 8 | MCTS AI cheats at hidden info + mis-models simultaneous reveals (clones full authoritative state, sequentializes reveals) | D8 | AI-02 | 159 | `src/rules/ai.ts:12-33` — explicitly "does NOT try to work around it" | **169-04 OUTCOME: CLOSED (BSR-12).** D8/AI-02 confirmed PRESENT and re-verified to fix BOTH originally-reported defects: `src/ai/mcts-bot.ts`'s `captureSnapshot()` (T-159-06) clones the search root from `toJSONForPlayer(botSeat)` (redacted, no hidden-hand read), and `maybeCaptureSimultaneousBaseline()` (T-159-07) snapshots the pre-reveal state at the start of a fresh simultaneous step so BOTH awaiting seats enumerate against that shared baseline rather than a clone already mutated by a co-decider's committed move — directly replacing the sequential-turn defect. `src/rules/ai.ts` type-checks cleanly; `tests/ai.test.ts` (5 tests, already committed to the repo's own suite, including an AI-vs-AI self-play soak) passes under `npx vitest run`. Stale "does NOT try to work around it" docblock refreshed to cite the fix; no game-side redaction workaround added (none needed). **BSR-12 status for 169-06: "one-two-punch BUG 8/BSR-12 CLOSED — both defects fixed upstream (T-159-06/T-159-07), re-verified against this repo's own committed AI test suite (not scratch-only)."** |

### doom-machine (`~/BoardSmithGames/doom-machine/BOARDSMITH-BUGS.md`)

| Repo-id | Filing title | Dxx | v4.8 req | Fix phase | Sweep target file:line (from CONTEXT) | Disposition-hint |
|---|---|---|---|---|---|---|
| BS-1 | `playerActions()` silently makes undo unsafe in solo (1-seat) game | — (not in D1-D32 battery per CONTEXT) | n/a | n/a | n/a | out-of-scope |
| BS-2 | "Undo last action" undoes whole TURN, unreachable on forced-turn board | — (not in D1-D32 battery) | n/a | n/a | n/a | out-of-scope |
| BS-3 | GameShell board zoom computed once at mount, never re-fits on resize | D12 | ZOOM-01 | 158 | `src/ui/board-height.ts` + `GameTable.vue:55-68` board-height cap | removable-if-verified — ZOOM-01 re-fit shipped; assess if cap still needed |
| BS-4 | undo accepted after flow COMPLETED, rewinds whole game | D2 | UNDO-02 | 155 | not called out as a compensating-code target in CONTEXT inventory | no-op (verify fix; no removal target identified) |
| BS-5 | `chooseElements` (multi-element pick) unusable from UI — click path no-ops, auto-select throws | D9 | AI-01 | 159 | `src/rules/actions.ts:39-86` + `roll-conditions.ts:273-276` + `App.vue:14-17` single-select enumeration workaround | **DEFERRED** per CONTEXT decisions — native multiSelect rewrite is a risky game-logic change; refresh stale BS-5 comment only, do not rewrite |
| BS-6 | dev host silently drops `debug:restart`/`debug:switch-seat` | — (not in D1-D32 battery; dev-host defect) | n/a | n/a | n/a | out-of-scope |
| BS-7 | completed game with no winner presented as "Game Over" with no detail | — (not in D1-D32 battery) | n/a | n/a | n/a | out-of-scope |
| BS-8 | `boardsmith dev` hardcodes `--players 2` | — (not in D1-D32 battery; dev-host defect) | n/a | n/a | n/a | out-of-scope |
| BS-9 | a `Space` can never be removed from the element tree | D23 | SPACE-02 | 163 | `src/rules/elements.ts:92` + `game.ts:1223` one-slot-one-pile workaround | removable-if-verified — SPACE-02 (Space removal/re-parent) shipped |
| BS-10 | dev host serves game iframe at sub-path with no `<base>`, relative `public/` assets 404 | — (not in D1-D32 battery; dev-host defect) | n/a | n/a | n/a | **reclassify** per CONTEXT decisions: doom's absolute `/cards/` paths are a game-side art-path fix already handled, NOT an open library bug; fold the `<base href="/">` gap into a scaffold-default recommendation, not an open engine defect |
| BS-11 | dev host offers no way to select a declared `gameOption`/preset | — (not in D1-D32 battery; dev-host defect) | n/a | n/a | n/a | out-of-scope |

### BoardSmithGames2/seven (`~/BoardSmithGames2/seven/BOARDSMITH-BUG-0{1..5}-*.md`)

| Repo-id | Filing title | Dxx | v4.8 req | Fix phase | Sweep target file:line (from CONTEXT) | Disposition-hint |
|---|---|---|---|---|---|---|
| BOARDSMITH-BUG-01 | `GameShell` auto-executes sole no-selection action in unbounded loop | — (not in D1-D32 battery; same territory as seven's BSR-3, not a deduped Dxx) | n/a | n/a | n/a | out-of-scope for this Dxx crosswalk |
| BOARDSMITH-BUG-02 | undo op ignores non-undoable actions | D1 | UNDO-01 | 155 | `src/rules/actions.ts:64,174,275,354` `.notUndoable()` ×4 + docblocks citing BOARDSMITH-BUG-02 | removable-if-verified — same UNDO-01 gating as the other `seven` repo |
| BOARDSMITH-BUG-03 | dev host orphans first seat | — (not in D1-D32 battery; dev-host defect) | n/a | n/a | n/a | out-of-scope |
| BOARDSMITH-BUG-04 | startup zoom fits against a stale dock height | D12-adjacent (ZOOM-01 territory) | ZOOM-01 | 158 | not called out as a compensating-code target in CONTEXT inventory | no-op (verify fix; no removal target identified) |
| BOARDSMITH-BUG-05 | shell GameOverCard cannot be suppressed by a game with its own terminal UI | — (not in D1-D32 battery) | n/a | n/a | n/a | out-of-scope |

### No-op / withdrawn / out-of-scope items (explicit record)

| Item | Status | Note |
|---|---|---|
| D32 / `[DRAWDROP]` | no-op | Platform-side (deployed web front-end + Convex `pieces:*` mutations), proven ABSENT from this library repo and all 5 game repos per Phase 165. Nothing to remove in any game repo. |
| Lanternfall WITHDRAWN filing 1 — seat display names | WITHDRAWN | Maintainer-rejected 2026-07-12, not an open bug; no removal action. |
| Lanternfall WITHDRAWN filing 2 — seat chips ignoring `--bsg-seat-N` | WITHDRAWN | Maintainer-rejected 2026-07-12, not an open bug; no removal action. |
| MERC (`~/Dropbox/MERC/BoardSmith/MERC`) | out-of-scope | Not among the 5 listed repos; vendored copy (not symlinked) requires a separate re-vendor step. Explicitly out of scope for Phase 169. |

---

## 2. Library Fix-Present Checklist

**Gate rule:** For every `Dxx` a removal candidate above depends on, the verdict below must be
**PRESENT** before any per-repo plan (169-02..06) removes the corresponding workaround. **An
ABSENT verdict is a BLOCKER — the per-repo plan must skip that removal and record why, never
remove it silently.** Every command below was run against the live symlinked source at
`/Users/jtsmith/BoardSmith/src` (identical to `node_modules/boardsmith/src` via the symlink in
all 5 game repos).

| Dxx | Anchor | Grep command | Verdict | Evidence (file:line) |
|---|---|---|---|---|
| D1 (UNDO-01) | `assertUndoAllowed` + `hasNonUndoableAction` enforced server-side | `grep -rn "assertUndoAllowed\|hasNonUndoableAction" src/session/` | **PRESENT** | `src/session/utils.ts:402` defines `assertUndoAllowed(...)`; body (`:414-421`) throws `UndoRefusedError` when `actionHistory[i].undoable === false`. Callers: `src/session/stateless-ops.ts:506,1036` and `src/session/state-history.ts:314,400` both call `assertUndoAllowed({...})` before executing an undo. `hasNonUndoableAction` computed at `src/session/utils.ts:185-195,323-331` and consumed at `:469` (`canUndo = canUndoEligible && actionsThisTurn > 0 && !hasNonUndoableAction`). |
| D8 (AI-02) | `toJSONForPlayer` used in the MCTS clone path (redacted view, not full truth) | `grep -rn "toJSONForPlayer" src/ai/*.ts` | **PRESENT** | `src/ai/mcts-bot.ts:971,1149` — comment + code confirm root/child clones are built "from `toJSONForPlayer(botSeat)`" i.e. "the bot's per-seat REDACTED view ... instead of" the full authoritative state. Regression test `src/ai/mcts-redaction.test.ts` (title references `toJSONForPlayer`, not `toJSON`) asserts the redacted-view behavior. |
| D9 (AI-01) | `resolveMultiSelect` in `engine/utils/resolve-multiselect.ts` AND `buildPickMetadata` in `engine/element/action-metadata.ts` | `grep -n "resolveMultiSelect" src/engine/utils/resolve-multiselect.ts; grep -n "buildPickMetadata" src/engine/element/action-metadata.ts` | **PRESENT** | `src/engine/utils/resolve-multiselect.ts:26` exports `function resolveMultiSelect(...)` — doc comment `:2` calls it "single source of truth for resolving a selection's" (function-valued) multiSelect. `src/engine/element/action-metadata.ts:101` exports `function buildPickMetadata(...)`, invoked at `:67` (`const pickMeta = buildPickMetadata(game, player, selection);`). |
| D12 (ZOOM-01) | ResizeObserver-driven re-fit path in `useAutoZoom.ts` | `grep -n "ResizeObserver" src/ui/composables/useAutoZoom.ts` | **PRESENT** | `src/ui/composables/useAutoZoom.ts:100,124-125` board `ResizeObserver`; `:144,160-161` region `ResizeObserver` calling `scheduleRefit`; doc comment `:13,28` describes "ResizeObserver on the region plus a watch on the dock's measured height" driving re-fit — this is the re-fit-on-resize behavior BS-3/BUG-2's game-side board-height-cap workaround was compensating for. |
| D22 (SPACE-01) | Sealed/append-only `Space` | `grep -n "sealed\|seal(" src/engine/element/space.ts` | **PRESENT** | `src/engine/element/space.ts:117` `sealed = false;` field (section header `:102` "Sealing (SPACE-01/D22)"); `:122-124` `seal(): void { this.sealed = true; }`. Doc comment `:105-116` describes the append-only enforcement contract (remove/relocate throws when sealed). |
| D23 (SPACE-02) | `Space` removal/re-parent via `moveToInternal` | `grep -n "reparent\|remove()" src/engine/element/space.ts` | **PRESENT** | `src/engine/element/space.ts:146-148` `reparent(destination, position)` calling shared `GameElement.moveToInternal` (section header `:127` "Re-parent / remove (SPACE-02/D23)"); `:155-159` `remove(): void` moves the Space to `game.pile`. Shared internal mover at `src/engine/element/game-element.ts:492` `moveToInternal(destination, position)`. |
| D24 (SPACE-03) | Hidden `Space` no longer leaks exact child count via serializer | `grep -n "childCount" src/engine/element/game.ts` | **PRESENT** | `src/engine/element/game.ts:2862-2874` — in the `'hidden'` zone-visibility branch: "D24/SPACE-03: true concealment ... a 'hidden' zone must not leak even its exact child count to a non-owner — no `children` key, no `childCount` key at all". Confirmed by regression tests `src/engine/element/zone-visibility-restore.test.ts:124-129`, `src/engine/element/image-leak.test.ts:112`, `src/engine/element/deck-hand-visibility.test.ts:92-101` all asserting `'childCount' in zoneJson === false` for hidden zones. |
| D26 (SPACE-05) | `availableActions`/`actionMetadata` reconciliation (no "No metadata" board-stranding) | `grep -n "D26" src/session/utils.ts src/ui/composables/useActionController.ts` | **PRESENT** | `src/session/utils.ts:506-523` — comment "D26/SPACE-05: `availableActions` ... and `actionMetadata` ... must be the SAME set for a real seat" followed by the reconciliation: `reconciledAvailableActions = Object.keys(actionMetadata)` (`:521`) when metadata is built. Client-side defense-in-depth at `src/ui/composables/useActionController.ts:1360` (comment: "D26/SPACE-05 defense-in-depth"). |
| D28 (LIBX-01) | `suppressFromDock` per-action dock suppression | `grep -n "suppressFromDock" src/engine/action/types.ts` | **PRESENT** | `src/engine/action/types.ts:469` `suppressFromDock?: boolean;` field; doc comment `:467` "dock button is hidden ... Set via `.suppressFromDock()`." |
| D29 (LIBX-02) | `unbounded: true` opt-in valve on `loop()` | `grep -n "unbounded" src/engine/flow/builders.ts` | **PRESENT** | `src/engine/flow/builders.ts:87` `unbounded?: boolean;` on the loop config; `:95-120` validation: requires either `maxIterations` or `unbounded: true` (`:95-102`), and rejects combining both (`:115-120`); `:131` threads `unbounded: config.unbounded` into the built flow node. |
| D30 (LIBX-03) | `contrastInk` — glyph ink not hardcoded white | `grep -n "contrastInk" src/ui/utils/color-contrast.ts` | **PRESENT** | `src/ui/utils/color-contrast.ts:199` exports `function contrastInk(seatColor: string): ContrastInk`; validation errors at `:139,150,162` all prefixed `contrastInk:` confirming this is the live ink-contrast computation (not a hardcoded white). |
| D31 (LIBX-04) | `displayedState` — time-travel view no longer desyncs `#game-board` | `grep -n "displayedState" src/ui/components/GameShell.vue` | **PRESENT** | `src/ui/components/GameShell.vue:529` `const displayedState = computed<DisplayedGameState | null>(...)`; consumed identically by both the live board slot (`:2217`) and history-aware paths (`:2387`, `:2407`) — a single reconciled state feeds both the board and the ActionPanel, closing the historical-board/live-controller desync BUG-1 (lanternfall) reported. |
| D32 (PLATLOG-01) | `[DRAWDROP]` verbose logging gated out of production | `grep -rn "DRAWDROP" src/` | **ABSENT** (by design — platform-side, not library-side; see Phase 165 disposition) | No `[DRAWDROP]`/`[DRAWDROP-SRV]` occurrences anywhere in `/Users/jtsmith/BoardSmith/src`. Per ROADMAP.md Phase 165: "DEFERRED TO PLATFORM TEAM ... proven absent from this library repo and all reachable game repos. Nothing to fix here." This ABSENT is the expected/correct state (there is nothing in library `src/` to gate) — it is **not** a blocker for any of the 5 repos' sweeps, since no game repo's removal target depends on D32 being present; it is recorded here purely as the "nothing to remove" no-op per the CONTEXT decisions. |

**Verdicts not requiring a repo removal (no compensating-code target identified in the CONTEXT
inventory) are still worth spot-checking by the downstream plans if a repo turns out to have an
undiscovered workaround** — D2/D3/D4/D5/D6/D25 were not independently re-verified here because no
removal candidate above cites them; 169-02..06 should re-run this checklist's method (grep the live
`src/`) before citing any of those Dxx as a gate for a removal not listed in Section 1.

---

## 3. How downstream plans use this document

1. Find the repo's own filing id in Section 1 → read its `Dxx` + `Disposition-hint`.
2. Look up that `Dxx` in Section 2 → confirm **PRESENT**.
3. If PRESENT: remove the workaround, run `vitest run` for the full repo suite, keep the removal only if green.
4. If ABSENT: do NOT remove — record the filing as a blocker in the repo's own ledger, citing this file.
5. If `Disposition-hint` is `out-of-scope`, `no-op`, `WITHDRAWN`, or `DEFERRED`: no removal action; note verified in the per-repo SUMMARY.
