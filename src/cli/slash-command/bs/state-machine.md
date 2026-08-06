# BS Skills — State-Machine Authority Rules

Every `bs-` skill (`bs-ingest-rules`, `bs-build-chunk`, `bs-check-status`, `bs-insert-chunk`, `bs-generate-ai`) cites this file rather than restating its rules. If you are authoring or extending a `bs-` skill, link to the relevant section below instead of copying rule text.

## Companion Authority: How Any of This Is Said

This file governs what the pipeline DOES. `reporting.md` governs what the designer READS, and the
two never mix: every enum value, marker, step name, lock grammar, and requirement tag defined below
is internal machinery. None of it belongs in a message to the designer — it gets translated into
what it means for their game (see `reporting.md` "Never in the Body"). A status write and the
sentence announcing it are separate acts with separate rules.

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

## Rules Staleness Marker

Rules-staleness is a SECOND, INDEPENDENT axis from the Status Enum above — NOT a new enum value. A `verified` chunk that goes rules-stale stays `verified`: a human really did playtest it, and that fact does not change. What changes is that the rulebook basis it was built and verified against has since moved underneath it. Folding the two together would multiply the Status Enum combinatorially (`built`+stale, `verified`+stale, `verified (user-waived)`+stale) and make every consumer parse a product space instead of two orthogonal facts.

The marker's two values:

`clear` | `rules-stale — rulebook moved since this chunk was verified`

(NOTE: the dash in `rules-stale — rulebook moved since this chunk was verified` is an em-dash "—", not a hyphen — the same convention as the stale marker above.)

It lives in a machine-owned fenced `## Rules Staleness` section in the chunk's own CHUNK.md (see `templates/CHUNK.template.md`), and is reflected as a DERIVED pointer in SKETCH.md's detailed entry (`- Rules Staleness (derived from chunks/<slug>/CHUNK.md): <value>`) — never an independently-decided value there, following the same Authority rule the Status line uses.

`boardsmith verify-impact-apply` is this marker's only writer. Only a successful repair close (see the repair-gating phase that owns re-checking stale chunks) clears it back to `clear` — a verify pass never clears it, and there is no manual clear path.

Distinct from the CHUNK-level stale marker above: `stale — re-derive before build` means "a PENDING chunk's CHUNK.md was invalidated by a sketch change — never built." The rules-staleness marker means the opposite situation: an already-built, already-playtested chunk whose rulebook basis has since moved. Both remain independently recognizable; neither is ever mistaken for the other.

## Step Names (exact, full ceremony)

The 11-step `/bs-build-chunk` pipeline, in order, is exactly:

`investigate, redteam, ask, spec, build, test, audit, repair, playtest, revise, close`

`spec` writes this chunk's executable tests from the ask-approved interpretation and observes them
FAILING before any implementation exists (`build/spec.md`); `build` then makes those exact tests
pass. The two are separate steps, with separate commits, specifically so the red-before-green claim
is auditable from git history rather than taken on faith.

## Step Names (exact, light path — trivial chunks)

Chunks tagged trivial at proposal time (e.g. "swap in the real card images") run the light path instead of the full 11-step ceremony:

`build, test, playtest`

The user is told which path is in effect when a chunk is proposed.

The light path has no `spec` step, and that is what bounds what may be tagged `light`: a chunk may
only be proposed as `light` if it introduces **no new game behavior** — no new action, no new rule,
no change to how an existing rule resolves. Asset swaps, restyles, and copy changes qualify; a
chunk with a rules claim to pin does not, and runs the full ceremony so its claims get tests before
code. If a `light` chunk turns out mid-build to need new behavior, that is a re-proposal (full
ceremony), not something `build` absorbs.

Light-path status transitions: the light path has no `ask` step, so `approved` is unreachable
for light chunks. A light chunk moves `proposed → built` directly when the user accepts the
proposal (proposal acceptance is the light path's ask-equivalent authorization gate) and
`build` + `test` complete; it then moves `built → verified` (or `verified (user-waived)`)
when the human confirms the playtest checklist. Because the light path has no `close` step,
for light chunks the `playtest` step also performs `close`'s bookkeeping: it records the
verified commit hash in CHUNK.md (the bisect anchor — see Git Protocol), records what the chunk
was verified against (`boardsmith chunk-check <slug>`, writing the machine-owned
`## Verified Against` block), updates the Status line (CHUNK.md first, SKETCH.md second, per
Write Order), rolls up decisions, reconciles the filings/library-gap, asset-debt, and
waived-chunk ledgers against what this chunk changed (SKILLAUTO-08, see `build/close.md`
"Bookkeeping Sequence" item 5), and — as the terminal write — releases the session lock
(`Session Lock: none`, see "Session Lock" above and `build/close.md` "Bookkeeping Sequence").

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

Where present, the rules-staleness marker (see "Rules Staleness Marker" above) parses against its own two-value set, independently of the `Status:` line — see Consistency Check item 5 below.

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
5. Where a chunk's CHUNK.md carries a `## Rules Staleness` marker (see "Rules Staleness Marker"
   above), it parses against its own two-value set (`clear` |
   `rules-stale — rulebook moved since this chunk was verified`) — separately from item 3's
   Status Enum check, since this marker never touches the `Status:` line. A malformed marker, a
   missing fence, or an unrecognized value here is ALSO a parse failure (stop and ask), exactly
   like item 3.

Any problems found are reported to the user, who confirms how to proceed, before the skill continues.

## Rulings Outrank Rulebook

Every agent that reads a rulebook slice — `investigate`, `redteam`, `audit` — also reads `RULINGS.md`. The rulebook plus `RULINGS.md` together form the composite source of truth. This is what stops an audit agent from "fixing" a deliberate house rule or adaptation back to the printed rule.

**Close-time re-touch (SKILLAUTO-08).** `RULINGS.md` is not a write-once log — it is a shared,
cross-session, per-game store every future chunk's `investigate`/`redteam`/`audit` reads. When a
fix lands during this chunk's work (a `revise` round, a `repair` cycle, or a build-time
correction) that resolves, supersedes, or narrows a ruling already recorded in `RULINGS.md`,
`build/close.md`'s ledger-reconciliation step (Bookkeeping Sequence item 5) re-touches that
ruling entry — updates it to reflect the outcome — rather than leaving `RULINGS.md` describing a
house rule the code no longer actually implements. A ruling entry that silently drifts from what
the code does is exactly the "paperwork lagging the code" failure this re-touch exists to
prevent; the same rulebook-plus-`RULINGS.md` composite-source-of-truth guarantee above only holds
if `RULINGS.md` itself stays current.

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
  not warn — this is the root fix for the same-day false-alarm defect (SKILLDEF-01).
- **The released-value classification rule (180-01 finding 2).** A lock VALUE — the text after
  `Session Lock: ` — classifies as RELEASED, never a live lock, under this exact mechanical test,
  applied in order:
  1. Trim surrounding whitespace.
  2. If the trimmed value is wholly wrapped in one pair of parentheses (starts with `(` and ends
     with `)`), strip that one outer pair before continuing.
  3. Read the LEADING TOKEN: every character from the start up to (not including) the first
     whitespace character, the first em dash (`—`), or the end of the string — whichever comes
     first. An ASCII hyphen (`-`) is NOT a token boundary — chunk slugs routinely contain hyphens
     (e.g. `player-movement`), so a bare hyphen can never be trusted to end a word.
  4. The value is RELEASED if and only if that leading token is exactly the four characters
     `none` (lowercase, case-sensitive — matching this file's case-sensitive `Status:` convention,
     "Cold-Resume Parse Contract" above). Anything else — including a token that merely CONTAINS
     `none` as a substring, or a value where the word `none` appears somewhere other than the
     leading token — is a LOCK, and is classified against the three staleness outcomes below,
     exactly like any other lock.

  This is a byte-level rule, not a semantic one: it exists so a human-written closing annotation
  next to the released marker (commentary about WHY or WHEN a project closed) can never be misread
  as an active lock, while a real lock's `<slug> @ <session-id> — locked at <ISO timestamp>`
  grammar — whose leading token is always the chunk slug, never `none` — can never be misread as
  released.

  - Worked example — bare release: `Session Lock: none` → leading token `none` → **RELEASED**.
  - Worked example — a real shipped project's cleanly-closed value (verbatim, from a game
    built with this pipeline): `Session Lock: (none — final-acceptance closed 2026-07-20; sketch complete except
    ai-opponent, deferred on BSR-12)` → outer parens stripped → leading token `none` (the em dash
    ends the token) → **RELEASED**, despite carrying no parseable ISO timestamp and none of the
    lock grammar below — this parenthetical is commentary, not a lock.
  - Worked example — a real lock: `Session Lock: "movement @ session-f3a1 — locked at
    2026-07-31T14:22:00Z"` → leading token `movement` → **LOCK**, classified against the three
    staleness outcomes below by its timestamp.
  - Worked adversarial example — a none-ISH value that MUST still classify as a lock:
    `Session Lock: "none-the-wiser @ session-ghost — locked at 2026-07-31T00:00:00Z"` → leading
    token `none-the-wiser` (the hyphen is not a boundary, so the whole slug-shaped word is read) —
    this is NOT the exact string `none`, so it is **LOCK**, never released, even though the
    substring `none` appears at its start. A rule that stopped at the first hyphen, or merely
    tested "starts with `none`", would misclassify this as released — this worked example exists
    specifically to pin against that mistake.
- **Staleness criterion** (evaluated by consistency-check item 4, and only ever reached for a
  value the rule above classifies as a LOCK): a lock is **stale** when its
  timestamp is more than 24 hours old — a crashed or abandoned session, not a live one; the
  session reports it and the user confirms clearing it. A lock naming the same chunk the
  entering session is resuming is **not** stale and does not warn — the session refreshes the
  lock's timestamp (a fresh `date -u +%Y-%m-%dT%H:%M:%SZ` read) and continues (this is the
  normal resume path). Any other lock (less than 24 hours old, naming different work) is treated
  as a live concurrent session and triggers the warning above.

## Git Protocol

- Commit at every step completion. Message convention: `chunk-<slug>/step-<name>` (e.g. `chunk-movement/step-build`).
- Revise rounds use `chunk-<slug>/revise-2` (etc.) as the commit message convention.
- Commit **before** `spec` starts, so work-in-progress is always distinguishable from the last verified baseline.
- `chunk-<slug>/step-spec` is the **RED anchor**: failing tests and signature-only stubs, no implementation. `chunk-<slug>/step-build` is GREEN. Never conflate them into one commit — that erases the only durable evidence the tests preceded the code (`build/spec.md` "Git Protocol").
- `close` records the verified commit hash in CHUNK.md — this is the bisect anchor for any later regression and the diff base for "what changed since the human last said yes."

## Repair Loop Bound

- Maximum **3 audit rounds** per chunk.
- Round N+1 auditors see the existing findings ledger (stable IDs) and report **only NEW findings** — they do not re-litigate findings already recorded.
- After round 3, any remaining findings are triaged with the user: real blocker, defer to a later chunk, or auditor was wrong (refuted).

## Redteam Escalation

- **Refuted once:** re-investigate with the specific objections attached. Maximum **one** re-investigate round.
- **Refuted twice:** that is by definition an ambiguity. Escalate to the user as a plain-language question; the ruling is recorded in `RULINGS.md`.
- Disputes go to the human, never to more agents.

## Autonomy Scope: How, Never What (PROC-02)

Every autonomy behavior this file and `build-chunk.md` describe — run-while-away, auto-advance,
the batched-question queue, the context floor/ceiling — governs **HOW** the game gets built: which
step runs next, when a session persists and stops, how open items get queued and surfaced. None of
it EVER governs **WHAT the rules of the game ARE.** Autonomy is a building-process lever, not a
rules-authorship license.

A genuine rules ambiguity — any point where the rulebook plus `RULINGS.md` do not determine the
answer, and (per `build/ask.md`'s Ask Triple-Gate) the choice is load-bearing with no reasonable
default — is always **surfaced** to the user: batched into the open-questions queue and presented
at the next human gate/milestone (see "Batched-question queue" below), or raised immediately if it
blocks the current chunk. It is **never fabricated** — no step, subagent, or orchestrator invents a
rule, guesses at a rules interpretation, or silently decides the rulebook's meaning on the human's
behalf, no matter how much unblocked work there is to keep moving on. This is the same
surface-don't-fabricate boundary the Cold-Resume Parse Contract enforces for state files ("the
session STOPS and asks the user... it never guesses the intended state") and the Redteam Escalation
enforces for adversarially-contested claims ("Disputes go to the human, never to more agents") —
autonomy widens *when* a session keeps going, it never widens *what* it is allowed to decide about
the rules.

## Session Handoff Seams (cold-resume checkpoints, not mandatory stops)

The four step groups are:

1. `{investigate, redteam, ask}`
2. `{spec, build, test}`
3. `{audit, repair}`
4. `{playtest, revise, close}`

Every one of the 11 full-ceremony steps belongs to exactly one group. These group boundaries are
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
runs `spec → build → test → audit → repair` into `playtest`, where it stops for the human client-playtest
gate ONLY if this chunk is one of the three milestone chunks with visible UI (see the `playtest`
bullet below, SKILLAUTO-01) — a non-milestone or UI-less chunk runs its internal `playtest`
verification (test/self-sim) and flows straight through into `revise`/`close` with no human stop.
After a human playtest stop (and any `revise` loop) it runs `close`, stops at close's sketch-tail
delta gate **only if that gate needs approval**, and then — see "Cross-chunk continuation" below —
rolls straight into the next chunk rather than ending the session.

**Human-input gates that DO stop the session:**

- The `ask` approval gate — the full 4-part presentation ceremony; the user approves the
  interpretation before `Status: approved` is written and `spec` begins.
- The `playtest` human-verification gate — **scoped to milestone chunks, not every chunk**
  (SKILLAUTO-01). SKETCH.md's `Milestone:` flag (`templates/SKETCH.template.md`'s "## Mandated
  Chunks", set at sketch-derivation time — see `ingest/sketch-derivation.md`) names exactly three
  milestone chunks: `core-loop`, `scoring` (game-end/scoring/winner-determination), and
  `final-acceptance`. Only a chunk whose `Milestone:` flag is non-`none` AND which has visible UI
  (its `ui:` tag is `touches` or `major`) routes to the human client-playtest stop — the human
  plays the numbered test script and confirms it item-by-item; no subagent can stand in for this.
  A chunk with no visible UI (`ui: none`) is NEVER routed to a human playtest, milestone or not.
  Every non-milestone chunk keeps all of its internal steps unchanged — `test`, `audit`, and its
  self-playtest/sim pass in `playtest` all still run exactly as before — only the *human*
  client-playtest stop moves off of it; the chunk auto-advances through `playtest` into `revise`/
  `close` without waiting on a human (see "Session Handoff Seams" and "Cross-chunk continuation"
  below). This gate ALWAYS fires regardless of milestone/UI status for a genuine rules
  adjudication / open question surfaced during that chunk's work — see the next bullet.
- A **genuine rules adjudication / open-question escalation** — always stops the session
  regardless of milestone status, whenever the rules themselves (not the build approach) are
  genuinely undetermined; recorded in `RULINGS.md`.
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

**Batched-question queue (SKILLAUTO-03 — the GSD-autonomous model).** Not every open item is a
human-input gate. An item that clears `build/ask.md`'s ask triple-gate (SKILLAUTO-02 —
genuinely undetermined AND load-bearing AND no reasonable default) but does not block THIS
chunk's own progress — because it concerns a later chunk, or a cross-cutting design choice this
chunk doesn't need settled to proceed — is appended to an open-questions queue instead of
stopping the session. **Unblocked work continues**: the session keeps building whatever chunks
and steps do not depend on the queued item's answer, exactly as it would if the item didn't
exist. The queue is not read one item at a time as it accrues; instead the whole batch **surfaces
at the next human gate/milestone** — the next `ask` approval presentation, the next milestone
`playtest` stop, or `close`'s sketch-tail delta gate, whichever comes first — presented together
rather than as a string of one-off interruptions. This is distinct from a **blocking** question: a
question this chunk's own design cannot proceed without still gates that chunk's `ask` directly
(`build/ask.md` "Ask Triple-Gate"), it is never queued past the chunk that needs it answered.

**Cross-chunk continuation (the chunk→chunk seam) — run-while-away + auto-advance (SKILLAUTO-04/
05).** The boundary between one chunk's `close` and the next chunk's `investigate` is itself a seam
the session flows across, exactly like the four intra-chunk group boundaries — it is NOT a session
terminus. When `close` finishes (its bookkeeping written, its sketch-tail delta gate resolved —
approved if there was a delta, silently skipped if there was none), the session does NOT stop and
tell the user to re-invoke. Instead, if none of the three stop conditions (a)/(b)/(c) above applies
— the user has not said stop, context is below the 60% low-water mark, and no automated step is
stuck — it **auto-advances**: the pipeline keeps making progress on reasonable defaults, bounded
only by the milestone gates (SKILLAUTO-01's three milestone chunks), a genuine rules adjudication /
open-question escalation, and the context/stuck-state conditions above — this is the run-while-away
model the human being away does not pause. It re-enters `build-chunk.md` Step 2 (Resume Routing),
routes to the next chunk's first incomplete step (its `investigate`, lazily detailing the tail
entry first per Step 2's "Sketch-level tail-entry target"), and runs `investigate → redteam`
continuously, stopping at that next chunk's `ask` approval gate — a new chunk's first human-input
gate. (A light-path next chunk has no `ask`; it continues to that chunk's `playtest` gate, its first
human gate, instead. The mandated final-acceptance chunk dispatches `build/final-acceptance.md` per
"Final-acceptance chunk exception" below.) Auto-advance is not limited to ordinary chunk-to-chunk
continuation: it carries into the next LOGICAL step across chunk types, including the **generate-AI
→ final-acceptance** progression — once a sketch's `bs-generate-ai` chunk closes, the same session
auto-advances into the final-acceptance chunk that follows it exactly as it would any other next
chunk, rather than stopping to let the human re-invoke between them. This is what makes the router a
**loop over chunks** bounded by human gates, context, and stuck-state — not a one-shot that halts
after every `close`. `close` still presents the next-chunk proposal before continuing, so the user
always sees what is coming (and can say "stop") before that chunk's first gate; the printed
`/bs-build-chunk` command is retained ONLY as a cold-resume/crash fallback for the case where a stop
condition *does* fire at this boundary — it is never the default end-of-close signal, and silence
from the user means auto-advance, not a wait for re-invocation.

**The ingest→build seam is a continuation seam too.** `/bs-ingest-rules` Step 7 writing `SKETCH.md`
and the first `CHUNK.md` files is the same kind of boundary as `close`→next chunk: durable, and NOT
a session terminus. The ingest session auto-advances into the first chunk's `/bs-build-chunk` work
and stops at that chunk's `ask` gate, subject to the identical (a)/(b)/(c) stop conditions and the
floor+ceiling below. See `ingest-rules.md` "Step 8: Continue Into the First Chunk".

**Context floor + ceiling (SKILLAUTO-06).** Two numbers govern context, and both must hold at
once: a **≥50% wind-down FLOOR** and the existing **60% "obey-the-harness-warning" CEILING**. These
numbers govern **every** `bs-` session — `bs-ingest-rules` as much as `bs-build-chunk`. The
floor comes first — **the session never winds down before at least 50% of the context window is
consumed.** Stopping earlier (e.g. at 40% because the work "feels big") is exactly the premature
bail this floor forbids, regardless of how the work "feels." Below 60%, the session keeps
going — it does NOT stop, wrap up, or suggest a `/clear` on a vaguer hunch that it is "getting
long" (the same premature-bail hunch the 50% floor forbids on the low end). At or above ~60% used
(or the moment the harness surfaces a context warning earlier than that, whichever comes first),
the session finishes the step it is on, lets that step persist to `CHUNK.md` under the cold-resume
parse contract and commit per the git protocol, and then stops at that cold-resume checkpoint —
telling the user to run `/clear` and re-invoke `/bs-build-chunk`, which picks up at the first
incomplete step exactly where this one stopped. The 60% figure is a low-water mark, not a hard
interrupt: never abandon a step mid-write to hit it, and never blow far past it either — stop at
the next persisted checkpoint once crossed. The one thing that IS a real capability here is
reading the harness's own context-usage signal against the 50% floor and the 60% ceiling; a
session must not stop on a generic "this feels long" guess that ignores the actual percentage.

**Precedence — a real harness warning always wins.** If the harness itself surfaces a context-low
warning *below* the 50% floor, obey it immediately: finish the current step, persist, commit, and
stop at that cold-resume checkpoint. The ≥50% floor governs only the session's OWN self-assessed
wind-down judgment (the unreliable "feels big" hunch it forbids); it never overrides an actual
harness signal. Authoritative harness signal beats the floor; the floor beats self-assessment.

**Sub-agent offload is the substantive lever that keeps the main thread under the 60% ceiling
while still clearing the 50% floor.** Heavy work classes — research, audits, large reads, and
repairs — are dispatched to sub-agents rather than performed inline by the orchestrator, so the
main thread's own context fills slowly across a long autonomous run instead of spiking on any one
step. This is the same mechanism `build-chunk.md`'s Context-Economics Hard Rule already codifies
("the orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself") —
that rule is what makes sub-agent offload possible in the first place, and it is preserved here
unchanged: the orchestrator reads structured return-shapes and chunk state, never the big stuff
behind them.

**Final-acceptance chunk exception.** The sketch's one mandated final-acceptance chunk (`templates/SKETCH.template.md` "## Mandated Chunks") has a fixed 4-item Step Checklist `[final-acceptance, playtest, revise, close]` (`build-chunk.md` "Final-acceptance chunk target"). Its leading `final-acceptance` content step — a coverage check plus a 7-point design-QA pass with a fresh-context agent dispatch and two human-narrated checks — is by far the heaviest single step in the skill. The seam between `final-acceptance` and `playtest` is therefore a first-class **resume checkpoint**: because that content step is so heavy it is the most likely place a context-low warning fires, and its sub-parts persist individually so a resume re-enters mid-pass rather than re-running the whole step. It is NOT a mandatory auto-stop — if context holds, the same session flows from `final-acceptance` straight into the `{playtest, revise, close}` group and stops at the human `playtest` gate that follows, exactly like any other chunk. See `build/final-acceptance.md` "Sub-Step Resumability and the Handoff Seam Before `playtest`" for the sub-part persistence that keeps a mid-pass crash resumable.
