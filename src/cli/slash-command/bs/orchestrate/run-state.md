# Run State — RUN.md, Resume, and the Stop Conditions

Referenced by `build-game.md` Step 1 (Run State) and Step 5 (Stopping). This file owns the
orchestrated run's own durable state: what `RUN.md` holds, how a cold run picks up where the last
one left off, and when a run stops. It does not own chunk state — that is `CHUNK.md`'s, per
`state-machine.md` "Authority", and this file never competes with it.

## The One Authority Rule

`RUN.md` is a journal, not a second source of truth. It answers questions `SKETCH.md` and
`CHUNK.md` cannot: which human gate was open when the run stopped, why the last run ended, and how
many passes a chunk has taken. It never answers "is this chunk done" — that comes from the chunk's
own `CHUNK.md` Status line and its Step Checklist, exactly as it does for `/bs-build-chunk`
(`build-chunk.md` Step 2).

**On any disagreement, `CHUNK.md` wins and `RUN.md` is repaired to match.** A `RUN.md` entry saying
a chunk closed, against a `CHUNK.md` that is still `built`, means the run died between the
subagent's work and the journal write: the chunk is not closed. Report the contradiction to the
designer in their terms ("the last run stopped part-way through X — picking it back up"), append a
corrected entry, and continue. Never repair `CHUNK.md` to match `RUN.md`.

## Creating It

`RUN.md` lives at `design/RUN.md` and is created from
`${CLAUDE_SKILL_DIR}/../bs-shared/templates/RUN.template.md` the first time `/bs-build-game` runs
in a project — fill the placeholders, never restructure the file. If it does not exist, this is the
run's first pass; create it with `Run Status: active`, `Open Gate: none`, `Stop Reason: none`, and
an empty `## Run Log`, then continue. A missing `RUN.md` is never a parse failure — an absent
journal simply means no orchestrated run has happened yet.

A `RUN.md` that exists but does not parse against its template IS a parse failure: stop and ask the
designer (`state-machine.md` "Cold-Resume Parse Contract"). Never guess what an unrecognized
`Run Status:` was meant to say.

## Resume Algorithm (the `/clear`-and-crash path)

A resuming run reconstructs everything it needs from files, never from a conversation it no longer
has. In this exact order:

1. **Read `RUN.md`.** Note `Run Status:`, `Open Gate:`, `Stop Reason:`, and the last `## Run Log`
   entry (which chunk, which pipeline, whether its Outcome is still `pending`).
2. **Read `SKETCH.md`'s `## Ordered Chunk List`** and derive the true build position exactly as
   `build-chunk.md` Step 2 does: the first chunk whose derived status is neither `verified` nor
   `verified (user-waived)`. This — not the journal — is what gets built next.
3. **Reconcile.** If step 2's chunk differs from the last log entry's chunk, the journal is behind
   (a dispatch closed but its Outcome was never written, or a chunk closed and the run died before
   the next dispatch). Append a corrected entry and proceed against step 2's answer.
4. **Read `QUESTIONS.md`.** Every entry whose `Answer:` is filled is a settled answer the resuming
   run must never re-ask (`orchestrate/questions.md`). Every entry whose `Answer:` is still
   `pending` is an open question the run still owes the designer.
5. **Resolve the open gate.** If `Open Gate:` is not `none`, the run's FIRST action is that gate —
   re-posed **verbatim from the file that owns its text**: the open `QUESTIONS.md` entry for a
   question, or the chunk's own `CHUNK.md` test script for a playtest. Never re-word it, and never
   silently re-run the step that produced it to regenerate the question.
6. **Resolve the session lock** per `state-machine.md` "Session Lock" — a lock naming the chunk
   this run is resuming is refreshed silently; a stale lock is reported; a different live lock
   warns. A crashed run leaves `Run Status: active` behind, so `active` is never by itself evidence
   that another run is live — the lock's timestamp is.

Only after all six does the run dispatch anything.

## Writing It

Every write is append-only except the two sanctioned in-place fills the template documents (an
entry's `Outcome`/`Detail`, and the three run-level lines). Specifically:

- **Before** each dispatch: append a `### Dispatch N` entry with `Outcome: pending` and a fresh
  `date -u +%Y-%m-%dT%H:%M:%SZ` clock read. This is what makes a mid-chunk crash visible on resume
  as a dispatch that never returned.
- **After** each dispatch returns: fill that entry's `Outcome` and `Detail` once.
- When a gate opens: set `Open Gate:` to that gate; when it is answered and recorded, set it back
  to `none`. A gate is never left recorded as open after its answer has landed in `QUESTIONS.md`,
  and never cleared before.
- When the run stops: set `Run Status:` and `Stop Reason:` as the LAST writes of the run, after
  everything else has landed — the same status-last discipline `state-machine.md` "Write Order"
  requires of `CHUNK.md`.
- When the final-acceptance chunk closes: `Run Status: complete`, `Open Gate: none`,
  `Stop Reason: none`.

## Stop Conditions

An orchestrated run stops for exactly four reasons, and says which one in the designer's terms:

1. **The designer said stop.** Immediately, at the next dispatch boundary — never mid-dispatch, so
   the chunk in flight persists its own step first. `Stop Reason: designer-stopped`.
2. **A gate the designer has not answered.** The run put a question or a playtest to them and is
   waiting. `Stop Reason: gate-open`, with `Open Gate:` naming it. This is the ordinary,
   healthy stop.
3. **A stuck dispatch.** A subagent returned `stuck` — a gate that keeps failing, a typecheck that
   will not go green, a subagent that died on a terminal error. `Stop Reason: stuck`, and the Run
   Log entry names what was stuck. Never retry a stuck dispatch a third time; surface it.
4. **The orchestrator's own context ceiling.** `Stop Reason: context-ceiling`. See below.

## Context: the Orchestrator's Own Budget

`state-machine.md`'s "Context floor + ceiling" (the ≥50% wind-down floor and the ~60% ceiling)
governs a session that is doing the work. Under `/bs-build-game` the work happens in dispatched
subagents, each of which gets a **fresh context window** and applies that floor/ceiling to itself:
a subagent that crosses its own ceiling mid-chunk persists its step, commits, and returns
`outcome: context-ceiling` — which the orchestrator treats as an ordinary re-dispatch, not a stop.
That is the whole point of the orchestrated shape: the context limit stops being the thing that
ends the designer's session.

The orchestrator's own thread stays nearly flat by construction — it reads state files and
structured returns, never rulebook slices, docs, or generated code (`build-game.md`
"Context-Economics Hard Rule"). If it nonetheless crosses ~60% used, or the harness surfaces a
context-low warning, it finishes the dispatch it is on, writes `RUN.md`, and stops with
`Stop Reason: context-ceiling`, telling the designer the one command to run after `/clear`. Because
resume is reconstructed entirely from `RUN.md` + `SKETCH.md` + `QUESTIONS.md`, that restart costs
the designer nothing but the keystrokes — no re-answered questions, no re-built chunks.
