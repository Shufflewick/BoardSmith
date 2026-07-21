# Phase 158: Auto-Zoom Re-Fit - Research

**Researched:** 2026-07-20
**Confidence:** HIGH (defect + fix surface fully mapped via codebase scout)

## Summary

D12 is a lifecycle bug in one composable. `useAutoZoom` fits once at startup and then **permanently
disconnects** its observer (by design), and it only ever observed the board's OWN size — never the
region or the dock. So a dock landing / region resize (both change available space) never re-fits.

## Fix Surface (verified file:line)

- `src/ui/composables/useAutoZoom.ts`:
  - `measureAndFit()` `:57-82` — the re-fit entry point. `avail` subtracts `dockHeight.value` `:74`, so
    a dock change genuinely changes the fit target.
  - startup board `ResizeObserver` `:111-114` + `endStartup()` `:89-95` (disconnects it after
    `SETTLE_MS=300`). This permanent disconnect is the defect's mechanism.
  - Params `:42-50` (`boardEl`, `regionEl`, `dockHeight`); returns `:132`.
- `GameShell.vue`: `useAutoZoom` call `:301-305`; dock RO already writes fresh `dockHeight`
  `:1053-1062` (react to it, don't re-measure).
- Manual Fit: `GameHeader.vue:52`, `ControlsMenu.vue:93-94` → GameShell `@fit-zoom="fitZoom"`
  (`:2036`,`:2350`) → `useAutoZoom.fitZoom()` `:127-130`.

## The Fix (per locked CONTEXT decisions)

1. Add a persistent region `ResizeObserver` (on `regionEl`) + a `watch(dockHeight, …)`, both calling a
   single rAF-coalesced re-fit → `measureAndFit()`. Keep them alive for the component lifetime; tear
   down on scope dispose.
2. Guard with a `userControlled` flag: set true in `setZoom` (user manually zoomed) → auto-refit stops.
   `fitZoom()` clears it (re-arm).
3. rAF re-measure covers iframe/host resize that RO may miss (`useBoardSize.ts:83-85` precedent).
4. Do NOT re-fit on board CONTENT growth — only available-space (dock/region) changes.

## Pitfalls (do not repeat)

- `container-type`/definite-width ancestor collapses the `width:max-content` board to 0
  (`GameShell.vue:1886-1923`, `:2969-2977`). The re-fit must keep measuring natural size via
  `getBoundingClientRect() / computed zoom` exactly as today.
- RO/window-resize don't fire on programmatic iframe resize — hence the rAF re-measure.
- Don't fight the user: a manual zoom must survive a subsequent dock/region change (the `userControlled`
  flag).

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| ZOOM-01 | D12 | composable | RED: after the startup settle, a `dockHeight` increase and a region resize leave `zoomLevel` STALE pre-fix; post-fix `zoomLevel` re-fits. Drive via `FakeResizeObserver.fire()` + `fakeBoard.setSize()` + mutable region dims/dockHeight. Assert the observable zoom value. | `src/ui/composables/useAutoZoom.test.ts` |
| ZOOM-01 | D12 | composable (adversarial) | A manual `setZoom` is NOT overridden by a later dock/region change; `fitZoom()` re-arms so a later change then DOES re-fit. | `useAutoZoom.test.ts` |
| ZOOM-01 | D12 | composable (guard) | Board CONTENT growth (board size change without a region/dock change) does NOT trigger an auto-refit. | `useAutoZoom.test.ts` |
| PROC-01 | — | process | Fix in the composable + RED proven on pre-fix + adversarial (user-zoom preserved) before close. | git RED→GREEN |

### Wave 0 gaps
- No existing test drives a post-startup dock/region change — net-new.
- `fakeRegion` client dims are currently non-writable (`:62-67`); the harness must make them
  mutable/getter-based for a re-fit test.
- The `userControlled`-flag behavior (survives layout change; Fit re-arms) is entirely net-new.
