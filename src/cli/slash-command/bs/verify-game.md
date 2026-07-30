---
name: bs-verify-game
description: Re-verify an existing bs-built game's rulebook against its archived source, staging the re-transcription non-destructively for later comparison. Use against a project /bs-ingest-rules already scaffolded, not to build or rebuild a game.
---

# `/bs-verify-game` — Stage a Re-Transcription Pass

Cite `state-machine.md` rather than restating its rules — if you are extending this skill, link
to the relevant section instead of copying rule text. This file is a lean router: it detects
state, resolves the source, dispatches to `verify/source-resolution.md`,
`verify/staging-dispatch.md`, `verify/classification-dispatch.md`, `verify/ruling-recheck.md`,
`verify/repair-dispatch.md`, `verify/derive-recheck.md`, and `verify/derive-compare.md` for their
heavyweight prose, and closes the run. It does not explain
the status enum, the consistency check, or the session lock inline — see
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of that.

**This skill does NOT run the BUILD pipeline's `investigate`/`redteam`/`ask`/`build` steps to
scaffold a new chunk** — that remains `/bs-build-chunk`'s job, not this skill's. It reads the
archived rulebook, stages a fresh re-transcription into a run-scoped, non-live directory, records
each completed unit through the ledger CLI, classifies each staged/live pair's rule delta, and —
since a `contradictory` verdict demands it — adjudicates and marks affected chunks rules-stale.
Repair (Step 6, below) MAY change an EXISTING stale chunk's already-built code — that is decision
12's explicit seam into the impact map's VERIFY-06 gate — but nothing in this skill ever builds a
brand-new chunk from scratch.

Comparison happens in Step 3, below; no staged slice ever takes a live
one's place, at that step or any other. There is no flag or path anywhere in this skill that writes
staged output into a live location.

## Invocation

```
/bs-verify-game
```

No arguments. It runs against the bs-built project in the current directory.

## Context-Economics Hard Rule

**The orchestrator never opens a slice — staged or live.** This is enforced structurally, not by
this paragraph alone: the re-transcription subagent it dispatches (the same
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` contract `/bs-ingest-rules`
uses) writes its own output directly to the path it is given and RETURNs a structured summary
only — it never returns transcribed text. The orchestrator has no step anywhere in this skill
that reads a slice file back. The observable a reviewer can check: this skill's own transcript
should never contain a quoted-rule line, a `Derived (p.` line, or a `Visual (p.` line — those
strings exist only inside a written slice, staged or live, and this orchestrator never opens one.

## Step 0: State Detection and Lock (VERIFY-01)

On entry, before any other work, run the consistency check described in
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Consistency Check") — cite it, do not
restate its items.

**If this is not a bs-built project** — no `SKETCH.md`, no `rulebook/` — STOP and say so, naming
what was missing. Do not offer to build one; that is `/bs-ingest-rules`'s job, not this skill's.

Then handle the session lock per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Session
Lock"), reusing that EXACT mechanism — the same `SKETCH.md` `Session Lock:` line, the same
`date -u +%Y-%m-%dT%H:%M:%SZ` timestamp source, the same 24-hour staleness rule, the same
resume-refresh path. This is not a second lock; it is the existing one, with a verify-shaped
identity in the slug position: `verify:<run-id>` rather than a chunk slug (a verify pass has no
chunk to name). This position is prose-read — nothing in this repo parses it in code — and its
only job is to make a verify lock distinguishable at a glance from a chunk-build lock, so the two
can never silently overlap: a designer reading `Session Lock: verify:2026-07-28T22-00-00Z @
session-abc — locked at ...` knows immediately this is a verify run, not a chunk in progress, and
vice versa.

A lock naming the run being resumed (the same `run-id`) is refreshed and continued — the normal
resume path. Any other live, non-stale lock warns the user instead of silently proceeding. A lock
older than 24 hours is reported as stale and the user confirms clearing it before this session
takes it. A clean close (Step 8, below) releases the line to exactly `none`.

## Step 1: Source Resolution (VERIFY-01)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-resolution.md` for the full gated
adoption flow and the stop-and-ask rules governing which archived rulebook this pass verifies
against. In short: an already-archived source proceeds as-is, a single unarchived candidate at
project root is adopted only after the designer confirms, multiple candidates or no candidate at
all stop the session, and a hash mismatch against the archive is recorded as a signal and never
silently overwritten.

## Step 2: Staging Run and Re-Transcription (VERIFY-02, VERIFY-07, VERIFY-08)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/staging-dispatch.md` for the full run
allocation, ledger-driven resume, fan-out dispatch, and per-unit recording sequence. In short: a
`verify-run-init` call allocates (or resumes) a run-scoped staging directory, a
`verify-run-status` call decides exactly which units still need re-transcription, each needed
unit is dispatched to the shared transcription-subagent contract with its output directory set to
the staging path, and each completed unit is recorded via `verify-run-record` — never by trusting
what files exist on disk.

## Step 3: Classification (VERIFY-03, VERIFY-07)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md` for the full pair
enumeration, ledger-driven resume, per-pair subagent dispatch, and verdict recording sequence. In
short: a `verify-classify-pairs` call groups live and staged slices by page-span overlap, a
`verify-classify-status` call decides exactly which pairs still need classifying, each pending pair
is dispatched to the shared classification-subagent contract (the one place either slice is
legitimately read), and each returned verdict is recorded via `verify-classify-record` — never by
the orchestrator opening a slice itself. This step records verdicts only; acting on them — the
adjudication gate and the rules-staleness write — is Step 4's job, below.

## Step 4: Adjudication Gate and Impact Map (VERIFY-04, VERIFY-05, VERIFY-06)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/adjudication-gate.md` for the full
stop-and-ask presentation, the RULINGS.md/UNADJUDICATED write, the rules-staleness marker write,
and the impact-map report. In short: classification of all pairs completes first (Step 3, above),
then every `contradictory` verdict is presented at once and the pass STOPS until the designer
answers — there is no flag, option, or unattended-mode carve-out that skips this. A resolution
appends a `RULINGS.md` entry, or is recorded `UNADJUDICATED` if deferred or aborted; either way,
the rules-staleness marker is then written into each affected chunk's CHUNK.md and SKETCH.md and
the impact map is appended to the run's ledger. Finally the stale fraction and each chunk's
repair-gate disposition are reported — cite `verify-impact.ts`'s `REPAIR_GATE_DISPOSITIONS` for
the full enumerated set rather than restating its members here, since a restated list goes stale
the moment that array gains or loses a value. Cite `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
sections by name; restate nothing. This step still only decides WHICH chunks need repair; Step 6,
below, dispatches `verify/repair-dispatch.md` to actually perform it.

## Step 5: Ruling Re-Check (CHECK-01)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md` for the full judgment
contract. In short: every `RULINGS.md` entry without a resolved `supersededBy` (parsed once, via
`parseRulings` — the one ruling parser in this repo, never a second regex path) is dispatched, in
turn, to a fresh-context subagent carrying the `BS-RULING-RECHECK-V1` handshake token, together
with that ruling's own full body text (Decision/Citation/Rationale) and the fresh STAGED
transcription only — never the live `rulebook/` slices. Each subagent returns exactly one of
`still-needed`, `resolved-by-source`, `contradicted`, or `undetermined`, with mandatory reasoning,
recorded via `boardsmith verify-ruling-recheck`. This orchestrator never reads a ruling body or a
slice itself; it dispatches, then records exactly what comes back.

## Step 6: Repair Dispatch (CHECK-02)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/repair-dispatch.md` for the full route into
the existing build-pipeline audit/repair loop. In short: only chunks Step 4's impact map marks
`stale === true` are dispatched — never every chunk, and never a chunk this skill re-derives
staleness for on its own. For each, `boardsmith verify-repair`'s helpers resolve the chunk's fresh
STAGED slice paths and route it through `build/audit.md`'s three lenses (plus the 4th
design-review lens for `ui: touches|major` chunks) and `build/repair.md`'s bounded loop — reused
by reference, never forked. Each verify pass opens a fresh 3-round budget per chunk, appended
after that chunk's existing rounds, never renumbering history. Once every finding across the
episode's rounds has a disposition, the repair-gate disposition is re-derived from the freshly
re-checked post-repair code state — never Step 4's pre-repair snapshot — because repair MAY change
an existing chunk's code: a chunk whose code changed during repair re-opens the human playtest
gate, and a chunk that passes the lenses unchanged closes without re-playtesting.

## Step 7: Derived-Line Re-Check (CHECK-04)

In short: this check is independent of staleness and repair — it does not consume Step 4's
staleness verdicts and does not scope to the chunks Step 6 touched. Every `Derived` line surviving
`isPresentationLine` exclusion is enumerated PROJECT-WIDE, all of them, never scoped to stale
chunks. Each survivor is dispatched BLIND, carrying
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-recheck.md`'s `BS-DERIVE-V1` handshake and that
slice's quote lines only — never the original `Derived` line itself; the payload is built by
`buildBlindDerivePayload` (`verify-derive-recheck.ts`), which is structurally incapable of emitting
the target line's own text, not composed by this orchestrator reading a slice. A SEPARATE dispatch
then carries `${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-compare.md`'s `BS-DERIVE-COMPARE-V1`
handshake, the original line, and the blind subagent's already-recorded reading, and returns one of
the four `DERIVE_VERDICTS`. Both readings are recorded through `recordDeriveVerdicts`'s one atomic
ledger write, then reported by formatting `boardsmith verify-derive-recheck --json`'s output —
**formatted, never computed** by this skill, the same discipline Step 8's Close already holds.
Findings citing BOTH derivations verbatim are reported and exit 0 — a `disagrees` verdict is
advisory, never a Close gate.

## Step 8: Close (VERIFY-02)

When `verify-run-status` reports every unit recorded and `verify-classify-status` reports every
pair classified, the pass closes:

- Record the run's staging path (`rulebook/.verify/<run-id>/slices/`) in the provenance block —
  staging is KEPT after this pass closes, never deleted; it is the evidence behind every later
  verdict.
- Report the run's classification verdicts to the designer by formatting
  `verify-classify-status --json`'s output — **formatted, never computed** by this skill; every
  number in the report comes from the command's JSON, not from this skill's own arithmetic.
- Commit per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Git Protocol").
- Release the session lock: rewrite `Session Lock:` in `SKETCH.md` to exactly `none`, the same
  clean-close release the chunk-build lock already uses.

There is no promotion of a staged slice over a live one, at this or any earlier step.

## Reference Files

This skill delegates its heavyweight, step-scoped prose to:

- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-resolution.md` — decision 1's gated adoption
  flow and the stop-and-ask rules
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/staging-dispatch.md` — run init, ledger-driven resume,
  fan-out dispatch into staging, per-unit recording, close
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md` — pair enumeration,
  ledger-driven resume, per-pair subagent dispatch, verdict recording
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md` — the one judgment
  contract: the rule-delta decision procedure and the structured RETURN shape
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/adjudication-gate.md` — the hard adjudication gate,
  the rules-staleness write, and the impact-map sequence
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md` — CHECK-01's judgment contract: the
  four-verdict set, the absence-of-source trap, and the `BS-RULING-RECHECK-V1` dispatch handshake
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/repair-dispatch.md` — CHECK-02's route into
  `build/audit.md`'s three lenses and `build/repair.md`'s bounded loop, reused by reference
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-recheck.md` — CHECK-04's blind-derivation
  contract: the `BS-DERIVE-V1` dispatch handshake, the never-given list, and the
  `not-rule-bearing`/`underivable` non-value outcomes
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-compare.md` — CHECK-04's comparison contract:
  the `BS-DERIVE-COMPARE-V1` dispatch handshake, the four-verdict set, and the never-collapse rule
  for `underivable`/`not-rule-bearing`

And to the shared reference files that ship with every `bs-` skill:

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, consistency check, session
  lock, write order, authority
- `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` — the transcription contract
  this skill reuses UNCHANGED, parameterized by output directory (decision 15); it is never
  forked here

**Installed location:** this file installs as `.claude/skills/bs-verify-game/SKILL.md`. The
shared `verify/`, `ingest/`, and `state-machine.md` referenced above install under the
`bs-shared/` namespace root alongside `bs-verify-game/` — one directory up from this file then
into `bs-shared/`, at `.claude/skills/bs-shared/verify/`, `.claude/skills/bs-shared/ingest/`, and
`.claude/skills/bs-shared/state-machine.md`. `${CLAUDE_SKILL_DIR}` is Claude Code's built-in
substitution for "the directory containing THIS skill file," resolved to an absolute path before
the model ever sees the content — so `${CLAUDE_SKILL_DIR}/../bs-shared/...` resolves correctly no
matter whether this skill is installed at the project (`.claude/skills/`) or personal
(`~/.claude/skills/`) level. The installer (`src/cli/commands/install-claude-command.ts`) MUST
preserve this layout — `verify/`, `ingest/`, and `state-machine.md` under the `bs-shared/` root
beside every `bs-*` skill directory under `.claude/skills/` — or update this paragraph.
