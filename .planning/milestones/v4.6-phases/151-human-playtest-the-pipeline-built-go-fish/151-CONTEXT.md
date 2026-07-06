# Phase 151: Human playtest the pipeline-built Go Fish - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Mode:** Human-gate phase (verification inherently `human_needed` — the user drives the browser)

<domain>
## Phase Boundary

A human runs the Phase-150 regenerated Go Fish (`~/BoardSmithGames/go-fish-dryrun/`) in the browser via `npx boardsmith dev --players 2` and walks the numbered, click-by-click playtest script in `149-HUMAN-UAT.md` item by item. Each verified-checklist item is confirmed or a defect is recorded; feedback is triaged (this-chunk defect / future-scope / not-built-yet / rules-note). This closes VAL-01's deferred human gate — the one gate the v4.6 milestone shipped outstanding by design.

This phase does NOT rebuild the game (that was Phase 150) and does NOT substitute the hand-built `~/BoardSmithGames/go-fish/` for the pipeline output — the point is to validate the SKILLS' actual output.

</domain>

<decisions>
## Implementation Decisions

### Playtest Target & Script
- **Target:** the pipeline-built `~/BoardSmithGames/go-fish-dryrun/` (the actual skill output), NOT the hand-built reference. Run command: `cd ~/BoardSmithGames/go-fish-dryrun && npx boardsmith dev --players 2`.
- **Script:** the numbered click-by-click script in `.planning/milestones/v4.6-phases/149-end-to-end-dry-run-validation/149-HUMAN-UAT.md` (3 gameplay items + regression + taste + second-seat leak check).
- **Highest-value check:** the second-seat hidden-info leak check (switch to seat 2, confirm seat 1's hand + drawn-card identity are NOT visible). The automated `diffPlayerViews`/`assertNoHiddenInfoLeak` already proved this programmatically in Phase 150; this is the human-eyes confirmation.

### Claude's Discretion
- Claude may run a browser smoke-test first (Chrome extension) to de-risk — confirm the game loads and the ask-flow is interactable — but this does NOT close the gate. Final sign-off is the human's.
- Feedback triage buckets follow the playtest→revise skill semantics: this-chunk defect / future-scope / not-built-yet / rules-note.

</decisions>

<code_context>
## Existing Code Insights

- The regenerated project passed its full automated bar in Phase 150 (tsc clean, lint clean, 38/38 tests incl. random-sim to terminal + dual hidden-info leak checks, served HTTP 200). Phase 150's audit already caught and fixed a real production bug (F2: opponent-hand target-pick was non-selectable due to a choice-shape mismatch) — so the browser ask-flow is expected to work.
- Never leave a `boardsmith dev` server running — kill it after the playtest.

</code_context>

<specifics>
## Specific Ideas

- The playtest is chunk-1 scope only: deal → ask-a-held-rank → give-all-or-Go-Fish-draw → extra turn on hit/matching-draw. Books/scoring/win-condition are intentionally out of chunk-1 scope — their absence is expected, not a defect.

</specifics>

<deferred>
## Deferred Ideas

- Full multi-chunk playtest (books/scoring/final-acceptance) — future work, out of chunk-1 scope.
- Live installed-skills run playtest — future work.

</deferred>
