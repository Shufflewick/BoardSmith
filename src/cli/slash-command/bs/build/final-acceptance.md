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

## Never Override an Explicit Client Instruction

When the client has directed a design choice, the agent does not silently overrule it on its own
design judgment — not here, not anywhere in the pipeline. Findings triage (below) can propose a
fix, defer it, or refute it on the merits, but it never routes around or reverses something the
client explicitly instructed. If a finding conflicts with an explicit prior client instruction,
that conflict is reported back to the client as its own finding, not resolved unilaterally.

## Findings Destination

Route every finding — from the dispatched agent's five checks or the human's two narrated
checks — through the same fix-or-refute loop `build/repair.md` already governs, appended to
CHUNK.md's `## Findings Ledger` (cite `build/design-review.md`'s "Findings Destination" for the
shape: same `{ findingId, lens, description, citation, severity }` fields and the same
`fixed` / `deferred` / `refuted` disposition), keyed to this final-acceptance chunk's own
CHUNK.md rather than any earlier chunk's. This is not a separate ledger and not a separate repair
track.

## Sub-Step Resumability and the Handoff Seam Before `playtest`

The `final-acceptance` content step above (coverage check + 7-point design-QA pass) is by far the
heaviest single step in the skill — a coverage check, a fresh-context agent dispatch (serve →
capture → kill across 3 breakpoints × 2 themes + end-to-end keyboard drag-drop), two human-narrated
checks (VoiceOver + colorblind), and a fix-or-refute repair loop. The final-acceptance chunk
therefore carries an **extra** handoff seam that ordinary chunks do not, between `final-acceptance`
and `playtest`. Under the current stopping policy (`state-machine.md` "Session Handoff Seams") that
seam is a **resume checkpoint, not a mandatory stop**: if context holds, the same session flows from
`final-acceptance` straight into the `{playtest, revise, close}` gate and stops at the human
`playtest` gate that follows, exactly like any other chunk. The seam earns its "extra" status
because `final-acceptance` is the heaviest step and thus the likeliest place a harness context-low
warning fires; its sub-parts persist individually (below) so that if the session does yield here, a
resume re-enters mid-pass rather than re-dispatching the whole step.

**Persist sub-parts as they land**, so a mid-pass crash resumes mid-pass rather than re-running the
whole step from scratch (mirrors the per-round persistence `## Redteam Rounds` / `## Findings
Ledger` / `## Revision Rounds` gives every other heavyweight step):

- The coverage-check result — each uncovered non-variant slice, or "complete" — is recorded in
  CHUNK.md before the 7-point pass starts.
- Every agent-dispatch finding lands in `## Findings Ledger` (with its stable `F<n>` id and
  disposition) as it is triaged, before the human-narrated checks run — a crash after the dispatch
  never re-dispatches the serve/capture/kill agent.
- Each human-narrated check (VoiceOver, colorblind) is recorded as it completes, so a crash after
  the agent dispatch but before or between the human checks resumes at the first unrecorded human
  check rather than re-asking the human for checks already done.

The `final-acceptance` content-step Step Checklist item is checked off **only** once all of the
above have landed; until then a resume re-enters this step and continues from the first unrecorded
sub-part, never from the top.

## Downstream Shape (cite, never restate)

Once the coverage check and all seven design-QA points are triaged (fixed, deferred, or
refuted), this chunk still runs the standard `{playtest, revise, close}` semantics on top of this
content — the human plays the finished game start-to-finish as this chunk's own playtest script,
any issues route to `build/revise.md`, and `build/close.md` closes it exactly like any other
chunk. This file does not restate that group's structure.

## Game-Complete Banner + Summary Card (SKILLAUTO-07)

Once THIS chunk (the sketch's one mandated `final-acceptance` chunk) reaches `close` — every
finding on its Findings Ledger triaged, the human's start-to-finish playtest confirmed clean, and
`Status: verified`/`verified (user-waived)` written — the GAME itself is done, not just a chunk.
That terminus gets a **loud, unambiguous** completion output, never buried in the routine
close-out narration `build/close.md` already produces for every other chunk. Emit it as its own
visually-distinct block, delimited top and bottom so it cannot be mistaken for ordinary
progress narration:

```
================================================================
 GAME COMPLETE
================================================================
```

Immediately beneath the banner, emit a **summary card** with exactly three named fields — do not
add unrelated fields to this card, and do not omit one because it is empty (an empty field is
still reported, e.g. "Deferred: none"):

- **Shipped** — the ordered list of chunks/behaviors that reached `verified` (or
  `verified (user-waived)`), read from SKETCH.md's `## Ordered Chunk List`.
- **Test count** — the accumulated automated-suite total (unit + sim/self-playtest) across every
  chunk, as last reported by `build/test.md`'s own run.
- **Deferred** — every item any chunk's `## Revision Rounds` disposed as "future scope," every
  `## Findings Ledger` entry disposed as "deferred," and every waived
  (`verified (user-waived)`) chunk, named by slug — the ideas-backlog the human still owns.

This banner + card is emitted exactly once, at this chunk's `close`, and is additional to — never
a replacement for — the ordinary bookkeeping `build/close.md` "Bookkeeping Sequence" performs for
every chunk including this one. Field layout and exact wording are at the author's discretion,
consistent with the skill's voice, so long as the banner is visually loud and the three named
fields (shipped / test count / deferred) are all present.

That voice is `reporting.md`'s: **Shipped** lists what a player can now do, not chunk slugs;
**Deferred** lists what the game still doesn't do, in the same terms, so the designer can decide
what comes next. The test count is the one bare number this card carries. Nothing else about the
build belongs here.
