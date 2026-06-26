---
phase: 107-ai-assisted-teaching
verified: 2026-06-26T12:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
deferred:
  - truth: "End-to-end player experience: Teaching group visible and functional in dev WebSocket + platform modes"
    addressed_in: "Phase 109 (bridge handler), Phase 110 (browser demo gate)"
    evidence: "Phase 110 success criterion 2: 'The AI move hint, narrated AI-vs-AI demo, and evaluation heatmap are each demonstrated live in the browser.' Phase 107-04 SUMMARY documents platformRequest teaching ops as known intentional stub; CONTEXT.md deferred section records 'Checkers-specific teaching UI/content wiring → Phase 109.'"
---

# Phase 107: AI-Assisted Teaching Verification Report

**Phase Goal:** A player can get MCTS-powered help — a move hint, a narrated AI-vs-AI demo, and an evaluation heatmap — all surfaced from the game's existing bot with no new training.
**Verified:** 2026-06-26T12:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A player can request a move hint at any decision point; MCTS returns a legal move and its target is highlighted via the annotation overlay (TUT-01) | VERIFIED | `session.requestHint()` fully implemented in `game-session.ts:951`; auto-clears after action (`#hint.delete` at line 1231); clears on undo/rewind (`#hint.clear` at line 312); HintOverlay.vue renders ring+bubble from `state.hint.annotation`; 9 HintOverlay component tests pass including dual-fixture parity; 13 teaching.test.ts tests cover lifecycle |
| 2 | A player can watch an AI-vs-AI demo in which each move is announced before it executes | VERIFIED | `startDemo/stopDemo/isDemoRunning` in `game-session.ts:1099,1171,1081`; `onBeforeMove` hook in `ai-controller.ts:74,132` fires between `bot.play()` and `onMove()`; narration sets `#narrationText` + broadcasts before delay; `isDemoRunning` now broadcast in `PlayerGameState` (WR-04 fix, line 1934); BoardMessage `variant="narration"` renders fixed-top card; 6 ai-controller.test.ts + 6 demo teaching.test.ts tests pass |
| 3 | A player can toggle an evaluation heatmap that visualizes the AI's per-move evaluation across the board | VERIFIED | `setHeatmapVisible()` at `game-session.ts:1040`; `#buildHeatmapEntries()` deduplicates per-cell with exactly one `isBest`; HeatmapOverlay.vue renders per-cell chips with `round(value*100)+'%'` badge; 9 HeatmapOverlay component tests pass including dual-fixture parity and isBest border |
| 4 | All three features reuse checkers' existing MCTS bot — ZERO new deps and no new model/weight files | VERIFIED | `git diff HEAD~20..HEAD -- package.json` empty; no `*.weights`/`*.model`/`*.onnx` files found; `playWithStats()` wraps existing `runSearch()` which is the refactored `playSingle()`; `startDemo()` uses existing `AIConfig.level` (default 'medium'), no new training |

**Score:** 4/4 truths verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Teaching controls functional end-to-end in running app (bridge.ts handling 'hint'/'demo-start'/'demo-stop'/'heatmap-toggle' platformRequest ops) | Phase 109 (bridge), Phase 110 (browser demo) | Phase 110 SC2: "AI move hint, narrated AI-vs-AI demo, and evaluation heatmap demonstrated live in the browser." CONTEXT.md deferred section: "Checkers-specific teaching UI/content wiring → Phase 109." 107-04-SUMMARY known stubs section documents platformRequest deferral explicitly. |
| 2 | Teaching group visible in platform/iframe mode (showHintProp null when lobbyInfo is null) | Phase 110 | Phase 110 SC2; 107-04-SUMMARY: "Full platform-mode wiring requires the host to surface AI config to the GameShell (Phase 110 scope)." |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ai/mcts-bot.ts` | `private runSearch()` + `public playWithStats()` | VERIFIED | `runSearch` at line 198, `playWithStats` at line 110; root captured before `this.searchGame=null` cleanup at line 321 |
| `src/ai/types.ts` | `BotMoveStats` interface + `hintTargetFromMove` on AIConfig | VERIFIED | `BotMoveStats` at line 55; `hintTargetFromMove` at line 201 |
| `src/ai/index.ts` | Re-exports `BotMoveStats` | VERIFIED | Line 11 |
| `src/ai/mcts-stats.test.ts` | Unit tests for `playWithStats` | VERIFIED | 7 tests pass; includes `stats.length > 0`, value in `[0,1]`, `parallel: 2` bot still returns stats |
| `src/ai/mcts-stats-checkers.test.ts` | Checkers integration test (excluded from CI) | VERIFIED | Exists; added to `vitest.config.ts` exclude list so CI without symlink does not fail |
| `src/session/types.ts` | `HeatmapEntry` + `hint/heatmap/narration` fields on `PlayerGameState` | VERIFIED | `HeatmapEntry` at line 387; `hint?` at 455, `heatmap?` at 463, `narration?` at 471, `isDemoRunning?` at 482 |
| `src/session/game-session.ts` | `requestHint/clearHint/setHeatmapVisible/startDemo/stopDemo` + broadcast injection | VERIFIED | All methods present; `#hint` injected post-buildPlayerState at line 1927; `#heatmap` at 1929; `isDemoRunning` at 1934 |
| `src/session/teaching.test.ts` | Teaching lifecycle + heatmap + demo coverage | VERIFIED | 23 tests (24 after WR-06 fix) pass; covers no-serialization invariants, requestHint lifecycle, heatmap dedupe/isBest, demo start/stop/narration |
| `src/session/ai-controller.ts` | `onBeforeMove` optional 4th param | VERIFIED | Signature at line 74; call site at line 132 (between `bot.play()` and `onMove()`) |
| `src/session/ai-controller.test.ts` | `onBeforeMove` ordering + timing coverage | VERIFIED | 6 tests pass; call-order proof, delay ordering, error propagation, default path |
| `src/ui/components/helpers/overlay-utils.ts` | Shared `cssEscape` + `buildSelector` (no copy-paste) | VERIFIED | Exports both functions; TutorialOverlay imports from it (0 local `buildSelector`/`cssEscape` function definitions in TutorialOverlay.vue) |
| `src/ui/components/helpers/HintOverlay.vue` | Ring + bubble overlay reading `state.hint` | VERIFIED | File exists, 286+ lines; reads `state.hint?.annotation`; Teleport to body, z-index 20, pointer-events:none |
| `src/ui/components/helpers/HeatmapOverlay.vue` | Per-cell chips with `%` badge reading `state.heatmap` | VERIFIED | File exists; renders chips only when `visible:true`; `%` badge via `round(value*100)+'%'`; `aria-hidden="true"` |
| `src/ui/components/helpers/BoardMessage.vue` | `variant="narration"` extension | VERIFIED | `narration` variant present; no `v-html=` attribute anywhere |
| `src/ui/components/ControlsMenu.vue` | Teaching group + `teaching-action` emit | VERIFIED | `teaching-action` appears 4 times; Teaching grouplabel at line 238; gated on `showHint !== undefined` |
| `src/ui/components/GameShell.vue` | HintOverlay + HeatmapOverlay mounts + teaching-action wiring | VERIFIED | Both imported (lines 40-41); mounted at lines 1785,1789 outside zoom-container; `handleTeachingAction` at line 681 routes to `platformRequest` ops |
| `src/ui/components/helpers/HintOverlay.test.ts` | 9 parity component tests | VERIFIED | 9 tests pass; dual-fixture parity test at line 185 |
| `src/ui/components/helpers/HeatmapOverlay.test.ts` | 9 parity component tests | VERIFIED | 9 tests pass; dual-fixture parity at line 243; chip count/badge/isBest/aria assertions |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MCTSBot.playWithStats()` | `root.children` before cleanup | `runSearch()` returns `{ move, root }` before `this.searchGame=null` | WIRED | cleanup nulls instance fields at line 321; `root` is local, returned safely |
| `src/ai/index.ts` | `BotMoveStats` | re-export | WIRED | Line 11 |
| `GameSession.broadcast()` | `PlayerGameState.hint/heatmap/narration/isDemoRunning` | post-buildPlayerState injection per session | WIRED | Lines 1927-1934 |
| `GameSession.performAction()` | `#hint` cleared | `#hint.delete(player)` before broadcast | WIRED | Line 1231 |
| `replaceRunner` callback | `#hint/#heatmap` cleared | `this.#hint.clear(); this.#heatmap.clear()` | WIRED | Lines 312-313 |
| `AIController.checkAndPlay()` | `onBeforeMove(action, player, args)` | awaited at line 132 between `bot.play()` and `onMove()` | WIRED | Lines 74 (signature), 132 (call site) |
| `GameSession.startDemo()` | all-seats AIController override + narration hook | saves/replaces `#aiController`, sets `#onBeforeMove`, broadcasts | WIRED | Lines 1099-1170 |
| `HintOverlay/HeatmapOverlay` | `data-bs-el-id` anchors | `buildSelector` from `overlay-utils.ts` | WIRED | `overlay-utils.ts` exports `buildSelector`; both overlays import and use it |
| `ControlsMenu teaching-action emit` | `GameShell handleTeachingAction` | `@teaching-action` handler at line 1884 → `platformRequest` ops | WIRED (stub) | Wired in GameShell; platformRequest bridge handler deferred to Phase 109 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `HintOverlay.vue` | `state.hint.annotation` | `GameSession.#hint` Map, populated by `requestHint()` → `MCTSBot.play()` → real MCTS | Yes — MCTS search runs against live game state | FLOWING |
| `HeatmapOverlay.vue` | `state.heatmap.entries` | `GameSession.#heatmap` Map, populated by `setHeatmapVisible()` → `bot.playWithStats()` → `root.children` | Yes — per-child visits/value from real MCTS tree | FLOWING |
| `BoardMessage variant=narration` | `state.narration.text` | `GameSession.#narrationText`, set by `#onBeforeMove` hook → `startDemo` narrator fn or default `actionName + argsummary` | Yes — engine-derived action name and args | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `playWithStats()` returns non-empty stats | `npx vitest run src/ai/mcts-stats.test.ts` | 7 tests pass | PASS |
| `requestHint` / `setHeatmapVisible` / demo lifecycle | `npx vitest run src/session/teaching.test.ts` | 23 tests pass (1708ms) | PASS |
| `onBeforeMove` fires before `onMove` | `npx vitest run src/session/ai-controller.test.ts` | 6 tests pass; call-order array proven | PASS |
| HintOverlay parity across UI fixtures | `npx vitest run src/ui/components/helpers/HintOverlay.test.ts` | 9 tests pass | PASS |
| HeatmapOverlay parity across UI fixtures | `npx vitest run src/ui/components/helpers/HeatmapOverlay.test.ts` | 9 tests pass | PASS |
| Full suite regression | `npx vitest run` | 1510/1510 tests pass, 116 files | PASS |

### Probe Execution

Step 7c: No probe files found in `scripts/*/tests/probe-*.sh`. No probes declared in PLAN frontmatter. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| AI-01 | 107-01, 107-02, 107-04 | Player can request a move hint; MCTS suggests legal move; target highlighted via TUT-01 annotation overlay | SATISFIED | `requestHint()` implemented; HintOverlay renders ring+bubble from `state.hint`; 9 overlay tests + 13 session tests |
| AI-02 | 107-03, 107-04 | Player can watch narrated AI-vs-AI demo; each move announced before it executes | SATISFIED | `startDemo/stopDemo` + `onBeforeMove` hook + BoardMessage narration variant; 12 tests covering ordering and lifecycle |
| AI-03 | 107-01, 107-02, 107-04 | Player can toggle evaluation heatmap visualizing per-move evaluation | SATISFIED | `setHeatmapVisible()` + `buildHeatmapEntries` deduplication + HeatmapOverlay; 9 overlay tests + heatmap session tests |

All 3 phase requirements (AI-01, AI-02, AI-03) are marked Complete in REQUIREMENTS.md for Phase 107. No orphaned requirements.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/ai/mcts-bot.ts:523-533` | Pre-existing `applyMoveToSearchGame` silent catch (WR-02 from code review) | INFO | Pre-existing tech debt predating Phase 107; confirmed present before Phase 107 commits; deferred as out-of-scope per review fix report |

No TBD/FIXME/XXX markers found in any Phase 107 modified files. No v-html usage in new components. No literal hex colors in HintOverlay or HeatmapOverlay. All code review warnings (WR-01 through WR-07) addressed; WR-02 correctly classified as pre-existing and skipped.

### Human Verification Required

None. All Phase 107 verification is automated via unit/component tests. Visual end-to-end browser verification is the scope of Phase 110 (DEMO-01), documented in CONTEXT.md and ROADMAP.md. Custom UI / AutoUI parity is proven by dual-fixture component tests (HintOverlay.test.ts:185, HeatmapOverlay.test.ts:243) following the Phase 105 pattern.

### Gaps Summary

No gaps. All 4 must-haves are verified at the substrate level. The platformRequest bridge integration and platform-mode Teaching group visibility are intentional, documented deferrals to Phase 109/110 — not gaps in Phase 107's deliverables. The CONTEXT.md deferred section, Phase 110's success criterion 2, and both Plan 04 SUMMARY decisions (key-decisions items 3 and 4) all consistently document this boundary.

---

_Verified: 2026-06-26T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
