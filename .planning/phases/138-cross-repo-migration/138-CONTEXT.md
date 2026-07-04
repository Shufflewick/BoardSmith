# Phase 138: Cross-Repo Migration - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Every example game and MERC comply with the full v4.5 API surface, with no lingering references to removed/changed APIs. Requirements GAMES-01 (all 8 games in ~/BoardSmithGames/, every suite green) and GAMES-02 (MERC re-vendored + green; gaps surfaced during migration fixed in BoardSmith `src/`, not worked around). Depends on Phases 131–137 (all shipped).

</domain>

<decisions>
## Implementation Decisions

### Migration Strategy
- **Verification depth**: All 8 game suites green (GAMES-01 hard requirement) **+ Playwright browser smoke on a representative subset** — hex (grid/drag — exercises UIX-04 drag gating live), go-fish (cards/hidden-info — exercises SEC-01 restore + toast), cribbage (complex multi-phase — exercises multiSelect + flow changes). Headless Playwright per the established fallback (never leave a dev server running).
- **MERC process (GAMES-02)**: Re-vendor following MERC's commit-history re-vendor pattern → run its suite (738-test baseline) → any gap surfaced is **fixed in BoardSmith `src/` with a red-first test** → re-vendor → re-run. NEVER work around in MERC. Iterate until green.
- **Migration inventory**: **Fresh grep sweep per breaking change across all 9 repos.** The accumulated phase notes are the seed list, not the truth. Seed list of v4.5 breaking changes to sweep for:
  - Phase 131: `state.players` now per-viewer filtered (games reading opponents' custom Player attrs — public-by-default preserved, but Player-child elements now filtered); debug data opt-in (`includeDebugData` default false); `visibleAttributes` now enforced.
  - Phase 132: `resolveArgs` no longer coerces bare-number followUp args (**MERC rebel-economy.ts/rebel-equipment.ts known exposure**); `forEach<T>` type constraint; `registerAction` throws on handler-less `.build()` actions.
  - Phase 133: server-side multiSelect count/duplicate/array-type enforcement (custom UIs submitting scalars/dupes now rejected); `switchOn` throws on unmatched; eachPlayer wrap (no known users).
  - Phase 134: `session.runner` is a read-only facade (test files calling runner.performAction break); `start()` returns Promise<ActionResult>; `dragProps` honors `when`; hooks accumulate.
  - Phase 135: `playerCount` + dead `$schema` URL removed/rejected in boardsmith.json (**all 8 games carry playerCount — every boardsmith.json needs editing**); `boardsmith dev` defaults to 127.0.0.1; `--template` gone.
  - Phase 136: MeepleClient all-throwing contract (custom UIs checking `.success` on lobby methods break); client types canonical; `generatePlayerId` export.
  - Phase 137: `TestGame.doAction` throws (expected-failure tests migrate to `tryAction`; silently-failing setup moves will surface as real bugs — fix them); fixed default seed (shuffle-dependent tests may need explicit seeds or assertion updates).
- **Scope discipline**: Only migration + surfaced-bug fixes. No opportunistic refactors in game repos. Each game gets its own commit(s) in its own repo. BoardSmith fixes get their own commits in BoardSmith.

### Process
- PROC-01-style verification doc NOT required for this phase (no audit findings — it's a migration phase), but a per-repo migration ledger (what changed, suite result) goes in the SUMMARYs.
- **MERC pre-existing uncommitted changes (USER DECISION 2026-07-03): commit them first as-is** — snapshot the in-progress work (protocol.tgz ref, partial --bs-*→--bsg-* CSS rename, boardsmith.json churn) as a WIP commit in MERC so the re-vendor sits on a clean, recoverable base. Then proceed with the re-vendor loop.
- BoardSmith suite must stay green (175 files / 2368 tests baseline) after any source fixes.

### Claude's Discretion
- Order of game migration (suggest simplest→complex: hex → checkers → go-fish → others → cribbage → MERC last).
- Whether demo-* apps count in the "8 games" (enumerate what's actually in ~/BoardSmithGames and cover everything with a suite; reference games are hex, go-fish, checkers, cribbage, polyhedral-potions + demo apps).
- Playwright smoke depth (load, take seat, one action round-trip, one failure toast).

</decisions>

<code_context>
## Existing Code Insights

### Environment facts
- `~/BoardSmithGames/*` — each game depends on BoardSmith via `"boardsmith": "file:../../BoardSmith"`, `node_modules/boardsmith` is a symlink to this repo (changes picked up live; game suites run against current source).
- `~/Dropbox/MERC/BoardSmith/MERC` — vendored copy; must be re-vendored to pick up changes (see its commit history for the pattern). Baseline: 738 tests.
- Memory: v4.3 Phase 121 / v4.4 Phase 129 are the precedent migrations (MERC re-vendor as integration test; real bugs surfaced and fixed at source).

### Known concrete migration items (seed list)
- 8× boardsmith.json: remove `playerCount` (+ any dead `$schema`) — `boardsmith validate` now rejects them.
- MERC: bare-number followUp args in rebel-economy.ts / rebel-equipment.ts (research noted its resolver helpers may already handle both shapes — verify, don't assume).
- Game test suites: TestGame.doAction call sites; session.runner usage in tests.
- Custom UIs: MeepleClient `.success` checks; `start()` void assumption; scalar fill on multiSelect.

### Integration Points
- BoardSmith source fixes discovered here feed back into phases' regression suites; keep 175/2368+ green.
- Phase 139 (docs) depends on this phase confirming the shipped surface.

</code_context>

<specifics>
## Specific Ideas

- v4.2 precedent: a migration exposed a real go-fish hidden-hand broadcast bug — treat surfaced failures as signal, not noise.
- Kill any dev server started for Playwright smokes; port 5173 must be free at phase end.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
