---
phase: 110-demonstration-refinement
reviewed: 2026-06-29T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/session/snapshot-session-host.ts
  - src/session/stateless-ops.ts
  - src/cli/dev-host/bridge.ts
  - src/cli/commands/dev.ts
  - src/ui/components/GameShell.vue
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 110: Code Review Report

**Reviewed:** 2026-06-29
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 110 wired Phase-107 AI teaching features (hint, heatmap, narrated demo loop, `hasAIPlayers` signal) into the `boardsmith dev` path through `SnapshotSessionHost`, `stateless-ops`, `bridge.ts`, and `GameShell.vue`. The structural design is sound: the `aiSuggest`-then-`action` two-phase pattern correctly avoids a MCTS re-run for the execute step, transient teaching state is genuinely per-seat with no cross-seat leak, `mergeTransientState` leaves `buildPlayerState` pure, and the `hasAIPlayers` broadcast flag does not pollute the production lobby path.

Two BLOCKERs were found in the demo loop's cancellation mechanics. Both stem from the same root: the delay `setTimeout` in `runDemoLoop` is not cancellable once started, and the `demoStop` handler does nothing to the fields (`narrationText`, `demoRunning`) that are polled by the rest of the system. This leaves clients in an incorrect teaching state for up to `delay` ms (default 1200 ms) after a stop is requested, and any human action that arrives in that window broadcasts stale narration text to all players.

Three additional warnings address a snapshot-read race in the demo loop, a missing seat validation on the `heatmapToggle visible=false` short-circuit path, and narration text that exposes AI action args to all seats in hidden-information games.

---

## Critical Issues

### CR-01: `demoStop` does not immediately clear `narrationText` — stale narration broadcast to all players

**File:** `src/session/snapshot-session-host.ts:135-147`

**Issue:** The `demoStop` handler sets `this.demoAbort = true` and returns immediately. It does not clear `this.narrationText`. `narrationText` was last set at line 295 (Phase 2 of the loop) and is only cleared in two places: line 310 (just before action execute, never reached after an abort-during-delay) and the `finally` block (lines 344-346, which runs only after the non-cancellable timer fires — up to `delay` ms later).

Any call to `apply()` that occurs during this window — a human player submitting an action, a debug op, etc. — will invoke `mergeTransientState(res.playerViews)`. That function checks `if (this.narrationText) state.narration = { text: this.narrationText }` and injects the stale narration string into every seat's view before broadcasting. Clients continue to display a narration card (e.g., "Player 1: place E3") for an opponent's move that was already stopped.

**Fix:** In the `demoStop` handler, clear `narrationText` synchronously and broadcast the clean state:

```typescript
if (op.type === 'demoStop') {
  this.demoAbort = true;
  // Clear narration immediately so any apply() broadcast during the delay window
  // does not leak the in-flight narration string to all clients.
  this.narrationText = null;
  this.broadcastCurrent(); // pushes isDemoRunning=true (still), narration=undefined
  return {
    success: true,
    snapshot: this.snapshot,
    flowState: this.flowState,
    playerViews: [],
    isComplete: this.isComplete,
    winners: this.winners,
    pendingState: null,
  };
}
```

---

### CR-02: Non-cancellable `setTimeout` leaves a pending timer after demo-stop — violates CLAUDE.md timer-leak rule

**File:** `src/session/snapshot-session-host.ts:299`

**Issue:** The delay step in `runDemoLoop` creates a `setTimeout` with no handle stored and no way to cancel it:

```typescript
await new Promise<void>((resolve) => setTimeout(resolve, delay));
```

When `demoStop` fires (`this.demoAbort = true`), the timer is already pending. The `finally` block — which resets `demoRunning = false` and calls `broadcastCurrent()` to confirm the stop to all clients — does not run until the timer fires, up to `delay` ms (default 1200 ms) later.

Consequences:
- `isDemoRunning` remains `true` in every broadcast during the delay window. The UI correctly derives `isDemoRunning` from broadcast state (`state.value?.state?.isDemoRunning`), so the "Stop Demo" button stays active for up to 1.2 s after the user pressed it.
- Per CLAUDE.md "Never leave processes running in the background that you start": a timer is running after the user-visible stop request has been acknowledged.
- If the host is replaced (game restart via `debug:restart`) while the timer is pending, the old `runDemoLoop` closure fires against the old host instance, running `broadcastCurrent()` on a host whose adapters may no longer be connected. This is harmless in practice (the adapter checks `WebSocket.OPEN`) but represents an object-lifetime hazard.

**Fix:** Store the timer handle so `demoAbort` can cancel it immediately. One clean approach:

```typescript
// Instance field:
private _demoDelayCancel: (() => void) | null = null;

// In runDemoLoop, replace the non-cancellable await:
await new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, delay);
  this._demoDelayCancel = () => { clearTimeout(timer); resolve(); };
});
this._demoDelayCancel = null;

// In the demoStop handler, invoke the cancel if set:
if (op.type === 'demoStop') {
  this.demoAbort = true;
  this.narrationText = null;
  this._demoDelayCancel?.(); // fires resolve() synchronously → loop resumes → finally cleans up
  // ...
}
```

With this change, `finally` runs synchronously in the same microtask as `demoStop`, guaranteeing a single `broadcastCurrent()` that pushes `isDemoRunning=false` before the response is returned to the caller.

---

## Warnings

### WR-01: Snapshot-read race between `aiSuggest` and `action` in the demo loop

**File:** `src/session/snapshot-session-host.ts:280-332`

**Issue:** `this.snapshot` is an instance variable read twice per iteration — once for the `aiSuggest` call (line 280) and once for the `action` call (line 311). There is no lock around the loop iteration. `SnapshotSessionHost.handleOp` is public and async, so a concurrent call (e.g., a human player's `action` op arriving while `runDemoLoop` is suspended at `await this.adapters.executeOp(aiSuggest)` or `await delay`) can mutate `this.snapshot` via `apply()` between the two reads.

If the snapshot changes between `aiSuggest` and the `action` execute:
- The narration describes a move on the OLD state ("Player 1: place E3") but the action is executed on the NEW state (where, say, E3 is now occupied). If the move fails, `!execRes.success` causes a clean `break` and `finally` cleanup.
- If the move accidentally succeeds on the new state, the game advances with a move that was narrated incorrectly and chosen from a stale MCTS search. The narrate/execute contract the code carefully documents is violated not by MCTS re-running, but by the state changing under the cached suggested action.

This requires specific timing (a human action concurrent with the demo) and a game structure where the old move is coincidentally valid on the new state. For pure AI-vs-AI demos with no human interaction the race does not occur. Fix: capture the snapshot at the top of each iteration:

```typescript
while (!this.demoAbort && !this.isComplete && moves < this.MAX_DEMO_MOVES) {
  moves++;
  const iterSnapshot = this.snapshot; // snapshot frozen for this iteration

  const suggestRes = await this.adapters.executeOp(iterSnapshot, null, {
    type: 'aiSuggest', seats: allSeats,
  });
  // ...
  const execRes = await this.adapters.executeOp(iterSnapshot, null, {
    type: 'action', actionName: suggestedAction, player: aiPlayer, args: ...,
  });
  // ...
}
```

---

### WR-02: `heatmapToggle visible=false` bypasses seat validation

**File:** `src/session/stateless-ops.ts:598-604`

**Issue:** The `handleHeatmapToggle` function short-circuits when `!op.visible` and returns without validating `op.seat`:

```typescript
if (!op.visible) {
  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    heatmapUpdate: { seat: op.seat, visible: false, entries: [] },
  };
}
```

The `visible=true` path (lines 610-612) validates `op.seat < 1 || op.seat > gameOptions.playerCount` and fails loud. The `visible=false` path does not. `SnapshotSessionHost.handleOp` stores the result unconditionally:

```typescript
this.transientTeachingState.set(res.heatmapUpdate.seat, {
  ...existing,
  heatmap: { visible: false, entries: [] },
});
```

An out-of-range seat (e.g., `seat: 0` or `seat: 99`) stores an orphaned entry in `transientTeachingState`. `mergeTransientState` iterates `playerViews` and maps to seats `1..N`, so the orphaned entry is never applied (no visible effect), but the Map entry leaks indefinitely until the next `undo`/`debugRewind` clears all transient state.

More importantly, this inconsistency means `heatmapToggle { seat: 0, visible: false }` returns `success: true` while `heatmapToggle { seat: 0, visible: true }` returns a `protocol` error. The same CLAUDE.md "fail-loud" contract that the `visible=true` path honours is absent from the hide path.

**Fix:** Validate seat range before the `!op.visible` short-circuit:

```typescript
async function handleHeatmapToggle(...) {
  const runner = runnerFromSnapshot(snapshot, def);
  if (op.seat < 1 || op.seat > gameOptions.playerCount) {
    return errorResult(
      `Invalid seat ${op.seat}: must be between 1 and ${gameOptions.playerCount}.`,
      'protocol',
    );
  }
  if (!op.visible) {
    return {
      success: true,
      ...stateEnvelope(runner, gameOptions.playerCount),
      heatmapUpdate: { seat: op.seat, visible: false, entries: [] },
    };
  }
  // ...
}
```

---

### WR-03: `buildNarration` includes full action args in all-seats broadcast — exposes AI choices in hidden-information games

**File:** `src/session/snapshot-session-host.ts:356-361`

**Issue:** `buildNarration` formats all action args into a human-readable string and stores it as `this.narrationText`. `mergeTransientState` then injects `state.narration = { text: this.narrationText }` into EVERY seat's view — not just the acting player's view:

```typescript
// mergeTransientState, line 69:
if (this.narrationText) state.narration = { text: this.narrationText };
```

In a hidden-information game (e.g., Go Fish, Cribbage), the AI's action args can include card element IDs that other players should not see before the move executes. For example, narration might read "Player 1: playCard card=42", broadcasting element ID 42 to all seats. A player who can see raw broadcast state could infer which card was played before the state update arrives.

`boardsmith dev` supports LAN multiplayer ("others on the LAN can join the same game"), so this is a real disclosure path when multiple human players are on different machines.

**Fix:** If args may contain hidden data, the narration should be filtered to show only the action name (already done in the `argSummary ? ... : ...` fallback), or `hintTargetFromMove` from `def.ai` should be used to produce a safe destination-only description. At minimum, add a comment calling out the hidden-info risk and link to a game author escape hatch:

```typescript
private buildNarration(player: number, action: string, args: Record<string, unknown>): string {
  // NOTE: args may contain element IDs that are hidden to other players.
  // Games with hidden information should supply def.ai.narrateMove(player, action, args)
  // to produce a safe description. Falling back to destination-only via DEST_ARGS
  // would be safer than JSON.stringify(args) for all games.
  const argSummary = Object.entries(args)
    .map(([k, v]) => (v !== null && typeof v === 'object' ? `${k}=${JSON.stringify(v)}` : `${k}=${String(v)}`))
    .join(' ');
  return argSummary ? `Player ${player}: ${action} ${argSummary}` : `Player ${player}: ${action}`;
}
```

---

## Info

### IN-01: `bridge.ts handleServerRequest` catch block discards the original error message

**File:** `src/cli/dev-host/bridge.ts:290-295`

**Issue:**

```typescript
} catch (err) {
  console.error(`[boardsmith dev] server_request '${wireOp}' failed:`, err);
  opts.postServerResponse(seat, requestId, {
    success: false,
    error: 'Operation failed',
  });
}
```

The error is logged to the console but the response sent back to the iframe carries the generic string `'Operation failed'` rather than `err instanceof Error ? err.message : String(err)`. The console log is only visible to the developer running the CLI; the in-game UI (and any test that inspects the `server_response`) sees no actionable detail.

**Fix:**
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[boardsmith dev] server_request '${wireOp}' failed:`, err);
  opts.postServerResponse(seat, requestId, { success: false, error: message });
}
```

---

### IN-02: Dead `DEBUG_HMR = false` flag in GameShell.vue

**File:** `src/ui/components/GameShell.vue:23-26`

**Issue:**

```typescript
const DEBUG_HMR = false;
function hmrLog(...args: unknown[]) {
  if (DEBUG_HMR) console.log('[HMR-DEBUG]', ...args);
}
```

`DEBUG_HMR` is a module-level constant set to `false`. The `hmrLog` function is never a no-op — the `if (DEBUG_HMR)` branch is dead in every build. This constitutes dead conditional code and a leftover debug flag. In a production bundle, the constant-folding will eliminate the `console.log` call, but the function declaration and all `hmrLog(...)` call sites (approximately eight) remain as semantic clutter.

**Fix:** Remove `DEBUG_HMR`, `hmrLog`, and all its call sites, or replace with a proper dev-mode guard (`if (import.meta.env.DEV && someFlag)`) if HMR tracing may need to be re-enabled.

---

_Reviewed: 2026-06-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
