---
phase: 157
slug: game-over-ui-forward-exits
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-20
---

# Phase 157 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom + @vue/test-utils for UI, node for host/session) |
| **Config file** | `vitest.config.ts` (existing — no install needed) |
| **Quick run command** | `npx vitest run <changed test file(s)>` |
| **Full suite command** | `npm test` (vitest run) |
| **Estimated runtime** | ~60s per file; full suite is the phase gate |

---

## Sampling Rate

- **After every task commit:** Run the task's `npx vitest run <file(s)>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** < 60s per targeted file

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 157-01-01 | 01 | 1 | ENDGAME-01, PROC-01 | T-157-01 | RED: draw mislabeled, slot/flag ignored, no dismiss (fails on behavior, not symbol) | unit (RED) | `npx vitest run src/ui/components/GameOverCard.test.ts src/ui/components/GameShell.game-over.test.ts src/ui/composables/useFocusTrap.test.ts src/ui/components/GameShell.live-region.test.ts` | ❌ W0 (GameShell.game-over.test.ts net-new) | ⬜ pending |
| 157-01-02 | 01 | 1 | ENDGAME-01 | T-157-01, T-157-02, T-157-03 | isDraw threaded session→wire→shell→card; labeling pure fn; no winner token when empty; dismiss no side effect | unit (GREEN) | `npx vitest run src/ui/components/GameOverCard.test.ts src/ui/components/GameShell.game-over.test.ts src/ui/composables/useFocusTrap.test.ts src/ui/components/GameShell.live-region.test.ts` | ✅ | ⬜ pending |
| 157-01-03 | 01 | 1 | ENDGAME-01, PROC-01 | T-157-01 | Suppression is DOM removal (custom + default board parity); dev-WS degrade never fakes "Draw" | unit (adversarial) | `npx vitest run src/ui/components/GameShell.game-over.test.ts src/ui/components/GameOverCard.test.ts && npm test` | ✅ | ⬜ pending |
| 157-02-01 | 02 | 2 | ENDGAME-02, PROC-01 | T-157-06 | RED: finished-game restart guard-rejected; debug:restart unrouted (fails on behavior, not symbol) | unit (RED) | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts src/cli/dev-host/DevHost.restart.test.ts` | ❌ W0 (DevHost.restart.test.ts net-new) | ⬜ pending |
| 157-02-02 | 02 | 2 | ENDGAME-02 | T-157-04, T-157-06 | Guard admits playing OR complete, rejects no-session; DevHost routes debug:restart→newGame; New Game restarts | unit (GREEN) | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts src/cli/dev-host/DevHost.restart.test.ts` | ✅ | ⬜ pending |
| 157-02-03 | 02 | 2 | ENDGAME-02, PROC-01 | T-157-05, T-157-06 | Restart truly rebuilds runner+seed (reset, not re-emit); mid-setup still rejected; second restart loops | unit (adversarial) | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts && npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ui/components/GameShell.game-over.test.ts` — net-new (slot / providesOwnGameOverUI suppression, UI parity); created RED in 157-01-01
- [ ] `src/cli/dev-host/DevHost.restart.test.ts` — net-new (debug:restart → wsSend({type:'restart'})); created RED in 157-02-01
- [ ] `src/ui/components/GameOverCard.test.ts` — extend (exists) with draw/unknown/winner labeling + dismiss
- [ ] `src/ui/composables/useFocusTrap.test.ts` — extend (exists) with Escape-to-close (escapeToClose:true)
- [ ] `src/ui/components/GameShell.live-region.test.ts` — extend (exists) with "Draw" announce

*Framework already present (vitest + @vue/test-utils + jsdom). No install. RESEARCH "Wave 0 gaps": no existing test asserts the draw label, card suppression, or finished-game restart — all net-new coverage above.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual: close affordance ≥44×44 hit target, AA contrast in light+dark | ENDGAME-01 | Pixel/contrast is design-dimension; token tests cover contrast provided no raw colors | Optional browser spot-check via `boardsmith dev` (theme.contrast.test.ts enforces token AA automatically) |

*Contrast is enforced automatically by `theme.contrast.test.ts` so long as new markup uses `--bsg-*` tokens (grep gate in 157-01). The only genuinely manual item is subjective visual polish; behavior is fully automated.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (2 net-new test files)
- [x] No watch-mode flags
- [x] Feedback latency < 157s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
