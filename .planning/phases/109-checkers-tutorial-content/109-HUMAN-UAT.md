---
status: partial
phase: 109-checkers-tutorial-content
source: [109-VERIFICATION.md]
started: 2026-06-28
updated: 2026-06-28
deferred_to: Phase 110 (DEMO-01 browser demonstration gate)
---

## Current Test

[awaiting human testing — this IS the Phase 110 DEMO-01 gate]

## Tests

### 1. End-to-end checkers tutorial UX in the browser
expected: In `cd ~/BoardSmithGames/checkers && npx boardsmith dev`, open Controls → Tutorial → "Start tutorial" and walk all four steps: (a) the mandatory-capture tip appears the first time a capture is forced (CHK-02), (b) the piece gate blocks the wrong piece and the piece + destination annotations render (CHK-01), (c) the forced multi-jump continuation fires and the turn does not end while further jumps exist (CHK-03), (d) End Turn completes the tutorial. Confirm it works in BOTH the custom checkers UI and AutoUI (CHK-04).
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

None — all five must-haves (CHK-01..04 + TUT-04) are verified at the automated level (BoardSmith 1593/1593, checkers 31/31, incl. the CI-verifiable intact-walkthrough + green→red break proof). Only the interactive browser confirmation is deferred, and it is precisely the scope of Phase 110 (DEMO-01).
