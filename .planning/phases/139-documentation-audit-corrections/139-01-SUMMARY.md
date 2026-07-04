---
phase: 139-documentation-audit-corrections
plan: 01
subsystem: docs
tags: [docs, jsdoc, cli, action-builder, serialization]
dependency-graph:
  requires: [Phase 131 SEC-02 (visibleAttributes enforcement), Phase 135 CLIX (CLI flag corrections)]
  provides: [corrected core-concepts.md, corrected registerActions JSDoc, corrected getting-started.md]
  affects: [docs/core-concepts.md, docs/getting-started.md, src/engine/element/game.ts, src/engine/player/player.ts]
tech-stack:
  added: []
  patterns: ["state-authoritative snapshot restore (no command replay)", "Action.create(...).chooseElement/.chooseFrom/.execute builder"]
key-files:
  created: []
  modified:
    - docs/core-concepts.md
    - docs/getting-started.md
    - src/engine/element/game.ts
    - src/engine/player/player.ts
decisions:
  - "visibleAttributes is documented as a REAL, working whitelist (not a dead field) -- re-verification found Phase 131's SEC-02 fix (game.ts:2762-2801, filterElement) shipped an actual enforcement path since the original audit finding was written. Docs now teach the real current behavior instead of declaring it dead."
  - "Fixed every phantom action()/.do()/.chooseOnBoard() JSDoc occurrence in game.ts and player.ts, not just the plan's four named line numbers -- grep found 8 additional undocumented occurrences (setCurrentPlayer, nextPlayer, previousPlayer, others, playerChoices x3, message) plus phantom lifecycle hooks defineActions()/defineFlow() and a phantom deck.dealTo() method, none of which exist in the real API."
metrics:
  duration: "~4 minutes (21:35:53 - 21:39:48 UTC-5)"
  completed: "2026-07-03"
  tasks_completed: 3
  files_modified: 4
---

# Phase 139 Plan 01: Documentation Audit Corrections Summary

Corrected the three named docs-teaching-nonexistent-API findings (F11/DOCX-01, F14/DOCX-02, F20/DOCX-03) after independently re-verifying each claim against live source, and closed several undocumented same-class phantom-API occurrences discovered during the rewrite.

## Re-verification Traces (per finding, before rewrite)

### F11 / DOCX-01 — core-concepts.md event-sourcing model

| Claim | Traced against | Result |
|---|---|---|
| `putInto`/`shuffle` mutate directly, record nothing | `piece.ts:73-75` (`putInto` → `moveToInternal`, direct tree splice) and `space.ts` shuffle (direct mutation) | CONFIRMED |
| `commandHistory` populated ONLY via `game.execute()`, never called by game code | `game.ts:842-852` (`execute()` pushes to `commandHistory`); confirmed no game-rule call sites reach it, only the internal `ANIMATE` path (`game.ts:2618` `this.execute({ type: 'ANIMATE', ... })`) | CONFIRMED |
| `element.setAttribute()` does not exist | grep across `src/engine/element/*.ts` — no such method | CONFIRMED |
| `fromSnapshot` is state-authoritative, no replay | `runner.ts:513-534` docstring explicitly states "fully STATE-AUTHORITATIVE, NO replay" | CONFIRMED |
| `static visibleAttributes` is a dead field, read nowhere | grep found it IS read, at `game.ts:2762-2801` inside `filterElement` (Phase 131 SEC-02/F2 enforcement) | **STALE — audit premise no longer true.** This finding predates Phase 131's fix. Corrected the plan's instruction: docs now teach visibleAttributes as a real, working attribute-redaction whitelist, not a no-op. |
| boardsmith.json "single source of truth" claim (line 355) | Scoped only to game options/player options/color palettes, not player count | Claim is accurate as written — no fix needed (Phase 135 CLIX-01 made gameDefinition the source of truth for player COUNT specifically, which this line doesn't claim) |

### F14 / DOCX-02 — registerActions phantom API

| Claim | Traced against | Result |
|---|---|---|
| `action()`/`.do()`/`.chooseOnBoard()` not exported | `src/engine/action/index.ts` exports only `Action` (the builder class) and `ActionExecutor` | CONFIRMED |
| `Action.create(...).chooseElement(...)/.chooseFrom(...)/.execute(...)` is the real builder | `src/engine/action/action-builder.ts` — confirmed method signatures | CONFIRMED |
| Phantom API confined to game.ts:390,424-428,915-954,1644 and player.ts:176,304 | Full-file grep found 8 ADDITIONAL undocumented occurrences in game.ts: `setCurrentPlayer` (2126), `nextPlayer` (2163), `previousPlayer` (2204), `others` (2314), `playerChoices` (2347, 2361, 2370), `message` (2548) — plus phantom lifecycle hooks `defineActions()`/`defineFlow()` (Game class methods, do not exist) and a phantom `deck.dealTo()` method (no such method on Space/Deck) | **Broader than plan scope — all fixed** (see Deviations) |

### F20 / DOCX-03 — getting-started.md residual CLI drift

| Item | Already fixed by Phase 135? | Current state |
|---|---|---|
| `playerCount` in boardsmith.json example | Yes | Confirmed absent |
| `$schema` in boardsmith.json example | Yes | Confirmed absent |
| `--host` default / `--lan` shorthand | Yes | Confirmed accurate (127.0.0.1 default, `--lan` = `--host 0.0.0.0`) |
| `--worker-port` | N/A | Not present in doc or cli.ts |
| Nonexistent init templates | N/A | `init <name>` has no `-t/--template` flag in `cli.ts` at all; doc never claimed one — no fix needed |
| `--no-open` | **Not yet documented** | Added — confirmed real flag at `cli.ts:40` |

## What Was Built

1. **`docs/core-concepts.md`**: Removed the "Commands (Low-Level)" table (MoveCommand/ShuffleCommand/SetAttributeCommand/CreateElementCommand/SetVisibilityCommand) and all `setAttribute()` references. Replaced "Actions vs Commands" section with "Actions and State Mutation", documenting direct element-tree mutation and the real state-authoritative snapshot-restore model (citing `runner.fromSnapshot`). Corrected the Attribute Visibility section and the Player Views claim to describe `visibleAttributes` as a real, working whitelist (Phase 131 SEC-02), not a dead field — since re-verification found it now IS enforced in `filterElement`.

2. **`src/engine/element/game.ts`** and **`src/engine/player/player.ts`**: Replaced every phantom `action('name').do(...)`/`.chooseOnBoard(...)` JSDoc example with the real `Action.create(...).chooseElement/.chooseFrom/.execute` builder. Fixed the runtime error message at game.ts:1644 (unregistered-action error) to reference `Action.create` instead of the nonexistent `action()`. Replaced phantom lifecycle hooks (`defineActions()`, `defineFlow()` as Game class methods — neither exists; the class is configured entirely from the constructor) and a phantom `deck.dealTo()` method with the real constructor-based registration pattern and direct `putInto()` dealing loop.

3. **`docs/getting-started.md`**: Added missing `--no-open` flag documentation. Updated the Next Steps cross-reference to drop the retired "commands" terminology, matching the core-concepts.md rewrite.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] visibleAttributes teaching corrected in the opposite direction from the plan's instruction**
- **Found during:** Task 1 re-verification
- **Issue:** The plan instructed documenting `visibleAttributes` as a "dead no-op field... read nowhere in src." Re-verification (grep) found it IS read, at `game.ts:2762-2801`, as part of Phase 131's SEC-02/F2 fix (shipped after the original Audit #3 finding was written, per STATE.md decision log: "[Phase 131-04]: visibleAttributes filtering lives inside filterElement's existing fallthrough").
- **Fix:** Documented `visibleAttributes` as a real, working attribute-redaction whitelist rather than a dead field, matching current shipped behavior.
- **Files modified:** docs/core-concepts.md
- **Commit:** 332ba04c

**2. [Rule 1 - Bug] Additional phantom-API JSDoc occurrences beyond the plan's named line numbers**
- **Found during:** Task 2
- **Issue:** grep across the full game.ts file (not just the plan's listed 390/424-428/915-954/1644) found 8 more `action('name').do(...)` examples and two phantom lifecycle-hook mentions (`defineActions()`, `defineFlow()` as Game methods) plus a phantom `deck.dealTo()` method — all teaching a nonexistent API in the same file the plan targets.
- **Fix:** Corrected all occurrences to the real `Action.create(...).chooseElement/.chooseFrom/.execute` builder and the real constructor-based registration pattern.
- **Files modified:** src/engine/element/game.ts
- **Commit:** 489263f6

**3. [Rule 2 - Missing functionality] Cross-doc terminology consistency**
- **Found during:** Post-task-3 sweep
- **Issue:** getting-started.md's Next Steps section still pointed readers to core-concepts.md with the retired phrase "elements, actions, and commands."
- **Fix:** Updated to "elements, actions, and state mutation."
- **Files modified:** docs/getting-started.md
- **Commit:** 3249bfad

## Verification

- `! grep -q setAttribute docs/core-concepts.md && ! grep -qiE "MoveCommand|ShuffleCommand|event.sourc|reversing commands" docs/core-concepts.md && grep -qi state-authoritative docs/core-concepts.md` → PASS
- `! grep -qE "\.chooseOnBoard\(|action\('[a-zA-Z]+'\)\.do\(" src/engine/element/game.ts src/engine/player/player.ts && npx tsc --noEmit` → PASS (zero new tsc errors in touched files; pre-existing repo-wide test-file tsc looseness, documented in STATE.md, is unaffected and unrelated to this plan's files)
- `! grep -q playerCount docs/getting-started.md && ! grep -q '"$schema"' docs/getting-started.md && grep -q -- --no-open docs/getting-started.md` → PASS

## Known Stubs

None — docs-only plan, no data-flow stubs introduced.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surface introduced. Both threat-register mitigations (T-139-01 visibleAttributes teaching, T-139-02 registerActions error message) were applied as planned.

## Self-Check: PASSED

- FOUND: docs/core-concepts.md (setAttribute/MoveCommand/ShuffleCommand absent, state-authoritative present)
- FOUND: docs/getting-started.md (--no-open present, playerCount/$schema absent)
- FOUND: src/engine/element/game.ts (zero chooseOnBoard/action().do() occurrences)
- FOUND: src/engine/player/player.ts (zero chooseOnBoard/action().do() occurrences)
- FOUND commit 332ba04c: docs(139-01): rewrite core-concepts.md to real state-authoritative model
- FOUND commit 489263f6: docs(139-01): correct registerActions JSDoc + runtime error to real Action.create API
- FOUND commit 4778a828: docs(139-01): document --no-open dev flag (DOCX-03 residual)
- FOUND commit 3249bfad: docs(139-01): update Next Steps terminology to match core-concepts.md rewrite
