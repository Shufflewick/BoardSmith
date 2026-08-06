# Revise — 4-Category Triage Loop, Append-Only (BUILD-10)

Referenced by `build-chunk.md` Step 10 (`revise`, second of the `{playtest, revise, close}`
session step group — see `state-machine.md` "Session Handoff Seams"). Revise processes
each feedback item the user reported during `playtest`: every item gets exactly one of four
dispositions. Revise has no subagent of its own — like `playtest`, the orchestrator triages the
human's own spoken feedback directly, in the main session.

## The Four Triage Categories

Every feedback item the human reported at `playtest` is triaged into exactly one of these four
categories — never left untriaged, never split across two:

**(a) This-chunk defect.** The chunk's own build is wrong against its own settled interpretation
— a real bug in what this chunk was supposed to do. Append a new `### Revise N` entry to
CHUNK.md's `## Revision Rounds` recording the item and its fix; the code fix re-enters
`build`/`test` as needed (same session group, no handoff — see "Round-Bounding and Persistence"
below). This chunk cannot close until every (a)-item is resolved.

**(b) Future scope.** The item is real, but it is out of scope for this chunk — a good idea for
later, not a defect in what this chunk promised. Route it to SKETCH.md's `## Ideas Backlog`, or
hand it directly to `/bs-insert-chunk` if it clearly warrants its own chunk (forward reference —
`/bs-insert-chunk` is authored in Phase 147). This chunk closes regardless of how many
(b)-items remain open; future scope never blocks the current chunk.

**(c) Not-built-yet.** The item matches something already named in the chunk's own "what you
will NOT see yet" list from the `ask` step, or is otherwise a case of the human's expectations
running ahead of this chunk's declared scope. This is an expectation reset, not a defect: no
write is made — there is nothing to record, the chunk already correctly excluded this.

**(d) Rules change.** The feedback reveals a house-rule or digital-adaptation decision that
needs to change, or a rulebook interpretation that needs revisiting. Write a new
`### Ruling N` entry to RULINGS.md, following `RULINGS.template.md`'s Decision / Citation
interpreted or overridden / Rationale shape exactly — never restructure the ledger's header,
never overwrite or renumber a prior entry.

**Closure rule:** the chunk closes when every (a)-item across all rounds has a disposition
recorded in `## Revision Rounds`, regardless of how many (b)-items are still open in the Ideas
Backlog. Future scope is never a blocker.

## Round-Bounding and Persistence (cite, never restate)

Each revise round appends a new `### Revise N` entry — `revise-1`, `revise-2`, and so on — to
CHUNK.md's `## Revision Rounds`. Rounds are append-only: a round is never edited or renumbered
once written, even if a later round supersedes an earlier finding. Write each round's
dispositions into `## Revision Rounds` before the next playtest re-entry, the same
write-before-next-step discipline `build/audit.md` and `build/repair.md` both establish for
their own round ledgers — cite `state-machine.md` "Write Order" for the underlying rule rather
than re-deriving it here.

## Re-Entry: Feedback Disposition Report + Targeted Re-Test

On re-entry after a revise round — the human coming back to confirm the fixes — never present a
blind full re-test of the chunk's entire original script. Instead present exactly two things:

1. A **feedback disposition report**: each item the human originally reported, and what changed
   for it — "you reported X; that was (a) a defect, now fixed" / "you reported Y; that's (b)
   future scope, added to the Ideas Backlog" / "you reported Z; that's (c) already excluded from
   this chunk, see its 'not yet' list" / "you reported W; that's (d) a rules change, recorded as
   Ruling N." Plain language, in the same designer register `build/ask.md` and `build/repair.md`
   use for user-facing presentations — never a raw finding or agent transcript.
2. A **targeted re-test**: a smaller instantiation of `## Playtest Test Script` covering only
   the script items affected by this round's fixes, not the chunk's full original script. A
   blind full re-test after every revise round would waste the human's time re-confirming
   already-verified behavior that this round never touched — the targeted re-test is
   deliberately scoped down to just the (a)-items this round fixed.

## Loop Back to Playtest

After presenting the disposition report and targeted re-test, this chunk loops back to
`build/playtest.md` for the human to confirm the targeted items — same session group, no
handoff, mirroring `build/repair.md`'s same-group loop-back to `build/audit.md`. This continues,
appending `revise-2`, `revise-3`, and so on as needed, until every (a)-item across all rounds has
a recorded disposition.

## Downstream Shape (cite, never restate)

Once every (a)-item is resolved, this chunk loops one final time to `build/playtest.md` for the
human's final confirmation, then proceeds to `build/close.md`. This file does not restate either
file's structure.
