---
phase: 141-file-templates-state-machine-authority
plan: 03
subsystem: bs-skills-templates
tags: [documentation, templates, cli, bs-skills]
dependency-graph:
  requires: [141-01, 141-02]
  provides: [RULINGS.template.md, DECISIONS.template.md, DESIGN.template.md, ASSETS.template.md, complete-templates.test.ts]
  affects: [142-bs-ingest-rules, 143-146-bs-build-chunk]
tech-stack:
  added: []
  patterns:
    - "Append-only ledger with HTML-comment fill-in guidance (Pattern 3), guidance stays after filling"
    - "PARSE CONTRACT (TMPL-02) comment block naming required headings, consistent with CHUNK/SKETCH templates from Plan 02"
key-files:
  created:
    - src/cli/slash-command/bs/templates/RULINGS.template.md
    - src/cli/slash-command/bs/templates/DECISIONS.template.md
    - src/cli/slash-command/bs/templates/DESIGN.template.md
    - src/cli/slash-command/bs/templates/ASSETS.template.md
  modified:
    - src/cli/slash-command/bs/templates.test.ts
decisions:
  - "RULINGS.template.md and DECISIONS.template.md both use a numbered '### Ruling N' / '### Decision N' append-only ledger shape (mirrors CHUNK.template.md's Revision Rounds pattern from Plan 02) rather than a flat table, since each entry needs multi-line Decision/Citation/Rationale (or Decision/Rationale/Invariant) fields"
  - "DESIGN.template.md's hard rule sentence is asserted verbatim by the drift test ('color literals live only in the theme block, everything else references tokens') to prevent silent rewording"
  - "ASSETS.template.md ledger uses a markdown table (not numbered sections) since its RESEARCH-mandated shape is explicitly columnar (needed-by-chunk, requested, received, placeholder-in-use, file path)"
metrics:
  duration: "~25 minutes"
  completed: 2026-07-04
---

# Phase 141 Plan 03: RULINGS/DECISIONS/DESIGN/ASSETS templates + completed drift test Summary

Wrote the four remaining ledger/reference `.template.md` files and completed `templates.test.ts` so the drift test now guards all six templates plus `state-machine.md`, closing TMPL-01 and TMPL-02 structurally for this phase.

## What Was Built

- **`RULINGS.template.md`** — a designer-decisions ledger where each `### Ruling N` entry has `Decision` / `Citation interpreted or overridden` / `Rationale` fields. Guidance states rulings outrank the rulebook (cross-referencing `../state-machine.md` "Rulings Outrank Rulebook") and names the writing gates: any `ask`/`playtest` step, and redteam refuted-twice escalation.
- **`DECISIONS.template.md`** — an implementation-decisions ledger where each `### Decision N` entry has `Decision` / `Rationale` / `Invariant` fields. Includes the plan's own illustrative example (money as a number on Player; 0-39 space indexing wrapping via modulo). Guidance names `build` and `close` (rollup) as the writing steps.
- **`DESIGN.template.md`** — the visual-identity contract: `## Chosen Direction` (Adopt/Derive/Original + rationale), `## Theme Block (--bsg-* / applyTheme() overrides)` (the only place color literals may appear), `## Typography & Spacing`, `## Component Recipes`, `## Placeholder Policy`, `## Do / Don't` carrying the hard rule verbatim ("color literals live only in the theme block, everything else references tokens"). Guidance notes DESIGN.md is written at the first UI chunk's `ask` step and that changing it is itself a chunk (re-opens verified chunks per the restyle/cutover rule in `state-machine.md`).
- **`ASSETS.template.md`** — a component/asset ledger table with the exact columns `needed-by-chunk | requested | received | placeholder-in-use | file path`. Guidance notes it's populated at ingest (component inventory) and at each chunk's `ask` step, and that a missing asset never blocks — a designed placeholder is recorded instead.
- **`templates.test.ts`** — added two new `describe` blocks:
  - `TMPL-01 — six templates ship with required content`: asserts all six template files exist and are non-empty; RULINGS mentions the citation-per-entry requirement; DECISIONS mentions invariants; DESIGN contains `--bsg-` and the theme-block color rule phrase verbatim; ASSETS contains all five column labels verbatim; and a guard that none of the six files is a `{{BOARDSMITH_ROOT}}` thin pointer.
  - `TMPL-02 — each template declares its parse contract`: asserts CHUNK/SKETCH expose their `Status:`/derived-status grammar, and each of the four new ledger templates carries its `PARSE CONTRACT (TMPL-02)` comment plus its required top-level heading (`## Ledger` for RULINGS/DECISIONS/ASSETS, `## Chosen Direction` for DESIGN).

## Verification

- `npx vitest run src/cli/slash-command/bs/templates.test.ts` — 27 tests, all green.
- `npm test` — full suite, 179 files / 2413 tests, all green (no collateral breakage).
- `ls src/cli/slash-command/bs/templates/` confirms all six `.template.md` files present.
- `grep -L "{{BOARDSMITH_ROOT}}" src/cli/slash-command/bs/templates/*.template.md` lists all six files (none are thin pointers).

## Deviations from Plan

None — plan executed exactly as written. No auth gates encountered.

## Known Stubs

None. These are intentionally-unfilled skeleton templates (per the plan's own design — sessions fill them later, they ship empty with HTML-comment guidance retained). This is the plan's stated deliverable shape, not a stub.

## Threat Flags

None. Per the plan's own threat model (T-141-03), this plan produces static markdown ledger templates and vitest content assertions only — no runtime execution, no inputs, no network, no new attack surface.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/templates/RULINGS.template.md
- FOUND: src/cli/slash-command/bs/templates/DECISIONS.template.md
- FOUND: src/cli/slash-command/bs/templates/DESIGN.template.md
- FOUND: src/cli/slash-command/bs/templates/ASSETS.template.md
- FOUND commit c09cd1da (Task 1: RULINGS + DECISIONS)
- FOUND commit 502f19ee (Task 2: DESIGN + ASSETS)
- FOUND commit 6476639c (Task 3: templates.test.ts completion)
