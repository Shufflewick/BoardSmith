---
phase: 170-ingest-contract-upgrade
plan: 07
subsystem: cli
tags: [agent-skills, markdown, bs-ingest, vitest, templates, harness, live-agent-run]

# Dependency graph
requires:
  - phase: 170-02
    provides: "Step 3 prose that archives {rulebookPath} to rulebook/source/, computes its SHA-256, and writes a four-line INDEX.md header block + always-emitted ## Open Rules Gaps section"
  - phase: 170-06
    provides: "npm run harness:ingest — a live-agent driver + deterministic checker (check.mjs) that reproduced the human proof run's failures with zero checker gaps and zero false positives, at a 1/10 baseline"
provides:
  - "templates/INDEX.template.md — the literal skeleton (H1, PARSE CONTRACT comment, four header lines, ## Open Rules Gaps / ## Slices / ## Term → Slice) matching ASSETS.template.md's shape, installer-reachable with no installer edit"
  - "ingest-rules.md Step 2.5 (INGEST-01) as its own numbered step between Step 2 and Step 3, with a stated data dependency into Step 3's Source hash: line"
  - "ingest-rules.md Step 3 item 1 rewritten to cite and fill INDEX.template.md rather than restate its contract inline; interview-fallback.md re-targeted to the same template"
  - "Contract-pin regression tests for the template and the Step 2.5/3 rewrite (templates.test.ts, ingest.test.ts), both adversarially probed RED then restored GREEN"
  - "Two independent live `npm run harness:ingest` runs against the shipped template mechanism, both scoring 1/10 (same as the pre-plan baseline) — the template-copy hypothesis did NOT survive a live run in either attempt, a negative result recorded honestly per this plan's own acceptance-bar rule"
affects: [170-08, 170-09, 170-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Template file mirrors ASSETS.template.md's shape exactly (H1, explainer comments, PARSE CONTRACT comment, fillable body with commented example rows) rather than inventing a new template idiom"
    - "Step promoted to its own integer-and-a-half heading (Step 2.5) to preserve every existing 'Step N' cross-file citation while still giving archive+hash first-class step status"

key-files:
  created:
    - src/cli/slash-command/bs/templates/INDEX.template.md
  modified:
    - src/cli/slash-command/bs/ingest-rules.md
    - src/cli/slash-command/bs/ingest/interview-fallback.md
    - src/cli/slash-command/bs/ingest.test.ts
    - src/cli/slash-command/bs/templates.test.ts

key-decisions:
  - "Followed the plan's explicit acceptance-bar rule: a green contract test is not sufficient. Ran the harness twice, made one genuine structural revision between runs, and recorded both results honestly rather than declaring success on the strength of the (green) contract tests alone."
  - "Did not attempt a third harness run or a further architectural change (e.g. a dedicated INDEX-authoring subagent mirroring 170-PROOF-RUN.md's Experiment 1) — that crosses into Rule 4 (architectural change) territory, which is out of this plan's task scope and would need explicit sign-off, not autonomous continuation."
  - "Kept the Task 2 rewrite and the Task 3 wording-strengthening commit even though neither closed the harness gap: both are net-positive documentation/instruction quality, neither regresses any passing check, and the git history preserves the honest record of what was tried."

requirements-completed: []

# Metrics
duration: 45min
completed: 2026-07-27
---

# Phase 170 Plan 07: INDEX.template.md + Step 2.5 Archive — Summary

**Authored `templates/INDEX.template.md` and promoted the source archive to its own Step 2.5, but two independent live `npm run harness:ingest` runs both scored 1/10 — the template-copy mechanism that worked for `ASSETS.md` in the original proof run did NOT survive a live orchestrator session for `INDEX.md`, in either the first or a subsequently strengthened attempt. No INGEST requirement is closed by this plan.**

## Performance

- **Duration:** 45 min
- **Tasks:** 3 completed (all three planned tasks executed; Task 3's live-verification step produced a negative result, documented per the plan's own acceptance-bar rule rather than treated as a blocker to stop early)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **`templates/INDEX.template.md`** created, matching `ASSETS.template.md`'s shape exactly: H1, explainer comments, a `PARSE CONTRACT (TMPL-02)` comment naming the required headings in order, the four literal header lines (`Edition:`, `Source:`, `Source hash:`, `Transcribed:`) each with an inline fill-instruction comment, the always-emitted `## Open Rules Gaps` heading with its `_None._`/no-dedup rules and a commented numbered-list example, and the `## Slices` / `## Term → Slice` tables with commented example rows. Verified installer-reachable (`node bin/boardsmith.js claude --local --force` produces `.claude/skills/bs-shared/templates/INDEX.template.md`) with no installer edit required.
- **`ingest-rules.md` Step 2.5 (INGEST-01)** added as its own numbered step between Step 2 and Step 3, with one deliverable (archived file + computed hash) and an explicit statement that Step 3's `Source hash:` line depends on it — a skipped Step 2.5 must surface as a blocked Step 3, not a silently missing line.
- **`ingest-rules.md` Step 3** rewritten: the old items 2/3/4 (INDEX.md, header block, Open Rules Gaps) collapsed into a single copy-and-fill-the-template item, citing `INDEX.template.md` the same way Step 7 already cites `SKETCH.template.md`/`CHUNK.template.md`. Remaining items (component inventory, `ASSETS.md`, visual survey, player counts) renumbered contiguously 2–5. `ingest/scaffold.md` left untouched (Pitfall 1 guard verified via `git diff --name-only`).
- **`interview-fallback.md`** re-targeted its "Output Re-Target" section to cite and fill the same `INDEX.template.md`, keeping its interview-path sentinel values (`unpublished — designer statement`; `not applicable — no source rulebook (interview path)`).
- **Contract pins**: a new `templates.test.ts` describe block pins the three literal headings, the four ordered header labels, the `_None._` token, the archive path shape, U+2192 vs ASCII `->`, and the interview-path Edition guard against `INDEX.template.md`. `ingest.test.ts`'s `v4.9 INGEST-01/03/04` blocks were amended to assert Step 2.5's heading/position/dependency statement and Step 3's template citation instead of the now-removed inline header-label prose. `templates/INDEX.template.md` added to `REFERENCED_PATHS`.
- **Two adversarial probes run and restored** (PROC-02): removing `## Open Rules Gaps` from the template went RED naming that exact heading; pointing the `ingest-rules.md` citation at a nonexistent template path went RED on the cross-file resolution check. Both restored to a clean `git diff --stat` and GREEN.
- **Two live `npm run harness:ingest` runs**, both against `~/BoardSmithGames/seven/rules.pdf`, both scoring **1/10** (only `reference-repo-unmodified` passing) — see "Live Verification" below for the full detail.

## Task Commits

1. **Task 1: Author `templates/INDEX.template.md`** - `4875f23f` (feat)
2. **Task 2: Rewrite `ingest-rules.md` — Step 2.5 archive+hash, and a Step 3 that fills the template** - `b0c800c4` (feat)
3. **Task 3: Pin the contract, then verify against a live harness run** - `37e39b54` (test) + `cb2578e7` (fix — mid-task wording strengthening after the first harness run stayed 1/10)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `src/cli/slash-command/bs/templates/INDEX.template.md` - New. The rulebook INDEX skeleton, structured to match `ASSETS.template.md`.
- `src/cli/slash-command/bs/ingest-rules.md` - New `## Step 2.5: Archive the Source Rulebook (INGEST-01)`; Step 3 item 1 rewritten to copy-and-fill `INDEX.template.md`; remaining Step 3 items renumbered; Reference Files list gained the new template citation; "resume from existing slices" wording updated from "re-run Step 3 onward" to "re-run Step 2.5 onward".
- `src/cli/slash-command/bs/ingest/interview-fallback.md` - "Output Re-Target" section now cites and fills `INDEX.template.md` instead of restating the header contract inline.
- `src/cli/slash-command/bs/ingest.test.ts` - `v4.9 INGEST-01/03/04` blocks amended for the Step 2.5/Step 3 rewrite; `REFERENCED_PATHS` gained `templates/INDEX.template.md`.
- `src/cli/slash-command/bs/templates.test.ts` - New `v4.9 INGEST-01/03/04 — INDEX.template.md` describe block; new `flat()` whitespace-collapsing helper (mirroring `ingest.test.ts`'s).

## Decisions Made

- Followed the plan's explicit acceptance-bar rule to the letter: ran the harness, got 1/10, made one genuine structural revision to the skill text (not a re-run of the same text hoping for a different sample), ran the harness again, got 1/10 again, and stopped there rather than continuing to iterate indefinitely or declaring victory on the strength of the green contract tests.
- Did not pursue a third harness attempt or a deeper architectural change (e.g., dispatching a dedicated INDEX-authoring subagent that reads the template directly, mirroring `170-PROOF-RUN.md`'s Experiment 1, which is the one mechanism proven to survive prose-to-agent transit). That is a structural redesign of *how* Step 3 is executed (new subagent dispatch), which is a Rule 4 architectural change outside this plan's task scope — it belongs to a follow-up plan with explicit sign-off, not an autonomous continuation here.
- Kept both the Task 2 rewrite and the Task 3 mid-task wording-strengthening commit despite neither closing the harness gap. Both are net improvements to instruction clarity, neither regresses any previously-passing check (`npm test` stayed 3250/3250 throughout), and reverting them would erase the honest record of what was tried and found not to work.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `templates.test.ts`'s new `## Open Rules Gaps (` guard initially caught its own example text**
- **Found during:** Task 1 verification
- **Issue:** The template's own PARSE CONTRACT comment originally included the literal example string `## Open Rules Gaps (surfaced, never fabricated)` as an illustration of what NOT to write, which itself matched the "does NOT contain" acceptance check.
- **Fix:** Reworded the comment to describe the prohibition ("never given a parenthetical suffix appended after the heading text") without reproducing the literal forbidden string.
- **Files modified:** `src/cli/slash-command/bs/templates/INDEX.template.md`
- **Committed in:** `4875f23f` (Task 1 commit — fixed before the task's own commit, not a separate deviation commit)

**2. [Rule 1 - Bug] Adversarial-probe regex needed `[\s\S]`/`flat()` for a line-wrapped phrase**
- **Found during:** Task 3, adversarial-probe pass on the "STOP and ask" assertion
- **Issue:** `ingest-rules.md`'s prose wraps "STOP\nand ask the designer" across a hand-wrapped line break; a plain `/STOP and ask/` regex against the raw (unflattened) string failed even on the correct, un-probed file.
- **Fix:** Wrapped the assertion in the existing `flat()` whitespace-collapsing helper (same idiom already used elsewhere in `ingest.test.ts`).
- **Files modified:** `src/cli/slash-command/bs/ingest.test.ts`
- **Committed in:** `37e39b54` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — test/template-authoring bugs caught and fixed before their respective task commits, not scope changes).
**Impact on plan:** Neither changes what the plan specified; both are same-task authoring corrections analogous to the one recorded in `170-02-SUMMARY.md`.

## Issues Encountered — Live Verification (the acceptance bar)

**This is the substantive finding of this plan.** Two live `npm run harness:ingest` runs were executed against `~/BoardSmithGames/seven/rules.pdf`. Both scored **1/10**, identical to the pre-plan baseline recorded in `170-HARNESS-BASELINE.md`. The seven checks this plan targeted (`archive-exists`, `archive-hash`, `hash-recorded`, `header-block`, `gaps-heading`, `gaps-reconciliation`, `tables-intact`) stayed FAIL in **both** attempts.

### Attempt 1 (skill text as landed by Tasks 1–2, before any Task 3 wording revision)

Session duration: 277.9s. Exit code 0. Verbatim ten-row check table:

| # | id | letter | PASS/FAIL | detail |
|---|----|--------|-----------|--------|
| 1 | archive-exists | a | FAIL | missing: `/tmp/bs-ingest-harness/seven/rulebook/source/rules.pdf` does not exist as a regular file |
| 2 | archive-hash | b | FAIL | cannot compute hash: `/tmp/bs-ingest-harness/seven/rulebook/source/rules.pdf` missing |
| 3 | hash-recorded | c | FAIL | line absent: no "Source hash:" line with exactly 64 lowercase hex characters found |
| 4 | header-block | d | FAIL | "Source:" line missing or has an empty value; "Source hash:" line missing or has an empty value; "Transcribed:" line missing or has an empty value |
| 5 | gaps-heading | e1 | FAIL | no gaps-shaped heading found at all |
| 6 | gaps-reconciliation | e2 | FAIL | section entries=0, slice Named-but-undefined markers=7 (markers greater than entries: the transport is dropping gaps) [no "## Open Rules Gaps" section found; treated as 0 entries] |
| 7 | tables-intact | f | FAIL | "## Term → Slice" missing (found instead: "## Terms") |
| 8 | visual-lines | h | FAIL | totals: Visual=0, Derived=8 |
| 9 | derived-purity | i | FAIL | offending lines: `02-solo-variant.md:32/34/36` (full-bleed, bold white, illustration) |
| 10 | reference-repo-unmodified | g | **PASS** | reference repo unchanged: clean, HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd` matches recorded |

**SUMMARY: 1/10 checks passing. OVERALL: FAIL.**

Critically: the produced `rulebook/INDEX.md` was a fresh composition, not a copy of `INDEX.template.md` — it had no header block at all, a `## Slices` table that did happen to match, a `## Terms` heading (not `## Term → Slice`), and an `## Open Items` section (not `## Open Rules Gaps`). `ASSETS.md`, by contrast, again matched its template structurally (the same pattern `170-PROOF-RUN.md`'s Experiment 2 recorded) — the difference between the two artifacts in this run was **not** explained by which one had an explicit "copy the file" instruction, since Step 3's `ASSETS.md` item (unchanged since Plan 02) is a bare citation with no "copy" verb at all, while the rewritten `INDEX.md` item explicitly said "Copy X into the project as Y."

### Structural revision between attempts

Read the check details, identified the mechanism that failed (Step 2.5 was skipped entirely — no evidence in the session's own end-of-Step-3 summary that it ran at all — and Step 3's INDEX.md item was paraphrased rather than read-and-copied), and made one substantive rewording, not a resubmission of identical text:

- Step 2.5 gained an opening imperative ("Do this step now, before Step 3, as its own concrete action") and a three-item concretely-sequenced checklist naming the exact tool actions (copy, run `shasum`, hold the value) with an explicit "these are real tool invocations this session runs itself, not steps to summarize as already done."
- Step 3 item 1 gained an opening imperative ("Do this literally, as the FIRST concrete action of this step"), an explicit "Read the template in full, then write `rulebook/INDEX.md` starting from that exact structure" instruction, and a self-check sentence: "If what gets written does not contain, verbatim, `## Open Rules Gaps`, `## Slices`, and `## Term → Slice`, the template was not actually read."

Committed as `cb2578e7`. `npm test` re-confirmed 3250/3250 green before re-running the harness.

### Attempt 2 (after the `cb2578e7` wording revision)

Session duration: 561.0s (roughly double attempt 1 — the source PDF was rendered as 2 pages this run, dispatching 2 subagents across 11 sections rather than attempt 1's smaller slice count). Exit code 0. Verbatim ten-row check table:

| # | id | letter | PASS/FAIL | detail |
|---|----|--------|-----------|--------|
| 1 | archive-exists | a | FAIL | missing: `/tmp/bs-ingest-harness/seven/rulebook/source/rules.pdf` does not exist as a regular file |
| 2 | archive-hash | b | FAIL | cannot compute hash: `/tmp/bs-ingest-harness/seven/rulebook/source/rules.pdf` missing |
| 3 | hash-recorded | c | FAIL | line absent: no "Source hash:" line with exactly 64 lowercase hex characters found |
| 4 | header-block | d | FAIL | "Source hash:"/"Transcribed:" missing or empty; "Source:" value `` `source-under-test/rules.pdf` (2 pages, landscape 1044x432 pt). Designer credit: JT Smith. `` does not begin with `rulebook/source/` |
| 5 | gaps-heading | e1 | FAIL | expected "## Open Rules Gaps" but found instead: "## Open Rules Questions (surfaced, NOT decided)" |
| 6 | gaps-reconciliation | e2 | FAIL | section entries=0, slice Named-but-undefined markers=3 (markers greater than entries) [no "## Open Rules Gaps" section found; treated as 0 entries] |
| 7 | tables-intact | f | FAIL | "## Slices" missing (found instead: "## Term → Slice Cross-Reference"); "## Term → Slice" missing (found instead: same merged heading) |
| 8 | visual-lines | h | FAIL | totals: Visual=0, Derived=41 |
| 9 | derived-purity | i | FAIL | 13 offending lines across 6 slice files (full-bleed, illustration, rotated, typograph, wordmark, palette, iconograph) |
| 10 | reference-repo-unmodified | g | **PASS** | reference repo unchanged: clean, HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd` matches recorded |

**SUMMARY: 1/10 checks passing. OVERALL: FAIL.**

The stronger wording produced a *different* improvised heading (`## Open Rules Questions (surfaced, NOT decided)` vs. attempt 1's absent heading) and, notably, **merged** the `## Slices` and `## Term → Slice` tables into one `## Term → Slice Cross-Reference` heading — a new failure shape, not a convergence toward the spec. Step 2.5 was again entirely skipped: no `rulebook/source/` directory, no computed hash, no mention of archiving anywhere in the session's own end-of-Step-3 narration (which did, by contrast, correctly narrate real, concretely-verified Step 1 scaffold actions — `tsc --noEmit` exit 0, `HTTP 200`, post-kill curl refused — confirming the session is capable of executing and reporting real tool actions; it specifically did not execute Step 2.5's).

**This plan's Task 3 acceptance criteria required all seven target checks to PASS.** They did not, in either attempt. Per this plan's explicit instruction — "do not weaken a check, do not hand-patch a produced artifact, and do not re-run hoping for a better sample" — both throwaway trees were deleted, the reference repo was re-confirmed clean (`git -C ~/BoardSmithGames/seven status --porcelain` empty, HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd` both times), and this negative result is recorded here rather than either check being loosened or a produced `INDEX.md` being hand-edited to pass.

### Refutation of the working hypothesis, as tested

`170-PROOF-RUN.md`'s Experiment 2 — the entire premise of this plan — observed that `ASSETS.md` came out byte-conforming to its template in the same session where `INDEX.md` diverged on every specified string, and inferred that a *template to copy* survives where *prose to reproduce* does not. This plan's two live runs partially corroborate and partially refute that inference:

- **Corroborated:** `ASSETS.md` again came out structurally conforming to `ASSETS.template.md` in both attempts (verified by direct diff against the template — the only divergence was in the fillable body, exactly as intended).
- **Refuted:** giving `INDEX.md` an equivalent template, and an explicit "copy and fill" instruction stronger than the one that already works for `ASSETS.md` (which has no "copy" verb at all — just a citation), did **not** produce a conforming `INDEX.md` in either attempt. The orchestrator continued to compose its own INDEX.md from memory of the rulebook content, using its own invented headings, in both runs.

The likelier distinguishing variable, based on this new evidence, is **artifact complexity** rather than **citation style**: `ASSETS.md`'s template is a single H1 + one heading + one five-column table, well within what an orchestrator naturally reproduces correctly regardless of instruction phrasing. `INDEX.md`'s template requires four ordered header lines, three distinct headings, and two structurally different tables assembled from two different accumulated-list sources — evidently enough surface area that the orchestrator's own paraphrase wins over template-copying even when explicitly instructed to copy. This is a genuinely new finding this plan surfaces for Plan 08/09/10 to account for; it is not simply a repeat of the 2026-07-27 proof run's finding.

**Step 2.5 (the archive) failed for a related but distinguishable reason**: it is not a complexity problem (one file copy, one shell command) but appears to be a *step-sequencing* problem — the orchestrator's own end-of-session narration never mentions it at all, in either attempt, despite narrating Step 1's real, concretely-verified tool actions in detail. This suggests the step is being skipped in the model's own execution plan before Step 3 begins, not merely composed incorrectly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **No INGEST-01/03/04 requirement is marked complete by this plan.** Per this plan's own instruction, the harness result is the acceptance bar and it stayed FAIL on all seven targeted checks across both attempts — `STATE.md`/`REQUIREMENTS.md` are updated with plan-progress bookkeeping only, not requirement completion.
- **Recommendation for the next plan in this phase (170-08 or a new plan):** the template-copy mechanism alone is not sufficient for an artifact of `INDEX.md`'s structural complexity. Two directions worth investigating, neither attempted here (both would be Rule 4 architectural changes needing explicit sign-off): (a) mirror `170-PROOF-RUN.md`'s Experiment 1 — dispatch a narrow subagent that reads `INDEX.template.md` and the accumulated fields directly and returns the filled file, rather than relying on the long-running orchestrator to do the copy itself after already processing multiple transcription subagents; (b) investigate whether Step 2.5 needs to run *earlier* — immediately after `{rulebookPath}` is bound at Step 2, before subagent dispatch begins — since the archive doesn't depend on transcription completing at all, and the orchestrator's own narration suggests the step is being dropped somewhere in the long Step 2→3 sequence, not merely followed incorrectly.
- `visual-lines`/`derived-purity` remain FAIL in both attempts, as expected — INGEST-02 is Plan 08's work, not this plan's, and this plan does not claim to have touched it.
- No blockers to running Plan 08 next; this plan's negative result should inform its design rather than block its start.

---
*Phase: 170-ingest-contract-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/templates/INDEX.template.md
- FOUND: src/cli/slash-command/bs/ingest-rules.md
- FOUND: src/cli/slash-command/bs/ingest/interview-fallback.md
- FOUND: src/cli/slash-command/bs/ingest.test.ts
- FOUND: src/cli/slash-command/bs/templates.test.ts
- FOUND: commit 4875f23f (Task 1)
- FOUND: commit b0c800c4 (Task 2)
- FOUND: commit 37e39b54 (Task 3 — contract pins)
- FOUND: commit cb2578e7 (Task 3 — wording revision between harness attempts)
