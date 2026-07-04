# Phase 138: Cross-Repo Migration - Research

**Researched:** 2026-07-03
**Domain:** Cross-repo API migration (BoardSmith library consumers: 8 example games + 1 vendored production game)
**Confidence:** HIGH (all findings are direct grep/test-run evidence against the live repos, not training-data guesses)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Migration Strategy**
- Verification depth: All 8 game suites green (GAMES-01 hard requirement) + Playwright browser smoke on a representative subset — hex (grid/drag — exercises UIX-04 drag gating live), go-fish (cards/hidden-info — exercises SEC-01 restore + toast), cribbage (complex multi-phase — exercises multiSelect + flow changes). Headless Playwright per the established fallback (never leave a dev server running).
- MERC process (GAMES-02): Re-vendor following MERC's commit-history re-vendor pattern -> run its suite (738-test baseline) -> any gap surfaced is fixed in BoardSmith `src/` with a red-first test -> re-vendor -> re-run. NEVER work around in MERC. Iterate until green.
- Migration inventory: Fresh grep sweep per breaking change across all 9 repos. The accumulated phase notes are the seed list, not the truth. (Full seed list of v4.5 breaking changes is reproduced in this research's Per-Repo Migration Tables, verified fresh against current source.)
- Scope discipline: Only migration + surfaced-bug fixes. No opportunistic refactors in game repos. Each game gets its own commit(s) in its own repo. BoardSmith fixes get their own commits in BoardSmith.

**Process**
- PROC-01-style verification doc NOT required for this phase (no audit findings — it's a migration phase), but a per-repo migration ledger (what changed, suite result) goes in the SUMMARYs.
- BoardSmith suite must stay green (175 files / 2368 tests baseline) after any source fixes.

### Claude's Discretion
- Order of game migration (suggest simplest->complex: hex -> checkers -> go-fish -> others -> cribbage -> MERC last). This research refines that order based on actual before-state findings — see "Recommended Migration Order" section below.
- Whether demo-* apps count in the "8 games" (enumerate what's actually in ~/BoardSmithGames and cover everything with a suite; reference games are hex, go-fish, checkers, cribbage, polyhedral-potions + demo apps). Confirmed: exactly 8 dirs in ~/BoardSmithGames (checkers, cribbage, demo-action-panel, demo-animation, demo-complex-ui, go-fish, hex, polyhedral-potions).
- Playwright smoke depth (load, take seat, one action round-trip, one failure toast).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope (per 138-CONTEXT.md).

### Specific Ideas Noted
- v4.2 precedent: a migration exposed a real go-fish hidden-hand broadcast bug — treat surfaced failures as signal, not noise.
- Kill any dev server started for Playwright smokes; port 5173 must be free at phase end.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GAMES-01 | All 8 example games in `~/BoardSmithGames/` comply with the changed API surface; every suite green | See "Before-State: Existing Suite Results" (identifies exactly which suites are red and why) and "Per-Repo Migration Tables" §1-2 (the only two categories with real fixes needed: boardsmith.json manifest, doAction() assertions). demo-action-panel has no test suite — flagged as an open item, not silently ignored. |
| GAMES-02 | MERC re-vendored onto the new version and green; gaps surfaced during migration fixed in BoardSmith `src/`, not worked around | See "MERC Re-Vendor Procedure" (reconstructed from git history) and "Runtime State Inventory" (pre-existing uncommitted MERC tree state that must be resolved first). ENG-05 bare-number followUp risk investigated and found already-tolerant at the code level (§5), pending live-suite confirmation post-re-vendor. |

</phase_requirements>

## Summary

A fresh grep sweep of all 10 breaking-change categories (from the 138-CONTEXT.md seed list) across all 9 repos (`~/BoardSmithGames/{checkers,cribbage,demo-action-panel,demo-animation,demo-complex-ui,go-fish,hex,polyhedral-potions}` + `~/Dropbox/MERC/BoardSmith/MERC`) found the migration surface is **much smaller than the seed list implied**. Of the 10 breaking-change categories, only **2 have real, confirmed hits**: (1) every boardsmith.json across all 9 repos carries the removed `playerCount` key and dead `$schema` URL, and (2) `TestGame.doAction()` call sites that capture and assert `.success` on the return value now break, because `doAction()` was changed (Phase 137/TST-01) to return `void` and throw on failure instead of returning `ActionResult`. This second issue is the sole cause of every actual test failure observed (checkers: 1, go-fish: 12). All other seed-list categories (session.runner in game tests, MeepleClient `.success` checks, `actionController.start()` treated as non-void, scalar `fill()` on multiSelect, `setBeforeAutoExecute` multiple-hook conflicts, `dragProps` `when` option, bare-number followUp args, `forEach<T>` type constraint, `switchOn` without default, `eachPlayer` with `startingPlayer`, handler-less `.build()`, `registerDebug`, `visibleAttributes`) returned **zero hits** in games/MERC, or (in MERC's bare-number-followUp case) returned hits whose call sites are already defensively dual-shape-tolerant — confirmed by reading the actual resolver code, not assumed.

A significant **out-of-band discovery**: MERC's working tree (`~/Dropbox/MERC/BoardSmith/MERC`) already has **uncommitted local changes** — `boardsmith.json` (reformatted + `gameId` regenerated), `package.json`/`package-lock.json` (vendored to an untracked `boardsmith-0.0.1-protocol.tgz` tarball, newer than the last committed re-vendor), and `AssignToSquadPanel.vue` (CSS custom-property renames from `--bs-*` to `--bsg-*`, matching the v4.0 Slate UI token system). This is pre-existing dirty state, not something this research session created. The planner must have Plan 01 address it (commit, stash, or reconcile) before starting the Phase 138 re-vendor, or the re-vendor will conflate unrelated changes with the v4.5 migration.

**Primary recommendation:** This phase is much lighter than the roadmap's seed list suggests. The core work is: (1) strip `playerCount`+`$schema` from 9 boardsmith.json files, (2) migrate ~9 `doAction()`-with-`.success`-assertion call sites (6 in go-fish/checkers, ~5-6 more likely in MERC — MERC's dictator-hire.test.ts uses the same pattern) to either drop the assertion (doAction throws on failure, so a subsequent line executing IS the success proof) or switch to `tryAction()` where the test intentionally checks failure, (3) reconcile MERC's pre-existing uncommitted tree state, (4) re-vendor MERC and iterate, (5) Playwright smoke on hex/go-fish/cribbage per CONTEXT.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| boardsmith.json schema compliance | CLI / Build | — | `boardsmith validate`/`build` read manifest at build time, not runtime |
| TestGame.doAction migration | Testing Utilities (engine-adjacent) | — | Pure test-file edits; no production code affected |
| MERC re-vendor | Package/Build | Engine (if gaps surfaced) | Vendored tarball swap is a build-time dependency change; gaps found during re-vendor get fixed in BoardSmith `src/`, not MERC |
| Custom-UI actionController usage | Browser / Client (Vue components) | — | `.execute()`, `.fill()`, `.start()` are UI-composable-level; already unaffected here since only `execute()` (unchanged) is used, not the changed `start()` return contract |
| MERC bare-number followUp args | API / Backend (game rules `execute()` callbacks) | — | Args cross a structured-clone boundary (postMessage) in MERC's iframe-embedded platform mode; resolver helpers already defensively handle both raw-number and resolved-object shapes |

## Standard Stack

No new packages are installed in this phase — it is a consumer-repo migration against the already-published local BoardSmith source (via `file:../../BoardSmith` symlink for games, and a locally-built tarball for MERC). **Package Legitimacy Audit is not applicable** — no external dependency changes.

**Tooling confirmed present in the environment:**
| Tool | Version | Purpose |
|------|---------|---------|
| Node | v22.21.1 | Runtime for all game repos [VERIFIED: `node --version`] |
| npm | 10.9.4 | Package manager [VERIFIED: `npm --version`] |
| Playwright | 1.57.0 | Browser smoke testing (already installed at BoardSmith root) [VERIFIED: `npx playwright --version`] |
| vitest | 2.1.9 (per-game devDependency) | Test runner for all 8 games + MERC [VERIFIED: test run output banners] |

**Critical gotcha:** every game's `package.json` defines `"test": "vitest"` with no `--run` flag — running `npm test` launches **watch mode**, which never exits and will hang any CI-style invocation. Always use `npx vitest run` (or `CI=true npm test`) for one-shot suite runs. This is worth calling out because the phase's own verification step ("run each suite AS-IS") will hang/timeout if invoked naively.

## Per-Repo Migration Tables

### 1. `playerCount` / dead `$schema` in boardsmith.json (CLIX-01, all 9 repos — confirmed)

| Repo | `$schema` (line) | `playerCount` (line) | Disposition |
|------|------------------|----------------------|-------------|
| checkers | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| cribbage | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| demo-action-panel | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| demo-animation | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| demo-complex-ui | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| go-fish | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| hex | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| polyhedral-potions | `boardsmith.json:2` | `boardsmith.json:6` | Remove both |
| MERC | `boardsmith.json:2` | `boardsmith.json:6` | Remove both (player count is defined by `gameDefinition` in `src/rules/`, per CLIX-01's single-source-of-truth fix) |

`boardsmith validate` in each repo will reject these once run against the new CLI (Phase 135). Verification: run `npx boardsmith validate` in each repo after edit — expect PASS.

### 2. `TestGame.doAction()` call sites (TST-01 — confirmed root cause of ALL observed test failures)

`doAction()` now returns `void` and throws `ActionExecutionError` on failure (was: returns `ActionResult`, callers asserted `.success`). Confirmed at `/Users/jtsmith/BoardSmith/src/testing/test-game.ts:363-398`.

| Repo | File:Line | Pattern | Classification | Fix |
|------|-----------|---------|-----------------|-----|
| checkers | `tests/tutorial-preset.test.ts:73-77` | `const result = testGame.doAction(...); expect(result.success).toBe(true)` | asserting `.success` | Delete the `expect(result.success)` line; `doAction()` already throws on failure, so reaching the next line IS the success proof |
| go-fish | `tests/game.test.ts:338,343` | same pattern | asserting `.success` | same fix |
| go-fish | `tests/game.test.ts:420` | `testGame.doAction(...)` (no result captured) | already-compliant call site | No change needed — already void-style |
| go-fish | `tests/complete-game.test.ts:174,179` | same pattern | asserting `.success` | same fix |
| go-fish | `tests/complete-game.test.ts:234,239` | same pattern | asserting `.success` | same fix |
| go-fish | `tests/no-hidden-info-leak.test.ts:37` + downstream `.success` read (line ~58 per stack trace) | same pattern | asserting `.success` | same fix |
| go-fish | `tests/no-hidden-info-dom-leak.test.ts:34,38` | `const result = ...; if (!result.success) break;` inside a `driveAFewTurns` helper used by 4 tests | setup-move-ignoring-result-as-loop-condition | Needs care: the loop control depends on failure signaling to stop iterating. Since `doAction` now throws instead of returning a falsy `.success`, this helper must switch to `tryAction()` (which still returns `ActionExecutionResult`) to preserve the "stop when no more legal moves" loop semantics — do NOT blindly switch to `doAction()` here, that would throw and abort the test instead of stopping the loop gracefully |
| MERC | `tests/dictator-hire.test.ts:27,39,53,97,127,131` | `result = testGame.doAction(...)` (6 call sites, some inside a loop at 127/131) | mixed: 27/39/53/97 look like single setup-moves capturing but not asserting `.success` downstream (need to verify no later `.success` read); 127/131 are inside a generic action-name loop | Re-verify at execution time whether any downstream code reads `result.success`; if the loop at 127/131 uses `.success` to decide whether to continue (like go-fish's dom-leak helper), it needs `tryAction()` too |

**No `session.runner`/`.performAction()` usage was found in any game's tests** — only in MERC's own MCTS/AI test harnesses (`mcts-clone.test.ts`, `ai-rebel-batching.test.ts`, `combat-barriers.test.ts`, `tests/helpers/auto-play.ts`), and in every one of those cases `runner` is a **raw `GameRunner` instance created directly via `new GameRunner(...)`** (confirmed at `tests/helpers/auto-play.ts:178`), never `session.runner`. SESS-01 only restricts the `session.runner` facade property access path — direct `GameRunner` construction in tests is unaffected and remains the correct low-level pattern for MCTS/AI test harnesses. **No migration needed for this category.**

### 3. `MeepleClient` `.success` checks in custom UIs (SDK-03 — no impact found)

Zero `MeepleClient` imports/usages found in any game or MERC `src/`. The only `.success` hits in `src/` are:
- `checkers/src/ui/components/CheckersBoard.vue:588` — reads `result.success` from `actionController.execute()`, which is **unchanged** by Phase 134 (only `start()`'s return contract changed per UIX-01; `execute()` already returns `Promise<ActionResult>` and always has). Confirmed against `useActionControllerTypes.ts:383` (`execute: (...) => Promise<ActionResult>`). **No migration needed.**
- MERC's `tactics-effects.ts`/`dictator-actions.ts` `.success` fields are internal game-rule result shapes returned from `execute()` callbacks (game logic, not client SDK). **Unrelated to SDK-03, no migration needed.**

### 4. `actionController.start()` / `fill()` / `setBeforeAutoExecute` / `dragProps` (UIX-01/02/04/05 — no impact found)

| Item | Finding |
|------|---------|
| `actionController.start(...)` callers | Found in cribbage, demo-animation, demo-complex-ui, polyhedral-potions, MERC (17 call sites across `SectorPanel.vue`, `DictatorPanel.vue`, `GameTable.vue`, `AssignToSquadPanel.vue`, `CoordinatedAttackPanel.vue`). **None** assign the return value to a variable or read `.success`/any property off it — all are fire-and-forget (`await`ed for sequencing only, or bare calls). UIX-01's contract change (start() now returns a bare `{success:true}` reflecting only sync pre-checks) is a no-op for every caller found. **No migration needed.** |
| `.fill()` scalar-on-multiSelect | multiSelect config found only in cribbage (`CribbageBoard.vue`, `actions.ts`) and MERC (`HiringPhase.vue`, `GameTable.vue`, `rebel-economy.ts`, `rebel-combat.ts`). cribbage's own test suite is 22/22 green already (no server-side rejection triggered), consistent with UIX-02 only tightening *validation*, not changing the call convention for legitimately-scalar single-item picks. Flagged for the planned Playwright smoke on cribbage (multiSelect exercise) rather than a code fix. |
| `setBeforeAutoExecute` | One registration per caller in cribbage, demo-animation, MERC — no game registers it twice, so UIX-05's "silently replacing a previous hook" scenario never triggers. **No migration needed.** |
| `dragProps(...)` with `when` option | Zero callers use the `when` option anywhere (only a doc comment in demo-animation mentions `dragProps` generically). **No migration needed.** |

### 5. MERC bare-number followUp args (ENG-05 — confirmed present, confirmed already-tolerant)

Both known exposure sites in `rebel-economy.ts` and `rebel-equipment.ts` pass bare numeric element IDs (`combatantId: unit.id`, `sectorId: sector.id`) through `followUp.args`, explicitly documented as required (structured-clone/postMessage cannot serialize live GameElement objects — see comment at `rebel-economy.ts:602-607`). Confirmed the reader side is **already dual-shape tolerant**:

```typescript
// Source: /Users/jtsmith/Dropbox/MERC/BoardSmith/MERC/src/rules/actions/rebel-economy.ts:487-509
function getUnit(ctx: { args?: Record<string, unknown> }): CombatantModel | undefined {
  const combatantArg = ctx.args?.combatantId;
  let id: number | undefined;
  if (typeof combatantArg === 'number') {
    id = combatantArg;
  } else if (combatantArg && typeof combatantArg === 'object' && 'id' in combatantArg) {
    id = (combatantArg as { id: number }).id;
  }
  ...
}
```

This pattern repeats for `getSector` (same file) and `getUnit` in `reEquipContinue` (`rebel-equipment.ts`). A third followUp site (`hagnessGiveEquipment`'s `equipmentId`) is read from a **settings cache** (`getHagnessCache`), not from `ctx.args` at all — the followUp arg is display-only there, so ENG-05's coercion change has zero effect on it (confirmed at `rebel-equipment.ts:1289`).

**Conclusion: ENG-05 requires NO code changes in MERC.** The resolver helpers were already written defensively (likely because MERC previously worked around a different bug — see the postMessage/DataCloneError comment — and that defensive coding happens to also cover the ENG-05 case). This should be independently re-confirmed by running MERC's full suite after re-vendor (Section 7) rather than trusted blind, since a live re-vendor run is the authoritative check.

### 6. `forEach<T>` type constraint / `switchOn` / `eachPlayer` startingPlayer / handler-less `.build()` (ENG-06/ENG-07/ENG-02/ENG-08 — zero impact)

- **Flow-engine `forEach<T>`** (exported from `/Users/jtsmith/BoardSmith/src/engine/flow/builders.ts:181`) is **not imported by any game or MERC**. All `forEach(` hits found (cribbage `actions.ts:48`, polyhedral-potions `elements.ts:239`, MERC `rebel-combat.ts:614`, `rebel-equipment.ts:2240`) are plain `Array.prototype.forEach` on in-memory arrays — unrelated API, unaffected.
- **`switchOn(`**: zero hits in any repo.
- **`eachPlayer({...startingPlayer...})`**: `eachPlayer(` is used in checkers, demo-complex-ui, go-fish, hex, polyhedral-potions, and MERC (2 sites) flow definitions, but **none pass a `startingPlayer` option** (confirmed via targeted grep against each `flow.ts`). ENG-02's wrap-around fix is a no-op for every game.
- **Handler-less `.build()`**: zero `.build()` call sites found in any game/MERC `src/` at all (games use the fluent `Action.create(...).execute(...)` chain directly, never a bare `.build()` without `.execute()`). ENG-08 requires no migration.

### 7. Player-child cross-seat reads / `registerDebug` / `visibleAttributes` (SEC-03/SEC-04/SEC-02 — zero impact)

- `registerDebug(` and `visibleAttributes` (the static class field): **zero hits** in any repo's `src/`.
- Custom `Player` subclasses (`extends Player`) exist in checkers, cribbage, demo-action-panel, go-fish, hex, polyhedral-potions, and MERC — but this is expected/normal (every game defines player-scoped state) and is not itself evidence of a cross-seat leak. No test in any of these suites currently fails on a visibility assertion (the only failures are the doAction `.success` issue). This category is **structurally hard to grep-prove safe** (a leak would show up as a rendered-DOM or broadcast-log assertion failure, which the existing `no-hidden-info-*` test suites in go-fish already probe and pass once the `.success` fix lands). Recommend the planned Playwright smoke (go-fish exercises SEC-01/visibility) as the empirical closer for this category rather than further static grep.

### 8. Client SDK loose types / `useGame({autoConnect})` (SDK-04/SDK-05 — zero impact)

Zero hits for `useGame(`, `autoConnect`, `WebSocketOutgoingMessage`, or `WebSocketMessage` in any game or MERC `src/`. None of the games/MERC construct their own `GameConnection`/client SDK usage directly — they all go through the shipped `GameShell`/`AutoUI` composables, which already absorbed the SDK-01..06 fixes at the library level in Phase 136. **No migration needed.**

### 9. Shuffle-dependent tests without explicit seeds (TST-02 — no failures observed)

`shuffle()` is called in production game setup code (cribbage `game.ts:271`, demo-animation `actions.ts:169`, demo-complex-ui `game.ts:66`, go-fish `game.ts:76`, MERC `setup.ts` x4 + `dictator-abilities.ts:157` + `game.ts` x2) — not directly in test files with hardcoded golden-value assertions. Since TestGame's default seed changed from `Date.now()` to the fixed literal `'test-seed'` (Phase 137), any test relying on shuffle output would either already be failing (it isn't — cribbage/demo-animation/demo-complex-ui/go-fish's non-`.success`-related tests are all green) or was never asserting on exact post-shuffle order (consistent with the CONTEXT's own assessment that these tests were "nondeterministic before so probably fine"). **No golden-value regressions found; no action needed**, but keep an eye on this during MERC's full-suite re-vendor run since MERC's larger test surface (many more shuffle call sites) hasn't been run yet in this research pass.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting "did this action fail" in a test after migrating off `.success` assertions | A custom try/catch wrapper per test | `tryAction()` (already exists, returns `ActionExecutionResult`) for tests that need the failure path; plain `doAction()` (no assertion) for tests that only care about success | `tryAction()` is the library's own documented escape hatch (`test-game.ts:332-338`) — reinventing it duplicates logic the library already ships |
| Re-vendoring MERC's tarball | Hand-writing a new packaging script | Whatever mechanism produced `boardsmith-0.0.1-20260702190858.tgz` (almost certainly `npm pack` run from `~/BoardSmith` root, output copied to `~/Dropbox/MERC/BoardSmith/MERC/vendor/`) — mirror the exact filename-timestamp pattern from `git log` | 60+ prior re-vendor commits establish a working, reviewed pattern; deviating risks silently vendoring the wrong build |

## Runtime State Inventory

> Included because this phase involves a vendored-dependency swap (MERC re-vendor) that is migration-adjacent.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None found — no databases/datastores in scope for this phase (games are stateless per-process test runs; MERC's runtime state is in-memory game state, not persisted externally) | None |
| Live service config | None — no external services (n8n, Datadog, etc.) referenced by any game or MERC | None |
| OS-registered state | None — no Task Scheduler/pm2/launchd/systemd registrations found in any repo | None |
| Secrets/env vars | None found | None |
| Build artifacts / installed packages | **MERC's `vendor/` directory contains 100+ historical `.tgz` tarballs** (one per re-vendor going back to Jan 2026), plus an **untracked** `boardsmith-0.0.1-protocol.tgz` newer than the last committed vendor pointer, and MERC's `package.json`/`package-lock.json`/`boardsmith.json` currently point at/reflect this untracked tarball rather than the git-committed state. This is **pre-existing uncommitted work**, not something to silently carry forward — the planner's first MERC task should explicitly decide (with the user, if ambiguous) whether to commit this prior WIP separately, discard it, or fold it into the Phase 138 re-vendor. Left unaddressed, `git status` in MERC will show unrelated diffs mixed into the v4.5 migration commit. | Human decision required before re-vendor (checkpoint recommended) |

**MERC uncommitted diff detail** (as of this research session, `git status --short` in `~/Dropbox/MERC/BoardSmith/MERC`):
```
 M boardsmith.json                              (gameId regenerated + JSON reformatted — likely output of a boardsmith CLI build/validate run)
 M package-lock.json
 M package.json                                  (vendor pointer: 20260702190858.tgz -> protocol.tgz, version 0.0.27 -> 0.0.29)
 M src/ui/components/AssignToSquadPanel.vue       (CSS custom props renamed --bs-* -> --bsg-*, matching the v4.0 Slate token system — looks like an incomplete/abandoned rename pass)
```

## Common Pitfalls

### Pitfall 1: `npm test` hangs forever (watch mode)
**What goes wrong:** Every game's `package.json` defines `"test": "vitest"` (no `--run`). Running `npm test` non-interactively hangs indefinitely waiting for file changes.
**Why it happens:** vitest defaults to watch mode when not in a detected CI environment and no `--run`/`run` subcommand is given.
**How to avoid:** Always invoke `npx vitest run` (or set `CI=true`) for one-shot suite execution — this was independently discovered and confirmed in this research session (`npm test` in `~/BoardSmithGames/polyhedral-potions` caused the very first batched invocation to exceed a 10-minute timeout).
**Warning signs:** Command doesn't return, terminal shows "Waiting for file changes..." / "press h to show help".

### Pitfall 2: zsh does not word-split unquoted shell variables
**What goes wrong:** A bash-style `for r in $REPOS` loop with `REPOS="a b c"` set as a plain string iterates ONCE with `r` bound to the entire string, when run under zsh (the project's configured shell) — silently producing a loop that "ran" but audited nothing.
**Why it happens:** zsh's default word-splitting behavior differs from bash/sh; unquoted variable expansion is not split on IFS by default.
**How to avoid:** Use bash arrays (`REPOS=(a b c)`, `for r in "${REPOS[@]}"`) or explicitly invoke `bash -c '...'` for any multi-repo sweep script, as done throughout this research.
**Warning signs:** A loop over N repos produces exactly 1 iteration's worth of output instead of N.

### Pitfall 3: `doAction()`'s new throw-based contract silently breaks loop-control helpers, not just assertions
**What goes wrong:** A test helper like go-fish's `driveAFewTurns` uses `const result = testGame.doAction(...); if (!result.success) break;` to gracefully stop a loop once no more legal moves exist. Migrating this call site to the new `doAction()` naively (deleting the `.success` check) causes the helper to **throw and abort the entire test** on the very failure condition it was designed to detect and handle gracefully.
**Why it happens:** `doAction()`'s throw-by-default design (TST-01) is correct for "this setup move should always succeed" call sites, but wrong for "keep going until this stops succeeding" call sites — these need `tryAction()` instead, which still returns the `ActionExecutionResult` for inspection.
**How to avoid:** Before mechanically replacing every `doAction()` call, classify each site: (a) "this should never fail" -> plain `doAction()`, no assertion; (b) "I need to detect failure to make a decision" (loop termination, branching) -> `tryAction()`.
**Warning signs:** A test that used to gracefully wind down now throws an uncaught `ActionExecutionError` mid-run.

### Pitfall 4: MERC's uncommitted tree state predates this phase
**What goes wrong:** Assuming MERC's working tree is clean (matching its last commit) before starting the re-vendor, then attributing pre-existing uncommitted diffs (CSS token rename, regenerated gameId, newer untracked tarball) to this phase's changes — or worse, silently committing them bundled with the v4.5 migration commit.
**Why it happens:** The re-vendor process (`git -C ~/Dropbox/MERC/... log`) only shows committed history; `git status`/`git diff` must be checked separately.
**How to avoid:** Run `git status --short` in MERC BEFORE any re-vendor action and present the findings to the user for a decision (this research already surfaced the exact diff — see Runtime State Inventory above).
**Warning signs:** `git diff --stat` after "just re-vendoring" shows unrelated files (UI components, unrelated CSS) changed.

## Code Examples

### MERC's dual-shape followUp-arg resolver (already ENG-05-safe)
```typescript
// Source: /Users/jtsmith/Dropbox/MERC/BoardSmith/MERC/src/rules/actions/rebel-economy.ts:487-509
function getUnit(ctx: { args?: Record<string, unknown> }): CombatantModel | undefined {
  const combatantArg = ctx.args?.combatantId;
  let id: number | undefined;
  if (typeof combatantArg === 'number') {
    id = combatantArg;
  } else if (combatantArg && typeof combatantArg === 'object' && 'id' in combatantArg) {
    id = (combatantArg as { id: number }).id;
  }
  if (id === undefined) return undefined;
  const element = game.getElementById(id);
  return isCombatantModel(element) ? element : undefined;
}
```

### Recommended migration for a "should always succeed" doAction assertion
```typescript
// Before (breaks — result is now undefined):
const result = testGame.doAction(1, 'move', { piece, destination });
expect(result.success).toBe(true);

// After — doAction() throws on failure, so reaching the next line proves success:
testGame.doAction(1, 'move', { piece, destination });
```

### Recommended migration for a loop-termination pattern (go-fish `driveAFewTurns`)
```typescript
// Before (breaks — result is now undefined, .success read throws TypeError):
const result = testGame.doAction(1, 'ask', { target, rank });
if (!result.success) break;

// After — use tryAction() to preserve inspectable ActionExecutionResult:
const result = testGame.tryAction(1, 'ask', { target, rank });
if (!result.success) break;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `TestGame.doAction()` returns `ActionResult`, tests assert `.success` | `doAction()` throws `ActionExecutionError` on failure, returns `void`; `tryAction()` is the non-throwing form | Phase 137 (2026-07-03) | Every game/MERC test asserting `.success` after `doAction()` must migrate |
| boardsmith.json carries both `playerCount` and `gameDefinition`'s player range | `gameDefinition` is sole source of truth; `playerCount` key rejected by `boardsmith validate` | Phase 135 | All 9 repos' manifests need editing |
| `TestGame` default seed = `Date.now()` | Fixed literal `'test-seed'` | Phase 137 | No observed regressions (games' shuffle-dependent tests already tolerant) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MERC's `dictator-hire.test.ts` call sites at lines 27/39/53/97 don't read `.success` downstream (only lines 127/131 in a loop context might) | Per-Repo Migration Tables §2 | If a downstream `.success` read exists that this grep-only pass missed, MERC's test suite will fail post-re-vendor at a site not flagged here — the planner's re-vendor iteration step (rerun suite, fix, repeat) will catch this empirically regardless |
| A2 | The untracked `boardsmith-0.0.1-protocol.tgz` in MERC's vendor/ was produced by `npm pack` from BoardSmith root, mirroring the pattern of all prior committed tarballs | Don't Hand-Roll | If MERC actually uses a different vendor script not found by this research's file search, the planner should grep MERC's `package.json` scripts / any CI config more thoroughly before assuming `npm pack` |
| A3 | MERC's CSS variable diff (`--bs-*` -> `--bsg-*` in AssignToSquadPanel.vue) is an abandoned/incomplete v4.0 token-rename pass rather than intentional in-progress v4.5 work | Runtime State Inventory | If this is actually intentional recent work by the user, discarding it would lose work — hence the recommendation for a human checkpoint rather than auto-resolving |

**If this table is empty:** N/A — see above, 3 assumptions logged, all resolved by "verify empirically during re-vendor iteration" or "checkpoint with user," not blocking research completion.

## Open Questions (RESOLVED)

> RESOLVED: Q1 (MERC 738 baseline) — established fresh as the first MERC step in 138-03 (baseline-then-iterate). Q2 (MERC dirty tree) — user decision 2026-07-03: WIP-commit as-is first (138-03 Task 1; see 138-CONTEXT.md).

1. **Does MERC's full test suite (738-test baseline) pass cleanly after `playerCount`/`.doAction()` fixes, or does it surface additional ENG-05/SEC-03/etc. issues not visible via static grep?**
   - What we know: Static analysis found zero additional breaking-change hits beyond the two confirmed categories.
   - What's unclear: MERC's suite was NOT run in this research pass (re-vendoring was explicitly out of scope for research — "do NOT re-vendor or modify anything — inventory only"). The 738-test baseline from CONTEXT.md is unverified against current BoardSmith HEAD.
   - Recommendation: The planner's first MERC task must run the existing (pre-re-vendor) MERC suite against its current committed vendor tarball as a true baseline, then re-vendor, then diff.

2. **How should the planner resolve MERC's pre-existing uncommitted tree state?**
   - What we know: 4 files modified, not committed, with contents suggesting a partially-done token rename and a newer local tarball build.
   - What's unclear: Whether this WIP should be committed separately (as a distinct commit before the v4.5 migration), discarded (`git checkout --`), or intentionally folded into this phase's re-vendor commit.
   - Recommendation: Insert a `checkpoint:human-verify` task at the start of the MERC plan asking the user how to handle this state, per the CLAUDE.md rule against destructive git operations without explicit instruction.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All game repos + MERC | Yes | v22.21.1 | — |
| npm | Package management, `npm pack` for re-vendor | Yes | 10.9.4 | — |
| vitest | Test runner (all 9 repos) | Yes | 2.1.9 | — |
| Playwright | Browser smoke (hex/go-fish/cribbage per CONTEXT) | Yes | 1.57.0 | — |
| `boardsmith dev` CLI | Manual/smoke verification, `boardsmith validate` | Yes (via `npx` in each game repo, symlinked to local BoardSmith source) | matches local BoardSmith `src/cli` | — |

**Missing dependencies with no fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.9 (per-repo devDependency, identical across all 9 repos) |
| Config file | none explicit found per-game (vitest defaults + `vite.config.ts` in each repo) |
| Quick run command | `npx vitest run <specific-test-file>` |
| Full suite command | `npx vitest run` (NOT `npm test` — see Pitfall 1) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GAMES-01 | All 8 games' existing suites pass after manifest + doAction fixes | unit/integration (existing suites) | `cd <game> && npx vitest run` | Yes (all 8 games already have suites, per Before-State table below) |
| GAMES-01 | Playwright smoke: hex drag gating, go-fish restore+toast, cribbage multiSelect+flow | e2e (new, per CONTEXT decision) | Headless Playwright script (to be written in Wave 0) | No — needs authoring |
| GAMES-02 | MERC full 738-test baseline green after re-vendor | integration | `cd ~/Dropbox/MERC/BoardSmith/MERC && npx vitest run` | Yes (existing suite) |

### Sampling Rate
- **Per task commit:** `npx vitest run` in the repo being migrated
- **Per wave merge:** full suite across all touched repos + `npx boardsmith validate` in each
- **Phase gate:** all 8 games green + MERC green + Playwright smoke passed + BoardSmith's own 175-file/2368+-test suite still green (no regressions from any surfaced-bug fix)

### Wave 0 Gaps
- [ ] Playwright smoke script (hex/go-fish/cribbage) — does not exist yet, needs authoring per CONTEXT's locked decision
- [ ] MERC pre-re-vendor baseline run (confirm 738-test number against current committed vendor tarball before touching anything)

## Before-State: Existing Suite Results (AS-IS, before any migration)

Run via `npx vitest run` in each repo (NOT `npm test` — see Pitfall 1). This is the "red list" the migration must turn green.

| Repo | Test Files | Tests | Result | Failure Cause |
|------|-----------|-------|--------|----------------|
| checkers | 4 (1 failed) | 38 (1 failed, 37 passed) | RED | `tutorial-preset.test.ts:77` — `doAction().success` assertion |
| cribbage | 2 | 22 | GREEN | — |
| demo-action-panel | 0 (no test script/files) | — | N/A | No test suite exists in this repo at all — confirmed via `find -iname "*test*"` returning nothing and `package.json` having no `test` script. This repo cannot fail or pass; GAMES-01's "every suite green" is vacuously true for it unless the planner decides a suite should be authored (out of scope per CONTEXT — no opportunistic work) |
| demo-animation | 2 | 9 | GREEN | — (benign Vue `inject()`/`onUnmounted` warnings in output, pre-existing, unrelated to v4.5) |
| demo-complex-ui | 1 | 4 | GREEN | — |
| go-fish | 11 (4 failed) | 84 (12 failed, 72 passed) | RED | All 12 failures are `doAction().success`/loop-control reads — see Migration Table §2 |
| hex | 1 | 19 | GREEN | — |
| polyhedral-potions | 2 | 24 | GREEN | — (benign `[BoardSmith] Action 'useRefresh' is registered but referenced by no actionStep()` warning, pre-existing, unrelated to v4.5) |
| MERC | not run in this research pass (re-vendor is out of scope for research; see Open Question 1) | — | UNKNOWN (baseline claimed 738 in CONTEXT.md, unverified this session) | N/A |

## MERC Re-Vendor Procedure (from git history — inventory only, not executed)

1. **Confirm/resolve MERC's pre-existing uncommitted state first** (see Runtime State Inventory) — checkpoint with user.
2. In `~/BoardSmith`, produce a fresh tarball via `npm pack` (the exact command isn't captured in MERC's history, but the naming convention `boardsmith-0.0.1-<YYYYMMDDHHMMSS>.tgz` in `vendor/` matches npm's default output pattern for a package named `boardsmith` version `0.0.1`).
3. Copy the resulting `.tgz` into `~/Dropbox/MERC/BoardSmith/MERC/vendor/`.
4. Edit MERC's `package.json` — update BOTH the `dependencies.boardsmith` path AND the `overrides.boardsmith` path to the new tarball filename (both fields updated together in every historical commit, e.g. `87cee4a`).
5. Run `npm install` in MERC to regenerate `package-lock.json` (confirmed as part of every re-vendor diff, e.g. `87cee4a`'s `package-lock.json` change).
6. Run `npx vitest run` — this is MERC's true baseline-after-re-vendor.
7. For any failure: fix in BoardSmith `src/` with a red-first regression test (per GAMES-02's locked decision — NEVER work around in MERC), re-vendor (repeat steps 2-6), re-run.
8. Iterate until green. Commit MERC's `package.json`/`package-lock.json`/`vendor/*.tgz` change with a message following the established pattern: `chore: re-vendor boardsmith (v4.5 pit-of-success hardening: SEC/ENG/RST/SESS/UIX/CLIX/SDK/TST + GAMES)`.

**Historical precedent commits examined:** `87cee4a` (v4.4), `3a81e81` (v4.3), `80d83df` (v3.1) — all follow the identical two-file-diff pattern (package.json + package-lock.json only; vendor/*.tgz is git-ignored or added separately — verify `.gitignore` before assuming the tarball itself isn't tracked).

## Recommended Migration Order

Per CONTEXT's discretion note (simplest -> complex), refined by actual findings:

1. **hex** — GREEN already, zero migration needed beyond boardsmith.json manifest edit. Fastest confidence-builder.
2. **demo-animation, demo-complex-ui, polyhedral-potions, cribbage** — GREEN already, same manifest-only edit. Batch these together (no code changes, low risk).
3. **demo-action-panel** — manifest-only edit; no test suite to verify against (flag this gap to the user, do not author new tests per "no opportunistic work" scope discipline).
4. **checkers** — manifest edit + 1 `doAction()` assertion fix (`tutorial-preset.test.ts:77`).
5. **go-fish** — manifest edit + 12 `doAction()`/loop-control fixes across 4 files (most complex game-repo fix; also the Playwright smoke target for SEC-01/restore+toast).
6. **Playwright smoke: hex, go-fish, cribbage** — after their respective suites are green.
7. **MERC last** — resolve pre-existing uncommitted state (checkpoint), establish true baseline, re-vendor, iterate on any surfaced BoardSmith `src/` gaps, re-run to green.

## Sources

### Primary (HIGH confidence — direct tool verification in this session)
- `/Users/jtsmith/BoardSmith/src/testing/test-game.ts:330-398` — `doAction()`/`tryAction()` current implementation, read directly
- `npx vitest run` output for all 8 games — direct execution, this session
- `git log --oneline -20` + `git status --short` + `git diff` in `~/Dropbox/MERC/BoardSmith/MERC` — direct execution, this session
- `grep -rn` sweeps across all 9 repos for all 10 CONTEXT-seeded breaking-change categories — direct execution, this session
- `/Users/jtsmith/Dropbox/MERC/BoardSmith/MERC/src/rules/actions/rebel-economy.ts` and `rebel-equipment.ts` — read directly to verify dual-shape tolerance

### Secondary (MEDIUM confidence)
- `.planning/phases/138-cross-repo-migration/138-CONTEXT.md` seed list — treated as hypothesis to verify, not fact (per this agent's philosophy); confirmed mostly non-applicable via direct grep

### Tertiary (LOW confidence)
- Assumption that `npm pack` (not a custom script) produces MERC's vendor tarballs — no vendor script found in either repo; inferred from filename pattern only (see Assumptions Log A2)

## Metadata

**Confidence breakdown:**
- Standard stack (test tooling): HIGH — directly executed and version-confirmed
- Migration inventory (playerCount/doAction): HIGH — direct grep + test-run evidence
- Migration inventory (all other 8 seed categories): HIGH — direct grep found zero hits, verified reader-side code where hits existed
- MERC re-vendor procedure: MEDIUM — reconstructed from git history, not executed (explicitly out of scope for research)
- Architecture/pitfalls: HIGH — discovered empirically during this research session (zsh word-splitting, vitest watch-mode default)

**Research date:** 2026-07-03
**Valid until:** Should be re-verified if any further v4.5 phase (131-137) lands additional commits after this research date — check `git log` in BoardSmith for commits after this session before planning executes.
