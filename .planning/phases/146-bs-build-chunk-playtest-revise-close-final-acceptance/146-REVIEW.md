---
phase: 146-bs-build-chunk-playtest-revise-close-final-acceptance
reviewed: 2026-07-04T20:20:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/cli/slash-command/bs/build/playtest.md
  - src/cli/slash-command/bs/build/revise.md
  - src/cli/slash-command/bs/build/close.md
  - src/cli/slash-command/bs/build/final-acceptance.md
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build-chunk.test.ts
  - src/cli/slash-command/bs/templates/CHUNK.template.md
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 146: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-04T20:20:00Z
**Depth:** standard
**Files Reviewed:** 7 (+ cross-referenced `state-machine.md`, `templates/SKETCH.template.md`)
**Status:** issues_found

## Summary

Re-review after the CR-01/CR-02/CR-03/WR-01..04 fixes (552cc863..85bfe9c3). The drift-protection
suite is fully green (106/106). CR-02 (on-top-of vs in-place-of) and CR-03 (light-path 3-item
sequence, false sketch-tail citation removed) are genuinely resolved and now agree across
`build-chunk.md`, `final-acceptance.md`, `close.md`, and `playtest.md`. The full-ceremony and
light-path lifecycles trace cleanly end-to-end.

However, walking the **final-acceptance chunk** lifecycle again with the CR-01 router prose in
place surfaces that the fix is **incomplete in its most common scenario**. The CR-01 fix added the
*detection* prose (Step 2 "Final-acceptance chunk target" + Step Group 4 content dispatch), but it
did not add any *author* for the special `[final-acceptance, playtest, revise, close]` Step
Checklist it routes against, and it did not reconcile that detection with the "Sketch-level
tail-entry target" paragraph that sits directly above it. Because the final-acceptance chunk is
always the last Ordered-Chunk-List entry, it is a sketch-level tail entry (no CHUNK.md) until
routing first reaches it — so on the cold resume the CR-01 fix explicitly names as its motivating
case, the lazy-detailing path pre-empts the special routing and runs the chunk as an ordinary
`investigate`-first chunk. Details in CR-01 below.

## Critical Issues

### CR-01: Final-acceptance chunk's special 4-item checklist has no author, and the lazy-detailing path pre-empts final-acceptance detection

**File:** `src/cli/slash-command/bs/build-chunk.md:80-115` (with `templates/CHUNK.template.md:37-63`, `templates/SKETCH.template.md:93-101`, `build/close.md:56-99`)

**Issue:**
The final-acceptance chunk is a normal entry in SKETCH.md's `## Ordered Chunk List` (SKETCH.template.md's
`## Mandated Chunks` only *requires that one exist* — it is not a separate list). Being the "full game
played start-to-finish" it is always the **last** entry, so it lives in the sketch tail and carries
`Status: proposed (sketch-level — no CHUNK.md yet)` with no `chunks/<slug>/` directory until routing
first reaches it. That means on the resume where routing lands on the final-acceptance chunk, **two**
Step 2 paragraphs both apply, and they give contradictory instructions with no stated precedence:

1. **"Sketch-level tail-entry target"** (lines 80-92) fires for *any* tail entry with no CHUNK.md:
   "create `chunks/<slug>/`, derive the chunk's CHUNK.md by filling `templates/CHUNK.template.md` …
   **and only then route to `investigate` as the first incomplete step.**" This is unconditional —
   it has no carve-out for the final-acceptance chunk.
2. **"Final-acceptance chunk target"** (lines 94-115) says the chunk's checklist is
   `[final-acceptance, playtest, revise, close]`, "Route to the **first incomplete item** … if
   `final-acceptance` is unchecked, dispatch `build/final-acceptance.md`," and claims this is
   "what makes a cold session that resumes directly into the final-acceptance chunk dispatch
   `build/final-acceptance.md` instead of running it as an ordinary checklist chunk."

Paragraph 1 wins mechanically: it tells the router to fill `CHUNK.template.md` and route to
`investigate`. And nothing anywhere ever writes the special 4-item checklist into a CHUNK.md:

- `CHUNK.template.md`'s CEREMONY-CONDITIONAL rule (lines 43-52) permits **only** the 10-item `full`
  or 3-item `light` checklist — there is no third variant, and no `final-acceptance` item.
- The lazy-detailing path fills that template as-is, producing a `full`/`light` checklist.
- `close.md` never creates a next-chunk CHUNK.md at all (see WR-02), so it cannot write the special
  checklist either.

So `build/final-acceptance.md`'s "route to the first incomplete item" reads a *physical* checklist
that begins with `investigate` (or `build` on light), not `final-acceptance` — and dispatches
`investigate`. The finished game gets run through a fresh `investigate/redteam/ask/build/test/…`
cycle instead of the coverage-check + 7-point design-QA pass. The CR-01 detection prose is defeated
in exactly the cold-resume case it was written to protect.

**Fix:** Give the final-acceptance chunk's checklist an explicit author and precedence:
1. In Step 2, make the "Final-acceptance chunk target" check run **before** the "Sketch-level
   tail-entry target" path, or add a carve-out to the tail-entry path: "unless this tail entry is
   the sketch's mandated final-acceptance chunk — in that case detail it per the Final-acceptance
   chunk target rule below, not from the plain template."
2. Make the detailing step **procedural**: "when the final-acceptance chunk is first detailed,
   write its `## Step Checklist` as exactly `- [ ] final-acceptance / - [ ] playtest / - [ ] revise
   / - [ ] close` (NOT the template's full/light list)."
3. Add a third permitted checklist variant to `CHUNK.template.md`'s CEREMONY-CONDITIONAL block (or a
   dedicated final-acceptance template stanza) so the physical file the router reads can legitimately
   contain the 4-item checklist and the persistence/check-off discipline works against it.
4. Pin all four with a new drift assertion (e.g. build-chunk.md's tail-entry paragraph names the
   final-acceptance exception; CHUNK.template.md documents the 4-item variant).

## Warnings

### WR-01: `## Ceremony` field is undefined for the final-acceptance chunk, and Step 3 ceremony routing has no carve-out for it

**File:** `src/cli/slash-command/bs/build-chunk.md:125-137` (with `templates/CHUNK.template.md:29-35`)

**Issue:** Every CHUNK.md must carry `## Ceremony: full | light` (CHUNK.template.md:34-35), and Step
3 "Ceremony Routing" reads that field and quotes the full (10-step) or light (3-step) list verbatim
with no third branch. The final-acceptance chunk is neither `full` nor `light` — its steps are
`[final-acceptance, playtest, revise, close]`. Step 2 says it "does NOT route against the plain
`full` or `light` Step Checklist," but Step 3 unconditionally does ceremony routing over exactly
those two lists. There is no instruction telling Step 3 to skip the final-acceptance chunk, and no
valid `## Ceremony` value for its CHUNK.md. This is the same root cause as CR-01 (the chunk doesn't
fit the two-ceremony template) surfacing at a second seam.

**Fix:** Either give the final-acceptance chunk an explicit sentinel ceremony value (e.g.
`## Ceremony: final-acceptance`) that Step 3 recognizes and routes past to the Step 2 special path,
or add a Step 3 carve-out: "the mandated final-acceptance chunk is exempt from full/light ceremony
routing — its step group is fixed by the Final-acceptance chunk target rule in Step 2."

### WR-02: `close.md` never creates the next chunk's CHUNK.md, contradicting build-chunk.md's claim that detailing is "the previous chunk's close-gate duty"

**File:** `src/cli/slash-command/bs/build/close.md:56-99` (contradicts `build-chunk.md:82-85`)

**Issue:** build-chunk.md:83 states "Detailing is normally the previous chunk's close-gate duty
(Phase 146), but when routing reaches an undetailed entry, this router details it lazily" — framing
lazy detailing as an exceptional fallback and close-gate detailing as the norm. But `close.md`
(Phase 146) contains no step that creates a `chunks/<slug>/` directory or CHUNK.md: its
`## Sketch-Tail Delta Gate` only re-derives tail *descriptions* (entries stay at
`Status: proposed (sketch-level — no CHUNK.md yet)`), and `## Propose the Next Chunk` only names the
next chunk and prints the next command. So in practice CHUNK.md creation is **always** lazy (Step 2),
never at close — the "normal" path build-chunk.md describes does not exist. An agent trusting
build-chunk.md may look for a close-gate detailing step that isn't there.

**Fix:** Either reword build-chunk.md:82-85 to state that detailing always happens lazily in Step 2
(close only re-derives tail descriptions and proposes the next chunk), or add an explicit
CHUNK.md-creation step to close.md so the "close-gate duty" claim is real. The former is simpler and
matches the files as written.

### WR-03: Final-acceptance chunk's step group is oversized and its content step is not sub-step resumable

**File:** `src/cli/slash-command/bs/build/final-acceptance.md:63-130` (with `build-chunk.md:240-262`, `state-machine.md:133-151`)

**Issue:** Session handoff seams (state-machine.md:135) exist to bound a session to "at most one step
group." For the final-acceptance chunk, Step Group 4 becomes four steps —
`final-acceptance → playtest → revise(loop) → close` — with no seam before `playtest`, and the added
`final-acceptance` content step is by far the heaviest single step in the whole skill: a coverage
check, a 7-point design-QA pass, a fresh-context agent dispatch (serve/capture/kill at 3 breakpoints
× 2 themes + end-to-end keyboard drag-drop), two human-narrated checks (VoiceOver + colorblind), and
a fix-or-refute Findings-Ledger repair loop. Packed with playtest + a revise loop + close in one
no-handoff session, this risks blowing the session budget the seams are meant to enforce.

Additionally, `final-acceptance` is a single checklist item covering all of the above. If the session
crashes mid-pass (e.g. after the agent dispatch but before the human VoiceOver check), Step 2's
"first incomplete item" routing re-runs the *entire* final-acceptance step from scratch — re-running
the coverage check, re-dispatching the capture agent, and re-asking the human for VoiceOver. It is
resumable at the 4-item granularity but not within the content step's own sub-parts, unlike the
per-round persistence (`## Redteam Rounds`, `## Findings Ledger`, `## Revision Rounds`) every other
heavyweight step gets.

**Fix:** Consider a handoff seam after the `final-acceptance` content step (making it its own group,
with `{playtest, revise, close}` the next session), and persist the content step's sub-parts (coverage
result, agent-dispatch findings landed in `## Findings Ledger`, each human check) so a crash resumes
mid-pass rather than re-dispatching. At minimum, document that the final-acceptance content step is a
single re-runnable unit so the cost of a mid-pass crash is understood.

### WR-04: Light-path/close citations name a section heading that isn't byte-exact

**File:** `src/cli/slash-command/bs/build-chunk.md:167-174`, `src/cli/slash-command/bs/build/playtest.md:122,126`, `src/cli/slash-command/bs/build/close.md:30`

**Issue:** All three files cite `state-machine.md "Step Names (exact, light path)"`, but the actual
heading (state-machine.md:29) is `## Step Names (exact, light path — trivial chunks)`. The citations
truncate `— trivial chunks`. In a skill whose entire design leans on byte-exact cross-file citations
enforced by drift tests, a section citation that doesn't match its target heading is drift-prone —
a future rename/reflow of that heading won't be caught by "find this cited section" tooling, and the
existing test only pins the step *list* string, not the citation label.

**Fix:** Cite the full heading `"Step Names (exact, light path — trivial chunks)"` in all three
files, and consider a drift assertion that each `state-machine.md "…"` citation label matches an
actual heading in `state-machine.md`.

## Info

### IN-01: The human plays the finished game twice, and "becomes this chunk's playtest script" is slightly muddled

**File:** `src/cli/slash-command/bs/build/final-acceptance.md:27-32,132-138` (with `build-chunk.md:106-110`)

**Issue:** Final-acceptance's 7-point pass, check 1, is a full **VoiceOver playthrough** ("The user
runs VoiceOver themselves and plays through the game"). Then the `{playtest, revise, close}` group
runs "on top of," and the human plays the finished game start-to-finish **again** as the playtest
script. That is two full human playthroughs (one a11y-lensed, one functional). This may be
intentional (different lenses), but the phrasing "its coverage check and design-QA pass supply that
chunk's playtest script" (build-chunk.md:109-110, final-acceptance.md:136) blurs it: the design-QA
pass is not itself a click-by-click script — the actual playtest script for this chunk is "play the
whole finished game." Worth a one-line clarification so the operator knows check-1's playthrough and
the playtest-step playthrough are distinct, not the same run double-counted.

**Fix:** State explicitly that the final-acceptance chunk's playtest script is "play the finished game
start-to-finish" and that the check-1 VoiceOver playthrough is a separate a11y-lensed pass, not the
same run.

### IN-02: `close.md`'s numbered "Bookkeeping Sequence" and state-machine.md's light-path "three-item sequence" are the same set framed differently

**File:** `src/cli/slash-command/bs/build/close.md:19-54` (vs `state-machine.md:41-44`, `build-chunk.md:173-174`)

**Issue:** state-machine.md:42-44 lists the light-path three items as `[record verified hash, update
Status line, roll up decisions]`. close.md's `## Bookkeeping Sequence` is a three-item numbered list
`[1: Status already landed (a note, not an action), 2: record hash, 3: roll up decisions]`.
build-chunk.md:173-174 and playtest.md:121 both tell the light path to "run the exact three-item
sequence" and cite *both* sources as if identical. They describe the same set of concerns, and the
framing is reconcilable (playtest writes the Status via its Verified Gate, then performs close's
items 2-3), but an agent cross-reading the two numbered lists could momentarily disagree on whether
"record hash" is item 1 or item 2. Low risk given the current wording, but a one-line note that
close.md item 1 is the Status write state-machine.md counts as one of its three would remove the
ambiguity.

**Fix:** Add a parenthetical in close.md's Bookkeeping Sequence: "(item 1 is the Status write
state-machine.md's light-path list counts as its second item; on the light path `playtest` performed
it via its Verified Gate)."

---

_Reviewed: 2026-07-04T20:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
