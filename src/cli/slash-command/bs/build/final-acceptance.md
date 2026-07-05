# Final Acceptance — Coverage Check + 7-Point Design-QA Pass (UIQ-05)

The sketch's `## Mandated Chunks` require a final-acceptance chunk: the full game played
start-to-finish, a coverage check confirming every non-variant rulebook slice was built, plus the
design-QA/a11y audit. This is a special sketch chunk, not a per-chunk step — the same
`{playtest, revise, close}` step group (`state-machine.md` "Session Handoff Seams") still applies
to it once its own content below is done, but its content is this file's coverage check and
7-point design-QA pass, not an ordinary chunk's Interpretation/build/test cycle. "Done" for the
whole sketch means this chunk closes clean, not just that every other chunk is individually
`verified`.

## Coverage Check

Read SKETCH.md's `## Ordered Chunk List` and every closed chunk's `chunks/<slug>/CHUNK.md`
`## Interpretation` citations. Confirm every **non-variant** rulebook slice (per INDEX.md /
`## Variants (deferred)` in SKETCH.md — variant rules are deliberately out of scope, never
silently required here) is cited by at least one closed chunk's Interpretation. Any rulebook
slice with no citing chunk is a gap: report it to the user as a concrete finding (which slice,
which section) rather than silently passing final acceptance. This coverage check is part of
what "done" means for the sketch — a sketch cannot pass final acceptance with an uncovered
non-variant slice.

## The 7-Point Design-QA Pass (UIQ-05)

In canonical enumeration order:

1. **Screen-reader playthrough — HUMAN-narrated.** The user runs VoiceOver themselves and plays
   through the game. This exercises Phase 140's `useAnnouncer()` floor — every `announce()` call
   the game's chunks made along the way is the a11y surface this playthrough is verifying reaches
   the screen reader correctly. This step is never dispatched to an agent; a screen reader session
   requires a human ear, per `state-machine.md`'s human-gate discipline (mirrors `playtest.md`'s
   own no-subagent shape).

2. **200% zoom.** Confirm the UI remains usable and nothing clips, overlaps, or becomes
   unreachable at 200% browser zoom.

3. **Compact touch targets.** At the `compact` breakpoint tier, confirm every interactive control
   meets the minimum touch-target size and nothing is too small or too close to a neighboring
   control to hit reliably on a real touch screen.

4. **Colorblind pass on game-added colors.** Any color this game's chunks introduced beyond the
   Slate token system (piece colors, player colors, custom status indicators) is checked under a
   colorblind simulation for cues that colorblind players would miss.

5. **Both Slate themes.** Confirm the UI holds up in both light and dark Slate themes — no
   invisible text, no lost contrast, no theme-only regression.

6. **Drag-drop keyboard alternates end-to-end.** Verify every drag-drop action in the game has a
   working keyboard alternate, completable start to finish with no pointer/drag gesture at all.
   This reuses `build/test.md` item 1's ActionPanel keyboard-only completion pattern (see
   `build/test.md` "The A11y Floor — All Five Items", item 1) rather than re-deriving a new
   keyboard-testing approach here: the same keyboard-only completion run that per-chunk `test`
   already exercises for that chunk's own actions is run here end-to-end across every drag-drop
   action the finished game contains, confirming none of them regressed to pointer-only across
   the whole build.

7. **Mobile layout via iframe-shrink.** Shrink the GameShell iframe element's width via JS in the
   page context (not the whole browser window) to reproduce the mobile breakpoint, and confirm the
   layout holds up — this is the project's own established technique for repro'ing the mobile
   breakpoint without shrinking the whole dev-host window (see `CLAUDE.md` "`boardsmith dev` host
   (CLI)").

## Automated Portion vs. Human-Narrated Portion

Split the seven checks across an agent-dispatched portion and a human-narrated portion
(146-RESEARCH.md Open Question 1's recommendation; Claude's Discretion per 146-CONTEXT.md — the
split is documented here rather than left implicit):

- **Agent-dispatched (checks 2, 3, 5, 6, 7):** a single fresh-context Task-tool dispatch handles
  every check that is a screenshot, measurement, or scripted-completion check — 200% zoom, compact
  touch targets, both themes, drag-drop keyboard alternates end-to-end, and mobile layout via
  iframe-shrink. This reuses `build/design-review.md`'s "Single Fresh-Context Adversarial
  Dispatch" and "Dev-Host Lifecycle: Serve → Capture → Kill" verbatim — same independence
  discipline (a SEPARATE dispatch with no inherited conversation, and it NEVER reads CHUNK.md's
  `## Interpretation` or any prior framing, even though this is the "final" pass; being last in
  the pipeline is not a reason to relax that discipline), same serve/capture/kill sequence, same
  breakpoint table.
- **Human-narrated (checks 1, 4):** the screen-reader playthrough (VoiceOver) and the colorblind
  judgment stay outside the dispatch template, performed and reported by the human directly — a
  screen reader and colorblind perception are not things an agent dispatch can substitute for.

### Dispatch Template

Fill the `{...}` slots and hand this to the Task-tool dispatch verbatim — never synthesize an
ad-hoc prompt from this prose, which risks dropping the independence framing:

```
You are the FINAL-ACCEPTANCE design-QA lens auditing the fully-built UI for {gameName}. This is a
SEPARATE dispatch with NO inherited conversation: do NOT read the orchestrator's running
conversation, any prior agent's framing, or any chunk's CHUNK.md "## Interpretation" — this is the
LAST pass in the pipeline, not a reason to relax that discipline.

Read fresh: DESIGN.md (its "## Theme Block", "## Component Recipes", and "## Do / Don't"
sections) and the finished game's UI code.

Serve → capture → kill: start the dev host with `npx boardsmith dev --no-open`, wait for the
exact string `Ready! Press Ctrl+C to stop.` (never `networkidle` — the dev host holds an open
WebSocket connection and never reaches network idle), then run these five checks, and kill the
dev server as an explicit numbered step before returning:

1. 200% zoom — usable, nothing clips or becomes unreachable.
2. Compact touch targets — at the `compact` breakpoint tier, every interactive control meets the
   minimum touch-target size.
3. Both Slate themes — set `iframe.contentDocument.documentElement.dataset.theme` to `'light'`
   then `'dark'` and confirm no invisible text or lost contrast in either.
4. Drag-drop keyboard alternates end-to-end — using `build/test.md` item 1's ActionPanel
   keyboard-only completion pattern (keyboard events only, no pointer/click simulation), complete
   every drag-drop action in the finished game and confirm each has a working keyboard alternate.
5. Mobile layout via iframe-shrink — shrink the GameShell iframe element's width via JS in the
   page context (never the whole browser window) to reproduce the mobile breakpoint, and confirm
   the layout holds up.

Capture at representative widths inside each of the 3 tiers, citing `src/ui/theme.ts`'s
BREAKPOINTS by name and value (compact: 640, medium: 1024, wide: 1440) — capture at 375 (compact),
800 (medium), and 1440 (wide), per `build/design-review.md`'s existing tier table.

Return exactly: a list of { findingId, lens: 'final-acceptance', description, citation, severity }
— one entry per defect found (empty array if none), same stable-ID shape (F1, F2, ...) the other
lenses use.
```

## Findings Destination

Route every finding — from the dispatched agent's five checks or the human's two narrated
checks — through the same fix-or-refute loop `build/repair.md` already governs, appended to
CHUNK.md's `## Findings Ledger` (cite `build/design-review.md`'s "Findings Destination" for the
shape: same `{ findingId, lens, description, citation, severity }` fields and the same
`fixed` / `deferred` / `refuted` disposition), keyed to this final-acceptance chunk's own
CHUNK.md rather than any earlier chunk's. This is not a separate ledger and not a separate repair
track.

## Downstream Shape (cite, never restate)

Once the coverage check and all seven design-QA points are triaged (fixed, deferred, or
refuted), this chunk still runs the standard `{playtest, revise, close}` semantics on top of this
content — the human plays the finished game start-to-finish as this chunk's own playtest script,
any issues route to `build/revise.md`, and `build/close.md` closes it exactly like any other
chunk. This file does not restate that group's structure.
