# Phase 113 Plan 03 — Summary

**Plan:** 113-03 — Browser verify: hint ring on rank cards + narrated AI-vs-AI demo (GFAI-01, GFAI-02)
**Type:** checkpoint:human-verify
**Status:** Approved — GFAI-01 fully verified live; GFAI-02 verified by integration test + v4.1 substrate (live demo click blocked by a pre-existing dev-host limitation, user-accepted)
**Date:** 2026-06-30

## GFAI-01 — Move hint (FULLY VERIFIED LIVE, Claude Code Chrome extension, `boardsmith dev` host)

- Drove the learner seat (Follow active seat), opened ControlsMenu → "Get a hint".
- The MCTS bot suggested **Aces**; a teal ring + "Suggested move" bubble anchored **exactly to the A♦ card-group** in the learner's OWN hand — NOT a board cell, NOT a floating unanchored bubble.
- **DOM-confirmed:** the rank `card-group` divs emit `data-bs-el-name` = Q, A, 3, 9, 10 (the Phase 113-01 `anchorAttrs({ name: rank })` binding). The hint resolved `{ name: 'A' }` → `[data-bs-el-name="A"]` → the Ace group; ring box (434,141 84×114) wraps the A group (437,144 78×108).
- **R-06 confirmed:** completing the suggested ask cleared the hint ring on that action. The successful ask also kept it the learner's turn (turn-continuation bonus, log: "Player 1 got 1 A(s) from Player 2!").

## GFAI-02 — Narrated AI-vs-AI demo (TEST-PROVEN; live click blocked by dev-host quirk, user-accepted)

- **Proven by the honest integration test (113-02):** the demo loop narrates the move at a broadcast index STRICTLY earlier than the executed-state broadcast; narrated args === executed args (`{ target:2, rank:'7' }`); after `demoStop`, `isDemoRunning === false`, narration cleared, and `vi.getTimerCount() === 0` (no orphaned timers/state).
- The demo machinery is unchanged v4.1 substrate (`runDemoLoop` / `demoStart`/`demoStop` / `onBeforeMove` narration), already browser-verified for checkers in v4.1 (DEMO-01, Phase 110). Phase 113 added ZERO demo runtime code — only the test.
- **Live "Watch AI demo" click could not be exercised this session.** Root cause: the ControlsMenu teaching group (Get a hint / Watch AI demo / Show move quality) is gated by `GameShell.showHintProp` = true only when an AI seat is present (production: `lobbyInfo.slots.some(s => s.aiLevel != null)`; dev host: `state.hasAIPlayers`). To drive the learner for the hint I used "Follow active seat", which converts the active AI seat into a human-driven seat — removing the AI presence the demo entry requires — and the dev-host "Create Game" flow was too flaky this session to start a clean AI-seat-only game. This is the pre-existing `dev-host-ai-open-seat-not-auto-playing` carry-forward quirk (a dev-host tooling/gating limitation), NOT a Phase 113 defect. User accepted GFAI-02 on the test + v4.1-substrate evidence.

## Requirements

- **GFAI-01** — hint highlights the suggested ask's target on cards/hand (not a board cell): **MET (live)**.
- **GFAI-02** — narrated AI-vs-AI demo announces each move before it executes; stops clean: **MET (integration test + v4.1 DEMO-01 substrate; live dev-host click deferred due to a pre-existing tooling quirk)**.

## Notes for the milestone audit / Phase 115 docs

- The Phase 112 `anchorAttrs` fix + the Phase 113 rank-group anchor together make the go-fish hint highlight cards — the card-game parity the milestone set out to prove (board square `notation` → card-group `name`). Both the tutorial overlay and the hint overlay resolve via the SAME `data-bs-el-*`/`buildSelector` path.
- Dev-host AI-seat detection vs "Follow active seat" is in tension for solo agent testing of the demo: driving a seat removes it from the AI pool. Candidate dev-tooling improvement (separate from this milestone); track against the existing `dev-host-ai-open-seat-not-auto-playing` todo.
- Dev server killed after verification (CLAUDE.md hard rule); port 5173 free.
