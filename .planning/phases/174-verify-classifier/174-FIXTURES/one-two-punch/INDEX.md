# Fixture Index — one-two-punch

Real pass-1 (live) and pass-2 (staged) rulebook slices archived from a `cp -R` scratch copy of
`~/BoardSmithGames/one-two-punch` (HEAD `7e69471bd8980a854f3e351f2f486e1fb6f712b9` — this repo
has known pre-existing unrelated dirty state, not asserted porcelain-empty per Phase 173's
documented exception), produced by `174-01-PLAN.md`. See `../MANIFEST.md` for the reproduction
command sequence and per-file hashes.

- `live/` — the game's pre-existing pass-1 rulebook slices (`rulebook/*.md`), byte-identical to
  the untouched original — 3 files, one of which (`00-visual-survey.md`) is not a rule slice.
  2 real rule slices: `01-setup-and-round-structure.md`, `02-action-cards-and-resolution.md`.
  `INDEX.md` here has NO `## Slices` table (unlike `seven`'s) — the exact structural asymmetry
  that ruled out an INDEX-keyed pairing scheme (174-CONTEXT.md decision 4, AMENDED).
- `staged/` — the pass-2 re-transcription this plan produced, run-id
  `2026-07-29T23-28-06Z`, one dispatch covering page range `1-2` — 6 files.
- `RUN.md` — the run's ledger, verbatim, all 6 units `range-complete`.

This is the game carrying the legacy `Derived (p.N) — diagram description:` / `— art:`
presentation-note forms on its live side (174-CONTEXT.md decision 12b) — 5 `diagram description`
+ 1 `art` of 12 total live `Derived` lines, measured directly against these archived files.
