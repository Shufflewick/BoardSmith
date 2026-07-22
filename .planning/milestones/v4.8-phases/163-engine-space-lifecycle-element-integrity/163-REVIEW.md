---
phase: 163-engine-space-lifecycle-element-integrity
reviewed: 2026-07-21T00:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - src/engine/element/game-element.ts
  - src/engine/element/piece.ts
  - src/engine/element/space.ts
  - src/engine/element/game.ts
  - src/session/utils.ts
  - src/ui/composables/useActionController.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: resolved
resolution_note: "WR-01 fixed 2026-07-21 (commits 9d2deebd RED, 713cc644 GREEN); see WR-01 Status note below. IN-01 left as documented tradeoff (no action required)."
---

# Phase 163: Code Review Report

**Reviewed:** 2026-07-21
**Depth:** deep
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Compared the lifted `moveToInternal` (game-element.ts) byte-for-byte against the pre-163 `Piece.moveToInternal` (`git show 682ded7f:src/engine/element/piece.ts`): the cycle guard, WR-03 dev-only detached-destination check, the splice/tree-corruption diagnostic, and the exit/enter trigger ordering are unchanged; the only functional addition is the D22 sealed-old-parent guard, correctly placed *before* the splice (a throw leaves `_t.children`/`_t.parent` untouched) and correctly scoped to the child being removed FROM a sealed Space, not added into one. The `instanceof Space` → duck-typed `triggerEvent` conversion preserves the exact same firing condition (Space is the only class in the tree that defines `triggerEvent`), so no behavior change there.

The D24 hidden-zone-visibility branch (`toJSONForPlayer`) was traced against the pre-163 version: previously `'hidden'` shared a branch with `'count-only'` and emitted anonymized placeholder children + `childCount`; now `'hidden'` is its own branch that destructures `children` out entirely and never sets `childCount`. This closes the intended leak. However, tracing the redaction change one layer further (`idRemap`/`relinkFlowVariables` in `engine.ts`) surfaced a real regression risk — see WR-01 below.

D25 (collision guard) and D26 (availableActions/metadata reconcile) both check out: the guard is idempotent for same-constructor re-registration, un-seeds built-ins correctly, and only throws in dev for non-minified names; `buildActionMetadata` only omits an action when it's genuinely unregistered or its condition evaluates to `false` (a condition that throws is re-thrown, not swallowed), so D26's `Object.keys(actionMetadata)` reconciliation cannot silently drop a genuinely-available action. `sealed` as a plain public field rides the generic `toJSON`/attribute-restore loop and round-trips correctly (verified restore path skips the seal check, since `fromJSON` rebuilds children via direct array push, not `moveToInternal`).

## Warnings

### WR-01: D24 zone-`hidden` branch drops synthetic placeholders that `idRemap`/`relinkFlowVariables` depends on

**File:** `src/engine/element/game.ts:2862-2880`
**Issue:** The pre-163 code built anonymized placeholder children (with synthetic negative IDs registered into `idRemap`) for BOTH `'hidden'` and `'count-only'` zone modes. D24 correctly stops leaking child count for `'hidden'`, but as a side effect it now builds *zero* placeholders and registers *nothing* in `idRemap` for a `'hidden'` zone's children (comment at line 2867-2870 acknowledges this explicitly: "No synthetic placeholders are built, so there is nothing to register in `idRemap` either").

`idRemap` is consumed by `relinkFlowVariables` (`src/engine/flow/engine.ts:101-118`, wired via `FlowEngine.restoreFullState`'s `hiddenIdRemap`, and by the `forEachItems` relink path at `engine.ts:1401-1406`). This is the mechanism a redacted-clone restore (e.g. an MCTS bot's hidden-information search, per the `mcts-redaction.test.ts` coverage) uses to re-resolve a flow variable that points at an element inside a hidden collection, onto the redacted clone's synthetic placeholder for that element. Before 163, a flow variable pointing at a child of a `'hidden'`-mode zone would relink to its synthetic placeholder (the redacted clone has one). After 163, the redacted clone's `'hidden'` zone has NO children at all, so:
- `game.getElementById(value.__flowElementId)` fails (redacted clone has no such element — expected, this part is unchanged from `count-only`'s pre-163 behavior).
- `idRemap.get(value.__flowElementId)` now returns `undefined` (no entry was ever registered), so the fallback also fails.
- `relinkFlowVariables` falls through to `return value` (line 117), leaving the raw `{ __flowElementId, className }` marker object in place of a real element reference.

Any engine/game code that subsequently treats that flow variable as a `GameElement` (e.g. calls `.putInto()`, `.id`, or any GameElement method on it) will throw or misbehave on a redacted clone, whereas before 163 it would have resolved to a (redacted) placeholder element. This is a narrower surface than a full crash — it only triggers when a flow variable captured during real-game execution points at an element that lives inside a zone-wide-`hidden` Space at restore time — but it is a genuine, provable behavior regression introduced by this phase, not merely a hypothetical.

**Fix:** Either (a) keep building the anonymized placeholder children + `idRemap` entries for `'hidden'` mode exactly as `'count-only'` still does, but omit `childCount` and don't attach `children` to the outer JSON sent to the client (i.e., decouple "what the wire payload contains" from "what idRemap tracks" — build the remap map unconditionally, but only conditionally splice `children`/`childCount` into the returned JSON); or (b) if a fully-concealed zone is intentionally meant to have no addressable placeholder identity at all, add an explicit test asserting that a flow variable referencing an element inside a `'hidden'` zone degrades gracefully (not silently) on redacted-clone restore, and document this as an accepted limitation of `'hidden'` mode with MCTS/hidden-info AI.

**Status: RESOLVED (2026-07-21).** Fixed via a variant of (b)/Option A: neither `relinkFlowVariables` nor `executeForEach`'s `forEachItems` resolution gained any per-child structure (no `idRemap` entries were added for `'hidden'` mode — the count-suppression fix stays exactly as D24 left it). Instead, `serializeFlowVariables` and the `forEach` snapshot now record a single scalar per flow-variable marker / snapshot item — `__hiddenContainerId` / `hiddenContainerId` — set ONLY when the referenced element's immediate parent is a zone-`'hidden'` Space (via a new shared `hiddenContainerIdOf` helper in `src/engine/flow/engine.ts`). On redacted-clone restore, when the direct id lookup and `idRemap` both fail, both relink paths fall back to that recorded container id instead of a raw marker / throw. The container is always a live, already-disclosed element (only its children are concealed), so this adds zero count-observable state (storage is O(1) per flow variable, never O(hidden children)) while keeping the rollout resolvable. RED reproduced in `src/ai/mcts-redaction.test.ts` (`WR-01 / 163-REVIEW` describe block): pre-fix, a `forEach`-bound flow variable over a `contentsHidden()` zone stayed the raw `{__flowElementId, className}` marker and `continueFlow` on the SECOND loop iteration threw `FlowHaltedError` ("forEach() snapshot references element id … but it no longer exists"); post-fix it resolves to the zone's own container element and the flow completes. The same test asserts the redacted wire payload for the hidden zone still carries neither a `children` key nor a `childCount` key — D24's concealment contract is unchanged. Full suite green (209 files / 2960 tests, +1 from this fix) at commits `9d2deebd` (RED) and `713cc644` (GREEN).

## Info

### IN-01: `looksMinified` threshold silently permits any 1-2 character collision in dev builds too

**File:** `src/engine/element/game-element.ts:78-85`
**Issue:** `MINIFIED_NAME_MAX_LENGTH = 2` means two distinct, deliberately short-named classes (e.g. a designer literally naming classes `Q1`/`Q2`... unlikely, but also any minifier-adjacent tooling that produces 1-2 char names even in a dev build, e.g. certain test harnesses) never throw, even in `isDevMode()`. This is a reasonable and documented tradeoff (comment explains it), not a bug, but worth noting: the guard's dev-mode coverage has a silent blind spot for any real collision under 3 characters, which is unlikely to matter in practice given typical class-naming conventions.
**Fix:** No action required; documented tradeoff. If it ever proves too permissive, consider gating on `isDevMode() && !looksMinified` only for genuinely bundler-minified builds (distinguishing "dev but oddly short name" from "prod minified"), e.g. via an explicit build-time flag rather than name length alone.

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
