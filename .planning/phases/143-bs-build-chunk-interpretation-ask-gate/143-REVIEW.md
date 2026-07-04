---
phase: 143-bs-build-chunk-interpretation-ask-gate
reviewed: 2026-07-04T17:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build/investigate.md
  - src/cli/slash-command/bs/build/redteam.md
  - src/cli/slash-command/bs/build/ask.md
  - src/cli/slash-command/bs/build-chunk.test.ts
findings:
  critical: 1
  warning: 4
  info: 8
  total: 13
status: issues_found
---

# Phase 143: Code Review Report (iteration 2)

**Reviewed:** 2026-07-04T17:00:00Z
**Depth:** standard
**Files Reviewed:** 5 (plus cross-checked `templates/CHUNK.template.md`, `templates.test.ts`, `state-machine.md`)
**Status:** issues_found

## Summary

Iteration 2 after fix commits 5deed12b..c1a0373e. All nine iteration-1 CR/WR fixes verify as genuinely resolved: the bounded CHUNK.md `## Interpretation`/`## Visibility Declaration` read is now a coherent sanctioned channel stated consistently in all four files (CR-01); per-step check-offs and the new `## Redteam Rounds` section exist with matching template + parse-contract + `templates.test.ts` heading-pin amendments (CR-02); awaiting-playtest is now structurally defined (WR-01); waived chunks are excluded from resume targeting (WR-02); the lock is classified against a derived resume target (WR-03); round-2 dispatch marks superseded claims (WR-04); Step 1 intents are self-contained (WR-05); and the test pins are real (WR-06/07 — verified non-vacuous against the current file text; suite green, 123 tests).

However, the fixes introduced a new inconsistency seam: the supersession + durable-round-record model was wired into investigate and redteam but **not into ask**. Ask still instructs presenting "every claim" from `## Interpretation` — which, after a refuted-once round, includes the refuted original — and its inputs give it no channel to the persisted `## Redteam Rounds` record, so a cold resume at ask cannot see an open escalation or which claims are superseded. That is the one new blocker. Four warnings cover the round-persistence timing contradiction with the template, a missing SKETCH.md derived-status write at the gate, unpinned CR-02 fix prose in the drift test, and an undefined resume path for sketch-level tail entries. The five iteration-1 Info items (out of fix scope by design) all persist and are carried forward.

## Critical Issues

### CR-03: `ask` was not updated for the supersession + `## Redteam Rounds` model the fixes introduced — the approval gate presents refuted claims as live and cannot see the persisted round record

**File:** `src/cli/slash-command/bs/build/ask.md:10-20, 26-31, 108-114` / `src/cli/slash-command/bs/build/redteam.md:97-118` / `src/cli/slash-command/bs/build-chunk.md:21-28`
**Issue:** The WR-04 fix formalized append-only supersession: after a refuted-once round, `## Interpretation` durably contains both the refuted original (e.g. claim 7, "still wrong, by design" — redteam.md:104-105) and its superseding claim 12. redteam.md carefully marks superseded claims for the round-2 *agents* (`7. [superseded by claim 12 — do not review]`), but ask.md — the user-facing gate consuming the same list — still says: "**Every claim** from CHUNK.md's `## Interpretation` restated in the register a designer would use" (ask.md:26-27). Executed literally on the mainline refuted-once path (no crash needed), the gate presents the known-wrong claim 7 and the correcting claim 12 side by side as flat design facts, and the user approves a contradictory interpretation.

The cold-resume facet compounds it: the CR-02 fix persists per-claim verdicts, objections, and the round disposition (including `escalation open at ask`) to `## Redteam Rounds` precisely so "a crash or session handoff between redteam and ask must not lose the verdicts" (redteam.md:109-118) — but ask.md's Inputs (lines 10-20) enumerate only `## Interpretation` and `## Visibility Declaration`, and the Context-Economics rule sanctions exactly "those two sections" (build-chunk.md:21-26, investigate.md:15-17). A session resuming at ask (redteam checked, ask unchecked) has no instruction — and arguably no permission — to read the round record, so an open refuted-twice escalation ("still open when this step starts," ask.md:18-19, 84-85) and the superseded-claim set are both invisible to it. The verdicts were persisted for a consumer that never reads them.

**Fix:** Two aligned edits:
1. In ask.md Inputs + part (a): the orchestrator's sanctioned state-file read at ask covers `## Interpretation`, `## Visibility Declaration`, **and `## Redteam Rounds`**; part (a) presents every **live** claim — a claim named as superseded by a later claim (or recorded as refuted in the latest round entry without a standing resolution) is omitted from the presentation, with its superseding claim carrying the citation. Any round disposition of `escalation open at ask` is surfaced as a part (b) question.
2. In build-chunk.md's Context-Economics Hard Rule (and investigate.md's restatement), widen the sanctioned-channel wording from "those two sections" to the chunk-state sections the group-1 steps consume (Interpretation, Visibility Declaration, Redteam Rounds), keeping the ban on slices/docs/code unchanged.

## Warnings

### WR-08: `## Redteam Rounds` write is deferred past the re-investigate round, contradicting CHUNK.template.md's per-round model and re-opening the crash window CR-02 was meant to close

**File:** `src/cli/slash-command/bs/build/redteam.md:109-118` / `src/cli/slash-command/bs/templates/CHUNK.template.md:86-100`
**Issue:** redteam.md's "Persisting the Round" appends the entry only "when all 3 agents have returned **and the escalation logic above has resolved (including any re-investigate round)**." The template disagrees: "Written by the ORCHESTRATOR at the end of **each** redteam round" and its example disposition includes `re-investigate dispatched` — a value that can only exist if Round 1's entry is written *before* re-investigation completes. Under redteam.md's reading, nothing persists across the round-1 → re-investigate → round-2 span: a crash mid-re-investigate loses all round-1 verdicts, while the re-investigate subagent's superseding claim (written directly to `## Interpretation`) survives. The cold resume then routes to redteam (unchecked), reads a claims list containing an unmarked refuted claim 7 plus claim 12, dispatches what it believes is Round 1 (the superseded-claim marking is keyed to "when the round-2 agents are dispatched," which the resume can't know without a round record), both refuters re-refute claim 7, and the spurious refuted-twice escalation WR-04 fixed comes back through the crash seam.
**Fix:** Align redteam.md to the template's per-round model: append `### Redteam Round 1` (disposition `re-investigate dispatched`) **before** dispatching the re-investigate subagent, and `### Redteam Round 2` after the round-2 agents resolve; state that a resume finding a round entry with disposition `re-investigate dispatched` (or a `supersedes claim N` claim in `## Interpretation`) dispatches a round-2 review with superseded claims marked, never a fresh Round 1.

### WR-09: The ask gate's write order omits the SKETCH.md derived-status update — violating Write Order's "never SKETCH.md alone / CHUNK.md first, then SKETCH.md second" and leaving a known contradiction on disk

**File:** `src/cli/slash-command/bs/build/ask.md:97-106` / `src/cli/slash-command/bs/build-chunk.md:181-184`
**Issue:** The gate's numbered write list ends at "4. Write `Status: approved` to CHUNK.md **last**." No step updates SKETCH.md's derived pointer (`Status (derived from chunks/<slug>/CHUNK.md): approved`), and build-chunk.md's end-of-group confirmation list (claims list, Redteam Rounds entry, check-offs, `Status: approved`, RULINGS/ASSETS) also omits SKETCH.md. `state-machine.md` "Write Order" requires every status write to be CHUNK.md-then-SKETCH.md, and build-chunk.md itself quotes that pairing for the light-path playtest bookkeeping ("Status line update CHUNK.md-then-SKETCH.md," line 134) — but the one status transition group 1 actually performs never gets the second write. Every chunk therefore exits group 1 with SKETCH.md reading `proposed` against CHUNK.md's `approved`, a contradiction the next session's consistency check must log and repair (authority rule) — recurring noise the write order exists to prevent.
**Fix:** Add step 5 to ask.md's post-approval list: update this chunk's derived-status pointer in SKETCH.md to `approved` (CHUNK.md first, SKETCH.md second, per `state-machine.md` "Write Order"). Add SKETCH.md's updated pointer to build-chunk.md's end-of-group confirmation list.

### WR-10: The drift test pins none of the CR-02 persistence contract — the fix's load-bearing prose can be silently deleted with the suite green

**File:** `src/cli/slash-command/bs/build-chunk.test.ts` (no assertion anywhere; cf. lines 112-141, 180-220)
**Issue:** The CR-02 fix introduced new cross-file load-bearing strings: `## Redteam Rounds` (now in build-chunk.md, redteam.md, and CHUNK.template.md), the `### Redteam Round N` entry grammar, redteam.md's "Persisting the Round" write-before-ask rule, and build-chunk.md's "Every step persists before the next starts" check-off rule. `templates.test.ts` pins the template heading (good), but `build-chunk.test.ts` — the suite whose stated purpose is exactly this drift protection, and which was just hardened for WR-06/07 on the same grounds — asserts none of them. Deleting "Persisting the Round" from redteam.md or the persistence paragraph from build-chunk.md leaves the suite green (verified by grep: no `Redteam Round`, `persist`, or check-off assertion exists in the file), silently reverting the CR-02 fix. This is the identical defect class WR-06/WR-07 were fixed for.
**Fix:** Add to the BUILD-03 describe block (or a new persistence block):
```ts
const REDTEAM_ROUNDS_HEADING = '## Redteam Rounds';
expect(read('build/redteam.md')).toContain(REDTEAM_ROUNDS_HEADING);
expect(read('build/redteam.md')).toMatch(/before.*the ask step starts/i);
expect(read('build-chunk.md')).toContain(REDTEAM_ROUNDS_HEADING);
expect(read('build-chunk.md')).toMatch(/Every step persists before the next starts/);
expect(read('templates/CHUNK.template.md')).toContain('### Redteam Round 1');
```

### WR-11: Resume-target rule is undefined when the first non-closed SKETCH.md entry is a sketch-level tail entry with no CHUNK.md

**File:** `src/cli/slash-command/bs/build-chunk.md:38-41, 70-77`
**Issue:** Both Step 0's target derivation and Step 2's routing select "the first chunk whose status is neither `verified` nor `verified (user-waived)`." A sketch-level tail entry (`Status: proposed (sketch-level — no CHUNK.md yet)`) satisfies that predicate, yet Step 2's next instruction — "read that chunk's `chunks/<slug>/CHUNK.md`" — targets a file that by design does not exist (the consistency check explicitly exempts tail entries from having a directory; detailing happens at a close gate). The router names the stale-marker stop case but not this one, so a session in that state has no defined behavior at either Step 0 (lock classification against an undetailable target) or Step 2. Reachability requires all detailed chunks closed (Phase 146 machinery), but this router's text is what those sessions execute unchanged — the same standard WR-01's audit/repair gap was held to. Note also build-chunk.md's light-path playtest-as-close bookkeeping list (lines 132-134: bisect anchor, status update, decision rollup) omits close's detail-the-next-tail-entries duty, which is exactly what would make this state common for light-chunk-heavy projects.
**Fix:** One sentence in Step 2: if the resume target is a sketch-level tail entry (no `chunks/<slug>/` directory), stop and tell the user detailing happens at the previous chunk's close gate (Phase 146) — never scaffold a CHUNK.md ad hoc. Add "detail the next 2-3 tail entries" to the light-path close-bookkeeping list or cite it forward to Phase 146.

## Info

### IN-01 (carried from iteration 1): Stale, mutually inconsistent step-number cross-references

**File:** `src/cli/slash-command/bs/build/investigate.md:2` / `src/cli/slash-command/bs/build/redteam.md:2` / `src/cli/slash-command/bs/build/ask.md:2`
**Issue:** Still present: investigate.md says "Referenced by `build-chunk.md` Step 2"; redteam.md and ask.md both say "Step 3." In the router, Step 2 is Resume Routing, Step 3 is Ceremony Routing, and the actual dispatch is the unnumbered "Step Group 1 Dispatch" section.
**Fix:** Reference the section by name: "Referenced by `build-chunk.md` 'Step Group 1 Dispatch'."

### IN-02 (carried): Refuter dispatch prompt cites `state-machine.md`, unresolvable for the fresh-context subagent

**File:** `src/cli/slash-command/bs/build/redteam.md:47-49`
**Issue:** Still present: the prompt handed to refuters includes "(see state-machine.md 'Rulings Outrank Rulebook')" — per CHUNK.template.md's header decision, state-machine.md is not copied into the game project.
**Fix:** Drop the parenthetical from the prompt template; keep the inline restatement.

### IN-03 (carried): `docs/*.md` paths in the investigate dispatch carry no resolution note

**File:** `src/cli/slash-command/bs/build/investigate.md:29-42, 71-74`
**Issue:** Still present: the fresh subagent gets `docs/core-concepts.md` etc. with no statement of how those resolve inside a generated game project (e.g. `node_modules/boardsmith/docs/`).
**Fix:** State that `{resolvedDocList}` contains paths resolved before dispatch, the same way `{citedSlicePaths}` are.

### IN-04 (carried): Timing of a redteam-time RULINGS.md write vs the ask gate still unstated in redteam.md

**File:** `src/cli/slash-command/bs/build/redteam.md:134-139` / `src/cli/slash-command/bs/build/ask.md:83-87`
**Issue:** Still present: ask.md gates rulings from escalations "still open when this step starts," implying redteam-time answers are written immediately, but redteam.md's "Recording the Ruling" never states the timing.
**Fix:** One sentence in redteam.md: a ruling given during the redteam escalation is written immediately (user-authorized on its own), independent of the later ask approval.

### IN-05 (carried): Dead test asserts constants against themselves

**File:** `src/cli/slash-command/bs/build-chunk.test.ts:289-294`
**Issue:** Still present: the 'reuses SKETCH_LEVEL_MARKER / UI_TAG_REGEX conventions' test reads no file and can never fail against the reviewed files.
**Fix:** Delete the `it()` or convert to a real cross-file assertion.

### IN-06 (new): No re-investigate dispatch template — the orchestrator improvises the refuted-once prompt

**File:** `src/cli/slash-command/bs/build/investigate.md:57-92, 105-116` / `src/cli/slash-command/bs/build/redteam.md:89-92`
**Issue:** redteam.md hands off "to `build/investigate.md`'s re-investigate behavior with the specific objection(s) attached," but investigate.md's only dispatch template is the fresh full-read prompt (read everything, fill three sections). The Re-Investigate Round Behavior section describes the required *outcome* (append a superseding claim, never renumber) but gives no prompt shape carrying the objection text, the affected claim number, or the append-only supersession instruction — the one write rule the round-2 marking depends on getting exactly right.
**Fix:** Add a second, narrower dispatch template to investigate.md: cited slice paths + the objected claim's number/text + the objection(s), instructing "append a new claim that states what claim N should have said and notes 'supersedes claim N per redteam objection'; never edit claim N."

### IN-07 (new): Step 0 lock resolution runs before Step 1's intent probe, and the no-lock case is never stated

**File:** `src/cli/slash-command/bs/build-chunk.md:30-50, 52-66`
**Issue:** A read-only status question ("what's left?") triggers Step 0's full lock resolution first — a different live lock stops the session for a user decision before a question that touches no chunk. And none of the three lock outcomes covers the ordinary case of no lock existing (fresh project, or cleared): taking the lock is only implied by outcome 3's "before this session takes the lock."
**Fix:** Note that pure status questions (Step 1, first bullet) don't require lock acquisition; add the no-lock outcome explicitly ("no lock present — write the lock for the resume target and continue").

### IN-08 (new): Round-2 superseded-claim marking describes two different marker grammars, outside the verbatim templates

**File:** `src/cli/slash-command/bs/build/redteam.md:97-107`
**Issue:** The example marks the *old* claim (`7. [superseded by claim 12 — do not review]`) while the instruction sentence keys on the *new* claim's text ("a claim marked 'supersedes claim N' replaces claim N"). Both are workable but they are different mechanisms, and neither appears inside the "concrete pattern to copy" dispatch templates — a session copying the templates verbatim for round 2 gets no superseded-claim instruction in the prompt body.
**Fix:** Pick one grammar (the in-place `[superseded by claim M — do not review]` marking is the unambiguous one) and add one line to both dispatch templates: "Claims marked '[superseded by claim M — do not review]' receive no verdict."

---

_Reviewed: 2026-07-04T17:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
