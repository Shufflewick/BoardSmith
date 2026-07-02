---
phase: 127
slug: scriptable-dev-host
status: final
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-02
---

# Phase 127 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.0 (`environment: 'node'`; jsdom per-file for the DevHost component test) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~100 seconds (full suite, ~1999 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test files>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green + the new integration test specifically (phase's literal acceptance proof)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-1 getState/getLobby ops | 127-01 | 1 | DRIVE-01 | T-127-01, T-127-04 | getState returns ONLY the caller's own seat view (server-tracked seat, never client-supplied); guards unseated/pre-start; getLobby works all phases | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "getState"` | ✅ (add cases) | ⬜ pending |
| 01-2 debugToggle/uiSwitch relay | 127-01 | 1 | DRIVE-03 | T-127-02 | relay-only fan-out, no bridge.ts routing, no game-state mutation | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "debug"` | ✅ (add cases) | ⬜ pending |
| 01-3 DevHost.vue relay + test | 127-01 | 1 | DRIVE-03 | T-127-02 | page drives existing toggleDebug/onUiSelect (no parallel logic) | component (jsdom) | `npx vitest run src/cli/dev-host/DevHost.debug-relay.test.ts` | ❌ NEW (FakeWebSocket harness from DevHost.restart.test.ts) | ⬜ pending |
| 02-1 GameConnection Node-capability | 127-02 | 1 | DRIVE-02 | T-127-05, T-127-06 | injectable wsCtor + fail-loud actionable guard; production protocol unchanged | unit | `npx vitest run src/client/game-connection.test.ts` | ❌ NEW (Node env, inject via wsImplementation — not vi.stubGlobal) | ⬜ pending |
| 03-1 createDevHostClient | 127-03 | 2 | DRIVE-01, DRIVE-02, DRIVE-03 | T-127-06 | separate sibling of GameConnection (no bilingual class); requestId correlation | unit (via integration) + tsc | `npx vitest run src/cli/dev-host/dev-host.integration.test.ts` | ❌ NEW | ⬜ pending |
| 03-2 Node integration test | 127-03 | 2 | DRIVE-01, DRIVE-02, DRIVE-03 | T-127-07, T-127-08 | browserless flow asserts own-seat-only view; server+sockets torn down in afterAll | integration (real ws server) | `npx vitest run src/cli/dev-host/dev-host.integration.test.ts` | ❌ NEW (WebSocketServer({port:0}) → MultiplayerHost, mirrors dev.ts) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Zero new deps — `ws` is already a direct dependency (server side); Node ≥22.4 native `globalThis.WebSocket` for the client side (with injectable override + fail-loud guard for exotic/older runtimes). Wave 0 test scaffolds to create before/with implementation:

- [x] `src/cli/dev-host/multiplayer-host.test.ts` — EXISTS; add getState/getLobby/debugToggle/uiSwitch cases to the in-process fake-`send` harness.
- [ ] `src/cli/dev-host/DevHost.debug-relay.test.ts` — NEW; `@vitest-environment jsdom` + `mount(DevHost)` + the FakeWebSocket harness copied verbatim from `DevHost.restart.test.ts`.
- [ ] `src/client/game-connection.test.ts` — NEW; default Node env; inject a minimal FakeWebSocket via `wsImplementation` (do NOT `vi.stubGlobal`, since global WebSocket may be absent pre-22.4).
- [ ] `src/cli/dev-host/dev-host.integration.test.ts` — NEW; the real-`ws`-server acceptance proof; `new WebSocketServer({ port: 0 })` wired to `MultiplayerHost` (mirrors dev.ts:516-583 minus the Vite httpServer).
- [x] No new framework install — Vitest + `ws` both already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Debug-panel toggle + UI switch visibly react in a real browser when driven over WS | DRIVE-03 | The final page-side visual reaction is only observable in a browser | Optional live smoke at executor discretion: `boardsmith dev` in go-fish, send debugToggle/uiSwitch from a Node script (createDevHostClient), observe the panel/UI change; **kill the dev server after**. The WS→page relay path is fully unit + component tested regardless, so this is a confidence check, not a gate. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (3 new test files enumerated above)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
