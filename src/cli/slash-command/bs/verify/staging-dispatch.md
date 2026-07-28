# Staging Run + Re-Transcription Dispatch (VERIFY-02, VERIFY-07, VERIFY-08)

This is `verify-game.md` Step 2's delegate — the verify-side sibling of
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md`. By the time this file runs, Step 1
has already resolved which archived source (`rulebook/source/<file>`) this pass verifies against.

## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never reads a staged slice, and it never re-reads one after a subagent writes
it.** Every fact this step needs about a re-transcribed unit — that it completed, its recorded
path — comes from `verify-run-record`'s return and the subagent's own structured summary, never
from opening the staged file. The single most tempting mistake here is adding a "let me
double-check the staged slice" read after a subagent returns. Do not do this. It silently
reintroduces the exact context-exhaustion failure mode this design exists to avoid — the same
failure `ingest/transcription.md` names for the live-slice case, applying here to a staged one.

## Run Allocation

Run:

```
boardsmith verify-run-init --project <dir> --json
```

Take `runId` and `stagingDir` from its JSON output. **The run-id is minted BY THE COMMAND — it is
never composed, estimated, or typed by this session.** This is the same discipline
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` applies to the session-lock timestamp
(`date -u +%Y-%m-%dT%H:%M:%SZ`, never fabricated), and it is the reason `verify-run-init` exists
as a command at all rather than as an instruction to "generate a run id." `--run-id` on this
command exists ONLY to target an existing run for resume — never to let this session hand it a
freshly-invented value on first init.

## Resume — Before Any Dispatch

Before dispatching anything, run:

```
boardsmith verify-run-status --project <dir> --run-id <runId> --json
```

Dispatch re-transcription ONLY for the units absent from its `recorded[]` array.

**Do not decide what is done by looking at which files exist in the staging directory.** A
truncated slice from a crashed write is indistinguishable, on disk alone, from a complete one —
which is exactly why the ledger exists (`173-CONTEXT.md` decision 9's rejected alternative). The
ledger, not the filesystem, is the only source of truth for what is recorded.

If `verify-run-status` reports a previously-recorded unit whose stored hash no longer matches the
file on disk (a tamper/crash warning, not a JSON field — see the command's own documented
behavior), treat that unit as unrecorded and re-dispatch it exactly as if it had never run.

## Unit Granularity

Dispatch at the same slice-unit granularity `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/
transcription.md`'s fan-out already dispatches (decision 10) — cite it, do not redefine a second
unit boundary here. Using the same unit means a verify pass's ledger and an ingest pass's slice
set can never drift out of correspondence with each other.

## Dispatch

For each unresolved unit, dispatch one Task-tool subagent. **Do not compose, restate, or
summarize the transcription contract in the dispatch prompt.** The contract lives in
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md`; the subagent reads it
directly. Copy this pointer block byte-identical except the last line, filling `Write slices to:`
with the run's `stagingDir` instead of `rulebook/`:

```
BS-DISPATCH-V2

Read `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` in full and follow it
exactly.

Your page range: {N}-{M}
Rulebook path:   {rulebookPath}
Write slices to: {stagingDir}
```

**The `BS-DISPATCH-V2` token is required and the subagent validates it.** A dispatch without it is
rejected unread. This is not ceremony: sessions reliably read the pointer, then send a prompt
composed from memory instead — one that reproduces a superseded, shorter version of the contract.
You cannot produce the token from memory, so carrying it is the proof you copied this block rather
than recalled one. Copy the block; do not retype it from what you remember a transcription prompt
looking like.

Fill `{rulebookPath}` with the path recorded at `rulebook/source/<file>` (Step 1's resolved
archive) and `{N}`-`{M}` with the unit's range — a fresh-context Task subagent has no inherited
knowledge of where the source lives or which run it belongs to.

## Recording

After each subagent returns its structured summary, run:

```
boardsmith verify-run-record --run-id <runId> --unit <unitId> --slice <slicePath> --project <dir> --json
```

using the `slicePath` field the subagent's return carries — the orchestrator records from that
returned field, it does not open the file to check it.

**Ordering rule and its reason:** `verify-run-record` itself refuses to record a slice it cannot
find, non-empty, on disk inside the staging directory — so a record can never precede the
completed write it describes. This is a structural guarantee of the command, not a sequencing
instruction this file is trusting the session to follow correctly.

### Orchestrator Records (never writes slices, never re-reads them)

The subagents write every staged slice; the orchestrator only records the completed unit via
`boardsmith verify-run-record`. It does not accumulate `citedTerms[]`, does not build an INDEX,
and does not synthesize anything from the subagent's return beyond the `slicePath` needed to
record it — that synthesis is `/bs-ingest-rules` Step 3's job for a *live* ingest, and this pass
performs none of it. A verify pass's only durable output per unit is: the staged file the
subagent wrote, and the ledger record naming it.

## Close

When `boardsmith verify-run-status --run-id <runId> --json` reports every dispatched unit present
in `recorded[]`, this step is done and `verify-game.md` Step 3 (Close) takes over. Staging is KEPT
— nothing here deletes `rulebook/.verify/<runId>/slices/`, and there is no comparison, no
classification, and no promotion of a staged slice over a live one at this or any later point in
this file.
