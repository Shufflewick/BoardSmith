# Phase 131: Serialization & Restore Fidelity - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Hidden information, per-player state, debug data, and host lockouts all remain correct and secure across every snapshot restore path (undo, rewind, `GameSession.restore`, `GameRunner.fromSnapshot`, stateless ops) — not just in a live, never-restored game.

Covers audit findings F1, F2, F7, F8, F10, F15, F16 (requirements PROC-01, PROC-02, SEC-01..04, RST-01/02). Scope: `src/engine/element/` (Space/GameElement serialization, onEnter/onExit handlers) + `src/session/` (`utils.ts` buildPlayerState, `game-session.ts` restore/broadcast, registerDebug gating, teachingDisabled persistence).

</domain>

<decisions>
## Implementation Decisions

### Zone Visibility Restore Fidelity (F1/F7 — SEC-01)
- Fix mechanism: **serialize `_zoneVisibility`** — remove it from `Space.unserializableAttributes`, emit in `Space.toJSON()`, restore in `fromJSON` — exactly like element-level `_visibility` already works. It's plain data (mode + player lists). This automatically covers runtime visibility changes (e.g. cribbage crib re-hide at flow.ts:222).
- Regression test coverage: **all restore paths** — undo, rewind, `GameSession.restore`, `GameRunner.fromSnapshot`, stateless ops — each asserting `toJSONForPlayer(opponent)` byte-identical before/after restore.
- The existing spectator-view special-case patch in `stateless-ops.ts` (`buildSpectatorView`): **unify** — once serialization is authoritative, remove the special-case workaround so there is one mechanism.
- Extend the hidden-attrs/visibility regression sweep to run against a **restored** game, not only a live one.

### Attribute Filtering — visibleAttributes & state.players (F2/F8 — SEC-02/03)
- `static visibleAttributes`: **implement it** — filter non-listed attributes from non-owners in `toJSONForPlayer`. Attribute-level filtering is a real gap (zone/element visibility hides whole elements only), and the same mechanism cleanly serves the F8 Player fix.
- `state.players`: **route through the same per-viewer visibility rules as the board view** — honor `isVisibleTo` and `visibleAttributes` on Player; Player-child elements filtered like any board element.
- Default semantics for custom Player attributes: **public by default** (matches current JSDoc "undefined = all visible"; keeps go-fish `bookCount` working) — secrecy is opt-in via `visibleAttributes`.
- Spectators: **most restrictive view** — treated as non-owner of everything.

### Restore Amnesia & Debug Gating (F10/F15/F16 — SEC-04, RST-01/02)
- `onEnter`/`onExit` handlers lost on restore: **re-bind from the constructor-built tree** — before `loadSerializedState` discards the fresh constructor tree, capture registered handlers and re-attach them to rebuilt elements by stable identity (class + path/name); dev-warn on unmatched handlers. No game-code changes required.
- `teachingDisabled`: **persist in `StoredGameState`** (written by `create()`, read by `restore()`) exactly like `aiConfig` already is. Also fix `displayName`, which drops via the same mechanism.
- `registerDebug()` broadcast: **explicit opt-in** — default `includeDebugData` to `false` everywhere (broadcast, buildPlayerState, pending-action-manager, state-history, stateless buildViews); add `GameSessionOptions.debugEnabled` that the dev host sets and production hosts never do.
- Docs modeling hidden-state dumps into `registerDebug` (game.ts JSDoc, docs/common-pitfalls.md): **fix in this phase** per DOCX-04 same-phase doc rule.

### Verification & Testing Discipline (PROC-01/02)
- Verdicts live in a per-phase **`131-FINDINGS-VERIFICATION.md`** in the phase dir — one entry per finding (F1, F2, F7, F8, F10, F15, F16) with LEGITIMATE/REJECTED verdict + repro or file:line trace, written BEFORE any fix.
- Regression tests proven **red-then-green in execution order** — write the failing test first, record the failure output in the SUMMARY, then fix.
- Restore-fidelity assertions use **`JSON.stringify(toJSONForPlayer(opponent))` strict equality** before vs after each restore path.
- Test placement **follows existing patterns** — engine round-trip tests alongside existing visibility suites (e.g. `deck-hand-visibility.test.ts` style) in `src/engine/`; session persistence tests in `src/session/`.

### Claude's Discretion
- Exact identity-matching scheme for handler re-binding (class + branch path vs name) — pick whatever is stable across serialization round-trips; dev-warn loudly on any handler that can't be re-attached.
- Whether `visibleAttributes` filtering composes with `playerView` escape hatch — keep behavior coherent and documented.
- Naming/shape of `GameSessionOptions.debugEnabled` plumbing through dev host.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Element-level `_visibility` serialization is the proven template: `GameElement.unserializableAttributes` excludes `_visibility` but `toJSON` emits `json.visibility` when explicit (game-element.ts:794 area) — mirror this for `_zoneVisibility`.
- `StoredGameState.aiConfig` (src/session/types.ts:222) is the template for persisting `teachingDisabled`.
- Existing visibility test suites (deck-hand-visibility style) to extend with restore round-trips.

### Established Patterns
- `Space.unserializableAttributes` (space.ts:114-118) currently lists `_eventHandlers` and `_zoneVisibility` — `_zoneVisibility` comes out, `_eventHandlers` stays (closures) and is handled by re-binding.
- `includeDebugData` defaults to `true` at ~8 call sites: game-session.ts:879/883/890/898/903/1386/2120, pending-action-manager.ts:226/250/355, state-history.ts:321, and stateless-ops.ts buildViews/buildSpectatorView (default by omission). All must flip to opt-in.
- `GameSessionOptions.teachingDisabled` exists (types.ts:518-526) but is constructor-only; `StoredGameState` (types.ts:195-242) has no field for it.
- stateless-ops.ts `buildSpectatorView` contains a comment acknowledging zone visibility is not serialized — the existing partial patch to unify/remove.

### Integration Points
- `Game.loadSerializedState` (game.ts:2848-2857) — discards constructor tree (`this._t.children = []`) and rebuilds via `fromJSON`; the hook point for handler re-binding.
- `GameRunner.fromSnapshot` (runner.ts:567 area) — the single sanctioned restore chokepoint used by undo/rewind/restore/stateless ops.
- `buildPlayerState` (src/session/utils.ts:237) — builds `state.players` from raw `player.toJSON()`; must route through per-viewer filtering.
- `GameSession.broadcast()` (game-session.ts:2120) — hardcodes `includeDebugData: true`.

</code_context>

<specifics>
## Specific Ideas

- SEC-01 success bar is byte-identical `toJSONForPlayer(opponent)` before/after restore — including visibility changed at runtime mid-game.
- Per the milestone's No Backward Compatibility rule, clean breaks are fine (e.g. `includeDebugData` default flip); migration notes land with cross-repo Phase 138.
- Verify-first: each of the 7 findings gets an independent re-verification (repro or trace) recorded in 131-FINDINGS-VERIFICATION.md before its fix is planned/written. A finding failing re-verification gets a documented REJECTED verdict instead of a fix.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
