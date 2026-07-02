# Phase 129: Migration (Games + MERC) - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Every example game and MERC build and test green against the full v4.4 API surface, with no lingering references to removed/changed APIs. Covers MIG-03 (all `~/BoardSmithGames/` games updated, suites green) and MIG-04 (MERC re-vendored + green).

Cross-repo: 8 game repos at `~/BoardSmithGames/` (checkers, cribbage, demo-action-panel, demo-animation, demo-complex-ui, go-fish, hex, polyhedral-potions — symlinked to this repo, live changes) + MERC at `~/Dropbox/MERC/BoardSmith/MERC` (vendored via `boardsmith pack` tarballs — see its `chore: re-vendor boardsmith` commit pattern, latest `3a81e81`). Minimal BoardSmith `src/` changes only to close gaps migration surfaces (fix in src/, never work around in games).

</domain>

<decisions>
## Implementation Decisions

### Migration scope
- Every game: fix any v4.4 breakage; suite green + tsc/build clean
- Meaningful (not blanket) adoption of the new utilities:
  - go-fish: DOM-leak test (`assertNoHiddenInfoLeak` rendering as the opponent seat) + visibility assertions (`assertHidden`/`isElementVisible`) — the hidden-info flagship
  - cribbage: visibility assertions on hands/crib
  - demo-animation: one animation-trace test (test mode + `getAnimationTrace()` assertion) — the animation showcase
  - Other games (hex, checkers, polyhedral-potions, demo-action-panel, demo-complex-ui): green + breakage-free only
- MERC: re-vendor (pack tarball + install, per its established commit pattern) + fix breakage + full suite green; no new test adoption

### Verification method
- Per-game: own test suite + tsc/build clean; NO browser passes (v4.4 changed no visual behavior)
- Scripted grep sweep across all repos for removed/changed API references: `headless-harness` import paths, no-arg `ElementCollection.shuffle()` calls, anything else the phases' BREAKING surface lists — zero hits required
- Any gap surfaced by migration gets fixed in BoardSmith `src/` (never worked around in a game), consistent with v4.3's MIG discipline

### Claude's Discretion
- Ordering of game migrations; exact new-test content; whether trivially-affected games need commits at all (no-change games just get verified)

</decisions>

<code_context>
## Existing Code Insights

### v4.4 changes that could affect games (the breakage surface)
- `ElementCollection.shuffle()` no longer defaults to Math.random (throws without an rng when detached) — audit found zero callers, verify per game
- `src/session/testing/headless-harness.ts` DELETED → `createHeadlessSession` now from `boardsmith/session`
- `playUntilComplete` now deterministic by default (game tests relying on random default may see fixed sequences — behavior change in tests, usually harmless)
- `anchorAttrs(ref)` gained optional `type` param (additive) + now dev-warns once-per-type on empty anchors (games with custom boards may start emitting warnings — that's the feature working; fix the board if it warns)
- Animation composables: fail-loud dev throws on missing anchors (games with broken anchors will now throw in dev — fix the game's anchors, that's the point)
- `onPersistenceError` 3-arg signature, `OpResult.warnings`/`errorCode` (additive)
- New exports: visibility/diff/dom-leak utilities (boardsmith/testing), animation test mode (boardsmith/ui + testing), `createDevHostClient` (boardsmith/client), `boardsmith simulate` CLI

### Repos
- Games symlink `node_modules/boardsmith` → this repo (live HMR; changes are already "installed")
- MERC vendors tarballs (`boardsmith pack` → .tgz → install); re-vendor commit pattern in its history (`3a81e81` is the v4.3 example)
- Reference games by complexity: hex (simplest), go-fish (cards/hidden info), checkers (grid), cribbage (complex multi-phase)

### Prior art
- v4.3 Phase 121 did exactly this kind of migration (games + MERC re-vendor); its SUMMARYs in milestones/v4.3-phases/ are the playbook

</code_context>

<specifics>
## Specifics

- go-fish already has `no-hidden-info-leak.test.ts` (broadcast-level) — the new DOM-leak test complements it at the render level; name/structure the new test alongside it
- The go-fish DOM-leak test is the milestone's flagship proof: an agent-built card game can now prove in CI that opponent cards don't leak into the DOM
- `boardsmith simulate` already smoke-tested against go-fish in Phase 125 — a quick re-run across a couple more games (hex, checkers) during migration is cheap validation of the CLI against varied game shapes

</specifics>

<deferred>
## Deferred Ideas

- Blanket adoption of every utility in every game — future organic growth
- MERC test adoption — canary role only

</deferred>

<amendment>
## Post-research amendments (2026-07-02)

- **devDependency approval:** go-fish gains `jsdom` + `@vue/test-utils` as devDependencies (required for the flagship DOM-leak test; dev-only; matches BoardSmith's own test stack; within the milestone's explicit game-adoption scope). Versions aligned with BoardSmith's package.json.
- **Real breakage found:** hex `HexBoard.vue` stones carry only `data-stone-id` (not a recognized FLIP anchor) — will trip the ANIM-03 dev throw; fix in the game (add `data-element-id`), it's the feature working as designed.
- **tsc debt:** 5/8 games have pre-existing `tsc --noEmit` failures (missing vite-env.d.ts, v3.x ChoiceBoardRefs.refs, missing @types/node, in-game type errors) — in scope per the locked "tsc/build clean" criterion; fix minimally.
</amendment>
