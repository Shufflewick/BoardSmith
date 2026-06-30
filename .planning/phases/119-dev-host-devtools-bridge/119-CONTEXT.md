# Phase 119: Dev-Host Devtools Bridge - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning
**Source:** Locked design contract (`.planning/v4.3-API-DESIGN.md`, Part 2 DEV section) + Phase 117 introspection primitives

<domain>
## Phase Boundary

Agents (and humans) can drive the `boardsmith dev` host by stable element id and confirm outcomes via an observable signal — no coordinate-clicking, no vision, no polling — in both custom UI and AutoUI. This is **devtools instrumentation**, not visual UI design: the deliverables are stable DOM selectors, a read-only `window.__BOARDSMITH_DEVTOOLS` global (via an iframe→outer postMessage bridge), an action-resolved `CustomEvent`, and a browser-proven end-to-end agent loop.

Covers: DEV-01..04. Excludes: introspection engine API (Phase 117, reused here), test ergonomics (118), authoring guards (120), migration (121), docs polish (122). Deferred (design doc Part 3): DEV-F1 seat-switch, DEV-F2 deterministic-AI seed.

**UI-SPEC / UI-review note:** This phase adds no new visual component or layout — it instruments existing rendered output with data attributes + a debug bridge. The interaction/data contract is already fully specified in the design doc. A visual design contract (UI-SPEC) and visual audit (UI-review) are therefore N/A; the real UI verification is the DEV-04 **browser proof** (the agent change→drive→confirm loop demonstrated live), which replaces a visual audit for this phase.
</domain>

<decisions>
## Implementation Decisions

All surface decisions are **locked** in the approved design doc (Part 2 DEV). Build to it exactly.

### DEV-01 — Unified element selector attributes
- BUILD: add `data-bs-el-id` (and `data-bs-el-notation` / `data-bs-el-name` where applicable) ALONGSIDE existing `data-element-id` in the four AutoUI renderers: PieceRenderer.vue:145, SpaceRenderer.vue:177, DieRenderer.vue:117, CardRenderer.vue:351. Standardize on `data-bs-el-id` (align AutoUI to the custom-UI single source of truth `anchorAttrs()` at useBoardInteraction.ts:408). Do NOT modify `anchorAttrs()` to emit `data-element-id` (Common Pitfall #2). Keep `data-element-id` as an alias — used by FLIP (useFLIP.ts:138). Result: `[data-bs-el-id="42"]` works in BOTH custom UI and AutoUI.

### DEV-02 — `window.__BOARDSMITH_DEVTOOLS` global (iframe→outer postMessage bridge)
- BUILD: Sender in `src/ui/components/GameShell.vue` — watch reactive state from `useActionController` + `useBoardInteraction`; on change, postMessage a `DevtoolsStateMessage` (type `'boardsmith:devtools-state-update'`) to `window.parent`. Only when `__BOARDSMITH_DEV__` is true.
- Receiver in `src/cli/dev-host/DevHost.vue` — listen for that message, cache a local reactive snapshot, expose `window.__BOARDSMITH_DEVTOOLS` with synchronous read methods: `getState(seat?)`, `getAvailableActions(seat?)`, `getActionMetadata(seat?)`, `getBoardInteractionState()`.
- Global is always synchronous (cached snapshot; no promise). Assigned ONLY when `__BOARDSMITH_DEV__ === true` (build-time guard) — never in production. Add `BoardsmithDevtools` interface to `src/ui/global.d.ts` alongside `__BOARDSMITH_DEV__`.

### DEV-03 — Action-resolved `CustomEvent`
- BUILD: dispatch `window.dispatchEvent(new CustomEvent('boardsmith:action-resolved', { detail }))` where detail = `{ action, success, seat, error? }`, at BOTH `actionCompletedTick` increment sites in `src/ui/composables/useActionController.ts` (the direct-execute path ~line 1074 and the selection-step path ~line 1505). `success=false` carries `error`.

### DEV-04 — End-to-end agent loop (browser-proven acceptance gate)
- No new source beyond DEV-01/02/03. The deliverable is a documented + BROWSER-PROVEN walkthrough of the loop: DISCOVER (`getActionMetadata`/valid ids) → SELECT (`querySelector('[data-bs-el-id="<id>"]')`) → DRIVE (dispatch click/pointer) → CONFIRM (`boardsmith:action-resolved`).
- Proof requirements: demonstrate the loop in a **custom-UI game** (Go Fish or Checkers) AND an **AutoUI game**, each showing `success===true` on a legal move and `success===false` on an illegal attempt.

### Claude's Discretion
- The exact GameShell watcher wiring (which reactive sources, debounce) and DevHost snapshot structure, as long as the locked interface + message shape hold.
- Where the agent-loop doc lives (a Phase 119 markdown harness/notes; the polished public doc is Phase 122 DOC-03).
- Test structure (unit tests for the data-attribute emission + event dispatch; the browser proof is manual/Chrome-extension-driven).

### Browser-proof execution
- DEV-04 is verified live via the Chrome extension against `npx boardsmith dev` (go-fish for custom UI; an AutoUI game for the auto path). Per project rules: **kill any dev server started** before returning. If the live proof can't be fully automated, it becomes a `human_needed` verification item with exact repro steps.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (reuse, do not rebuild)
- Phase 117: `getActionSpace`/`getActionMetadata`-equivalent, `getPlayerView` — the devtools global surfaces these.
- `anchorAttrs()` (useBoardInteraction.ts:408) — single source of truth for anchor attribute names; custom UI already emits `data-bs-el-id`; tutorial overlay queries it (overlay-utils.ts:45).
- `useActionController` — `actionCompletedTick` ref (the DEV-03 trigger) + the board-interaction state for DEV-02.
- `__BOARDSMITH_DEV__` build-time guard (src/ui/global.d.ts) — the gate for dev-only devtools.
- Dev host: `src/cli/dev-host/DevHost.vue` (outer page) renders each seat via a GameShell iframe in platform mode.

### Established Patterns
- GameShell iframe in platform mode; Debug panel toggled via postMessage (existing pattern to mirror for the devtools bridge).
- FLIP uses `data-element-id` (useFLIP.ts:138) — must remain intact (keep alias).

### Integration Points
- Sender: GameShell.vue (ui). Receiver: DevHost.vue (cli/dev-host). Type decl: src/ui/global.d.ts. Event: useActionController.ts.
- Cross-frame: iframe (GameShell) → outer page (DevHost) via postMessage; agent reads outer-page global + listens on iframe.contentWindow.
</code_context>

<specifics>
## Specific Ideas

- DEV-01 parity (custom UI + AutoUI) is a hard rule — `[data-bs-el-id]` must select the same way in both. Browser-prove both.
- The bridge is dev-host ONLY (`__BOARDSMITH_DEV__`), never production — security/coupling boundary (design doc Out of Scope).
- DEV-04's "illegal attempt → success===false + error" is as important as the happy path — proves the confirm signal distinguishes failure without polling.
</specifics>

<deferred>
## Deferred Ideas

- DEV-F1 (programmatic seat-switch / `?dev-seat=N`), DEV-F2 (deterministic-AI seed / forceAIMove) — DEFERRED per design doc Part 3.
- Polished public browser-testing docs — Phase 122 (DOC-03).
</deferred>
