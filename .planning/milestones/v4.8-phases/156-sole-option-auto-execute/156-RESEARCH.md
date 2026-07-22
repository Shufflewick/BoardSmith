# Phase 156: Sole-Option Auto-Execute - Research

**Researched:** 2026-07-20
**Confidence:** HIGH (fix surface fully mapped via codebase scout)

## Summary

D7 fix is a thin, well-bounded vertical: one new chainable builder flag threaded through action
metadata into the shell, where a single auto-execute branch is gated. No architectural change.

## Fix Surface (verified file:line)

1. **Builder + flag** — `src/engine/action/action-builder.ts:143-150` shows the `notUndoable()`
   pattern to mirror: `manual(): this { this.definition.manual = true; return this; }`. Add
   `manual?: boolean` to `ActionDefinition` in `src/engine/action/types.ts` (near `undoable?` at
   `:454`).
2. **Metadata build** — `buildActionMetadata` (`src/engine/element/action-metadata.ts:70-75`) emits
   `{name, prompt, help, selections}`; add `manual: actionDef.manual`. Also
   `buildSingleActionMetadata` (followUp path, `src/session/utils.ts:120-146`).
3. **Metadata type** — `ActionMetadata` (`src/session/types.ts:384-390`): add `manual?: boolean`.
4. **Shell gate** — `src/ui/composables/useBoardActionBridge.ts`:
   - sole-option detection `:271-272` (`actions.length !== 1`),
   - auto-start branch `:275-277` (selections > 0 → `startAction`) — unchanged,
   - **auto-execute branch `:278-281`** (`executeAction(name, {})`) — gate on `!action.manual`,
   - end-turn coalescing / `actionCompletedTick` path `:229` — the second auto-execute route; the
     gate must cover it too.
5. **Dev warning** — when the `:278-281` branch fires for an action WITHOUT `manual`, emit a
   one-time dev-mode warning naming the action. Reuse BoardSmith's existing designer-warning
   convention (the engine already warns e.g. "Action X is registered but referenced by no
   actionStep()") rather than a bare `console.warn`.

## Key Facts / Pitfalls

- `undoable` is deliberately NOT propagated to client metadata (server-only, undo fence). `manual`
  is the OPPOSITE — it must reach the client, so the metadata-builder line is mandatory, not
  automatic.
- The `actionsWithMetadata` fallback (`useBoardActionBridge.ts:87-95`) builds `{name, prompt,
  selections:[]}` when metadata is missing — a metadata-less action reads as non-manual (acceptable
  default).
- The AI path (`ai-controller.ts:87-135`) plays a sole legal move regardless of `manual()` — this is
  intentional; `manual()` is a human-UI hint. Do not gate the AI.
- Controller-level `autoExecute` (`useActionController.ts:869`, default true `:151`) is a DIFFERENT
  concern (fires when all selections are filled) and is out of scope.

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| AUTOEXEC-01 | D7 | UI shell (bridge) | RED: sole no-selection action silently auto-executes pre-fix (beat consumed); with `manual()` it is surfaced and awaits the player post-fix. Assert on the observable beat, not the flag. | `src/ui/composables/useBoardActionBridge.test.ts` |
| AUTOEXEC-01 | D7 | session metadata | `manual` propagates into `actionMetadata` via BOTH `buildActionMetadata` and the followUp `buildSingleActionMetadata`. | `src/session/build-player-state.test.ts` |
| AUTOEXEC-01 | D7 | UI parity | Custom UI path and Action Panel path both refuse to auto-execute a `manual()` sole option. | `useBoardActionBridge.test.ts` / `ActionPanel` test |
| AUTOEXEC-01 | D7 | adversarial | `manual()` is not defeated by the end-turn coalescing / `actionCompletedTick` route (`:229`). | `useBoardActionBridge.test.ts` |
| PROC-01 | — | process | Each: fix at library layer + regression proven RED on pre-fix + adversarial (end-turn path) before close. | git history RED→GREEN |

### Wave 0 gaps
- No existing test asserts the sole no-selection action's beat is preserved — UNDO/AUTOEXEC coverage
  for the `manual()` surface is entirely net-new.
- Dev-warning "fires at most once, dev-mode only" needs its own assertion (no production noise).
