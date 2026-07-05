---
phase: 146-bs-build-chunk-playtest-revise-close-final-acceptance
plan: 03
subsystem: cli
tags: [bs-skills, slash-command, markdown-authoring, build-chunk, close, final-acceptance, a11y]

# Dependency graph
requires:
  - phase: 146-01
    provides: RED drift-test scaffold (BUILD-11, UIQ-05 describe blocks) in build-chunk.test.ts
  - phase: 146-02
    provides: playtest.md's forward citation of close.md's "## Bookkeeping Sequence" heading
provides:
  - src/cli/slash-command/bs/build/close.md (BUILD-11 bookkeeping + sketch-tail delta gate reference file)
  - src/cli/slash-command/bs/build/final-acceptance.md (UIQ-05 coverage check + 7-point design-QA reference file)
affects: [146-04 (build-chunk.md dispatch-table wiring + REFERENCED_PATHS + forward-marker retirement), 147 (bs-check-status reads close.md's decision-rollup/sketch-tail state), 149 (dry-run exercises close + final-acceptance end-to-end)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delta-gate presentation (before/after/why) modeled on ask.md's fixed-format rigidity, applied to sketch-tail re-derivation instead of a single chunk's design"
    - "Agent-dispatched vs. human-narrated split for a 7-item checklist, reusing design-review.md's serve->capture->kill lifecycle verbatim for the 5 automatable checks"
    - "Citation-not-restatement discipline: close.md cites state-machine.md Git Protocol/Write Order; final-acceptance.md cites build/test.md item 1 and design-review.md's dispatch/lifecycle sections instead of re-deriving them"

key-files:
  created:
    - src/cli/slash-command/bs/build/close.md
    - src/cli/slash-command/bs/build/final-acceptance.md
  modified: []

key-decisions:
  - "close.md's own bookkeeping duty starts AFTER the Status write, since playtest.md already writes Status: verified/verified (user-waived) to CHUNK.md then SKETCH.md before close begins — close.md's step 1 documents this explicitly rather than re-writing Status a second time"
  - "Sketch-tail delta gate uses a pinned before/after/why structure per entry, with unchanged entries simply omitted from the presentation (never restated) so a future drift test can assert the exact shape"
  - "final-acceptance.md's dispatched-agent portion covers checks 2/3/5/6/7 (zoom, touch targets, both themes, drag-drop keyboard alternates, mobile iframe-shrink); checks 1 (SR/VoiceOver) and 4 (colorblind) stay human-narrated outside the dispatch template, per 146-RESEARCH.md Open Question 1's recommendation"
  - "Drag-drop keyboard-alternates check (item 6) is folded into the SAME agent dispatch as the other automatable checks rather than given its own dispatch, since it's a scripted keyboard-completion run, not a human-judgment check"

requirements-completed: [BUILD-11, UIQ-05]

# Metrics
duration: 20min
completed: 2026-07-05
---

# Phase 146 Plan 03: Close & Final Acceptance Summary

Authored `build/close.md` (BUILD-11) and `build/final-acceptance.md` (UIQ-05), completing the
reference-file set for `/bs-build-chunk`'s `{playtest, one revise round, close}` session step
group plus the sketch's mandated final-acceptance chunk.

## What Was Built

**`build/close.md`** — the third and last step of the `{playtest, revise, close}` group. Its
`## Bookkeeping Sequence` (byte-exact heading, cited by `playtest.md`'s light-path pointer from
Plan 02) records the verified commit hash (`git rev-parse HEAD` → CHUNK.md's `## Verified Commit
Hash`, citing `state-machine.md` "Git Protocol" without restating its rationale/format) and rolls
up decisions into `DECISIONS.md`. Its `## Sketch-Tail Delta Gate` re-derives the next 2-3
sketch-level tail entries against the rulebook now the chunk's citations are settled, and presents
ONLY the delta (before/after/why, per changed entry) at an `ask.md`-style gate — explicit approval
required before any SKETCH.md tail write, with a hard "never a silent rewrite" prohibition. Ends
by proposing the next chunk with its `ui:` tag and the exact next command.

**`build/final-acceptance.md`** — the sketch's mandated final-acceptance chunk's own content: a
`## Coverage Check` (every non-variant rulebook slice cited by a closed chunk's `##
Interpretation`) plus the 7-point design-QA pass (screen-reader/VoiceOver exercising Phase 140's
`useAnnouncer()`, 200% zoom, compact touch targets, colorblind pass, both Slate themes, drag-drop
keyboard alternates end-to-end reusing `build/test.md` item 1's ActionPanel keyboard-only
completion pattern, mobile layout via iframe-shrink). Splits the seven checks across a single
fresh-context Task-tool dispatch (checks 2/3/5/6/7 — reusing `design-review.md`'s
serve→capture→kill lifecycle, `--no-open`, the exact `Ready! Press Ctrl+C to stop.` wait string,
and the `BREAKPOINTS` 640/1024/1440 tier table verbatim) and a human-narrated portion (checks 1
and 4). Findings route through the same Findings Ledger fix-or-refute loop `build/repair.md`
already governs.

## Verification

- `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-11"` — 4 passed, 96 skipped.
- `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-05"` — 5 passed, 95 skipped.
- Full suite run: 98/100 passed. The 2 remaining failures are in `build-chunk.md` itself
  (forward-reference-marker retirement and `REFERENCED_PATHS` citation of the 4 new files) — out
  of this plan's scope (`files_modified` lists only `close.md`/`final-acceptance.md`); these are
  Plan 04's `build-chunk.md` dispatch-table wiring task.

## Deviations from Plan

None — plan executed exactly as written. Both new files satisfy every acceptance criterion in
146-03-PLAN.md (byte-exact `## Bookkeeping Sequence` / `## Verified Commit Hash` headings, `git
rev-parse HEAD` literal, `state-machine.md` citations without restatement, delta gate with
"never a silent rewrite", next-chunk `ui:` tag proposal in close.md; all seven design-QA checks
named, `useAnnouncer`/`VoiceOver` named, drag-drop keyboard-alternates check citing `build/test.md`
within 500 chars, `--no-open` + kill discipline, `BREAKPOINTS` values 640/1024/1440, `## Coverage
Check` + `non-variant` in final-acceptance.md).

## Known Stubs

None — both files are complete reference-file prose with no placeholder content.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/build/close.md
- FOUND: src/cli/slash-command/bs/build/final-acceptance.md
- FOUND: commit cf2e3611
