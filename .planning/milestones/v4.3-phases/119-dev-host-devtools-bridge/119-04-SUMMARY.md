---
phase: 119-dev-host-devtools-bridge
plan: "04"
subsystem: docs/browser-proof
tags: [devtools, agent-loop, browser-proof, DEV-04, human-verified]
dependency_graph:
  requires: [119-01, 119-02, 119-03]
  provides: [agent-loop-harness, browser-proof]
  affects: [.planning/phases/119-dev-host-devtools-bridge/119-AGENT-LOOP.md]
tech_stack:
  added: []
  patterns: [outer-page→iframe cross-frame agent loop, DISCOVER→SELECT→DRIVE→CONFIRM]
key_files:
  created: []
  modified:
    - .planning/phases/119-dev-host-devtools-bridge/119-AGENT-LOOP.md
metrics:
  completed: "2026-07-01"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 119 Plan 04: DEV-04 Agent-Loop Doc + Browser Proof Summary

**One-liner:** The DISCOVER→SELECT→DRIVE→CONFIRM agent loop is documented as a runnable console harness and browser-proven live against go-fish — success path confirmed end-to-end; the `success:false` requirement resolved by a documented pit-of-success finding + unit-test coverage.

## Tasks

| Task | Name | Status |
|------|------|--------|
| 1 | Write agent-loop harness + repro doc (`119-AGENT-LOOP.md`) | Done (committed b1b4712) + corrected failure recipe this plan |
| 2 | Live browser proof (custom UI + AutoUI, success + failure) | Done with grey-area acceptance (below) |

## Browser Proof Results (live, 2026-07-01, go-fish custom UI)

Run in the outer dev-host page console while seated:

```
[BS-PROOF] devtools present: true
[BS-PROOF] actions: ['ask']
[BS-PROOF] metadata: {ask: {…}}
[BS-PROOF] validElements: [22, 37, 51, 39, 44, 16]
[BS-PROOF] controller found: true
[BS-PROOF] clicking valid element 22 true
[BS-PROOF resolved] SUCCESS {"action":"ask","success":true,"seat":1}
```

- **DEV-01** — `iframe.contentDocument.querySelector('[data-bs-el-id="22"]')` resolved a real element and driving a bubbling click ran the full action pipeline. ✅
- **DEV-02** — `window.__BOARDSMITH_DEVTOOLS` present on the outer page; `getAvailableActions()` → `['ask']`; `getBoardInteractionState().validElements` listed live selectable ids. ✅
- **DEV-03** — `boardsmith:action-resolved` dispatched on the iframe window with `success:true` on the legal move. ✅
- **DEV-04** — DISCOVER→SELECT→DRIVE→CONFIRM composed into a working, vision-free, poll-free agent loop. ✅

**AutoUI:** DEV-01 `data-bs-el-id` parity across all 4 AutoUI renderers is covered by the automated 119-01 parity test; the DEV-02/03 bridge lives in shared `GameShell.vue` / `useActionController.ts` (UI-agnostic), so the same loop drives AutoUI identically. Live AutoUI re-run not separately performed (dev server killed per project hard rule after the custom-UI proof).

## Grey-Area Acceptance: `success:false` browser demo

User decision (2026-07-01): **Accept + document finding.**

**Finding:** DEV-04's literal "observe `success:false` in the browser" could not be produced in go-fish. `boardsmith:action-resolved` dispatches `success:false` **only** after a server round-trip rejects an action (`useActionController.execute()` → `sendAction()` returns `{success:false}` or throws). Every client-side guard (`Not your turn`, `Action not available`, `Invalid selection`, `Missing required selection`) is an early return that dispatches **nothing**. Go-fish's `ask` action is pit-of-success: `target`/`rank` choices *are* the valid set, so a bad value is rejected client-side (observed: `execute returned {"success":false,"error":"Invalid selection for \"target\""}` with **no** event) and a valid value is always server-accepted. No bad-args path to an in-browser `success:false` exists for go-fish.

**Coverage of the failure branch:** `src/ui/composables/useActionController.devtools.test.ts` Test 2 mocks `sendAction` → `{success:false, error:'Server rejected the move'}` and asserts the event fires with `success:false` + `error` at the identical dispatch site. The dispatch wiring for the failure case is therefore verified; only a live in-browser reproduction (which requires a server-only rule go-fish doesn't have) was not performed.

**Doc correction:** `119-AGENT-LOOP.md`'s failure section was rewritten — the original "call `execute()` with invalid args → `success:false` event" recipe was inaccurate (such calls early-return client-side without dispatching). It now documents the real behavior and this finding.

## Self-Check: PASSED

- `119-AGENT-LOOP.md` exists, contains `boardsmith:action-resolved`, `data-bs-el-id`, `__BOARDSMITH_DEVTOOLS`, and a corrected failure section.
- Live browser proof: DISCOVER + SELECT + DRIVE + CONFIRM(success) confirmed in custom UI.
- `success:false` resolved via documented finding + unit-test Test 2.
- Dev server killed after proof (port 5173 clear).
</content>
</invoke>
