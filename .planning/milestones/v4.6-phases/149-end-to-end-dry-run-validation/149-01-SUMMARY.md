---
phase: 149-end-to-end-dry-run-validation
plan: 01
subsystem: bs-skills-pipeline-validation
tags: [dry-run, ingest, go-fish, validation]
requires: []
provides:
  - "scratch go-fish ingest artifacts (rulebook slices, INDEX, ASSETS, sketch, chunk-1 CHUNK.md) for Plan 02's build-chunk leg"
  - "logged pipeline friction/defect for Plan 03's fix leg"
affects:
  - "src/cli/lib/project-scaffold.ts (tsconfig.json generation — defect logged, NOT fixed here)"
tech-stack:
  added: []
  patterns:
    - "Interview-fallback ingest path (INGEST-03) exercised end-to-end against a clean, complete Go Fish ruleset"
key-files:
  created:
    - "<scratch>/go-fish-dryrun/** (throwaway, not committed — see Scratch Workspace below)"
  modified: []
decisions:
  - "Fed a clean, complete standard Go Fish ruleset (explicitly covering all 4 known ambiguity points) per CONTEXT.md's prove-the-pipeline-works framing, rather than a deliberately ambiguous one"
  - "Ran the interview-fallback path (INGEST-03), not transcription — least-exercised path per RESEARCH.md Pitfall 3"
  - "Applied a scratch-project-local tsconfig.json workaround (added `types: [\"vite/client\"]`) to unblock downstream ingest work, without touching BoardSmith source — the underlying scaffold defect is logged below for Plan 03, not fixed in this repo"
metrics:
  duration: "~45 min"
  completed: 2026-07-05
---

# Phase 149 Plan 01: Ingest Leg Dry-Run Summary

Ran the `/bs-ingest-rules` skill's real instructions (read directly from `src/cli/slash-command/bs/ingest-rules.md` + `bs/ingest/{scaffold,interview-fallback,sketch-derivation}.md`) against a scratch Go Fish project, producing a compiling+serving scaffold and a full, template-parseable ingest output set (rulebook slices, INDEX, ASSETS, visual survey, SKETCH.md with a mandated tail, chunk-1 CHUNK.md, empty RULINGS/DECISIONS ledgers) — while finding and logging one real, previously-unknown scaffold-template defect.

## Scratch Workspace

- **Location:** `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/` (a session-scoped `mktemp -d` parent; NOT under `~/BoardSmithGames/` or this repo). This is throwaway and OS-temp-cleaned; not committed. Plan 02/03 should re-derive the same path convention (`mktemp -d`, run `npx boardsmith init go-fish-dryrun` inside it) — or, if this exact directory still exists when Plan 02 runs, resume from it directly.
- `boardsmith` dependency: `file:/Users/jtsmith/BoardSmith` (auto-resolved absolute path by `init`'s local-monorepo detection) — mirrors the sibling-game pattern in CLAUDE.md.
- The hand-built `~/BoardSmithGames/go-fish/` was read-only referenced (its `tsconfig.json` and a `tsc --noEmit` run, both non-mutating) to root-cause the Task 1 defect below — never written to.

## What Ran (per task)

**Task 1 — Scaffold + Verify (`bs/ingest/scaffold.md`):**
- `npx boardsmith init go-fish-dryrun` → created cleanly, `file:` dep confirmed, axe-core ^4.12.1 + @vue/test-utils ^2.4.11 confirmed present as devDependencies (A3 from RESEARCH.md resolved: yes, wired).
- `npm install` — clean, 156 packages (npm's own audit warnings are pre-existing/unrelated to this dry-run).
- `npx tsc --noEmit` — **FAILED** on the freshly-scaffolded, unmodified project (see Defect 1 below). Root-caused, then unblocked via a scratch-local `tsconfig.json` edit (`"types": ["vite/client"]`), re-ran clean.
- `npx boardsmith dev --no-open` — reached the exact line `Ready! Press Ctrl+C to stop.`; `curl http://localhost:5173/` returned `200`; server process killed (`pkill -f "boardsmith dev --no-open"`), confirmed no residual process on port 5173.
- No file under `~/BoardSmithGames/` was touched.

**Task 2 — Interview-fallback ingest (`bs/ingest/interview-fallback.md`):**
- Ran the full 8-question interview sequence (vision, components, setup, turn structure, actions, round completion, game end, summary/confirmation) against the standard clean Go Fish ruleset from `149-RESEARCH.md`.
- Wrote `rulebook/{01-vision,02-components,03-setup,04-turn-structure,05-actions,06-round-completion,07-game-end}.md`, each cited `designer statement, ingest session, Q{n}` per the interview-fallback citation format.
- Wrote `rulebook/INDEX.md` (term → slice cross-reference, edition header "unpublished — designer statement"), `rulebook/00-visual-survey.md` (thin — interview path has no rulebook art to survey, explicitly noted as expected-thin rather than a gap), and `ASSETS.md` (2-row ledger: card-face + card-back placeholders, needed-by chunk `core-event-loop`, both requested/not-received/placeholder-in-use, matching the 5-column parse contract).
- All four known ambiguities from RESEARCH.md (ask-requires-holding, extra-turn-on-matching-draw, empty-hand/empty-pond end, card-count-by-player-count) were deliberately covered explicitly in the fed-in ruleset text — none surfaced as an ingest-time ambiguity, as expected for a clean input.

**Task 3 — Sketch derivation + write files (`bs/ingest/sketch-derivation.md` + templates):**
- Derived `SKETCH.md`: chunk 1 = `core-event-loop` (`ui: major`, the first playable surface), followed by two **mandated sketch-level tail entries** (`game-end-scoring`, `final-acceptance`) each carrying the exact byte-identical marker `Status: proposed (sketch-level — no CHUNK.md yet)`.
- Created `chunks/core-event-loop/CHUNK.md` with a numbered `## Interpretation` (6 claims, each cited to a rulebook slice), a `## Visibility Declaration` (opponent hand + drawn-card-identity hidden; asked rank + public outcome visible — mirrors the hand-built game's `contentsVisibleToOwner()`/pond-hidden discipline), and all other required sections present but explicitly marked "not run" where they belong to `/bs-build-chunk` steps out of this ingest-only plan's scope (Redteam Rounds, Findings Ledger, Build Manifest, Verified Checklist).
- Seeded empty `RULINGS.md` + `DECISIONS.md` ledgers.
- **Verified both files parse against their templates**: every required heading from `SKETCH.template.md`'s and `CHUNK.template.md`'s PARSE CONTRACT is present, in order, byte-matching (checked via direct grep against each required heading string).

## Pipeline Defects / Friction Found (for Plan 03 — NOT fixed here)

### Defect 1 (HIGH — blocks Step 1 of ingest-rules.md for every new project): freshly-scaffolded project fails `tsc --noEmit` out of the box

**What:** Immediately after `npx boardsmith init <name>` with no modifications, `npx tsc --noEmit` fails:
```
.../src/ui/composables/useActionController.ts(157,34): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
```

**Root cause (traced, not guessed):**
1. `src/cli/lib/project-scaffold.ts` generates `src/ui/index.ts` containing `export type { UseActionControllerReturn } from 'boardsmith/ui';`.
2. In local-monorepo dev mode, `boardsmith`'s `package.json` `exports["./ui"]` points directly at raw source (`./src/ui/index.ts`), not a compiled `.d.ts` — so resolving that type-only re-export requires tsc to fully type-check `boardsmith/ui`'s entire module graph, which transitively reaches `useActionController.ts`.
3. `useActionController.ts` reads `import.meta.env.DEV` (a Vite-ambient global), but the scaffold's generated `tsconfig.json` has no `"types": ["vite/client"]` entry, so `ImportMeta.env` is unresolvable → TS2339.
4. Confirmed this is scaffold-specific, not a general monorepo issue: `~/BoardSmithGames/go-fish` (read-only, unmodified) has a `tsconfig.json` in the same shape but its own `src/ui/index.ts` never re-exports anything from `boardsmith/ui` (only re-exports its own `App.vue`/`GameTable.vue`) — so it never pulls `useActionController.ts` into its compilation graph, and its `tsc --noEmit` is clean today.

**Disposition:** Logged for Plan 03. Two candidate fixes to evaluate there (not decided here): (a) add `"types": ["vite/client"]` to the scaffold-generated `tsconfig.json` template in `project-scaffold.ts` (the workaround applied locally in this scratch project), or (b) drop the generated `src/ui/index.ts`'s re-export of `UseActionControllerReturn` if it isn't actually needed by scaffold-generated code (worth checking whether anything in the scaffold actually consumes that type re-export, or if it's vestigial). This blocks **every** `boardsmith init` in local-monorepo dev mode until fixed — a real "Chunk 1 must start from a known-good, verified-compiling baseline" violation per `scaffold.md`'s own stated contract.

**Scratch-local workaround applied (this plan only, not committed to BoardSmith):** added `"types": ["vite/client"]` to the scratch project's `tsconfig.json` `compilerOptions`, which resolved the error with no other changes.

### Friction 2 (LOW — documentation/observation only): interview-fallback visual survey is necessarily thin

Not a defect — `bs/ingest/interview-fallback.md` and the Step 3 synthesis instructions correctly anticipate this (the interview path has no rulebook pages/images to extract `visualEvidence[]` from), but it's worth noting for Plan 03's comparison report: the `00-visual-survey.md` produced via interview-fallback is qualitatively thinner than what a transcription-path run against an illustrated rulebook would produce. This is expected behavior, not a bug — flagging only so the Plan 03 report doesn't mistake "thin" for "broken."

### No other friction found in Tasks 2-3

The `ingest-rules.md` orchestrator prose (Steps 0/2/3/4/5/6/7), `interview-fallback.md`'s 8-question sequence + citation format, and `sketch-derivation.md`'s chunk-carving heuristic (core-event-loop first, mandated tail entries with the exact marker string, `ui:` tagging, lazy-tail cap) were all directly followable with no ambiguity, no missing cross-references, and no template-parse mismatches. `${CLAUDE_SKILL_DIR}/../bs-shared/...` path-translation (per this plan's objective note) resolved cleanly to `src/cli/slash-command/bs/...` siblings with zero "file not found" incidents — Pitfall 2 from RESEARCH.md (installer bs-shared/ layout question) is out of scope for this ingest-only leg and not exercised here (it's a Phase 148 installer concern, not an ingest-content concern).

## Deviations from Plan

### Auto-fixed / Logged Issues

**1. [Rule 3-adjacent, scoped to scratch only — NOT a BoardSmith repo fix] tsc failure on fresh scaffold**
- Found during: Task 1
- Issue: see Defect 1 above.
- Fix: scratch-project-local `tsconfig.json` edit only (`"types": ["vite/client"]`) — BoardSmith repo source (`project-scaffold.ts`) was deliberately left unmodified per this plan's explicit instruction to log, not fix, pipeline defects; this defect lives in generated scaffold OUTPUT, and the true fix belongs in Plan 03's skill/scaffold-template fix leg.
- Files modified: `<scratch>/go-fish-dryrun/tsconfig.json` only (throwaway, not committed).
- Commit: n/a (scratch dir, not part of this repo).

No other deviations — Tasks 2 and 3 executed exactly as the real skill files instruct.

## Known Stubs

None applicable — this is ingest-only artifact output (markdown state files), not application code with data-flow stubs.

## Threat Flags

None — no new network/auth/schema surface introduced; the plan's own threat model (T-149-01, T-149-SC) was satisfied: `~/BoardSmithGames/go-fish/` was read-only referenced (2 non-mutating reads: `cat tsconfig.json`, `tsc --noEmit`) and never written; no new npm packages were added to BoardSmith or the scratch project beyond the scaffold's own pre-pinned devDeps.

## Self-Check: PASSED

- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/package.json` (contains `boardsmith`)
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/rulebook/INDEX.md`
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/SKETCH.md` (contains "core event loop" via the `core-event-loop` slug's "What it builds" line + mandated tail marker)
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/chunks/core-event-loop/CHUNK.md`
- FOUND: `~/BoardSmithGames/go-fish/` untouched (verified via `git status`-equivalent: only reads performed, no writes issued against that path)
- No git commits reference scratch-dir paths (scratch is outside this repo and not committed) — this SUMMARY.md itself is the durable record.
