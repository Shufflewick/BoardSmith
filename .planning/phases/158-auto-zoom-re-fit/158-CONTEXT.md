# Phase 158: Auto-Zoom Re-Fit - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Close D12 (ZOOM-01): `useAutoZoom` keeps the board fitted as the layout changes. Today it fits once at
startup then disconnects its observer by design, watching only the board's own size — so when the dock
(floating action panel) lands on the board or the region resizes, the fit is stale and regions become
unreachable. Fix: re-fit on available-space changes (dock height + region resize), while preserving the
user's manual zoom and NOT re-fitting on mid-game board content growth.

IN SCOPE: `src/ui/composables/useAutoZoom.ts` (observer lifecycle + re-fit triggers + manual-zoom
guard) and its test. Minor wiring in `GameShell.vue` only if needed to pass region/dock signals.

OUT OF SCOPE: `useBoardSize` (separate composable), the CSS layout of the dock/board/region, removing
per-game Fit-button workarounds (Phase 169), and any zoom UX redesign.
</domain>

<decisions>
## Implementation Decisions

### Re-fit Trigger Scope
- Re-fit on **available-space changes only**: a change in `dockHeight` (watch the existing reactive
  ref) and a region resize (ResizeObserver on `.boardregion`/`regionEl`). These are the D12 symptoms.
- **Do NOT auto-refit on board content growth mid-game** — preserve the deliberate exclusion in the
  current header comment; a growing board must not yank the zoom mid-move.
- **Keep the region observer + dock watch alive for the component lifetime** (teardown on unmount).
  Stop the current "disconnect the observer after the 300ms startup settle" behavior for the
  layout-observing path. (The board-settle startup logic can remain for the INITIAL fit; it is the
  permanent disconnect of all observation that D12 requires changing.)
- Also **re-measure on `requestAnimationFrame`** for iframe/host-driven size changes that may not emit
  a normal RO/resize event (per the `useBoardSize.ts` precedent — GameShell runs in a platform iframe).

### Manual-Zoom Interaction
- **User zoom wins.** Track a "user has taken manual control" flag, set when `setZoom` is called
  (i.e. the user manually zoomed). Once set, auto-refit on available-space changes STOPS — preserving
  the original intent that a deliberate zoom sticks.
- **The manual Fit button re-arms auto-refit**: pressing Fit (`fitZoom()`) clears the manual-control
  flag and re-fits, so "Fit" means "fit to space and keep it fitted" again.
- A player who **never touches zoom** gets continuous auto-refit on dock/region changes — the D12 fix
  for free.
- Reachability is still guaranteed even under a manual zoom because the region stays scrollable (the
  zoom-container reserves `margin-bottom: var(--dock-h)`), so nothing is permanently lost.

### Mechanism & Test (PROC-01)
- **rAF-coalesce** re-fits so a cascade of layout changes yields a single re-fit, not thrash.
- Follow the established `useBoardSize.ts:69-97` pattern: `watch(el, …)` with `teardown()`,
  `flush:'post'`, RO on the region + an rAF re-measure. Do NOT introduce a new shared composable.
- **RED proof**: using the existing `FakeResizeObserver.fire()` + `fakeBoard.setSize()` harness (and
  making `fakeRegion` client dims / `dockHeight` mutable), assert that after the startup settle a
  dock-height / region change makes `zoomLevel` UPDATE — today it stays stale. Assert on the observable
  zoom value, not an internal flag.
- **Adversarial**: assert a manual `setZoom` is NOT overridden by a subsequent dock/region change, and
  that pressing Fit re-arms auto-refit (a later dock change then does re-fit).

### Claude's Discretion
- Whether the initial-fit startup-settle logic is retained as-is or folded into the persistent
  observer path, provided the initial fit still works and the observers are not permanently
  disconnected.
- The exact debounce/rAF coalescing implementation and the name/scope of the manual-control flag.
- Whether the region RO and dock watch share one re-fit scheduler or are separate — Claude's call.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useAutoZoom.ts`: `computeFitZoom(natural, avail)` `:32-40` (pure fit math), `measureAndFit()`
  `:57-82` (the re-fit entry point — call this on layout change), `fitZoom()` `:127-130`
  (`endStartup(); measureAndFit()` — the manual Fit path to re-arm from), returns
  `{ zoomLevel, setZoom, fitZoom, measureAndFit }` `:132`. Params: `boardEl`, `regionEl`,
  `dockHeight: Ref<number>` `:42-50`.
- The startup board `ResizeObserver` `:111-114` and `endStartup()` `:89-95` (which currently
  disconnects it) are the lifecycle to change.
- `avail` already subtracts `dockHeight.value` (`:74`) — so a `dockHeight` change genuinely changes the
  target fit; a `watch(dockHeight, …)` → `measureAndFit()` is the core of the dock fix.
- **The dock's own `ResizeObserver` already exists** and already writes fresh `dockHeight`
  (`GameShell.vue:1053-1062`) — no new dock measurement needed, just react to the ref.
- `useBoardSize.ts:69-97` is the copy-me pattern: RO on `.boardregion` + `window.resize` +
  `requestAnimationFrame(measure)` + `teardown()`.

### Established Patterns
- `ResizeObserver` is used per-site (useAutoZoom, useBoardSize, GameShell dock, theme, animations) —
  no shared wrapper; new one’d up locally with teardown.
- Manual Fit control: `GameHeader.vue:52` (`fit-zoom` emit) and `ControlsMenu.vue:93-94` →
  GameShell `@fit-zoom="fitZoom"` (`:2036`, `:2350`) → `useAutoZoom.fitZoom()`. The fix makes this
  automatic; the button stays as the explicit re-arm.

### Integration Points
- `useAutoZoom` is called at `GameShell.vue:301-305` with `zoomContainerEl` (board), `boardregionEl`
  (region), `dockHeight`.
- **Known pitfalls (do NOT repeat):** `container-type`/definite-width ancestor collapses the
  `width:max-content` board to 0 (GameShell `:1886-1923`, `:2969-2977`) — the re-fit must keep
  measuring natural size the same way. RO/window-resize don't fire on programmatic iframe resize
  (`useBoardSize.ts:83-85`) — hence the rAF re-measure.

</code_context>

<specifics>
## Specific Ideas

- D12 hit 3 games. The symptom presents as "a region is unreachable / I have to hit Fit every time the
  action panel shows up." The RED should reproduce exactly that: fit at startup, then the dock lands
  (dockHeight grows), and assert the zoom fails to re-fit pre-fix.
- The fix REFINES the one-shot (it was too aggressive), it does not blindly revert it — the deliberate
  "don't fight the user / don't re-fit on content growth" intents are preserved via the manual-control
  flag and the available-space-only trigger.

</specifics>

<deferred>
## Deferred Ideas

- A shared `useResizeObserver`/`useElementSize` composable to unify the 5 per-site RO usages — a
  refactor, not this fix.
- Removing per-game Fit-button workarounds — Phase 169.
- Any zoom UX redesign (pinch-zoom, zoom controls) — out of scope.

</deferred>
