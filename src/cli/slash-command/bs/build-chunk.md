---
name: bs-build-chunk
description: Build, test, audit, and playtest the next smallest unit of a BoardSmith game per the approved sketch. Use to start or resume a chunk after /bs-ingest-rules has produced a sketch.
---

# `/bs-build-chunk` — Build the Next Smallest Unit

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, resolves the session lock, resumes at the first
incomplete step, routes full vs. light ceremony, and dispatches each step's heavyweight prose to
the matching reference file. It does not explain the status enum, the step names, the session
lock, the write order, or the session-handoff seams inline — see `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of
that.

Run to start or resume a chunk. One entry point, routed by state — there is deliberately no
separate verify command; verification is a step state inside the chunk.

## How to Talk to the Designer

Everything the designer reads — step narration, questions, gate presentations, close-out lines —
follows `${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`. In short: lead with what they need to do,
or say plainly that there's nothing; describe what changed in the game they can see, not in this
pipeline; keep internal ids, step names, file paths, ledger counts, and verdict spellings out of
the body; never narrate bookkeeping. An ordinary step completion is one to three sentences.

## Context-Economics Hard Rule

**The orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself.**
Every fact this router needs about a chunk's rules or code content comes from the structured
return-shape a dispatched subagent hands back — never by re-reading a slice or source file a
subagent just wrote. State files are different: `CHUNK.md` is a state file, and reading state
files is exactly the orchestrator's job (alongside dispatching subagents, recording results, and
talking to the user). In particular, the orchestrator reads the chunk-state sections the
group-1 steps consume — `## Interpretation` and `## Visibility Declaration` after the
investigate subagent writes them, plus `## Redteam Rounds` at the ask step (the persisted
verdicts and round dispositions the gate consumes, especially on a cold resume) — bounded to
this one chunk's state, never the slices or docs behind it — because that read is the
**sanctioned channel** that supplies the numbered claims list to the redteam dispatch
prompts and the ask presentation. The ban this rule enforces is on re-deriving content from
sources (slices, docs, code), not on reading chunk state. `${CLAUDE_SKILL_DIR}/../bs-shared/build/investigate.md` and
`${CLAUDE_SKILL_DIR}/../bs-shared/build/redteam.md` restate the source-reading ban because those are the two steps where the
temptation to "double-check by re-reading the sources a subagent just read" is strongest.

## Step 0: Entry — Ingest Synthesis Check + Consistency Check + Session Lock

On entry, before any other work, run:

```bash
npx boardsmith ingest-check
```

**This is not optional and it is not a formality.** If it exits non-zero it has already REPAIRED
`rulebook/` on disk, and the copy of `rulebook/INDEX.md` in your context is stale. Re-read
`rulebook/INDEX.md` and any slice it names before continuing, then re-run the command — it will
pass. Do not proceed to the consistency check on a non-zero exit.

Why this is here: `/bs-ingest-rules` never commits, so the pre-commit hook that performs ingest
synthesis has never run when you arrive. On 2026-07-28 a real ingest run ended with
`## Open Rules Gaps` holding 2 of the 5 gaps its own slices recorded, and zero `Derived (p.N):`
lines separated from presentation description. Investigate reads `INDEX.md`, so without this the
first chunk is designed against a rulebook index that is missing three named-but-undefined rules.
`ingest-check` is a no-op in a project whose synthesis is current, so it costs nothing to run.

Then run the consistency check described in `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
("Consistency Check"). Use literal `ls <file>` checks in the current directory, never
`**/glob` patterns that search subfolders.

Then resolve the session lock (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Session Lock"). **First, check for the released/no-lock
state:** if the lock line reads `Session Lock: none`, there is no live lock to classify — a
cleanly-closed chunk's terminal `close` write always leaves it there
(`${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md` "Bookkeeping Sequence"). Take the lock silently — write this session's
identity and a fresh `date -u +%Y-%m-%dT%H:%M:%SZ` clock-read — and continue; do NOT warn. This is
what stops the same-day false alarm after a clean close: a later same-day session resuming a
DIFFERENT next chunk finds `Session Lock: none`, not a stale-but-different lock, and never enters
the three outcomes below.

If the lock is NOT `none`, outcomes 1 and 2 below
compare the lock against **the chunk this session is about to resume**, so identify that target
first: from `SKETCH.md`'s ordered chunk list (a read the consistency check above already
performs), the resume target is the first chunk whose status is neither `verified` nor
`verified (user-waived)` — the same rule Step 2 applies when it routes. Only with that target
in hand can the lock be classified. Implement ALL THREE outcomes literally, never collapse them
into one branch:

1. **Same chunk resume** — the lock names the same chunk this session is about to resume.
   This is NOT stale and does not warn. Refresh the lock's timestamp (a fresh `date -u
   +%Y-%m-%dT%H:%M:%SZ` read) silently and continue.
2. **Different, live lock** — the lock is less than 24 hours old and names different work than
   this session is about to touch. This is a live concurrent session: warn the user instead of
   silently clobbering it, and stop for their decision before proceeding.
3. **Stale lock** — the lock's timestamp is more than 24 hours old, naming any chunk. Report it
   as stale to the user; the user confirms clearing it before this session takes the lock.

## Step 1: Conversational-Intent Probe (BUILD-01)

Before any step dispatch, intercept intents that are not "build the next thing":

- **"what's left?" / status questions** — answer self-contained from state files: read
  `SKETCH.md`'s ordered chunk list and, for the in-progress chunk, its `CHUNK.md` Status line
  and Step Checklist (all state files the orchestrator may read), then summarize what is
  verified, what is in progress (and at which step), and what remains. Never answer from memory
  or a partial read — read the state files first. This inline summary remains a valid quick
  answer, but for the fuller status view (waived-chunk batch-playtest proposals, asset debts,
  ideas backlog size, and the rest of the seven-item report), route the user to `/bs-check-status`.
- **"do the Chance cards next" / reordering intents** — route the user to `/bs-insert-chunk`,
  which re-validates dependency order, diffs citations against closed chunks, marks any
  invalidated pending `CHUNK.md` stale, and bumps the sketch version — never improvise a reorder
  by editing `SKETCH.md`'s ordered chunk list ad hoc here.
- **Neither matches** — continue to Step 2, the normal resume path.

## Step 2: Resume Routing (BUILD-01)

Read `SKETCH.md` → find the first chunk whose status is neither `verified` nor
`verified (user-waived)` (a waived chunk is closed — the user explicitly waived its playtest;
never resume it here — surfacing accumulated waived chunks for a batch playtest is
`/bs-check-status`'s job) → read that chunk's `chunks/<slug>/CHUNK.md` → route to the
**first incomplete step** on its Step Checklist (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Step Names"). A chunk whose
Status line reads `stale — re-derive before build` stops routing instead — see "Status Enum and
Stale Marker" below.

**Final-acceptance chunk target (checked BEFORE the generic tail-entry path below):** if the
resume target is the sketch's `## Mandated Chunks` final-acceptance chunk (the special sketch
chunk `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md`'s `## Mandated Chunks` section requires — the full game
played start-to-finish, a coverage check, and the design-QA/a11y pass), it is NOT an ordinary
chunk and does NOT route against the plain `full` or `light` Step Checklist the template ships.
Its Step Checklist is the group-4 gate with a leading content step:

- [ ] final-acceptance
- [ ] playtest
- [ ] revise
- [ ] close

Route to the **first incomplete item** exactly as everywhere else — that is what makes this
resumable: if `final-acceptance` is unchecked, dispatch `${CLAUDE_SKILL_DIR}/../bs-shared/build/final-acceptance.md` (its coverage
check + 7-point design-QA pass); once that content step is checked off, `playtest`/`revise`/`close`
run **on top of** it as the ordinary group-4 gate (`${CLAUDE_SKILL_DIR}/../bs-shared/build/playtest.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/revise.md`,
`${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md`), because the design-QA content becomes this chunk's playtest script — it never
replaces the human playtest/revise/close of the finished game.

**Why this rule runs first, and how the chunk is detailed:** the final-acceptance chunk is always
the LAST `## Ordered Chunk List` entry, so it is itself a sketch-level tail entry (`Status:
proposed (sketch-level — no CHUNK.md yet)`, no `chunks/<slug>/` directory) until routing first
reaches it. This rule therefore runs **before** the "Sketch-level tail-entry target" path below —
otherwise that generic path would pre-empt it and fill an ordinary `full`/`light` checklist,
defeating the detection on exactly the cold resume it exists to protect. When the final-acceptance
chunk is first detailed, detail it the same way the generic tail path details any entry (create
`chunks/<slug>/`, fill `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md`, rewrite the SKETCH.md tail line to the
derived-pointer form — `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Cold-Resume Parse Contract"; write order CHUNK.md
first, SKETCH.md second) with **two mandatory differences** from an ordinary fill: write
`## Ceremony: final-acceptance` (NOT `full`/`light`), and write the `## Step Checklist` as exactly
the four items above (`final-acceptance / playtest / revise / close`, NOT the template's 10-item
full or 3-item light list). `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md`'s CEREMONY-CONDITIONAL block recognizes
this third `final-acceptance` variant, so the physical file the router reads legitimately contains
the 4-item checklist and the per-step check-off discipline works against it. Detecting the
final-acceptance chunk here (rather than only when the previous chunk's `close` proposes it) is
what makes a cold session that resumes directly into the final-acceptance chunk dispatch
`${CLAUDE_SKILL_DIR}/../bs-shared/build/final-acceptance.md` instead of running it as an ordinary checklist chunk. See Step Group 4
and `${CLAUDE_SKILL_DIR}/../bs-shared/build/final-acceptance.md` for the content itself.

**Sketch-level tail-entry target:** if the resume target is a sketch-level tail entry —
`Status: proposed (sketch-level — no CHUNK.md yet)`, no `chunks/<slug>/` directory (by design;
the consistency check exempts tail entries) — the missing CHUNK.md is NOT a parse failure and
does not stop the session. **Carve-out:** if that tail entry is the sketch's mandated
final-acceptance chunk, do NOT use this generic path — detail it per the "Final-acceptance chunk
target" rule above (ceremony `final-acceptance`, the fixed 4-item checklist), never from the
plain `full`/`light` template. For every OTHER tail entry, CHUNK.md creation always happens here,
lazily, when routing first reaches the entry — `close` never creates a next chunk's CHUNK.md (its
`## Sketch-Tail Delta Gate` only re-derives tail *descriptions*, and its `## Propose the Next
Chunk` only names the next chunk; see `${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md` and WR-02's reconciliation). So this router
details the entry lazily before starting `investigate`: create `chunks/<slug>/`, derive the
chunk's CHUNK.md by filling `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md` from the SKETCH.md entry (slug, `## ui:`
tag, ceremony, cited slices — filling the template, never restructuring it), then rewrite the
SKETCH.md tail line to the derived-pointer form `Status (derived from chunks/<slug>/CHUNK.md):
proposed` (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Cold-Resume Parse Contract"; write order CHUNK.md first, SKETCH.md
second) — and only then route to `investigate` as the first incomplete step. Step 0's lock
classification uses this same derived target: a tail entry is still a nameable chunk slug for
lock purposes, so all three lock outcomes classify against it unchanged.

An **awaiting-playtest** chunk — one whose first incomplete Step Checklist item is `playtest`
(everything through `repair` checked on the full ceremony, or through `test` on the light path)
— is not a fresh start: this router's first move is to **re-pose the pending question verbatim**
— the exact test-script text already recorded in `CHUNK.md` — rather than restating it in new
words or silently re-running an earlier step. `Status: built` alone is NOT the test: a full-
ceremony chunk that has not yet run `audit`/`repair` also reads `Status: built`; only the
checklist position decides, per the first-incomplete-step rule above.

## Step 3: Ceremony Routing

Every chunk declares its ceremony in `CHUNK.md`'s `## Ceremony` field: `full`, `light`, or — for
the sketch's one mandated final-acceptance chunk only — `final-acceptance` (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
"Step Names"). **The `final-acceptance` chunk is exempt from this full/light ceremony routing:**
its step group is fixed by the "Final-acceptance chunk target" rule in Step 2
(`[final-acceptance, playtest, revise, close]`), so when `## Ceremony: final-acceptance` is read
here, skip the full/light routing below and defer to that Step 2 rule instead. For every other
chunk, quote both step lists verbatim — never paraphrase, never reorder:

**Full ceremony (10 steps, exact):**

`investigate, redteam, ask, build, test, audit, repair, playtest, revise, close`

**Light path (3 steps, exact):**

`build, test, playtest`

### Full-ceremony dispatch table

| Step | Dispatch target |
|------|------------------|
| investigate | `${CLAUDE_SKILL_DIR}/../bs-shared/build/investigate.md` |
| redteam | `${CLAUDE_SKILL_DIR}/../bs-shared/build/redteam.md` |
| ask | `${CLAUDE_SKILL_DIR}/../bs-shared/build/ask.md` |
| build | `${CLAUDE_SKILL_DIR}/../bs-shared/build/build.md` |
| test | `${CLAUDE_SKILL_DIR}/../bs-shared/build/test.md` |
| audit | `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md` |
| repair | `${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md` |
| playtest | `${CLAUDE_SKILL_DIR}/../bs-shared/build/playtest.md` |
| revise | `${CLAUDE_SKILL_DIR}/../bs-shared/build/revise.md` |
| close | `${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md` |

All 10 steps now have live dispatch targets: `${CLAUDE_SKILL_DIR}/../bs-shared/build/investigate.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/redteam.md`,
`${CLAUDE_SKILL_DIR}/../bs-shared/build/ask.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/build.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/test.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md`,
`${CLAUDE_SKILL_DIR}/../bs-shared/build/playtest.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/revise.md`, and `${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md` each implement their own step's
prose, and this router does no more than route to the right one.

### Light path (BUILD-12 — routing, not a step)

Chunks tagged `light` at proposal time run `build, test, playtest` only — no
`${CLAUDE_SKILL_DIR}/../bs-shared/build/light.md` file exists or is needed, because the light path is a routing decision over the
same `build.md`/`test.md`/`playtest.md` reference files, not a fourth ceremony with its own prose.
The user is explicitly **told which** ceremony is in effect when the chunk is proposed, so no one
discovers mid-chunk that fewer gates ran than they expected.

Light-path status transitions (cite `state-machine.md` "Step Names (exact, light path — trivial chunks)" — do not
restate the transition rule beyond this pointer): the light path has no `ask` step, so
`approved` is **unreachable** for light chunks — a light chunk moves `proposed → built` directly
when the user accepts the proposal and `build` + `test` complete. Because the light path has no
`close` step, `playtest` performs `close`'s bookkeeping for light chunks — the **four-item**
sequence `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Step Names (exact, light path — trivial chunks)" lists: bisect-anchor commit hash,
Status line update CHUNK.md-then-SKETCH.md, decision rollup, and the terminal session-lock
release to `Session Lock: none` (see `${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md`'s
`## Bookkeeping Sequence`, the exact sequence a light-path chunk runs on its own behalf). A
light-path chunk does **not** detail the sketch tail or propose the next chunk from inside
`playtest`: tail re-derivation is `close`'s user-gated `## Sketch-Tail Delta Gate`, which the
light path does not run. Instead Step 2's lazy tail-entry detailing above derives any undetailed
tail entry when routing next reaches it.

## Step Group 1 Dispatch — `{investigate, redteam, ask}`

This is the first of the four step groups (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Session Handoff Seams").
A session no longer hands off after each group — it runs continuously across the group boundaries
and stops only at a human-input gate or a harness context-low warning. Group 1's own stopping point
is the `ask` approval gate below; if the user approves, this same session continues into group 2
(`build → test`) rather than handing off.

**Every step persists before the next starts:** when a step completes, the orchestrator checks
off that step's item on CHUNK.md's Step Checklist (a state-file write) before dispatching the
next step — `investigate` is checked off after its return is recorded, `redteam` after its
`### Redteam Round N` entry lands in CHUNK.md's `## Redteam Rounds` (see `${CLAUDE_SKILL_DIR}/../bs-shared/build/redteam.md`
"Persisting the Round"), and `ask` as part of the gate's write order (see `${CLAUDE_SKILL_DIR}/../bs-shared/build/ask.md`
"Gate-Before-Write"). This is the state Step 2's first-incomplete-step routing routes on: an
unchecked step is re-run from scratch on a cold resume, so a completed-but-unchecked step would
duplicate work — never leave a completed step unchecked.

**investigate:** Delegate the entire investigate sequence to `${CLAUDE_SKILL_DIR}/../bs-shared/build/investigate.md` — reading
the chunk's cited slices, INDEX-discovered slices, `RULINGS.md`, `DECISIONS.md`, the relevant
BoardSmith docs, and (for `ui: touches|major` chunks) `DESIGN.md`, and writing the numbered
claims list and visibility declaration directly into `CHUNK.md`. Consume its return by the
pinned field names: `claimsList`, `visibilityDeclaration`, `newlyDiscoveredCitations` — the
return is a summary, never the full claims text. To hand the claims on, this router then reads
`CHUNK.md`'s `## Interpretation` and `## Visibility Declaration` directly — the sanctioned
state-file read defined in the Context-Economics Hard Rule above. That text is what gets
embedded verbatim as `{numberedClaimsList}` in each redteam dispatch prompt and later restated
in designer language at the ask step.

**redteam:** Delegate the entire redteam sequence to `${CLAUDE_SKILL_DIR}/../bs-shared/build/redteam.md` — three fresh-context
adversarial subagents (2 refuters + 1 coverage adversary) reviewing the claims list independent
of the investigator's framing. Consume the refuters' return by field name — `claimNumber`,
`verdict`, `objection` — and the coverage adversary's return by field name —
`missingInteractions` (itself keyed by `ruleDescription`, `citation`). Escalation logic
(refuted-once re-investigate bound, refuted-twice user escalation) is `${CLAUDE_SKILL_DIR}/../bs-shared/build/redteam.md`'s and
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Redteam Escalation"'s to own — this router only routes the aggregated
outcome to the next step or to the user.

**ask:** Delegate the ask-gate presentation to `${CLAUDE_SKILL_DIR}/../bs-shared/build/ask.md` — presenting the 4-part format
(interpretation, ambiguities, deferred list, zero implementation vocabulary), requesting assets,
and gating the write. **Gate-before-write** (cite `state-machine.md` "Write Order"): `ask`
presents, the user decides, and only after explicit approval does `Status: approved` get written
— last, never speculatively. A resumed session that finds `Status: approved` on disk therefore
knows a real approval happened; it never infers approval from anything else. Any `RULINGS.md`
entries from house-rule choices made during the ask conversation are likewise written only after
that same explicit approval. Investigate's claims list and visibility declaration are **not**
gated — they were already written progressively at the investigate step, per the same precedent
`ingest-rules.md` Step 7 established for `ASSETS.md`/`rulebook/00-visual-survey.md`.

End of group 1: the `ask` step is itself the human-input gate that stops this group — the session
pauses for the user's approval decision, not for a session handoff. When approval lands, confirm
everything written so far (claims list, the `## Redteam Rounds` entry, checked-off Step Checklist
items, `Status: approved`, SKETCH.md's updated derived-status pointer — CHUNK.md first, SKETCH.md
second, per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Write Order" — and any `RULINGS.md`/`ASSETS.md` entries) is
saved in the game folder, then **continue in this same session into group 2** (`build → test`) —
no handoff, no "run `/bs-build-chunk` again" prompt. Only a harness context-low warning interrupts
that continuation, in which case persist (already guaranteed) and tell the user to `/clear` and
re-invoke `/bs-build-chunk` to resume (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Session Handoff Seams").
This continuation is exactly what the **≥50% wind-down floor** (SKILLAUTO-06,
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Context floor + ceiling") protects: the group-2 dispatches below
(research the rulebook, audit findings, large reads, repairs) go to sub-agents rather than being
read inline by the orchestrator, so the main thread's own context fills slowly enough to clear the
50% floor before the 60% ceiling ever forces a stop.
If the redteam step hit a refuted-twice escalation earlier in this group, that is its own
human-input gate — the session stops there for the user's ruling before reaching `ask`.

## Step Groups 2–3 (dispatch prose lives in their own reference files)

Group 2 `{build, test}` and group 3 `{audit, repair}` are live dispatches, but unlike group 1
their per-step delegation, persistence discipline, and end-of-group close are authored inside
`${CLAUDE_SKILL_DIR}/../bs-shared/build/build.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/test.md`, `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md`, and `${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md` themselves rather than
restated here — those four files already carry their own "Referenced by `build-chunk.md` Step N"
framing and own their own round-persistence rules. This router's Step 3 dispatch table above names
each target file; there is nothing further to add here for groups 2-3.

## Step Group 4 Dispatch — `{playtest, revise, close}`

The last of the four step groups (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Session Handoff Seams"). This group
is reached by continuing from group 3 (`audit → repair`) in the same session — not by a handoff.
Its stopping points are human-input gates: the `playtest` human-verification gate below, and — if
it needs approval — `close`'s sketch-tail delta gate. The `revise` step may loop (`revise-1`,
`revise-2`, … — see `${CLAUDE_SKILL_DIR}/../bs-shared/build/revise.md` "Round-Bounding and Persistence") entirely inside
this one session; the group label's single `revise` denotes that whole loop, not a one-round cap.

**Every step persists before the next starts:** `playtest` checks off its own Step Checklist item
as part of its Verified-Checklist gate write (see `${CLAUDE_SKILL_DIR}/../bs-shared/build/playtest.md` "The Verified Gate"); a
`revise` round is persisted as a new `### Revise N` entry in CHUNK.md's `## Revision Rounds`
before looping back to `playtest` (see `${CLAUDE_SKILL_DIR}/../bs-shared/build/revise.md` "Round-Bounding and Persistence"); `close`
persists the verified commit hash and decision rollup before proposing the next chunk (see
`${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md` "Bookkeeping Sequence"). An unchecked or unpersisted step is re-run from scratch
on a cold resume — never leave a completed step's write pending.

**final-acceptance (the sketch's `## Mandated Chunks` final-acceptance chunk only):** before
`playtest` runs for that one special chunk, dispatch `${CLAUDE_SKILL_DIR}/../bs-shared/build/final-acceptance.md` for its coverage
check and 7-point design-QA pass (Step 2's "Final-acceptance chunk target" routes here on a cold
resume). Its output — the finished game played start-to-finish — becomes this chunk's `playtest`
script; the `{playtest, revise, close}` gate below then runs **on top of** that content, never in
place of it. Because this content step is exceptionally heavy, the final-acceptance chunk carries an
**extra** handoff seam ordinary chunks lack — but under the current stopping policy that seam is a
**resume checkpoint**, not a forced stop: if context holds, the same session flows from
`final-acceptance` straight into the `{playtest, revise, close}` gate and stops at the human
`playtest` gate that follows, exactly like any other chunk. The seam earns its "extra" status
because `final-acceptance` is the heaviest step and thus the most likely place a harness context-low
warning fires; its sub-parts persist individually so that if the session does yield there, a resume
re-enters mid-pass rather than re-dispatching the whole step (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
"Session Handoff Seams"; see `${CLAUDE_SKILL_DIR}/../bs-shared/build/final-acceptance.md` "Sub-Step Resumability and the
Handoff Seam Before `playtest`" for that per-sub-part persistence). An ordinary chunk has no
`final-acceptance` item on its Step Checklist and skips this step entirely.

**playtest:** Delegate to `${CLAUDE_SKILL_DIR}/../bs-shared/build/playtest.md`, which routes on its own Milestone/UI
Gate (SKILLAUTO-01): only a **milestone chunk with visible UI** (SKETCH.md's `Milestone:` flag is
`core-loop`/`scoring`/`final-acceptance` AND `ui:` is `touches`/`major`) gets the human-verification
gate — no subagent, the orchestrator narrates the numbered click-by-click test script directly to
the human and records their item-by-item confirmation. A non-milestone or UI-less chunk skips the
human stop entirely: `playtest.md` writes `Status: verified` off of `build/test.md`'s automated
test/sim pass and this group flows straight through to `close` with no session pause. If the human
confirms the whole milestone script clean, this group proceeds to `close`. If the human reports any
issue, this group proceeds to `revise` instead. A genuine rules-adjudication / open-question
escalation surfaced during this chunk's work always stops the session regardless of milestone/UI
status (`state-machine.md`'s human-gate list).

**revise (only if playtest surfaced an issue):** Delegate the 4-category triage to
`${CLAUDE_SKILL_DIR}/../bs-shared/build/revise.md` — every feedback item the human reported gets exactly one of the four
dispositions (this-chunk defect, future scope, not-built-yet, rules change), appended to CHUNK.md's
`## Revision Rounds`. Revise loops back to `playtest` for a targeted re-test of just the items this
round fixed, never a blind full re-test, until every this-chunk-defect item has a recorded
disposition.

**close:** Once `playtest` confirms the chunk clean (with or without an intervening `revise`
loop), delegate the bookkeeping and sketch-tail delta gate to `${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md` — recording the
verified commit hash, rolling up decisions, and presenting the sketch tail's delta (never a silent
rewrite) for the user's explicit approval before writing SKETCH.md's `## Ordered Chunk List`. A
light-path chunk (`build, test, playtest`, no `close` step of its own) runs this same bookkeeping
sequence from inside its own `playtest` step instead — see `${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md`'s `## Bookkeeping
Sequence` and the light-path note above.

End of group 4 (and of this chunk's lifecycle): `close`'s sketch-tail delta gate is the group's
human-input stopping point — it pauses for the user's explicit approval of the tail delta (when
there is one to approve). Confirm everything written so far (Verified Checklist, `## Revision
Rounds` entries if any, `## Verified Commit Hash`, `DECISIONS.md` rollup, the approved sketch-tail
delta, `Status: verified`/`verified (user-waived)`, SKETCH.md's updated derived-status pointer —
CHUNK.md first, SKETCH.md second) is saved in the game folder — a non-programmer-legible
checkpoint. From here, by default, **the same session auto-advances into the next chunk** — it
re-enters Step 2, routes to the next chunk's `investigate`, and runs continuously to that chunk's
`ask` gate (a new chunk's first human-input gate), per `state-machine.md` "Session Handoff Seams" →
"Cross-chunk continuation" (SKILLAUTO-04/05) — carrying the same auto-advance into the next logical
step across chunk types, including the generate-AI → final-acceptance progression. The printed
`/bs-build-chunk` re-invocation is the crash/context-fallback resume, never the default stop: it
only comes into play when a stop condition fires at this boundary — the user said stop, context has
crossed the 60% low-water mark, or an automated step is stuck/unrecoverable.

## Session Handoff Seams

**Autonomy is how, never what (PROC-02).** Everything below governs how this router keeps moving
— which step runs next, when a session stops and resumes. It never governs what the rulebook says:
a genuine rules ambiguity is always surfaced (batched, per the queue below) and never fabricated.
See `state-machine.md` "Autonomy Scope: How, Never What" for the full statement.

Cite `state-machine.md` "Session Handoff Seams" for the four group boundaries and the stopping
policy — do not restate them here. In short: the boundaries are cold-resume/persistence
checkpoints, not mandatory stops; a single session runs continuously across them — and across chunk
boundaries (after `close` it auto-advances straight into the next chunk's `investigate` and stops at
that chunk's `ask`, per `state-machine.md` "Session Handoff Seams" → "Cross-chunk continuation") —
and stops only at a human-input gate (`ask` approval, a redteam refuted-twice escalation, the
`playtest` gate, a repair round-3 triage, or `close`'s delta gate), when an automated step hits an
unrecoverable/stuck state, or when context crosses the **60%-used** low-water mark (see
`state-machine.md` "Session Handoff Seams" → "Context floor + ceiling" for the exact threshold
rule). This is the run-while-away model (SKILLAUTO-04): below 60% the session keeps going — it does
NOT stop early because the work feels large — and auto-advances into the next chunk and the next
logical step without the human re-invoking (SKILLAUTO-05). At/above ~60% used (or an earlier harness
context warning, or a stuck automated step), it finishes and persists the current step, then stops
at that cold-resume checkpoint and tells the user to `/clear` and re-invoke `/bs-build-chunk` to
resume — this printed re-invocation is the crash/context-fallback resume path, not a routine
end-of-session handoff.

**≥50% floor (SKILLAUTO-06).** Below 60% is necessary but not sufficient: the session must also
have consumed **at least 50%** of the context window before it winds down — never stop early
because a chunk "feels big" at 40%. A real harness context-low warning always wins, though: if the
harness itself signals below 50%, obey it immediately — the floor governs only the session's own
self-assessed "feels big" judgment, never an authoritative harness signal. The lever that keeps the
main thread's own usage climbing slowly enough to clear that 50% floor before the 60% ceiling forces
a stop is **sub-agent
offload**: research (rulebook slices, docs), audits, large reads, and repairs are dispatched to
sub-agents rather than performed inline, per this file's own "Context-Economics Hard Rule" above
("the orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself") — that
rule is the mechanism the offload rides on, and it is unchanged by this floor. See
`state-machine.md` "Session Handoff Seams" → "Context floor + ceiling" for the full framing.

Example one-line progress narration (style guide, not a script — one or two per group):

- Investigate: "Reading the trading rules and the rulebook's jail section together."
- Redteam: "Double-checking that reading against three independent reviewers."
- Ask: "Ready to walk you through what I found — here's the interpretation and a couple of
  questions."

## Git Protocol

Cite `state-machine.md` "Git Protocol" — commit at every step completion
(`chunk-<slug>/step-<name>`), revise rounds as `chunk-<slug>/revise-2` etc., and commit **before**
`build` starts (144's territory, but the protocol is cited here since this router names `build`
as the group-2 entry point).

## Status Enum and Stale Marker (cite, do not restate)

This router routes on the exact enum `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Status Enum (exact)" defines:
`proposed`, `approved`, `built`, `verified`, `verified (user-waived)`. A `CHUNK.md` whose Status
line reads `stale — re-derive before build` (set by `/bs-insert-chunk`) is never resumed as if it
were a normal pending chunk — this router stops and hands off to the re-derivation this stale
marker calls for rather than guessing which step to resume.

## Reference Files

This skill delegates its heavyweight, step-scoped prose to:

- `${CLAUDE_SKILL_DIR}/../bs-shared/build/investigate.md` — cited-slice + INDEX-discovered-slice reading, claims list +
  visibility declaration authoring
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/redteam.md` — 3-way fresh-context adversarial fan-out, escalation
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/ask.md` — 4-part presentation format, gate-before-write, asset requests
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/design-ask.md` — first-UI-chunk visual identity gate (Adopt/Derive/Original), writes
  DESIGN.md
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/build.md` — code-writing step, fresh-context raw-slice exception, per-file build
  manifest
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/test.md` — the test-step command sequence, sandbox-rule gate, a11y floor for UI chunks
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md` — 3 fresh-context adversarial lenses (fidelity, visibility, undo) +
  design-review dispatch for UI chunks, Findings Ledger round persistence
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md` — fix-or-refute-with-citation loop, round-bound enforcement, round-3 user
  triage
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/design-review.md` — the UI-chunk screenshot design-review agent dispatched by audit
  for `ui: touches|major` chunks; findings land in the same Findings Ledger
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/playtest.md` — the human-verification gate, no subagent, numbered click-by-click test
  script + item-by-item Verified Checklist
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/revise.md` — 4-category feedback triage loop, append-only Revision Rounds, loops back to
  playtest for a targeted re-test
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/close.md` — verified-commit-hash bookkeeping, decision rollup, and the sketch-tail delta
  gate before proposing the next chunk
- `${CLAUDE_SKILL_DIR}/../bs-shared/build/final-acceptance.md` — the sketch's mandated-chunk design-QA pass (7-point check +
  fresh-context automatable-checks dispatch), run **as the content of** the sketch's `## Mandated
  Chunks` final-acceptance chunk's `{playtest, revise, close}` group when that chunk is next: its
  coverage check and design-QA pass supply that chunk's playtest script, and the standard
  playtest/revise/close semantics still run **on top of** it (never in place of the human
  playtest/close of the finished game)

And to the shared reference files that ship with every `bs-` skill:

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, step names, consistency check, session lock, write order,
  authority, session handoff seams, git protocol
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md` — the file `investigate`/`redteam`/`ask` fill (claims list,
  visibility declaration, redteam rounds, Step Checklist check-offs, Status grammar; the
  findings ledger belongs to `audit`/`repair`)
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/RULINGS.template.md` — the ledger `ask`'s house-rule choices and redteam's
  refuted-twice escalations append to
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md` — the ledger `ask`'s asset requests append to

**Installed location:** this file installs as `.claude/skills/bs-build-chunk/SKILL.md`. The
shared `build/`, `templates/`, and `state-machine.md` referenced above install under the
`bs-shared/` namespace root alongside `bs-build-chunk/` — one directory up from this file then
into `bs-shared/`, at `.claude/skills/bs-shared/build/`, `.claude/skills/bs-shared/templates/`,
and `.claude/skills/bs-shared/state-machine.md`. `${CLAUDE_SKILL_DIR}` is
Claude Code's built-in substitution for "the directory containing THIS skill file," resolved to
an absolute path before the model ever sees the content — so `${CLAUDE_SKILL_DIR}/../bs-shared/build/...`
resolves correctly whether this skill is installed at the project (`.claude/skills/`) or
personal (`~/.claude/skills/`) level. The installer phase
(`src/cli/commands/install-claude-command.ts`) MUST preserve this layout — `build/`,
`templates/`, and `state-machine.md` under the `bs-shared/` root beside every `bs-*` skill
directory under `.claude/skills/` — or update this paragraph.
