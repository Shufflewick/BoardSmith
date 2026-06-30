---
phase: 95-ship-reframe
plan: 04
type: execute
status: complete
requirements: [SHIP-03]
completed: 2026-06-22
---

# Plan 95-04 Summary — Browser Playability Gate (SHIP-03)

**Result: PASSED** — a freshly scaffolded game opens single-UI and is playable
end-to-end via the auto-UI with zero custom code.

## What was verified (Claude Code Chrome extension)

1. `boardsmith init smoke-95` → `npm install` → `boardsmith dev` (dev repo runs
   the CLI from `src/` via tsx, so the Phase 95 scaffold changes were live).
2. **Single UI, no split-screen** (SHIP-03 #3): the generated `src/ui/App.vue`
   imports exactly one UI (`GameShell, AutoUI`) — no `GameTable` import, no
   `board-comparison` grid, no "Custom UI / Auto-Generated UI" panels. Confirmed
   both statically (file inspection) and visually (lobby + board render a single
   surface).
3. **Playable via auto-UI** (SHIP-03 #4): took a seat; the auto-UI rendered the
   deck (face-down), both hands (active seat face-up, opponent face-down —
   correct per-seat visibility), score panels, and the `play` action choices in
   the footer ActionPanel. Drove multiple full turn cycles via "Follow active
   seat": `draw` auto-executed (lone action), `play` presented card choices,
   selections executed, `eachPlayer` rotation advanced the active seat, and the
   deck depleted (41 → 40 → 39). Zero custom UI code involved.
4. **boardsmith.json** contains `"ui": "auto"`; the custom-UI stub
   `src/ui/components/GameTable.vue` exists but is **not** mounted.
5. Dev server stopped; throwaway game and temp scripts deleted.

## Deviation — pre-existing scaffold crash fixed to unblock the gate

The first browser run surfaced a **blocker** unrelated to the planned Phase 95
UI-reframe scope: a freshly scaffolded game crashed on construction with
`Cannot read properties of undefined (reading '_t')`, so the dev lobby showed an
error and no game could start.

- **Prove-Before-Fix:** reproduced headlessly → full stack: `game.ts` deal loop
  → `card.putInto(hand)` → `piece.ts` `destination._t` with `destination`
  undefined. `getPlayerHand()` returned undefined because the player's `Hand`
  was created in the **Player constructor** (which the engine runs during
  `super()`, before the game body calls `registerElements([Card, Hand, Deck])`),
  leaving the Hand unregistered and unfindable.
- **Root cause scope:** the bug is in the scaffold's generated game-rules
  template (`generateGameTs` in `src/cli/commands/init.ts`), which Phase 95's
  plans never touched. It was pre-existing; no construction test ever exercised
  the scaffold template (`runner.test.ts` uses a hand-written game that already
  creates hands in the body), so the divergence went unnoticed.
- **Fix:** create player hands in the game body after `registerElements`,
  iterating `this.players` — mirroring the working reference games (Cribbage,
  game.ts:186). Removed hand creation from the Player constructor. Exported
  `generateGameTs` and added `src/cli/commands/init.test.ts` (3 tests) pinning
  the pattern.
- **Re-verified** end-to-end in the browser after re-scaffolding (above).
- Commit: `fix(95-04): scaffolded game creates player hands after registerElements`.

This fix is properly part of SHIP-03 — "a freshly scaffolded game opens in its
chosen UI and is playable" cannot be true if the scaffold crashes on construction.

## Non-blocking observations (out of scope; pre-existing, in the demo game)

- **Game History panel** stays "No activity yet" during play. Expected for
  actions that mutate plain properties/elements without command history
  (matches the known BoardSmith note that `commandHistory` may be empty).
- **Score stat** displays `0` after `play` actions despite `player.score += 1`.
  A projection gap in the placeholder demo game's score → player-view mapping;
  not the scaffold-UI structure changed by Phase 95, and not a 95-04 gate
  criterion. Worth a follow-up against the scaffold's demo rules.

## Files

- Modified: `src/cli/commands/init.ts` (scaffold game-rules template fix + export)
- Created: `src/cli/commands/init.test.ts` (regression guard, 3 tests)
- No production app code changed for the verification itself (browser smoke only).

## Test state

`npm test -- --run src/cli` → 51 passed (incl. new init regression tests and the
SHIP-02 tree-shaking proof).
