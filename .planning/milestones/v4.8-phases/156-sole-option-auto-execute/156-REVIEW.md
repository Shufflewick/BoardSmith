---
phase: 156-sole-option-auto-execute
reviewed: 2026-07-20T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/engine/action/action-builder.ts
  - src/engine/action/types.ts
  - src/engine/element/action-metadata.ts
  - src/session/utils.ts
  - src/session/types.ts
  - src/types/protocol.ts
  - src/ui/composables/useBoardActionBridge.ts
  - src/ui/composables/useActionControllerTypes.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: resolved
---

# Phase 156: Code Review Report

**Reviewed:** 2026-07-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the D7 fix that adds `ActionBuilder.manual()` to suppress silent auto-execute of a sole no-selection action. The `manual` gate itself is correctly implemented and cannot be bypassed: it is a plain `if (action.manual) return;` inside the no-selection branch of `tryAutoStartSingleAction`, placed *before* the `executeAction()` call and the `devWarn` hint, and it does not touch the sibling `action.selections.length > 0` branch (auto-start of selection actions is unaffected) or the branch for non-manual sole actions (their auto-execute is unaffected). The `manual` field is threaded identically through `buildActionMetadata` and `buildSingleActionMetadata` (`...(actionDef.manual ? { manual: true } : {})` in both), and the `manual?: boolean` field was added consistently to all three client/server `ActionMetadata` shapes (`session/types.ts`, `types/protocol.ts`, `useActionControllerTypes.ts`). The `devWarn` call is dev-only (`isDevMode()` gate, false in production builds), fires once per action name (`shownWarnings` Set), and its message names the action and the fix (`.manual()`) without leaking file paths, line numbers, or stack traces.

The one real issue found is a documentation/behavior mismatch, not a functional defect in the gate: the `.manual()` doc comment (and a matching in-code comment) claim the shell "still auto-STARTS" a manual sole no-selection action, but no code path actually starts/surfaces it — the function just returns. Visibility depends entirely on the pre-existing ActionPanel button list still showing the action, which is not present for games using `suppressActionPanel`.

## Warnings

### WR-01: `.manual()` doc claims an "auto-STARTED" state that is never produced

**File:** `src/engine/action/action-builder.ts:152-158`, also `src/engine/action/types.ts:455-462` and `src/ui/composables/useBoardActionBridge.ts:280-283`

**Issue:** The doc comment for `.manual()` says: "when it is the sole no-selection action available, the shell still auto-STARTS it (surfaces its beat) but never auto-EXECUTES it for the player." The matching in-code comment in the bridge says the action is "auto-STARTED (surfaced above)". Neither is true: in `tryAutoStartSingleAction`, the no-selection branch for a manual action does nothing but `return` —

```ts
} else if (!skipNoSelections && actionMetadata.value) {
  autoEndArmed = false;
  if (action.manual) {
    // AUTOEXEC-01 (D7): a manual sole no-selection action is auto-STARTED
    // (surfaced above) but never auto-EXECUTED ...
    return;
  }
  ...
}
```

No `startAction()`, `board.setCurrentAction()`, or `controller.start()` call happens for this action. In fact `startAction()` itself cannot express "started but not executed" for a zero-selection action — it immediately calls `executeAction()` when `meta.selections.length === 0` (see `useBoardActionBridge.ts:173-178` and the equivalent in `ActionPanel.vue:626-635`). So there is no code path in this composable that produces a distinct "started" state for a no-selection action; the manual action simply remains an ordinary, un-auto-triggered entry in `availableActions`.

Practically this is harmless for the default auto-UI (`ActionPanel` independently renders a button for every action in `availableActions`, regardless of what this bridge does), but it is actively misleading for:
- A maintainer reading this code who might assume `board.currentAction` / `currentPick` becomes populated for the manual action and try to key custom-board affordances off it — it never does.
- A game author using `suppressActionPanel: true` with a fully custom board UI: for that mode `GameShell` shows only a `boardPrompt`/`currentPick.prompt` fallback strip (`GameShell.vue:2303-2311`), and since `currentPick` stays `null` for a manual sole no-selection action, nothing at all surfaces the action unless the author manually wires their own affordance — contradicting "surfaces its beat".

**Fix:** Correct the three comments to describe what actually happens, e.g.: "when it is the sole no-selection action available, the shell leaves it as a normal available action (no auto-start/auto-execute state exists for a zero-selection action) instead of silently executing it for the player — the player must trigger it themselves via the action panel or a custom UI affordance." If genuine "surfaced/highlighted" behavior is desired for board-only (`suppressActionPanel`) UIs, that needs an actual implementation (e.g. setting `board.setCurrentAction(action.name, 0, null)` so `boardPrompt`/`currentPick`-driven UI has something to show), not just a comment.

### WR-02: `.manual()` silently no-ops when applied to an action with selections

**File:** `src/ui/composables/useBoardActionBridge.ts:275-292`

**Issue:** The `action.manual` check only exists inside the `else` branch that handles zero-selection sole actions (`action.selections.length === 0`). If a game author calls `.manual()` on an action that *has* selections, the flag is accepted by the builder/type system with no error, propagates all the way to the client `ActionMetadata`, and then is read nowhere — the action still auto-starts its wizard exactly as if `.manual()` had never been called. There is no dev-time signal (no `devWarn`, no validation at registration) telling the author their `.manual()` call is inert for that action.

**Fix:** Either (a) add a `devWarn`/registration-time check (e.g. in `Game#registerAction()` or `Action.execute()`) when `manual === true` and `selections.length > 0`, naming the action and explaining `.manual()` only affects sole no-selection actions, or (b) extend `.manual()`'s documented contract to also suppress auto-*fill* of a sole-choice selection action, if that is actually desired product behavior. Silent no-ops on an explicit builder call violate the project's "pit of success" convention (wrong usage should be hard, not silently ignored).

## Info

### IN-01: Pre-existing `ActionMetadata` shape drift between `types/protocol.ts` and `session/types.ts` (not introduced by this diff, but relevant to the parity check requested)

**File:** `src/types/protocol.ts:636-645` vs `src/session/types.ts:384-395` / `src/ui/composables/useActionControllerTypes.ts:102-113`

**Issue:** This diff adds `manual?: boolean` consistently to all three `ActionMetadata` definitions — no new drift there. However, `types/protocol.ts`'s `ActionMetadata` is still missing the `help?: string` field that both `session/types.ts` and `useActionControllerTypes.ts` carry (added in an earlier phase). Since `protocol.ts` bills itself as "the single source of truth" for wire types and `session/types.ts` re-exports several other protocol types verbatim, having a second, hand-duplicated `ActionMetadata`/`PickMetadata` pair in `protocol.ts` that can silently drift from the one actually used on the wire is a standing risk — this phase's `manual` field happened to be added to both copies correctly, but a future field addition could easily repeat the `help` omission.

**Fix:** Not blocking for this phase (pre-existing, `help` already missing before D7). Consider consolidating: either have `session/types.ts`'s `ActionMetadata`/`PickMetadata` import from `protocol.ts` (as it already does for `LobbyState`, `WebSocketMessage`, etc.), or delete the unused duplicate in `protocol.ts` if it's not actually the type serialized over the wire, so there is exactly one place to add fields like `manual` in the future.

---

_Reviewed: 2026-07-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
