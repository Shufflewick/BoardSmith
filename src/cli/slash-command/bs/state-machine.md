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
line (CHUNK.md first, SKETCH.md second, per Write Order), and rolls up decisions.

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

- `SKETCH.md` carries a lightweight session lock note: which chunk is in progress, plus a timestamp.
- A second concurrent session, on entry, sees the lock note and **warns the user instead of silently clobbering** the in-progress session's work.
- **Staleness criterion** (evaluated by consistency-check item 4): a lock is **stale** when its
  timestamp is more than 24 hours old — a crashed or abandoned session, not a live one; the
  session reports it and the user confirms clearing it. A lock naming the same chunk the
  entering session is resuming is **not** stale and does not warn — the session refreshes the
  lock's timestamp and continues (this is the normal resume path). Any other lock (less than
  24 hours old, naming different work) is treated as a live concurrent session and triggers
  the warning above.

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

## Session Handoff Seams (structural, not self-assessed)

A single session runs at most **one** step group, then hands off. The step groups are:

1. `{investigate, redteam, ask}`
2. `{build, test}`
3. `{audit, repair}`
4. `{playtest, one revise round, close}`

Every one of the 10 full-ceremony steps belongs to exactly one group. `close` belongs to
group 4: the session that runs the human playtest gate (and at most one revise round) also
closes the chunk — marking it verified, recording the verified commit hash, and rolling up
decisions — because close is cheap and splitting it into its own session would leave a
verified-but-unclosed chunk across a handoff.

Self-assessed "remaining context" is not a real capability — session budgets are structural, based on these fixed group boundaries, not on a session's own estimate of how much context it has left. If the harness surfaces a context warning, the session obeys it immediately regardless of which step group it's in.
