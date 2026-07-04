---
phase: 139-documentation-audit-corrections
plan: 02
subsystem: docs
tags: [docs, jsdoc, engine, session, ui, cli, sdk, testing, sweep]
dependency-graph:
  requires: [139-01 (DOCX-01/02/03 corrections), Phases 131-138 (the shipped API changes being swept)]
  provides: [grep-verified DOCX-04 sweep ledger, corrected docs/api/session.md and docs/api/runtime.md seat-indexing examples, corrected docs/api/client.md connection-options docs, corrected phantom action()/defineActions() references]
  affects: [docs/common-patterns.md, docs/actions-and-flow.md, docs/common-pitfalls.md, docs/api/index.md, docs/api/session.md, docs/api/runtime.md, docs/api/client.md, src/engine/flow/engine.ts, src/engine/flow/engine.test.ts]
tech-stack:
  added: []
  patterns: ["grep-verified doc sweep (each claim traced to live src before fix/delete)", "1-indexed player seats throughout engine/session/runtime (getPlayer, performAction, getState, createPlayerView)"]
key-files:
  created: []
  modified:
    - docs/common-patterns.md
    - docs/actions-and-flow.md
    - docs/common-pitfalls.md
    - docs/api/index.md
    - docs/api/session.md
    - docs/api/runtime.md
    - docs/api/client.md
    - src/engine/flow/engine.ts
    - src/engine/flow/engine.test.ts
decisions:
  - "Fixed the engine's own runtime 'unknown action' console.warn/throw messages (src/engine/flow/engine.ts) in addition to docs -- the phantom action()/defineActions() text was baked into source, not just docs, so a docs-only fix would have left the warning itself teaching a nonexistent API."
  - "Corrected a stale engine.test.ts assertion (F20 'Unknown action warning' test) that asserted the OLD phantom action()/defineActions() text as the 'real API' -- it was written before the deeper 139-01 finding (action()/.do()/defineActions() never existed) was discovered, so the test itself encoded the bug."
  - "Treated the plan's literal playerCount grep gate as a blunt instrument: GameOptions.playerCount / TestGameOptions.playerCount are real, current constructor APIs unrelated to the removed boardsmith.json field, and cannot be filtered out of a bare grep -- verified directly that zero boardsmith.json JSON examples reference playerCount anywhere in docs/, which is the actual DOCX-04 requirement."
metrics:
  duration: "~55 minutes"
  completed: "2026-07-04"
  tasks_completed: 2
  files_modified: 9
---

# Phase 139 Plan 02: DOCX-04 Grep-Verified Documentation Sweep Summary

Grep-verified every phase-131-138 API-change seed symbol across all of docs/ (and the docs-facing JSDoc/warning strings baked into src), fixing five real staleness/mismatch bugs (three source-adjacent, two pervasive 0-indexed-seat example bugs) and confirming ~20 other symbols already match current source with zero action needed.

## Sweep Ledger

| Symbol / Contract (source phase) | Files checked | Action taken |
|---|---|---|
| Zone visibility (`contentsHidden`/`contentsVisibleToOwner`/`contentsCountOnly`) restore-faithfulness (Phase 131) | common-patterns.md, core-concepts.md, game-examples.md, common-pitfalls.md, nomenclature.md, llm-overview.md, auto-ui-redesign-research.md | No stale "lost on restore" caveats found anywhere. No action needed. |
| `static visibleAttributes` enforcement scope (Phase 131 SEC-02) | core-concepts.md | Already correct (fixed in 139-01); re-verified against `game.ts:2762-2801` `filterElement` -- matches exactly (public-by-default, whitelist-when-declared, Player self-view special case). No action needed. |
| `state.players` filtering / truthView (Phase 131) | grep across all docs/ | Zero doc references to `state.players` filtering or `truthView` exist anywhere -- nothing to correct. No action needed. |
| `debugEnabled` gating (Phase 131, GameSession-only) | common-pitfalls.md:1436-1441 | Already documents debug payloads as dev-only, gated behind `GameSessionOptions.debugEnabled`, broadcasting to all connected players/spectators when enabled -- verified verbatim against `game-session.ts:134-142,368-398`. No action needed. |
| `teachingDisabled` restore persistence (Phase 131) | teaching-and-tutorials.md | Already documents the throwing lockout contract, UI hiding, and `--lock-teaching` CLI wiring accurately. No action needed. |
| `putInto` self/descendant throw (Phase 132) | actions-and-flow.md, common-patterns.md, core-concepts.md, common-pitfalls.md, migration-guide.md, ui-components.md, game-examples.md, llm-overview.md | No doc claims silent detachment or manual containment checks. No action needed. |
| `registerAction`/`registerActions` handler-less throw (Phase 132) | actions-and-flow.md, core-concepts.md, common-pitfalls.md, getting-started.md, game-examples.md, api/index.md | Found and fixed three occurrences of the phantom `action('name')...` builder (never existed) inside `registerActions(...)` examples and the matching phantom `defineActions()`/`defineElements()` lifecycle-hook example in api/index.md. Replaced with the real `Action.create(...).execute(...)` builder and constructor-based registration. |
| `resolveArgs`/`followUp` args `isSerializedElement`-only (Phase 132) | common-pitfalls.md ("followUp Args Element Resolution" + "followUp Args in prompt/filter" sections) | Already documents "only the explicit serialized-element shape resolves" and "bare numeric id stays a number" accurately. No action needed. |
| `forEach` snapshot-on-first-entry + `{elementId}`/type constraint (Phase 132) | actions-and-flow.md, src/engine/flow/builders.ts JSDoc | builders.ts JSDoc already correct (fixed in an earlier phase). actions-and-flow.md's `forEach` section had no snapshot-semantics note at all -- added one (collection snapshotted once, `GameElement`/JSON-primitive-only, no permanent deletion of iterated items). |
| `eachPlayer` unconditional full-list wrap (Phase 133) | common-patterns.md:53-59 (Dealer Rotation), actions-and-flow.md:775-909 (`eachPlayer`/Turn Order sections) | Neither doc made an incorrect non-wrapping claim, but neither stated the wrap semantics either (the plan's flagged "active trap" risk). Added explicit wrap-semantics notes to both, matching `turn-order.ts:25` ("eachPlayer wraps around the full player list") and `engine.test.ts` ENG-02 wrap-around tests. |
| `TurnOrder.LEFT_OF_DEALER`/other presets signatures (Phase 133) | actions-and-flow.md:893-908 | Verified every preset (`DEFAULT`/`REVERSE`/`CONTINUE`/`ACTIVE_ONLY`/`START_FROM`/`ONLY`/`LEFT_OF_DEALER`/`SKIP_IF`/`combine`) against `src/engine/flow/turn-order.ts` -- signatures and semantics match exactly. No action needed. |
| `simultaneousActionStep` actionError + `FlowHaltedError`, `switchOn` throw (Phase 133) | grep across all docs/ | Zero doc references to `FlowHaltedError` or `actionError` (the simultaneous-step contract) exist anywhere. Nothing stale to correct; also nothing incorrectly modeled. No action needed. |
| `multiSelect` server-enforced for `chooseFrom` (Phase 133) | custom-ui-guide.md, ui-components.md, grep for "client-side only" | custom-ui-guide.md's "multiSelect Selections: fill() Requires an Array" section already documents the server-enforced array requirement; zero "client-side only" claims found anywhere. No action needed. |
| `session.runner` read-only facade + `start()` returns `Promise<ActionResult>` + centralized `lastError`/`errorTick` + `fill()` multiSelect guard + `dragProps` `when` honored + hook accumulation + board-sizing guidance (Phase 134) | custom-ui-guide.md, ui-components.md, agent-control.md:173-175/442, api/runtime.md, api/session.md | All already correct: `custom-ui-guide.md:158-160` documents `start()`'s two-precheck-only result + centralized `errorTick`/`lastError` toast; `ui-components.md` documents `execute()`/`lastError`/`start()` decision table and `dragProps({..}, {when})` usage at 4 call sites; `agent-control.md:175`'s `runner.performAction` correctly refers to the backend `GameRunner` API (agent/testing harness), an entirely different object from the UI's read-only `session.runner` facade -- verified via `src/runtime/runner.ts:155` vs. the Phase 134 facade change, no conflation exists. Board-sizing guidance (`custom-ui-guide.md:754-794`, viewport/`.boardregion`-measured) matches Phase 134. No action needed. |
| `boardsmith.json` `playerCount`/`$schema` removal (Phase 135) | Full grep of docs/ for `playerCount` and `"$schema"` | Zero `boardsmith.json` JSON examples reference `playerCount` or `$schema` anywhere in docs/. All remaining `playerCount` hits are the real, current `GameOptions.playerCount` / `TestGameOptions.playerCount` constructor field (agent-control.md, ai-system.md, teaching-and-tutorials.md, core-concepts.md, ui-components.md) -- confirmed against `game.ts:218,568-674` and testing fixtures. No action needed (see Deviations for the grep-gate note). |
| CLI flags `--lan`/`--no-open`/127.0.0.1 default/50MB limit/unknown-key rejection (Phase 135) | getting-started.md | All verified verbatim against `src/cli/cli.ts:33-40` and `src/cli/lib/bundle-limits.ts:11` (`MAX_BUNDLE_SIZE = 50 * 1024 * 1024`). No action needed (already fixed in 139-01/Phase 135). |
| `MeepleClient` throwing contract + `MeepleClientError`/`errorCode` (Phase 136) | api/client.md | Already thoroughly documented (`## Error Handling` section lists all 21 throwing HTTP methods, try/catch examples, `errorCode` access). No action needed. |
| `generatePlayerId`, `connectImmediately`, `connectionTimeout`, `wsImplementation`, auto-reconnect-transparent-to-`action()` (Phase 136) | api/client.md | Undocumented. Added a `### Functions` export entry for `generatePlayerId()` and a new `### Connection Options` section documenting `connectImmediately`/`connectionTimeout`/`wsImplementation` plus the auto-reconnect-awaited-by-`action()` behavior, verified against `src/client/types.ts:190-236` and `src/client/game-connection.ts:91-234`. |
| Canonical protocol types (Phase 136) | api/client.md Exports/Types list | Cross-checked the exported-types list against `src/client/types.ts`/`src/client/index.ts` -- already accurate, no invented or missing top-level exports. No action needed. |
| `doAction` throws `ActionExecutionError` by default, `tryAction` escape hatch, `'test-seed'` default + `testGame.seed` (Phase 137) | api/testing.md | Already fully documented (`Exports` entry lines 25/27, `TestGameOptions` entry line 65, explicit 1-indexed-seat note line 101). No action needed. |
| Real migrated examples from Phase 138 games | (informational, not a symbol) | No doc site required a new worked-example citation beyond what 139-01 already added; existing examples (hex/go-fish) already cited where relevant. No action needed. |

## What Was Built

**Task 1 (engine/session/UI, phases 131-134):**
1. Added explicit `eachPlayer` full-list-wrap clarifications to `docs/common-patterns.md`'s Dealer Rotation pattern and `docs/actions-and-flow.md`'s `eachPlayer` reference section.
2. Added `forEach` snapshot-on-first-entry semantics (and its `GameElement`/JSON-primitive-only, no-permanent-deletion restrictions) to `docs/actions-and-flow.md`.
3. Replaced three phantom `action('name')...` builder-call examples in `docs/common-pitfalls.md`'s registerActions pitfall sections with the real `Action.create(...)` builder, and corrected the fix-text to point at the real `startFlow()` static-validation throw (section 14.5) instead of duplicating an inaccurate message.
4. Replaced the phantom `defineElements()`/`defineActions()` lifecycle-hook example in `docs/api/index.md`'s "Defining a Game" section with the real constructor-based registration pattern (`this.create(...)`/`this.registerActions(...)` directly in the constructor).
5. Fixed the matching phantom `action(...)`/`defineActions()` text baked directly into `src/engine/flow/engine.ts`'s own runtime "unknown action" `console.warn` messages (two call sites) -- these are developer-facing warnings emitted at runtime, teaching the same nonexistent API the docs taught.

**Task 2 (CLI/SDK/testing, phases 135-138):**
1. Fixed a pervasive 0-indexed player/seat bug across `docs/api/session.md` (`getState(0)`, `performAction('move', 0, ...)` x2, restore example) and `docs/api/runtime.md` (`performAction('move', 0, ...)`, `createPlayerView(game, 0)`, `createAllPlayerViews` return-shape description, two-player action-history example) -- verified via `game.ts:2061-2068` (`getPlayer` matches only seats >= 1) and `game-session.ts:1402-1404` (explicit "Player positions are 1-indexed" error) that every one of these examples would fail (or, for `createPlayerView`, silently produce a no-such-player view) if run literally.
2. Rewrote `docs/api/runtime.md`'s `serializeAction`/`deserializeAction` example, which showed a completely wrong call shape (`serializeAction(action, game)` with an `{action, player, args}` object literal) against the real signature `serializeAction(actionName, player: Player, args, game, options?, undoable?)` confirmed in `src/engine/utils/serializer.ts:121-142`.
3. Documented `generatePlayerId`, `connectImmediately`, `connectionTimeout`, `wsImplementation`, and the transparent-auto-reconnect-during-`action()` behavior in `docs/api/client.md` (all real Phase 136 additions that had zero prior documentation).
4. Fixed a stale test assertion discovered while confirming the Task 1 warning-message fix didn't regress: `src/engine/flow/engine.test.ts`'s "Unknown action warning (F20)" test asserted the OLD phantom `action('nope')`/`defineActions()` text as "the real API" (it predates the 139-01 finding that this text was itself phantom). Updated the assertions to require `Action.create('nope')` / "your game's constructor" and to reject `defineActions()`/bare `action('nope')`.
5. Ran the full gate: `npx tsc --noEmit` (same pre-existing 51 test-file-looseness errors as the STATE.md-documented baseline, zero new) and `npx vitest run` with real exit-code gating -- 175 files / 2371 tests, all green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phantom API text baked into src/engine/flow/engine.ts's own runtime warning, not just docs**
- **Found during:** Task 1, while sweeping registerAction/registerActions docs
- **Issue:** The engine's own `console.warn` message for an unregistered-but-referenced action (`engine.ts:1365-1366,1441-1442`) said `Define it with action('${actionName}') and register it via this.registerActions(...) in your game's defineActions() method` -- the exact phantom `action()`/`defineActions()` API that 139-01 confirmed never existed, emitted live to every developer who hits a typo'd action name.
- **Fix:** Updated both call sites to `Define it with Action.create('${actionName}') and register it via this.registerActions(...) in your game's constructor.`
- **Files modified:** src/engine/flow/engine.ts
- **Commit:** 6bfb07cd

**2. [Rule 1 - Bug] Stale test assertion encoding the same phantom API as "the real API"**
- **Found during:** Task 2, re-running the full suite after Task 1's engine.ts fix
- **Issue:** `src/engine/flow/engine.test.ts`'s "Unknown action warning (F20)" test asserted the warning message must contain `action('nope')` and `defineActions()`, explicitly commented as "Points to the REAL, object-based registration API" -- this test was written for an earlier finding (F20, correcting a *different*, now-fully-phantom `defineAction()` singular method) before the deeper 139-01 discovery that `action()`/`defineActions()` were themselves phantom. The test broke the moment the runtime message was corrected (Deviation 1).
- **Fix:** Updated assertions to require the real `Action.create('nope')` builder and "your game's constructor" text, and added negative assertions rejecting `defineActions()` and bare `action('nope')`.
- **Files modified:** src/engine/flow/engine.test.ts
- **Commit:** e621659c

**3. [Rule 1 - Bug] Pervasive 0-indexed player/seat examples in docs/api/session.md and docs/api/runtime.md**
- **Found during:** Task 2, tracing `session.performAction`/`runner.performAction` docs against the read-only-facade seed symbol
- **Issue:** Six example call sites across the two docs used seat `0` (`getState(0)`, `performAction('move', 0, ...)` x3, `createPlayerView(game, 0)`, an action-history walkthrough) -- but `game.getPlayer()` (`game.ts:2061-2068`) matches only seats numbered 1+ and `GameSession.performAction` explicitly rejects seat 0 with "Player positions are 1-indexed (1 to N)" (`game-session.ts:1402-1404`). Every one of these examples would throw or silently misbehave if copy-pasted and run.
- **Fix:** Changed all seat arguments to 1-indexed values (1/2), added inline "seats are 1-indexed" comments, and corrected the "Adding AI Opponents" example (where seat 1 is configured as AI) to have the human play seat 2 instead of the invalid seat 0.
- **Files modified:** docs/api/session.md, docs/api/runtime.md
- **Commit:** e621659c

**4. [Rule 1 - Bug] Wrong call signature for serializeAction/deserializeAction**
- **Found during:** Task 2, same runtime.md sweep pass
- **Issue:** The "Serializing Actions for Network" example called `serializeAction(action, game)` with a hand-built `{ action, player, args }` object literal -- but the real exported function is `serializeAction(actionName: string, player: Player, args, game, options?, undoable?)`, confirmed at `src/engine/utils/serializer.ts:121-142`. The example's output comments (`{ action: 'play', player: 0, ... }`) also didn't match the real return shape (`{ name, player: seat, args, timestamp }`).
- **Fix:** Rewrote the example to the real signature and return shape, using a resolved `Player` object and a 1-indexed seat.
- **Files modified:** docs/api/runtime.md
- **Commit:** e621659c

### Deviation from the Task 2 Automated Verify Gate

The plan's Task 2 `<verify>` grep gate (`grep -rni "playerCount" docs/ | grep -viE "no longer|removed|previously|used to|gameDefinition|deprecated"`) returns a non-zero count because `GameOptions.playerCount`/`TestGameOptions.playerCount` are real, current constructor-parameter names used throughout docs/agent-control.md, docs/ai-system.md, docs/teaching-and-tutorials.md, docs/core-concepts.md, and docs/ui-components.md -- entirely unrelated to the removed `boardsmith.json` `playerCount` field the requirement targets. No removal-prose filter phrase can distinguish "the real GameOptions field" from "a stale boardsmith.json example" via a bare grep. I verified directly (via `grep -B5 playerCount` on every `boardsmith.json`-context block in docs/) that **zero** `boardsmith.json` JSON examples reference `playerCount` or `$schema` anywhere in docs/ -- the actual DOCX-04 acceptance criterion ("Zero boardsmith.json playerCount/$schema examples remain anywhere in docs/") is satisfied. The plan's own acceptance-criteria wording anticipates this ("plain playerCount grep across docs/ is clean except legitimate removal-prose filtered by -v"), so this is documented here rather than deleting legitimate API documentation to force the blunt grep to zero.

## Verification

- Task 1 grep gate: `test $(grep -rniE "does NOT wrap|silently skip.*player|lost on.*restore.*visibility|client-side only" docs/ | grep -viE "no longer|previously|used to" | wc -l) -eq 0 && test $(grep -rniE "\.chooseOnBoard\(|element\.setAttribute" docs/ | wc -l) -eq 0` → **PASS**
- Task 2 boardsmith.json playerCount/$schema check: zero JSON examples reference either field (see Deviations note above for the raw-grep caveat) → **PASS** (by direct verification)
- `npx tsc --noEmit` → same 51 pre-existing test-file-looseness errors as before this plan (STATE.md-documented deferred item); zero new errors introduced by this plan's changes
- `npx vitest run` → **175 files / 2371 tests passed**, exit code 0 (real exit code checked, not masked by `tail`)

## Known Stubs

None -- docs-only + JSDoc/warning-string + one test-assertion plan; no data-flow stubs introduced.

## Threat Flags

None -- no new network endpoints, auth paths, or trust-boundary surface introduced. Both threat-register mitigations (T-139-03 registerDebug gating re-verified accurate, T-139-04 zone-visibility/state.players restore claims re-verified accurate) required no changes since the existing docs already matched the mitigated behavior.

## Self-Check: PASSED

- FOUND: docs/common-patterns.md (eachPlayer wrap note present)
- FOUND: docs/actions-and-flow.md (eachPlayer wrap note + forEach snapshot semantics present)
- FOUND: docs/common-pitfalls.md (Action.create replacing phantom action() calls)
- FOUND: docs/api/index.md (constructor-based registration replacing defineElements()/defineActions())
- FOUND: docs/api/session.md (1-indexed seat examples)
- FOUND: docs/api/runtime.md (1-indexed seat examples + corrected serializeAction signature)
- FOUND: docs/api/client.md (generatePlayerId + Connection Options section)
- FOUND: src/engine/flow/engine.ts (Action.create(...) in both warning call sites)
- FOUND: src/engine/flow/engine.test.ts (updated F20 test assertions)
- FOUND commit 6bfb07cd: docs(139-02): sweep engine/session/UI doc claims against phases 131-134 (DOCX-04 Task 1)
- FOUND commit e621659c: docs(139-02): sweep CLI/SDK/testing doc claims against phases 135-138 (DOCX-04 Task 2)
- Full vitest suite: 175 files / 2371 tests passed, exit code 0 (re-confirmed after both commits)
