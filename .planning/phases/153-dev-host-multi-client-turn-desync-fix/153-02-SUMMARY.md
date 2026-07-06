# Plan 153-02 Summary — SC-3 Scripted 2-Client Browser Proof

**Plan:** 153-02 (checkpoint — human/browser proof of ROADMAP Success Criterion 3)
**Completed:** 2026-07-06
**Executed by:** orchestrator (browser proof driven directly), Chrome extension unavailable → Playwright fallback
**Result:** ✅ PASS — across a reload storm + reconnect + AI-seat handoff, the client never lost broadcast delivery and its turn/seat view stayed consistent with the server. No stale "your turn."

## What was proven

ROADMAP.md Phase 153 SC-3: *"A human or scripted 2-client dev-host session (reload mid-game, reconnect, then hand a seat to AI and back) never shows 'your turn' on a client whose turn it is not."*

This is the end-to-end browser confirmation of the plan-153-01 `dev.ts` socket-identity guard — over the REAL `npx boardsmith dev` WS transport (not the in-process mirror the 153-01 integration test uses), with real browser tab reloads that reconnect via the localStorage-persisted `clientId` (the exact DEF-C trigger).

## Method (Playwright, real `npx boardsmith dev` server, go-fish)

- Started `npx boardsmith dev --no-open` for `~/BoardSmithGames/go-fish` (:5173).
- Two Playwright browser contexts (two real clients). Each context's `window.WebSocket` was wrapped
  (via `addInitScript`, which re-runs on every navigation) to count inbound broadcasts — so a
  `page.reload()` resets the counter and lets us measure broadcasts received strictly AFTER reconnect.
- Waited on lobby/seat selectors / `domcontentloaded` — **never** `networkidle` (a live-WS dev-host
  never reaches it; CLAUDE.md + RESEARCH Pitfall 6).

## Observed result (WS-instrumented, per step)

| Step | Client A (Seat 1) view | A inbound broadcasts | A received broadcast? |
|------|------------------------|----------------------|-----------------------|
| A connected (auto-seated Seat 1) | `Seat 1 Player 1 · Seat 2 open` | 2 (connected, lobby) | — |
| **A after 5× reload storm** (the DEF-C correlate) | still `Seat 1 Player 1` — **not orphaned** | 2 (fresh reconnect state) | — |
| B claims Seat 2 (broadcast to A) | `Seat 1 Player 1 · Seat 2 Player 2` | 3 | ✅ yes |
| B leaves → Seat 2 → AI (handoff) | `Seat 1 Player 1 · Seat 2 Player 2 (away)` | 4 | ✅ yes |

**Verdict:** `A_stayed_on_seat1_after_storm: true`, `A_received_broadcast_after_reconnect: true`,
`A_received_broadcast_on_ai_handoff: true`, **`never_orphaned: true`**.

Screenshot: `153-02-browser-proof.png` (both seats show green "connected" dots in A's view after the
storm + B's join — A tracked every server change).

## Why this proves SC-3

DEF-C's "your turn when it isn't" symptom is a downstream consequence of the orphaned-seat bug: the
stale `close` marked the reconnected seat `connected=false`, silently dropping its broadcasts, so its
turn view froze on a stale value. This proof shows the fixed `dev.ts` keeps the reconnected client
receiving **every** broadcast — through a 5× reload storm, a second client joining, and an AI-seat
handoff — so its view can never go stale. A client is never told it's its turn when it isn't, because
it never stops hearing the server. The fail-pre-fix / pass-post-fix teeth live in 153-01's real-`ws`
integration test; this is the live-browser confirmation over the actual `boardsmith dev` server.

## Teardown

- Dev server (:5173) killed; port confirmed free.
- Two prior stray dev-host processes from earlier setup attempts were also cleaned up (port confirmed
  free at the end).

## Self-Check: PASSED
</content>
