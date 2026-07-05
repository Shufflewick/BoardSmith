# Requirements — v4.6 BS Skills (reopened for playtest follow-up)

The v4.6 milestone shipped 2026-07-05 (Phases 140–149, 34/34 requirements — see
`milestones/v4.6-REQUIREMENTS.md`). It was reopened 2026-07-05 to close VAL-01's
deferred human-playtest gate honestly: the Phase-149 dry-run generated its Go Fish
into a throwaway `/tmp` scratch project that was deleted during cleanup, so there is
no pipeline-built game left to playtest. These two follow-up phases regenerate it
into a stable location and complete the human playtest.

## Requirements (GEN, PLAY)

- [ ] **GEN-01**: The `bs-` pipeline regenerates the Go Fish chunk-1 game (ingest + core-event-loop build via the real skills) into a STABLE, non-throwaway location that survives cleanup (e.g. `~/BoardSmithGames/go-fish-dryrun/`), leaving a compiling+serving project and a recorded dev-server run command — this is the pipeline's OUTPUT, distinct from the hand-built `~/BoardSmithGames/go-fish/` reference.
- [ ] **PLAY-01**: A human playtests the pipeline-generated Go Fish in the browser using the `149-HUMAN-UAT.md` script (updated to point at the regenerated location), records the item-by-item result, and thereby closes VAL-01's deferred human gate.

## Traceability

| Req | Phase | Status |
|-----|-------|--------|
| GEN-01 | Phase 150 | Pending |
| PLAY-01 | Phase 151 | Pending |
