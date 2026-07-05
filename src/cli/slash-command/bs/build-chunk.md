# `/bs-build-chunk` — Build the Next Smallest Unit

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, resolves the session lock, resumes at the first
incomplete step, routes full vs. light ceremony, and dispatches each step's heavyweight prose to
the matching reference file. It does not explain the status enum, the step names, the session
lock, the write order, or the session-handoff seams inline — see `state-machine.md` for all of
that.

Run to start or resume a chunk. One entry point, routed by state — there is deliberately no
separate verify command; verification is a step state inside the chunk.

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
sources (slices, docs, code), not on reading chunk state. `build/investigate.md` and
`build/redteam.md` restate the source-reading ban because those are the two steps where the
temptation to "double-check by re-reading the sources a subagent just read" is strongest.

## Step 0: Entry — Consistency Check + Session Lock

On entry, before any other work, run the consistency check described in `state-machine.md`
("Consistency Check"). Use literal `ls <file>` checks in the current directory, never
`**/glob` patterns that search subfolders.

Then resolve the session lock (`state-machine.md` "Session Lock"). Outcomes 1 and 2 below
compare the lock against **the chunk this session is about to resume**, so identify that target
first: from `SKETCH.md`'s ordered chunk list (a read the consistency check above already
performs), the resume target is the first chunk whose status is neither `verified` nor
`verified (user-waived)` — the same rule Step 2 applies when it routes. Only with that target
in hand can the lock be classified. Implement ALL THREE outcomes literally, never collapse them
into one branch:

1. **Same chunk resume** — the lock names the same chunk this session is about to resume.
   This is NOT stale and does not warn. Refresh the lock's timestamp silently and continue.
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
  or a partial read — read the state files first. Tell the user the fuller status view ships as
  `/bs-check-status` (Phase 147); until it lands, this summary IS the status behavior.
- **"do the Chance cards next" / reordering intents** — forward reference: the insert/reorder
  behavior ships as `/bs-insert-chunk` (Phase 147). Until it lands, tell the user reordering
  is not wired up yet and stop for their decision — never improvise a reorder by editing
  `SKETCH.md`'s ordered chunk list ad hoc.
- **Neither matches** — continue to Step 2, the normal resume path.

## Step 2: Resume Routing (BUILD-01)

Read `SKETCH.md` → find the first chunk whose status is neither `verified` nor
`verified (user-waived)` (a waived chunk is closed — the user explicitly waived its playtest;
never resume it here — surfacing accumulated waived chunks for a batch playtest is
`/bs-check-status`'s job, Phase 147) → read that chunk's `chunks/<slug>/CHUNK.md` → route to the
**first incomplete step** on its Step Checklist (`state-machine.md` "Step Names"). A chunk whose
Status line reads `stale — re-derive before build` stops routing instead — see "Status Enum and
Stale Marker" below.

**Final-acceptance chunk target (checked BEFORE the generic tail-entry path below):** if the
resume target is the sketch's `## Mandated Chunks` final-acceptance chunk (the special sketch
chunk `templates/SKETCH.template.md`'s `## Mandated Chunks` section requires — the full game
played start-to-finish, a coverage check, and the design-QA/a11y pass), it is NOT an ordinary
chunk and does NOT route against the plain `full` or `light` Step Checklist the template ships.
Its Step Checklist is the group-4 gate with a leading content step:

- [ ] final-acceptance
- [ ] playtest
- [ ] revise
- [ ] close

Route to the **first incomplete item** exactly as everywhere else — that is what makes this
resumable: if `final-acceptance` is unchecked, dispatch `build/final-acceptance.md` (its coverage
check + 7-point design-QA pass); once that content step is checked off, `playtest`/`revise`/`close`
run **on top of** it as the ordinary group-4 gate (`build/playtest.md`, `build/revise.md`,
`build/close.md`), because the design-QA content becomes this chunk's playtest script — it never
replaces the human playtest/revise/close of the finished game.

**Why this rule runs first, and how the chunk is detailed:** the final-acceptance chunk is always
the LAST `## Ordered Chunk List` entry, so it is itself a sketch-level tail entry (`Status:
proposed (sketch-level — no CHUNK.md yet)`, no `chunks/<slug>/` directory) until routing first
reaches it. This rule therefore runs **before** the "Sketch-level tail-entry target" path below —
otherwise that generic path would pre-empt it and fill an ordinary `full`/`light` checklist,
defeating the detection on exactly the cold resume it exists to protect. When the final-acceptance
chunk is first detailed, detail it the same way the generic tail path details any entry (create
`chunks/<slug>/`, fill `templates/CHUNK.template.md`, rewrite the SKETCH.md tail line to the
derived-pointer form — `state-machine.md` "Cold-Resume Parse Contract"; write order CHUNK.md
first, SKETCH.md second) with **two mandatory differences** from an ordinary fill: write
`## Ceremony: final-acceptance` (NOT `full`/`light`), and write the `## Step Checklist` as exactly
the four items above (`final-acceptance / playtest / revise / close`, NOT the template's 10-item
full or 3-item light list). `templates/CHUNK.template.md`'s CEREMONY-CONDITIONAL block recognizes
this third `final-acceptance` variant, so the physical file the router reads legitimately contains
the 4-item checklist and the per-step check-off discipline works against it. Detecting the
final-acceptance chunk here (rather than only when the previous chunk's `close` proposes it) is
what makes a cold session that resumes directly into the final-acceptance chunk dispatch
`build/final-acceptance.md` instead of running it as an ordinary checklist chunk. See Step Group 4
and `build/final-acceptance.md` for the content itself.

**Sketch-level tail-entry target:** if the resume target is a sketch-level tail entry —
`Status: proposed (sketch-level — no CHUNK.md yet)`, no `chunks/<slug>/` directory (by design;
the consistency check exempts tail entries) — the missing CHUNK.md is NOT a parse failure and
does not stop the session. **Carve-out:** if that tail entry is the sketch's mandated
final-acceptance chunk, do NOT use this generic path — detail it per the "Final-acceptance chunk
target" rule above (ceremony `final-acceptance`, the fixed 4-item checklist), never from the
plain `full`/`light` template. For every OTHER tail entry, CHUNK.md creation always happens here,
lazily, when routing first reaches the entry — `close` never creates a next chunk's CHUNK.md (its
`## Sketch-Tail Delta Gate` only re-derives tail *descriptions*, and its `## Propose the Next
Chunk` only names the next chunk; see `build/close.md` and WR-02's reconciliation). So this router
details the entry lazily before starting `investigate`: create `chunks/<slug>/`, derive the
chunk's CHUNK.md by filling `templates/CHUNK.template.md` from the SKETCH.md entry (slug, `## ui:`
tag, ceremony, cited slices — filling the template, never restructuring it), then rewrite the
SKETCH.md tail line to the derived-pointer form `Status (derived from chunks/<slug>/CHUNK.md):
proposed` (`state-machine.md` "Cold-Resume Parse Contract"; write order CHUNK.md first, SKETCH.md
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
the sketch's one mandated final-acceptance chunk only — `final-acceptance` (`state-machine.md`
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
| investigate | `build/investigate.md` |
| redteam | `build/redteam.md` |
| ask | `build/ask.md` |
| build | `build/build.md` |
| test | `build/test.md` |
| audit | `build/audit.md` |
| repair | `build/repair.md` |
| playtest | `build/playtest.md` |
| revise | `build/revise.md` |
| close | `build/close.md` |

All 10 steps now have live dispatch targets: `build/investigate.md`, `build/redteam.md`,
`build/ask.md`, `build/build.md`, `build/test.md`, `build/audit.md`, `build/repair.md`,
`build/playtest.md`, `build/revise.md`, and `build/close.md` each implement their own step's
prose, and this router does no more than route to the right one.

### Light path (BUILD-12 — routing, not a step)

Chunks tagged `light` at proposal time run `build, test, playtest` only — no
`build/light.md` file exists or is needed, because the light path is a routing decision over the
same `build.md`/`test.md`/`playtest.md` reference files, not a fourth ceremony with its own prose.
The user is explicitly **told which** ceremony is in effect when the chunk is proposed, so no one
discovers mid-chunk that fewer gates ran than they expected.

Light-path status transitions (cite `state-machine.md` "Step Names (exact, light path)" — do not
restate the transition rule beyond this pointer): the light path has no `ask` step, so
`approved` is **unreachable** for light chunks — a light chunk moves `proposed → built` directly
when the user accepts the proposal and `build` + `test` complete. Because the light path has no
`close` step, `playtest` performs `close`'s bookkeeping for light chunks — the **three-item**
sequence `state-machine.md` "Step Names (exact, light path)" lists: bisect-anchor commit hash,
Status line update CHUNK.md-then-SKETCH.md, and decision rollup (see `build/close.md`'s
`## Bookkeeping Sequence`, the exact sequence a light-path chunk runs on its own behalf). A
light-path chunk does **not** detail the sketch tail or propose the next chunk from inside
`playtest`: tail re-derivation is `close`'s user-gated `## Sketch-Tail Delta Gate`, which the
light path does not run. Instead Step 2's lazy tail-entry detailing above derives any undetailed
tail entry when routing next reaches it.

## Step Group 1 Dispatch — `{investigate, redteam, ask}`

A single session runs at most one step group (`state-machine.md` "Session Handoff Seams"), then
hands off. This is the first of the four groups.

**Every step persists before the next starts:** when a step completes, the orchestrator checks
off that step's item on CHUNK.md's Step Checklist (a state-file write) before dispatching the
next step — `investigate` is checked off after its return is recorded, `redteam` after its
`### Redteam Round N` entry lands in CHUNK.md's `## Redteam Rounds` (see `build/redteam.md`
"Persisting the Round"), and `ask` as part of the gate's write order (see `build/ask.md`
"Gate-Before-Write"). This is the state Step 2's first-incomplete-step routing routes on: an
unchecked step is re-run from scratch on a cold resume, so a completed-but-unchecked step would
duplicate work — never leave a completed step unchecked.

**investigate:** Delegate the entire investigate sequence to `build/investigate.md` — reading
the chunk's cited slices, INDEX-discovered slices, `RULINGS.md`, `DECISIONS.md`, the relevant
BoardSmith docs, and (for `ui: touches|major` chunks) `DESIGN.md`, and writing the numbered
claims list and visibility declaration directly into `CHUNK.md`. Consume its return by the
pinned field names: `claimsList`, `visibilityDeclaration`, `newlyDiscoveredCitations` — the
return is a summary, never the full claims text. To hand the claims on, this router then reads
`CHUNK.md`'s `## Interpretation` and `## Visibility Declaration` directly — the sanctioned
state-file read defined in the Context-Economics Hard Rule above. That text is what gets
embedded verbatim as `{numberedClaimsList}` in each redteam dispatch prompt and later restated
in designer language at the ask step.

**redteam:** Delegate the entire redteam sequence to `build/redteam.md` — three fresh-context
adversarial subagents (2 refuters + 1 coverage adversary) reviewing the claims list independent
of the investigator's framing. Consume the refuters' return by field name — `claimNumber`,
`verdict`, `objection` — and the coverage adversary's return by field name —
`missingInteractions` (itself keyed by `ruleDescription`, `citation`). Escalation logic
(refuted-once re-investigate bound, refuted-twice user escalation) is `build/redteam.md`'s and
`state-machine.md` "Redteam Escalation"'s to own — this router only routes the aggregated
outcome to the next step or to the user.

**ask:** Delegate the ask-gate presentation to `build/ask.md` — presenting the 4-part format
(interpretation, ambiguities, deferred list, zero implementation vocabulary), requesting assets,
and gating the write. **Gate-before-write** (cite `state-machine.md` "Write Order"): `ask`
presents, the user decides, and only after explicit approval does `Status: approved` get written
— last, never speculatively. A resumed session that finds `Status: approved` on disk therefore
knows a real approval happened; it never infers approval from anything else. Any `RULINGS.md`
entries from house-rule choices made during the ask conversation are likewise written only after
that same explicit approval. Investigate's claims list and visibility declaration are **not**
gated — they were already written progressively at the investigate step, per the same precedent
`ingest-rules.md` Step 7 established for `ASSETS.md`/`rulebook/00-visual-survey.md`.

End of group 1: print the exact next command to run (`/bs-build-chunk`) and confirm everything
written so far (claims list, the `## Redteam Rounds` entry, checked-off Step Checklist items,
`Status: approved`, SKETCH.md's updated derived-status pointer — CHUNK.md first, SKETCH.md
second, per `state-machine.md` "Write Order" — and any `RULINGS.md`/`ASSETS.md` entries) is
saved in the game folder — non-programmer handoff.

## Step Groups 2–3 (dispatch prose lives in their own reference files)

Group 2 `{build, test}` and group 3 `{audit, repair}` are live dispatches, but unlike group 1
their per-step delegation, persistence discipline, and end-of-group close are authored inside
`build/build.md`, `build/test.md`, `build/audit.md`, and `build/repair.md` themselves rather than
restated here — those four files already carry their own "Referenced by `build-chunk.md` Step N"
framing and own their own round-persistence rules. This router's Step 3 dispatch table above names
each target file; there is nothing further to add here for groups 2-3.

## Step Group 4 Dispatch — `{playtest, revise, close}`

The last of the four session step groups (`state-machine.md` "Session Handoff Seams"). A single
session runs at most one step group, then hands off, same discipline as group 1. The `revise`
step may loop (`revise-1`, `revise-2`, … — see `build/revise.md` "Round-Bounding and
Persistence") entirely inside this one session; the loop never crosses the handoff seam, and the
group label's single `revise` denotes that whole loop, not a one-round cap.

**Every step persists before the next starts:** `playtest` checks off its own Step Checklist item
as part of its Verified-Checklist gate write (see `build/playtest.md` "The Verified Gate"); a
`revise` round is persisted as a new `### Revise N` entry in CHUNK.md's `## Revision Rounds`
before looping back to `playtest` (see `build/revise.md` "Round-Bounding and Persistence"); `close`
persists the verified commit hash and decision rollup before proposing the next chunk (see
`build/close.md` "Bookkeeping Sequence"). An unchecked or unpersisted step is re-run from scratch
on a cold resume — never leave a completed step's write pending.

**final-acceptance (the sketch's `## Mandated Chunks` final-acceptance chunk only):** before
`playtest` runs for that one special chunk, dispatch `build/final-acceptance.md` for its coverage
check and 7-point design-QA pass (Step 2's "Final-acceptance chunk target" routes here on a cold
resume). Its output — the finished game played start-to-finish — becomes this chunk's `playtest`
script; the `{playtest, revise, close}` gate below then runs **on top of** that content, never in
place of it. Because this content step is exceptionally heavy, the final-acceptance chunk carries an
**extra** handoff seam ordinary chunks lack: the `final-acceptance` content step is its own session
and `{playtest, revise, close}` is the next (`state-machine.md` "Session Handoff Seams"; see
`build/final-acceptance.md` "Sub-Step Resumability and the Handoff Seam Before `playtest`" for the
per-sub-part persistence that makes a mid-pass crash resume mid-pass instead of re-dispatching the
whole step). An ordinary chunk has no `final-acceptance` item on its Step Checklist and skips this
step entirely.

**playtest:** Delegate the entire human-verification gate to `build/playtest.md` — no subagent,
the orchestrator narrates the numbered click-by-click test script directly to the human and
records their item-by-item confirmation. If the human confirms the whole script clean, this group
proceeds to `close`. If the human reports any issue, this group proceeds to `revise` instead.

**revise (only if playtest surfaced an issue):** Delegate the 4-category triage to
`build/revise.md` — every feedback item the human reported gets exactly one of the four
dispositions (this-chunk defect, future scope, not-built-yet, rules change), appended to CHUNK.md's
`## Revision Rounds`. Revise loops back to `playtest` for a targeted re-test of just the items this
round fixed, never a blind full re-test, until every this-chunk-defect item has a recorded
disposition.

**close:** Once `playtest` confirms the chunk clean (with or without an intervening `revise`
loop), delegate the bookkeeping and sketch-tail delta gate to `build/close.md` — recording the
verified commit hash, rolling up decisions, and presenting the sketch tail's delta (never a silent
rewrite) for the user's explicit approval before writing SKETCH.md's `## Ordered Chunk List`. A
light-path chunk (`build, test, playtest`, no `close` step of its own) runs this same bookkeeping
sequence from inside its own `playtest` step instead — see `build/close.md`'s `## Bookkeeping
Sequence` and the light-path note above.

End of group 4 (and of this chunk's lifecycle): print the exact next command to run
(`/bs-build-chunk`) and confirm everything written so far (Verified Checklist, `## Revision
Rounds` entries if any, `## Verified Commit Hash`, `DECISIONS.md` rollup, the approved sketch-tail
delta, `Status: verified`/`verified (user-waived)`, SKETCH.md's updated derived-status pointer —
CHUNK.md first, SKETCH.md second) is saved in the game folder — non-programmer handoff, same as
group 1's close.

## Session Handoff Seams

Cite `state-machine.md` "Session Handoff Seams" for the four fixed group boundaries — do not
restate them here. A single session never crosses a seam even if it believes it has context
remaining: self-assessed "remaining context" is not a real capability; session budgets are
structural. If the harness surfaces a context warning mid-group, the session obeys it immediately
regardless of which step it is on.

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

This router routes on the exact enum `state-machine.md` "Status Enum (exact)" defines:
`proposed`, `approved`, `built`, `verified`, `verified (user-waived)`. A `CHUNK.md` whose Status
line reads `stale — re-derive before build` (set by `/bs-insert-chunk`) is never resumed as if it
were a normal pending chunk — this router stops and hands off to the re-derivation this stale
marker calls for rather than guessing which step to resume.

## Reference Files

This skill delegates its heavyweight, step-scoped prose to:

- `build/investigate.md` — cited-slice + INDEX-discovered-slice reading, claims list +
  visibility declaration authoring
- `build/redteam.md` — 3-way fresh-context adversarial fan-out, escalation
- `build/ask.md` — 4-part presentation format, gate-before-write, asset requests
- `build/design-ask.md` — first-UI-chunk visual identity gate (Adopt/Derive/Original), writes
  DESIGN.md
- `build/build.md` — code-writing step, fresh-context raw-slice exception, per-file build
  manifest
- `build/test.md` — the test-step command sequence, sandbox-rule gate, a11y floor for UI chunks
- `build/audit.md` — 3 fresh-context adversarial lenses (fidelity, visibility, undo) +
  design-review dispatch for UI chunks, Findings Ledger round persistence
- `build/repair.md` — fix-or-refute-with-citation loop, round-bound enforcement, round-3 user
  triage
- `build/design-review.md` — the UI-chunk screenshot design-review agent dispatched by audit
  for `ui: touches|major` chunks; findings land in the same Findings Ledger
- `build/playtest.md` — the human-verification gate, no subagent, numbered click-by-click test
  script + item-by-item Verified Checklist
- `build/revise.md` — 4-category feedback triage loop, append-only Revision Rounds, loops back to
  playtest for a targeted re-test
- `build/close.md` — verified-commit-hash bookkeeping, decision rollup, and the sketch-tail delta
  gate before proposing the next chunk
- `build/final-acceptance.md` — the sketch's mandated-chunk design-QA pass (7-point check +
  fresh-context automatable-checks dispatch), run **as the content of** the sketch's `## Mandated
  Chunks` final-acceptance chunk's `{playtest, revise, close}` group when that chunk is next: its
  coverage check and design-QA pass supply that chunk's playtest script, and the standard
  playtest/revise/close semantics still run **on top of** it (never in place of the human
  playtest/close of the finished game)

And to the shared reference files that ship with every `bs-` skill:

- `state-machine.md` — status enum, step names, consistency check, session lock, write order,
  authority, session handoff seams, git protocol
- `templates/CHUNK.template.md` — the file `investigate`/`redteam`/`ask` fill (claims list,
  visibility declaration, redteam rounds, Step Checklist check-offs, Status grammar; the
  findings ledger belongs to `audit`/`repair`)
- `templates/RULINGS.template.md` — the ledger `ask`'s house-rule choices and redteam's
  refuted-twice escalations append to
- `templates/ASSETS.template.md` — the ledger `ask`'s asset requests append to

**Installed location:** every relative path above (the `build/` step files, `state-machine.md`,
and `templates/`) resolves against the directory containing THIS skill file — the installer
copies the whole `bs/` tree as one unit, so the shipped layout is identical wherever it is
installed. (Installer-phase dependency: `src/cli/commands/install-claude-command.ts` does not
yet install the `bs-` skills; the phase that teaches it to MUST preserve this skill-file-relative
layout — `build/`, `templates/`, and `state-machine.md` siblings of this file — or update this
paragraph.)
