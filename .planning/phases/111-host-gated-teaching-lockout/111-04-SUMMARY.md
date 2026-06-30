---
phase: 111
plan: "04"
subsystem: cli/dev-host
tags: [teaching-lockout, cli-flag, dev-host, cross-layer, multiplayer-host]
dependency_graph:
  requires: [111-02, 111-03]
  provides: [--lock-teaching CLI flag, MultiplayerHostOptions.teachingDisabled, DevHostConfig.teachingDisabled, DevHost.vue init teachingDisabled delivery]
  affects:
    - src/cli/cli.ts
    - src/cli/commands/dev.ts
    - src/cli/dev-host/multiplayer-host.ts
    - src/cli/dev-host/multiplayer-host.test.ts
    - src/cli/dev-host/config-types.ts
    - src/cli/dev-host/DevHost.vue
tech_stack:
  added: []
  patterns: [single-source teachingDisabled const derived once in devCommand, threaded into both server path (MultiplayerHost → createDevSession) and client path (buildDevConfig → DevHost.vue init), cross-layer integration tests with real executeOp + SnapshotSessionHost]
key_files:
  created: []
  modified:
    - src/cli/cli.ts
    - src/cli/commands/dev.ts
    - src/cli/dev-host/multiplayer-host.ts
    - src/cli/dev-host/multiplayer-host.test.ts
    - src/cli/dev-host/config-types.ts
    - src/cli/dev-host/DevHost.vue
decisions:
  - "teachingDisabled derived ONCE in devCommand (const teachingDisabled = options.lockTeaching === true) and fanned out to both consumers — server path and client path — from one source"
  - "baseOptions carries teachingDisabled so all non-start ops (hint/heatmapToggle/startTutorial) route through the executeOp guards from Plan 111-02"
  - "startGameOptions also carries teachingDisabled so a startTutorial op at start time is covered by the same guard"
  - "createDevSession receives teachingDisabled so SnapshotSessionHost adapters arm the demoStart guard and broadcast injection from Plan 111-02"
  - "All three DevHost.vue init postMessage calls (host init delivery, iframe reload, state retry) carry teachingDisabled so first-render gating (Plan 111-03) fires in all scenarios"
  - "Pre-existing dev.ts srcDir shadow (line 506) and build shadow (line 159) fixed since we own the file"
metrics:
  duration: "5 minutes"
  completed: "2026-06-30"
  tasks_completed: 2
  files_modified: 6
---

# Phase 111 Plan 04: Host-Gated Teaching Lockout — CLI Flag + Dev-Host Wiring Summary

**One-liner:** `--lock-teaching` CLI flag wired end-to-end through the dev-host stack — one boolean derived in devCommand fans out to server enforcement (executeOp gameOptions bag + SnapshotSessionHost adapters) and client gating (DevHostConfig + all three init postMessage calls in DevHost.vue), with 5 cross-layer integration tests using the real executeOp and SnapshotSessionHost.

## What Was Built

### Task 1: --lock-teaching flag + thread teachingDisabled through the dev-host server (commit `f957d5b`)

**`src/cli/cli.ts`** — `--lock-teaching` boolean option added next to `--ai-level` (the sibling pattern from D-04).

**`src/cli/commands/dev.ts`** — Three changes:
1. `lockTeaching?: boolean` added to `DevOptions`.
2. `const teachingDisabled = options.lockTeaching === true` derived once in `devCommand` — single source for both the server and client consumers.
3. `teachingDisabled` passed into the `MultiplayerHost` constructor and into `buildDevConfig`. A console notice is printed when the flag is active (mirrors the `--ai` seat notice).

**Pre-existing eslint shadows fixed** (both in dev.ts, owned file):
- `srcDir` shadow at line 506 → renamed to `pkgSrcDir` (scoped inside the `boardsmith/` prefix block).
- `build` shadow at line 159 → renamed to `esbuildBuild` (scoped inside the esbuild plugin setup).

**`src/cli/dev-host/multiplayer-host.ts`** — `teachingDisabled?: boolean` added to `MultiplayerHostOptions` with JSDoc. In `startGame`:
- `baseOptions = { playerCount, teachingDisabled: this.opts.teachingDisabled }` — threads the flag into the `executeOp` gameOptions bag for all non-start ops (hint/heatmapToggle/startTutorial guards in Plan 111-02 read `gameOptions.teachingDisabled`).
- `startGameOptions` also gets `teachingDisabled: this.opts.teachingDisabled` so a `startTutorial` at game start is covered.
- `createDevSession({ ..., teachingDisabled: this.opts.teachingDisabled, ... })` — arms the SnapshotSessionHost adapters so the demoStart guard and broadcast injection from Plan 111-02 fire.

**`src/cli/dev-host/multiplayer-host.test.ts`** — 5 cross-layer integration tests added in a new `'MultiplayerHost — teaching lockout (cross-layer: teachingDisabled:true)'` describe block. Uses the REAL `executeOp` and `SnapshotSessionHost` (not stubs):
- `hint` op rejected via executeOp guard (gameOptions bag)
- `heatmap-toggle` op rejected via executeOp guard
- `start-tutorial` op rejected via executeOp guard
- `demo-start` op rejected via SnapshotSessionHost.handleOp guard
- Default unchanged: host without teachingDisabled processes a `pass` action normally

### Task 2: Deliver teachingDisabled to the iframe via DevHostConfig + init postMessage (commit `996f29e`)

**`src/cli/dev-host/config-types.ts`** — `teachingDisabled?: boolean` added to `DevHostConfig` with JSDoc explaining the first-render delivery purpose and the broadcast-as-authoritative-source distinction.

**`src/cli/dev-host/DevHost.vue`** — All three `postToGame({ type: 'init', ... })` calls updated to include `teachingDisabled: cfg.teachingDisabled === true`:
1. `onHostMessage` case `'init'` — primary host delivery when the host assigns a seat.
2. `onIframeLoad` — iframe reload/refresh redelivers the flag so a page reload does not lose gating.
3. `onWindowMessage` `'request-state'` handler — AutoUI retry button redelivers the flag so a state recovery also redelivers gating.

The broadcast path (`mergeTransientState` in SnapshotSessionHost, Plan 111-02) remains the authoritative source for reconnects — these init deliveries only cover first render before the first broadcast.

## Verification

```
npm test -- src/cli/dev-host/
# 49 tests, all pass (25 multiplayer-host + 7 DevHost.seats + 5 DevHost.restart + 12 bridge)

npx eslint src/cli/cli.ts src/cli/commands/dev.ts src/cli/dev-host/multiplayer-host.ts src/cli/dev-host/config-types.ts
# clean (0 errors, 0 warnings)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing build shadow in dev.ts cleared**
- **Found during:** Task 1 ESLint verification
- **Issue:** Besides the `srcDir` shadow at line 506 (called out in phase_context), a second pre-existing shadow existed at line 159 — `build` parameter inside the esbuild plugin `setup()` shadowed the top-level import `build` from esbuild.
- **Fix:** Renamed the parameter to `esbuildBuild`. References (`esbuildBuild.onResolve`) updated accordingly.
- **Files modified:** `src/cli/commands/dev.ts`
- **Commit:** `f957d5b`

## Known Stubs

None — `--lock-teaching` is fully wired to both the server enforcement layer (executeOp gameOptions + SnapshotSessionHost adapters) and the client gating layer (DevHostConfig + init postMessage).

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. The plan's threat register mitigations are implemented:
- **T-111-10** (Tampering — dev-host op dispatch under `--lock-teaching`): mitigated by `baseOptions.teachingDisabled` reaching the executeOp guards AND `createDevSession({ teachingDisabled })` reaching SnapshotSessionHost.handleOp. The 5 cross-layer integration tests exercise each guard with the real stack.
- **T-111-11** (Spoofing — iframe trusts init flag only): accepted per plan. The init delivery is first-render only; the broadcast `state.teachingDisabled` (Plan 111-02 mergeTransientState) is the authoritative source for reconnects and second windows.

## Self-Check: PASSED

- `src/cli/cli.ts` — modified (contains `--lock-teaching` option)
- `src/cli/commands/dev.ts` — modified (contains `teachingDisabled`, `lockTeaching`, `buildDevConfig` with `teachingDisabled` arg and return value, `MultiplayerHost` construction with `teachingDisabled`)
- `src/cli/dev-host/multiplayer-host.ts` — modified (contains `teachingDisabled` in `MultiplayerHostOptions`, `baseOptions`, `startGameOptions`, `createDevSession` call)
- `src/cli/dev-host/multiplayer-host.test.ts` — modified (5 new cross-layer teaching lockout tests)
- `src/cli/dev-host/config-types.ts` — modified (contains `teachingDisabled` in `DevHostConfig`)
- `src/cli/dev-host/DevHost.vue` — modified (3 init postMessage calls contain `teachingDisabled`)
- Commits: `f957d5b` (Task 1), `996f29e` (Task 2) — both confirmed in git log
