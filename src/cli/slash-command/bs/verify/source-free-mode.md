# Source-Free Mode (VERIFY-09) — The Reduced Pass

This file is reached from exactly ONE place: `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-resolution.md`'s
Negative case, when no archived source exists at `rulebook/source/` and no candidate sits at the
project root either. **There is no flag anywhere in this skill that enters this file** — a project
that HAS source can never present as source-free (179-CONTEXT.md decision 1). A `--source-free`
flag would let someone claim reduced scope on a project that HAS source, which is
verification-skipping that still looks verified, and that is precisely what this file must never
become a path into. Entry here is a CONSEQUENCE of disk state alone, never a choice this skill, or
its caller, gets to make.

## What already ran

Steps 0 and 1 (`verify-game.md`) already ran before source-resolution.md's Negative case handed
off here: state detection, the session lock, and source resolution itself — the very check that
found nothing to resolve.

## Steps 2-6 do not run — they have no input

Re-transcription (Step 2), classification (Step 3), the adjudication gate and impact map (Step 4),
ruling re-check (Step 5), and repair dispatch (Step 6) each consume a FRESH RE-TRANSCRIPTION of the
archived source. With no source there is no fresh transcription for any of them to consume — these
steps have no input, not merely no appetite, and skipping them here is not a shortcut, it is the
only honest option available.

## What still runs, unchanged

In order:

1. `boardsmith trace-check --json` (CHECK-03) — source-free by construction since Phase 172.
2. `boardsmith drift-check --json` (CHECK-05) — source-free by construction since Phase 172.
3. `verify-game.md` Step 7 (CHECK-04, Derived-Line Re-Check), unchanged. Dispatch it exactly as
   written there — this file adds no second copy of that dispatch sequence.
4. `verify-game.md` Step 8 (CHECK-06, Worked-Example Replay), unchanged. Dispatch it exactly as
   written there.
5. Close (below).

All four are source-free by construction, not by configuration — the same discipline Phase 172 set
and Phases 177 and 178 both held. Nothing about which steps run is decided in this file; it is a
consequence of `verify-source-free-check`'s own computation, formatted below.

### CHECK-06's degraded bucket, by reference

For Step 8's dispatch here, every mismatch its findings surface lands in the not-source-verified
bucket, because `QuoteVerifiedProvenance` obtains no coverage without an archived source to check
a quote against. The VERDICT itself is never rewritten by that absence — a mismatch is still a
mismatch — but the finding is reported as a question about the quote, never an accusation against
the code (179-CONTEXT.md decision 3). This is `verify-example-replay`'s own gating, reused
unchanged; this file restates none of its mechanism.

## The unchecked-classes report — formatted, never computed

Run `boardsmith verify-source-free-check --json` and format its `uncheckedDefectClasses[]`, one
line per entry, naming the class and the check that would have caught it (`defectClass` and
`wouldHaveBeenCaughtBy`, verbatim from the command's JSON).

This file MUST NOT contain a hand-authored list of defect classes. The step-to-defect-class mapping
lives in exactly one place, `VERIFY_PIPELINE_STEPS` in `verify-source-free.ts` — a second copy here,
even a partial or reworded one, is exactly the drift-by-duplication failure this milestone has hit
repeatedly (179-CONTEXT.md decision 5). Nothing about scope, or what went unchecked, is declared by
this skill; both are read from the command.

## Close — exit 0, a reduced pass is a successful pass

The pass SUCCEEDS and exits with exit 0. A reduced pass is never a failure (179-CONTEXT.md decision 4) — the
absence of source is an honest, reportable fact about the project, not a defect in the pass itself.

The Close DISPATCHES:

```
boardsmith verify-close-record --project <dir>
```

**With no `--run`.** Source-free mode never allocated a staging run (Step 2 did not execute), so
there is no run ledger to name — supplying `--run` here would point at a run id that does not
exist. This is the same command `verify-game.md` Step 9's Close dispatches on the full path; only
the presence of `--run` differs between the two call sites.

That command writes the durable `## Verified Against` block for every chunk this pass evaluated,
recording `scope: code-conformance-only` with the unavailable-source reason from
`computeVerificationScope` — so a later reader of `CHUNK.md` sees the reduced scope directly,
without needing this session's transcript (179-CONTEXT.md decision 8). **This write is what makes
SC-3 true for the source-free path**: before it existed, a source-free pass computed its reduced
scope correctly and recorded that computation nowhere durable.

Three properties a reader needs to trust this write, each true by reference to the command rather
than by anything this file adds: it is idempotent — a re-run against unchanged state reports
`changed: false` for every chunk and writes no file; it touches nothing outside the fenced
`## Verified Against` block, so designer-authored `CHUNK.md` prose above and below the fence
survives untouched; and it is scoped to exactly the chunks this pass evaluated (derived from
`drift-check`'s own evaluated set), never a blanket rewrite of every chunk in the project.

Report the command's `recorded[]` and `errors[]` by FORMATTING its `--json` output — never
recomputed by this file. A chunk that could not be recorded is named in the Close report by its
slug, never silently dropped. A non-empty `errors[]` does NOT fail the pass; it is reported,
matching this skill's standing rule that a Close reports rather than gates.
