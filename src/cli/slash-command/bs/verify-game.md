---
name: bs-verify-game
description: Re-verify an existing bs-built game's rulebook against its archived source, staging the re-transcription non-destructively for later comparison. Use against a project /bs-ingest-rules already scaffolded, not to build or rebuild a game.
---

# `/bs-verify-game` — Stage a Re-Transcription Pass

Cite `state-machine.md` rather than restating its rules — if you are extending this skill, link
to the relevant section instead of copying rule text. This file is a lean router: it detects
state, resolves the source, dispatches to `verify/source-resolution.md` and
`verify/staging-dispatch.md` for their heavyweight prose, and closes the run. It does not explain
the status enum, the consistency check, or the session lock inline — see
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of that.

**This skill does NOT rebuild the project.** It reads the archived rulebook, stages a fresh
re-transcription into a run-scoped, non-live directory, and records each completed unit through
the ledger CLI. It never runs a build, never edits a chunk, never writes a staged slice over a
live one, and never compares the staged output to what already exists. That comparison is a later
phase's job; this skill's job ends the moment staging closes. There is no flag or path anywhere in
this skill that writes staged output into a live location.

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
restate its four items.

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
takes it. A clean close (Step 3) releases the line to exactly `none`.

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

## Step 3: Close (VERIFY-02)

When `verify-run-status` reports every unit recorded, the pass closes:

- Record the run's staging path (`rulebook/.verify/<run-id>/slices/`) in the provenance block —
  staging is KEPT after this pass closes, never deleted; it is the evidence behind every later
  verdict.
- Commit per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Git Protocol").
- Release the session lock: rewrite `Session Lock:` in `SKETCH.md` to exactly `none`, the same
  clean-close release the chunk-build lock already uses.

**The pass ends here.** There is no comparison of the staged output to what already exists, no
classification, no verdict, and no promotion of a staged slice over a live one. Staging and
recording is the entire scope of this skill.

## Reference Files

This skill delegates its heavyweight, step-scoped prose to:

- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-resolution.md` — decision 1's gated adoption
  flow and the stop-and-ask rules
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/staging-dispatch.md` — run init, ledger-driven resume,
  fan-out dispatch into staging, per-unit recording, close

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
