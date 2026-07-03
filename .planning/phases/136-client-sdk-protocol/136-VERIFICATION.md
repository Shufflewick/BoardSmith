---
phase: 136-client-sdk-protocol
verified: 2026-07-03T18:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 136: Client SDK Protocol Verification Report

**Phase Goal:** The public client SDK gives callers an awaitable connection lifecycle, one consistent error contract, and types that match the canonical protocol — no silent drops, no forked type drift.
**Verified:** 2026-07-03T18:00:00Z
**Status:** passed
**Re-verification:** No — initial verification (post code-review fix loop)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PROC-01 gate: every in-scope finding (F23/F24/F25/F26/F35/F38) has a recorded verdict written before any fix task ran | VERIFIED | `136-FINDINGS-VERIFICATION.md` has 6 `VERDICT: LEGITIMATE` sections with current-HEAD file:line traces; written in commit `6b5250b0`, before any `136-02`..`136-05` fix commit (git log confirms ordering) |
| 2 | `GameConnection` exposes an awaitable `opened` promise; `action()` awaits open (bounded by `connectionTimeout`) instead of silently resolving `{success:false}` | VERIFIED | `src/client/game-connection.ts:63-65` (`opened`, `#openedResolve/#openedReject`), `:249-267` (`awaitOpen()`), rejects loudly on timeout/close (`:317-320`, `:580-589` `cleanup()` rejects pending `opened` — CR-02 fix in `d064bb38`) |
| 3 | `disconnect()`→`connect()` restores auto-reconnect predictably (no `config.autoReconnect` mutation); `connectImmediately` honored | VERIFIED | `#userDisconnected` flag (`:73`), set by `disconnect()` (`:150`), cleared by `connect()` (`:107`), guarded in `scheduleReconnect()` (`:501-502`); `connectImmediately` gates dialing (`:109-110`) and stale-CLOSING-socket detach on reconnect (WR-01 fix `6bd52437`) |
| 4 | All 18 `MeepleClient` HTTP methods route through ONE shared throwing response helper; `errorCode` optional, not fabricated client-side | VERIFIED | `parseResponse<T>()` at `client.ts:583-593` checks `response.ok` before `.json()`, throws `MeepleClientError(message, errorCode)`; grep shows all 18 methods (+`health` correctly exempt) call `this.parseResponse(...)`; `errorCode?: ErrorCode` optional per F25 scope boundary |
| 5 | Client SDK imports canonical protocol types instead of redefining them; `CreateGameRequest` drift (`playerIds`) resolved; barrel re-export chain preserved | VERIFIED | `src/client/types.ts:22` imports from `'../types/protocol.js'`; `:380` `export type { CreateGameRequest }` (re-export, carries `playerIds`); `npx tsc --noEmit` shows zero errors in `src/client/*` or `src/types/protocol.ts` |
| 6 | `WebSocketMessage` union includes `UpdateSlotPlayerOptionsMessage` | VERIFIED | `src/types/protocol.ts:508` — member of the union alongside its siblings |
| 7 | `generatePlayerId()` error message names a field that exists on `MeepleClientConfig`; playerId minted via ONE secure crypto path repo-wide (no `Math.random()` capability tokens) | VERIFIED | `client.ts:48-66` `generatePlayerId()` (crypto.randomUUID + getRandomValues fallback, "Node 19+" wording corrected), `types.ts:49` `playerId?: string` on `MeepleClientConfig`; GameShell.vue's two former `Math.random()` mint sites (`:76`, `:1375`) now call the exported `generatePlayerId()` (CR-01 fix `26f3b8c2`) |
| 8 | In-repo consumers (`vue.ts`, `GameShell.vue`) migrated to the new contracts — no leftover fire-and-forget/silent-`.success` patterns | VERIFIED | `vue.ts` `setTimeout(100)` hack removed, replaced by `.opened.then/.catch` with connection-identity guard (WR-03 fix `d81a815e`); `connectImmediately: autoConnect` threaded (`:119`); `seatDebounceTimer` cancelled on re-trigger/`onScopeDispose` (WR-04 fix `93cca93e`); `GameShell.vue` lobby handlers are try/catch-only (review confirms zero remaining `.success` reads on the 21 throwing methods) |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/client/game-connection.ts` | Awaitable `opened`, await-then-send `action()`, `#userDisconnected` flag | VERIFIED | 664 lines; all mechanisms present, wired, unit-tested (16 tests) |
| `src/client/client.ts` | Single throwing response helper, `connect()` exposing `opened`, `playerId` config handling | VERIFIED | 622 lines; `parseResponse` chokepoint for 18 methods, `connectImmediately`/`connectionTimeout` threaded, 51 unit tests |
| `src/client/types.ts` | Re-export layer over `protocol.ts`; new config fields | VERIFIED | 412 lines; imports/re-exports canonical types, `connectImmediately`/`connectionTimeout`/`playerId` fields present |
| `src/client/index.ts` | Barrel surface resolves re-exported types | VERIFIED | `npx tsc --noEmit` shows no TS2305 errors; `generatePlayerId`, `MeepleClientError` exported and consumed by `GameShell.vue` |
| `src/types/protocol.ts` | `WebSocketMessage` union includes `UpdateSlotPlayerOptionsMessage` | VERIFIED | Confirmed at line 508 |
| `src/client/vue.ts` | `opened`-driven setup, `connectImmediately` threading, debounce cleanup | VERIFIED | 515 lines; `setTimeout` hack gone, `onScopeDispose` teardown, connection-identity guard |
| `src/ui/components/GameShell.vue` | try/catch-only lobby handlers; secure playerId minting | VERIFIED | Review confirms no residual `.success` checks on throwing methods; both `Math.random()` mint sites replaced with `generatePlayerId()` |
| `docs/api/client.md` | Quickstart no longer teaches SDK-01/SDK-03 traps or wrong field names | VERIFIED | `useLobby` (not `withLobby`), `playerSeat: 1` (1-indexed) at all 4 previously-drifted sites |
| `.planning/phases/136-client-sdk-protocol/136-FINDINGS-VERIFICATION.md` | PROC-01 gate with 6 verdicts | VERIFIED | All 6 `VERDICT: LEGITIMATE`, written before fix commits |
| `src/client/game-connection.test.ts`, `client.test.ts`, `vue.test.ts` | PROC-02 regression tests, RED-recorded | VERIFIED | RED states documented in SUMMARYs with commit hashes; 76 tests currently pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/client/index.ts` | `src/client/types.ts` | re-export of request types | WIRED | Barrel imports/re-exports resolve cleanly under `tsc --noEmit` |
| `src/client/types.ts` | `src/types/protocol.ts` | canonical type re-export | WIRED | `import ... from '../types/protocol.js'` at top of file; `export type { X }` lines for each migrated type |
| `game-connection.ts action()` | `GameConnection.opened` | await bounded by `connectionTimeout` | WIRED | `awaitOpen()` races `this.opened` against a timeout promise |
| `game-connection.ts scheduleReconnect()` | `#userDisconnected` | guard clause | WIRED | `if (this.#userDisconnected) return;` at line 501 |
| `vue.ts setupConnection` | `GameConnection.opened` | `.then/.catch` with connection-identity guard | WIRED | Confirmed post-review fix (`d81a815e`) — stale-connection race closed |
| `GameShell.vue` lobby handlers | throwing `MeepleClient` methods | try/catch | WIRED | Review's own file sweep confirms zero remaining `.success` reads on the 21 throwing methods |
| `GameShell.vue` playerId minting | `generatePlayerId()` (client barrel) | direct call, no local `Math.random()` | WIRED | Both former mint sites replaced (CR-01 `26f3b8c2`); persisted id passed into `MeepleClient` constructor rather than overwritten via `setPlayerId()` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Client SDK unit tests (game-connection, client, vue, GameShell fallthrough) | `npx vitest run src/client/ src/ui/components/GameShell.join-fallthrough.test.ts` | 4 files / 76 tests passed | PASS |
| GameShell full test suite (no regressions from lobby migration) | `npx vitest run src/ui/components/GameShell` | 9 files / 126 tests passed | PASS |
| Full repo test suite | `npx vitest run` | 175 files / 2358 tests passed | PASS |
| Typecheck of phase-136 files | `npx tsc --noEmit` (filtered to `src/client/`, `protocol.ts`, `GameShell.vue`) | 0 errors (51 pre-existing unrelated errors elsewhere in repo, untouched by this phase) | PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` conventions; verification relied on vitest + tsc as declared in plan `must_haves`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PROC-01 | 136-01 | Verification verdict recorded before fix | SATISFIED | `136-FINDINGS-VERIFICATION.md`, 6/6 LEGITIMATE |
| PROC-02 | 136-03/04/05 | Regression test fails on pre-fix code | SATISFIED | RED states documented per-task in SUMMARYs with commit hashes |
| SDK-01 | 136-02/03/04/05 | Awaitable open, actions fail loud | SATISFIED | `opened` promise + `awaitOpen()`/`awaitReconnect()`, `connect()` exposes it |
| SDK-02 | 136-02/03/05 | disconnect→connect restores auto-reconnect | SATISFIED | `#userDisconnected` flag, `connectImmediately` |
| SDK-03 | 136-04/05 | One consistent error contract | SATISFIED | `parseResponse` chokepoint, GameShell try/catch migration |
| SDK-04 | 136-02 | Canonical protocol types imported, not redefined | SATISFIED | `types.ts` re-exports from `protocol.ts`, `playerIds` restored |
| SDK-05 | 136-02 | `UpdateSlotPlayerOptionsMessage` in union | SATISFIED | `protocol.ts:508` |
| SDK-06 | 136-02/04 | playerId error message names real field | SATISFIED | `playerId?: string` on `MeepleClientConfig`, corrected message + Node version |
| DOCX-04 (cross-cutting, claimed by 136-05) | 136-05 | Docs updated same phase as fix | SATISFIED | `docs/api/client.md` corrected at all 4 drifted example sites |

No orphaned requirements: REQUIREMENTS.md's Phase 136 row set (SDK-01..06) matches the union of plan-declared `requirements:` fields exactly. PROC-01/PROC-02/DOCX-04 are cross-cutting process requirements whose canonical "first satisfied in" traceability row points to earlier/later phases, but Phase 136 independently re-satisfies its own instance of each (gate written this phase, regression tests written this phase, docs fixed this phase) — consistent with the milestone's "process mandate applies to every FIX requirement" framing.

### Anti-Patterns Found

None blocking. The code-review fix loop (2 Critical + 7 Warning) already surfaced and closed every substantive anti-pattern found in the 11 reviewed files (see `136-REVIEW.md`, status: resolved, fixed 2/2 critical + 7/7 warning). Re-verification confirms all 10 fix commits (`26f3b8c2` through `1f3fb0ea`) are present on `main` and the underlying behaviors they targeted are gone from current HEAD (spot-checked: `Math.random()` no longer present in `GameShell.vue`, `cleanup()` rejects pending `opened`, stale-CLOSING-socket detach present, connection-identity guard present, debounce-timer cleanup present, `joinGame` fallthrough branches on error shape not prose, `action()` awaits reconnect during backoff, `getMatchStatus` uses a relative path). The 8 Info-severity findings (IN-01..IN-08) remain open by design (out of fix_scope: critical+warning) and do not block the phase goal — none of them represents a silent drop, a forked type, or a non-awaitable lifecycle gap, which are the phase's actual success criteria.

### Human Verification Required

None. All must-haves are verifiable via static trace, `tsc --noEmit`, and automated test execution; no visual/UX/real-time-service behavior is in scope for this phase.

### Gaps Summary

No gaps. All 8 derived observable truths (roadmap goal + PLAN frontmatter must_haves across Plans 02-05) are VERIFIED against current HEAD source, not SUMMARY.md narration. The post-completion code-review fix loop (10 commits) was independently re-verified in this pass: every cited file:line fix location was re-read and matches the review's "Resolution" claims, and the full repo test suite (2358 tests) plus a scoped `tsc --noEmit` pass both confirm no regression was introduced by the fix loop.

---

_Verified: 2026-07-03T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
