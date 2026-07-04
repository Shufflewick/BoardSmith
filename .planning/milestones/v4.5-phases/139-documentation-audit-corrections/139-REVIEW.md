---
phase: 139-documentation-audit-corrections
reviewed: 2026-07-04T03:00:07Z
depth: quick
files_reviewed: 6
files_reviewed_list:
  - src/engine/flow/engine.ts
  - src/engine/flow/engine.test.ts
  - src/engine/element/game.ts
  - src/engine/player/player.ts
  - docs/core-concepts.md
  - docs/api/client.md
findings:
  critical: 1
  warning: 1
  info: 3
  total: 5
status: resolved
---

# Phase 139: Code Review Report

**Reviewed:** 2026-07-04T03:00:07Z
**Depth:** quick
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the phase 139 documentation-audit changes (diff `a24e521f..f429765f`) plus the specific verification targets from the review brief. The quick-depth pattern scan (secrets, dangerous functions, debug artifacts, empty catch) is clean across all 6 files. The headline corrections are sound:

- **Runtime warning text (engine.ts:1366, 1442) matches the real API.** Verified against the actual registration surface: `Action.create` exists (`src/engine/action/action-builder.ts:91`, static), `registerActions(...actions)` exists (`src/engine/element/game.ts:954`), and constructor-time registration is the real lifecycle (no `defineActions()`/`defineFlow()` hooks exist anywhere in `src/`).
- **The engine.test.ts assertion change is honest and strengthened, not weakened** — it now positively asserts `Action.create('nope')` and `game's constructor`, and adds negative assertions for the phantom `defineActions()` and `action('nope')` forms. All 100 tests in `src/engine/flow/engine.test.ts` pass.
- **JSDoc rewrites in game.ts/player.ts reference real methods**: `chooseElement` (action-builder.ts:316), `chooseFrom` (:195), `.execute()` (:628), and `.condition({ 'named reason': fn })` matches the real `ConditionConfig` record shape (:136). `dealTo` and `setAttribute` phantom references are fully purged.
- **core-concepts.md's state-authoritative rewrite is factually correct**: element methods do NOT record commands (no production caller of `game.execute()` except the ANIMATE stream at game.ts:2620; `replayCommands` has no production callers); networking/persistence/undo are snapshot-based, as claimed.
- **client.md's new config fields all exist in `src/client/types.ts`**: `connectImmediately` (:229), `connectionTimeout` (:236, default 10000 confirmed at game-connection.ts:92), `wsImplementation` (:218), `autoReconnect`/`maxReconnectAttempts`/`reconnectDelay` (:204–210); `generatePlayerId()` is real and exported.

However, two of the newly written examples teach provably broken code — one of which will never connect at all. For a phase whose entire deliverable is documentation accuracy, the connection example is a blocker.

## Critical Issues

### CR-01: New client.md "Connection Options" example never connects

**File:** `docs/api/client.md:210-212` (newly added in this phase)
**Issue:** The example added for `connectImmediately: false` is doubly wrong against the real API:

```typescript
if (!connection.opened) {
  await connection.connect(); // connectImmediately: false requires this call
}
```

1. `GameConnection.opened` is `Promise<void>` (`src/client/game-connection.ts:63`, initialized to `Promise.resolve()`), so it is **always truthy** — `!connection.opened` is always `false` and `connect()` is **never called**. Anyone following this example with `connectImmediately: false` gets a connection that silently never dials.
2. `connect(): void` (`src/client/game-connection.ts:102`) returns `void` — `await connection.connect()` does not wait for the handshake even if reached.

This is the exact failure class the phase exists to fix (docs teaching a phantom/incorrect API contract), introduced fresh by this phase.

**Fix:**
```typescript
// connectImmediately: false requires an explicit connect(); await `opened`
// for the handshake (it's a Promise, not a boolean).
connection.connect();
await connection.opened;
```

## Warnings

### WR-01: game.ts JSDoc `endTurn` example is a silent no-op

**File:** `src/engine/element/game.ts:431` and `src/engine/element/game.ts:950`
**Issue:** Both rewritten examples show:

```typescript
Action.create('endTurn')
  .execute(() => this.nextPlayer())
```

`nextPlayer()` (game.ts:2179) is a **pure query** — it returns the next player and mutates nothing. This `endTurn` action does nothing when executed. The same file documents the correct pattern three times (nextPlayer/setCurrentPlayer/previousPlayer JSDoc, e.g. game.ts:2164-2169): `const next = game.nextPlayer(); if (next) game.setCurrentPlayer(next);`. The broken pattern was carried over from the pre-phase text (`.do(() => this.nextPlayer())`), but these lines were rewritten in this phase and the class-level example (line 431) also uses `eachPlayer` flow, where the flow — not the action — rotates turns, making the example additionally misleading.
**Fix:** At game.ts:950, use the same-file canonical pattern:
```typescript
Action.create('endTurn')
  .execute(() => {
    const next = this.nextPlayer();
    if (next) this.setCurrentPlayer(next);
  })
```
At game.ts:431 (inside an `eachPlayer` flow example), either apply the same fix or drop the manual-rotation body entirely with a comment that `eachPlayer` handles rotation.

## Info

### IN-01: Simultaneous-step warning test does not lock in the corrected text

**File:** `src/engine/flow/engine.test.ts:2127-2139`
**Issue:** The action-step test was strengthened to pin the new `Action.create('nope')` / "game's constructor" wording and forbid the phantom forms, but the sibling `simultaneous-action-step` test only asserts `registerActions(` and `not.toContain('defineAction(')`. Note `'defineActions()'` does not contain the substring `defineAction(` — so this test would still pass if the old phantom `action('missing')`/`defineActions()` text regressed in the simultaneous branch (engine.ts:1441-1444).
**Fix:** Mirror the action-step assertions: `expect(message).toContain("Action.create('missing')")`, `expect(message).not.toContain('defineActions()')`, `expect(message).not.toMatch(/\baction\('missing'\)/)`.

### IN-02: core-concepts.md `move` example references `ctx` out of scope

**File:** `docs/core-concepts.md:172`
**Issue:** `.chooseElement('piece', { filter: p => p.player === ctx.player })` — `ctx` is not in scope; the real `filter` signature is `(element, context) => boolean` (action-builder.ts:322). Pre-existing line, but it sits inside the "Actions and State Mutation" section this phase rewrote, and it teaches non-compiling code.
**Fix:** `filter: (p, ctx) => p.player === ctx.player` (and same for the `destination` line if applicable).

### IN-03: game.ts JSDoc filter examples dereference possibly-undefined `currentPlayer`

**File:** `src/engine/element/game.ts:427` (class-level example) and `src/engine/element/game.ts:946`
**Issue:** `filter: c => c.parent === this.currentPlayer.hand` — `currentPlayer` is typed `P | undefined` (game.ts:2004), so this would not compile under strict TS, and base `Player` has no `hand` property (it comes from the game's Player subclass). Conceptually fine for a doc example, but the phase's stated bar was "JSDoc examples compile conceptually."
**Fix:** `filter: c => c.parent === this.currentPlayer?.hand` (or note the Player subclass assumption).

---

_Reviewed: 2026-07-04T03:00:07Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_


## Resolutions (orchestrator, 2026-07-03)

- CR-01: docs/api/client.md connectImmediately example corrected to `connection.connect(); await connection.opened;` — fixed.
- WR-01: both game.ts JSDoc endTurn examples now use `setCurrentPlayer(this.nextPlayer()!)` (the real mutating pattern) — fixed.
- IN-01..03: open by convention (info-level).
