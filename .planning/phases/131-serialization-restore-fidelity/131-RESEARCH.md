# Phase 131: Serialization & Restore Fidelity - Research

**Researched:** 2026-07-02
**Domain:** BoardSmith engine serialization (`src/engine/element/`) and session restore/broadcast (`src/session/`) — internal TypeScript codebase, no external framework
**Confidence:** HIGH (all findings traced to current file:line in this repo; no external library research needed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Zone Visibility Restore Fidelity (F1/F7 — SEC-01)**
- Fix mechanism: serialize `_zoneVisibility` — remove it from `Space.unserializableAttributes`, emit in `Space.toJSON()`, restore in `fromJSON` — exactly like element-level `_visibility` already works. It's plain data (mode + player lists). This automatically covers runtime visibility changes (e.g. cribbage crib re-hide at flow.ts:222).
- Regression test coverage: all restore paths — undo, rewind, `GameSession.restore`, `GameRunner.fromSnapshot`, stateless ops — each asserting `toJSONForPlayer(opponent)` byte-identical before/after restore.
- The existing spectator-view special-case patch in `stateless-ops.ts` (`buildSpectatorView`): unify — once serialization is authoritative, remove the special-case workaround so there is one mechanism.
- Extend the hidden-attrs/visibility regression sweep to run against a restored game, not only a live one.

**Attribute Filtering — visibleAttributes & state.players (F2/F8 — SEC-02/03)**
- `static visibleAttributes`: implement it — filter non-listed attributes from non-owners in `toJSONForPlayer`. Attribute-level filtering is a real gap (zone/element visibility hides whole elements only), and the same mechanism cleanly serves the F8 Player fix.
- `state.players`: route through the same per-viewer visibility rules as the board view — honor `isVisibleTo` and `visibleAttributes` on Player; Player-child elements filtered like any board element.
- Default semantics for custom Player attributes: public by default (matches current JSDoc "undefined = all visible"; keeps go-fish `bookCount` working) — secrecy is opt-in via `visibleAttributes`.
- Spectators: most restrictive view — treated as non-owner of everything.

**Restore Amnesia & Debug Gating (F10/F15/F16 — SEC-04, RST-01/02)**
- `onEnter`/`onExit` handlers lost on restore: re-bind from the constructor-built tree — before `loadSerializedState` discards the fresh constructor tree, capture registered handlers and re-attach them to rebuilt elements by stable identity (class + path/name); dev-warn on unmatched handlers. No game-code changes required.
- `teachingDisabled`: persist in `StoredGameState` (written by `create()`, read by `restore()`) exactly like `aiConfig` already is. Also fix `displayName`, which drops via the same mechanism.
- `registerDebug()` broadcast: explicit opt-in — default `includeDebugData` to `false` everywhere (broadcast, buildPlayerState, pending-action-manager, state-history, stateless buildViews); add `GameSessionOptions.debugEnabled` that the dev host sets and production hosts never do.
- Docs modeling hidden-state dumps into `registerDebug` (game.ts JSDoc, docs/common-pitfalls.md): fix in this phase per DOCX-04 same-phase doc rule.

**Verification & Testing Discipline (PROC-01/02)**
- Verdicts live in a per-phase `131-FINDINGS-VERIFICATION.md` in the phase dir — one entry per finding (F1, F2, F7, F8, F10, F15, F16) with LEGITIMATE/REJECTED verdict + repro or file:line trace, written BEFORE any fix.
- Regression tests proven red-then-green in execution order — write the failing test first, record the failure output in the SUMMARY, then fix.
- Restore-fidelity assertions use `JSON.stringify(toJSONForPlayer(opponent))` strict equality before vs after each restore path.
- Test placement follows existing patterns — engine round-trip tests alongside existing visibility suites (e.g. `deck-hand-visibility.test.ts` style) in `src/engine/`; session persistence tests in `src/session/`.

### Claude's Discretion
- Exact identity-matching scheme for handler re-binding (class + branch path vs name) — pick whatever is stable across serialization round-trips; dev-warn loudly on any handler that can't be re-attached.
- Whether `visibleAttributes` filtering composes with `playerView` escape hatch — keep behavior coherent and documented.
- Naming/shape of `GameSessionOptions.debugEnabled` plumbing through dev host. **Research finding: `boardsmith dev` uses `SnapshotSessionHost`, not `GameSession` — see Pitfall 2 below. Recommend scoping `debugEnabled` to `GameSession` consumers only, with no CLI wiring, unless the user confirms broader scope.**

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROC-01 | Every finding F1–F38 has a recorded verification verdict (LEGITIMATE with repro/trace evidence, or REJECTED with reasoning) before its fix is planned or written | File:line evidence for all 7 in-scope findings gathered above (Summary, Architecture Patterns, Common Pitfalls) — ready to seed `131-FINDINGS-VERIFICATION.md`; current line numbers confirmed to match or slightly drift from the original audit (noted inline) |
| PROC-02 | Every legitimate finding's fix includes a regression test that fails on the pre-fix code | Validation Architecture section maps each REQ to a specific new test file; existing red-then-green patterns identified (`deck-hand-visibility.test.ts`, `tutorial-serialization.test.ts`) |
| SEC-01 | Zone visibility survives every snapshot restore path — `toJSONForPlayer(opponent)` identical before/after restore (F1, F7) | Pattern 1 (exact `_visibility` template to mirror); all 5 restore paths enumerated with file:line in Code Examples |
| SEC-02 | `static visibleAttributes` implemented or deleted, docs corrected (F2) | Pattern 2 identifies exact insertion point in `filterElement`'s fallthrough (game.ts ~2790-2806); confirmed via grep the field is read nowhere today |
| SEC-03 | `state.players` routed through same per-viewer visibility filtering as board view (F8) | Pattern 3 — derive from already-filtered `truthView` instead of raw `player.toJSON()`; confirmed Players are genuine `Game` tree children so `filterElement` already processes them for `view` |
| SEC-04 | `registerDebug()` data not broadcast by default, gated (F15) | Exact 10 call sites enumerated in Code Examples; Pitfall 1 corrects which sites actually need fixing (stateless-ops.ts does NOT) |
| RST-01 | `onEnter`/`onExit` handlers fire after snapshot restore (F10) | Pattern 4 — exact discard point in `loadSerializedState` (game.ts:2848-2857) identified; Pitfall 3 flags the `private` field access issue |
| RST-02 | `teachingDisabled` persists across `GameSession.restore()` (F16) | Pattern 5 — exact `aiConfig` template to mirror; confirmed `restore()` passes `undefined` explicitly today (game-session.ts:813) |
</phase_requirements>


## Summary

This phase fixes one shared root cause manifesting as 7 distinct audit findings: **constructor-applied configuration that `loadSerializedState`/`GameRunner.fromSnapshot` silently discard on every restore**, plus one unrelated-but-adjacent broadcast gap (debug data defaulting to visible). All code paths were traced directly against the current repository state (2026-07-02) and match the audit's file:line claims almost exactly — a few line numbers have drifted slightly since the audit was run (the codebase has moved forward), noted below.

The fix template already exists in the codebase for the flagship finding (F1/F7, SEC-01): `GameElement._visibility` is `_`-prefixed (would normally be excluded by convention) but is deliberately special-cased into `toJSON()`/`fromJSON()` (game-element.ts ~793-795, ~1027) specifically because it must survive serialization. `Space._zoneVisibility` needs the exact same treatment and currently gets none — it sits in `Space.unserializableAttributes` (space.ts:114-118) with zero serialize/restore path anywhere in the codebase.

For SEC-02/SEC-03 (`visibleAttributes`, `state.players`), the natural implementation point is a single shared mechanism: `Game.toJSONForPlayer`'s `filterElement` closure (game.ts ~2777-2807) already has a "visible, normal element" fallthrough branch that returns `{...json, children: filteredChildren}` with **fully unfiltered attributes** — this is precisely where non-owner attribute filtering belongs, and it composes for free with `state.players` if `buildPlayerState` is changed to derive `state.players` from the already-filtered `truthView`'s Player nodes instead of calling raw `player.toJSON()` on every player (which is what it does today, at `src/session/utils.ts:237-260` — bypassing all visibility, including per-element `hideFromAll()`).

For RST-01/RST-02/SEC-04, the mechanisms are independent of each other and of SEC-01/02/03, but share the same "constructor config discarded on restore" pattern: `_eventHandlers` (Space.onEnter/onExit — needs re-binding, not serialization, since handlers are closures), `teachingDisabled`/`displayName` (need a `StoredGameState` field, following the existing `aiConfig` pattern exactly), and `includeDebugData` (12 call sites hardcode `true`; needs a default flip plus a new `GameSessionOptions.debugEnabled` opt-in).

**Primary recommendation:** Fix all three clusters (zone visibility, attribute/player filtering, restore-amnesia/debug-gating) as three largely-independent code changes sharing one theme, each with its own regression-test suite that asserts identity across all 5 restore paths (undo, rewind, `GameSession.restore`, `GameRunner.fromSnapshot`, stateless ops). Do PROC-01 verification (a fresh repro or trace per finding) before touching any fix code — the audit's own verdicts already did much of this work and are trustworthy as a starting point, but the phase's own `131-FINDINGS-VERIFICATION.md` must independently confirm against current line numbers (some have shifted since the audit ran).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Zone visibility serialization (`_zoneVisibility`) | Engine (`src/engine/element/space.ts`) | — | Plain data on the element; belongs in the same `toJSON`/`fromJSON` contract as `_visibility` |
| Element/attribute-level visibility filtering (`toJSONForPlayer`, `visibleAttributes`) | Engine (`src/engine/element/game.ts`) | — | `filterElement` is the single per-viewer redaction chokepoint; attribute filtering is a peer of existing element-hiding logic there |
| Handler re-binding (`onEnter`/`onExit`) | Engine (`src/engine/element/game.ts` `loadSerializedState`) | Engine (`space.ts` handler registry) | Restore-time tree rebuild is where the constructor tree is discarded; re-binding must happen at that exact hook point before discard |
| `state.players` per-viewer filtering | Session (`src/session/utils.ts` `buildPlayerState`) | Engine (consumes `toJSONForPlayer`) | Session layer owns the broadcast payload shape; it should delegate the actual redaction decision to the engine's existing filter, not re-implement it |
| Debug data gating (`includeDebugData`) | Session (`src/session/game-session.ts`, `pending-action-manager.ts`, `state-history.ts`) | — | Broadcast/opt-in policy is a session-layer host concern, not an engine concern |
| `teachingDisabled`/`displayName` persistence | Session (`src/session/types.ts` `StoredGameState`, `game-session.ts` `create`/`restore`) | — | Session-scoped host policy stored alongside `aiConfig`, which already does this |

## Standard Stack

Not applicable — this phase is pure internal-codebase bug-fixing across `src/engine/` and `src/session/`. No new libraries, packages, or external dependencies are introduced. See CLAUDE.md: "Don't add dependencies without discussing."

## Package Legitimacy Audit

**Not applicable.** This phase installs no external packages — all work is within the existing `src/engine/element/` and `src/session/` modules using only already-present internal APIs. The Package Legitimacy Gate protocol is skipped per its own scope condition (only required "whenever this phase installs external packages").

## Project Constraints (from CLAUDE.md)

**Home CLAUDE.md (`~/CLAUDE.md`):**
- Never leave processes running in the background that you start (relevant: kill any `vitest --watch` or dev servers started during verification).
- Never use dummy data, fallbacks, or hacks to get something working — fallbacks mask real problems. Applies directly to this phase: no partial/best-effort fixes for SEC-01..04/RST-01/02 — implement the real mechanism (serialize `_zoneVisibility` properly, not a special-cased workaround).
- "Pit of Success" mantra — design so the easy path is the correct path.
- Do not remove debug output before confirming the problem is fixed with the user.
- Don't add dependencies without discussing (not expected to be needed — see Package Legitimacy Audit, N/A this phase).

**Project CLAUDE.md (`/Users/jtsmith/BoardSmith/CLAUDE.md`):**
- **Pit of Success**: correct usage must be the easy path; incorrect usage must be hard. Directly informs SEC-02 (a documented-but-dead `visibleAttributes` field is the definition of a Pit of Failure — either implement it for real or remove it; CONTEXT.md already locked "implement it").
- **No Backward Compatibility**: clean breaks only, no deprecation cycles. Directly licenses flipping `includeDebugData`'s default from `true` to `false` (SEC-04) and any other breaking signature changes (e.g. `StoredGameState` new fields, `GameSessionOptions.debugEnabled` addition) without shims.
- **Prove Before Fix**: never guess at root cause — always investigate first. This research phase's file:line tracing (Architecture Patterns, Common Pitfalls) IS that investigation; PROC-01's `131-FINDINGS-VERIFICATION.md` step operationalizes it per-finding before any fix lands.
- All UI interactions must work in Custom UI and Action Panel with parity through `useBoardInteraction` — not directly relevant to this phase's scope (no UI work), but SEC-03's `state.players` fix must not break any UI consumer that reads `state.players` (go-fish `bookCount`, MERC player panels) — verify against `~/BoardSmithGames/go-fish` after the fix.
- Don't leave a dev server running that you start.

**Testing constraints (project CLAUDE.md):**
- Verify behavior by running the application/tests, not just reviewing code — this phase must run `npx vitest run` on new/changed test files, not just read the diff.
- Enumerate all code paths a change affects — this phase explicitly enumerates and must test all 5 restore paths, not just the primary `GameRunner.fromSnapshot` call.
- Trace at least one real value through the full stack (config → engine → session → UI) — for SEC-01, trace a `contentsHidden()` zone through `Space` constructor → snapshot → `fromSnapshot` restore → `toJSONForPlayer` → broadcast, confirming hidden at every hop.
- Treat identified test gaps as blockers — the Wave 0 gaps listed in Validation Architecture are not optional.
- Write at least one integration test per cross-layer boundary touched — SEC-03/RST-02 cross the engine/session boundary; each needs an integration-style test, not just an engine-unit test.

**Code quality audits (project CLAUDE.md):**
- Run `npm run audit:dead-code` (Fallow) after significant refactors — relevant here since SEC-04 removes/consolidates hardcoded `includeDebugData: true` literals across 4 files.
- Run `npm run audit:duplication` (jscpd) when touching modules with similar patterns — relevant since Pattern 2 (attribute filtering) and Pattern 3 (`state.players` derivation) both touch `filterElement`-adjacent logic and risk copy-paste drift if implemented separately instead of sharing code.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │   Game constructor (author code)         │
                    │   space.contentsHidden()                 │
                    │   space.onEnter(fn)                      │
                    │   GameSessionOptions.teachingDisabled     │
                    └───────────────┬───────────────────────────┘
                                    │ (1) LIVE — held on constructed instances
                                    ▼
        ┌───────────────────────────────────────────────────────┐
        │  Live Game instance                                    │
        │  Space._zoneVisibility  (plain data, NOT serialized)   │
        │  Space._eventHandlers   (closures, cannot serialize)   │
        │  GameSession.#teachingDisabled (constructor-only field)│
        └───────────────┬─────────────────────┬──────────────────┘
                         │ toJSON()            │ every restore path:
                         │ (2) SNAPSHOT         │  undo / rewind / GameSession.restore /
                         ▼                      │  GameRunner.fromSnapshot / stateless ops
        ┌────────────────────────────┐         │
        │  GameStateSnapshot / JSON   │         │
        │  — _zoneVisibility MISSING  │         │
        │  — _eventHandlers MISSING   │         │
        │  — teachingDisabled MISSING │◄────────┘ (3) all funnel through
        │    from StoredGameState     │             GameRunner.fromSnapshot
        └───────────────┬─────────────┘
                         │ GameElement.fromJSON() rebuilds tree from scratch
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │  Restored Game instance                                  │
        │  Space._zoneVisibility = undefined  → zone leaks to all  │
        │  Space._eventHandlers = { enter:[], exit:[] } → dead     │
        │  teachingDisabled = false (constructor default)          │
        └───────────────┬────────────────────────────────────────┘
                         │ buildPlayerState() / toJSONForPlayer()
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │  Broadcast to all seats + spectators                     │
        │  view: game.toJSONForPlayer(seat)  — filtered but         │
        │        (a) zone visibility now gone → over-reveals        │
        │        (b) visibleAttributes never consulted → leaks      │
        │  players: raw player.toJSON() for ALL seats — UNFILTERED  │
        │           bypasses isVisibleTo/hideFromAll entirely       │
        │  customDebug: included whenever includeDebugData!==false  │
        │               (12 call sites hardcode true)               │
        └────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new files/folders — all fixes land in existing files:
```
src/engine/element/
├── space.ts           # _zoneVisibility → toJSON()/fromJSON() (needs Space-level override; base class has none)
├── game-element.ts     # visibleAttributes filtering hook target (or game.ts filterElement, see below)
└── game.ts             # filterElement (toJSONForPlayer) — attribute filtering; loadSerializedState — handler re-bind hook

src/session/
├── utils.ts            # buildPlayerState — route state.players through per-viewer filter
├── game-session.ts      # includeDebugData call sites; restore()/create() — teachingDisabled/displayName persistence
├── pending-action-manager.ts  # includeDebugData call sites
├── state-history.ts     # includeDebugData call sites
├── stateless-ops.ts      # buildSpectatorView unification; buildViews already safe (see Pitfall below)
└── types.ts              # StoredGameState — add teachingDisabled, displayName fields
```

### Pattern 1: Mirror `_visibility`'s explicit-serialization special case for `_zoneVisibility`
**What:** `GameElement._visibility` is technically `_`-prefixed but is NOT in `unserializableAttributes`'s effective exclusion for this specific field — instead `toJSON()` special-cases it in with a guard (`if (this._visibility?.explicit)`), and `fromJSON()` special-cases it back out (`if (json.visibility) element._visibility = json.visibility`).
**When to use:** Any plain-data private field that must survive `toJSON`/`fromJSON` round-trip despite being conceptually "internal."
**Example (existing code — the template to mirror):**
```typescript
// Source: src/engine/element/game-element.ts:793-795 (toJSON)
// Include visibility if explicitly set
if (this._visibility?.explicit) {
  json.visibility = this._visibility;
}

// Source: src/engine/element/game-element.ts:1025-1028 (fromJSON, static)
// Restore visibility if present
if (json.visibility) {
  element._visibility = json.visibility;
}
```
**For `_zoneVisibility`:** `Space` currently has NO `toJSON()`/`fromJSON()` override at all (`grep -n "toJSON\|fromJSON" src/engine/element/space.ts` returns nothing) — it inherits the base `GameElement` implementation. The fix requires either (a) adding a `Space.toJSON()` override that calls `super.toJSON()` then adds `json.zoneVisibility = this._zoneVisibility` when set, with a matching static restore hook, or (b) since `GameElement.fromJSON` is a static factory that doesn't know about `Space`-specific fields, a post-construction restoration step keyed on `element instanceof Space`. Recommend option (a) with a small `ElementJSON` type extension (`zoneVisibility?: VisibilityState`), following `visibility`'s exact shape.

### Pattern 2: Attribute-level filtering inside `filterElement`'s "visible, normal" fallthrough
**What:** `Game.toJSONForPlayer`'s inner `filterElement` closure has 3 branches (count-only-hidden, individually-hidden, zone-hidden-children) that already redact — and one final fallthrough (game.ts ~2790-2806) that returns the element's full `json.attributes` unfiltered whenever the element itself is visible. This is the SEC-02 hook point.
**When to use:** Filtering non-owner-visible attributes off an otherwise-visible element.
**Example (current unfiltered fallthrough — the insertion point):**
```typescript
// Source: src/engine/element/game.ts ~2790-2806 (current, BEFORE fix)
// Filter children normally
const filteredChildren: ElementJSON[] = [];
if (json.children) {
  for (let i = 0; i < json.children.length; i++) {
    const childJson = json.children[i];
    const childElement = element._t.children[i];
    const filtered = filterElement(childJson, childElement);
    if (filtered) filteredChildren.push(filtered);
  }
}

return {
  ...json,
  children: filteredChildren.length > 0 ? filteredChildren : undefined,
  // ^ json.attributes here is NEVER filtered by visibleAttributes — this is the gap
};
```
`static visibleAttributes: string[] | undefined` is declared once (`game-element.ts:140`) and — confirmed via `grep -rn "static visibleAttributes" src/` — read nowhere else in the entire codebase. Insertion point: before the `return`, when `visibleAttributes !== undefined` AND the viewer is not the element's owner (`element.getEffectiveOwner()?.seat !== visibilityPosition`, mirroring the existing owner check at the zone-hidden branch), filter `json.attributes` down to the whitelisted keys. Public-by-default (undefined = all visible) per CONTEXT.md decision — do NOT flip default semantics.

### Pattern 3: Derive `state.players` from the already-filtered tree, not a raw second pass
**What:** `buildPlayerState` currently builds `fullPlayerData` via a completely separate, unfiltered pass over `runner.game.players` (raw `player.toJSON()`), parallel to and inconsistent with `truthView` (which IS `game.toJSONForPlayer(playerPosition)` and already walks Player elements through `filterElement` — Players are genuine children of `Game._t.children` via `this.create(PlayerClass, ...)` in the constructor, confirmed at game.ts:674).
**When to use:** This is the SEC-03 fix target.
**Example (current unfiltered code — to be replaced):**
```typescript
// Source: src/session/utils.ts ~236-260 (current, BEFORE fix)
const allPlayers = runner.game.players;
const fullPlayerData = allPlayers.map((player: any) => {
  if (typeof player.toJSON === 'function') {
    const json = player.toJSON() as unknown as { ...; attributes?: Record<string, unknown>; ... };
    const flattened = { ...json, ...(json.attributes || {}), seat: player.seat };
    delete flattened.attributes;
    return flattened;
  }
  return { name: player.name ?? `Player ${player.seat}`, seat: player.seat };
});
```
**Recommended direction:** Walk `truthView.children` (already computed two lines above at `utils.ts:212` as `const truthView = playerView.state;`) filtering for `className`/`$type === 'player'` nodes (or use the JSON shape already emitted by the filtered tree), and flatten those instead of re-deriving from raw `player.toJSON()`. This makes `state.players` inherit BOTH the existing element/zone visibility (`hideFromAll()` on a Player) AND the new `visibleAttributes` filtering (Pattern 2) for free — one mechanism, matching CONTEXT.md's explicit decision ("route through the same per-viewer visibility rules as the board view"). Verify `Player.toJSON()`'s override (`player.ts:326-333`, adds `_isCurrent`) is preserved through this path — it currently is, since `Player` is a normal tree child and goes through the same `element.toJSON()` → `filterElement` pipeline as any other element.

**Caution:** `truthView` for the "owner" perspective must still show a player's OWN full attributes even if `visibleAttributes` would otherwise hide them — verify `filterElement`'s owner check (`element.getEffectiveOwner()?.seat !== visibilityPosition`) correctly resolves a Player element's "owner" to itself (a Player is arguably its own owner) before wiring this up; this is the "Claude's Discretion" item CONTEXT.md flags re: composing `visibleAttributes` with `playerView`.

### Pattern 4: Handler re-binding at the `loadSerializedState` discard point
**What:** `Game.loadSerializedState` (game.ts:2848-2857 in current source — confirmed exact) does `this._t.children = []` then rebuilds via `GameElement.fromJSON`, discarding the constructor-built tree (and its `_eventHandlers`) entirely, before that tree is ever used elsewhere.
**When to use:** RST-01 fix — must run BEFORE the discard, capturing `(class, path-or-name) → handlers` from the about-to-be-discarded tree, then re-attaching by matching identity onto the freshly rebuilt tree AFTER `fromJSON` completes.
**Example (current discard point):**
```typescript
// Source: src/engine/element/game.ts:2848-2857 (current)
loadSerializedState(json: ReturnType<Game['toJSON']>): void {
  this.phase = json.phase;
  this.messages = json.messages;
  this.settings = json.settings;
  // ... animation events ...
  // Clear existing children and rebuild the tree from JSON
  this._t.children = [];           // <-- constructor tree discarded HERE
  if (json.children) {
    for (const childJson of json.children) {
      const child = GameElement.fromJSON(childJson, this._ctx, this._ctx.classRegistry);
      // ...
    }
  }
  // ...
}
```
**Recommended direction:** Before `this._t.children = []`, walk `this._t.children` (the live, about-to-be-discarded tree) collecting `Space` instances with non-empty `_eventHandlers`, keyed by a stable identity (per CONTEXT.md's discretion: class + tree path, or class + `name`). After the `fromJSON` rebuild loop completes, walk the NEW tree and re-attach matching handlers by the same identity key; `devWarn` (existing project convention — grep `devWarn` usage elsewhere in `game.ts`) for any captured handler that finds no match in the rebuilt tree. `Space._eventHandlers` is `private` (space.ts:106) — the re-binding code inside `Game.loadSerializedState` will need a same-module or class-exposed accessor (e.g. `internal` getter) rather than reaching into the private field from outside the class; check existing patterns for similar internal-but-cross-class access in this codebase (e.g. `_t` itself is accessed cross-class throughout, so a similar internal contract is idiomatic here).

### Pattern 5: `StoredGameState.teachingDisabled`/`displayName` mirroring `aiConfig`
**What:** `aiConfig` is written in `create()` (destructured from `GameSessionOptions.aiConfig`, ~game-session.ts:551) into `StoredGameState.aiConfig` (types.ts:222), and read back in `restore()` (`storedState.aiConfig ? new AIController(...)`, ~game-session.ts:823-824). `teachingDisabled` and `displayName` currently do NEITHER — they exist as `GameSessionOptions` fields (types.ts / game-session.ts:96,132; :318 constructor param) and as private instance fields (`#displayName`, `#teachingDisabled`, game-session.ts:232,305) but `StoredGameState` has NO corresponding field, and `restore()`'s signature (game-session.ts:758-765) has no parameter for either — the constructor call inside `restore()` passes `undefined` explicitly for both (game-session.ts:813, verified: `new GameSession(runner, storedState, GameClass, storage, aiController, undefined, lobbyManager, undefined, undefined, botAIConfig, undefined, onPersistenceError)` — the 6th arg is displayName, 11th is teachingDisabled).
**Example (the exact pattern to replicate):**
```typescript
// Source: src/session/types.ts:222 — existing template
aiConfig?: AIConfig;

// Source: src/session/game-session.ts ~823-824 — read-back template
const aiController = storedState.aiConfig
  ? new AIController(GameClass, storedState.gameType, storedState.playerCount, storedState.aiConfig, botAIConfig)
  : undefined;
```
**Fix:** Add `teachingDisabled?: boolean` and (separately, already-partially-tracked per CONTEXT.md) `displayName?: string` to `StoredGameState` (types.ts:195-242 interface block); write them in `create()` alongside where `aiConfig` is stored into `storedState`; read them in `restore()` and pass into the `GameSession` constructor instead of the current hardcoded `undefined`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Serializing a private "should survive round-trip" field | A parallel `Space`-specific storage/restore side-channel | `_visibility`'s existing `toJSON`/`fromJSON` special-case pattern (game-element.ts:793-795, 1025-1028) | Proven pattern already in the codebase for exactly this class of problem; using a second pattern for `_zoneVisibility` creates two ways to do the same thing, violating "single source of truth" |
| Per-viewer attribute redaction | A second filtering pass bolted onto `buildPlayerState` | The existing `filterElement` closure inside `Game.toJSONForPlayer` (game.ts ~2676-2807) | It's already the single per-viewer redaction chokepoint for elements; adding a parallel session-layer filter for Player attributes creates exactly the SEC-03 bug (two divergent views of "what's visible") that this phase is fixing |
| Debug-data opt-in switch | A new global env-var gate | A `GameSessionOptions.debugEnabled` constructor field, mirroring `teachingDisabled`'s existing shape (session-scoped, constructor-time, private field) | Session-scoped policy should live with other session-scoped policy (teachingDisabled precedent), not become a process-wide env flag that a host can't vary per session |

**Key insight:** Every fix in this phase has a same-file or same-module precedent already implemented for a sibling field (`_visibility` for `_zoneVisibility`; `aiConfig` for `teachingDisabled`/`displayName`; `chooseElements`' server-side min/max for `chooseFrom`'s missing enforcement, in a sibling phase). The engineering discipline here is "find the twin that already works, copy its shape" — not designing something new.

## Common Pitfalls

### Pitfall 1: Conflating the stateless `buildViews` path with the broadcast-hardcoded-true paths
**What goes wrong:** Assuming ALL `includeDebugData` sites need the same fix.
**Why it happens:** The audit's own F15 verdict initially claimed `buildViews`/`buildSpectatorView` in `stateless-ops.ts` also defaults to `true` "by omission" — but re-reading the current code shows `buildViews` (stateless-ops.ts:208-217) calls `buildPlayerState(runner, [], i + 1, { includeActionMetadata: true })` — it does NOT pass `includeDebugData` at all, and `buildPlayerState`'s check is `if (options?.includeDebugData)` (utils.ts:287, truthy check, not `!== false`) — so omitting the key means `customDebug` is correctly OMITTED already on the stateless/dev-host path. The audit's own verdict text for this finding self-corrects this exact point ("One auditor error: the stateless buildViews/buildSpectatorView path does NOT default to true").
**How to avoid:** The fix scope for SEC-04 is the 12 confirmed hardcoded-`true` call sites: `game-session.ts` (890, 903, 1386, 2120 — the actual `true` literals; 879/883/898 are JSDoc/default-param lines, not separate call sites), `pending-action-manager.ts` (226, 250, 355, 357), `state-history.ts` (321, 393 — note: audit cited only 321, but 393 has the identical hardcoded pattern and should be included). `stateless-ops.ts` needs NO change for this finding — confirm this in `131-FINDINGS-VERIFICATION.md` explicitly rather than assuming the audit's original (pre-verdict) claim.
**Warning signs:** A "fix" that touches `stateless-ops.ts` for SEC-04 is very likely fixing a non-bug; verify with a repro (call `buildViews`/`buildSpectatorView` with a game that has `registerDebug` data registered, confirm `customDebug` is absent from the result) before touching that file.

### Pitfall 2: `GameSessionOptions.debugEnabled` has no consumer in the `boardsmith dev` CLI today
**What goes wrong:** Assuming the dev host wiring for `debugEnabled` is a matter of finding where `boardsmith dev` calls `GameSession.create`/`.restore` and passing `debugEnabled: true`.
**Why it happens:** `boardsmith dev` (`src/cli/dev-host/`) does not use `GameSession` at all — confirmed via `grep -rln "GameSession.create\|GameSession.restore" src/cli/` returning zero matches. The dev host is built entirely on `SnapshotSessionHost` (`src/session/snapshot-session-host.ts`) via the stateless-ops functions, which (per Pitfall 1) already never surfaces `customDebug` in its player/spectator views.
**How to avoid:** `GameSessionOptions.debugEnabled` is for **`GameSession`-based hosts** (production platform hosts, or any external consumer using `GameSession.create`/`.restore` directly — e.g. a hypothetical ShufflewickPub-style deployment) — not for `boardsmith dev`. The plan should either (a) scope the "dev host sets it" language in CONTEXT.md down to "no dev-host code change is needed, only document that `SnapshotSessionHost` never surfaces debug data and `GameSessionOptions.debugEnabled` is the knob for `GameSession` consumers," or (b) if debug-panel-in-dev-host functionality is desired later, that's out of scope for this phase (no such feature exists today to preserve). Recommend (a) — confirm with the user/planner since this narrows a CONTEXT.md decision slightly.
**Warning signs:** Any plan task that says "wire `debugEnabled` into `boardsmith dev`'s `SnapshotSessionHost` call" is solving a problem that doesn't exist in the current architecture — verify first.

### Pitfall 3: `Space._eventHandlers` is `private` — re-binding code needs a same-class or new internal accessor
**What goes wrong:** Writing re-binding logic in `game.ts`'s `loadSerializedState` that tries to read `space._eventHandlers` directly and hits a TypeScript private-field compile error.
**Why it happens:** `_eventHandlers` is declared `private` on `Space` (space.ts:106-109), and `loadSerializedState` lives on `Game`, a different class.
**How to avoid:** Add an internal (non-`private`, but not part of the public JSDoc-documented API — mirror the `_t` convention used throughout this codebase for cross-class-but-internal tree access) accessor on `Space`, e.g. a package-internal getter, OR do the re-binding inside `space.ts` itself via a method `Space` exposes and `Game.loadSerializedState` calls per-space during the rebuild walk.
**Warning signs:** A TypeScript compile error `Property '_eventHandlers' is private and only accessible within class 'Space'` during implementation — expected; resolve by adding a scoped accessor, not by making the field non-private wholesale (would leak it into the public API surface, which `unserializableAttributes` — a public static array read by generic serialization code — deliberately keeps opaque).

### Pitfall 4: `Player` "owning" its own attributes for `visibleAttributes` filtering purposes
**What goes wrong:** Implementing SEC-02's owner check (`element.getEffectiveOwner()?.seat !== visibilityPosition`) verbatim for `Player` elements and finding that a Player's own client can't see its own `visibleAttributes`-restricted attributes, because `getEffectiveOwner()` walks `_t.parent?.getEffectiveOwner()` (game-element.ts:709-711) and a top-level `Player` (parented directly under `Game`) has no ancestor Space to establish ownership — `getEffectiveOwner()` would return `undefined` for a Player itself, and `undefined?.seat !== visibilityPosition` is always `true` (looks like "not the owner" to everyone, including the player themself).
**Why it happens:** `getEffectiveOwner()`'s recursive walk is designed for board elements sitting inside owner-scoped zones (a card inside a Hand whose zone visibility is `'owner'`), not for `Player` elements which conceptually own themselves.
**How to avoid:** When implementing the owner check for `visibleAttributes` filtering, special-case `element instanceof Player` to compare `element.seat === visibilityPosition` directly (a Player owns itself), falling back to `getEffectiveOwner()?.seat === visibilityPosition` for non-Player elements. Cover this with an explicit unit test (`static visibleAttributes = ['secretRole']` on a Player subclass; assert the OWNING seat's view still shows `secretRole`, all other seats/spectators don't).
**Warning signs:** A regression test where a player can't see their own restricted-but-owned attribute in their own view.

## Runtime State Inventory

Not applicable — this is a bug-fix phase within a single codebase (not a rename/refactor/migration across systems). No datastores, live-service configs, OS-registered state, secrets, or build artifacts are touched. All 7 findings are pure code-logic fixes (serialization, filtering, restore) within `src/engine/` and `src/session/`; the only "state" involved is in-memory game snapshots/JSON payloads, fully covered by the Code Examples and regression-test guidance above.

## Code Examples

### Verified restore-path enumeration (for PROC-01/RST regression test coverage)
All 5 restore paths funnel through the SAME primitive, `GameRunner.fromSnapshot` (runner.ts:535-598) — confirmed via repo-wide grep:
```
1. GameSession.restore()                    → game-session.ts:785  → GameRunner.fromSnapshot(storedState.snapshot, GameClass)
2. StateHistory.undoToTurnStart              → state-history.ts:106,362 (comment) — shares "the single restore primitive"
3. StateHistory rewind (getStateAtAction)    → GameRunner.fromCheckpoint → internally calls GameRunner.fromSnapshot (runner.ts ~605-635)
4. Stateless ops (SnapshotSessionHost path)  → stateless-ops.ts:798 → GameRunner.fromSnapshot(...)
5. Direct test/tooling use                   → runner.test.ts, tutorial-serialization.test.ts, restore-snapshot-authoritative.test.ts — existing round-trip test patterns to extend
```
Existing regression test template (session persistence, byte-identity style) already in the repo:
```typescript
// Source: src/session/tutorial-serialization.test.ts:120 (existing pattern to mirror)
it('survives runner.getSnapshot() → GameRunner.fromSnapshot() byte-identically', () => {
  const snapshotJson = JSON.parse(JSON.stringify(runner.getSnapshot()));
  const restored = GameRunner.fromSnapshot<TutorialGame>(snapshotJson, TutorialGame);
  // ... assert equality ...
});
```
Existing engine round-trip visibility test template:
```typescript
// Source: src/engine/element/deck-hand-visibility.test.ts:1-20 (existing pattern to extend with restore)
// Regression test for audit finding F32: Deck and Hand must be secure-by-default...
describe('Deck/Hand secure-by-default visibility (F32)', () => {
  it('hides a fresh Deck contents from non-owner in per-player snapshot', () => {
    const view = game.toJSONForPlayer(2);
    // ... assert __hidden ...
  });
});
```
**Recommended new test file placement (per CONTEXT.md's explicit instruction):** engine-side round-trip tests alongside `deck-hand-visibility.test.ts` in `src/engine/element/` (e.g. `zone-visibility-restore.test.ts`); session-side persistence tests in `src/session/` (e.g. extend `restore-snapshot-authoritative.test.ts` or add `debug-data-gating.test.ts` / `teaching-disabled-persistence.test.ts`).

### `includeDebugData` — exact current call sites (verified against current line numbers, 2026-07-02)
```
src/session/game-session.ts:890   → { includeActionMetadata: options?.includeActionMetadata ?? true, includeDebugData: options?.includeDebugData ?? true }
src/session/game-session.ts:903   → same pattern (buildPlayerState public method)
src/session/game-session.ts:1386  → { includeActionMetadata: true, includeDebugData: true }
src/session/game-session.ts:2120  → { includeActionMetadata: true, includeDebugData: true }  (broadcast())
src/session/pending-action-manager.ts:226 → { includeActionMetadata: true, includeDebugData: true }
src/session/pending-action-manager.ts:250 → same
src/session/pending-action-manager.ts:355 → same
src/session/pending-action-manager.ts:357 → same
src/session/state-history.ts:321  → { includeActionMetadata: true, includeDebugData: true }
src/session/state-history.ts:393  → same pattern (audit cited only :321 — verify :393 too during PROC-01)
```
`stateless-ops.ts` (`buildViews`/`buildSpectatorView`) requires **no change** — confirmed it never passes `includeDebugData` (see Pitfall 1).

## State of the Art

Not applicable in the traditional "old library API vs new library API" sense — this is a same-codebase before/after fix. The relevant "old → new" shifts are:

| Old Approach (current bug) | New Approach (this phase) | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `_zoneVisibility` unserialized, discarded on every restore | Serialized like `_visibility` (explicit-only), restored in `fromJSON` | This phase (SEC-01) | Zone-hidden hands/decks stay hidden across undo/rewind/restore |
| `static visibleAttributes` declared, never read | Consulted in `filterElement`'s visible-element fallthrough | This phase (SEC-02) | Attribute-level secrecy on visible elements actually works |
| `state.players` built from raw unfiltered `player.toJSON()` | Derived from the already-filtered `truthView` tree | This phase (SEC-03) | Player secrets stop leaking to all seats/spectators |
| `_eventHandlers` silently dropped on restore | Captured before tree discard, re-bound by stable identity after rebuild | This phase (RST-01) | `onEnter`/`onExit` game logic survives undo/restore |
| `teachingDisabled`/`displayName` constructor-only, lost on restore | Persisted in `StoredGameState`, threaded through `restore()` | This phase (RST-02) | Anti-cheat lockout survives server restart/DO eviction |
| `includeDebugData` hardcoded `true` at 10 session call sites | Defaults `false`; explicit `GameSessionOptions.debugEnabled` opt-in for `GameSession` consumers | This phase (SEC-04) | Debug payloads don't leak to production players by default |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Best re-binding identity key for `onEnter`/`onExit` handlers is "class + tree path or name" (per CONTEXT.md's explicit discretion grant — no single scheme mandated) | Pattern 4 | If the chosen key isn't stable across a tree-shape change mid-game (e.g. dynamic space creation order differs after restore vs. live), handlers silently fail to re-bind even with the fix in place — the `devWarn` fallback mitigates but doesn't eliminate this |
| A2 | `Space._eventHandlers` needs a new internal (non-private) accessor rather than moving the re-bind logic into `space.ts` itself | Pitfall 3 | Both are viable; if the planner chooses the alternative (logic lives in `space.ts`, `Game.loadSerializedState` just calls a method), the accessor isn't needed — flag as an open implementation choice, not a blocking assumption |
| A3 | `GameSessionOptions.debugEnabled` has zero current consumer in `boardsmith dev` and needs no CLI-side wiring in this phase | Pitfall 2 | If the user actually wants a dev-host debug-panel-visible-in-multiplayer-preview feature added as part of this phase (not just "gate production"), that's new scope beyond fixing F15 — needs explicit confirmation, not assumed in scope |
| A4 | `Player` should be treated as "owning itself" for `visibleAttributes` filtering purposes (Pitfall 4) — not explicitly stated anywhere in code or docs today, since the feature doesn't work at all currently | Pattern 2, Pitfall 4 | If implemented naively (reusing `getEffectiveOwner()` unmodified), a player could lose visibility into their OWN restricted attributes — a functional regression more severe than the current no-op state, so this must be explicitly tested, not assumed correct by inspection |

**None of the above concern package names, retention policies, or compliance requirements** — this is internal engine logic; risk is confined to correctness of the fix design, not to unverified external facts.

## Open Questions

1. **Does `GameSessionOptions.debugEnabled` need any `boardsmith dev` CLI wiring in this phase, or is it purely a `GameSession`-consumer-facing API addition?**
   - What we know: `boardsmith dev` uses `SnapshotSessionHost`/stateless-ops exclusively, which never surfaces `customDebug` regardless of this phase's fix (Pitfall 1/2).
   - What's unclear: Whether CONTEXT.md's "the dev host sets it" phrasing implies a desired NEW dev-host debug-panel feature, or is simply describing the eventual consumer-side intent loosely.
   - Recommendation: Planner should scope this narrowly — add the `GameSessionOptions.debugEnabled` field and thread it through `GameSession`'s internal call sites (replacing hardcoded `true`s) with default `false`; do NOT add new `boardsmith dev` CLI functionality unless the user confirms that's in scope. Document the narrowing explicitly in the plan.

2. **Exact `ElementJSON` type extension shape for `zoneVisibility`.**
   - What we know: `_visibility`'s serialized shape is `json.visibility = this._visibility` (a `VisibilityState` object) — an exact analog exists to copy.
   - What's unclear: Whether `zoneVisibility` should be a new top-level `ElementJSON` field (mirroring `visibility`) or nested differently; also whether `Space`-only fields on the shared `ElementJSON` type require a type-safety adjustment (currently `visibility` is presumably defined on the base `ElementJSON` interface even though only some elements populate it — same approach should work for `zoneVisibility`).
   - Recommendation: Confirm `ElementJSON`'s current definition (likely in `src/engine/element/types.ts` or similar) during planning/execution; add `zoneVisibility?: VisibilityState` there, matching `visibility`'s optionality pattern.

## Environment Availability

Not applicable — this phase has no external tool/service/runtime dependencies beyond the existing Node.js/TypeScript/Vitest toolchain already configured and working in this repo (confirmed via `vitest.config.ts` and `package.json`'s existing `test` script). No new environment setup is required.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via `vitest.config.ts`, confirmed present and configured) |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` |
| Quick run command | `npx vitest run src/engine/element/<new-test-file>.test.ts` (or `src/session/<new-test-file>.test.ts`) |
| Full suite command | `npm run test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | `_zoneVisibility` survives all 5 restore paths; `toJSONForPlayer(opponent)` byte-identical before/after | unit (engine) | `npx vitest run src/engine/element/zone-visibility-restore.test.ts` | ❌ Wave 0 — new file |
| SEC-02 | `static visibleAttributes` filters non-listed attrs from non-owners; owner still sees own attrs | unit (engine) | `npx vitest run src/engine/element/visible-attributes.test.ts` | ❌ Wave 0 — new file |
| SEC-03 | `state.players` filtered per-viewer, matches `view`'s Player nodes | unit (session) | `npx vitest run src/session/player-state-visibility.test.ts` | ❌ Wave 0 — new file |
| SEC-04 | `includeDebugData` defaults false at all 10 confirmed call sites; `debugEnabled` opt-in works | unit (session) | `npx vitest run src/session/debug-data-gating.test.ts` | ❌ Wave 0 — new file |
| RST-01 | `onEnter`/`onExit` handlers fire after restore | unit (engine) | `npx vitest run src/engine/element/handler-restore.test.ts` | ❌ Wave 0 — new file |
| RST-02 | `teachingDisabled`/`displayName` persist across `GameSession.restore()` | unit (session) | `npx vitest run src/session/teaching-disabled-persistence.test.ts` | ❌ Wave 0 — new file (or extend `restore-snapshot-authoritative.test.ts`) |
| PROC-01 | Every finding independently re-verified before fix | process (manual + trace) | N/A — produces `131-FINDINGS-VERIFICATION.md`, not an automated test | ❌ Wave 0 — new doc |
| PROC-02 | Every fix has a red-then-green regression test | process (enforced by above test files' existence + git history showing failing-then-passing) | N/A — verified via SUMMARY documentation per finding | — |

### Sampling Rate
- **Per task commit:** targeted `npx vitest run <file>` for the file(s) touched
- **Per wave merge:** `npm run test` (full suite) — this phase touches core engine serialization, so full-suite regression risk is HIGH; do not skip
- **Phase gate:** Full suite green before `/gsd:verify-work`, PLUS `npm run audit` (dead-code/duplication per CLAUDE.md) since this phase adds several near-identical filtering code paths (attribute filtering composing with existing zone/element filtering) that are prone to duplication

### Wave 0 Gaps
- [ ] `src/engine/element/zone-visibility-restore.test.ts` — covers SEC-01, all 5 restore paths
- [ ] `src/engine/element/visible-attributes.test.ts` — covers SEC-02, including the Pitfall 4 owner-self-visibility case
- [ ] `src/session/player-state-visibility.test.ts` — covers SEC-03
- [ ] `src/session/debug-data-gating.test.ts` — covers SEC-04, all 10 call sites
- [ ] `src/engine/element/handler-restore.test.ts` — covers RST-01
- [ ] `src/session/teaching-disabled-persistence.test.ts` (or extension of `restore-snapshot-authoritative.test.ts`) — covers RST-02
- [ ] `.planning/phases/131-serialization-restore-fidelity/131-FINDINGS-VERIFICATION.md` — PROC-01 verdicts, one per finding, written BEFORE fixes

No test framework installation needed — Vitest is already fully configured; only new test files are needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Not touched by this phase (session auth is out of scope) |
| V3 Session Management | yes | `GameSession.restore()`/`StoredGameState` persistence — RST-02's `teachingDisabled` anti-cheat lockout is a session-integrity control that must survive session restore |
| V4 Access Control | yes | SEC-01/02/03 are all per-viewer access-control-to-data-not-to-endpoints (hidden information / attribute visibility / player-state redaction) |
| V5 Input Validation | no | Not touched — no new user input surfaces are introduced by this phase |
| V6 Cryptography | no | Not applicable — no crypto/secrets handling in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hidden-information leak via unserialized zone visibility surviving restore (F1/F7) | Information Disclosure | Serialize `_zoneVisibility` explicitly (Pattern 1); regression tests asserting `toJSONForPlayer(opponent)` byte-identity across every restore path |
| Attribute-level secret leak via unimplemented `visibleAttributes` (F2) | Information Disclosure | Implement the filter (Pattern 2); do not silently document a no-op security control (per project's own DOCX-04/Pit-of-Success rule — a fake security control is worse than none, since it creates false confidence) |
| Player-state broadcast bypassing all visibility (F8) | Information Disclosure | Route `state.players` through the same filtered tree as `view` (Pattern 3), eliminating the parallel unfiltered channel |
| Debug data broadcast to all players/spectators by default (F15) | Information Disclosure | Default `includeDebugData` to `false`; explicit opt-in only for trusted `GameSession` consumers (Pattern 5-adjacent) |
| Anti-cheat lockout (`teachingDisabled`) silently reset on session restore (F16) | Elevation of Privilege (players regain hint/heatmap/demo access the host explicitly locked out) | Persist in `StoredGameState`, thread through `restore()` (Pattern 5) |

## Sources

### Primary (HIGH confidence — direct code reads in this session, 2026-07-02)
- `/Users/jtsmith/BoardSmith/src/engine/element/space.ts` (lines 90-230) — `_zoneVisibility`, `_eventHandlers`, `unserializableAttributes`, `onEnter`/`onExit`
- `/Users/jtsmith/BoardSmith/src/engine/element/game-element.ts` (lines 140, 760-830, 990-1040) — `visibleAttributes` declaration, `toJSON`/`fromJSON` visibility special-case
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` (lines 660-690, 1950-1965, 2660-2870) — player creation, `players` getter, `toJSONForPlayer`/`filterElement`, `loadSerializedState`
- `/Users/jtsmith/BoardSmith/src/engine/player/player.ts` (lines 320-345) — `Player.toJSON()` override
- `/Users/jtsmith/BoardSmith/src/runtime/runner.ts` (lines 455-635) — `GameRunner.fromSnapshot`, `fromCheckpoint`, `getPlayerView`
- `/Users/jtsmith/BoardSmith/src/engine/utils/snapshot.ts` (lines 125-260) — `createPlayerView`/`createAllPlayerViews`
- `/Users/jtsmith/BoardSmith/src/session/utils.ts` (lines 200-300) — `buildPlayerState`, `fullPlayerData` construction
- `/Users/jtsmith/BoardSmith/src/session/game-session.ts` (lines 60-140, 520-560, 750-835, 879-905, 1386, 2120) — `GameSessionOptions`, `create()`, `restore()`, `includeDebugData` call sites
- `/Users/jtsmith/BoardSmith/src/session/stateless-ops.ts` (lines 195-235) — `buildViews`/`buildSpectatorView`
- `/Users/jtsmith/BoardSmith/src/session/pending-action-manager.ts`, `state-history.ts` — `includeDebugData` call sites (grep-verified)
- `/Users/jtsmith/BoardSmith/src/session/types.ts` (lines 195-245) — `StoredGameState` interface
- `/Users/jtsmith/BoardSmith/src/session/snapshot-session-host.ts`, `src/cli/dev-host/*.ts` — confirmed no `GameSession` usage in dev host
- `/Users/jtsmith/BoardSmith/src/engine/element/deck-hand-visibility.test.ts`, `src/session/tutorial-serialization.test.ts`, `src/session/restore-snapshot-authoritative.test.ts` — existing test patterns to mirror
- `/Users/jtsmith/BoardSmith/.planning/tmp/v4.5-audit-findings.json` — F1, F2, F7, F8, F10, F15, F16 full audit text + verdicts (source: `boardsmith-audit-report-3.html`)
- `/Users/jtsmith/BoardSmith/.planning/phases/131-serialization-restore-fidelity/131-CONTEXT.md` — locked decisions
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md`, `.planning/STATE.md` — requirement definitions and roadmap context

### Secondary (MEDIUM confidence)
None — this phase required no external/web research; it is entirely internal-codebase investigation.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no external stack; internal fixes only
- Architecture: HIGH — every claim traced to current file:line via direct `Read`/`grep`/`sed` against the live repository, not from audit text alone
- Pitfalls: HIGH — Pitfall 1 and 2 are NEW findings from this research session (not in the original audit), directly contradicting a literal reading of CONTEXT.md's "dev host sets it" framing; flagged for planner attention
- Security domain: HIGH — all 5 findings in scope are Information-Disclosure/Elevation-of-Privilege patterns with concrete, already-traced fix locations

**Research date:** 2026-07-02
**Valid until:** Effectively unlimited for the architectural facts (internal codebase, not external library) — but re-verify exact line numbers immediately before writing PLAN.md tasks, since this is an actively-developed repo and lines may drift with any intervening commit (none expected between now and plan-phase in the same session, but flag if execution is delayed).
