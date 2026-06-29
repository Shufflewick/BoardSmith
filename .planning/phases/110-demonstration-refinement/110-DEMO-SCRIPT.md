---
phase: 110-demonstration-refinement
type: demo-script
status: ready
created: 2026-06-29
---

# Phase 110 — Teaching Features Demo Script

**Purpose:** Walk all five teaching beats in the checkers dev host — in BOTH the custom
checkers UI and AutoUI — and capture every friction point or refinement request
into `110-REFINEMENTS.md`.

This is a **refinement checkpoint**, not a sign-off. Note what feels wrong, unclear,
slow, or missing; larger requests are backlog for the cribbage (v2 CRIB) milestone.

---

## Launch

```
cd ~/BoardSmithGames/checkers
npx boardsmith dev --ai 2
```

Open **http://localhost:5173** in Chrome.

Expected startup output (no errors):
```
Dev host running on http://localhost:5173
Seats: 2 (open seats play as AI; --ai 2 pre-marked, level medium).
Ready! Press Ctrl+C to stop.
```

**Which seat to use:** Click the **Seat 1** button in the dev host header bar. You are
Player 1 (Red). Seat 2 is the AI opponent. The dev host shows a seat selector at the
top; if "Follow active seat" is on, turn it off so you stay in Seat 1.

**Which UI to start on:** Leave it on **Custom UI** for rounds 1–5 below. You will
switch to **AutoUI** for round 6.

---

## Beat 1 — Checkers Tutorial (Custom UI)

> Full end-to-end walk of all four tutorial steps: guided selection + destination
> gating, mandatory-capture tip, forced multi-jump continuation, and completion.

**Control location:** Controls menu (hamburger "≡" or gear icon in the game frame) →
**Tutorial** section → **Start tutorial** button.

### Steps

- [ ] **1a.** Open Controls → Tutorial → click **Start tutorial**.
      Expected: The board enters tutorial mode. A tutorial overlay appears with the
      first instruction message ("Select this piece" or similar). AI turns do not
      fire while the tutorial runs.

- [ ] **1b. Guided two-step move — piece selection.**
      Expected: Only the indicated piece is selectable. Clicking the wrong piece is
      blocked (the gate fires) — a visual/text cue explains why. The correct piece
      shows a selection indicator.

- [ ] **1c. Guided two-step move — destination selection.**
      Expected: After selecting the correct piece, only valid destination squares are
      reachable. Wrong destinations are blocked (gate + overlay annotation). Moving
      to the correct destination advances the tutorial to step 2.

- [ ] **1d. Mandatory-capture tip (CHK-02 predicate beat).**
      Expected: When the position first forces a capture, a tip overlay appears
      ("You must capture when possible" or similar). This fires automatically when
      the game predicate is satisfied — no button press required.

- [ ] **1e. Forced multi-jump continuation (CHK-03 beat).**
      Expected: After making a capturing move, if further jumps are available,
      End Turn is blocked and the piece stays selected. The tutorial message directs
      you to continue jumping. The turn does not end until all available jumps are
      taken.

- [ ] **1f. Tutorial completion.**
      Expected: After the final step, a completion message or overlay appears
      and the game returns to normal play (gating lifts, AI resumes if applicable).

**Record friction here or in 110-REFINEMENTS.md.**

---

## Beat 2 — AI Move Hint (Custom UI)

> The AI engine suggests a move; the destination square highlights on the board.

**Control location:** Controls menu → **Teaching** section → **Get move hint** button
(only visible when AI opponents are present — `--ai 2` enables this).

### Steps

- [ ] **2a.** It is your turn (Player 1). Open Controls → Teaching → click
      **Get move hint**.
      Expected: A "Suggested move" annotation appears. The destination square on the
      board highlights with an overlay (not just a floating bubble).

- [ ] **2b.** Make any move (or the hinted move).
      Expected: The hint annotation clears automatically after you act.

- [ ] **2c.** (Optional) Request a second hint to confirm it works on subsequent turns.

**Record friction.**

---

## Beat 3 — AI-vs-AI Narrated Demo (Custom UI)

> Both seats play as AI. Each move is narrated in text before it executes at a
> readable pace. Stop halts the loop cleanly.

**Control location:** Controls menu → **Teaching** section → **Start AI demo** button.

### Steps

- [ ] **3a.** Open Controls → Teaching → click **Start AI demo**.
      Expected: A narration bar appears (or an overlay message) announcing the first
      move before it executes, e.g. "Player 1: move piece e3 → f4". A short pause
      (roughly 1–2 seconds) precedes the move executing on the board.

- [ ] **3b.** Observe at least 3 moves.
      Expected: Each move is announced before it plays. The board updates after the
      announcement delay. The pace is human-readable (not instant).

- [ ] **3c.** Click **Stop AI demo** (same control, toggled).
      Expected: The demo halts after the current move completes (or immediately).
      No further moves execute. The narration clears. Normal play resumes.

- [ ] **3d.** Confirm no runaway after stop.
      Expected: After clicking Stop, no additional moves appear. Waiting 5 seconds
      produces no further board changes.

**Record friction.**

---

## Beat 4 — Evaluation Heatmap (Custom UI)

> Per-cell intensity overlay showing the AI's board evaluation for candidate cells,
> with a badge on the best move.

**Control location:** Controls menu → **Teaching** section → **Evaluation heatmap**
toggle (checkbox or button).

### Steps

- [ ] **4a.** On your turn, open Controls → Teaching → toggle **Evaluation heatmap**
      ON.
      Expected: Cells on the board receive an intensity shading (color or opacity
      gradient) reflecting the AI's evaluation. The best candidate cell shows a
      numeric badge or "best" indicator.

- [ ] **4b.** Inspect the heatmap.
      Expected: Multiple cells are shaded (not just one). Higher-value cells are more
      intense. Exactly one cell has the "best" badge. Values are visually distinct.

- [ ] **4c.** Toggle **Evaluation heatmap** OFF.
      Expected: The cell shading and badge disappear. The board returns to normal.

- [ ] **4d.** Make a move. Toggle heatmap back ON.
      Expected: The heatmap re-computes for the new position (new cells highlighted).

**Record friction.**

---

## Beat 5 — Action Help (Custom UI)

> Hover or tap the "?" on an action affordance to reveal a help popover. The global
> toggle in Controls persists across actions and page reloads.

**Control location for global toggle:** Controls menu → **Interface** (or top-level)
section → **Show action help** checkbox.

**Control location for per-action "?":** The "?" affordance appears next to each
available action in the action panel (the move actions shown on your turn).

### Steps

- [ ] **5a.** On your turn, hover over a move action's "?" affordance (pointer/mouse).
      Expected: A help popover appears explaining that action. It disappears when
      you move the cursor away.

- [ ] **5b.** (Touch/mobile simulation) Tap the "?" affordance.
      Expected: The popover toggles open on tap and closed on a second tap (or on
      tapping elsewhere).

- [ ] **5c.** Open Controls → Interface → uncheck **Show action help**.
      Expected: The "?" affordances disappear from all actions. The action panel
      shows actions without the help trigger.

- [ ] **5d.** Reload the browser tab.
      Expected: "Show action help" is still OFF after reload (persisted via
      localStorage key `boardsmith_action_help`).

- [ ] **5e.** Re-enable **Show action help** in Controls.
      Expected: The "?" affordances return. Reload again to confirm ON state persists.

**Record friction.**

---

## Beat 6 — Repeat All Beats in AutoUI

> Switch to AutoUI using the dev host's UI switcher, then repeat beats 1–5 to
> confirm parity.

**How to switch:** In the dev host header (the outer page, not inside the game frame),
find the **UI** dropdown or switcher control. Select **AutoUI** (the BoardSmith
auto-generated layout, not the custom checkers board).

**What to verify for parity:**
- The Teaching controls group is visible in AutoUI (same Controls menu, same buttons).
- Beat 1 (tutorial): overlays, gating, and the predicate-driven tip all fire in AutoUI.
- Beat 2 (hint): destination square highlights appear on AutoUI cells.
- Beat 3 (demo): narration and move animation are visible in AutoUI.
- Beat 4 (heatmap): per-cell intensity renders over AutoUI grid cells.
- Beat 5 (action help): "?" affordances appear on AutoUI action buttons.

### Steps

- [ ] **6a.** Switch to AutoUI. Confirm the Teaching controls group is visible
      in Controls menu.

- [ ] **6b.** Start tutorial → walk at least beats 1b–1e. Confirm overlays render
      over the AutoUI grid cells (not broken/misaligned).

- [ ] **6c.** Request an AI hint. Confirm the destination AutoUI cell highlights.

- [ ] **6d.** Start AI demo. Confirm narration appears and moves play out in AutoUI.
      Stop the demo.

- [ ] **6e.** Toggle evaluation heatmap on/off in AutoUI. Confirm cells are shaded.

- [ ] **6f.** Hover/tap a "?" in AutoUI. Confirm help popover appears.

**Record friction, especially any parity gaps between custom UI and AutoUI.**

---

## Refinement Capture

Record every friction point, confusing moment, broken behavior, and feature request
(no matter how small) in:

```
.planning/phases/110-demonstration-refinement/110-REFINEMENTS.md
```

Format suggestions:
- **Friction:** [what felt wrong or unclear]
- **Bug:** [what was broken]
- **Request:** [what you wished existed]
- **Parity gap:** [custom UI vs AutoUI difference]

Large requests (new features, major UX changes) are backlog for the cribbage (v2 CRIB)
milestone. Small friction that can be fixed in Phase 110 should be noted as such.

When complete, type **"approved"** (or describe what needs to be fixed/re-demo'd) to
close the DEMO-01 gate.

---

## Stop the Server When Done

```
Ctrl+C
```

Confirm the terminal shows "Shutting down..." before closing it.
