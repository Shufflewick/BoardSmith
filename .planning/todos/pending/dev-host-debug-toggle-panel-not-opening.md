---
created: 2026-07-01
title: Dev-host "Debug" header toggle does not visibly open the DebugPanel in the iframe
area: dev-host / DebugPanel
severity: low
files:
  - src/cli/dev-host/DevHost.vue
  - src/ui/components/GameShell.vue
  - src/ui/components/DebugPanel.vue
---

## Problem

During Phase 123 Plan 04 browser verification (go-fish, `boardsmith dev`), clicking
the "Debug" toggle in the Dev header did not visibly open the `DebugPanel` inside
the GameShell iframe. The toggle is wired via `DevHost.vue`'s `toggleDebug`
postMessage to a `GameShell.vue` handler that predates this plan, so the wiring
itself was not touched or introduced by Plan 04 — this is a pre-existing gap.

This blocked *visual* confirmation of the new "Flow position" readable-description
line added to the DebugPanel's flow-context box in Plan 04 (248ac2d). The
underlying data path is still verified: the `debug:flow-state` op and its
`flowDebugInfo.description` field are covered by unit tests in
`src/session/stateless-ops.test.ts`, and the window-bridge channel
(`window.__BOARDSMITH_DEVTOOLS.getFlowDebugInfo()`) WAS confirmed correct live in
the browser. Only the DebugPanel's on-screen visibility is unconfirmed.

Two other pre-existing dev-host issues were also observed during the same
verification session (not filed as separate todos, noted here for visibility):
- A stale seat claim persists across dev server restarts, blocking switching to a
  different seat until the server/session state is cleared.
- The in-iframe lobby's "Create Game" control does not advance/start a game in
  some flows (dead-end in the lobby UI).

## Suggested Investigation

1. Trace `DevHost.vue`'s `toggleDebug` postMessage handler in `GameShell.vue` —
   confirm it actually toggles a reactive flag that the DebugPanel's mount
   condition observes.
2. Check whether the DebugPanel is rendered but hidden by CSS/z-index/overlay
   stacking (e.g. under the board region) rather than not rendered at all.
3. Reproduce with a non-iframe standalone GameShell mount to see if the toggle
   works outside the platform-mode iframe context (isolates iframe postMessage
   wiring vs. panel-visibility CSS as the root cause).

## Severity rationale

Low — the debug:flow-state op's data path is unit-tested and the window-bridge
introspection channel works correctly in the browser, so FLOW-01/03 functionality
is not blocked. Only the DebugPanel's visual affordance is affected, and existing
dev-host debug ops (`debug:history`, `debug:action-traces`) presumably share the
same visibility gap since they render in the same panel.
