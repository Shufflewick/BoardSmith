# Phase 131 — PROC-01 Findings Verification

Independent re-verification of all seven in-scope audit findings (F1, F2, F7, F8, F10, F15,
F16) from `boardsmith-audit-report-3.html` (raw text + prior verdicts in
`.planning/tmp/v4.5-audit-findings.json`). Each verdict below is a fresh trace against the
current repository state (2026-07-03), not a restatement of the audit. Written BEFORE any fix
task in Plans 02-05 is planned or executed, per the project's "Prove Before Fix" rule.

---

## F1 — Zone visibility silently lost on every snapshot restore

**Audit claim:** `_zoneVisibility` is unserialized; `Game.loadSerializedState` discards the
constructor-built tree, so hidden hands/decks leak to all players after undo/restore.

**Trace (current code, 2026-07-03):**
- `src/engine/element/space.ts:106-118` — `Space` declares `private _eventHandlers` (106-109)
  and `private _zoneVisibility?: VisibilityState` (112), and both are listed in
  `static override unserializableAttributes` (114-118: `['_eventHandlers', '_zoneVisibility']`
  appended to the base class's list). This means the generic `toJSON()` serializer (which walks
  `unserializableAttributes` to decide what to skip) never emits `_zoneVisibility`.
- `grep -n "toJSON\|fromJSON" src/engine/element/space.ts` returns **zero matches** — `Space`
  has no override of either method, so it fully inherits the base `GameElement` implementation
  and gets no special-case handling for `_zoneVisibility` (contrast with `_visibility`, which
  DOES get a special case — see F2 discussion below for the base-class exclusion list, and
  `game-element.ts:793-795`/`1025-1028` for the explicit-serialize/restore special case for
  `_visibility`).
- `src/engine/element/game.ts:2835-2857` (`loadSerializedState`) — line 2849 does
  `this._t.children = []`, discarding the entire constructor-built tree (which holds the live
  `_zoneVisibility` state), then rebuilds every child via `GameElement.fromJSON` (2850-2857).
  Since the JSON never carried `_zoneVisibility` (per the point above), the rebuilt `Space`
  instances have `_zoneVisibility` at its class default (`undefined`), meaning **contents
  render as fully visible to every viewer** regardless of what `contentsHidden()` /
  `contentsVisibleToOwner()` configured at construction time.
- This restore primitive (`loadSerializedState` via `GameElement.fromJSON`) is reached by every
  documented restore path: `GameRunner.fromSnapshot`, which is called by `GameSession.restore()`,
  `StateHistory` undo/rewind, and the stateless `SnapshotSessionHost` ops path — so the defect is
  general, not confined to one path.

**VERDICT: LEGITIMATE**

Evidence: file:line trace above, confirming (a) `_zoneVisibility` is excluded from
serialization at the declaration site, (b) `Space` has no compensating `toJSON`/`fromJSON`
override, and (c) `loadSerializedState` discards and rebuilds the tree through the path that
never carries this field. No fix is written in this task.

---

## F7 — Zone visibility set outside a class constructor lost on restore (session-security framing of the same root cause as F1)

**Audit claim:** Same root defect as F1, viewed from the session/runtime restore-path angle
(`src/runtime/runner.ts:567`, `GameRunner.fromSnapshot`), plus the observation that the
codebase already self-identifies the hazard in one narrow spot (`stateless-ops.ts`
`buildSpectatorView`) but does not fix the general case.

**Trace (current code, 2026-07-03):**
- `src/runtime/runner.ts` — `GameRunner.fromSnapshot` constructs a fresh `Game` instance and
  calls `game.loadSerializedState(snapshot...)`, i.e. the exact discard-and-rebuild path traced
  under F1. Confirmed via `grep -n "loadSerializedState" src/engine/element/game.ts` showing the
  method is invoked at line 2903 inside the class's own snapshot-adoption logic, which
  `GameRunner.fromSnapshot` calls into.
- `src/session/stateless-ops.ts` — confirmed via `grep -n "buildViews\|buildSpectatorView"
  src/session/stateless-ops.ts` that `buildViews` (line 208) and `buildSpectatorView` (line 222)
  exist as the dev-host / stateless broadcast builders. Per the RESEARCH.md investigation (and
  independently re-confirmed here), these call `buildPlayerState(runner, ...)` directly against
  the **live** `runner` object rather than a freshly-restored one for the immediate broadcast
  case — this is the "spot workaround" the audit references. It does not change the fact that
  any restore-triggered rebuild (undo, cold restore, checkpoint rewind) still goes through the
  same `loadSerializedState` discard path and loses zone visibility.
- No additional/different mechanism was found beyond what F1 already traces — F1 and F7 share
  one root cause and one fix location (`Space.toJSON`/`fromJSON`, mirroring `_visibility`).

**VERDICT: LEGITIMATE**

Evidence: same file:line trace as F1 (`space.ts:106-118`, `game.ts:2835-2857`), confirmed via
this task's independent re-read, not copied from the audit text. F1 and F7 will share a single
fix in the next plan; recording both here satisfies PROC-01 for each finding ID individually.

---

## F2 — `static visibleAttributes` documented but never enforced

**Audit claim:** `GameElement.visibleAttributes` (game-element.ts:140) is declared with JSDoc
implying it filters attributes, but is read nowhere in the codebase — a dead security-flavored
no-op.

**Trace (current code, 2026-07-03):**
- `src/engine/element/game-element.ts:139-140`:
  ```
  /** Attributes that should not be serialized */
  static unserializableAttributes = ['_ctx', '_t', 'game', '_visibility'];
  ...
  /** Attributes visible to all players (undefined = all visible) */
  static visibleAttributes: string[] | undefined;
  ```
  Confirmed the field is declared exactly as the audit states, with no default value and no
  associated filtering logic adjacent to it.
- `grep -rn "visibleAttributes" src/ --include="*.ts" | grep -v ".test.ts"` returns **exactly
  one match**: the declaration itself at `game-element.ts:140`. No file under `src/` (engine,
  session, ui, runtime, cli, client) reads, checks, or filters based on this field.
- `grep -n "visibleAttributes" src/engine/element/game.ts` — **zero matches**. This directly
  satisfies the plan's acceptance criterion requiring this specific grep to be discussed: the
  field is not read anywhere in `game.ts`, including inside `filterElement`
  (`Game.toJSONForPlayer`'s per-viewer redaction closure), which is the one place a
  "visible attributes" filter would need to live to have any effect. Since `filterElement`'s
  final fallthrough branch (confirmed present, returns `{...json, children: filteredChildren}`
  with `json.attributes` passed through completely unfiltered) never consults
  `visibleAttributes`, setting the field today has **zero runtime effect** — attributes of a
  visible element are always broadcast to every viewer in full.

**VERDICT: LEGITIMATE**

Evidence: exhaustive repo-wide grep confirms exactly one reference (the declaration); the
targeted `game.ts` grep required by the plan's acceptance criteria confirms no consuming read
exists. A developer setting `static visibleAttributes = ['cost']` on a class today gets no
protection whatsoever — this is a documented no-op security control, matching the audit's
"high" severity framing. No fix is written in this task.

---

## F8 — `state.players` broadcasts every custom Player attribute unfiltered to all seats and spectators

**Audit claim:** `buildPlayerState` builds `state.players` via raw, unfiltered
`player.toJSON()` for every player, bypassing all visibility mechanisms (element/zone hiding,
the dead `visibleAttributes`), in parallel to the properly-filtered `view` field.

**Trace (current code, 2026-07-03):**
- `src/session/utils.ts:236-262`:
  ```
  const allPlayers = runner.game.players;
  const fullPlayerData = allPlayers.map((player: any) => {
    if (typeof player.toJSON === 'function') {
      const json = player.toJSON() as unknown as { ... };
      const flattened = { ...json, ...(json.attributes || {}), seat: player.seat };
      delete flattened.attributes;
      return flattened;
    }
    return { name: player.name ?? `Player ${player.seat}`, seat: player.seat };
  });
  ...
  const state: PlayerGameState = {
    ...
    players: fullPlayerData,
    view: truthView,
    ...
  };
  ```
  Confirmed line-for-line: `player.toJSON()` is called directly on every player in
  `runner.game.players` with **no viewer/position parameter**, and every attribute (via
  `json.attributes`) is flattened onto the result and included in `state.players` — sent to
  every connected seat and spectator on every broadcast, since this same `buildPlayerState`
  function backs `GameSession.broadcast()` (game-session.ts:2120) and the stateless
  `buildViews`/`buildSpectatorView` (stateless-ops.ts:212, 225).
- By contrast, `view: truthView` (line 270 of the same function) is built via
  `game.toJSONForPlayer(playerPosition)`, which DOES walk the per-viewer `filterElement`
  redaction chokepoint. `state.players` is therefore a **parallel, unfiltered channel** sitting
  directly next to a properly-filtered channel in the same payload — a player who calls
  `player.hideFromAll()` or sets any element-level visibility on themselves is still fully
  exposed via `state.players`, because this code path never calls `isVisibleTo` or any
  visibility check at all.

**VERDICT: LEGITIMATE**

Evidence: direct file:line trace of the exact unfiltered code path (`utils.ts:236-262`)
confirming no viewer parameter, no visibility check, and the contrast with the adjacent properly
filtered `truthView` at line 270. No fix is written in this task.

---

## F10 — `onEnter`/`onExit` handlers registered in the constructor stop firing after any snapshot restore

**Audit claim:** `_eventHandlers` is (correctly) unserializable, but `loadSerializedState`
discards the constructor-created `Space` instances that hold the live closures and rebuilds
fresh ones with empty handler lists — no re-binding hook exists.

**Trace (current code, 2026-07-03):**
- `src/engine/element/space.ts:106-109` — `private _eventHandlers: { enter: [...]; exit: [...] }
  = { enter: [], exit: [] }` is a private instance field holding live closures (registered via
  `onEnter(fn)`/`onExit(fn)`, which are constructor-time/setup-time calls per the class
  docstring's modeled pattern).
- `src/engine/element/space.ts:114-118` — `_eventHandlers` is explicitly listed in
  `unserializableAttributes`, confirming it is never part of the serialized JSON (correct,
  since closures cannot serialize) — but this also means there is no data-carrying path by which
  a restored instance could recover the registered handlers.
- `src/engine/element/game.ts:2835-2857` (`loadSerializedState`) — as traced under F1, line 2849
  (`this._t.children = []`) discards the constructor-built tree wholesale, and the rebuild loop
  (2850-2857) constructs brand-new `Space` instances via `GameElement.fromJSON`, each starting
  with the class default `_eventHandlers = { enter: [], exit: [] }`. Nothing in
  `loadSerializedState`, `GameElement.fromJSON`, or anywhere else re-invokes the constructor
  logic that originally called `onEnter`/`onExit`, and nothing captures the about-to-be-discarded
  handlers before the discard at line 2849. The rebuilt tree therefore has zero registered
  handlers, silently, after every restore.
- No post-restore hook exists on `Game` for re-registration (confirmed: no method named anything
  like `setupElements`/`onRestore`/`rebind*` appears in `game.ts` near `loadSerializedState`).

**VERDICT: LEGITIMATE**

Evidence: file:line trace confirms (a) handlers are private, live closures correctly excluded
from serialization, (b) the tree holding those closures is fully discarded on every restore path
sharing `loadSerializedState`, and (c) no re-binding mechanism exists anywhere in the class. This
is architecturally close to F1/F7 (same discard point) but a functionally distinct defect —
handler amnesia rather than data loss — since re-binding requires identity-matching closures to
rebuilt instances, not merely serializing plain data. No fix is written in this task.

---

## F15 — `registerDebug()` data broadcast to every player/spectator by default, with no opt-out

**Audit claim:** `includeDebugData` is hardcoded `true` at numerous session-layer call sites,
with no `NODE_ENV` gate or session-level switch, contradicting `types.ts`'s own documentation
that `customDebug` is "debug mode only."

**Trace (current code, 2026-07-03) — confirmed call sites:**
```
src/session/game-session.ts:890   → { includeActionMetadata: options?.includeActionMetadata ?? true, includeDebugData: options?.includeDebugData ?? true }
src/session/game-session.ts:903   → same pattern (public buildPlayerState() method)
src/session/game-session.ts:1386  → { includeActionMetadata: true, includeDebugData: true }
src/session/game-session.ts:2120  → { includeActionMetadata: true, includeDebugData: true }   (broadcast())
src/session/pending-action-manager.ts:226 → { includeActionMetadata: true, includeDebugData: true }
src/session/pending-action-manager.ts:250 → same
src/session/pending-action-manager.ts:355 → same
src/session/pending-action-manager.ts:357 → same
src/session/state-history.ts:321  → { includeActionMetadata: true, includeDebugData: true }
src/session/state-history.ts:393  → same pattern
```
Verified via `grep -n "includeDebugData" src/session/game-session.ts
src/session/pending-action-manager.ts src/session/state-history.ts src/session/stateless-ops.ts`
— exactly 10 hardcoded-`true` call sites across the three files above (game-session.ts:890,903
are `?? true` default-fallback forms on public API surfaces; 1386, 2120 are unconditional
literals; pending-action-manager.ts and state-history.ts sites are all unconditional literals).
This confirms and slightly extends the audit's own list (which cited only `state-history.ts:321`
— this re-verification confirms `:393` carries the identical hardcoded pattern and is in scope
too, matching Pitfall 1 of the phase's own RESEARCH.md).

- `src/session/utils.ts:287` — `buildPlayerState`'s consuming check is
  `if (options?.includeDebugData) { ... state.customDebug = ...; }` — a truthy check, meaning
  any of the above call sites passing `includeDebugData: true` (or defaulting via `?? true`)
  results in `customDebug` being attached to the broadcast state for every seat and spectator
  that receives it.

**Pitfall 1 explicitly recorded — `stateless-ops.ts` requires NO fix:**
`grep -n "buildViews\|buildSpectatorView\|includeDebugData\|buildPlayerState"
src/session/stateless-ops.ts` shows `buildViews` (line 212) and `buildSpectatorView` (line 225)
call `buildPlayerState(runner, [], ..., { includeActionMetadata: true })` and
`buildPlayerState(runner, [], 0, { includeActionMetadata: false })` respectively — **neither
call site passes `includeDebugData` at all**. Since `utils.ts:287`'s check is a truthy check on
`options?.includeDebugData` (not an `!== false` check), omitting the key means the check
evaluates to `undefined` (falsy) and `customDebug` is correctly **omitted** on this path already.
The dev-host / `SnapshotSessionHost` broadcast path (`stateless-ops.ts`) is therefore already
safe today and is explicitly out of scope for any SEC-04 fix — confirmed independently in this
verification task, not merely inherited from RESEARCH.md's prior finding.

**VERDICT: LEGITIMATE**

Evidence: exact call-site enumeration above (10 sites across 3 files, `grep`-verified against
current line numbers), plus explicit confirmation that `stateless-ops.ts` needs no change
(Pitfall 1). The fix scope for the next plan is these 10 call sites plus a default-flip in
`utils.ts:287`'s consumer contract — `stateless-ops.ts` must not be touched. No fix is written in
this task.

---

## F16 — `teachingDisabled`/`displayName` silently reset by `GameSession.restore()`

**Audit claim:** `StoredGameState` has no field for `teachingDisabled` (the LOCK-01 anti-cheat
lockout) or `displayName`; `restore()` passes `undefined` for both, silently re-enabling teaching
features (hints, heatmaps, AI-vs-AI demo) after any process restart or cold restore.

**Trace (current code, 2026-07-03):**
- `src/session/types.ts:195-242` (`StoredGameState` interface, full body read) — confirmed
  fields present: `gameType`, `playerCount`, `playerNames`, `playerIds`, `seed`,
  `actionHistory`, `snapshot`, `createdAt`, `aiConfig` (line 222), `gameOptions`, `lobbyState`,
  `lobbySlots`, `creatorId`, `minPlayers`, `maxPlayers`, `playerOptionsDefinitions`,
  `gameOptionsDefinitions`, `colorSelectionEnabled`, `colors`. **Neither `teachingDisabled` nor
  `displayName` appears anywhere in this interface.** (Note: `types.ts` does contain a
  `displayName?: string` field elsewhere, but it belongs to the unrelated `GameDefinition`
  interface at line 83, not `StoredGameState` — and a `teachingDisabled?: boolean` field exists
  on `PlayerGameState` at line 526, which is the session-layer-only broadcast payload shape, NOT
  persisted stored state. This distinction is important: the broadcast-time field exists so
  clients can read the CURRENT session's lockout state, but nothing feeds it after a cold
  restore because the persisted `StoredGameState` that `restore()` rebuilds from carries no
  `teachingDisabled` value at all — confirming rather than refuting the finding.)
- `src/session/game-session.ts:758-813` (`static restore(...)`) — line 813:
  ```
  const session: GameSession<G> = new GameSession(runner, storedState, GameClass, storage,
    aiController, undefined, lobbyManager, undefined, undefined, botAIConfig, undefined,
    onPersistenceError);
  ```
  Confirmed the 6th positional constructor argument (`displayName`, per the constructor
  signature) and the 11th (`teachingDisabled`, per the constructor signature) are both passed
  as the literal `undefined` — not read from `storedState` because `storedState` (typed as
  `StoredGameState`) has nowhere to carry them.
- `src/session/game-session.ts:532-555` (`static create(...)`) — confirmed `teachingDisabled`
  IS destructured from `GameSessionOptions` at construction time (line 553) and used to build the
  live session, but is never written into the `storedState` object that gets persisted — so even
  though a host correctly sets `teachingDisabled: true` at session creation, that value has no
  path into durable storage, and `restore()` has nothing to read back.

**VERDICT: LEGITIMATE**

Evidence: full `StoredGameState` interface body confirms the field absence (not merely a grep
miss — the entire interface was read in full); `restore()`'s exact call site at line 813
confirms the `undefined` pass for both fields; `create()`'s destructuring at line 553 confirms
`teachingDisabled` is accepted at session-creation time but has no persistence path. This is a
genuine anti-cheat lockout amnesia bug (LOCK-01 regression) matching the audit's "medium"
severity (the *mechanism* is confirmed serious — silent security-control loss — while
exploitation requires a process restart/cold-restore event, consistent with the audit's own
severity moderation reasoning). No fix is written in this task.

---

## Summary

| Finding | Area | Verdict | Primary evidence |
|---------|------|---------|-------------------|
| F1  | Zone visibility unserialized | LEGITIMATE | `space.ts:106-118`, `game.ts:2835-2857`, no `Space.toJSON`/`fromJSON` |
| F7  | Zone visibility lost on restore (session framing) | LEGITIMATE | Same root cause as F1; `runner.ts` → `loadSerializedState` path confirmed |
| F2  | `visibleAttributes` dead field | LEGITIMATE | `game-element.ts:140`; repo-wide + `game.ts`-scoped grep both zero-consumer |
| F8  | `state.players` unfiltered | LEGITIMATE | `utils.ts:236-262` raw `player.toJSON()`, no viewer param |
| F10 | `onEnter`/`onExit` lost on restore | LEGITIMATE | `space.ts:106-118` private closures + `game.ts:2849` discard, no rebind hook |
| F15 | `includeDebugData` hardcoded true | LEGITIMATE | 10 call sites enumerated; `stateless-ops.ts` confirmed already safe (Pitfall 1) |
| F16 | `teachingDisabled`/`displayName` lost on restore | LEGITIMATE | `types.ts:195-242` StoredGameState lacks both fields; `restore()` line 813 passes `undefined` |

All seven findings are confirmed LEGITIMATE against current repository state (2026-07-03), with
no findings requiring REJECTED status. The PROC-01 gate is satisfied — no fix code was written
in this task — and fix plans 02-05 are unblocked.
