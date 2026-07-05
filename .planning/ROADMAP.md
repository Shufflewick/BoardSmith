# Roadmap — BoardSmith

## Milestones

- 🚧 **v4.6 BS Skills (Rulebook-Driven Game Building)** — Phases 140–149 SHIPPED 2026-07-05 ([archive](milestones/v4.6-ROADMAP.md) · [requirements](milestones/v4.6-REQUIREMENTS.md) · [audit](v4.6-MILESTONE-AUDIT.md)); **reopened** for Phases 150–151 (regenerate + human-playtest the pipeline-built Go Fish to close VAL-01's deferred gate).

_Prior milestones (v0.1–v4.5) archived under `.planning/milestones/`._

## 🚧 v4.6 BS Skills — Playtest Follow-Up (reopened)

**Why reopened:** VAL-01's human browser-playtest was deferred at close. The Phase-149 dry-run generated its Go Fish into a throwaway `/tmp` scratch project that cleanup deleted, so the pipeline-built game no longer exists to playtest. Phase 150 regenerates it into a stable location; Phase 151 is the human playtest that closes the gate. Playtesting the hand-built `~/BoardSmithGames/go-fish/` is explicitly NOT a substitute — the point is to validate the SKILLS' output.

#### Phase 150: Regenerate the pipeline-built Go Fish (stable location)
**Goal**: The `bs-` pipeline rebuilds the Go Fish chunk-1 game via the real skills into a durable, non-throwaway location that compiles, serves, and is ready for a human to playtest.
**Depends on**: Phase 149 (the completed skills + the dry-run report)
**Requirements**: GEN-01
**Success Criteria** (what must be TRUE):
  1. The ingest + chunk-1 build legs of the pipeline (following `src/cli/slash-command/bs/ingest-rules.md` + `build-chunk.md`, interview-fallback path, path-translation `${CLAUDE_SKILL_DIR}/../bs-shared/X` → `src/cli/slash-command/bs/X`) are re-run against standard Go Fish rules into a STABLE dir (recommend `~/BoardSmithGames/go-fish-dryrun/`, a sibling of the other games, NOT `/tmp`) — the hand-built `~/BoardSmithGames/go-fish/` stays READ-ONLY.
  2. The regenerated project compiles (`tsc --noEmit` clean), passes its generated tests + `simulateRandomGames` to a terminal state, proves opponent hands don't leak (`diffPlayerViews`/`assertNoHiddenInfoLeak`), and `npx boardsmith dev` serves it (server then killed — never left running).
  3. The regenerated location + the exact dev-server run command are recorded, and `149-HUMAN-UAT.md`'s playtest script is updated to point at this location. The generated project is NOT deleted (it is the artifact of the pending playtest).
**Plans**: TBD

#### Phase 151: Human playtest the pipeline-built Go Fish
**Goal**: A human verifies the pipeline-built Go Fish in the browser on the numbered playtest script, closing VAL-01's deferred human gate honestly.
**Depends on**: Phase 150
**Requirements**: PLAY-01
**Success Criteria** (what must be TRUE):
  1. The user runs the regenerated Go Fish (`npx boardsmith dev` in the Phase-150 stable location) and walks the `149-HUMAN-UAT.md` numbered, click-by-click script item by item.
  2. Each verified-checklist item is confirmed or a defect is recorded; feedback is triaged (this-chunk defect / future-scope / not-built-yet / rules-note) per the playtest→revise skill semantics.
  3. The HUMAN-UAT item is marked resolved (or its residual defects captured as follow-ups), completing VAL-01's human gate. This phase's verification is inherently `human_needed` — the user drives the browser.
**Plans**: TBD

### Progress

**Execution Order:** 150 → 151

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 150 | 0 | Not started | — |
| 151 | 0 | Not started | — |

## Next

Fresh context: run `/gsd-autonomous` (or `/gsd:plan-phase 150`) to plan+build Phase 150, then Phase 151 (the human playtest) will pause for you at the browser gate.
