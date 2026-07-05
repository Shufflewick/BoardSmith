---
phase: 147-bs-check-status-insert-chunk
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/cli/slash-command/bs/check-status.md
  - src/cli/slash-command/bs/insert-chunk.md
  - src/cli/slash-command/bs/status-tools.test.ts
  - src/cli/slash-command/bs/build-chunk.md
findings:
  critical: 1
  warning: 5
  info: 1
  total: 7
status: issues_found
---

# Phase 147: Code Review Report

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 147 authored two thin state-reader/editor skills (`/bs-check-status`, `/bs-insert-chunk`)
and retired build-chunk.md's Phase-147 forward-references. These are LLM-executed instruction
files, so "bugs" are contradictions, gaps, and dangling references that will misdirect an agent
session.

The good news first (verified clean against the ground-truth references): the byte-exact stale
marker `stale — re-derive before build` (em-dash) is correct; the write-order is correct
(CHUNK.md operation (c) before SKETCH.md operation (d)); the citation-overlap diff correctly reads
per-chunk `## Interpretation` + `## Newly Discovered Citations` in each `chunks/<slug>/CHUNK.md`
(not a central index); no nonexistent state-machine.md "Sketch Version" heading is cited (it
correctly cites the SKETCH.template.md field); check-status.md truly performs no writes (it never
refreshes the lock, unlike build-chunk.md Step 0); and every cited state-machine.md section
heading and template path actually exists (including ingest-rules.md's `## Step 6: Approval Gate`).

Seven defects remain. The most serious: the `## Mandated Chunks` invariant guard only reliably
blocks *removal* for one of the three mandated chunks — the other two are guarded against
reordering but not deletion, so an agent asked to "remove the final-acceptance chunk" can silently
break a hard structural invariant the guard exists to protect.

## Critical Issues

### CR-01: Mandated-Chunks guard fails to block removal for 2 of 3 mandated chunks

**File:** `src/cli/slash-command/bs/insert-chunk.md:33-37`
**Issue:** Operation (a)'s Mandated-Chunks guard is worded per-chunk with three different verbs,
and only one of them blocks removal:

- final-acceptance: "must not **move** the final-acceptance chunk **off the tail**" — a positional
  constraint. A user request "remove the final-acceptance chunk" is not "moving it off the tail";
  the chunk is deleted, not repositioned. Nothing in this clause blocks the deletion.
- first chunk: "must not **displace** the first chunk (the core event loop) **from position one**"
  — also positional. Removing the core-event-loop chunk deletes it rather than displacing it to
  another position; whether this clause fires on a delete is ambiguous at best.
- game-end: "must not **drop** the game-end/scoring/winner-determination chunk" — "drop" = remove.
  This is the only clause that clearly blocks removal.

The `## Mandated Chunks` section of `templates/SKETCH.template.md:93-100` requires that the sketch
*contain* all three "regardless of game specifics." The whole purpose of this guard is to prevent
a reshape from breaking that invariant, yet as written it lets a `remove` operation delete the
final-acceptance chunk or the core-event-loop chunk without flagging. "remove" is one of the four
first-class operations this skill exists to run (line 10, line 22), so this is a reachable path,
not a theoretical one.
**Fix:** State each mandated invariant in remove-and-reorder terms, e.g.:
```
A reshape must never leave the sketch without all three mandated chunks, and must never
change their required positions:
- The final-acceptance chunk must remain present AND stay the last entry. Reject any remove
  targeting it and any reorder that moves it off the tail.
- The game-end/scoring/winner-determination chunk must remain present. Reject any remove
  targeting it.
- The core-event-loop chunk must remain present AND stay at position one. Reject any remove
  targeting it and any reorder that moves it off position one.
Flag the violation concretely instead of performing the reshape.
```

## Warnings

### WR-01: The core reshape mutation (editing the Ordered Chunk List) is never enumerated

**File:** `src/cli/slash-command/bs/insert-chunk.md:20-69`
**Issue:** "The Four Operations" enumerates (a) dependency re-validation, (b) citation-overlap
diff, (c) stale-marking, (d) version bump — but none of them is "actually add/reorder/split/remove
the entry in SKETCH.md's `## Ordered Chunk List`." That edit is the entire point of the skill, yet
it is only referenced obliquely ("the `## Ordered Chunk List` ... grammar this skill edits" in
Reference Files, line 84). Because it is never a named operation, its placement in the Write Order
section is undefined: the Write Order block (lines 64-69) discusses only operation (c)'s CHUNK.md
write and operation (d)'s SKETCH.md version bump. An agent could plausibly bump the version stamp
(d) without ever rewriting the list, or rewrite the list in a separate, out-of-order write. For an
LLM instruction, the load-bearing mutation must be explicit and its write-order pinned.
**Fix:** Add the list edit as an explicit operation folded into the SKETCH.md write, e.g.: "The
add/reorder/split/remove edit to `## Ordered Chunk List` lands in the same SKETCH.md write as the
version bump (operation d): rewrite the list first, then the `Sketch Version:` line last, per
`state-machine.md` '## Write Order'."

### WR-02: build-chunk.md forward-ref retirement left a dangling "Phase 147" reference

**File:** `src/cli/slash-command/bs/build-chunk.md:76`
**Issue:** The line still reads "...surfacing accumulated waived chunks for a batch playtest is
`/bs-check-status`'s job, Phase 147) → read that chunk's...". The retirement removed the
"ships as ... (Phase 147)" / "until it lands" stopgap phrasing, but this leftover "Phase 147"
internal planning reference survived. `status-tools.test.ts:250-263` does not catch it: its regexes
require the literal `ships as ... (Phase 147)` shape and `until it lands`, neither of which matches
`, Phase 147)`. A shipped skill file should not leak the internal planning-phase number that
authored the now-live skill it points to.
**Fix:** Drop the phase reference: "...surfacing accumulated waived chunks for a batch playtest is
`/bs-check-status`'s job) → read that chunk's...". Consider tightening the test to
`buildChunk.not.toMatch(/Phase 147/)` so future drift fails loudly.

### WR-03: check-status Item 7 has no next-command case for an unstarted or undetailed current chunk

**File:** `src/cli/slash-command/bs/check-status.md:74-81`
**Issue:** Item 7 derives the next command from three cases: (1) current chunk mid-ceremony (any
step checked, more remain) → `/bs-build-chunk`; (2) a reshape was just discussed → `/bs-insert-chunk`;
(3) nothing ingested → `/bs-ingest-rules`. It omits two very common states: a current chunk that is
detailed but has **zero** steps checked (fresh, not yet started), and a current chunk that is a
sketch-level tail entry "not yet detailed" (which Item 2 explicitly reports at lines 45-47). In both
the correct next command is `/bs-build-chunk` (to start/detail it), but case (1) only covers
"any step checked," so these states fall through all three bullets and leave the agent without a
derived answer — the section explicitly forbids guessing ("never guess, derive it from the state").
**Fix:** Broaden case (1) to "If the current chunk exists (detailed or still a tail entry) and is
not yet fully verified — whether mid-ceremony or not yet started — the next command is
`/bs-build-chunk`," keeping the reshape and no-project cases as overrides.

### WR-04: check-status Item 3 reads the current chunk's CHUNK.md without the "not yet detailed" guard Item 2 has

**File:** `src/cli/slash-command/bs/check-status.md:52-56`
**Issue:** Item 3 ("Outstanding playtest feedback") says "Read the current chunk's `## Revision
Rounds`." Item 2 carefully handles the case where the current chunk is a sketch-level tail entry
with no `chunks/<slug>/CHUNK.md` yet (lines 45-47: "report it as 'not yet detailed' rather than
reading a CHUNK.md that doesn't exist"). Item 3 (and the CHUNK-reading tail of Item 2 at lines
47-50) inherit no such guard: when the first non-verified chunk is an undetailed tail entry — a
reachable state once all detailed chunks are verified and routing reaches a sketch-level tail —
Item 3 would attempt to read `## Revision Rounds` from a file that does not exist.
**Fix:** Add to Item 3: "If the current chunk is not yet detailed (no CHUNK.md — see Item 2), report
'n/a — current chunk not yet detailed' and skip the Revision Rounds read." Apply the same guard to
Item 2's Step-Checklist read.

### WR-05: insert-chunk writes state but never resolves a live session lock

**File:** `src/cli/slash-command/bs/insert-chunk.md:12-18, 61`
**Issue:** insert-chunk mutates state (operation (c) writes CHUNK.md, operation (d) writes
SKETCH.md), but its Step 0 runs only the consistency check, whose lock item (state-machine.md
`## Consistency Check` item 4) detects only a **stale** lock (>24h). It never performs the live-lock
resolution that build-chunk.md Step 0 does (outcome 2: "Different, live lock ... warn the user
instead of silently clobbering it"). state-machine.md `## Session Lock` and the plan
(`.planning/bs-skills-plan.md` line 157) make this a hard rule: "A second concurrent session, on
entry, sees the lock note and warns instead of silently clobbering." insert-chunk is exactly such a
writing session, yet it proceeds to stale-mark a `CHUNK.md` that a live `/bs-build-chunk` session
may be mid-write on, only mentioning the lock to say "never touches the lock" (line 61). The
version-bump (d) lets a concurrent build detect the change *after the fact*, but does not prevent
insert-chunk from clobbering an in-flight chunk write.
**Fix:** Add a live-lock check to Step 0: "If the consistency check surfaces a live (non-stale) lock
naming a chunk this reshape will stale-mark or reorder, warn the user and stop for their decision
before writing — same as `build-chunk.md` Step 0 outcome 2 (`state-machine.md` '## Session Lock')."

## Info

### IN-01: check-status Item 2 reports a "current step" even for a stale chunk

**File:** `src/cli/slash-command/bs/check-status.md:42-50`
**Issue:** Item 2 derives the current chunk as the first entry whose derived status is neither
`verified` nor `verified (user-waived)`, then reads its Step Checklist and reports "the first
unchecked step." A chunk whose Status is `stale — re-derive before build` (which Item 1 correctly
classifies as "remaining," line 39) satisfies that predicate, so Item 2 would present its first
unchecked step as if resumable — but build-chunk.md Step 2 (line 78-79) explicitly *stops routing*
on a stale chunk rather than resuming a step. The report would imply a resume path that
`/bs-build-chunk` will not take.
**Fix:** In Item 2, add: "If the current chunk's Status is `stale — re-derive before build`, report
it as needing re-derivation (cite `build-chunk.md` '## Status Enum and Stale Marker') instead of
reporting a first-unchecked step."

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
