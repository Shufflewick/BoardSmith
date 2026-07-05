---
phase: 143-bs-build-chunk-interpretation-ask-gate
plan: 03
subsystem: bs-build-chunk (investigate step)
tags: [llm-skill, markdown-authoring, agent-instructions]
dependency-graph:
  requires:
    - src/cli/slash-command/bs/ingest/transcription.md (fan-out dispatch idiom, mirrored)
    - src/cli/slash-command/bs/ingest/scaffold.md (Required Reading Pointer, handed off here)
    - src/cli/slash-command/bs/state-machine.md (Rulings Outrank Rulebook, Session Handoff Seams)
    - src/cli/slash-command/bs/templates/CHUNK.template.md (Interpretation/Visibility
      Declaration/Newly Discovered Citations sections, parse contract)
  provides:
    - src/cli/slash-command/bs/build/investigate.md (BUILD-02 investigate step reference file)
  affects:
    - src/cli/slash-command/bs/build-chunk.md (orchestrator cites this file for Step 2)
    - src/cli/slash-command/bs/build/redteam.md (consumes the claims list this step writes —
      authored in a later plan of this same phase)
tech-stack:
  added: []
  patterns:
    - Fresh-context Task-tool subagent writes CHUNK.md sections directly; orchestrator
      accumulates only a structured summary return (claimsList, visibilityDeclaration,
      newlyDiscoveredCitations)
    - Append-with-supersession for re-investigate rounds (never renumber existing claims)
key-files:
  created:
    - src/cli/slash-command/bs/build/investigate.md
  modified: []
decisions:
  - "Re-investigate round behavior (143-RESEARCH.md Open Question 1) resolved as
    append-with-supersession: a refuted-once re-investigate round appends a new claim noting
    supersession of the objected claim, never edits or renumbers the original."
metrics:
  duration: "~15 minutes"
  completed: 2026-07-04
---

# Phase 143 Plan 03: Investigate Step Reference File Summary

Authored `src/cli/slash-command/bs/build/investigate.md` — the interpretation-engine reference
file for `/bs-build-chunk`'s investigate step (BUILD-02), mirroring `ingest/transcription.md`'s
fan-out-dispatch idiom and durably absorbing the doc-reading discipline `ingest/scaffold.md`
handed off.

## What Was Built

- **Context-Economics Hard Rule restated at step level**: the orchestrator never reads the
  chunk's cited/INDEX-discovered slices, RULINGS.md, DECISIONS.md, required docs, or DESIGN.md
  itself, and never re-reads a CHUNK.md section after the subagent writes it.
- **Required Reading list** cited verbatim per Pitfall 6: `docs/core-concepts.md` and
  `docs/common-pitfalls.md` always; `docs/actions-and-flow.md` for chunks with actions;
  `docs/custom-ui-guide.md` + `docs/ui-components.md` for `ui: touches|major`;
  `docs/dice-and-scoring.md` for dice mechanics; `DESIGN.md` for `ui: touches|major` chunks.
  investigate.md is now the permanent, durable owner of this list.
- **Fan-Out Dispatch**: a single fresh Task-tool subagent prompt naming the chunk's cited
  slices, INDEX-discovered slices, RULINGS.md, DECISIONS.md, resolved docs, and DESIGN.md
  (conditional). The subagent WRITES directly into CHUNK.md's `## Interpretation` (numbered,
  citation-backed claims, append-only), `## Visibility Declaration` (what is hidden from whom,
  keyed to claim numbers; explicit "none" for no-hidden-info chunks), and `## Newly Discovered
  Citations` (INDEX search surfacing uncited slices).
- **Structured return** uses the pinned field names verbatim: `claimsList`,
  `visibilityDeclaration`, `newlyDiscoveredCitations` — a short pointer/summary only, never the
  full claims text, per the CR-03 discipline from Phase 142's review fixes.
- **Re-investigate round behavior** (resolves 143-RESEARCH.md Open Question 1): a refuted-once
  round appends a new claim noting supersession of the objected claim rather than editing or
  renumbering the original — consistent with the Revision Rounds/Findings Ledger append-only
  philosophy elsewhere in CHUNK.template.md.
- **Orchestrator Records** section: the orchestrator accumulates only the returned summary
  fields, never re-reading CHUNK.md's `## Interpretation` before handing the claims list to
  `build/redteam.md`.
- **Downstream Shape footer**: cites `build/redteam.md` as consumer and CHUNK.template.md's
  sections without restating either's structure.

## Verification

- `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-02"` — 5/5 passed.
- All acceptance-criteria greps confirmed: 6 unique required-doc filenames; `DESIGN.md`,
  `RULINGS.md`, `DECISIONS.md` all present; `## Visibility Declaration`, `## Interpretation`,
  `## Newly Discovered Citations` headings all present; `claimsList` / `visibilityDeclaration` /
  `newlyDiscoveredCitations` all present. File is 126 lines (min_lines: 90 satisfied).
- Full `build-chunk.test.ts` run shows 27 passed / 11 failed — all 11 failures are BUILD-03
  (`build/redteam.md`) and BUILD-04 (`build/ask.md`) assertions, out of scope for this plan
  (143-03 covers BUILD-02/investigate.md only; redteam.md and ask.md are authored in later plans
  of this same phase). No BUILD-02 or BUILD-01/BUILD-12/cross-file-consistency test regressed.

## Deviations from Plan

None - plan executed exactly as written.

## Commits

- `bac77f13` — feat(143-03): author build/investigate.md interpretation step (BUILD-02)

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/build/investigate.md
- FOUND: bac77f13 (git log --oneline --all | grep bac77f13)
