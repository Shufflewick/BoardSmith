---
phase: 153-dev-host-multi-client-turn-desync-fix
plan: 01
subsystem: infra
tags: [websocket, ws, dev-host, multiplayer, reconnect, cli]

requires:
  - phase: 153-RESEARCH.md
    provides: proven root cause (stale-close race in dev.ts's wss.on('connection') close handler) + fix design + reproduced empirical proof
provides:
  - One-line socket-identity guard in dev.ts's WS close handler (clients.get(clientId) === socket)
  - Real-ws "stale close" integration test proving the fail-pre/pass-post cycle (DEVHOST-01 repro, DEVHOST-02 fix)
  - Fast MultiplayerHost-level "stale disconnect" canary documenting the session-layer consequence
affects: [154-vendor-01-merc-re-vendor]

tech-stack:
  added: []
  patterns:
    - "Socket-identity guard on WS close teardown: only tear down a clientId's session state when the closing socket is still the currently-registered one for that clientId (clients.get(clientId) === socket)"

key-files:
  created: []
  modified:
    - src/cli/commands/dev.ts
    - src/cli/dev-host/dev-host.integration.test.ts
    - src/cli/dev-host/multiplayer-host.test.ts

key-decisions:
  - "Fix lives ONLY in dev.ts's close handler — no changes to MultiplayerHost/SnapshotSessionHost (reinitSeat/viewForSeat were already proven correct and server-authoritative; adding a connected-check to handleServerRequest was explicitly rejected as treating a symptom as correct behavior)"
  - "Two test layers: a fast MultiplayerHost-level canary (documents the session-layer consequence, stays green before and after the fix) plus a real-ws integration test with two raw sockets sharing one clientId (the only test that actually exercises dev.ts's fixed code path, and the one required to fail pre-fix / pass post-fix per SC-2)"
  - "The integration test's own connection handler is a hand-mirrored copy of dev.ts's (not a shared abstraction, per RESEARCH.md Pitfall 3) — both copies now carry the identical guard with a comment noting they must be kept in sync"

patterns-established:
  - "Socket-identity guard pattern for any future WS transport-layer teardown code: never assume socket close ordering, always check the map still points at the closing socket before deleting session state"

requirements-completed: [DEVHOST-01, DEVHOST-02]

duration: 25min
completed: 2026-07-06
---

# Phase 153 Plan 01: Dev-Host Stale-Close Reconnect Race Summary

**Fixed DEF-C (dev-host multi-client turn-desync) at its true root cause: a one-line socket-identity guard in `dev.ts`'s WS close handler that prevents a stale (belated) close event from a superseded page-reload socket from silently orphaning the reconnected client.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-06T15:50:00Z (approx, per STATE.md session start)
- **Completed:** 2026-07-06T16:15:59Z
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments

- Reproduced DEF-C deterministically with a real `ws` `WebSocketServer` test: two raw sockets sharing one `clientId` (mirroring a page reload's persisted-`clientId` reconnect), with the second socket's `hello` processed before the first socket's `close` fires — the exact race dev.ts is vulnerable to.
- Confirmed the test FAILS against the unguarded (pre-fix) close handler shape before applying any fix (RED, Task 1 commit `1474375c`) — proving DEVHOST-01's repro has teeth, not just a code-reading claim.
- Applied the one-line socket-identity guard (`clientId && clients.get(clientId) === socket`) to `dev.ts`'s close handler and confirmed the same test now PASSES (GREEN, Task 2 commit `43eab61c`).
- Added a fast `MultiplayerHost`-level canary ("stale disconnect") that documents WHY the guard is necessary at the session layer: `disconnect()` called after a reconnect `hello` silently drops all further broadcasts/responses to that seat. This canary is intentionally unaffected by the dev.ts fix (MultiplayerHost's own contract is correct) — it stays green throughout.
- Full repo suite: 187 files / 2677 tests, all green, no regression to existing reconnect/follow-mode/seat-stability tests.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Reproduce DEF-C — failing real-ws stale-close test + MultiplayerHost canary (RED)** - `1474375c` (test)
2. **Task 2: Apply the socket-identity guard to dev.ts + keep the mirrored test harness in sync (GREEN)** - `43eab61c` (fix)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/cli/commands/dev.ts` — added the `clients.get(clientId) === socket` guard to the WS close handler, with a comment explaining the stale-close race.
- `src/cli/dev-host/dev-host.integration.test.ts` — added a new `describe('stale close (DEF-C transport-layer race)')` block: its own real `WebSocketServer({port:0})` + `MultiplayerHost`, a connection handler that mirrors dev.ts's `hello`-sourced clientId assignment faithfully, and a test driving two raw sockets sharing one clientId through the exact reload-reconnect-then-stale-close sequence. The mirrored close handler now carries the identical guard (kept in sync with dev.ts per RESEARCH.md Pitfall 3).
- `src/cli/dev-host/multiplayer-host.test.ts` — added a new `describe('MultiplayerHost — stale disconnect after reconnect (DEF-C session-layer canary)')` block with one test documenting the session-layer consequence of a stale `disconnect()` call.

## Decisions Made

- Fix scope kept to exactly `dev.ts`'s close handler — no changes to `MultiplayerHost`/`SnapshotSessionHost`/`handleServerRequest`, per RESEARCH.md's explicit Anti-Patterns (adding a connected-check to action handling, or defensive re-broadcasts on reinit, would mask the real bug).
- Two-layer test strategy (fast unit canary + real-ws integration test) rather than one — only the real-ws test exercises dev.ts's literal buggy/fixed code path; the canary is cheap and documents the "why" for future maintainers.
- The integration test's connection handler is a deliberate hand-copy of dev.ts's, not a shared helper — per RESEARCH.md's locked decision to avoid growing shared test/production abstractions for a test-only need; both copies now carry matching guards with sync-reminder comments.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria were met without needing Rule 1-4 auto-fixes; the only iteration needed within Task 1 was fixing two self-inflicted test-harness bugs during authoring (comparing server-side vs. client-side socket object identity, and an `afterAll` cleanup relying on a map key that the stale-close bug itself deletes) — these were bugs in the new test code being written, not deviations from the plan's design, and were fixed inline before the RED commit as part of getting the test itself correct.

## Issues Encountered

- Initial draft of the integration test compared `staleClients.get('seat-a') === s1` (server-side socket vs. client-side socket reference) which can never be true — fixed to use `staleClients.has(...)` and message-based readiness signals (`sBMessages`/`s2Messages` containing `'joined'`/`'init'`) instead of unreliable identity comparisons across the client/server socket boundary.
- The test's `afterAll` originally closed sockets by iterating `staleClients.values()`, but the stale-close bug under test deletes map entries even for sockets that remain open (that's the whole point of the bug) — switched to a separate `staleServerSockets` Set populated on every `connection` event, independent of the clientId map, to guarantee cleanup regardless of the bug's effect on the map.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DEVHOST-01/DEVHOST-02 requirements satisfied at the automated layer; ROADMAP.md Phase 153 Success Criteria 1 and 2 are met.
- Phase 154 (MERC re-vendor, VENDOR-01) depends on this phase — the guard in `dev.ts` will be carried into MERC's vendored copy along with Phase 152's asset-completeness fix.
- Note for a future context: 153-RESEARCH.md's Pitfall 5 flags that the pre-existing 138-02 blocker (solo-human+AI-seat CLI dev-host seat-identity mismatch) may share this same root cause (a stale-close race would equally affect any solo `--ai` session if the human's tab ever reloads) — worth re-verifying 138-02's repro after this fix, though that re-verification is out of scope for this phase per REQUIREMENTS.md.
- SC-3 (a 2-browser Playwright scripted reload/reconnect/AI-handoff check) was not part of this plan's task list (153-01 only covers the automated-layer DEVHOST-01/02 requirements); confirm with the phase's overall verification whether a separate plan/checkpoint is needed for that human-facing check.

## Self-Check: PASSED

- FOUND: src/cli/commands/dev.ts (guard present, contains `clients.get(clientId) === socket`)
- FOUND: src/cli/dev-host/dev-host.integration.test.ts (contains "stale close" describe block)
- FOUND: src/cli/dev-host/multiplayer-host.test.ts (contains "stale disconnect" describe block)
- FOUND commit 1474375c (test(153-01): reproduce DEF-C stale-close race (RED))
- FOUND commit 43eab61c (fix(153-01): guard dev.ts close handler against stale-close race (GREEN))

---
*Phase: 153-dev-host-multi-client-turn-desync-fix*
*Completed: 2026-07-06*
