---
phase: 107-ai-assisted-teaching
plan: "04"
subsystem: ui
tags: [vue, overlay, teaching, ai, hint, heatmap, narration, parity, fixed-position, teleport]
dependency_graph:
  requires:
    - phase: 107-02
      provides: [hint/heatmap/narration fields in PlayerGameState, requestHint, setHeatmapVisible]
    - phase: 107-03
      provides: [startDemo/stopDemo/isDemoRunning on GameSession, narration broadcast hook]
    - phase: 105
      provides: [TutorialOverlay infrastructure: Teleport/fixed/ResizeObserver/buildSelector/ringCSS]
  provides:
    - overlay-utils.ts — shared cssEscape + buildSelector (single source, deduped from TutorialOverlay)
    - HintOverlay.vue — single-annotation ring+bubble overlay (z-20) reading state.hint
    - HeatmapOverlay.vue — per-cell MCTS chips with % badge (z-15) reading state.heatmap
    - BoardMessage variant="narration" — fixed-top card for AI demo announcements (z-10)
    - ControlsMenu Teaching group — Get a hint / Watch AI demo / Show move quality (gated on showHint)
    - GameShell overlay mounts + teaching-action wiring to platformRequest ops
    - 18 component tests: ring/chip parity across custom-UI-like + AutoUI-grid-like fixtures
  affects:
    - Phase 109 (checkers tutorial) — wires the Teaching controls for the actual checkers game
    - Phase 110 (demo gate) — browser-verified end-to-end teaching session
tech-stack:
  added: []
  patterns:
    - overlay-utils.ts dedup pattern — cssEscape + buildSelector extracted from TutorialOverlay for shared import
    - Parity-by-anchor pattern — overlays resolve data-bs-el-* attributes, never renderer internals
    - Teaching prop gate pattern — showHint !== undefined controls entire Teaching group visibility
    - platformRequest teaching ops — hint/demo-start/demo-stop/heatmap-toggle as bridge ops (Phase 109 completes bridge)
    - isDemoRunning local ref — UI tracks demo state locally; session passive; synced on game-over
key-files:
  created:
    - src/ui/components/helpers/overlay-utils.ts
    - src/ui/components/helpers/HintOverlay.vue
    - src/ui/components/helpers/HeatmapOverlay.vue
    - src/ui/components/helpers/HintOverlay.test.ts
    - src/ui/components/helpers/HeatmapOverlay.test.ts
  modified:
    - src/ui/components/helpers/BoardMessage.vue
    - src/ui/components/helpers/TutorialOverlay.vue
    - src/ui/components/ControlsMenu.vue
    - src/ui/components/GameShell.vue
key-decisions:
  - "Extract cssEscape + buildSelector to overlay-utils.ts (shared import) — single source of truth, no copy-paste across overlays per RESEARCH anti-pattern"
  - "isDemoRunning tracked as local ref in GameShell (not from broadcast state) — session-side getter not broadcast; cleared on flowState.complete"
  - "Teaching controls wired via platformRequest ops (hint/demo-start/demo-stop/heatmap-toggle) — bridge integration deferred to Phase 109; Phase 107 establishes the wire protocol"
  - "showHintProp computed from lobbyInfo AI slots — cleanest available client-side AI detection; platform mode hidden (Phase 110 wires production)"
  - "Narration display in GameShell via BoardMessage variant=narration — position:fixed removes need for deep slot prop threading"
requirements-completed: [AI-01, AI-02, AI-03]
duration: ~17 minutes
completed: "2026-06-26"
---

# Phase 107 Plan 04: Teaching UI Layer Summary

**HintOverlay, HeatmapOverlay, and narration card render teaching aids via shared data-bs-el-id anchors — identical in custom UI and AutoUI — with ControlsMenu Teaching group wired to platformRequest ops for Phase 109 bridge integration.**

## Performance

- **Duration:** ~17 minutes
- **Started:** 2026-06-26
- **Completed:** 2026-06-26
- **Tasks:** 3
- **Files modified:** 4 (TutorialOverlay.vue, BoardMessage.vue, ControlsMenu.vue, GameShell.vue)
- **Files created:** 5 (overlay-utils.ts, HintOverlay.vue, HeatmapOverlay.vue, HintOverlay.test.ts, HeatmapOverlay.test.ts)
- **Tests added:** 18 (9 HintOverlay, 9 HeatmapOverlay)
- **Tests total:** 1505

## Accomplishments

- Created `overlay-utils.ts` exporting `cssEscape` + `buildSelector` — refactored TutorialOverlay to import from it (local copies removed; zero grep match for function definition in TutorialOverlay)
- Created `HintOverlay.vue`: reads `state.hint?.annotation`, renders one ring + BoardMessage bubble using identical TutorialOverlay infrastructure (measure, ResizeObserver, onScroll, ringStyle, reduced-motion), z-index 20, pointer-events:none, no literal hex colors
- Created `HeatmapOverlay.vue`: reads `state.heatmap` (only when `visible:true`), renders per-cell chips at center of resolved cells — chip size `max(24, min(floor(min(w,h)*0.68), 52))`, intensity-tinted background, 2px solid border on isBest (non-color cue), `round(value*100)+'%'` badge, aria-hidden throughout, z-index 15
- Extended `BoardMessage.vue` with `variant="narration"` — position:fixed top card (`--bsg-surface-3`, `--bsg-r-md`, `--bsg-shadow-sm`), role=status/aria-live=polite, never v-html (T-107-08)
- Extended `ControlsMenu.vue` with Teaching group (showHint/hintDisabled/isDemoRunning/isHeatmapVisible props + teaching-action emit), gated on `showHint !== undefined`
- Extended `GameShell.vue`: imports + mounts HintOverlay + HeatmapOverlay + BoardMessage narration alongside TutorialOverlay (outside zoom-container); handleTeachingAction wired to platformRequest; isDemoRunning local ref cleared on flowState.complete
- 18 parity component tests: each overlay's test has a dual-fixture parity assertion (custom-UI-like div vs AutoUI-grid-like table cell with same data-bs-el-id) — both resolve identically

## Task Commits

1. **Task 1: overlay-utils + HintOverlay + HeatmapOverlay + BoardMessage narration** — `0d9e73b` (feat)
2. **Task 2: ControlsMenu Teaching group + GameShell wiring** — `2ea5855` (feat)
3. **Task 3: parity component tests** — `8eab4a2` (test)

## Files Created/Modified

- `src/ui/components/helpers/overlay-utils.ts` — exports cssEscape + buildSelector (single source)
- `src/ui/components/helpers/HintOverlay.vue` — single-annotation hint ring+bubble (z-20)
- `src/ui/components/helpers/HeatmapOverlay.vue` — MCTS per-cell chips with % badge (z-15)
- `src/ui/components/helpers/BoardMessage.vue` — added narration variant (fixed-top card, z-10)
- `src/ui/components/helpers/TutorialOverlay.vue` — refactored: imports cssEscape + buildSelector from overlay-utils
- `src/ui/components/helpers/HintOverlay.test.ts` — 9 tests: ring/bubble presence, parity, XSS, a11y
- `src/ui/components/helpers/HeatmapOverlay.test.ts` — 9 tests: chip count/badge/isBest/parity/aria
- `src/ui/components/ControlsMenu.vue` — Teaching group: props + emit + menu items
- `src/ui/components/GameShell.vue` — overlay imports + mounts + teaching-action wiring

## Decisions Made

1. **overlay-utils.ts dedup** — Plan specified "no copy-paste cssEscape across overlays". Extracted to a shared module; TutorialOverlay refactored to import. Zero local definitions remain.

2. **isDemoRunning local ref** — `GameSession.isDemoRunning` is not broadcast to clients. Tracking locally in GameShell is the cleanest approach without modifying the session-layer broadcast. Cleared on flowState.complete (game-over) as specified.

3. **platformRequest teaching ops** — Teaching ops (hint, demo-start, demo-stop, heatmap-toggle) are sent via the existing `platformRequest` mechanism. The dev bridge (bridge.ts) does not yet handle these — that integration is Phase 109's scope. In non-platform mode, the request times out and the error toast fires; this is acceptable for Phase 107.

4. **showHintProp via lobbyInfo** — The GameDefinition `ai` config is not broadcast in PlayerGameState. Using `lobbyInfo.value?.slots?.some(s => s.aiLevel != null)` is the most accurate available client-side detection. In platform mode (lobbyInfo null), the Teaching group is hidden; full production wiring is Phase 110.

5. **Narration in GameShell** — `BoardMessage variant="narration"` uses `position: fixed` so it renders correctly regardless of where in the component tree it is mounted. Mounting in GameShell alongside the other overlays avoids deep slot-prop threading.

## Deviations from Plan

None — plan executed exactly as written. The implementation accurately reflects the plan's `action` blocks and acceptance criteria.

## Known Stubs

- **platformRequest teaching ops** (`src/ui/components/GameShell.vue`): `handleTeachingAction` calls `platformRequest('hint'|'demo-start'|'demo-stop'|'heatmap-toggle', ...)`. These ops are not yet handled by the dev bridge (`bridge.ts`). Teaching controls will show and dispatch correctly in platform mode once Phase 109 implements the bridge handler. In dev WebSocket mode, they currently time out and show an error toast.

- **showHintProp platform mode gap** (`src/ui/components/GameShell.vue`): In iframe/platform mode, `lobbyInfo` is null so `showHintProp` returns `undefined` and the Teaching group is hidden. Full platform-mode wiring requires the host to surface AI config to the GameShell (Phase 110 scope).

These stubs are intentional — they establish the wire protocol for Phase 109 to complete. They do not prevent the plan's primary goals (overlay rendering, parity tests, ControlsMenu structure).

## Threat Flags

No new threat surface beyond what was planned.

- T-107-08 (XSS via narration/hint text): BoardMessage renders via Vue slot interpolation only; `grep -c v-html src/ui/components/helpers/BoardMessage.vue` == 0. HintOverlay passes annotation text to BoardMessage slot (same interpolation path). HeatmapOverlay badge uses `{{ chipBadge(...) }}` — engine-derived number, never HTML.
- T-107-09 (overlay click interception): HintOverlay root `.bsg-hint-overlay` has `pointer-events: none`. HeatmapOverlay root `.bsg-heatmap-overlay` has `pointer-events: none`. Chip inline style sets `pointerEvents: 'none'`.
- T-107-SC (no new packages): zero new npm packages installed.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/ui/components/helpers/overlay-utils.ts — cssEscape + buildSelector | FOUND |
| src/ui/components/helpers/HintOverlay.vue — z-20, pointer-events:none, ring+bubble | FOUND |
| src/ui/components/helpers/HeatmapOverlay.vue — z-15, chips with %, aria-hidden | FOUND |
| src/ui/components/helpers/BoardMessage.vue — narration variant | FOUND |
| TutorialOverlay.vue — no local cssEscape (grep count 0) | VERIFIED |
| No literal hex colors in HintOverlay/HeatmapOverlay | VERIFIED |
| v-html count in BoardMessage.vue == 0 | VERIFIED |
| teaching-action in ControlsMenu.vue >= 1 | VERIFIED (count 4) |
| HintOverlay + HeatmapOverlay in GameShell.vue >= 2 | VERIFIED (count 5) |
| HintOverlay.test.ts — 9 tests pass | VERIFIED |
| HeatmapOverlay.test.ts — 9 tests pass | VERIFIED |
| Full suite 1505 tests pass | VERIFIED |
| commit 0d9e73b (Task 1) | FOUND |
| commit 2ea5855 (Task 2) | FOUND |
| commit 8eab4a2 (Task 3) | FOUND |
| No new dependencies | VERIFIED |
