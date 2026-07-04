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
talking to the user). In particular, after the investigate subagent writes `CHUNK.md`'s
`## Interpretation` and `## Visibility Declaration`, the orchestrator reads those two sections —
bounded to this one chunk's claims, never the slices or docs behind them — because that read is
the **sanctioned channel** that supplies the numbered claims list to the redteam dispatch
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

- **"what's left?" / status questions** — route internally to the status behavior that will
  ship as `/bs-check-status` (Phase 147). Do not attempt to answer from a partial read; hand off
  to that behavior's logic.
- **"do the Chance cards next" / reordering intents** — route internally to the insert/reorder
  behavior that will ship as `/bs-insert-chunk` (Phase 147).
- **Neither matches** — continue to Step 2, the normal resume path.

## Step 2: Resume Routing (BUILD-01)

Read `SKETCH.md` → find the first chunk whose status is neither `verified` nor
`verified (user-waived)` (a waived chunk is closed — the user explicitly waived its playtest;
never resume it here — surfacing accumulated waived chunks for a batch playtest is
`/bs-check-status`'s job, Phase 147) → read that chunk's `chunks/<slug>/CHUNK.md` → route to the
**first incomplete step** on its Step Checklist (`state-machine.md` "Step Names"). A chunk whose
Status line reads `stale — re-derive before build` stops routing instead — see "Status Enum and
Stale Marker" below.

An **awaiting-playtest** chunk — one whose first incomplete Step Checklist item is `playtest`
(everything through `repair` checked on the full ceremony, or through `test` on the light path)
— is not a fresh start: this router's first move is to **re-pose the pending question verbatim**
— the exact test-script text already recorded in `CHUNK.md` — rather than restating it in new
words or silently re-running an earlier step. `Status: built` alone is NOT the test: a full-
ceremony chunk that has not yet run `audit`/`repair` also reads `Status: built`; only the
checklist position decides, per the first-incomplete-step rule above.

## Step 3: Ceremony Routing

Every chunk declares its ceremony in `CHUNK.md`'s `## Ceremony` field: `full` or `light`
(`state-machine.md` "Step Names"). Quote both step lists verbatim — never paraphrase, never
reorder:

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
| build | `build/build.md` — authored in Phase 144 |
| test | `build/test.md` — authored in Phase 144 |
| audit | `build/audit.md` — authored in Phase 145 |
| repair | `build/repair.md` — authored in Phase 145 |
| playtest | `build/playtest.md` — authored in Phase 146 |
| revise | `build/revise.md` — authored in Phase 146 |
| close | `build/close.md` — authored in Phase 146 |

Steps 4–10 are named here as forward references only — this router does not implement their
prose, and the drift test that pins this file does not require `build/{build,test,audit,repair,
playtest,revise,close}.md` to exist yet, only that this table names each path and its phase
marker. When Phase 144/145/146 land, each reference file is authored and this table's forward
references become live dispatches with no change to this router's routing logic.

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
`close` step, `playtest` performs `close`'s bookkeeping for light chunks (bisect-anchor commit
hash, Status line update CHUNK.md-then-SKETCH.md, decision rollup).

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
`Status: approved`, any `RULINGS.md`/`ASSETS.md` entries) is saved in the game folder —
non-programmer handoff.

## Step Groups 2–4 (forward reference)

Group 2 `{build, test}`, group 3 `{audit, repair}`, and group 4 `{playtest, one revise round,
close}` are dispatched identically in shape once their reference files exist — this router's
Step 3 dispatch table above already names each target file and its owning phase. Every group ends
the same way group 1 does: print the exact next command to run and confirm the game folder is
saved.

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

And, forward-referenced only (not yet authored):

- `build/build.md` — authored in Phase 144
- `build/test.md` — authored in Phase 144
- `build/audit.md` — authored in Phase 145
- `build/repair.md` — authored in Phase 145
- `build/playtest.md` — authored in Phase 146
- `build/revise.md` — authored in Phase 146
- `build/close.md` — authored in Phase 146

And to the shared reference files that ship with every `bs-` skill:

- `state-machine.md` — status enum, step names, consistency check, session lock, write order,
  authority, session handoff seams, git protocol
- `templates/CHUNK.template.md` — the file `investigate`/`redteam`/`ask` fill (claims list,
  visibility declaration, redteam rounds, Step Checklist check-offs, Status grammar; the
  findings ledger belongs to `audit`, Phase 145)
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
