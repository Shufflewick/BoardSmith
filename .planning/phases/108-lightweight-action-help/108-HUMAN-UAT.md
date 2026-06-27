---
status: partial
phase: 108-lightweight-action-help
source: [108-VERIFICATION.md]
started: 2026-06-27
updated: 2026-06-27
deferred_to: Phase 110 (DEMO-01 browser confirmation gate)
---

## Current Test

[awaiting human testing — deferred to Phase 110 demo gate]

## Tests

### 1. Pointer hover + touch tap reveal
expected: Hovering the "?" affordance on an action (pointer) reveals the help popover; tapping it (touch) toggles the popover open/closed. Verified in BOTH a custom UI and AutoUI.
result: [pending]

### 2. Popover position near viewport edge
expected: Near the bottom of the viewport the popover flips above the trigger (16px clearance) without overlapping it; near the right edge the popover shifts left and the caret still points at the "?" trigger. (jsdom returns 0 for getBoundingClientRect/offsetHeight, so only a real browser paint confirms this.)
result: [pending]

### 3. Cross-reload localStorage persistence
expected: Toggling "Show action help" OFF (or ON) in ControlsMenu persists across a browser tab reload via the `boardsmith_action_help` localStorage key (default ON), and the setting holds across all actions.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

None — all three items are automated at the component level (ActionHelpPopover parity fixture, GameShell dual-path + localStorage harness tests) and pass; only the browser-paint/cross-reload visual confirmation is deferred. These are covered by the Phase 110 DEMO-01 gate, per 108-CONTEXT.md deferred decisions.
