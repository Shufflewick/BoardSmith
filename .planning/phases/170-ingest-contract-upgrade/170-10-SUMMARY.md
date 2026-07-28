---
phase: 170-ingest-contract-upgrade
plan: 10
status: complete
requirements: [PROC-01, PROC-02, INGEST-01, INGEST-02, INGEST-03, INGEST-04]
date: 2026-07-28
---

# 170-10 — PROC-01 human gate: CLOSED

Two human-driven `/bs-ingest-rules` runs on 2026-07-28. Run 1 failed three of nine items; Run 2,
against the repaired contract, passed all nine on the as-left tree. Full evidence — pasted outputs,
by-hand (i) adjudication, the harness-vs-human comparison, and findings — is in
**`170-PROOF-RUN-2.md`**, which is the PROC-01 record. This file is the disposition.

## Outcome

| Item | Run 1 | Run 2 |
|---|---|---|
| (a) archive exists | PASS | PASS |
| (b) archive hash | PASS | PASS |
| (c) hash recorded | PASS | PASS |
| (d) header block | PASS | PASS |
| (e1) gaps heading | PASS | PASS |
| (e0) gaps machine-owned | n/a (did not exist) | PASS |
| (e2) reconciliation | **FAIL — 2 entries vs 5 markers** | PASS — 7 = 7 |
| (f) tables intact | PASS | PASS |
| (g) reference repo unmodified | PASS | PASS |
| (h) Visual/Derived both present | **FAIL — Visual=0** | PASS — Visual=3, Derived=12 |
| (i) derived purity | **FAIL — card-art line filed Derived** | PASS, 3 tuning notes |

Gate items (j) and (k) from `170-10-PLAN.md` were **not run** in either gate. They assert
`## Line-kind receipt` blocks and an invented-heading rule from Plans 07/08, whose mechanisms
`170-MECHANISMS.md` records as refuted and removed. Enforcing them would fail a correct run. The
applied bar is `170-03-PLAN.md`'s (a)–(i), which both documents name as live.

The plan's second precondition — `170-PROC-02.md` opening with `CLOSED` — was unsatisfiable: that
file does not exist, nor does `170-HARNESS-PASS-INDEX.md`, also referenced by the plan's context
block. Both are stale references from the pre-solve plan set.

## Root cause of the Run 1 failure

`boardsmith init` installs a pre-commit hook that performs ingest synthesis, and the bs- build
protocol commits at every chunk step — but **`/bs-ingest-rules` contains no commit at all**. A real
ingest run therefore ends with the hook never having fired. Run 1's orchestrator filled
`## Open Rules Gaps` by hand instead, with 2 entries against 5 slice markers, and the result was
undetectable by reading: both entries were real gaps, correctly worded. `/bs-build-chunk` reads
`INDEX.md` during investigate, before its own first commit, so chunk 1 was being planned against
that index.

The harness passed all of this because its `assert` step ran `git commit` itself, justified in a
code comment as *"the commit is something the pipeline genuinely performs."* It doesn't.

## What shipped

`92f88bb9` — close the ingest-synthesis window:
- `## Open Rules Gaps` fenced as machine-owned (`<!-- boardsmith:gaps:begin/end -->`).
  `ingest-gaps` writes only between the fences and refuses if they are gone.
- `boardsmith ingest-check` — repairs synthesis, then exits non-zero. Wired into
  `/bs-build-chunk` Step 0. Repair-then-fail is deliberate: a silent repair leaves the session
  holding the `INDEX.md` it already read, and a follow-up command is what this pipeline has never
  executed. The non-zero exit forces the re-read; the retry passes.
- Harness `assert` restructured into three phases — assert as-left, run `ingest-check` as
  build-chunk does, then gate.
- `derived-purity` lexicon extended for card-art description. `numeral`, `pip`, and `card face`
  deliberately excluded: each can name a rule-bearing property.
- `scaffold.md`'s first `boardsmith init` occurrence carried the bare form while later paragraphs
  specified `--rulebook`; two consecutive live runs reported the bare form as "what the doc says".

`c32bc184` — assert reconciliation on the as-left tree:
- Found by auditing the previous commit's own 11/11 harness run, which did not add up. (e0) proves
  the fences survived but is fooled by marker-shaped lines written *between* intact fences. What
  separates hand-written from swept is the **count**, not the shape — and (e2) was still being
  derived from the post-repair tree, where both sides are equal by construction.
- (e2) joins (e0) on the as-left tree; semantics become "pristine `_None._`, or exactly equal". The
  empty exemption is load-bearing: ingest deliberately no longer synthesises, so an unfilled fenced
  section is the correct post-ingest state. Partial fills still fail.
- Fixed a bug that change surfaced (caught by its own test): the multi-line `MACHINE-OWNED`
  comment leaked into the body scan, so a pristine `_None._` project read as non-empty.

Tests 3323/3323. The card-art relabel test was verified RED against the pre-fix lexicon; the
partial-fill path was verified end-to-end against a real `boardsmith init` scaffold, not fixtures
alone.

## What Run 2 proved, and what it didn't

**Proved.** The fence changed behaviour at the point it was designed to. Run 2's session had a
clear motive to tidy the gaps section — four of its seven entries are artifacts of the p.2 slice
being read in isolation — recognised it, and declined: *"The sweep is deliberately
non-deduplicating, so I've left them alone rather than hand-editing a machine-owned section."* It
then ran the sweep itself, with **one commit in the repo** (the scaffold), so the hook played no
part. First run in this phase's history where the tree was correct with no harness intervention.

**Not proved.** `/bs-build-chunk` Step 0's `ingest-check` call was never exercised — the gate stops
at end of Step 3. It is skill text, and this phase's central finding is that skill text does not
convey mechanics. It is a backstop for a window Run 2 did not enter; the first real
`/bs-build-chunk` run settles it. Also: one run is one sample, and a single green has misled this
phase before.

## Findings carried forward

- **F-1** `--edition` lets a free-text paraphrase (`none stated in rulebook`) displace the
  machine-checkable `EDITION_UNKNOWN` sentinel. Not a gate failure; but v4.9's PROV requirements
  read this field and can no longer distinguish "none stated" from an edition so named. Fix in
  Phase 171.
- **F-2** The relabel lexicon misses *negative* visual claims (`02-solo:33`). Extending it means
  adding the referential terms deliberately excluded to avoid false positives on rule-inferred-from-
  diagram lines. Recommend deferring to Phase 177 (CHECK-04), which classifies on content.
- **F-3** Two runs made opposite scope calls on `boardsmith.json`'s stub `description`/`playtime`.
  The skill text does not say who owns that file after `init`.

## On the harness

Run 2 was deliberately **not** gated on a green harness run, at the operator's direction, after the
harness certified a broken contract twice (three single-turn 10/10s before a 1/10 human run; 11/11
before Run 1's three failures) and was found to be manufacturing the commit that made one of those
greens possible.

Standing recommendation, recorded for phases 171–179: **the harness may inform; it must never again
gate whether a manual pass is run.** If it corroborates the next manual gate, that is the first time
it ever has, and it earns some standing back. If it disagrees again, retire it rather than patch it
a third time.

## Requirements closed

PROC-01, PROC-02, INGEST-01, INGEST-02, INGEST-03, INGEST-04 — marked Complete in
`REQUIREMENTS.md`. These were deliberately held `Pending` through the whole phase after two were
marked Complete prematurely earlier and had to be reverted; this gate is the closure that was
being waited for.
