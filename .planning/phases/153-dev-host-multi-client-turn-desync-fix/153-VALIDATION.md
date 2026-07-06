---
phase: 153
slug: dev-host-multi-client-turn-desync-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-06
---

# Phase 153 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (repo suite; `dev-host.integration.test.ts` uses real `ws` sockets) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts src/cli/dev-host/dev-host.integration.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60–120s (full suite) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/cli/dev-host/multiplayer-host.test.ts src/cli/dev-host/dev-host.integration.test.ts`
- **After every plan wave:** `npm test`
- **Before `/gsd:verify-work`:** Full suite green + the SC-3 scripted 2-client Playwright check run once (extension down → Playwright)
- **Max feedback latency:** ~120s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 153-repro-canary | TBD | 1 | DEVHOST-01 | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "stale disconnect"` | ❌ W0 | ⬜ pending |
| 153-ws-fix | TBD | 1 | DEVHOST-02 | integration (real ws) | `npx vitest run src/cli/dev-host/dev-host.integration.test.ts -t "stale close"` | ❌ W0 | ⬜ pending |
| 153-no-regression | TBD | 1 | DEVHOST-02 | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts` | ✅ existing | ⬜ pending |
| 153-sc3-playwright | TBD | 2 | DEVHOST-01/02 (SC-3) | e2e (Playwright) | scripted `npx boardsmith dev` 2-client reload/reconnect/AI-handoff | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/dev-host/dev-host.integration.test.ts` — add a real-`ws`-socket test: two sockets sharing one `clientId`, old socket's `close` arrives AFTER the new socket's `hello`; assert the reconnected seat keeps receiving broadcasts. **This is the fail-pre-fix / pass-post-fix test (SC-2)** — the only layer exercising the literal `dev.ts` close-handler fix.
- [ ] `src/cli/dev-host/multiplayer-host.test.ts` — add a fast unit-level canary asserting the invariant "a seat that received a `hello` more recently than any `disconnect` keeps receiving broadcasts."
- [ ] SC-3 Playwright script — none exists; author following [[browser-testing-playwright-fallback]] / the Phase-152 pattern, waiting on `domcontentloaded`/selectors, never `networkidle`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scripted 2-client dev-host session never shows "your turn" out of turn across reload/reconnect/AI-handoff | DEVHOST-01/02 (SC-3) | Real WS transport + reload timing; needs a running `boardsmith dev` + browser | Playwright: 2 clients, reload mid-game, reconnect, hand a seat to AI and back; assert no client shows its turn when it isn't. Kill dev server after. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
