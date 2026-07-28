---
phase: 173-verify-pipeline-core
plan: 04
subsystem: bs-skills-verify
tags: [skill-text, verify-pipeline, session-lock, gated-adoption, resume-ledger, transcription-reuse]

requires:
  - phase: 173-verify-pipeline-core (plan 02)
    provides: "verify-run-init / verify-run-record / verify-run-status CLI surface — the staging tree allocator and RUN.md resume ledger this skill's staging-dispatch.md invokes verbatim"
  - phase: 173-verify-pipeline-core (plan 03)
    provides: "ingest/transcription-subagent.md's output-directory dispatch input and the byte-identical BS-DISPATCH-V2 pointer shape this skill's staging-dispatch.md reuses unforked"
provides:
  - "src/cli/slash-command/bs/verify-game.md — the /bs-verify-game entry point: a lean router with a verify-shaped session lock (reusing SKETCH.md's existing lock mechanism, not a second lock), four requirement-tagged steps, and an explicit no-rebuild/no-comparison/no-cutover statement"
  - "src/cli/slash-command/bs/verify/source-resolution.md — decision 1's gated adoption flow: four resolution cases plus a no-candidate negative case, all stop-and-ask where ambiguous, adoption's payoff independently re-checked rather than trusted from ingest-archive's exit code"
  - "src/cli/slash-command/bs/verify/staging-dispatch.md — run allocation, ledger-driven resume (never inferred from disk), fan-out dispatch reusing ingest/transcription-subagent.md unchanged with the staging path substituted for rulebook/, and per-unit recording from the subagent's returned slicePath"
  - "src/cli/slash-command/bs/verify.test.ts — 36 structural pinning assertions plus a no-fork guard and forbidden-vocabulary absence guards (decisions 8, 16), with an explicit statement of what these assertions do and do not prove"
affects: [173-05, 173-06, 173-07]

tech-stack:
  added: []
  patterns:
    - "A second bs-* skill (bs-verify-game) reuses an existing shared mechanism (SKETCH.md's session lock) with a differently-shaped identity string rather than inventing a parallel lock — the same discipline as decision 15's transcription-contract reuse, applied to session locking"
    - "Every mechanical step this skill text needs (run-id minting, ledger append/read, path computation) is a command invocation the skill text merely calls; the skill text's only content is orchestration, gating, and stop-and-ask judgment — Phase 170's central finding applied end to end"

key-files:
  created:
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify/source-resolution.md
    - src/cli/slash-command/bs/verify/staging-dispatch.md
    - src/cli/slash-command/bs/verify.test.ts
  modified: []

key-decisions:
  - "Removed literal --apply/cutover flag mentions from verify-game.md's prose (which originally named the absent flag by name, e.g. 'no --apply, no cutover') in favor of describing the absence without naming a flag that doesn't exist — this makes the test's absence guard for those exact strings meaningful rather than trivially failing against the plan's own prose. Decision 8 is now demonstrated structurally: the strings do not appear anywhere in bs/verify/, positively or negatively."
  - "The verify-shaped lock identity form is `verify:<run-id>` (e.g. verify:2026-07-28T22-00-00Z), filling the exact slug position SKETCH.template.md's Session Lock: line already documents (\"<slug> @ <session-id> — locked at <ISO timestamp>\") rather than adding a new field or a new line."
  - "chunk-provenance-status --json's projectProvenanceState field ('empty' | 'pre-provenance' | 'partial' | 'complete') is the exact signal source-resolution.md's Case 1/2 test against — not a per-chunk scope value, since decision 1's adoption question is project-wide (is there an archive at all), not per-chunk."

requirements-completed: []  # VERIFY-01/02/07/08 are NOT marked complete — the live-session proofs owed by plans 173-06 and 173-07 are what closes them; this plan only pins skill text. Phase 173-03's SUMMARY documents the same discipline and the prior over-eager completion mark this phase already reverted once (eb4f7ce3).

duration: ~50min
completed: 2026-07-28
---

# Phase 173 Plan 04: The `/bs-verify-game` skill itself Summary

**Wrote `/bs-verify-game`: a lean entry-point router plus two `bs/verify/` reference files that resolve the archived source under a designer-confirmation gate, reuse `SKETCH.md`'s existing session lock with a verify-shaped identity, and drive re-transcription entirely through the plan-02 ledger CLI and the plan-03-generalized transcription contract — with zero forking of either.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3/3 completed
- **Files modified:** 4 (all new)

## Accomplishments

- `verify-game.md` mirrors `ingest-rules.md`'s shape exactly: frontmatter, a cite-don't-restate opening paragraph, an `## Invocation` block, a Context-Economics Hard Rule block, four `## Step N: Name (REQ-ID)` headings (VERIFY-01, VERIFY-01, VERIFY-02/07/08, VERIFY-02), and a `## Reference Files` footer with the same `${CLAUDE_SKILL_DIR}/../bs-shared/...` installed-path form.
- Step 0 reuses `SKETCH.md`'s existing session lock verbatim — same `date -u +%Y-%m-%dT%H:%M:%SZ` timestamp source, same 24-hour staleness rule, same resume-refresh path — with a verify-shaped identity in the slug position (`verify:<run-id>`) so a verify lock and a chunk-build lock are distinguishable at a glance and can never silently overlap. This is prose-read; nothing in this repo parses the slug position in code.
- `source-resolution.md` implements decision 1's four cases plus the no-candidate negative case, each with one unambiguous action. Case 2 (single unarchived candidate) is the one live write the whole pipeline performs: it is gated on an explicit designer confirmation (PROC-02 "how, never what"), runs `ingest-archive` with **no** `--edition` flag (so a real designer-authored `Edition:` value is never clobbered), and then **independently re-runs `chunk-provenance-status --json`** to confirm `projectProvenanceState` actually left `"pre-provenance"` — never trusting `ingest-archive`'s exit code, which decision 1b documented reporting false success. Case 3 (multiple candidates) and the negative case both stop and ask rather than guessing; Case 4 (hash mismatch) records the `source-changed` signal and proceeds without ever overwriting the archived copy.
- `staging-dispatch.md` is the verify-side sibling of `ingest/transcription.md`: `verify-run-init --json` allocates (or resumes) the run and mints the run-id — the skill text never composes one — `verify-run-status --json`'s `recorded[]` array, not on-disk file existence, decides which units still need dispatch, and each dispatched unit's `BS-DISPATCH-V2` pointer block is copied byte-identical from `ingest/transcription.md` except the `Write slices to:` line, which fills the run's `stagingDir` instead of `rulebook/` — exactly the substitution 173-03's generalization made possible. Recording happens via `verify-run-record` from the subagent's returned `slicePath`, never by opening the staged file.
- `verify.test.ts` adds 36 structural pinning assertions across four `describe` blocks (entry-point shape, session-lock reuse, source-resolution gating, staging-dispatch mechanics) plus two scope-fence blocks: a no-fork guard (mirroring 173-03's `ingest.test.ts` guard, scanning `bs/verify/` for the transcription contract's body markers) and forbidden-vocabulary absence guards for decision 8 (`--apply`/`promote`/`cutover`) and decision 16 (`cosmetic`/`sharper`/`contradictory`/`classify`). The file opens with a comment stating plainly that these assertions prove the instruction exists in skill text, not that a live session receives or follows it — naming plans 173-06 and 173-07 as the owners of that proof, per this phase's honesty requirement.

## Task Commits

1. **Task 1: The /bs-verify-game entry point** — `b10f91ff` (feat)
2. **Task 2: The bs/verify/ sub-steps** — `5b1c6b89` (feat)
3. **Task 3: Pin the skill-text contracts** — `1f2284da` (test) — includes a small in-flight edit to `verify-game.md` removing literal `--apply`/`cutover` mentions (see key-decisions) so the new absence guard has something real to assert against, folded into this commit since it only touches the file Task 1 already created and is part of establishing the same absence contract Task 3 pins.

## What a live session is expected to do (for plan 173-06 to verify against)

A designer runs `/bs-verify-game` inside a pre-provenance project (e.g. a `cp -R` copy of `~/BoardSmithGames/seven` or `~/BoardSmithGames/one-two-punch`, per the read-only invariant — this plan touched nothing under `~/BoardSmithGames/`):

1. **Step 0** — the session runs the consistency check, finds `SKETCH.md` and `rulebook/` present (a bs-built project), and takes the session lock with `verify:<run-id>` in the slug position. If a chunk-build lock is already live and not stale, it warns rather than proceeding.
2. **Step 1** — `chunk-provenance-status --json` reports `projectProvenanceState: "pre-provenance"`. The session finds exactly one root candidate (`rules.pdf`), **stops and asks the designer** to confirm before doing anything, then on confirmation runs `ingest-archive rules.pdf` with no `--edition`, then re-runs `chunk-provenance-status --json` and confirms `projectProvenanceState` is no longer `"pre-provenance"`. If it is still `"pre-provenance"`, the session stops and reports the false-success rather than proceeding as if adoption worked.
3. **Step 2** — `verify-run-init --json` mints a run-id and staging directory; `verify-run-status --json` reports `recorded: []` (a fresh run) or the subset already done (a resumed run). For each unrecorded unit, a Task subagent is dispatched with the byte-identical `BS-DISPATCH-V2` pointer block, `Write slices to:` filled with the staging path. Each subagent writes its own slice directly into staging and returns a structured summary only — **the orchestrator's own transcript should never contain a quoted-rule line, a `Derived (p.` line, or a `Visual (p.` line** — and the session records each completed unit via `verify-run-record` using the returned `slicePath`, never by opening the file.
4. **Step 3** — once `verify-run-status` reports every unit recorded, the session records the staging path in the provenance block, commits, and releases the lock to `none`. **Nothing compares the staged output to the live `rulebook/` slices, nothing classifies anything, and no staged slice is ever written over a live one** — that is explicitly out of scope, asserted structurally by this plan's absence tests, and belongs to Phase 174 (classification) and 175/176 (cutover) instead.

A kill-and-resume proof (plan 173-07) should confirm: interrupting the session mid-Step-2, re-invoking `/bs-verify-game`, and observing that Step 0's lock resume path fires (same run-id, refreshed timestamp) and Step 2 re-runs `verify-run-status` to discover exactly the units still missing from `recorded[]` — never re-dispatching an already-recorded unit, and never trusting which staged files happen to exist on disk.

## Deviations from Plan

### Auto-fixed Issues

None beyond what the plan's own tasks specified.

### Structural deviations (documented, not silently absorbed)

**1. Removed literal `--apply`/`cutover` mentions from `verify-game.md`'s prose.**
- **Reason:** the plan's Task 1 action text asked for language like "no `--apply`, no cutover" as a plain-English negation. Task 3's absence assertion, taken literally ("No file contains `--apply`, `promote`, or `cutover` — decision 8"), would fail against that same prose — the negation still contains the forbidden string. Rewrote the sentence to describe the absence without naming a flag that has never existed in this pipeline ("There is no flag or path anywhere in this skill that writes staged output into a live location"), which keeps the same meaning while making the absence guard a real structural check rather than a check the plan's own required prose would trip.
- **Files:** `src/cli/slash-command/bs/verify-game.md`

No other deviations. Every reuse target named in `173-CONTEXT.md`'s decisions and the plan's `<interfaces>` block (the exact `verify-run-*` JSON shapes from 173-02-SUMMARY.md, the exact dispatch-input contract from 173-03-SUMMARY.md, the `state-machine.md` Session Lock / Cold-Resume Parse Contract / Git Protocol / PROC-02 sections) was used exactly as specified — no new parsing logic, no second lock mechanism, no forked transcription contract.

## Verification

- `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 36/36 green.
- `npm test` — 3592/3592 green (baseline 3556 + 36 new, zero regressions).
- `npx eslint src/cli/` — zero errors.
- Manual read-through: `verify-game.md` and both `bs/verify/*.md` files cite `state-machine.md` sections by name (Consistency Check, Session Lock, Git Protocol, PROC-02, Cold-Resume Parse Contract) and never restate their full grammar; `staging-dispatch.md` copies the `BS-DISPATCH-V2` block byte-identical to `ingest/transcription.md` except the one substituted line.
- NOTE: none of the above proves a live session follows this text. That evidence is owed by plans 173-06 and 173-07 and belongs in `173-PROOF.md`.

## Known Stubs

None. This plan touches only skill-text (`.md`) prose and its pinning tests; no runtime code paths were added or stubbed.

## Threat Flags

None beyond what the plan's own `<threat_model>` already registered (T-173-31 through T-173-36 and T-173-SC, all `mitigate`/`accept`, all closed by this plan's gated confirmation, independent re-check, stop-and-ask cases, session-lock reuse, and the absence guards). No new network endpoints, auth paths, file-access patterns, or schema changes were introduced — this plan invokes existing commands and writes only markdown skill text.

## Self-Check: PASSED

- `[ -f src/cli/slash-command/bs/verify-game.md ]` — FOUND
- `[ -f src/cli/slash-command/bs/verify/source-resolution.md ]` — FOUND
- `[ -f src/cli/slash-command/bs/verify/staging-dispatch.md ]` — FOUND
- `[ -f src/cli/slash-command/bs/verify.test.ts ]` — FOUND
- Commit `b10f91ff` — FOUND in `git log`.
- Commit `5b1c6b89` — FOUND in `git log`.
- Commit `1f2284da` — FOUND in `git log`.
- Re-ran plan-level verification: `npx vitest run src/cli/slash-command/bs/verify.test.ts` (36/36), `npm test` (3592/3592), `npx eslint src/cli/` (0 errors) — all green.

---
*Phase: 173-verify-pipeline-core*
*Plan: 04*
*Completed: 2026-07-28*
