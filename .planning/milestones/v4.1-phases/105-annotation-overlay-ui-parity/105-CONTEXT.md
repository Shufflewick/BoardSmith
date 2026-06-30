# Phase 105: Annotation Overlay (UI Parity) - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A tutorial step can render a **text bubble** plus a **targeted highlight** (board cell, piece, panel, or action control), and it renders **identically in a custom UI and AutoUI** because targeting routes through the shared `useBoardInteraction` layer. Delivers **TUT-01**. Also closes **MR-01** (Phase 104 review): thread the projected tutorial step into the production `useActionController` so `suppressAutoFill` + the annotation go live in the real app.

Defines the Phase 104 reserved `content` slot on `TutorialStep`. **In scope:** the `content` annotation model, a single `TutorialOverlay` layer, the bubble + highlight rendering, the GameShell wiring, parity tests across both UI paths. **Out of scope:** predicate auto-advance (106), AI teaching (107), tooltips (108), checkers content (109), browser demo (110).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Annotation content model
- `step.content` is an **array of annotations**: `{ text: string; target?: AnnotationTarget; placement?: 'auto'|'top'|'bottom'|'center' }[]`. An array lets a step highlight a target AND show a bubble (or several) independently.
- `AnnotationTarget` is a **discriminated union**: `{ kind:'element', ref: ElementRef }` | `{ kind:'action', actionName: string }` | `{ kind:'panel' }`. Board targets reuse the existing `ElementRef {id,name,notation}` + `matchesRef` precedence (the parity contract) — no bespoke selector.
- Bubble placement: optional, with a **smart default** — anchor near the target element when present; otherwise fall back to BoardMessage top/bottom.
- Non-board targets (panel, action control) use `kind:'action'`/`kind:'panel'`, anchored to the ActionPanel / action-button anchor.

### Area 2 — Rendering & parity mechanism (the hard rule)
- **Structural parity, not opt-in.** A single `TutorialOverlay` component mounts in GameShell `.boardregion` and locates targets via a **stable anchor attribute set ONCE in the shared board/selectable layer** (e.g. a `data-bs-element-*` attribute carried by every interactive element through the shared composable), then positions the ring + bubble by measuring DOM rects. A custom UI that uses the shared layer gets annotations for free — it CANNOT "forget" to support them. This is chosen over adding `isAnnotationHighlighted()` to each of the 8 renderers + every custom UI (opt-in → a custom UI that forgets it silently lacks highlights → violates "no primitive may work in only one UI path").
- Text bubble **reuses/extends `BoardMessage.vue`** (role=status, aria-live=polite, reduced-motion) — a11y for free.
- The overlay **injects `gameState`** and reads `state.tutorial.content` — one mount, both UIs, decoupled from the action controller.
- Highlight style: **ring/glow + optional label, non-color cue** (WCAG 2.2 AA, matches v4.0 Slate tokens). No color-only signalling.

### Area 3 — Wiring & lifecycle (closes MR-01)
- **Fix MR-01 here:** add `const tutorialStep = computed(() => state.value?.state?.tutorial)` at GameShell:~390 and pass it to `useActionController`. This makes `suppressAutoFill` live in production AND gives the overlay/controller one shared source.
- Overlay renders only when `state.tutorial?.content` is present (`v-if`) — zero markup/cost in normal play.
- The annotation layer **coexists** with the v4.0 always-on turn prompt — additive, does not replace it.
- **Parity is tested in BOTH paths:** an AutoUI renderer fixture AND a custom-UI fixture show the same annotation from the same step (criterion #3).

### Claude's Discretion
- Exact anchor-attribute name, the rect-measurement/positioning approach (ResizeObserver vs on-demand `getBoundingClientRect`), component file names, and how the bubble visually connects to its target are at implementation discretion, consistent with v4.0 Slate + existing FLIP/overlay patterns.
- Whether the shared anchor is added to `useSelectable` vs `useBoardInteraction` is at discretion as long as it is set in ONE shared place, not per-UI.
</decisions>

<code_context>
## Existing Code Insights (from Phase 105 scout)

### Reusable Assets
- `src/ui/composables/useBoardInteraction.ts` — the shared parity layer (created in GameShell, provided via inject). `ElementRef {id,name,notation}` (:19-23), `matchesRef` precedence (:207-216), `isHighlighted/isSelected/isValidTarget/isDisabledElement` (:257-283). AutoUI renderers call these via `cellIdentity(cell)`; custom UIs call the same methods. This is where/near where the shared anchor attribute belongs.
- `src/ui/components/helpers/BoardMessage.vue` — absolutely-positioned bubble, `role="status"` + `aria-live="polite"`, reduced-motion, `position` prop (top/bottom/center). Reuse for the text bubble.
- `src/ui/components/helpers/GameOverlay.vue` — modal overlay precedent (z-index, contain:layout) if a scrim is needed.
- `src/ui/components/GameShell.vue` — `.boardregion` (#main, role=main, :1665-1737) is the overlay mount (GameOverCard already renders there at :1681). State pipeline: `provide('gameState', state)`, `provide('actionController', ...)`, `provide('gameView', ...)` (:657-669); platform mode assigns `state.value.state = PlayerGameState` (:801-806). `useActionController` constructed at :390 — the MR-01 wiring point.

### Established Patterns
- Both AutoUI and custom UIs render in GameShell's `#game-board` slot with the SAME slot props; no AutoUI-specific path. The 8 renderers (`builtin-renderers.ts`) implement one shared contract.
- Element `id` is engine-assigned numeric, survives broadcast; custom UIs (e.g. checkers) may key by `notation` — `matchesRef` handles both.
- `PlayerGameState.tutorial: TutorialStepView` (Phase 104) is available at `state.value.state.tutorial`.

### Integration Points
- Anchor attribute: add to the shared selectable/board layer so every interactive element carries it once.
- Overlay: new `TutorialOverlay.vue` in `.boardregion`, injects `gameState`, reads `.tutorial.content`, measures target rects, renders ring + `BoardMessage` bubble.
- MR-01: GameShell:390 thread `tutorialStep` into `useActionController`.
</code_context>

<specifics>
## Specific Ideas
- Hard rule: "no primitive may work in only one UI path." The overlay must NOT require each renderer/custom-UI to call a new method — it locates targets through the shared layer so parity is structural.
- Criterion #3 demands verification in BOTH UI paths — the plan must include a custom-UI fixture (not just AutoUI) asserting the same annotation renders.
- Closing MR-01 here is explicit: do not leave `suppressAutoFill` inert in production.
</specifics>

<deferred>
## Deferred Ideas
- Predicate-driven step advance / `advanceWhen` → Phase 106.
- Tooltip/per-action help (hover) → Phase 108 (distinct from tutorial annotations).
- Checkers-specific annotation content → Phase 109.
- The LR-02 per-selection-name gate refinement → Phase 109 (noted in STATE).
</deferred>
