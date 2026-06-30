# Phase 114 Plan 03 — Summary

**Plan:** 114-03 — Browser verify: action help reveal (custom UI) + `--lock-teaching` gating (GFHELP-01, GFLOCK-01)
**Type:** checkpoint:human-verify
**Status:** Verified live — both requirements confirmed; no custom-UI gap (contingency fix NOT needed)
**Date:** 2026-06-30

## PART A — GFHELP-01: action help reveals in the custom action panel (VERIFIED LIVE)

- `boardsmith dev` (normal); drove the learner seat. "Show action help" appears in the ControlsMenu PLAY group and is ON by default — it renders because the `ask` action now carries help (`hasActionHelp` true).
- The substrate `ActionPanel` is mounted in go-fish (go-fish uses GameShell's default `#action-panel`, no slot override). At the action-**list** state (turn start / after cancelling the auto-started action), the "Ask another player for cards" button shows a **help "?" affordance** (`button.action-help-btn`, `aria-label="Help for Ask another player for cards"`) and the substrate **`action-help-popover`** (`role="tooltip"`) reveals the exact authored text: *"Ask an opponent for a rank you already hold. If they have it they give you all of them and you go again; if not, you draw from the pond (Go Fish!)."*
- **No custom-UI gap** — the 114-03 contingency fix to `GameTable.vue` was NOT needed; the substrate ActionPanel handles the reveal. (Note: go-fish's single `ask` action auto-starts into config mode, where the "?" lives on the action-list button rather than the config header — the help is reachable at the action-list state, the substrate's normal placement.)

## PART B — GFLOCK-01: host lockout gates teaching, keeps action help (VERIFIED LIVE)

- `boardsmith dev --lock-teaching` (server logged "Teaching lockout active (--lock-teaching): hint, heatmap, demo, and tutorial are disabled."). Drove the learner seat (so an action with help is available).
- **DOM-confirmed under lockout:** `hasGetHint: false`, `hasWatchDemo: false`, `hasShowMoveQuality: false`, `hasStartTutorial: false` — the entire Teaching group (hint, AI-demo, heatmap toggle, tutorial) is HIDDEN. The ControlsMenu shows: Auto end turn, **Show action help**, Undo last action, New game, Leave game.
- **`hasShowActionHelp: true`** — action help stays enabled under the lockout (it is not a teaching affordance, D-06).
- The fail-loud op rejection (requestHint/startDemo/startTutorial throw the exact lockout error) is proven at the unit level in 114-02 (the UI hides the affordances so they can't be invoked; the server would reject them regardless).

## Requirements

- **GFHELP-01** — each go-fish action has author help revealed on hover/tap via the global toggle: **MET (live)**. The single `ask` action carries help; the "?" + popover reveal it; the "Show action help" toggle gates it.
- **GFLOCK-01** — `teachingDisabled` gates hint/demo/tutorial (hidden + ops rejected) while action help stays enabled: **MET (live + unit test 114-02)**.

## Notes

- The heatmap "Show move quality" toggle quirk (shows for gridless go-fish when UNLOCKED) is correctly HIDDEN when locked — GFLOCK is satisfied. The unlocked-visibility quirk remains a pre-existing substrate cosmetic item (gated on `showHint`, not `hasBoard`); noted for DOC-03 / a future fix, out of scope here.
- Dev server killed after each run (CLAUDE.md hard rule); port 5173 free.
