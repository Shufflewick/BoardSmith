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

Divide the rulebook into page ranges the same way `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/
transcription.md`'s Fan-Out Dispatch section already does (page-count metadata only — never by
opening the rulebook content). Then run:

```
boardsmith verify-run-init --project <dir> --ranges '["{N}-{M}", ...]' --json
```

Take `runId`, `stagingDir`, and `ranges` from its JSON output. **The run-id is minted BY THE
COMMAND — it is never composed, estimated, or typed by this session.** This is the same discipline
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` applies to the session-lock timestamp
(`date -u +%Y-%m-%dT%H:%M:%SZ`, never fabricated), and it is the reason `verify-run-init` exists
as a command at all rather than as an instruction to "generate a run id." `--run-id` on this
command exists ONLY to target an existing run for resume — never to let this session hand it a
freshly-invented value on first init.

**The page-range decomposition is decided ONCE, at this first `verify-run-init` call, and
persisted as this run's dispatch-plan manifest (173-08 Task 2 / `173-PROOF.md` §4 Finding 1).** A
resuming `verify-run-init --run-id <runId>` call ALWAYS echoes back the manifest exactly as it was
first persisted — any `--ranges` it is passed again is ignored. Never re-derive the page-range
split by hand on resume; read it from this command's `ranges` field.

## Resume — Before Any Dispatch

Before dispatching anything, run:

```
boardsmith verify-run-status --project <dir> --run-id <runId> --json
```

Dispatch decisions are made at RANGE granularity, against `rangesPending`. **Do not decide what is
done by looking at which files exist in the staging directory.** A truncated slice from a crashed
write is indistinguishable, on disk alone, from a complete one — which is exactly why the ledger
exists (`173-CONTEXT.md` decision 9's rejected alternative). The ledger, not the filesystem, is the
only source of truth for what is recorded.

For each range in `rangesPending`:

- **If `recorded[]` contains NO unit tagged to this range** (a clean, never-dispatched range —
  including the case of a kill that landed before any subagent output existed): dispatch it fresh,
  as in the Dispatch section below.
- **If `recorded[]` DOES contain one or more units tagged to this range** (a range interrupted
  mid-dispatch — some units recorded, no `range-complete` marker yet): this is the exact
  non-determinism `173-PROOF.md` §4 Finding 1 reports. **Do not simply redispatch the range
  alongside its stale partial output** — that is what produced 5 recorded units for one page
  instead of 2. Instead, first supersede the stale units:

  ```
  boardsmith verify-run-record --run-id <runId> --reset-range {N}-{M} --project <dir> --json
  ```

  This appends a tombstone marker (never rewrites or deletes the stale lines — the ledger stays
  append-only) that excludes those units from every subsequent `recorded[]`. Only after the reset
  does this range get dispatched fresh, exactly like a never-dispatched range.

A range that already has a `range-complete` marker is in `rangesRecorded`, not `rangesPending` —
it is never touched again, and its units are never reset.

If `verify-run-status` reports a previously-recorded unit whose stored hash no longer matches the
file on disk (a tamper/crash warning, not a JSON field — see the command's own documented
behavior), treat that unit as unrecorded and re-dispatch its whole range exactly as above.

## Unit Granularity

WITHIN a dispatched range, dispatch at the same slice-unit granularity `${CLAUDE_SKILL_DIR}/../
bs-shared/ingest/transcription.md`'s fan-out already dispatches (decision 10) — cite it, do not
redefine a second unit boundary here. Using the same unit means a verify pass's ledger and an
ingest pass's slice set can never drift out of correspondence with each other. The RANGE
decomposition (which page spans get dispatched) is the manifest's job, decided once at init; the
UNIT decomposition WITHIN a range (how many slice files, and their names) is still the subagent's
content-driven call, unchanged from ingest's fan-out.

## Dispatch

For each pending range (per Resume above), dispatch one Task-tool subagent. **Do not compose, restate, or
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
archive) and `{N}`-`{M}` with the range being dispatched — a fresh-context Task subagent has no
inherited knowledge of where the source lives or which run it belongs to.

## Recording

After each subagent returns its structured summary, record EVERY unit its return names, tagging
each with the range you just dispatched:

```
boardsmith verify-run-record --run-id <runId> --unit <unitId> --slice <slicePath> --range {N}-{M} --project <dir> --json
```

using the `slicePath` field the subagent's return carries — the orchestrator records from that
returned field, it does not open the file to check it.

**Ordering rule and its reason:** `verify-run-record` itself refuses to record a slice it cannot
find, non-empty, on disk inside the staging directory — so a record can never precede the
completed write it describes. This is a structural guarantee of the command, not a sequencing
instruction this file is trusting the session to follow correctly.

**Once every unit the subagent's return named has been recorded, mark the range complete:**

```
boardsmith verify-run-record --run-id <runId> --complete-range {N}-{M} --project <dir> --json
```

Do this immediately, in the same turn — before dispatching the next range. A range with recorded
units but no `range-complete` marker is exactly the "interrupted mid-dispatch" state the Resume
section above has to detect and reset; marking completion promptly is what keeps that window
short.

### Orchestrator Records (never writes slices, never re-reads them)

The subagents write every staged slice; the orchestrator only records the completed units and the
range-complete marker via `boardsmith verify-run-record`. It does not accumulate `citedTerms[]`,
does not build an INDEX, and does not synthesize anything from the subagent's return beyond the
`slicePath` needed to record it — that synthesis is `/bs-ingest-rules` Step 3's job for a *live*
ingest, and this pass performs none of it. A verify pass's only durable output per unit is: the
staged file the subagent wrote, and the ledger record naming it.

## Close

When `boardsmith verify-run-status --run-id <runId> --json` reports `rangesPending` empty (every
manifest range is in `rangesRecorded`), this step is done and `verify-game.md` Step 3 (Close)
takes over. Staging is KEPT — nothing here deletes `rulebook/.verify/<runId>/slices/`, and there is
no comparison, no classification, and no promotion of a staged slice over a live one at this or
any later point in this file.
