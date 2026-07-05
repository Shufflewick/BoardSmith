---
phase: 149-end-to-end-dry-run-validation
plan: 03
subsystem: bs-skills-pipeline-validation
tags: [dry-run, compare, fix, report, go-fish, validation]
requires:
  - "149-01 (ingest artifacts) + 149-02 (chunk-1 generated code + defect log)"
provides:
  - "149-DRYRUN-REPORT.md: run log, 4-axis comparison table, defect ledger, deferred items"
  - "149-HUMAN-UAT.md: self-contained browser-playtest manual item"
  - "two pipeline defects (D1 scaffold tsconfig, D2 scaffold git-init) fixed at source in BoardSmith CLI code"
affects:
  - "src/cli/lib/project-scaffold.ts (generateTsConfig, generatePackageJson)"
  - "src/cli/commands/init.ts (initCommand)"
tech-stack:
  added: []
  patterns:
    - "Fix-at-source in CLI scaffold code (not skill markdown) when the true defect root cause lives in generated project code, not skill instruction text"
key-files:
  created:
    - ".planning/phases/149-end-to-end-dry-run-validation/149-DRYRUN-REPORT.md"
    - ".planning/phases/149-end-to-end-dry-run-validation/149-HUMAN-UAT.md"
  modified:
    - "src/cli/lib/project-scaffold.ts"
    - "src/cli/lib/project-scaffold.test.ts"
    - "src/cli/commands/init.ts"
    - "src/cli/commands/init.test.ts"
decisions:
  - "D1's true fix is scaffold-side (types:['vite/client'] + explicit vite devDependency), not a skill-markdown fix — no bs- skill file needed editing for either defect"
  - "D2 fixed via the pit-of-success path: boardsmith init itself runs git init + an initial commit (best-effort, non-fatal), rather than pushing the responsibility onto ingest-rules.md/build-chunk.md instructions"
  - "F2 (ask-gate human-negotiation untested) and F3 (design-ask gate skipped) recorded as documented friction/observations, not fixed as skill defects — the skill instructions themselves are correct; F2 is inherent to a headless dry-run and F3 is an execution gap in the 149-02 dry-run run, not a skill-text bug"
metrics:
  duration: "~1.5 hours"
  completed: 2026-07-05
---

# Phase 149 Plan 03: Compare + Fix + Report Summary

Compared the dry-run's chunk-1 output against the hand-built `~/BoardSmithGames/go-fish/` on all four locked axes (rule fidelity, hidden-info redaction, BoardSmith idiom, artifact/template quality) — 3 clean MATCHes and 1 MATCH-with-acceptable-divergence (chunk-1's intentional depth-cut scope, no books/scoring). Fixed both logged pipeline defects (D1: fresh-scaffold `tsc --noEmit` failure; D2: no `git init` on scaffold) at source in BoardSmith's CLI scaffold/init code — not the bs- skill markdown, since the true root cause in both cases lived in generated project code, not skill instructions. Wrote `149-DRYRUN-REPORT.md` and the self-contained `149-HUMAN-UAT.md` browser-playtest item.

## What Ran (per task)

**Task 1 — Compare chunk-1 vs. hand-built go-fish:**
- Read the hand-built `game.ts`/`elements.ts`/`actions.ts` (read-only) and the scratch project's equivalent files (`/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/src/rules/`).
- Confirmed rule fidelity: both implementations self-scope the ask action's rank choice to the asker's own hand, transfer all matching cards + grant an extra turn on a hit, draw-and-check-match on a miss, and end the turn cleanly when the pond is empty — using the byte-identical action prompt string in both, confirming the dry-run's investigate step correctly re-derived the rulebook.
- Confirmed hidden-info redaction: both declare `hand.contentsVisibleToOwner()` and `pond.contentsHidden()` identically; the dry-run additionally proved this at the audit step with real `diffPlayerViews`/`assertNoHiddenInfoLeak` calls (0 leaks, non-vacuous allow-predicate proven by a failing control case) — something the hand-built game's own test suite does not do.
- Confirmed BoardSmith idiom match with one acceptable divergence: chunk-1 defines but never wires `Books` (book-forming/scoring is out of chunk-1's scope by design — a later sketch-tail chunk owns it).
- Confirmed artifact/template quality: SKETCH.md/CHUNK.md/ASK-PROPOSAL.md/PLAYTEST-SCRIPT.md all parse against their templates' PARSE CONTRACT headings.
- Full comparison table: `149-DRYRUN-REPORT.md` §2.

**Task 2 — Fix every surfaced pipeline defect at source:**
- **D1** (149-01, HIGH): a fresh `npx boardsmith init` scaffold failed `tsc --noEmit` (`TS2339` on `ImportMeta.env`) because the generated tsconfig lacked `vite/client` ambient types, needed once `boardsmith/ui`'s local-monorepo raw-source resolution transitively reaches `useActionController.ts`'s `import.meta.env.DEV`. Fixed in `src/cli/lib/project-scaffold.ts`: added `"types": ["vite/client"]` to `generateTsConfig()` and an explicit `vite` devDependency to `generatePackageJson()` (not relying on `@vitejs/plugin-vue` hoisting). Verified end-to-end: fresh `boardsmith init` → `npm install` → `npx tsc --noEmit` — clean, in a real throwaway project outside this repo.
- **D2** (149-02 Finding 1, MEDIUM): `boardsmith init` never ran `git init`, making `build-chunk.md`'s Git Protocol unimplementable on a fresh scaffold. Fixed in `src/cli/commands/init.ts`: `initCommand` now runs `git init` + `git add -A` + an initial commit, wrapped in try/catch (non-fatal — scaffolding must not fail because git setup did). This is the pit-of-success fix (scaffold owns git-init, not the skill instructions). Verified end-to-end: fresh `boardsmith init` → `.git/` exists.
- Regression tests added: `project-scaffold.test.ts` (2 new tests: tsconfig includes `vite/client`, package.json includes explicit `vite`) and `init.test.ts` (2 new tests: `.git` exists after `initCommand`; scaffolding stays non-fatal when git setup fails).
- F2 (ask-gate human-negotiation untested) and F3 (design-ask gate skipped in 149-02) recorded as documented friction/observations — no code or skill-text change; both are execution/scope observations, not bugs in the skill instructions as written (re-confirmed by reading `ask.md` directly during this task).
- Pitfall-2 (`bs-shared/` path layout) — re-confirmed no defect: path translation resolved cleanly with zero incidents across both prior legs.
- **No `src/cli/slash-command/bs/**` skill markdown files required editing** — both real, fixable defects lived in CLI scaffold/init code, not skill instruction text.
- Ran `npx vitest run src/cli/slash-command/bs/` — **237/237 pass** (drift suites, unaffected by construction since no skill files changed, re-run anyway per the plan's mandatory gate).
- Ran `npm test` — **2651/2651 pass, 184 files** (full BoardSmith suite, confirming no regression from the scaffold/init fixes).

**Task 3 — Write the report + HUMAN-UAT item:**
- `149-DRYRUN-REPORT.md`: what ran (ingest leg, build leg, compare/fix leg + fan-out scaling note), the full comparison table, the defect log with dispositions, drift/full-suite confirmation, and deferred items.
- `149-HUMAN-UAT.md`: self-contained (script copied inline, not referencing the throwaway scratch dir) browser-playtest item — numbered click-by-click script, regression/taste/second-seat-leak-check sections, unchecked Verified Checklist, `Status: partial / pending`.

## Deviations from Plan

None — both defects were fixed exactly as the plan's Task 2 instructed (fix at source, keep drift + full suite green), and no additional pipeline defects were discovered during the comparison beyond the two already logged by 149-01/149-02.

## Known Stubs

None applicable to this plan's own output (report/UAT markdown + scaffold code fixes). The scratch project's own known stubs (`getWinners()` placeholder, unwired `Books` element) are documented in 149-02-SUMMARY.md and reiterated in `149-DRYRUN-REPORT.md`'s comparison table (§2, axis c) as intentional chunk-1 depth cuts, not stubs requiring fixing.

## Threat Flags

None — `~/BoardSmithGames/go-fish/` was read-only referenced (game/elements/actions.ts files) and never written (confirmed via `git status --short` before and after this plan's work: only a pre-existing, unrelated `vite.config.ts.timestamp-*.mjs` file dated Jul 3 — before this phase began — was present, not created by this plan). No new network/auth/schema surface introduced; the `git init` fix adds a local, non-networked git repository to newly-scaffolded projects only.

## Self-Check: PASSED

- FOUND: `.planning/phases/149-end-to-end-dry-run-validation/149-DRYRUN-REPORT.md`
- FOUND: `.planning/phases/149-end-to-end-dry-run-validation/149-HUMAN-UAT.md`
- FOUND: `src/cli/lib/project-scaffold.ts` contains `types: ['vite/client']`
- FOUND: `src/cli/commands/init.ts` contains `git init`
- Commit `7255e284` exists in `git log` (`fix(cli): scaffold git-inits fresh projects and compiles clean out of the box`)
- CONFIRMED: `npx vitest run src/cli/slash-command/bs/` — 237/237 pass at time of writing
- CONFIRMED: `npm test` — 2651/2651 pass, 184 files, at time of writing
- CONFIRMED: no `boardsmith dev`/vite/vitest process left running (`ps aux | grep -i "boardsmith dev\|vite"` — empty)
- CONFIRMED: `~/BoardSmithGames/go-fish/` untouched by this plan (only a pre-existing, pre-phase untracked file present)
