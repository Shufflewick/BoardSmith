---
created: 2026-06-23
title: Dev-host AI (open seat) does not auto-take its turn in a fresh dev session
area: dev-host AI scheduling / follow-active-seat
severity: medium
files:
  - src/session/ai-controller.ts
  - src/session/game-session.ts
  - src/cli/dev-host/DevHost.vue
---

## Problem

In `boardsmith dev`, after joining the open game as seat 2, the AI in the open
seat 1 ("Player 1 is playing") never takes its turn — observed across hex,
go-fish, and checkers (each freshly launched) during v4.0 Phase 103 browser
verification. The game stays stuck on the AI's turn; no client console errors and
no server-side log activity. This blocks playing a full game (and blocked live
two-step/drag human-move testing in the browser).

## Not a v4.0 regression

The server-side AI/session/CLI-host code is UNCHANGED in the v4.0 UI milestone
(`git diff fbdf368..HEAD -- src/session src/ai src/runtime` shows no AI-scheduling
changes; only `DevHost.vue` — the WS *client* — and tests changed). The
authoritative session host + AI run in the Node CLI process, which a client-side
DevHost.vue change cannot stop. So this is pre-existing dev-host behavior, not
caused by the redesign.

## Likely cause (to investigate)

Project memory notes a "follow active seat" dev toggle that **pauses AI** so one
client drives whichever seat is active (`[[follow-active-seat]]`). The dev host
may be defaulting into (or not clearing) an AI-paused/follow state for open seats,
so the AI never schedules. Check the dev host's AI-kickoff path for open seats and
the follow-mode default.

## Impact

Live multiplayer-vs-AI play via `boardsmith dev` doesn't progress past the AI's
turn. Game logic + AI themselves are fine (all 8 games' suites + MERC's 738 AI
tests pass); this is specifically the dev-host scheduling/trigger.
