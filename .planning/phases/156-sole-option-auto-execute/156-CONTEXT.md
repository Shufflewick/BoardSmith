# Phase 156: Sole-Option Auto-Execute - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Close D7 (AUTOEXEC-01): when an action is the only legal option, the shell must auto-*start* it
(surface it to the player) but never auto-*execute* it — the player still takes the beat (no silent
auto-draw that deletes the draw beat). Delivered as a new `ActionBuilder.manual()` method that opts a
sole no-selection action into auto-start-but-never-auto-execute, threaded through action metadata to
the shell, which suppresses only the no-selection auto-execute branch.

IN SCOPE: `src/engine/action/action-builder.ts` + `action/types.ts` (the `manual()` builder + flag),
`src/engine/element/action-metadata.ts` and `src/session/utils.ts` (metadata threading, both the
primary and followUp builders), `src/session/types.ts` (typed `ActionMetadata.manual`),
`src/ui/composables/useBoardActionBridge.ts` (gate the auto-execute branch), and a dev-mode warning
on the un-`manual()` silent-auto-execute path.

OUT OF SCOPE: the AI seat's move selection (a sole legal move is still played by the bot — `manual()`
is a human-UI hint only), simultaneous-step correctness (Phase 160), and removing per-game
workarounds that exist because of D7 (Phase 169).
</domain>

<decisions>
## Implementation Decisions

### API Semantics & Default
- `manual()` opts a sole no-selection action into **auto-start-but-never-auto-execute**: the action
  is surfaced to the player (its beat appears), but the shell will not execute it for them.
- The **default for a sole no-selection action stays auto-execute** (per roadmap SC3 — `manual()` is
  opt-in). The mechanism `ActionBuilder.manual()` is locked by the roadmap.
- **Pit-of-Success signal (the resolution of the tension):** when a sole no-selection action
  auto-executes *without* `manual()`, emit a **one-time dev-mode console warning** naming the action
  and pointing at `.manual()`. The wrong path stays the default but is no longer silent — a designer
  sees it. The warning must be dev-mode only (no production noise) and fire at most once per action.
- Method name is `manual()` (roadmap-locked).

### Scope of `manual()`
- **Does not affect the AI seat.** The AI bot still plays its sole legal move unconditionally
  (`ai-controller.ts` → `bot.play()`); `manual()` is a UI-surfacing hint for humans only.
- **No-op on actions that have selections.** Those already auto-*start* (surface the first prompt)
  and never auto-execute; `manual()` only suppresses the no-selection execute branch
  (`useBoardActionBridge.ts:278-281`).
- Suppression must hold **even in the end-turn coalescing / `actionCompletedTick` path**
  (`useBoardActionBridge.ts:229` test path), not only the primary isMyTurn/actionsWithMetadata
  watcher.
- **Custom UI + Action Panel parity** (CLAUDE.md hard rule): both read the same `action.manual` from
  metadata via the shared `useBoardInteraction`/bridge plumbing; neither path may auto-execute a
  `manual()` action.

### Metadata Threading
- Store as `manual?: boolean` on `ActionDefinition` (`src/engine/action/types.ts`), set by the
  builder mirroring the existing `notUndoable()`/`undoable` chainable pattern
  (`action-builder.ts:143-150`).
- Thread through **both** `buildActionMetadata` (`action-metadata.ts:70`) and
  `buildSingleActionMetadata` (the followUp path, `session/utils.ts:120`) so the followUp path is not
  a silent gap.
- Add `manual?: boolean` to `ActionMetadata` in `src/session/types.ts:384` (typed, not left as the
  loose `unknown` on the client type).
- Serialize only when `true` (omit when false/absent) to keep the payload lean.

### Test & Verification Strategy (PROC-01)
- **RED proof drives the auto-draw scenario**: a sole no-selection action that, pre-fix, is silently
  auto-executed (beat consumed) and, post-fix with `manual()`, is surfaced and awaits the player.
  Assert on the observable beat (action surfaced vs. silently executed), not merely the flag value.
  Home: `src/ui/composables/useBoardActionBridge.test.ts`.
- Two layers: the component-level bridge test **plus** a `build-player-state` test asserting `manual`
  propagates into `actionMetadata` (both the primary and followUp builders).
- **Parity**: one test exercising the Custom UI path and one the Action Panel path.
- **Adversarial**: verify `manual()` is not defeated by the end-turn coalescing / `actionCompletedTick`
  path — a `manual()` action reachable as the sole option at end-of-turn must still not auto-execute.

### Claude's Discretion
- Exact wording of the dev warning (must name the action and mention `.manual()`), and the mechanism
  used to make it fire once (module-level Set vs. per-definition flag), are Claude's call.
- Whether the dev-mode gate keys off `import.meta.env.DEV`, a `NODE_ENV` check, or the existing
  BoardSmith dev-warning helper if one exists — reuse an existing convention if present.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `notUndoable()` (`action-builder.ts:143-150`) is the exact chainable-boolean pattern to mirror for
  `manual()`: `manual(): this { this.definition.manual = true; return this; }`.
- `buildActionMetadata` (`action-metadata.ts:70-75`) already assembles `{name, prompt, help,
  selections}` per action — add `manual: actionDef.manual` there.
- `ActionMetadata` interface (`session/types.ts:384-390`) is the typed shape the shell reads.
- BoardSmith already emits designer-facing dev warnings (e.g. the "Action X is registered but
  referenced by no actionStep()" warning seen in test stderr) — check for an existing warn helper /
  convention to reuse for the sole-option warning rather than a raw `console.warn`.

### Established Patterns
- The sole-option detection is `actions.length !== 1` in `tryAutoStartSingleAction`
  (`useBoardActionBridge.ts:271-272`); the auto-start branch is `:275-277` (selections > 0), the
  auto-execute branch to gate is `:278-281` (`executeAction(action.name, {})`).
- `undoable` is deliberately NOT propagated to client metadata (server-only, used by the undo fence).
  `manual` is the opposite: it MUST reach the client, so it needs an explicit line in the metadata
  builder — do not assume definition flags auto-serialize.
- `actionsWithMetadata` computed (`useBoardActionBridge.ts:87-95`) maps availableActions → metadata,
  falling back to `{name, prompt, selections:[]}` — the fallback must carry `manual` too, or a
  metadata-less action defaults to non-manual (acceptable).

### Integration Points
- Auto-execute branch: `useBoardActionBridge.ts:278-281` — gate on `!action.manual`.
- End-turn coalescing path: `useBoardActionBridge.ts:229` (`actionCompletedTick`) — the second path
  that can auto-execute a sole no-selection action; the gate must cover it.
- Controller-level auto-execute (`useActionController.ts:869`, default `autoExecute:true` at `:151`)
  fires once all selections are filled — this is a DIFFERENT concern (selection actions) and is out of
  scope for `manual()`, which only touches the no-selection sole-option execute.
- AI path: `ai-controller.ts:87-135` plays the sole legal move regardless — intentionally unaffected.

</code_context>

<specifics>
## Specific Ideas

- The defect presents to a designer as "the game drew the card for me / I never got to draw" — the
  RED test should assert on that observable (draw beat surfaced to the player), so it fails for the
  reason a designer would report, not on an internal flag.
- Three games were hit by D7; this is a Blocker. The fix is at the library layer only — no per-game
  patches (Phase 169 removes the game-side workarounds once this ships).

</specifics>

<deferred>
## Deferred Ideas

- Flipping the default to never-auto-execute (true Pit-of-Success default) was considered and
  declined for this phase — it contradicts roadmap SC3 and would change behavior for every existing
  game. The dev-mode warning is the chosen middle path. Revisit only if the warning proves
  insufficient in practice.
- Gating the AI seat's sole-move play behind `manual()` — out of scope; AI autonomy is a separate
  concern.
- Any `manual()`-driven confirm step on selection actions — out of scope.

</deferred>
