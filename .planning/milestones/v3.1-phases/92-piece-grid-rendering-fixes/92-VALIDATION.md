---
phase: 92
slug: piece-grid-rendering-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 92 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `npx vitest run src/ui/components/auto-ui` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (targeted), full suite longer |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/ui/components/auto-ui`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | PIECE-01 | — | Piece with `$images` renders as image, not text box | unit | `npx vitest run src/ui/components/auto-ui` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PIECE-02 | — | Piece without image renders as owner-colored disc + label | unit | `npx vitest run src/ui/components/auto-ui` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PIECE-03 | — | Grid sizes from declared coords; missing coords → loud error, no 8×8 fallback | unit | `npx vitest run src/ui/components/auto-ui` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs to be filled by the planner; this strategy maps each requirement to automated coverage.*

---

## Wave 0 Requirements

- [ ] Test file(s) for the extracted helpers (`resolvePieceVisual`, `resolveGridSize`) — pure functions, testable in `environment: 'node'`
- [ ] Stubs for PIECE-01 (image resolution), PIECE-02 (token resolution from `player.color`), PIECE-03 (grid-size resolution + loud error path)

*Pure-function helpers (D-01) are fully unit-testable without DOM. Existing vitest infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Image/token/error panel render correctly in a live board | PIECE-01/02/03 | Visual DOM rendering of Vue SFC requires browser observation | Run a game with image pieces, no-image pieces, and a misconfigured grid; confirm image renders, owner-colored disc renders, and the in-board error panel appears (no 8×8 fallback) |

*Pure helper logic has automated verification; final visual rendering is confirmed in the browser per project CLAUDE.md end-to-end testing rule.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
