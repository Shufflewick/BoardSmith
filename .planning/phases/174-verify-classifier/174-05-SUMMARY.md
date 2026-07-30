---
phase: 174-verify-classifier
plan: 05
subsystem: verify-pipeline-skill-text
tags: [verify-pipeline, classification, skill-text, subagent-contract, dispatch]

requires:
  - phase: 174-verify-classifier (174-03)
    provides: "verify-classify.ts's pure mechanical core — RULE_DELTA_KINDS, PRESENTATION_EXCLUSION_MARKERS, isPresentationLine, ruleBearingLines"
  - phase: 174-verify-classifier (174-04)
    provides: "verify-classify-pairs/-record/-status CLI commands, chunkVerdicts[], the ledger classification record"

provides:
  - "src/cli/slash-command/bs/verify/classification-subagent.md — the one judgment contract: BS-CLASSIFY-V1 handshake, dual-schema presentation exclusion with the real one-two-punch worked example, the consequence-vs-wording decision procedure with worked examples per label, line-level MAX-severity rollup, the enumerated RETURN shape"
  - "src/cli/slash-command/bs/verify/classification-dispatch.md — verify-game.md Step 3's delegate: pair enumeration, ledger-only resume, per-pair BS-CLASSIFY-V1 dispatch, verdict recording, close"
  - "src/cli/slash-command/bs/verify-game.md — Step 3: Classification routing dispatching to classification-dispatch.md; Phase 173's no-comparison/no-classification boundary statements rewritten in place; steps renumbered contiguously 0-1-2-3-4"
  - ".planning/phases/174-verify-classifier/174-FIXTURES/lexicon/ — 7 hand-built regression pairs (decision 15) with EXPECTED.md verdicts"
  - "src/cli/commands/install-claude-command.ts — classification-subagent.md added to SHARED_LEAF_PROBES"

affects:
  - "174-06/174-07 — the live-proof plans that dispatch a real classification subagent through this skill text and grep the transcript-absence observable"
  - "Phase 175 — human adjudication of contradictory verdicts and staleness-marker consumption depend on this contract's RETURN shape and line-level attribution surviving unchanged"

tech-stack:
  added: []
  patterns:
    - "BS-CLASSIFY-V1 dispatch-token handshake, mirroring BS-DISPATCH-V2 exactly: a token that cannot be produced from memory is proof the pointer block was copied, not composed"
    - "Dual-schema presentation exclusion as an explicit worked example quoted byte-identical from a real archived fixture, not asserted abstractly"
    - "In-place rewrite (not append) of self-contradicting skill text — the Phase 173 no-classification boundary is deleted, not left beside the new Step 3"

key-files:
  created:
    - src/cli/slash-command/bs/verify/classification-subagent.md
    - src/cli/slash-command/bs/verify/classification-dispatch.md
    - .planning/phases/174-verify-classifier/174-FIXTURES/lexicon/cosmetic-reword/{live.md,staged.md,EXPECTED.md}
    - .planning/phases/174-verify-classifier/174-FIXTURES/lexicon/cosmetic-reorder/{live.md,staged.md,EXPECTED.md}
    - .planning/phases/174-verify-classifier/174-FIXTURES/lexicon/cosmetic-schema-asymmetry/{live.md,staged.md,EXPECTED.md}
    - .planning/phases/174-verify-classifier/174-FIXTURES/lexicon/sharper-added-bound/{live.md,staged.md,EXPECTED.md}
    - .planning/phases/174-verify-classifier/174-FIXTURES/lexicon/sharper-added-tiebreak/{live.md,staged.md,EXPECTED.md}
    - .planning/phases/174-verify-classifier/174-FIXTURES/lexicon/contradictory-changed-number/{live.md,staged.md,EXPECTED.md}
    - .planning/phases/174-verify-classifier/174-FIXTURES/lexicon/contradictory-reversed-precedence/{live.md,staged.md,EXPECTED.md}
  modified:
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify.test.ts
    - src/cli/commands/install-claude-command.ts

decisions:
  - "Renumbered verify-game.md's steps as 0-1-2-3-4 (Classification = Step 3, Close = Step 4) rather than the plan action text's illustrative 'Step 4 / renumber Close to Step 5', which would have left a numbering gap at Step 3 (no step of that number existing at all). Contiguous renumbering was the only reading that keeps the 'has N numbered steps' structural test coherent."
  - "Reworded two phrases that verbatim-collided with existing drift-guard tests: 'promoted'/'promotes' both contain the forbidden substring 'promote' (unlike 'promotion', which the original Phase 173 text used) and had to become 'takes a live one's place'/'ever taking a live one's place'; classification-subagent.md's opening 'Do not accept a paraphrase of this file in place of the file' sentence verbatim-matched the no-fork CONTRACT_BODY_MARKERS guard (which exists to catch a fork of transcription-subagent.md's own body) and was reworded to the same meaning with different wording."
  - "Wrote 7 lexicon regression pairs, not the minimum 6 the plan's action text names — 2 cosmetic (reword, reorder) plus a dedicated 3rd cosmetic case for the schema-asymmetry trap the plan's prose separately calls out, plus 2 sharper and 2 contradictory, since the plan's own wording ('Include one cosmetic case whose live side carries a legacy Derived...') reads as an addition to, not a replacement of, the two-cosmetic baseline."

metrics:
  duration: "~1 session"
  completed: "2026-07-30"
---

# Phase 174 Plan 05: Classification Subagent Contract + Dispatch Delegate + verify-game.md Rewrite Summary

Wrote the judgment half of the verify classifier as skill text: a subagent contract carrying the
one decision procedure (consequence-equivalence) and the dual-schema presentation exclusion rule
with a real-data worked example, a dispatch delegate mirroring `staging-dispatch.md`'s
`BS-DISPATCH-V2` discipline under a new `BS-CLASSIFY-V1` token, and an in-place rewrite of
`verify-game.md`'s Phase 173 "there is no classification" boundary statements — which are now
false and could not be left standing beside a new Step 3. Rewrote `verify.test.ts`'s drift pins to
match: classification vocabulary now required where it belongs, staleness vocabulary forbidden
everywhere in skill prose, and the exclusion lexicon pinned across the code/prose boundary.

## What was built

**Task 1 — `classification-subagent.md` + hand-built lexicon regression pairs.** The contract
mirrors `transcription-subagent.md`'s four-part shape: a `BS-CLASSIFY-V1` handshake (`DISPATCH
REJECTED` block, reads no slice if the token is missing), an inputs section naming the pair id and
the (possibly many-to-many) live/staged slice paths, the dual-schema exclusion rule quoting
`Derived (p.1) — diagram description:` byte-identical from
`174-FIXTURES/one-two-punch/live/01-setup-and-round-structure.md` and explaining why both the
post-170 `Visual (p.N):` form and the pre-170 `Derived — diagram description`/`— art` forms must be
excluded (the two sides of a real pair are on different schemas), the consequence-vs-wording
decision procedure with two worked examples per label (`cosmetic`/`sharper`/`contradictory`),
line-level MAX-severity rollup, the enumerated RETURN shape (`pairId`, `label`, `evidence`,
`quotedPass1`, `quotedPass2`, `lineFindings`) with the verbatim-quote requirement for
`sharper`/`contradictory`, and a scope-limit paragraph stating the subagent never computes
staleness (the only occurrence of "stale" anywhere in the file, verified by test). Seven hand-built
lexicon pairs were written under `174-FIXTURES/lexicon/`, each with `live.md`, `staged.md`, and an
`EXPECTED.md` naming the verdict and why: `cosmetic-reword` (pure rewording), `cosmetic-reorder`
(step reordering with no consequence), `cosmetic-schema-asymmetry` (the dual-schema trap — a
legacy `Derived — diagram description` line vs. a real `Visual` line describing something
completely different, both correctly excluded so the identical rule-bearing line underneath scores
`cosmetic`), `sharper-added-bound`, `sharper-added-tiebreak`, `contradictory-changed-number`, and
`contradictory-reversed-precedence`.

**Task 2 — `classification-dispatch.md` + `verify-game.md` in-place rewrite + installer probe.**
`classification-dispatch.md` mirrors `staging-dispatch.md`'s section shape: a restated
Context-Economics Hard Rule (the orchestrator never opens a slice; the classification subagent is
the one place either is legitimately read), pair enumeration via `verify-classify-pairs --json`
(never by filename or `INDEX.md`), ledger-only resume via `verify-classify-status --json`'s
`pendingPairs` (never a directory scan; `unpaired-slice`/`presentation-only` groups are excluded
from dispatch and surfaced to the designer instead), per-pair dispatch carrying the
`BS-CLASSIFY-V1` pointer block byte-identical, recording via `verify-classify-record` from the
subagent's returned fields only, and a close condition on `pendingPairs` being empty. `verify-
game.md`'s two Phase 173 boundary statements were rewritten in place rather than appended around:
the "never compares the staged output... that comparison is a later phase's job" sentence in the
opening description became "never writes a staged slice over a live one... comparison happens in
Step 3, below"; the entire "**The pass ends here.** There is no comparison... no classification...
Staging and recording is the entire scope of this skill" paragraph was deleted and replaced by a
new `## Step 3: Classification` section routing to the new delegate. Steps were renumbered
contiguously 0-1-2-3-4 (Classification = 3, Close = 4) rather than leaving a numbering gap. The
installer's `SHARED_LEAF_PROBES` gained `verify/classification-subagent.md` so a partial install
missing the new contract reads as incomplete.

**Task 3 — `verify.test.ts` rewrite.** `ALL_VERIFY_FILES` extended with the two new files. The
`describe('Decision 16 — this phase classifies nothing...')` block's classification-vocabulary-
absence and no-comparison/no-classification-presence tests were deleted (both assertions are now
false); the `--apply`/`promote`/`cutover` absence test was kept and renamed, automatically covering
the two new files via the extended constant. New blocks pin: Step 3's existence and pointer, the
deleted sentences' absence, Close's "formatted, never computed" verdict-report sentence; the
subagent contract's token, `DISPATCH REJECTED` block, three labels, consequence-vs-wording
sentence, RETURN field names, dual-schema worked example (quoted from the real fixture), and the
single-occurrence staleness scope-limit sentence; the dispatch delegate's pointer, token, and three
`verify-classify-*` command names, plus a no-fork guard against any other `bs/verify/` file
carrying the contract's own decision-procedure marker text; an SC-4 block asserting no verify file
states a staleness-derivation rule (`marks stale`, `→ stale`, `is stale`, `not stale`); and a
cross-file lexicon pin extracting `PRESENTATION_EXCLUSION_MARKERS`'s regex-source array directly
out of `verify-classify.ts` and asserting each literal prefix form appears verbatim in
`classification-subagent.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Step-renumbering gap left no "Step 3" heading**
- **Found during:** Task 2, immediately after inserting the new Classification section.
- **Issue:** The plan's action text offered "renumber Close to Step 5" as one option, which — given
  the file's existing Steps 0/1/2/3(Close) — would leave Steps 0, 1, 2, 4, 5 with no Step 3 at all,
  breaking the existing structural test asserting contiguous, sequentially-tagged step headings.
- **Fix:** Renumbered Classification to Step 3 and Close to Step 4, keeping 0-1-2-3-4 contiguous,
  and fixed the two internal cross-references ("comparison happens in Step 3", "A clean close (Step
  4) releases the line").
- **Files modified:** `src/cli/slash-command/bs/verify-game.md`.
- **Verification:** `verify.test.ts`'s "has exactly five numbered steps" test passes with the
  `VERIFY-0[12378]` tag regex covering all five headings.
- **Committed in:** `3e154586`.

**2. [Rule 1 - Bug] Two verbatim substring collisions with existing drift-guard tests**
- **Found during:** Task 3, first `vitest run` of the rewritten test file.
- **Issue:** (a) "promoted"/"promotes" (used in the new Step 3/Close prose) both contain the
  forbidden substring "promote" character-for-character, unlike "promotion" (the word Phase 173's
  original text used, which does not contain "promote" as a substring) — the `--apply`/`promote`/
  `cutover` absence test failed on the skill's own new prose. (b) `classification-subagent.md`'s
  opening line, adapted from `transcription-subagent.md`'s "Do not accept a paraphrase of this file
  in place of the file," verbatim-matched the no-fork guard's `CONTRACT_BODY_MARKERS`, which exists
  specifically to catch a fork of the *transcription* contract's body — a legitimate false-positive
  from copying phrasing too closely.
- **Fix:** (a) reworded both occurrences to "takes/taking a live one's place," preserving meaning
  without the substring collision. (b) reworded the opening sentence to "A summary of this contract
  is not a substitute for reading it — read this file itself, in full, before classifying
  anything," same meaning, no verbatim overlap with the transcription contract's own markers.
- **Files modified:** `src/cli/slash-command/bs/verify-game.md`,
  `src/cli/slash-command/bs/verify/classification-dispatch.md`,
  `src/cli/slash-command/bs/verify/classification-subagent.md`.
- **Verification:** `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 50/50 passed after
  the fix.
- **Committed in:** `f8a3c04b`.

## Known Stubs

None. This plan produces skill text and hand-built regression fixtures consumed by a later live
session (plan 174-06) — it is not itself an executable code path that could silently stub data.

## Verification

- `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 50/50 passed.
- `npm test` (full suite) — 3691/3691 passed, no regressions from the 174-04 baseline (3678).
- `npx tsc --noEmit -p .` — clean (only the pre-existing, unrelated
  `docs/seed-to-state.test.ts` rootDir diagnostic).
- `grep -rn 'no classification' src/cli/slash-command/bs/verify-game.md` — no matches.
- `grep -c 'The pass ends here' src/cli/slash-command/bs/verify-game.md` — 0.
- `grep -c 'never compares the staged output' src/cli/slash-command/bs/verify-game.md` — 0.

## Next Phase Readiness

- The classification subagent contract, dispatch delegate, and `verify-game.md` Step 3 routing all
  exist and are drift-pinned. **Not proven here:** that a live session actually reads and follows
  this text — plans 174-06/174-07 own dispatching a real subagent through this exact skill text
  against the real fixtures and grepping the transcript-absence observable, per this file's own
  honesty caveat at lines 10-16 (which every prior verify-skill test file carries and this plan does
  not weaken).
- The 7 hand-built lexicon regression pairs are ready for 174-06 to run through a real dispatch and
  compare against their `EXPECTED.md` verdicts.
- VERIFY-01/VERIFY-03/VERIFY-07 remain open in `REQUIREMENTS.md` until the live proof lands, matching
  this project's standing discipline against premature completion marks (restated in 174-04-SUMMARY.md).

## Self-Check: PASSED

- FOUND: `src/cli/slash-command/bs/verify/classification-subagent.md`
- FOUND: `src/cli/slash-command/bs/verify/classification-dispatch.md`
- FOUND: `.planning/phases/174-verify-classifier/174-FIXTURES/lexicon/` (7 pair directories, each
  with `live.md`, `staged.md`, `EXPECTED.md`)
- FOUND commit `07420e75` (feat(174-05): classification subagent contract + hand-built lexicon
  regression pairs)
- FOUND commit `c2f77e61` (feat(174-05): classification-dispatch.md delegate + verify-game.md Step
  4 rewrite)
- FOUND commit `3e154586` (fix(174-05): renumber verify-game.md steps contiguously)
- FOUND commit `f8a3c04b` (test(174-05): rewrite verify.test.ts boundary pins)
- `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 50/50 passed
- `npm test` — 3691/3691 passed (full suite, no regressions)
- `npx tsc --noEmit -p .` — clean (only the pre-existing, unrelated
  `docs/seed-to-state.test.ts` rootDir diagnostic)
