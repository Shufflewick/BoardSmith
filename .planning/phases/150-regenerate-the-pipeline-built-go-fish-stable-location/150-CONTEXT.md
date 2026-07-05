# Phase 150: Regenerate the pipeline-built Go Fish (stable location) - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Re-run the `bs-` pipeline's **ingest leg** (`src/cli/slash-command/bs/ingest-rules.md` + `ingest/*`) and **chunk-1 `core-event-loop` build leg** (`build-chunk.md`) against standard Go Fish rules, following the real skill files, into a **durable, non-throwaway** project directory. The output must compile (`tsc --noEmit` clean), pass its generated tests + `simulateRandomGames` to a terminal state, prove no opponent-hand leak (`diffPlayerViews` / `assertNoHiddenInfoLeak`), and serve under `npx boardsmith dev` (server then killed). Finally, repoint `149-HUMAN-UAT.md`'s playtest script at the new stable location and preserve the generated project (do NOT delete it — it is the artifact of the pending Phase-151 playtest).

This phase does NOT run the human playtest (that is Phase 151) and does NOT modify the hand-built `~/BoardSmithGames/go-fish/` (READ-ONLY reference).

</domain>

<decisions>
## Implementation Decisions

### Regeneration Approach
- **Target location:** `~/BoardSmithGames/go-fish-dryrun/` — a stable sibling of the other example games, NOT `/tmp`. The hand-built `~/BoardSmithGames/go-fish/` stays READ-ONLY.
- **Pipeline execution mode:** self-dispatched, scaled fan-out (one real pass per adversarial lens), identical to the 149 dry-run. Every lens's logic is genuinely exercised with real APIs; only the number of independent Task dispatches per lens is reduced. The durable artifact — not re-proving the adversarial machinery — is the goal of this phase.
- **Ingest path:** interview-fallback (`bs/ingest/interview-fallback.md`) against clean, complete standard Go Fish rules (no illustrated rulebook to transcribe), matching the 149 input so the output stays comparable to the 149 dry-run.
- **Scope:** ingest + chunk-1 `core-event-loop` only. Books/13-book win condition, scoring, and `final-acceptance` stay out of scope (SKETCH.md's mandated tail, later chunks) — exactly the scope the pending human playtest covers.

### Path Translation
- `${CLAUDE_SKILL_DIR}/../bs-shared/X` references resolve to `src/cli/slash-command/bs/X` siblings (repo-relative dry-run, same as 149 — the skills are executed directly from this repo, not from an installed `.claude/commands/` surface).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/slash-command/bs/ingest-rules.md`, `ingest/{scaffold,interview-fallback,sketch-derivation}.md` — the ingest leg skill files.
- `src/cli/slash-command/bs/build-chunk.md` + `build/*` (investigate → redteam → ask → build → test → audit → repair → playtest-capture) — the chunk-1 build leg.
- `src/cli/commands/init.ts` + `src/cli/lib/project-scaffold.ts` — `boardsmith init` scaffolder. The 149 dry-run fixed D1 (`vite/client` types in generated tsconfig) and D2 (`git init` on scaffold) here; a fresh scaffold now compiles clean and is a git repo out of the box.
- `~/BoardSmithGames/go-fish/src/rules/{game,elements,actions,flow}.ts` — READ-ONLY hand-built reference (the 149 comparison baseline).

### Established Patterns
- Local-monorepo detection resolves the `boardsmith` dependency to `file:/Users/jtsmith/BoardSmith` for a game scaffolded on this machine (Vite HMR picks up local source).
- Chunk-1 automated discipline: `tsc --noEmit`, `boardsmith lint` (7 sandbox rules), unit/integration tests, `simulateRandomGames` (50 × [2,3,4] players), a11y floor (5 items), `diffPlayerViews` + `assertNoHiddenInfoLeak` two-seat leak check.

### Integration Points
- `149-HUMAN-UAT.md` (now archived at `.planning/milestones/v4.6-phases/149-end-to-end-dry-run-validation/149-HUMAN-UAT.md`) — its "What to run" section + numbered script must be updated to point at the new stable location.
- `149-DRYRUN-REPORT.md` — the record of what the 149 run produced and the four comparison axes; the regeneration should reproduce the same chunk-1 shape.

</code_context>

<specifics>
## Specific Ideas

- Never leave `boardsmith dev` running — kill it after each reachability/serve check.
- Preserve the regenerated project after the phase (it is the pending-playtest artifact); record the exact dev-server run command.
- The regenerated chunk-1 output is expected to match the 149 dry-run's shape: `isFinished()` terminal condition = "pond empty" (honest depth-cut), `Books` defined-but-unwired, identical hand/pond visibility declarations.

</specifics>

<deferred>
## Deferred Ideas

- Live installed-skills run (via the Phase-148 installer into a separate designer project) to close the Pitfall-2 harness-mapping question — future work, not this phase.
- Full multi-chunk dry-run (books/scoring/final-acceptance) — future work, out of chunk-1 scope.

</deferred>
