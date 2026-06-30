# Phase 113: Go-Fish AI Teaching — Research

**Researched:** 2026-06-30
**Confidence:** HIGH — the substrate is fully built (v4.1 Phases 107/110), proven for checkers; go-fish needs ~3 small additions. Source: codebase scout (file:line verified).

## RESEARCH COMPLETE

## Summary

The move-hint and narrated AI-vs-AI demo machinery already exists in BoardSmith and is game-agnostic. Go-fish only needs: (1) a `hintTargetFromMove` hook mapping a suggested ask to a highlightable card ref, (2) wiring it into `gameDefinition.ai`, (3) a rank-keyed anchor on the `card-group` div so the overlay can resolve the rank, and (4) tests. The demo requires essentially no go-fish code. The heatmap is board-only and out of scope.

## Substrate (reuse as-is — BoardSmith `src/`)

- **Hint request:** `GameShell.vue:816` `platformRequest('hint', { seat })`; `ControlsMenu.vue:303-324` "Get a hint" (gated by `showHint`, disabled by `hintDisabled`).
- **Hint processing:** `game-session.ts:972` `requestHint(seat)` → ephemeral `bot.play()` → `#extractMoveTarget(move)` (`:943-955`) → `Annotation` → `#hint` → broadcast. Fail-loud if seat not awaiting input or a hint is already in flight; MCTS errors re-thrown (no silent fallback).
- **Target extraction hook:** `#extractMoveTarget` calls `this.#botAIConfig.hintTargetFromMove(move)` if defined, else DEST_ARGS fallback (`to/destination/target/square/cell/position` → `{id}`|`{notation}`). **Signature: `(move: BotMove) => ElementRef | undefined` — receives the move ONLY (no game/seat).**
- **Overlay render:** `HintOverlay.vue` reads `gameState.state.hint.annotation` → `overlay-utils.buildSelector(target)` → `[data-bs-el-id]` > `[data-bs-el-notation]` > `[data-bs-el-name]` → `document.querySelector` → ring + bubble.
- **R-06 clear:** `game-session.ts:1296-1299` `performAction()` deletes `#hint` before broadcast; `:243` clears on undo/rewind.
- **Demo:** ops `demoStart{delay?}`/`demoStop` (`stateless-ops.ts:75-76`); `runDemoLoop()` in `snapshot-session-host.ts` — aiSuggest preview → narrate (`onBeforeMove`) → delay → execute-same-args via 'action' op → try/finally cleanup; `demoAbort` checked before AND after delay (Phase 110-03). Narration `game-session.ts:1206-1220` generic "Player N: action key=val"; `BoardMessage.vue` variant="narration".

## Go-fish additions (the whole phase)

1. **`ai.ts`** — `export function getGoFishHintTarget(move: BotMove): ElementRef | undefined` returning `move.args?.rank ? { name: String(move.args.rank) } : undefined`. (Bot ask move = `{ action:'ask', args:{ target:number, rank:string } }`, `actions.ts createAskAction`.)
2. **`index.ts`** — add `hintTargetFromMove: getGoFishHintTarget` to `gameDefinition.ai` (alongside the existing `objectives`).
3. **`GameTable.vue`** — on the rank `card-group` div (`:516`, `v-for="[rank, cards]"`), add `v-bind="anchorAttrs({ name: rank })"` so the group carries `data-bs-el-name="<rank>"` and the hint ring can land on the whole rank. (Hand cards already emit anchorAttrs per Phase 112; this adds the rank-group anchor the hint needs.)
4. **Tests** — `tests/hint-target.test.ts` (mirror checkers) + a demo/narration test.

Checkers reference: `checkers/src/rules/index.ts:25-28` `hintTargetFromMove`; `checkers/tests/hint-target.test.ts`.

## Pitfalls

1. **Card name mismatch:** individual cards are named `rank+suit` ('7H'); a bare `{ name: '7' }` would NOT match a card. The rank-GROUP anchor (`data-bs-el-name="7"`) is what `{ name: rank }` resolves to — they must agree. Verify the rank value the bot emits (e.g. '7', '10', 'K') equals the `rank` key used by `myCardsByRank`/the group `v-for` and the card `data-rank`.
2. **Hook gets move only:** do not attempt to resolve a specific card id in `hintTargetFromMove` (no game access). Rank-group `{ name }` is the correct design.
3. **Demo abort:** rely on the substrate's before+after-delay `demoAbort`; do not add go-fish demo timers (CLAUDE.md no-timers/no-orphaned-state).
4. **Teaching gating:** `requestHint` throws if the seat isn't awaiting input — the hint button is only meaningful on the learner's turn (test/verify accordingly).

## Environment Availability

| Dependency | Available | Note |
|------------|-----------|------|
| go-fish MCTS bot | ✓ | `gameDefinition.ai.objectives` already attached |
| BoardSmith hint/demo substrate | ✓ | v4.1, symlinked live (no re-vendor) |
| `anchorAttrs` from `boardsmith/ui` | ✓ | already imported in GameTable.vue (Phase 112) |
| vitest (both repos) | ✓ | — |

## Open Questions (RESOLVED)

1. **What ref should the hint return for an ask?** RESOLVED: `{ name: rank }` targeting a rank-keyed anchor on the `card-group` (decided in 113-CONTEXT Area 1; the hook has no game access so a card id is not derivable).
2. **Does the demo need go-fish code?** RESOLVED: no — the demo loop is fully generic; go-fish AI is attached and narration is engine-derived. An optional per-game narration hook is used only if the substrate exposes it cheaply.

## Validation Architecture

To prove the phase delivers GFAI-01 and GFAI-02:

- **GFAI-01 (hint):**
  - Unit (go-fish): `hintTargetFromMove({ action:'ask', args:{ target:2, rank:'7' } })` returns `{ name: '7' }`; an ask with no rank returns `undefined`.
  - Integration (go-fish): drive a session `requestHint(seat)` on a real go-fish game and assert a hint annotation with `target.ref.name` equal to the bot's suggested rank is produced (mirror checkers' hint-target integration if present).
  - DOM/parity (browser checkpoint): the hint ring resolves to the `card-group` carrying `data-bs-el-name="<rank>"` (not a board cell). Confirm `anchorAttrs({ name: rank })` emits the attribute.
  - R-06: after the next action, the hint annotation is cleared (substrate-owned; assert via session state if cheaply testable, else note as substrate-covered).
- **GFAI-02 (demo):**
  - Integration (go-fish): run the AI-vs-AI demo loop for a few moves; assert each move is narrated (announcement text present) before execution, and that `demoStop` halts with no orphaned state (no pending timers, demoRunning cleared).
  - Browser checkpoint: a narrated demo announces each ask in the narration card before it executes; stopping mid-demo leaves a clean state.
- **Negative/Guardrails:** `requestHint` on a non-acting seat throws (fail-loud); the hint never fabricates a target (undefined ref → floating bubble, no ring).

Test framework: vitest (both repos). Quick: `npm test -- hint` (go-fish). Full: `npm test` each repo. Browser: `boardsmith dev` host human-verify checkpoint (kill server after).
