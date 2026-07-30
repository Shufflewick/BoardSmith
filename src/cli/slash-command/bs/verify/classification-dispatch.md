# Classification Dispatch (VERIFY-03, VERIFY-07)

This is `verify-game.md` Step 4's delegate — the judgment half of verification. By the time this
file runs, Step 2/`staging-dispatch.md` has already staged a complete re-transcription pass for
this run; every pair this file classifies compares that staged output against the live rulebook it
was re-transcribed from.

## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never opens a slice, staged or live.** The classification subagent (`${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md`)
is the ONE place in this entire skill a slice is legitimately read. The temptation here is sharper
than Step 2's: comparing two things feels like it requires reading both of them yourself. It does
not — the subagent reads both slices and returns a structured verdict, nothing more. The observable
a reviewer can check is unchanged from Step 2's: this skill's transcript — the orchestrator's own
turns, the raw dispatch prompt, and the raw subagent return — contains no quoted-rule line, no
`Derived (p.` line, and no `Visual (p.` line.

## Pair Enumeration

```
boardsmith verify-classify-pairs --project <dir> --run-id <runId> --json
```

Take the pair set from its JSON output. **Never derive pairs by filename, never by reading
`INDEX.md`, and never by eyeballing the staging directory.** The two passes chose their own
filenames and their own section boundaries independently, so a live slice's pages and a staged
slice's pages correspond by page-span overlap alone — the only key both sides carry, computed by
this command. A pair group can be many-to-many (one live slice paired against several staged
files, or vice versa); an uneven file count across the two sides of a group is normal, not a
finding.

## Resume — Before Any Dispatch

```
boardsmith verify-classify-status --project <dir> --run-id <runId> --json
```

Dispatch only the pairs its `pendingPairs` field names. **The ledger, not the filesystem, is the
only source of truth for what is recorded** — the same discipline `staging-dispatch.md` holds for
re-transcription resume, restated here for comparison: do not decide what still needs classifying
by looking at which pairs seem obviously done.

`unpaired-slice` and `presentation-only` groups reported by `verify-classify-status` are **NOT**
dispatched to the subagent — there is nothing to classify on one side, or nothing rule-bearing on
either side. They are surfaced to the designer in Step 3's close report, not judged here.

## Dispatch

For each pending pair, dispatch one Task-tool subagent. **Do not compose, restate, or summarize the
classification contract in the dispatch prompt.** The contract lives in
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md`; the subagent reads it
directly. Copy this pointer block byte-identical, filling the three fields from the pair's JSON:

```
BS-CLASSIFY-V1

Read `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md` in full and follow it
exactly.

Pair id:      {pairId}
Live slices:  {liveSlicePaths}
Staged slices: {stagedSlicePaths}
```

**The `BS-CLASSIFY-V1` token is required and the subagent validates it.** A dispatch without it is
rejected unread, before the subagent opens either slice — the same reasoning
`staging-dispatch.md`'s `BS-DISPATCH-V2` handshake rests on: you cannot produce this token from
memory, so carrying it is proof the pointer block was copied rather than composed from what a
classification prompt is remembered to look like. Copy the block; do not retype it.

## Recording

For each subagent return, record its verdict:

```
boardsmith verify-classify-record --run-id <runId> --pair-id <pairId> --label <label> --evidence <text> --quoted-pass1 <text> --quoted-pass2 <text> --project <dir> --json
```

using exactly the fields the subagent's return carries — the orchestrator records from those
returned fields, it does not open a slice to check them. **Staleness and provenance are computed
by the command, never by this file** — this file must not compute, restate, or predict either one.

A missing or non-enumerated `label` is passed through as received; `verify-classify-record`
enumerates it as `unclassified`, which is conservative by design. **Never retry a dispatch with a
guessed label to make a pair look classified** — an honestly-`unclassified` pair surfaced to the
designer is the correct outcome when the subagent could not judge it.

## Close

When `boardsmith verify-classify-status --run-id <runId> --project <dir> --json` reports
`pendingPairs` empty, this step is done and `verify-game.md` Step 3 (formerly the Close step) takes
over. This phase records verdicts and nothing else: no marker is flipped in `CHUNK.md` or
`SKETCH.md`, no repair loop is opened, no human adjudication gate is run (Phase 175's work), and no
staged slice ever takes a live one's place.
