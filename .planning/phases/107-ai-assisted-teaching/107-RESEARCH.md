# Phase 107: AI-Assisted Teaching - Research

**Researched:** 2026-06-26
**Domain:** MCTS bot stats API / session teaching hooks / fixed-position overlay rendering
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — MCTS stats API & move hint**
- Add `playWithStats()` to `MCTSBot` returning `{ move: BotMove; stats: Array<{ move: BotMove; visits: number; value: number }> }`, capturing root node children BEFORE `searchGame`/`rootSnapshot` are nulled (`mcts-bot.ts:291–292`). Existing `play()` stays as-is.
- Move hint is a **transient hint annotation** injected at the session layer — usable outside a running tutorial; reuses TUT-01 annotation overlay ring/bubble.
- Hint highlights the suggested move's **target cell (destination)**, anchored via `data-bs-el-id`.
- Hint available at **any decision point** in normal play (AI-01 success criterion).

**Area 2 — AI-vs-AI narrated demo**
- Narration text is **engine-derived** from action name + args by default ("Player 2: move c3→d4"), with optional author hook.
- Add `onBeforeMove` callback in `AIController`, fired between MCTS-compute and `runner.performAction()`.
- Pacing: announce (fire `onBeforeMove`), then execute after **configurable delay (default ~1.2s)**.
- Demo reuses all-seats AI (`AIConfig.players: [1,2]`) + narration, exposed as session/UI control.

**Area 3 — Evaluation heatmap**
- Render via **new fixed-position overlay** reading MCTS stats + `data-bs-el-id` anchors.
- Visualize **normalized win-rate (value)** per candidate move target cell.
- Visual encoding: **intensity/opacity + numeric badge** (WCAG 2.2 AA, v4.0 Slate tokens) — never color-only.
- Show only **candidate move target cells** the MCTS actually evaluated.

**Area 4 — Parity, scope & testing**
- All three features route through `useBoardInteraction`/anchor layer — identical in custom UI and AutoUI.
- **Substrate lands in this repo** (`src/ai`, `src/session`, `src/ui`). Checkers wiring deferred to Phase 109.
- Verification: unit/integration tests using a test game and the symlinked checkers bot.

### Claude's Discretion
- Exact method/option/event names, component file names, chip layout and badge formatting, precise narration delay, and how `playWithStats` snapshots root children.

### Deferred Ideas (OUT OF SCOPE)
- Checkers-specific teaching UI/content wiring → Phase 109.
- Browser end-to-end demonstration → Phase 110.
- Fixing dev-host AI-vs-AI open-seat auto-play bug → separate pending todo.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-01 | A player can request a move hint at any decision point; the existing MCTS suggests a legal move and the suggested target is highlighted via the annotation overlay (TUT-01). | `playWithStats()` + transient `hint` in `PlayerGameState` + `HintOverlay.vue` (TutorialOverlay pattern) |
| AI-02 | A player can watch an AI-vs-AI narrated demo in which each move is announced before it executes. | `onBeforeMove` hook in `AIController` + `GameSession` demo-mode API + `BoardMessage variant="narration"` |
| AI-03 | A player can toggle an evaluation heatmap that visualizes the AI's per-move evaluation across the board. | `playWithStats()` stats + transient `heatmap` in `PlayerGameState` + `HeatmapOverlay.vue` |
</phase_requirements>

---

## Summary

Phase 107 surfaces the existing MCTS bot's internal evaluation data to players as three teaching aids. No new AI models, weights, or training runs are involved — this phase is entirely about building the scaffolding to make the bot's existing knowledge visible and interactive.

The four concrete gaps identified in the scout are precisely scoped and non-overlapping. `MCTSBot.playWithStats()` is the shared data source for both the hint and the heatmap; it requires exposing root-node children stats before the post-search cleanup discards them. The transient hint and heatmap fields in `PlayerGameState` are session-layer additions that never touch engine serialization — they are injected into the broadcast state by `GameSession` after `buildPlayerState()` returns, clearing automatically after any action on the relevant seat. The `onBeforeMove` hook threads through `AIController.checkAndPlay()` as an optional fourth callback, enabling the narration announce/delay pacing without altering search behavior. The three overlay components follow the existing `TutorialOverlay.vue` pattern exactly (Teleport to body, position:fixed, ResizeObserver, `data-bs-el-id` anchors) and are invisible to renderers.

**Primary recommendation:** Build Gap 1 (`playWithStats`) first — it unblocks both hint (AI-01) and heatmap (AI-03). Build Gap 3 (`onBeforeMove`) in parallel. The overlay components (Gaps 2 & 4) depend on session fields being defined first.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCTS stats capture | AI layer (`src/ai`) | — | `MCTSBot` already owns the root node; stats are an output of search |
| Hint annotation construction | Session layer (`src/session`) | — | Requires mapping `BotMove.args` → `ElementRef`; game-specific extraction lives near AI config |
| Transient teaching state | Session layer (`src/session`) | — | Not engine state; session is the right boundary between AI and UI |
| Hint overlay rendering | UI layer (`src/ui`) | — | Reads injected `gameState`; uses existing overlay infrastructure |
| Heatmap overlay rendering | UI layer (`src/ui`) | — | Fixed-position chip layer over board; pure rendering, no logic |
| Narration hook | Session layer + AIController | — | Lifecycle straddles session (broadcast timing) and AI controller (before-move timing) |
| Demo mode control | Session layer (`src/session`) | UI controls layer | Session owns AI controller mutation; UI exposes toggles in ControlsMenu |
| Teaching controls UI | ControlsMenu (`src/ui`) | GameShell | Existing menu extended with Teaching group |
| Parity (custom + AutoUI) | `useBoardInteraction` anchor layer | — | All three overlays resolve `data-bs-el-id` via document.querySelector — no renderer coupling |

---

## Standard Stack

### Core (all pre-existing — no new dependencies)

| Library / Module | Path | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `MCTSBot` | `src/ai/mcts-bot.ts` | Search engine for hint + heatmap stats | The existing bot; this phase extends its public API |
| `AIController` | `src/session/ai-controller.ts` | AI lifecycle + narration hook integration | Already wires bot into session; `onBeforeMove` adds one callback |
| `TutorialOverlay.vue` | `src/ui/components/helpers/TutorialOverlay.vue` | Pattern reference for `HintOverlay` and `HeatmapOverlay` | Teleport + fixed overlay + ResizeObserver pattern fully established |
| `BoardMessage.vue` | `src/ui/components/helpers/BoardMessage.vue` | Narration card — new `'narration'` variant | Existing `variant="annotation"` extended to `variant="narration"` |
| `ControlsMenu.vue` | `src/ui/components/ControlsMenu.vue` | Teaching controls entry point | Existing menu extended with "Teaching" group |
| `GameShell.vue` | `src/ui/components/GameShell.vue` | Mounts all overlays, provides `gameState` injection | Already mounts `TutorialOverlay`; new overlays added alongside |

**Installation:** none — zero new npm packages. [VERIFIED: codebase grep]

---

## Package Legitimacy Audit

> This phase installs no external packages.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Player UI (ControlsMenu)
  │
  ├─ "Get a hint" ──────────────────────────► GameSession.requestHint(seat)
  │                                               │
  │                                               ├─ createBot(runner.game, ...)
  │                                               ├─ bot.playWithStats()           ─► MCTSBot.runSearch()
  │                                               │     └─ captures root.children          │
  │                                               │         { parentMove, visits, value }  │
  │                                               ├─ extractHintAnnotation(bestMove)       │
  │                                               ├─ #hint.set(seat, annotation)           │
  │                                               └─ broadcast()                           │
  │                                                     │                                  │
  │                                               GameSession.broadcast()                  │
  │                                                     │                                  │
  │                                               buildPlayerState() + inject hint          │
  │                                                     │                                  │
  │                              ┌──────────────────────┘                                  │
  │                              ▼                                                         │
  │                        PlayerGameState                                                 │
  │                          .hint?  ──────────────────────────────────► HintOverlay.vue  │
  │                          .heatmap? ─────────────────────────────► HeatmapOverlay.vue  │
  │                          .narration? ──────────────────────► BoardMessage("narration") │
  │                                                                                        │
  ├─ "Show move quality" ─────────────────► GameSession.setHeatmapVisible(seat, true)     │
  │                                            └─ bot.playWithStats() ───────────────────►┘
  │                                            └─ #heatmapEntries = buildHeatmapEntries(stats)
  │                                            └─ broadcast()
  │
  └─ "Watch AI demo"  ──────────────────► GameSession.startDemo()
                                              ├─ save original #aiController
                                              ├─ override with all-seats AIController
                                              ├─ set #onBeforeMove narration hook
                                              └─ #scheduleAICheck()

AIController.checkAndPlay():
  bot.play() → move
  await onBeforeMove?.(action, player, args)   ← fires narration + 1.2s delay
  onMove(action, player, args)                 ← executes move
```

### Recommended Project Structure

```
src/
├── ai/
│   ├── mcts-bot.ts              # add runSearch() + playWithStats()
│   ├── types.ts                 # add BotMoveStats interface
│   └── index.ts                 # export BotMoveStats, playWithStats signature
├── session/
│   ├── ai-controller.ts         # add onBeforeMove optional param to checkAndPlay()
│   ├── game-session.ts          # add requestHint/clearHint/setHeatmapVisible/startDemo/stopDemo
│   ├── types.ts                 # add hint/heatmap/narration to PlayerGameState
│   └── utils.ts                 # no change needed (GameSession injects post-buildPlayerState)
└── ui/
    └── components/
        ├── helpers/
        │   ├── TutorialOverlay.vue        # unchanged (reference only)
        │   ├── HintOverlay.vue            # new — single transient annotation
        │   ├── HeatmapOverlay.vue         # new — per-cell evaluation chips
        │   └── BoardMessage.vue           # add variant="narration"
        ├── GameShell.vue                  # mount HintOverlay, HeatmapOverlay; wire ControlsMenu teaching props
        └── ControlsMenu.vue               # add Teaching group + emit 'teaching-action'
```

### Pattern 1: Root-children stats capture via `runSearch()` refactor

**What:** Extract the shared search body of `playSingle()` into a private `runSearch()` method that returns both the best move and the root node. Both `play()` and `playWithStats()` call `runSearch()`, but only `playWithStats()` reads root children before discarding.

**When to use:** Whenever callers need per-move evaluation stats alongside the move recommendation.

```typescript
// Source: src/ai/mcts-bot.ts — proposed runSearch() extraction seam
// Lines 174–341 of playSingle() become runSearch() returning { move: BotMove; root: MCTSNode }

// In play():
async play(): Promise<BotMove> {
  if (this.config.parallel && this.config.parallel > 1) return this.playParallel();
  const { move } = await this.runSearch();
  return move;
}

// New public method:
async playWithStats(): Promise<{ move: BotMove; stats: BotMoveStats[] }> {
  // Force single search — parallel mode aggregates by votes and loses per-child stats.
  const { move, root } = await this.runSearch();
  const stats: BotMoveStats[] = root.children.map(child => ({
    move: child.parentMove!,
    visits: child.visits,
    value: child.visits > 0 ? child.value / child.visits : 0,
  }));
  return { move, stats };
}
```

**Critical discard point (confirmed at lines 291–292):**
```typescript
// Current playSingle() cleanup — stats must be captured BEFORE these lines:
this.searchGame = null;   // line 291
this.rootSnapshot = null; // line 292
```

### Pattern 2: Transient session-layer teaching state injection

**What:** Session holds `#hint`, `#heatmap`, `#narrationText` as in-memory fields. After `buildPlayerState()` produces the base `PlayerGameState`, `GameSession.broadcast()` mutates the result to inject teaching fields before sending. `buildPlayerState()` in `utils.ts` is NOT changed.

**Why injection not embedded in buildPlayerState:** `buildPlayerState` is a pure function (runner + names + position → state) with no session reference. Keeping it pure avoids threading session state through it and is consistent with the tutorial pattern (tutorial is derived from engine state, which `buildPlayerState` CAN read; teaching state is NOT in engine state).

```typescript
// Source: src/session/game-session.ts — in broadcast()
broadcast(): void {
  // ... existing captureCheckpoint() ...
  if (!this.#broadcaster) return;
  const flowState = this.#runner.getFlowState();
  const sessions = this.#broadcaster.getSessions();
  for (const session of sessions) {
    const effectivePosition = session.isSpectator ? 0 : session.playerSeat;
    const state = buildPlayerState(
      this.#runner, this.#storedState.playerNames, effectivePosition,
      { includeActionMetadata: true, includeDebugData: true }
    );

    // Inject transient teaching state — never derived from engine, never serialized
    const hint = this.#hint.get(effectivePosition);
    if (hint) state.hint = hint;
    const heatmap = this.#heatmap.get(effectivePosition);
    if (heatmap) state.heatmap = heatmap;
    if (this.#narrationText) state.narration = { text: this.#narrationText };

    this.#broadcaster.send(session, { type: 'state', flowState, state, ... });
  }
}
```

**Auto-clear on action:** `performAction()` (game-session.ts line 864+) and `#checkAITurn()`'s `onMove` callback both call `broadcast()`. Insert hint-clear BEFORE broadcast in the action path:

```typescript
// In performAction(), after runner.performAction() succeeds:
this.#hint.delete(player);  // hint is stale after any action
// heatmap: schedule re-computation rather than clear (stays toggled)
```

### Pattern 3: `onBeforeMove` callback threading

**What:** `AIController.checkAndPlay()` gains an optional `onBeforeMove` parameter. `GameSession.#checkAITurn()` provides the implementation. Callers of `GameSession` set it via a public method.

```typescript
// Source: src/session/ai-controller.ts — checkAndPlay signature change
async checkAndPlay(
  runner: GameRunner<G>,
  actionHistory: SerializedAction[],
  onMove: (action: string, player: number, args: Record<string, unknown>) => Promise<boolean>,
  onBeforeMove?: (action: string, player: number, args: Record<string, unknown>) => Promise<void>  // new
): Promise<{ action: string; player: number; args: Record<string, unknown> } | null>

// Inside checkAndPlay(), between bot.play() and onMove():
const move = await bot.play();
if (onBeforeMove) await onBeforeMove(move.action, aiPlayer, move.args);  // announce + delay
const success = await onMove(move.action, aiPlayer, move.args);
```

### Pattern 4: Overlay component pattern (established by TutorialOverlay)

**What:** New overlays `HintOverlay.vue` and `HeatmapOverlay.vue` follow the TutorialOverlay pattern exactly:

- `<Teleport to="body">` — escapes `.boardregion` overflow:hidden
- `position: fixed; inset: 0; z-index: {N}; pointer-events: none`
- `inject('gameState')` — reads from the shared reactive state
- `buildSelector()` + `document.querySelector` — resolves `data-bs-el-id` anchors globally
- `getBoundingClientRect()` — viewport-fixed coordinates (no offset correction needed)
- `ResizeObserver` on `.boardregion` + each resolved target element
- `boardRegion?.addEventListener('scroll', ...)` for scroll re-measure
- `watchEffect` on reactive data → `nextTick(measure)` + `rebuildObservers()`
- `prefers-reduced-motion: reduce` → instant display, no animation

**Z-index stack additions (from UI-SPEC):**

| Z | Component |
|---|-----------|
| 10 | `BoardMessage variant="narration"` — new |
| 15 | `HeatmapOverlay.vue` — new |
| 20 | `TutorialOverlay.vue` / `HintOverlay.vue` — existing + new |

**HintOverlay difference from TutorialOverlay:** reads `gameState.value.state.hint?.annotation` (single `Annotation`, not `Annotation[]`); renders exactly one ring + one bubble with the existing CSS classes. The "i" chip is rendered with chip glyph consistent with TutorialOverlay.

**HeatmapOverlay differences from TutorialOverlay:**
- Reads `gameState.value.state.heatmap?.entries` (array of `HeatmapEntry`)
- Renders circle chips instead of rings — centered on target cell rects
- Chip size: `min(floor(min(rect.width, rect.height) * 0.68), 52px)`, minimum 24px
- No bubble, no text pointer — chips are `aria-hidden="true"` (value conveyed by numeric badge)

**HeatmapEntry type:**
```typescript
interface HeatmapEntry {
  cellRef: ElementRef;     // data-bs-el-id anchor for the target cell
  normalizedValue: number; // in [0, 1] — raw value from BotMoveStats
  isBest: boolean;         // true on the single highest normalizedValue entry
}
```

**Converting BotMoveStats → HeatmapEntry[]:**
```typescript
function buildHeatmapEntries(stats: BotMoveStats[]): HeatmapEntry[] {
  // Deduplicate: same target cell can appear in multiple BotMoves (different piece selections);
  // keep the entry with the highest normalizedValue for that cell.
  const byCell = new Map<string, HeatmapEntry>();
  for (const stat of stats) {
    const ref = extractTargetRef(stat.move); // game-specific extraction
    if (!ref) continue;
    const key = refKey(ref);
    const existing = byCell.get(key);
    if (!existing || stat.value > existing.normalizedValue) {
      byCell.set(key, { cellRef: ref, normalizedValue: stat.value, isBest: false });
    }
  }
  const entries = [...byCell.values()];
  if (entries.length > 0) {
    const best = entries.reduce((a, b) => a.normalizedValue > b.normalizedValue ? a : b);
    best.isBest = true;
  }
  return entries;
}
```

### Pattern 5: Move-target extraction for hint and heatmap

**What:** Converting a `BotMove.args` record to an `ElementRef` for overlay targeting. This is game-specific — checkers uses `{ to: squareElementId }`.

**Default extraction strategy (Claude's discretion):** Try common destination arg names in order: `to`, `destination`, `target`, `square`, `cell`, `position`. Fall back to the first element-valued arg. If none found, return `undefined` (hint shows floating bubble, heatmap entry omitted).

**Game-specific override:** Add optional `hintTargetFromMove?: (move: BotMove) => ElementRef | undefined` to `BotAIConfig` (alongside `objectives`, `threatResponseMoves`). Authors who use non-standard arg names provide this.

```typescript
// In BotAIConfig (src/ai/types.ts):
hintTargetFromMove?: (move: BotMove) => ElementRef | undefined;
```

**Checkers case (checked):** Checkers move action has args `{ to: <squareElementId as number> }` → `ElementRef = { id: args.to as number }`. Default extraction covers this without needing the override. [VERIFIED: codebase review of checkers rules]

### Anti-Patterns to Avoid

- **Storing hint/heatmap in engine state:** These are transient UI aids. Putting them in `game.tutorialProgress` or any serialized field would break replay determinism (a hint request is not a game action) and checkpoint safety.
- **Re-running MCTS on every broadcast:** `playWithStats()` is expensive. Only re-run when the hint is explicitly requested or heatmap needs a refresh. After a player action, clear hint immediately; re-compute heatmap only if it was toggled on (schedule asynchronously after the action settles).
- **Passing `HeatmapEntry` data through engine serialization:** The `cellRef.id` values are ephemeral numeric element IDs assigned at runtime. They are stable within a session but may change after undo/rewind. Clear heatmap entries after any state replacement (undo, rewind, demo restart).
- **Duplicating `buildSelector` CSS.escape logic:** Import/re-export from `TutorialOverlay.vue` if needed, OR extract to a shared util `src/ui/components/helpers/overlay-utils.ts`. Do NOT copy-paste the CSS.escape polyfill into each overlay.
- **Color-only signalling in heatmap:** The numeric percentage badge MUST be present even at high intensity. Do not omit the badge and rely solely on chip opacity — WCAG 2.2 AA 1.4.1 requirement.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fixed overlay positioned over board cells | Custom layout engine | `getBoundingClientRect()` + `position:fixed` on `<Teleport to="body">` | TutorialOverlay established this as the correct pattern; ResizeObserver handles board resize |
| DOM re-anchoring on board resize | Custom resize listener | `ResizeObserver` on `.boardregion` + target elements | Exact pattern from TutorialOverlay; handles iframe resizes, zoom, scroll |
| CSS.escape for attribute selectors | String sanitization | `CSS.escape()` with polyfill (already in TutorialOverlay) | Prevents selector injection; polyfill already written |
| Narration text delay/timing | `setTimeout` loop | `await new Promise(resolve => setTimeout(resolve, delay))` in `onBeforeMove` | Simple, cancellable by stopDemo() clearing the hook |
| MCTS stats aggregation across parallel searches | Custom voting aggregation | Force `parallel: 1` in `playWithStats()` | Per-child stats are meaningless when merged across independent trees via vote aggregation |
| Turn-awaiting validation before hint request | Custom flow inspection | `canSeatAct(flowState, seat)` from engine (already used by AIController) | Engine-canonical; prevents hints during AI thinking or non-decision states |

**Key insight:** Every hard problem in this phase was already solved by Phase 105 (TutorialOverlay). This phase is structural reuse, not invention.

---

## Common Pitfalls

### Pitfall 1: Root node discarded before stats are read

**What goes wrong:** `playWithStats()` returns empty stats `[]` because `this.searchGame` and `this.rootSnapshot` are set to `null` at lines 291–292 of `mcts-bot.ts` before any caller can read `root.children`.

**Why it happens:** `root` is a local variable in `playSingle()`. If `playWithStats()` calls `play()` internally (naive approach), the root is already discarded.

**How to avoid:** Extract `private runSearch(): Promise<{ move: BotMove; root: MCTSNode }>` that captures the root BEFORE cleanup. `play()` and `playWithStats()` both call `runSearch()`. Cleanup (null assignments) moves into `runSearch()` AFTER the best move is selected but the root reference is returned to callers who can then read it.

**Warning signs:** Test asserting `stats.length > 0` fails intermittently (parallel mode edge case) or always (cleanup happening too early).

### Pitfall 2: Parallel mode returns zero useful stats

**What goes wrong:** `playWithStats()` is called on a bot configured with `parallel: 2`. The parallel path spawns sub-bots, aggregates votes, but each sub-bot's root is local to its own `runSearch()` and is never accessible to the outer aggregator. Result: `stats = []`.

**Why it happens:** `playParallel()` aggregates by vote count, not by tree structure. Each sub-bot produces a complete independent tree — merging them into a single stats array is not meaningful.

**How to avoid:** In `playWithStats()`, force a single-search path regardless of `this.config.parallel`. The hint/heatmap use case does not require parallel ensemble quality. Add to method docs: "Always runs single-mode search; `parallel` config is ignored."

**Warning signs:** Stats array is empty when `config.parallel > 1`. Test with a hard-difficulty bot.

### Pitfall 3: Hint annotation persists after undo

**What goes wrong:** Player requests a hint, sees the ring on square d4. Player undoes. The board returns to the pre-hint state but the hint ring is still visible (highlighting d4 which may no longer be a valid move).

**Why it happens:** `#hint` is in-memory on the session. `StateHistory.undoToTurnStart()` replaces the runner and calls `broadcast()`, but does not clear `#hint`.

**How to avoid:** The `replaceRunner` callback in `StateHistory` (game-session.ts:253–266) is called during undo. Clear `#hint` and `#heatmap` inside `replaceRunner`. Alternatively, clear them in `#stateHistory`'s callbacks.

**Warning signs:** Regression: hint ring persists after undo and points at a cell no longer reachable.

### Pitfall 4: `data-bs-el-id` is the element's numeric runtime ID, not its notation

**What goes wrong:** `HeatmapEntry.cellRef = { id: args.to }` resolves at render time, but `args.to` from `BotMove` contains the engine element ID (a runtime integer). After undo/rewind, element IDs are stable within a session but can differ across restores from snapshot. Heatmap entries pre-dating a rewind may point to wrong cells.

**Why it happens:** MCTS's `serializeArgs()` converts element choices to IDs. These IDs are valid at search time but may mismatch if state is replaced.

**How to avoid:** Clear `#heatmapEntries` on any state replacement (undo, rewind, demo restart) alongside `#hint` clearing. Re-compute heatmap from the new position if the toggle is still on.

**Warning signs:** Heatmap chips appear on wrong cells after undo; a chip on a cell that no longer has a valid move to it.

### Pitfall 5: Heatmap re-computation blocking the AI turn

**What goes wrong:** If heatmap is visible and `#scheduleHeatmapUpdate()` runs concurrently with `#checkAITurn()`, both attempt `playWithStats()` / `play()` on the same game runner, producing concurrent MCTS searches that mutate shared state.

**Why it happens:** Both paths are async and both read `runner.game` for bot creation. MCTSBot clones the game internally via `restoreGame(snapshot)` — so concurrent calls to `createBot(runner.game, ...)` are safe (no shared mutation to `runner.game`). BUT if `AIController.#thinking` is true, the heatmap update should wait.

**How to avoid:** Check `#aiController?.isThinking()` before scheduling a heatmap update. If the AI is thinking, skip the update (the AI's move will trigger a fresh broadcast which re-checks heatmap update need). Add `#heatmapUpdating = false` guard analogous to `#thinking`.

**Warning signs:** Two simultaneous MCTS searches fire; observable as double CPU spikes in tests with `--ai` mode.

### Pitfall 6: Demo mode leaves all-AI config active after stop

**What goes wrong:** `startDemo()` overrides `#aiController` to control all seats. If `stopDemo()` is not called (e.g., page refresh, navigation), the stored `#aiController` remains all-AI on the next reconnect.

**Why it happens:** `#aiController` is in-memory only — not persisted. But if the session is long-lived (dev server mode), the override persists.

**How to avoid:** Demo mode is tracked by `#demoMode: boolean`. `stopDemo()` restores `#savedAIController` and clears narration hook. GameShell calls `stopDemo()` on unmount (cleanup hook). Alternatively: demo mode is a UI-only toggle that creates a SEPARATE GameSession clone for watching (more isolated but more complex). CONTEXT.md says "reuses existing all-seats AI mechanism" which implies in-place override.

**Warning signs:** "Watch AI demo" remains active after clicking "Stop demo"; AI continues playing both seats after stopping.

---

## Code Examples

### Example 1: BotMoveStats type addition (types.ts)

```typescript
// Source: src/ai/types.ts — new export alongside BotMove
/**
 * Per-candidate evaluation stats from a completed MCTS search.
 * Returned by MCTSBot.playWithStats() for hint + heatmap features.
 */
export interface BotMoveStats {
  /** The candidate move */
  move: BotMove;
  /** Visit count for this child node — proportional to confidence */
  visits: number;
  /** Normalized win-rate [0, 1] — 1.0 = certain win, 0.0 = certain loss */
  value: number;
}
```

### Example 2: PlayerGameState teaching fields (types.ts)

```typescript
// Source: src/session/types.ts — additions to PlayerGameState
export interface HeatmapEntry {
  /** Target cell anchor (data-bs-el-id selector) */
  cellRef: ElementRef;
  /** Normalized MCTS win-rate for moves targeting this cell [0, 1] */
  normalizedValue: number;
  /** True on the single highest-value entry (best-move border cue) */
  isBest: boolean;
}

// Inside PlayerGameState:
/**
 * Transient move hint (session-layer only, never serialized).
 * Present when a player has requested a hint at the current decision point.
 * Cleared automatically after any action on the hinting seat.
 */
hint?: { annotation: Annotation };

/**
 * Transient heatmap data (session-layer only, never serialized).
 * Present when heatmap is toggled visible.
 */
heatmap?: { visible: boolean; entries: HeatmapEntry[] };

/**
 * Transient pre-move announcement for AI demo narration.
 * Present for one broadcast cycle (between onBeforeMove + the move execute).
 */
narration?: { text: string };
```

### Example 3: HintOverlay.vue inject and render structure

```typescript
// Source: TutorialOverlay.vue pattern — HintOverlay adapts this
const gameState = inject('gameState') as
  | Ref<{ state: { hint?: { annotation: Annotation } } }>
  | undefined;

const annotation = computed<Annotation | null>(
  () => gameState?.value?.state?.hint?.annotation ?? null,
);

const hasContent = computed(() => annotation.value !== null);
// measure() and rebuildObservers() — identical to TutorialOverlay except for
// operating on a single annotation rather than an array.
```

### Example 4: ControlsMenu Teaching group (UI-SPEC contract)

```typescript
// Source: 107-UI-SPEC.md — ControlsMenu new props
defineProps<{
  // ... existing props ...
  showHint?: boolean;          // undefined = hide Teaching group entirely
  hintDisabled?: boolean;
  isDemoRunning?: boolean;
  isHeatmapVisible?: boolean;
}>();

const emit = defineEmits<{
  // ... existing emits ...
  'teaching-action': ['hint' | 'demo-toggle' | 'heatmap-toggle'];
}>();
```

```html
<!-- Template addition (after "Session" group, before closing </div>) -->
<template v-if="showHint !== undefined">
  <div class="sep"></div>
  <div class="grouplabel">Teaching</div>
  <button class="mi" role="menuitem" :disabled="hintDisabled"
          @click="emit('teaching-action', 'hint'); close()">
    Get a hint
  </button>
  <button class="mi" role="menuitem"
          @click="emit('teaching-action', 'demo-toggle'); close()">
    {{ isDemoRunning ? 'Stop demo' : 'Watch AI demo' }}
  </button>
  <button class="mi" role="menuitemcheckbox" :aria-checked="isHeatmapVisible"
          @click="emit('teaching-action', 'heatmap-toggle')">
    Show move quality
    <span class="r"><span class="toggle" :class="{ on: isHeatmapVisible }"></span></span>
  </button>
</template>
```

### Example 5: GameSession public teaching API

```typescript
// Source: src/session/game-session.ts — new public methods

/**
 * Request a move hint for the given seat.
 * Runs playWithStats() on an ephemeral bot, stores the best move's target
 * annotation, and broadcasts. The hint is automatically cleared after
 * the next action on this seat.
 *
 * Fails loud (throws) if the seat is not currently awaiting input.
 */
async requestHint(seat: number): Promise<void> { ... }

/**
 * Clear the active hint for the given seat and broadcast.
 */
clearHint(seat: number): void { ... }

/**
 * Toggle the evaluation heatmap for the given seat.
 * When turning on: computes stats immediately and broadcasts.
 * When turning off: clears entries and broadcasts.
 */
async setHeatmapVisible(seat: number, visible: boolean): Promise<void> { ... }

/**
 * Start AI-vs-AI narrated demo mode.
 * Overrides all seats to AI control, registers narration hook, and schedules
 * the first AI check. Saves the original AIController for restoration.
 *
 * Narration hook format: "${playerName}: ${actionName} ${argsummary}"
 * Custom formatter may be provided via the optional parameter.
 */
startDemo(options?: {
  narrator?: (action: string, player: number, args: Record<string, unknown>) => string;
  delay?: number; // milliseconds; default 1200
}): void { ... }

/**
 * Stop AI-vs-AI demo mode. Restores the original AIController, clears
 * narration hook and narration text, and broadcasts.
 */
stopDemo(): void { ... }

/** Whether demo mode is currently active */
get isDemoRunning(): boolean { ... }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No public bot stats API | `playWithStats()` (new) | Phase 107 | Unblocks hint + heatmap |
| TutorialOverlay only overlay component | TutorialOverlay + HintOverlay + HeatmapOverlay (new) | Phase 107 | Teaching aids visible independently of tutorial |
| `PlayerGameState` has no teaching fields | Adds `hint`, `heatmap`, `narration` (new transient fields) | Phase 107 | Session layer injects teaching state pre-broadcast |
| `AIController.checkAndPlay()` has no pre-move hook | `onBeforeMove` optional param (new) | Phase 107 | Enables announce-then-execute pacing for demo |

**Deprecated/outdated:**
- Nothing deprecated in this phase. Phase 107 is purely additive.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Default move-target extraction finds `args.to` for checkers moves (covers the Phase 109 test case) | Pattern 5 | Heatmap/hint shows floating bubble instead of cell highlight; author must provide `hintTargetFromMove` override |
| A2 | `MCTSBot` constructed with `runner.game` inside `requestHint()` / `setHeatmapVisible()` is safe to run concurrently with a running AI turn (because MCTSBot clones via `restoreGame()`) | Pitfall 5 | Concurrent mutation of `runner.game` during MCTS search causes search errors |
| A3 | Demo mode restoring the original `#aiController` is sufficient to stop AI play from human seats (i.e., original config did not have all seats as AI) | Pattern 4 (demo) | If original config was already all-AI, stopDemo() has no visible effect; edge case, not a breaking assumption |

---

## Open Questions

1. **Heatmap re-computation after each AI move (if heatmap visible)**
   - What we know: After an AI move, the board position changes. The heatmap entries from before the move are stale.
   - What's unclear: Should the session automatically re-compute (adding MCTS latency after every AI move) or just clear the entries (player must re-toggle)?
   - Recommendation: Schedule async re-computation after AI moves when heatmap is visible — mirrors how `#scheduleAICheck()` works. But gate it on `!#aiController.isThinking()` to prevent concurrent searches.

2. **`stopDemo()` destination when game-over occurs mid-demo**
   - What we know: If the AI plays to game completion, `flowState.complete = true`, and `#scheduleAICheck()` stops.
   - What's unclear: Does the session automatically call `stopDemo()`? Or does the GameShell watch for `game-over` and call it?
   - Recommendation: GameShell watches for `flowState.complete` (already does for GameOverCard) — add `stopDemo()` call there. Keep `GameSession` passive.

3. **Multi-seat game support for hint/heatmap**
   - What we know: Hint and heatmap are designed with `seat` parameter. Checkers is 2-player.
   - What's unclear: For a 3+ player game where only one player has a bot, can players 2 and 3 (non-bot) request hints?
   - Recommendation: Hint/heatmap should be gated on the game having an `ai` config in its `GameDefinition` (which is already how ControlsMenu shows/hides the Teaching group per UI-SPEC). The session can create an ephemeral bot for the hinting seat even if that seat is not normally AI-controlled.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + tests | ✓ | v20+ | — |
| vitest | Tests | ✓ | ^2.1.0 (package.json) | — |
| `@boardsmith/checkers-rules` symlink | Integration tests | ✓ (symlinked via `~/BoardSmithGames/checkers`) | current | Tests excluded from CI if symlink absent |
| Vue 3 | UI components | ✓ | ^3.x | — |

**Missing dependencies with no fallback:** none

**Note on checkers-rules tests:** The project excludes `src/ai/mcts-bot.test.ts` from vitest because it depends on `@boardsmith/checkers-rules` (`vitest.config.ts:18`). New integration tests for `playWithStats()` using the checkers bot MUST be in a new excluded test file (e.g., `src/ai/mcts-stats.test.ts`). Unit tests that use a simple `TestGame` from `src/testing/` can be in an included file.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm run test` (vitest run) |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | `playWithStats()` returns move + non-empty stats array | unit | `npx vitest run src/ai/mcts-stats.test.ts` | ❌ Wave 0 |
| AI-01 | Hint annotation targets the destination cell ElementRef | unit | `npx vitest run src/session/teaching.test.ts` | ❌ Wave 0 |
| AI-01 | Hint clears after action on that seat | unit | `npx vitest run src/session/teaching.test.ts` | ❌ Wave 0 |
| AI-01 | HintOverlay renders ring at target position | unit (component) | `npx vitest run src/ui/components/helpers/HintOverlay.test.ts` | ❌ Wave 0 |
| AI-02 | `onBeforeMove` fires between MCTS compute and performAction | unit | `npx vitest run src/session/ai-controller.test.ts` | ❌ Wave 0 |
| AI-02 | Demo mode sets all seats to AI + fires narration callback | unit | `npx vitest run src/session/teaching.test.ts` | ❌ Wave 0 |
| AI-02 | `stopDemo()` restores original AI controller | unit | `npx vitest run src/session/teaching.test.ts` | ❌ Wave 0 |
| AI-03 | `playWithStats()` with checkers bot returns stats for each candidate move | integration | excluded — `src/ai/mcts-stats.test.ts` | ❌ Wave 0 |
| AI-03 | `buildHeatmapEntries()` deduplicates same-cell entries | unit | `npx vitest run src/session/teaching.test.ts` | ❌ Wave 0 |
| AI-03 | HeatmapOverlay renders chips at correct `data-bs-el-id` positions | unit (component) | `npx vitest run src/ui/components/helpers/HeatmapOverlay.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test` (full suite, fast)
- **Per wave merge:** `npm run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/ai/mcts-stats.test.ts` — covers AI-01 `playWithStats()` with simple TestGame; covers AI-03 with checkers bot (excluded file)
- [ ] `src/session/teaching.test.ts` — covers hint lifecycle, heatmap entries, demo mode
- [ ] `src/session/ai-controller.test.ts` — covers `onBeforeMove` callback threading
- [ ] `src/ui/components/helpers/HintOverlay.test.ts` — component render test
- [ ] `src/ui/components/helpers/HeatmapOverlay.test.ts` — component render test

**TestGame approach for unit tests:** Use `src/testing/` TestGame DSL (already used in `mcts-restore.test.ts`, `mcts-clone-options.test.ts`) — no external checkers dependency, included in vitest run.

---

## Security Domain

> Applies — all three teaching features inject computed text into the DOM.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Narration text derived from action name + args (engine-serialized, not user-typed) — safe; still render via Vue text interpolation, never raw HTML (existing TutorialOverlay T-105-05 rule) |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via narration text | Tampering | Narration text is built from `actionName` (string) + `JSON.stringify(args)` — both engine-controlled. Render via Vue text interpolation (`{{ text }}`), never `v-html`. Matches TutorialOverlay T-105-05. |
| Heatmap overlay intercepting player input | Tampering | `pointer-events: none` on overlay root and all chips (T-105-07 pattern). Never captures clicks. |
| Hint annotation leaking hidden state (wrong game type) | Information Disclosure | Checkers is perfect-information — no hidden state. For future imperfect-info games, `requestHint()` must validate the seat's visibility (deferred to Phase 109+). Document as known gap. |
| MCTS search causing CPU DoS via rapid hint requests | Denial of Service | Gate `requestHint()` and `setHeatmapVisible()` with a per-seat `#hintThinking: boolean` guard analogous to `AIController.#thinking`. Reject concurrent requests loudly. |

---

## Sources

### Primary (HIGH confidence)

- `src/ai/mcts-bot.ts` — verified exact discard point (lines 291–292), root.children structure, `playSingle()` flow [VERIFIED: codebase read]
- `src/ai/types.ts` — verified `MCTSNode { parentMove, visits, value }` at lines 58–87 [VERIFIED: codebase read]
- `src/session/ai-controller.ts` — verified `checkAndPlay()` signature, delay at line 99, hook insertion point [VERIFIED: codebase read]
- `src/session/game-session.ts` — verified `broadcast()` at line 1579, `#checkAITurn()` at line 1636, `buildPlayerState()` call pattern [VERIFIED: codebase read]
- `src/session/types.ts` — verified `PlayerGameState` fields, absence of hint/heatmap/narration [VERIFIED: codebase read]
- `src/session/utils.ts` — verified `buildPlayerState()` is pure (no session reference), tutorial injection pattern [VERIFIED: codebase read]
- `src/ui/components/helpers/TutorialOverlay.vue` — verified Teleport pattern, ResizeObserver, buildSelector, measure(), CSS.escape polyfill [VERIFIED: codebase read]
- `src/ui/components/helpers/BoardMessage.vue` — verified existing variants, role/aria-live pattern [VERIFIED: codebase read]
- `src/ui/components/ControlsMenu.vue` — verified existing props/emits structure, grouplabel pattern [VERIFIED: codebase read]
- `src/ui/components/GameShell.vue` — verified TutorialOverlay mount location (line 1704), gameState provide at line 666, tutorialStep computed at line 392 [VERIFIED: codebase read]
- `src/engine/tutorial/types.ts` — verified `Annotation`, `AnnotationTarget`, `ElementRef` types [VERIFIED: codebase read]
- `vitest.config.ts` — verified excluded test files and alias resolution [VERIFIED: codebase read]
- `~/BoardSmithGames/checkers/src/rules/ai.ts` — verified checkers uses `getCheckersObjectives()`, is symlinked, `args.to` naming convention [VERIFIED: codebase read]

### Secondary (MEDIUM confidence)

- `107-CONTEXT.md` — user decisions verified against code structure; all decisions confirmed buildable with existing patterns [CITED: .planning/phases/107-ai-assisted-teaching/107-CONTEXT.md]
- `107-UI-SPEC.md` — component names, z-index stack, chip specs, ControlsMenu props contract [CITED: .planning/phases/107-ai-assisted-teaching/107-UI-SPEC.md]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all code verified in the repo; zero new packages
- Architecture: HIGH — all four gaps are precisely located; patterns are verified against existing TutorialOverlay/AIController code
- Pitfalls: HIGH — all pitfalls are derived from code inspection (discard point, parallel mode, undo flow)
- Test strategy: HIGH — vitest config verified; exclusion list confirmed; TestGame pattern confirmed in existing tests

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable codebase; no external APIs)
