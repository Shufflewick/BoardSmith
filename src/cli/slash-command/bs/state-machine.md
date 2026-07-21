# BS Skills — State-Machine Authority Rules

Every `bs-` skill (`bs-ingest-rules`, `bs-build-chunk`, `bs-check-status`, `bs-insert-chunk`, `bs-generate-ai`) cites this file rather than restating its rules. If you are authoring or extending a `bs-` skill, link to the relevant section below instead of copying rule text.

## Status Enum (exact)

The chunk status enum, in order, is exactly:

`proposed` | `approved` | `built` | `verified` | `verified (user-waived)`

- `proposed` — the chunk exists in SKETCH.md but its CHUNK.md has not been approved yet.
- `approved` — the user authorized the design at the `ask` step.
- `built` — the code exists and has passed automated `test`.
- `verified` — the human playtested the chunk and confirmed every item on the verification checklist.
- `verified (user-waived)` — the human explicitly chose to skip playtesting this chunk; recorded honestly rather than silently marked `verified`.

CHUNK-level stale marker (set by `/bs-insert-chunk` when an already-detailed pending CHUNK.md is invalidated by a sketch change):

`stale — re-derive before build`

(NOTE: the dash in `stale — re-derive before build` is an em-dash "—", not a hyphen.)

## Step Names (exact, full ceremony)

The 10-step `/bs-build-chunk` pipeline, in order, is exactly:

`investigate, redteam, ask, build, test, audit, repair, playtest, revise, close`

## Step Names (exact, light path — trivial chunks)

Chunks tagged trivial at proposal time (e.g. "swap in the real card images") run the light path instead of the full 10-step ceremony:

`build, test, playtest`

The user is told which path is in effect when a chunk is proposed.

Light-path status transitions: the light path has no `ask` step, so `approved` is unreachable
for light chunks. A light chunk moves `proposed → built` directly when the user accepts the
proposal (proposal acceptance is the light path's ask-equivalent authorization gate) and
`build` + `test` complete; it then moves `built → verified` (or `verified (user-waived)`)
when the human confirms the playtest checklist. Because the light path has no `close` step,
for light chunks the `playtest` step also performs `close`'s bookkeeping: it records the
verified commit hash in CHUNK.md (the bisect anchor — see Git Protocol), updates the Status
line (CHUNK.md first, SKETCH.md second, per Write Order), rolls up decisions, and — as the
terminal write — releases the session lock (`Session Lock: none`, see "Session Lock" above and
`build/close.md` "Bookkeeping Sequence").

## Authority

CHUNK.md wins on contradiction. Specifically:

1. **CHUNK.md owns its chunk's status.** It is the single authoritative record of that chunk's state.
2. **SKETCH.md holds only the ordered chunk list and derived pointers.** It never independently decides a chunk's status — it reflects what CHUNK.md says.
3. **On contradiction, CHUNK.md wins.** If SKETCH.md's derived status for a chunk disagrees with that chunk's own CHUNK.md, CHUNK.md is correct. The session logs the contradiction and repairs SKETCH.md to match — it never repairs CHUNK.md to match SKETCH.md.

This is the TMPL-03 authority rule.

## Write Order

- **Write order is always CHUNK.md first, then SKETCH.md second.** Never the reverse, and never SKETCH.md alone.
- Every write must leave the file valid for a cold resume:
  - Round entries (revise rounds, audit rounds) are **append-only** — never overwritten or renumbered.
  - The `Status:` line is updated **last**, after all other content for that write has landed. This means a session that crashes mid-write leaves a file whose `Status:` line still reflects the last fully-completed state, not a half-written one.
- **`close`'s Bookkeeping Sequence is append-only end-to-end, and its lock release is the terminal
  write.** Every CHUNK.md/SKETCH.md write `close` makes (the commit-hash record, the decision
  rollup) is append-only — never a rewrite/overwrite of existing CHUNK.md content — and the very
  last write of the sequence releases the session lock (see "Session Lock" above and
  `build/close.md` "Bookkeeping Sequence"). This is the CHUNK.md-overwrite guard: a close that
  crashes before the release leaves CHUNK.md intact (never half-overwritten) and a resumable lock,
  never a corrupted state file.

## Cold-Resume Parse Contract

Not every state file carries a status. The files that do are CHUNK.md (its authoritative status line) and SKETCH.md (one derived per-chunk pointer per entry); RULINGS.md, DECISIONS.md, DESIGN.md, and ASSETS.md carry no status line at all, and their parse contracts do not require one. Where a status is carried, it lives on one line matching `Status: <enum-value>` (case-sensitive), at the location its template documents:

- CHUNK.md: exactly one authoritative line, `Status: <enum-value>`.
- SKETCH.md detailed entries: `- Status (derived from chunks/<slug>/CHUNK.md): <enum-value>` — the `(derived from ...)` qualifier is what distinguishes a derived pointer from CHUNK.md's authoritative line.
- SKETCH.md tail (sketch-level-only) entries: exactly `- Status: proposed (sketch-level — no CHUNK.md yet)`; when a tail entry is detailed, this line is rewritten to the derived form above.

**If a state file does not parse against its template — required headings missing, malformed, or a `Status:` line that doesn't match a recognized enum value — the session STOPS and asks the user. It never guesses the intended state.**

This is the TMPL-02 parse-contract rule. "Guessing" includes silently picking the most likely status, silently repairing the file without telling the user, or proceeding as if the file were valid. All of these are prohibited; the only correct behavior on a parse failure is to stop and ask.

## Consistency Check (every bs- entry point, before proceeding)

Every `bs-` skill, on entry, runs a consistency check before doing any other work:

1. Every sketch slug with a detailed SKETCH.md entry (one carrying a derived-status pointer,
   `Status (derived from chunks/<slug>/CHUNK.md): ...`) has a corresponding `chunks/<slug>/`
   directory. Tail entries marked `Status: proposed (sketch-level — no CHUNK.md yet)` are
   exempt — by design, ingest details only the next 2-3 chunks and does NOT create stub
   directories for sketch-level tail entries; a tail entry gains its `chunks/<slug>/` directory
   when it is detailed at a close gate.
2. Every `chunks/<slug>/` directory has a corresponding entry in SKETCH.md.
3. All statuses parse against a recognized value: the Status Enum above, the CHUNK-level stale
   marker (`stale — re-derive before build`), or — in SKETCH.md tail entries only — the
   sketch-level marker `proposed (sketch-level — no CHUNK.md yet)`. Any of these three is a
   valid parse; anything else is a parse failure (stop and ask).
4. There is no stale session lock (see Session Lock below).

Any problems found are reported to the user, who confirms how to proceed, before the skill continues.

## Rulings Outrank Rulebook

Every agent that reads a rulebook slice — `investigate`, `redteam`, `audit` — also reads `RULINGS.md`. The rulebook plus `RULINGS.md` together form the composite source of truth. This is what stops an audit agent from "fixing" a deliberate house rule or adaptation back to the printed rule.

## Restyle/Cutover Rule

Any change that re-styles or re-lays-out previously verified surfaces flips those chunks back to `built`. The AutoUI→Custom-UI cutover (any change of UI strategy) is the total case: it explicitly flips **all** previously verified chunks back to `built` and re-opens their test scripts — the entire presentation changed, so no prior verification survives, per the plan's UI-strategy rule. Changing `DESIGN.md` flips every chunk whose verified surface it re-styles or re-lays-out. There is no silent "we'll re-verify later" — the flip happens immediately and is visible in CHUNK.md and SKETCH.md.

## Session Lock

- `SKETCH.md` carries a lightweight session lock note: which chunk is in progress, plus a
  session/chunk identity and a timestamp — the exact grammar lives in
  `templates/SKETCH.template.md`'s `Session Lock:` line and its comment.
- The timestamp is **always** produced by running `date -u +%Y-%m-%dT%H:%M:%SZ` at the moment the
  lock is taken or refreshed. It is never fabricated, estimated, or typed from memory — this is
  the only sanctioned source for the lock's ISO timestamp.
- The lock line carries a **session/chunk identity** — `"<slug> @ <session-id> — locked at <ISO
  timestamp>"` — so a lock unambiguously names both which chunk and which session holds it.
- A second concurrent session, on entry, sees the lock note and **warns the user instead of silently clobbering** the in-progress session's work.
- **Release:** a cleanly-closed chunk's terminal write sets `Session Lock: none` — see
  `build/close.md` "Bookkeeping Sequence", whose final numbered step is exactly this release, and
  this is the terminal write of that sequence. Because a clean close always releases to `none`, a
  later same-day session that resumes a DIFFERENT next chunk finds no live lock at all and does
  not warn — this is the root fix for the same-day false-alarm defect (SKILLDEF-01). `none` is the
  released/no-lock value; only a non-`none` lock line is ever classified against the three
  outcomes below.
- **Staleness criterion** (evaluated by consistency-check item 4): a lock is **stale** when its
  timestamp is more than 24 hours old — a crashed or abandoned session, not a live one; the
  session reports it and the user confirms clearing it. A lock naming the same chunk the
  entering session is resuming is **not** stale and does not warn — the session refreshes the
  lock's timestamp (a fresh `date -u +%Y-%m-%dT%H:%M:%SZ` read) and continues (this is the
  normal resume path). Any other lock (less than 24 hours old, naming different work) is treated
  as a live concurrent session and triggers the warning above.

## Git Protocol

- Commit at every step completion. Message convention: `chunk-<slug>/step-<name>` (e.g. `chunk-movement/step-build`).
- Revise rounds use `chunk-<slug>/revise-2` (etc.) as the commit message convention.
- Commit **before** `build` starts, so work-in-progress is always distinguishable from the last verified baseline.
- `close` records the verified commit hash in CHUNK.md — this is the bisect anchor for any later regression and the diff base for "what changed since the human last said yes."

## Repair Loop Bound

- Maximum **3 audit rounds** per chunk.
- Round N+1 auditors see the existing findings ledger (stable IDs) and report **only NEW findings** — they do not re-litigate findings already recorded.
- After round 3, any remaining findings are triaged with the user: real blocker, defer to a later chunk, or auditor was wrong (refuted).

## Redteam Escalation

- **Refuted once:** re-investigate with the specific objections attached. Maximum **one** re-investigate round.
- **Refuted twice:** that is by definition an ambiguity. Escalate to the user as a plain-language question; the ruling is recorded in `RULINGS.md`.
- Disputes go to the human, never to more agents.

## Session Handoff Seams (cold-resume checkpoints, not mandatory stops)

The four step groups are:

1. `{investigate, redteam, ask}`
2. `{build, test}`
3. `{audit, repair}`
4. `{playtest, revise, close}`

Every one of the 10 full-ceremony steps belongs to exactly one group. These group boundaries are
the skill's **cold-resume/persistence checkpoints** — a seam marks where a session's work is
guaranteed durable enough to stop and resume cleanly, NOT a point where the session must hand off.
Each step still persists its own state to `CHUNK.md` before the next starts, and a commit still
lands at every step completion (see "Write Order" and "Git Protocol"). What has changed is the
stopping policy: **a single session now runs continuously across these group boundaries — and
across chunk boundaries.** It stops only when (a) it reaches a human-input gate — it needs the user
to answer a question or to test/playtest something — (b) the harness surfaces a context-low warning
(the 60% low-water mark below), or (c) an automated step hits an unrecoverable or stuck state it
cannot resolve on its own (a gate that keeps failing and `repair` cannot fix, a subagent that dies
on a terminal error, a typecheck that will not go green) — which it surfaces to the user rather than
looping or plowing ahead. Between those points it flows straight through: after `ask` approval it
runs `build → test → audit → repair` and stops at `playtest`; after `playtest` (and any `revise`
loop) it runs `close`, stops at close's sketch-tail delta gate **only if that gate needs approval**,
and then — see "Cross-chunk continuation" below — rolls straight into the next chunk rather than
ending the session.

**Human-input gates that DO stop the session:**

- The `ask` approval gate — the full 4-part presentation ceremony; the user approves the
  interpretation before `Status: approved` is written and `build` begins.
- The `playtest` human-verification gate — the human plays the numbered test script and confirms it
  item-by-item; no subagent can stand in for this.
- A **redteam refuted-twice escalation** — a claim refuted twice is by definition an ambiguity,
  raised to the user as a plain-language question and recorded in `RULINGS.md` (see "Redteam
  Escalation").
- A **repair round-3 triage** — after 3 audit rounds any remaining findings are triaged with the
  user: real blocker, defer, or refuted (see "Repair Loop Bound").
- The `close` sketch-tail delta approval gate — the user explicitly approves the tail's delta
  before SKETCH.md's `## Ordered Chunk List` is rewritten (never a silent rewrite).

Between these gates the session continues automatically across seams — it does not hand off after
each group. `close` belongs to group 4: the same session that runs the human playtest gate (and its
revise loop — `revise-1`, `revise-2`, … appended as needed until every this-chunk-defect item has a
recorded disposition) also closes the chunk — marking it verified, recording the verified commit
hash, and rolling up decisions. The group name's `revise` denotes that whole loop, not a hard cap
of one revision.

**Cross-chunk continuation (the chunk→chunk seam).** The boundary between one chunk's `close` and
the next chunk's `investigate` is itself a seam the session flows across, exactly like the four
intra-chunk group boundaries — it is NOT a session terminus. When `close` finishes (its bookkeeping
written, its sketch-tail delta gate resolved — approved if there was a delta, silently skipped if
there was none), the session does NOT stop and tell the user to re-invoke. Instead, if none of the
three stop conditions (a)/(b)/(c) above applies — the user has not said stop, context is below the
60% low-water mark, and no automated step is stuck — it re-enters `build-chunk.md` Step 2 (Resume
Routing), routes to the next chunk's first incomplete step (its `investigate`, lazily detailing the
tail entry first per Step 2's "Sketch-level tail-entry target"), and runs `investigate → redteam`
continuously, stopping at that next chunk's `ask` approval gate — a new chunk's first human-input
gate. (A light-path next chunk has no `ask`; it continues to that chunk's `playtest` gate, its first
human gate, instead. The mandated final-acceptance chunk dispatches `build/final-acceptance.md` per
"Final-acceptance chunk exception" below.) This is what makes the router a **loop over chunks**
bounded by human gates, context, and stuck-state — not a one-shot that halts after every `close`.
`close` still presents the next-chunk proposal and its resume command before continuing, so the user
always sees what is coming (and can say "stop") before that chunk's first gate; the printed command
is the resume path for the case where a stop condition *does* fire at this boundary.

**Context-low escape hatch.** "Context-low" has a concrete threshold: **60% of the context
window used.** Below 60%, the session keeps going — it does NOT stop, wrap up, or suggest a
`/clear` on a vaguer hunch that it is "getting long" (stopping at 40% because the work feels large
is exactly the premature bail this threshold exists to forbid). At or above ~60% used (or the
moment the harness surfaces a context warning earlier than that, whichever comes first), the
session finishes the step it is on, lets that step persist to `CHUNK.md` under the cold-resume
parse contract and commit per the git protocol, and then stops at that cold-resume checkpoint —
telling the user to run `/clear` and re-invoke `/bs-build-chunk`, which picks up at the first
incomplete step exactly where this one stopped. The 60% figure is a low-water mark, not a hard
interrupt: never abandon a step mid-write to hit it, and never blow far past it either — stop at
the next persisted checkpoint once crossed. The one thing that IS a real capability here is
reading the harness's own context-usage signal against this 60% line; a session must not stop on a
generic "this feels long" guess that ignores the actual percentage.

**Final-acceptance chunk exception.** The sketch's one mandated final-acceptance chunk (`templates/SKETCH.template.md` "## Mandated Chunks") has a fixed 4-item Step Checklist `[final-acceptance, playtest, revise, close]` (`build-chunk.md` "Final-acceptance chunk target"). Its leading `final-acceptance` content step — a coverage check plus a 7-point design-QA pass with a fresh-context agent dispatch and two human-narrated checks — is by far the heaviest single step in the skill. The seam between `final-acceptance` and `playtest` is therefore a first-class **resume checkpoint**: because that content step is so heavy it is the most likely place a context-low warning fires, and its sub-parts persist individually so a resume re-enters mid-pass rather than re-running the whole step. It is NOT a mandatory auto-stop — if context holds, the same session flows from `final-acceptance` straight into the `{playtest, revise, close}` group and stops at the human `playtest` gate that follows, exactly like any other chunk. See `build/final-acceptance.md` "Sub-Step Resumability and the Handoff Seam Before `playtest`" for the sub-part persistence that keeps a mid-pass crash resumable.
