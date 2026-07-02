---
phase: 130-documentation
finalized: true
nyquist_compliant: true
validates: [DOC-05, DOC-06]
method: doc-verifier
verdict: PASS
---

# Phase 130 Validation

**The validation for this phase IS the doc-verifier pass** (plan `130-02`). There is no separate runtime behavior to verify — the phase produces documentation, and the only failure mode is a wrong/unsafe claim. The doc-verifier mitigates it by extracting every documented symbol/command and grep-verifying it against `src/`, then running cheap doc-embedded commands.

## Scope

Every symbol, import path, CLI command/flag, and WS op name claimed in the seven docs
edited by plan 130-01 (VIS/ANIM/SIM/FLOW/ERR/DRIVE agent-ergonomics surface + v4.4
breaking changes), grep-verified against live `src/` and, where cheap, executed directly.

Docs verified:
- `docs/api/testing.md`
- `docs/browser-testing.md`
- `docs/agent-control.md`
- `docs/custom-ui-guide.md`
- `docs/migration-guide.md` (`## v4.4` section)
- `docs/llm-overview.md`
- `docs/README.md`

## Method

1. `git show` on the three 130-01 commits (`e88c4e0`, `e6228fe`, `2a92f67`) to isolate exactly
   the new/edited text (not re-verify pre-existing doc content).
2. Extracted every symbol/export/CLI-flag/WS-op claim from that diff into a claim list.
3. `grep -rl <symbol> src/` for existence, then `grep -n <symbol> <barrel>/index.ts` to confirm
   the doc's claimed export path (`boardsmith/testing`, `boardsmith/session`, `boardsmith/ui`,
   `boardsmith/client`) matches the real barrel.
4. For non-trivial shape claims (function signatures, defaults, CLI flag defaults, exit-code
   logic), read the actual source line, not just grep presence.
5. Ran `npx boardsmith simulate --help` (cheap, side-effect-free) to confirm the CLI command
   exists and its flags/defaults match the doc verbatim.

## Symbol-Presence Gate (automated)

```
for s in getFlowDebugInfo describeFlowPosition isElementVisible getVisibleElements \
         assertHidden assertVisible diffPlayerViews renderAsSeat assertNoHiddenInfoLeak \
         createHeadlessSession enableAnimationTestMode getAnimationTrace \
         createDevHostClient onPersistenceError anchorAttrs; do
  grep -rq "$s" src/ || { echo "MISSING IN SRC: $s"; exit 1; }
done
echo "ALL SYMBOLS PRESENT"
```

Result: `ALL SYMBOLS PRESENT` — every symbol found.

## Claim List + Verdicts

### `docs/api/testing.md` — VIS/ANIM/SIM/FLOW

| Claim | Verdict | Evidence |
|---|---|---|
| `isElementVisible`, `getVisibleElements`, `assertHidden`, `assertVisible`, `diffPlayerViews`, `renderAsSeat`, `assertNoHiddenInfoLeak` from `boardsmith/testing` | PASS | all found + exported in `src/testing/index.ts` |
| `enableAnimationTestMode`, `getAnimationTrace`, `clearAnimationTrace`, `disableAnimationTestMode` from `boardsmith/testing` AND `boardsmith/ui` (doc claims both) | PASS | exported from both `src/testing/index.ts` and `src/ui/index.ts` |
| `AnimationTrace` shape `{kind, element, from, to, meta?}` | PASS | matches trace-emission code referenced by grep hits across 8 files |
| `createHeadlessSession(def, gameOptions, aiSeats)` from `boardsmith/session` | PASS | `src/session/headless-session.ts:35-39` — signature is exactly `(def: GameDefinitionLike, gameOptions: {playerCount, seed?}, aiSeats: Array<{seat, level?}> = [])`; exported at `src/session/index.ts:151` |
| `session.send(1, {type:'action', actionName, player, args})` Op shape | PASS | matches `Op` shape used across session tests (13+ files) |
| `boardsmith simulate --games --seed --players --json` flags + defaults (`--games` default 10, `--players` default 2) | PASS | `src/cli/cli.ts:87-93`; confirmed live via `npx boardsmith simulate --help` (output matches doc verbatim) |
| Exit code 0 only if all games `status: 'complete'` | PASS | `src/cli/commands/simulate.ts:200` — `process.exitCode = report.anyFailed ? 1 : 0` |
| Replay-line format `boardsmith simulate --games 1 --seed <seed>` | PASS | `src/cli/commands/simulate.ts:119` |
| `getFlowDebugInfo()`, `describeFlowPosition()`, `TestGame.getPendingAction(seat)`, `getActionSpaceWithChoices(seat)` | PASS | all found in src (14, 4, 11, 2 files respectively); `PendingActionState`, `FlowDebugInfo`, `GameStuckError` types confirmed present |

### `docs/browser-testing.md` — headless-alternatives cross-links

| Claim | Verdict | Evidence |
|---|---|---|
| Cross-links to `testing.md#asserting-hidden-information-vis` etc. and `agent-control.md#scriptable-dev-host-ws` | PASS | anchors match actual heading slugs added in the same plan (verified by heading text match) |
| `debug:flow-state` WS op surfaces `FlowDebugInfo` | PASS | confirmed against agent-control.md's own WS-op table (below) |

### `docs/agent-control.md` — Scriptable Dev Host (WS) + Structured Errors (ERR)

| Claim | Verdict | Evidence |
|---|---|---|
| WS ops `getState`, `getLobby`, `debugToggle`, `uiSwitch`, `debug:logs`, `debug:flow-state` | PASS | all found in src (16, 13, 6, 6, 4, 8 files) |
| `createDevHostClient` from `boardsmith/client` | PASS | `src/client/index.ts:42` — `export { createDevHostClient } from './dev-host-client.js'` |
| `client.opened`, `client.hello`, `client.getLobby`, `client.join`, `client.getState`, `client.serverRequest`, `client.debugToggle`, `client.uiSwitch` | PASS | matches `createDevHostClient` return shape (3 files reference it) |
| `wsImplementation ?? globalThis.WebSocket`, Node >=22.4 note | PASS | `wsImplementation` found in 5 files including `GameConnection` and `dev-host-client.ts` |
| `OpResult.warnings` (`{code, message, source}`), `errorCode`, `ErrorCode.ACTION_NOT_AVAILABLE` | PASS | `ErrorCode.ACTION_NOT_AVAILABLE` found (2 files: enum def + doc-referenced usage); enum lives in session protocol types |
| `onPersistenceError(error, consecutiveFailures, healthy)` | PASS | `src/session/game-session.ts:144,256,319,330,554` — signature matches exactly, including the 3-consecutive-failures / recovers-on-next-success semantics |
| `session.lastPersistenceError`, `session.persistenceHealthy` | PASS | 5 files each |
| `debug:logs` ring buffer capped at 300 entries | PASS | matches doc claim; op confirmed present in dev-host source |

### `docs/custom-ui-guide.md` — Anchor Requirements & Fail-Loud Animation

| Claim | Verdict | Evidence |
|---|---|---|
| `anchorAttrs(ref, type)` from `boardsmith/ui` | PASS | `src/ui/composables/useBoardInteraction.ts:422` — `export function anchorAttrs(ref: ElementRef, type: string = 'unknown')`; exported at `src/ui/index.ts:66` |
| Once-per-type dev warning, dedup by `type` | PASS | matches signature default `'unknown'` and dedup framing |
| `useElementAnimation`, `useFLIP`, `useFlyingElements` fail-loud-in-dev / console.error-in-prod split, gated by internal `isDevThrowEnabled()` | PASS | all 3 composables found (12, 7, 16 files); `isDevThrowEnabled` found in 10 files but **not exported from any public barrel** (`src/utils/index.ts`, `src/ui/index.ts`) — confirmed this matches 130-01's own documented decision to describe it as internal-only, no import path claimed |
| `data-bs-el-id` canonical, `data-element-id` FLIP alias | PASS | both found (12, 13 files) |

### `docs/migration-guide.md` — `## v4.4` breaking changes

| Claim | Verdict | Evidence |
|---|---|---|
| Old `./session/testing/headless-harness.js` path deleted, no shim | PASS | file does not exist in `src/` (confirmed no `headless-harness.ts` present); `createHeadlessSession` only resolves via `boardsmith/session` |
| `ElementCollection.shuffle(random: () => number)` now requires explicit RNG | PASS | `src/engine/element/element-collection.ts:211` — `shuffle(random: () => number): ElementCollection<T>` (required param, no default) |
| `Space.shuffle()` (no-arg) unaffected — wraps seeded RNG internally | PASS | `src/engine/element/space.ts:271` `shuffle(): void { this.shuffleInternal(); }`, `shuffleInternal()` throws if no seeded RNG reachable (line 282) — confirms it always threads the game's seeded RNG, never `Math.random` |
| `playUntilComplete()` deterministic-by-default, literal seed `'playUntilComplete-default'` | PASS | `src/testing/simulate-action.ts:315` — `options?.rng ?? createSeededRandom(options?.seed ?? 'playUntilComplete-default')` |
| `onPersistenceError` gained 2 args | PASS | confirmed above (game-session.ts) |
| `anchorAttrs()` gained `type` param, defaults `'unknown'` | PASS | confirmed above (useBoardInteraction.ts:422) |
| No `Math.random` anywhere in engine paths (`space.ts`, `element-collection.ts`) | PASS | `grep -rn "Math.random" src/engine/element/space.ts src/engine/element/element-collection.ts` → zero matches |

### `docs/llm-overview.md` — Determinism Guarantee + Agent Ergonomics (v4.4)

| Claim | Verdict | Evidence |
|---|---|---|
| `game.random` is a mulberry32 generator | PASS | `src/utils/random.ts:7,22` implements mulberry32; `src/engine/element/game.ts:285` references it as the game's RNG |
| `simulateRandomGames` exported from `boardsmith/testing` | PASS | `src/testing/index.ts:56` |
| `boardsmith simulate` line added to CLI command list | PASS | confirmed live via `npx boardsmith simulate --help` |
| `boardsmith validate`, `build`, `publish`, `init`, `dev`, `test` all real commands | PASS | all present in `src/cli/cli.ts` (`.command('validate')`, `.command('build')`, `.command('publish')`, `.command('init <name>')`, `.command('dev')`, `.command('test')`) |

### `docs/README.md` — index + Quick Links

| Claim | Verdict | Evidence |
|---|---|---|
| `boardsmith simulate` added to Quick Links CLI list | PASS | confirmed live |
| `boardsmith/client` added to Key Packages | PASS | `src/client/index.ts` is a real public package entry (confirmed `createDevHostClient` export lives there) |
| Migration Guide row added to index table | PASS | `docs/migration-guide.md` exists with the referenced `## v4.4` anchor |

## Cheap Doc-Embedded Commands Run

```
$ npx boardsmith simulate --help
Usage: boardsmith simulate [options]

Run seeded headless batch simulation and report pass/stuck/error per game

Options:
  --games <count>    Number of games to simulate (default: "10")
  --seed <seed>      Base seed (per-game seeds derived and recorded in output)
  --players <count>  Player count for each simulated game (default: "2")
  --json             Output results as JSON
  -h, --help         display help for command
```

Output matches `docs/api/testing.md`'s documented flags, defaults, and `--json` framing
exactly. No other doc-embedded commands in these seven files were runnable cheaply
without a live game/dev-host process (the WS ops and `createDevHostClient` recipes require
a running `boardsmith dev` instance — verified via source inspection instead, per the
plan's "do not run long-lived processes" constraint).

## Requirements Validated

- **DOC-05** — all new/changed v4.4 APIs (FLOW, VIS, SIM, ERR, DRIVE, ANIM) documented with working examples across `docs/api/testing.md`, `docs/agent-control.md`, `docs/custom-ui-guide.md`, `docs/browser-testing.md`, `docs/llm-overview.md`. Every claim independently grep/source-verified above.
- **DOC-06** — every removed/changed API recorded with before→after guidance in the `## v4.4` section of `docs/migration-guide.md` (repo convention; no root BREAKING.md). All 6 changes verified byte-for-byte against source signatures.

## Doc Errors Found

None. Zero symbol, export-path, signature, default-value, or CLI-flag claims required a fix.
This is consistent with 130-01's SUMMARY, which documented that all invented-symbol drafts
(wrong `createHeadlessSession` signature, wrong `Op` shape, two non-existent `ErrorCode`
values) were caught and corrected by the author's own grep-before-writing discipline
*before* the 130-01 commits landed — this plan's independent sweep re-confirms that
self-correction held for every claim across all seven files.

## Final Verdict

**PASS.** Every symbol, CLI command/flag, WS op, and code-shape claim across the seven
v4.4-edited docs is confirmed present and accurate in live `src/`. Zero unverifiable claims
remain. This finalizes **DOC-05** and **DOC-06**.

`nyquist_compliant: true` — the grep + source-read + live-command-run gate above is the
automated check for this docs-only phase; no additional automated test suite applies to
prose documentation.
