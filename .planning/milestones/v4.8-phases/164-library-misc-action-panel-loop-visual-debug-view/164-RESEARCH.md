# Phase 164: Library Misc — Action-Panel, Loop, Visual, Debug-View - Research

**Researched:** 2026-07-21
**Domain:** Vue 3 component library internals (GameShell/ActionPanel), flow-engine loop construct, CSS color-contrast math, time-travel debug tooling
**Confidence:** HIGH (all four fixes verified against actual source, not training-data guesses)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**LIBX-01 — Per-action dock suppression + fence `suppressActionPanel`**
- Per-action suppression is declared on the **action definition** and flows through `actionMetadata` — the action owns its dock presentation (Pit of Success). ActionPanel/GameShell filters the rendered dock buttons by this per-action flag.
- The blunt `suppressActionPanel` prop is **kept but renamed loud** to signal it is a platform-only escape hatch (e.g. `platformActionPanelEscapeHatch`), and **removed from the ordinary author-facing scaffold/bridge surface** (de-documented as a normal prop; documented as platform-only, agent told not to use without the client — the skills half is SKILLDEF-03/Phase 166).
- A suppressed action is **still executable** via custom UI / board through `useBoardInteraction` — suppression only hides the dock button, it does not disable the action.
- When **all** dock actions are suppressed, fall back to the **bare turn-prompt strip** (never leave the player with no turn indicator).

**LIBX-02 — loop() unbounded valve + maxIterations observability**
- Express an unbounded loop via an explicit **`unbounded: true`** opt-in on `LoopConfig`, which makes `maxIterations` optional. Greppable, self-documenting, fail-loud if misused.
- The **bounded** cap-hit keeps its current **loud throw** (it is already not silent/winnerless) — improve the message + document it as a safety assertion, not a terminator.
- Even when `unbounded: true`, retain a **high hard-safety global runaway tripwire** (`DEFAULT_MAX_ITERATIONS` whole-flow guard) so a genuinely stuck loop still fails loud rather than hanging the process.
- Document `maxIterations` / `unbounded` semantics in the flow docs; the cap-hit throw is the observable exit signal.

**LIBX-03 — PlayerToken glyph-ink contrast**
- Ink color is **luminance-based auto-contrast** computed from the seat `color` (black on light seats, white on dark).
- **Reuse the existing v2.5 player-color luminance/contrast utility** if one exists; otherwise add a small self-contained helper.
- The `text-shadow` is **derived opposite** to the chosen ink (or dropped when ink is dark) so the halo aids legibility rather than fighting it.
- Threshold uses **WCAG relative-luminance** (pick whichever of black/white contrasts more).

**LIBX-04 — Time-travel debug-view `#game-board` desync**
- **Both** fixes (defense in depth): (a) feed the displayed (historical) state to the board `:state` slot during time-travel, AND (b) gate the action bridge so board clicks **cannot commit** while `isViewingHistory`.
- A board click during history is an **inert no-op commit** (no live mutation); minimum bar is no live-engine mutation.
- **Consolidate** the board so it always reads the *displayed* state — a single source of truth. Remove the divergent always-live `:state` prop during history (allowed under the no-backward-compat rule).
- **Verify + regression-test** that exiting history clears `timeTravelState` back to live correctly.

### Claude's Discretion
- Exact renamed identifier for the fenced escape-hatch prop, helper naming, and test file placement are at Claude's discretion, consistent with codebase conventions.

### Deferred Ideas (OUT OF SCOPE)
- Skills-side enforcement of the escape hatch (SKILLDEF-03) → Phase 166.
- A visible "exit history to act" hint on time-travel board clicks — nice-to-have, not required (min bar is inert no-op).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIBX-01 | Per-action dock suppression via `actionMetadata`; fence `suppressActionPanel` as platform-only escape hatch | `## Standard Stack` / `## Architecture Patterns` §1; exact line numbers + the `manual` flag as a directly-reusable precedent pattern |
| LIBX-02 | `loop()` unbounded valve via `unbounded: true`; keep loud bounded-cap throw; retain global tripwire | `## Architecture Patterns` §2; exact code for `loop()`, `LoopConfig`, `executeLoop`, `DEFAULT_MAX_ITERATIONS` |
| LIBX-03 | `PlayerToken` glyph ink auto-contrast (luminance-based) | `## Don't Hand-Roll` + `## Architecture Patterns` §3; confirms NO existing utility to reuse (searched exhaustively) |
| LIBX-04 | Time-travel debug board desync: unify `:state`, gate action bridge | `## Architecture Patterns` §4; exact data shapes (`GameState` vs `PlayerGameState`) and all 4 desync call sites |
| PROC-01 | Every fix ships fail-on-pre-fix/pass-after test | `## Validation Architecture` maps each fix to its test layer and exact assertion |
</phase_requirements>

## Summary

All four defects are narrow, well-isolated bugs in a mature Vue 3 + custom flow-engine
codebase. None require new dependencies — every fix is pure refactor/addition of existing
patterns already present elsewhere in the codebase (e.g. the `manual` flag on
`ActionDefinition` → `ActionMetadata` is the exact precedent for LIBX-01's per-action
suppression flag; `DEFAULT_MAX_ITERATIONS` already exists as the global tripwire LIBX-02
needs to retain).

I read every file cited in CONTEXT.md's `code_context` directly and confirmed the line
numbers, current behavior, and exact data shapes. One important negative finding for
LIBX-03: **no luminance/contrast utility exists anywhere in `src/`** (exhaustive grep for
`luminance`, `relativeLuminance`, `contrastColor`, WCAG coefficients `0.299`/`0.587`/`0.114`,
and a targeted look at `src/session/colors.ts` — the only color-related utility file —
which contains just a color list with a claim of "consistent luminance" in a comment, no
computation). CONTEXT's "reuse if one exists" branch does not apply; a new self-contained
helper must be written.

**Primary recommendation:** Implement all four fixes as small, additive, well-precedented
changes. LIBX-01 rides the existing `actionMetadata` channel exactly like `manual` does.
LIBX-02 adds one field to `LoopConfig` and one conditional in two functions. LIBX-03 adds a
~20-line WCAG-luminance helper + wires it into `PlayerToken.vue`. LIBX-04 unifies one
computed (`displayedState`, mirroring the existing `gameView` pattern) and adds an
`isViewingHistory` guard to `useBoardActionBridge`'s four commit-capable functions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-action dock visibility | Engine (action definition → `actionMetadata`) | Frontend Server/Client (GameShell/ActionPanel render filter) | The action owns its own presentation intent (Pit of Success); UI is a pure consumer of the flag, exactly like `manual`. |
| Escape-hatch prop fencing | Browser/Client (GameShell prop surface) | — | Pure UI-layer prop rename/scope change; no engine involvement. |
| Loop unbounded valve | Engine (flow builders + flow engine) | — | Flow control is entirely an engine concern; UI never touches `LoopConfig`. |
| Global runaway tripwire | Engine (flow engine `run()`) | — | Already engine-owned; untouched by this phase except documentation. |
| PlayerToken ink contrast | Browser/Client (Vue component + a new pure-function color util) | — | Purely presentational; the color math is a pure function with no engine/session dependency, colocated in `src/ui` (or a shared util module) since PlayerToken is UI-only. |
| Time-travel state unification | Browser/Client (GameShell computed + board slot) | — | `state`/`gameView`/time-travel are all client-side GameShell concerns; the engine/session layers are untouched (they already correctly serve historical state via `getStateAtAction`). |
| Action-bridge history gating | Browser/Client (`useBoardActionBridge` composable) | — | The bridge is the sole client-side dispatch point from board clicks to the action controller; gating belongs there, not duplicated per-consumer. |

## Package Legitimacy Audit

No external packages are installed by this phase — all four fixes are pure refactors of
existing first-party source (Vue components, TS engine modules, doc updates). Skipping the
Package Legitimacy Gate per its own scope condition ("every phase that installs external
packages").

## Architecture Patterns

### System Architecture Diagram (data flow relevant to this phase)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ENGINE (src/engine)                                                  │
│                                                                       │
│  ActionDefinition (action-builder.ts)                               │
│    .manual()  ─────────────┐   [EXISTING PRECEDENT]                 │
│    .suppressFromDock() ────┼─► buildActionMetadata()                │
│                             │   (action-metadata.ts)                 │
│                             │     → ActionMetadata { manual?,        │
│                             │        suppressFromDock? }             │
│  loop({ unbounded, ... }) ──┼─► LoopConfig { unbounded?,             │
│    (builders.ts)            │      maxIterations? }                  │
│                             │        │                                │
│                             │        ▼                                │
│                             │   executeLoop() (engine.ts)            │
│                             │     maxIterations ?? (unbounded         │
│                             │       ? Infinity : DEFAULT_MAX_ITER)   │
│                             │        │                                │
│                             │        ▼                                │
│                             │   run() whole-flow tripwire             │
│                             │     (DEFAULT_MAX_ITERATIONS, untouched) │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼ (over WS/HTTP, serialized PlayerGameState)
┌─────────────────────────────────────────────────────────────────────┐
│ SESSION (src/session)                                                │
│  state-history.ts: getStateAtAction() → historical PlayerGameState  │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ UI (src/ui) — GameShell.vue                                         │
│                                                                       │
│  state (GameState, from useGame) ──┐                                 │
│  timeTravelState (historical       ├─► displayedState (computed)     │
│    PlayerGameState from Debug-     │     [NEW — unifies gameView's   │
│    Panel's time-travel event)      │      existing pattern]          │
│                                    │        │                        │
│                                    │        ▼                        │
│                                    │   #game-board slot :state=      │
│                                    │     "displayedState" (was       │
│                                    │      always-live `state`)       │
│                                    │                                  │
│  isViewingHistory (computed) ──────┼─► useBoardActionBridge(         │
│                                    │     { isViewingHistory, ... })   │
│                                    │        │                        │
│                                    │        ▼                        │
│                                    │   startAction/executeAction/     │
│                                    │   setSelectionValue/             │
│                                    │   toggleMultiSelectValue         │
│                                    │     early-return when            │
│                                    │     isViewingHistory (NEW guard) │
│                                    │                                  │
│  actionMetadata[name]              │                                  │
│    .suppressFromDock ──────────────┼─► ActionPanel visibleActions    │
│                                    │     filter (NEW)                 │
│                                    │        │                        │
│                                    │        ▼                        │
│                                    │   GameShell: if ALL dock actions │
│                                    │     suppressed → bare turn-      │
│                                    │     prompt strip fallback (NEW)  │
│                                    │                                  │
│  PlayerToken.vue: color prop ──────┼─► contrastInk(color) (NEW util) │
│                                    │     → .ini { color, text-shadow }│
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (files touched, no new directories)
```
src/engine/action/
├── types.ts              # ActionDefinition: add suppressFromDock?: boolean
├── action-builder.ts      # add .suppressFromDock() builder method (mirrors .manual())
src/engine/element/
├── action-metadata.ts      # buildActionMetadata: thread suppressFromDock into ActionMetadata
src/engine/flow/
├── types.ts               # LoopConfig: add unbounded?: boolean
├── builders.ts             # loop(): allow maxIterations undefined when unbounded===true
├── engine.ts               # executeLoop(): maxIterations fallback → Infinity when unbounded
src/session/
├── types.ts                # ActionMetadata: add suppressFromDock?: boolean (mirrors manual?)
src/ui/utils/                # NEW small pure-function color-contrast helper (or colocate in
│                            # PlayerToken.vue's <script> if kept single-file per convention —
│                            # see Don't Hand-Roll for naming/placement discretion)
src/ui/components/
├── PlayerToken.vue          # ink = contrastInk(color); text-shadow derived opposite
├── GameShell.vue            # rename suppressActionPanel → platform-only escape hatch;
│                            # displayedState computed; all-suppressed dock fallback;
│                            # isViewingHistory passed to useBoardActionBridge
src/ui/composables/
├── useBoardActionBridge.ts  # BoardActionBridgeOptions: add isViewingHistory; guard commits
src/ui/components/auto-ui/
├── ActionPanel.vue          # visibleActions filters out actionMetadata[name].suppressFromDock
docs/
├── common-pitfalls.md       # update §6 loop() pitfall with unbounded: true
├── actions-and-flow.md      # document unbounded valve + per-action dock suppression
```

### Pattern 1: Per-action metadata flag (LIBX-01) — follow the `manual` precedent exactly

**What:** `ActionDefinition.manual?: boolean` is set via `.manual()` on the builder, flows
through `buildActionMetadata()` into `ActionMetadata.manual`, and is read by
`useBoardActionBridge.tryAutoStartSingleAction`. This is a complete, working, three-layer
precedent (engine type → engine builder → engine metadata-builder → UI consumer) for exactly
the shape LIBX-01 needs.

**When to use:** Any per-action UI hint that the action author, not the platform, should
control.

**Example (existing code to mirror), from `src/engine/action/action-builder.ts:164-167`:**
```typescript
// Source: src/engine/action/action-builder.ts (read directly, not training data)
manual(): this {
  this.definition.manual = true;
  return this;
}
```
and `src/engine/element/action-metadata.ts` (buildActionMetadata, read directly):
```typescript
metadata[actionName] = {
  name: actionName,
  prompt: actionDef.prompt,
  help: actionDef.help,
  ...(actionDef.manual ? { manual: true } : {}),
  selections: pickMetas,
};
```

**Recommended new field:** add a sibling `suppressFromDock?: boolean` (name at Claude's
discretion; avoid the word "hide" alone — the action stays *executable*, only the dock
*button* disappears — so a name like `suppressFromDock`/`hiddenFromDock`/`dockHidden` should
communicate "still executable via board/custom-UI"). Follow the exact same three-line
`...(actionDef.suppressFromDock ? { suppressFromDock: true } : {})` spread pattern.

**ActionPanel consumption (LIBX-01 dock filter):** `ActionPanel.vue`'s `visibleActions`
computed (currently a passthrough at lines 166-168, `return actionsWithMetadata.value;`) is
the single, already-identified filter point:
```typescript
// src/ui/components/auto-ui/ActionPanel.vue:166-168 (current, read directly)
const visibleActions = computed(() => {
  return actionsWithMetadata.value;
});
```
Change to `.filter(a => !a.suppressFromDock)`. This is the ENTIRE per-action dock-hiding
implementation on the render side — no other change is needed in ActionPanel because
`actionsWithMetadata` already carries the full metadata and the board substrate
(`useBoardActionBridge`) is fed independently and unconditionally, so a dock-suppressed
action remains clickable on the board (satisfies "still executable via custom UI / board").

**All-suppressed fallback (GameShell):** GameShell must detect "every dock action is
suppressed" and fall back to the bare turn-prompt strip. The turn-prompt `<span class="turn">`
already exists at `GameShell.vue:2424-2429`, currently gated on
`v-if="props.suppressActionPanel"` only. Add a new computed, e.g.:
```typescript
const allDockActionsSuppressed = computed(() => {
  const meta = actionMetadata.value;
  const names = availableActions.value as string[];
  if (!meta || names.length === 0) return false; // no metadata → default unsuppressed rendering
  return names.length > 0 && names.every(n => meta[n]?.suppressFromDock);
});
```
and change the turn-strip `v-if` to
`v-if="props.platformActionPanelEscapeHatch || allDockActionsSuppressed"`, and the
ActionPanel-mount `v-if` to `v-if="!props.platformActionPanelEscapeHatch && !allDockActionsSuppressed"`
(so both the escape hatch AND the natural exhaustion of dock actions produce the same safe
fallback — a single code path for "no dock buttons to show," per Pit of Success).

**Escape-hatch fencing:** Rename the prop (decl `GameShell.vue:140`, default `:177`, usages
`:2425`/`:2436`) from `suppressActionPanel` to a loud platform-only name. Per CONTEXT +
`SKILLDEF-03` cross-reference, this identifier will be referenced BY NAME from the Phase 166
skills work — pick something skill-writers can grep for confidently, e.g.
`platformActionPanelEscapeHatch`. Update the doc comment to explicitly say "platform-only;
do not use from a game's own scaffold/bridge — see per-action `suppressFromDock` on the
action definition instead," and remove any scaffold-template/bridge-doc reference that
currently offers it as an ordinary prop (`useBoardActionBridge.ts:15` comment references
`suppressActionPanel` in its own doc-comment and should be updated to the new name +
clarify platform-only scope).

### Pattern 2: `loop()` unbounded valve (LIBX-02)

**Current state (read directly), `src/engine/flow/builders.ts:79-109`:**
```typescript
export function loop(config: {
  name?: string;
  while?: (context: FlowContext) => boolean;
  maxIterations?: number;
  do: FlowNode;
}): FlowNode {
  if (config.maxIterations === undefined) {
    throw new Error(
      `loop(${config.name ? `'${config.name}'` : ''}) requires maxIterations.\n` + ...
    );
  }
  return {
    type: 'loop',
    config: { name: config.name, while: config.while, maxIterations: config.maxIterations, do: config.do },
  };
}
```

**Recommended change:** add `unbounded?: boolean` to the config param and to `LoopConfig`
(`src/engine/flow/types.ts:89-96`), and only throw when BOTH `maxIterations === undefined`
AND `!config.unbounded`:
```typescript
if (config.maxIterations === undefined && !config.unbounded) {
  throw new Error(
    `loop(${config.name ? `'${config.name}'` : ''}) requires maxIterations, or an explicit ` +
    `unbounded: true opt-in for a genuinely unbounded game.\n` +
    `  Bounded:   loop({ maxIterations: 100, while: ..., do: ... })\n` +
    `  Unbounded: loop({ unbounded: true, while: ..., do: ... })\n` +
    `  A high global safety tripwire (${DEFAULT_MAX_ITERATIONS_DOC_VALUE} whole-flow steps) ` +
    `still applies even when unbounded.\n` +
    `  See: https://boardsmith.io/docs/common-pitfalls#loop-safety`
  );
}
return {
  type: 'loop',
  config: { name: config.name, while: config.while, maxIterations: config.maxIterations, unbounded: config.unbounded, do: config.do },
};
```

**Engine execution change, `src/engine/flow/engine.ts:1268-1309` (`executeLoop`, read
directly):** currently `const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;`
— this means an unbounded-intent loop with no `maxIterations` would (today) still throw its
own "safety assertion" error at exactly `DEFAULT_MAX_ITERATIONS` (10000) iterations, which
directly contradicts "unbounded." Change to:
```typescript
const maxIterations = config.maxIterations ?? (config.unbounded ? Infinity : DEFAULT_MAX_ITERATIONS);
```
This is the ENTIRE engine-side change. The bounded per-loop cap-hit throw (lines 1287-1301)
is untouched — it still fires whenever a numeric `maxIterations` is set (whether or not
`unbounded` is also set — CONTEXT does not forbid setting both, and doing so is a reasonable
defense-in-depth author pattern: "unbounded in principle, but still cap at N as an extra
tripwire"). **The whole-flow tripwire in `run()` (line 1149,
`DEFAULT_MAX_ITERATIONS = 10000`) is completely independent of any single loop's config** —
it counts total flow-step executions across the ENTIRE flow stack, not one loop's iteration
counter — so it already IS the "high hard-safety global runaway tripwire" CONTEXT asks to
retain. No change needed there; only verify + document that it still applies to an
`unbounded: true` loop (it does, automatically, because it's structurally separate from
`executeLoop`'s own per-loop counter).

**Message improvement for the bounded cap-hit throw (lines 1288-1300):** CONTEXT asks to
"improve the message + document it as a safety assertion, not a terminator" — the message
already says this almost verbatim ("maxIterations is a safety assertion to catch runaway
loops, NOT a way to end a loop"). Minor: add a one-line mention that `unbounded: true` exists
for games that need no per-loop cap, so an author who over-provisions `maxIterations` instead
of reaching for `unbounded` sees the better tool.

**`turnLoop()`/`stateAwareLoop()` interaction:** both already default `maxIterations` (100)
and always pass a concrete number to `loop()`, so they never hit the `unbounded` branch
unless a caller explicitly threads `unbounded: true` through (not currently in their config
shape — out of scope unless CONTEXT wants it; CONTEXT only names `loop()`/`LoopConfig`, so
leave `turnLoop`/`stateAwareLoop` untouched).

### Pattern 3: WCAG relative-luminance contrast (LIBX-03) — new self-contained utility

**Confirmed absence of a reusable utility:** exhaustive `grep -rln` across `src/` for
`luminance`, `relativeLuminance`, `contrastColor`, `getContrastColor`, `wcagContrast`,
`hexToRgb`, `parseColor`, and the WCAG luminance coefficients (`0.299`, `0.587`, `0.114` —
note: WCAG 2.x actually uses a different, gamma-corrected formula, not simple perceptual
luminance — see below) returned **zero matches** outside this research session's own
grep of `src/session/colors.ts`, which contains only a color list (`STANDARD_PLAYER_COLORS`)
with an English comment claiming "consistent luminance" — no computation exists. CONTEXT's
"reuse the existing v2.5 utility if one exists" branch does not apply; write a new helper.

**WCAG 2.x relative luminance formula (the correct standard, NOT the naive 0.299/0.587/0.114
NTSC formula, which is for a different purpose):**
```typescript
// Source: WCAG 2.1 §1.4.3 relative luminance definition (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance)
function srgbChannelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rl, gl, bl] = [r, g, b].map(srgbChannelToLinear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

// WCAG contrast ratio between two luminances (both in [0,1])
function contrastRatio(l1: number, l2: number): number {
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastInk(seatColor: string): { ink: '#000000' | '#ffffff'; textShadow: string } {
  const bgLum = relativeLuminance(seatColor);
  const blackContrast = contrastRatio(bgLum, relativeLuminance('#000000'));
  const whiteContrast = contrastRatio(bgLum, relativeLuminance('#ffffff'));
  const ink = whiteContrast >= blackContrast ? '#ffffff' : '#000000';
  // Halo derived opposite to the chosen ink (or dropped when ink is dark, per CONTEXT):
  const textShadow = ink === '#ffffff' ? '0 1px 2px rgba(0,0,0,.5)' : 'none';
  return { ink, textShadow };
}
```
`hexToRgb` needs a small parser; `PlayerToken.color` prop is typed `string` and accepts any
CSS color (per its own comment "Falls back to the accent token"), so the parser should
handle `#rgb`/`#rrggbb` at minimum. Consider using the DOM (`getComputedStyle` on a detached
element, or the Canvas 2D API `ctx.fillStyle` normalization trick) if a game supplies a named
CSS color (`'red'`) or `rgb(...)` string rather than hex — `STANDARD_PLAYER_COLORS` in
`src/session/colors.ts` are all hex, but custom game palettes are NOT constrained to hex
(`createColorOption` accepts arbitrary `ColorChoice.value: string`). **Recommend**: use a
tiny canvas-based normalizer (`canvas.getContext('2d')!.fillStyle = input; ctx.fillStyle`
returns a normalized `rgb(...)` or `rgba(...)` string across all valid CSS color syntaxes)
rather than hand-rolling a full CSS color-name table — this is the standard trick and avoids
a large lookup table for named colors. Guard for SSR/non-DOM test environments (vitest runs
under jsdom per the existing test suite, so `document.createElement('canvas')` is available,
but this MUST be checked/mocked correctly in a component unit test — canvas 2D context is
famously unimplemented in plain jsdom without a canvas polyfill; verify before committing to
this approach, see Common Pitfalls below).

**Placement:** Since `PlayerToken.vue` is the only consumer today, a small colocated
function inside `PlayerToken.vue`'s `<script setup>` is acceptable and matches this file's
existing style (pure functions `shape()`/`initial()` already live in the SFC). If Claude's
discretion favors reuse-readiness (other components may want ink contrast later — e.g. any
future colored badge), extract to `src/ui/utils/color-contrast.ts` instead. Either is fine
per CONTEXT's explicit discretion grant; a new small file is slightly more Pit-of-Success
(discoverable, testable in isolation without mounting a component) and is the RECOMMENDED
choice.

**Text-shadow derivation:** CONTEXT: "derived opposite to the chosen ink (or dropped when
ink is dark)." Current CSS (`PlayerToken.vue` `.tok .ini`, read directly) hardcodes both
`color: rgba(255,255,255,.95)` AND `text-shadow: 0 1px 2px rgba(0,0,0,.5)` — both need to
become dynamic inline styles (bound via the existing `:style` binding already used for
`--tc`/width/height/fontSize), not scoped CSS, since the ink is now computed per-instance.

### Pattern 4: Time-travel state unification + action-bridge gating (LIBX-04)

**Data shapes (confirmed by direct read, not assumption):**
- `state` (from `useGame()`, `src/client/vue.ts:70`, typed `GameState` in
  `src/client/types.ts:173-185`) = `{ flowState, state: PlayerState, playerSeat, isSpectator }`.
- `timeTravelState.value` (set in `GameShell.vue` `handleTimeTravel`,
  lines 1786-1794) is assigned directly from `DebugPanel.vue`'s `selectAction()` emit,
  `emit('time-travel', stateData.state, actionIndex, stateDiff.value)` (line 1270), where
  `stateData` comes from `StateHistory.getStateAtAction()` (`src/session/state-history.ts:126`,
  return shape `{ success: boolean; state?: PlayerGameState; error?: string }`). So
  `timeTravelState.value` is a raw `PlayerGameState` — the SAME shape as `state.value.state`,
  NOT the same shape as the outer `state.value` (`GameState`) wrapper.
- This is confirmed by the existing `gameView` computed (`GameShell.vue:473-478`, read
  directly): `timeTravelState.value.view` (one level) vs `state.value?.state.view` (two
  levels) — exactly the asymmetry described.

**The fix — a `displayedState` computed that reconstructs a `GameState`-shaped object:**
```typescript
// New computed, sits next to `gameView` (GameShell.vue ~line 473)
const displayedState = computed<GameState | null>(() => {
  if (timeTravelState.value) {
    // Re-wrap the historical PlayerGameState into the same GameState shape the
    // board slot already expects, so no consumer needs a shape-aware branch.
    return state.value ? { ...state.value, state: timeTravelState.value } : null;
  }
  return state.value;
});
```
Replace `:state="state"` with `:state="displayedState"` at the TWO board-rendering call
sites that are the actual `#game-board` surface: `GameShell.vue:2322` (`:is="selectedUiComponent"`
branch) and `:2342` (`<slot name="game-board">` fallback branch) — both render the SAME
logical board, gated by `v-if="selectedUiComponent"`/`v-else`, so both must be fixed
together (fixing only one leaves the dev UI-switcher's alternate-UI path still desynced).

**Secondary, lower-priority desync (found but NOT in CONTEXT's required scope):**
`GameShell.vue:2152`, the `#sidebar-extra` slot, also passes `:state="state"` (always live)
alongside `:game-view="gameView"` (historical-aware) — the same shape mismatch exists there.
CONTEXT's `code_context` only names the board slot; recommend the planner note this as a
"while we're in here" opportunistic fix using the SAME `displayedState` computed (zero
marginal cost since the computed already exists) OR explicitly defer it — either is
consistent with "Consolidate the board so it always reads the *displayed* state," which by
its wording is scoped to "the board," not the sidebar. **Recommendation: fix it too** — it
is the identical one-line change (`:state="state"` → `:state="displayedState"`) and leaving
a second, un-mentioned desync source right next to the one being fixed contradicts "a single
source of truth" framing. Flag as in-scope-by-extension in the plan, not a scope creep risk
(zero new surface area, same computed, same file, same PR).

**Action-bridge gating (defense-in-depth per CONTEXT):** `useBoardActionBridge.ts` has no
`isViewingHistory` parameter today (confirmed: `grep -n isViewingHistory` across the
composable, `ActionPanel.vue`, and `useActionController.ts` returns NO matches — this
concept is 100% local to `GameShell.vue`). Add it to `BoardActionBridgeOptions`:
```typescript
export interface BoardActionBridgeOptions {
  // ...existing fields...
  /** Reactive: true while the debug panel is showing a historical state. Board
   *  clicks must never commit to the live engine while this is true (LIBX-04). */
  isViewingHistory: Ref<boolean> | ComputedRef<boolean>;
}
```
and add an early-return guard at the top of the four commit-capable functions identified by
direct read of `useBoardActionBridge.ts`:
- `startAction` (line 173) — currently starts a controller action unconditionally when called.
- `executeAction` (line 189) — currently checks `isExecuting`/`isMyTurn` but NOT `isViewingHistory`.
- `setSelectionValue` (line 204) — currently has NO turn/history guard at all (relies on
  `currentPick` only existing because a real action was started, which historically HAS
  been the only gate — insufficient once the user starts an action, then time-travels
  mid-pick).
- `toggleMultiSelectValue` (line 226) — same gap as `setSelectionValue`.

Recommended guard, one line at the top of each:
```typescript
if (isViewingHistory.value) return;
```
This produces exactly the CONTEXT-specified "inert no-op commit" — the click's downstream
handler simply returns, no controller/board mutation occurs, no error, no visible failure
mode. Wire `isViewingHistory` from GameShell's existing `isViewingHistory` computed
(line 338) into the `useBoardActionBridge({...})` call site (line 790-797).

**Verify-on-exit regression:** CONTEXT calls out explicitly verifying that exiting history
(`handleTimeTravel(null, null, null)`, emitted by `DebugPanel.vue` lines 1275/1288) correctly
clears `timeTravelState` back to `null`, which flows through both `gameView` (existing) and
the new `displayedState` back to live `state.value`. This is already correctly wired
(`timeTravelState.value = historicalState` where `historicalState` is `null` on exit) — the
regression test should assert this explicitly (see Validation Architecture) since it is easy
to accidentally break when refactoring the two computeds together (e.g. an `??` vs falsy
check that treats an intentionally-empty-but-truthy object differently).

### Anti-Patterns to Avoid
- **Duplicating the isMyTurn-AND-not-history compose trick as the SOLE gate:** relying only
  on `isMyTurn && !isViewingHistory` fed into the bridge's existing `isMyTurn` gate looks
  simpler but has a real gap — `setSelectionValue`/`toggleMultiSelectValue` don't re-check
  `isMyTurn` mid-action (a pick already in progress bypasses that check entirely), so a
  user who starts an action then opens time-travel mid-pick could still commit a stale
  selection. Use the explicit `isViewingHistory` guard on all four functions, not a derived
  `isMyTurn`.
- **Hand-rolling a CSS-named-color table for LIBX-03** instead of the canvas
  `fillStyle`-normalization trick or a minimal hex-only parser scoped to what
  `STANDARD_PLAYER_COLORS` + typical game palettes actually use.
- **Treating `unbounded: true` as removing ALL safety** — CONTEXT is explicit that the
  global whole-flow tripwire (10000 steps, `run()`) must still apply. Do not special-case
  `run()`'s tripwire for unbounded loops; it is structurally already loop-agnostic and
  should stay that way.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-action UI hint plumbing | A parallel/new metadata channel outside `actionMetadata` | The existing `actionMetadata` → `ActionMetadata` channel, mirroring `.manual()` | Two independent per-action metadata systems immediately drift; `manual` already proves the channel end-to-end. |
| CSS color parsing (named colors, rgb(), hsl()) | A hand-written CSS-color-name lookup table | Canvas 2D `fillStyle` normalization (`ctx.fillStyle = input; ctx.fillStyle` → normalized `rgb()`/`rgba()`) | The browser already implements complete CSS Color Level 4 parsing; a hand-rolled table will miss `hsl()`, `oklch()`, alpha forms, etc., and silently misclassify contrast on an unsupported input. |
| Flow-loop safety net | A second, unbounded-loop-specific iteration counter | The existing whole-flow `DEFAULT_MAX_ITERATIONS` tripwire in `run()` | It is already structurally independent of any single loop's `maxIterations` and already covers the "genuinely stuck unbounded loop" case; adding a second counter risks two safety nets disagreeing. |

**Key insight:** every one of the four fixes has a working precedent or existing mechanism
already in this codebase to extend, rather than a novel mechanism to invent. The research
task was almost entirely "find the precedent and the exact insertion point," not "design a
new pattern."

## Common Pitfalls

### Pitfall 1: jsdom + Canvas 2D context for the LIBX-03 color normalizer
**What goes wrong:** `HTMLCanvasElement.getContext('2d')` throws/returns `null` under plain
jsdom (BoardSmith's test env per `vitest.config.ts` + existing `TOOL-03`/D19 fix history,
which specifically had to work around a different jsdom gap — `window.matchMedia` — showing
this codebase already has jsdom-gap experience).
**Why it happens:** jsdom does not implement canvas rendering by default; `canvas` npm
package (native bindings) would be required, and CLAUDE.md forbids adding dependencies
without discussion.
**How to avoid:** Verify with a quick spike (`document.createElement('canvas').getContext('2d')`
inside a vitest file) BEFORE committing to the canvas-normalization approach. If it returns
`null`/throws in this repo's jsdom config, fall back to a minimal parser that handles hex
(`#rgb`, `#rrggbb`) and `rgb()`/`rgba()` — which covers `STANDARD_PLAYER_COLORS` (all hex)
and the common custom-palette case — and throws a clear, actionable error for unsupported
formats (Pit of Success: fail loud with a fixable message, not silent wrong-contrast).
**Warning signs:** A component test for `PlayerToken` that asserts ink color renders green
(false pass) in CI because the canvas call silently no-oped instead of throwing.

### Pitfall 2: `loop()`'s construction-time throw test needs updating, not just extending
**What goes wrong:** `src/engine/flow/builders.test.ts` (read directly) already has
`expect(() => loop({ do: noop() })).toThrow(/maxIterations/)` — this exact test remains
correct (no `unbounded` passed → still throws), but a naive "add unbounded support" patch
could accidentally make ANY missing-`maxIterations` call silently pass if the `unbounded`
check is inverted or defaults to `true`.
**Why it happens:** boolean-flag-inversion is a classic off-by-inversion bug in exactly this
kind of "make X optional under condition Y" change.
**How to avoid:** the pre-fix test (already fails-if-regressed since it's already green) PLUS
a new fail-on-pre-fix/pass-after test asserting `loop({ unbounded: true, do: noop() })` does
NOT throw, and asserting `executeLoop` never hits the per-loop cap-hit throw for an unbounded
loop with no numeric cap even past `DEFAULT_MAX_ITERATIONS` iterations of the OUTER flow
(distinguish "per-loop cap-hit throw never fires" from "the flow can still run past 10000
total steps and hit the whole-flow tripwire" — these are two different assertions and the
test suite should have both).
**Warning signs:** A green suite that never actually drives an unbounded loop past 100/10000
iterations to prove the tripwire boundary.

### Pitfall 3: Fixing only ONE of the two `:state="state"` board call sites
**What goes wrong:** `GameShell.vue` renders the board via two mutually-exclusive branches
(`v-if="selectedUiComponent"` at 2322, `v-else` slot at 2342) depending on the `boardsmith
dev` UI-switcher selection (per `dev-ui-switcher.md` memory). Fixing only the slot branch
(2342) leaves the dynamic-component branch (2322) — the one active whenever a game has
multiple `uis` registered and a non-default one is selected — still desynced.
**Why it happens:** the two branches look like near-duplicates and it's easy to edit one and
miss the other since they're ~20 lines apart with different surrounding markup.
**How to avoid:** grep `:state="state"` across the whole file before considering LIBX-04
done, and confirm the count drops from 4 (2152, 2322, 2342, 2469) to exactly 1 remaining
(`2469`, the `DebugPanel` itself, which legitimately needs the always-live `state` since it
IS the time-travel control surface and must keep showing the live history regardless of
what's currently displayed).
**Warning signs:** A component test that only mounts via the slot path and never exercises
the `uis`-array / dynamic-component path.

### Pitfall 4: `suppressActionPanel` rename breaking existing consumer games silently
**What goes wrong:** Per CLAUDE.md, "No Backward Compatibility" is the house rule (rename +
break, no deprecation cycle) — but the sibling repos (`~/BoardSmithGames/*`, symlinked; and
the vendored `~/Dropbox/MERC/BoardSmith/MERC`) may reference `suppressActionPanel` as a prop
today. A rename without checking those repos will silently no-op (Vue simply ignores an
unknown prop) rather than erroring — the WORST failure mode (silent behavior change, not a
loud break).
**Why it happens:** Vue does not warn on an unrecognized prop passed to a component with
`defineProps` unless attribute inheritance/fallthrough triggers a dev warning for a
non-prop attribute landing on the root element — which may or may not surface depending on
how the game's GameShell usage is structured.
**How to avoid:** `grep -rn "suppressActionPanel" ~/BoardSmithGames ~/BoardSmithGames2` (if
present) before/after the rename, per CLAUDE.md's own instruction to "verify against
[sibling repos] when a BoardSmith change affects games." This phase is scoped
"library layer only... No game-repo edits in this phase" per CONTEXT's `<domain>` section,
so the ACTION here is verification/awareness, not fixing game repos — but the research
should flag it so the planner can decide whether a grep-only verification step belongs in
this phase's tasks.
**Warning signs:** A sibling game silently stops suppressing its action panel after this
phase ships, discovered only during a later playtest (exactly the class of bug the v4.8
post-mortem battery was designed to catch).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed: `package.json` `"test": "vitest run"`, `vitest.config.ts` present) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run <path-to-file> ` |
| Full suite command | `npm run test` (`vitest run`) |

Component tests use `@vue/test-utils` under jsdom (confirmed by existing
`GameShell.*.test.ts` naming convention: `GameShell.restart.test.ts`,
`GameShell.game-over.test.ts`, `GameShell.ia.test.ts`, etc. — one focused test file per
GameShell feature area, which this phase should follow with e.g.
`GameShell.action-panel-suppression.test.ts` and `GameShell.time-travel-desync.test.ts`).
Engine-only logic (loop, action-metadata) has its own colocated `*.test.ts` files with no
Vue/DOM dependency (`src/engine/flow/builders.test.ts`, `src/engine/flow/engine.test.ts`,
`src/engine/element/action-metadata.test.ts`).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIBX-01 | Action with `suppressFromDock: true` is absent from `ActionPanel`'s rendered dock button list but still present in `availableActions`/executable via board substrate | component (vue-test-utils) | `npx vitest run src/ui/components/auto-ui/ActionPanel.test.ts` (extend) or new `ActionPanel.dock-suppression.test.ts` | ❌ new file/spec |
| LIBX-01 | All dock actions suppressed → GameShell renders bare turn-prompt strip, never zero turn indicator | component (vue-test-utils, GameShell) | `npx vitest run src/ui/components/GameShell.action-panel-suppression.test.ts` | ❌ Wave 0 |
| LIBX-01 | Renamed escape-hatch prop still fully suppresses the panel (regression on existing behavior under new name) | component | same file as above | ❌ Wave 0 |
| LIBX-02 | `loop({ unbounded: true, do })` does not throw at construction | engine unit | `npx vitest run src/engine/flow/builders.test.ts` (extend) | ✅ file exists, extend |
| LIBX-02 | `executeLoop` never hits the per-loop cap-hit throw for `unbounded: true` with no `maxIterations`, across an iteration count that WOULD have hit `DEFAULT_MAX_ITERATIONS` if bounded | engine unit | `npx vitest run src/engine/flow/engine.test.ts` (extend) | ✅ file exists, extend |
| LIBX-02 | Bounded cap-hit still throws the loud "safety assertion" error (no regression) | engine unit | same file | ✅ existing coverage — verify still passes |
| LIBX-03 | `contrastInk('#ecf0f1')` (near-white seat) returns black ink; `contrastInk('#2c3e50')`-class dark seat returns white ink | unit (pure function, no DOM) | `npx vitest run src/ui/utils/color-contrast.test.ts` (new, or colocated with PlayerToken) | ❌ new file |
| LIBX-03 | `PlayerToken` renders computed ink color + correctly-derived/dropped text-shadow for a light vs. dark seat color | component (vue-test-utils) | new `PlayerToken.contrast.test.ts` | ❌ new file — confirmed no existing `PlayerToken*test*` file today |
| LIBX-04 | Board `:state` slot prop reflects historical state during time-travel (not live state) at BOTH board-render call sites | component (vue-test-utils, GameShell) | `npx vitest run src/ui/components/GameShell.time-travel-desync.test.ts` | ❌ Wave 0 |
| LIBX-04 | A simulated board click during `isViewingHistory` does not call `controller.execute`/`controller.fill` (no live mutation) | component/integration (mock `useBoardActionBridge` controller, assert no-op) | same file | ❌ Wave 0 |
| LIBX-04 | Exiting history (`handleTimeTravel(null, null, null)`) restores `displayedState` to live `state` | component | same file | ❌ Wave 0 |
| PROC-01 | Each of the above has a fail-on-pre-fix/pass-after pairing verified by running the test against the pre-fix `git stash`/checkout of the touched file | process discipline, not a separate test | N/A — verification step per PROC-01, not a new automated test | N/A |

### Sampling Rate
- **Per task commit:** run the specific new/extended test file(s) for that fix
  (`npx vitest run <file>`).
- **Per wave merge:** `npm run test` (full suite) — this repo's suite is large (2900+ tests
  per STATE.md's last activity note); do not run it more than once per wave/merge point.
- **Phase gate:** full suite green before `/gsd:verify-work`, per this repo's established
  discipline (every prior phase 155-163 closed this way per STATE.md).

### Wave 0 Gaps
- [ ] `src/ui/components/GameShell.action-panel-suppression.test.ts` — LIBX-01 dock-filter +
  all-suppressed fallback + renamed escape-hatch regression
- [ ] `src/ui/components/auto-ui/ActionPanel.dock-suppression.test.ts` (or extend
  `ActionPanel.test.ts`) — per-action `suppressFromDock` filter on `visibleActions`
- [ ] `src/ui/utils/color-contrast.test.ts` (or colocate) — pure-function WCAG contrast math,
  independent of the canvas-vs-jsdom question (test the math with a stubbed/mocked color
  parser if the canvas approach is used, so the pure-math unit test doesn't depend on jsdom
  canvas support)
- [ ] `src/ui/components/PlayerToken.contrast.test.ts` — no `PlayerToken*test*` file exists
  today; this is a net-new test surface
- [ ] `src/ui/components/GameShell.time-travel-desync.test.ts` — LIBX-04 unified
  `displayedState` + action-bridge history gating + exit-restores-live regression
- [ ] Extend existing `src/engine/flow/builders.test.ts` + `src/engine/flow/engine.test.ts`
  for LIBX-02 (no new file needed, no framework gap)

## Sources

### Primary (HIGH confidence — read directly from the working tree, not training data)
- `/Users/jtsmith/BoardSmith/src/ui/components/GameShell.vue` (props 124-179; actionMetadata
  computed 400-405/464; gameView computed 473-478; time-travel state 334-338; handleTimeTravel
  1786-1794; board-render call sites 2140-2166/2320-2362; dock/actionbar 2377-2464;
  useBoardActionBridge wiring 784-797)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useBoardActionBridge.ts` (full file, 567 lines)
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/ActionPanel.vue` (props 45-77;
  actionsWithMetadata/visibleActions 140-168; button render 806-846)
- `/Users/jtsmith/BoardSmith/src/engine/element/action-metadata.ts` (full file — `manual`
  precedent, `buildActionMetadata`, `buildPickMetadata`)
- `/Users/jtsmith/BoardSmith/src/engine/action/action-builder.ts` (`.manual()` 152-167)
- `/Users/jtsmith/BoardSmith/src/engine/action/types.ts` (`manual?: boolean` 459-463)
- `/Users/jtsmith/BoardSmith/src/engine/flow/builders.ts` (`loop()` 68-109, `turnLoop()` 470-543)
- `/Users/jtsmith/BoardSmith/src/engine/flow/types.ts` (`LoopConfig` 86-96)
- `/Users/jtsmith/BoardSmith/src/engine/flow/engine.ts` (`run()` 1131-1203, `executeLoop()`
  1268-1309, `DEFAULT_MAX_ITERATIONS = 10000` line 30)
- `/Users/jtsmith/BoardSmith/src/ui/components/PlayerToken.vue` (full file)
- `/Users/jtsmith/BoardSmith/src/session/colors.ts` (full file — confirmed no luminance math)
- `/Users/jtsmith/BoardSmith/src/session/types.ts` (`ActionMetadata` interface 396-405)
- `/Users/jtsmith/BoardSmith/src/session/state-history.ts` (`getStateAtAction` 126)
- `/Users/jtsmith/BoardSmith/src/client/vue.ts` (`useGame()` 62-79)
- `/Users/jtsmith/BoardSmith/src/client/types.ts` (`GameState` interface 173-185)
- `/Users/jtsmith/BoardSmith/src/ui/components/DebugPanel.vue` (`selectAction` 1232-1288,
  time-travel emits)
- `/Users/jtsmith/BoardSmith/docs/common-pitfalls.md` (§6, existing loop-maxIterations
  pitfall documentation to be extended)
- `/Users/jtsmith/BoardSmith/docs/actions-and-flow.md` (existing `loop()`/`maxIterations`
  documented examples, lines ~760-1010)
- `/Users/jtsmith/BoardSmith/src/engine/flow/builders.test.ts`,
  `/Users/jtsmith/BoardSmith/src/engine/flow/engine.test.ts` (existing test coverage/patterns)
- `.planning/phases/164-library-misc-action-panel-loop-visual-debug-view/164-CONTEXT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `/Users/jtsmith/CLAUDE.md`, `/Users/jtsmith/BoardSmith/CLAUDE.md`

### Secondary (MEDIUM confidence)
- WCAG 2.1 §1.4.3 relative-luminance formula — from training knowledge, cross-checked
  against the well-known public formula (sRGB gamma-correction + 0.2126/0.7152/0.0722
  coefficients); NOT fetched from a live W3C URL in this session (no network doc fetch was
  performed) — the formula is extremely stable/unchanged since WCAG 2.0 and is widely
  reproduced verbatim in every accessibility-contrast library, so confidence is MEDIUM-HIGH
  despite not being freshly fetched. Flagged as `[ASSUMED]` in the Assumptions Log below out
  of discipline, even though this formula has not materially changed across WCAG 2.0/2.1/2.2.

### Tertiary (LOW confidence)
- None — no findings in this research rested on WebSearch/unverified single-source claims;
  everything was either read directly from the working tree or is standard, unchanging W3C
  specification math.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The WCAG 2.1 relative-luminance formula (sRGB gamma correction + 0.2126/0.7152/0.0722 coefficients) is current and unchanged in WCAG 2.2 | Architecture Patterns §3 | Very low — this formula has been stable across all WCAG 2.x revisions; if wrong, contrast picks would be marginally off for edge-case colors near the black/white threshold, not systematically broken. |
| A2 | Canvas 2D context (`getContext('2d')`) is unavailable under this repo's jsdom test config, requiring a hex/rgb-only fallback parser | Common Pitfalls §1 | Medium — this was NOT empirically verified in this research session (no test file was actually run); if canvas IS available (some jsdom setups add a canvas polyfill via a devDependency), the richer normalizer could be used safely. The planner/implementer MUST spike this before committing to an approach — flagged explicitly as a pre-implementation check, not a locked decision. |
| A3 | The proposed field name `suppressFromDock` will read clearly to a future skills-author (Phase 166 / SKILLDEF-03 references it by name) | Architecture Patterns §1 | Low — CONTEXT explicitly grants naming discretion; if the chosen name is unclear, it's a cheap rename before Phase 166 consumes it (same repo, no external contract yet). |

## Open Questions

1. **Exact rename target for `suppressActionPanel`**
   - What we know: CONTEXT specifies "loud" naming intent and gives one example
     (`platformActionPanelEscapeHatch`); naming is explicitly Claude's discretion.
   - What's unclear: whether the planner wants to lock the exact string now (so Phase 166's
     SKILLDEF-03 can be drafted against a known name) or leave it fully open to the
     implementing plan.
   - Recommendation: the plan should pick and LOCK the exact identifier (not defer it) since
     Phase 166 will grep for it by name — recommend `platformActionPanelEscapeHatch` (CONTEXT's
     own example) unless the planner has a stronger alternative, purely to remove a
     cross-phase naming ambiguity.

2. **Canvas 2D availability under this repo's jsdom config (see Assumption A2)**
   - What we know: jsdom does not implement canvas by default; this repo has prior
     experience working around jsdom gaps (D19/TOOL-03, `window.matchMedia`).
   - What's unclear: whether a canvas polyfill devDependency is already present (not found
     in a `package.json` grep during this session, but not exhaustively ruled out).
   - Recommendation: the implementing plan's first task for LIBX-03 should spike this in
     ~2 minutes (`document.createElement('canvas').getContext('2d')` inside a throwaway
     vitest run) before deciding between the canvas-normalizer and the hex/rgb-only parser.

3. **Whether the `#sidebar-extra` slot desync (GameShell.vue:2152) is in-scope for this phase**
   - What we know: CONTEXT's `code_context` names only the `#game-board` slot desync;
     `#sidebar-extra` has the identical bug pattern one-line away.
   - What's unclear: whether fixing it counts as scope creep or as "the same fix, same file,
     zero marginal risk."
   - Recommendation: fix it in the same task as the board-slot fix (same `displayedState`
     computed, one extra line) — flagged for planner awareness rather than silently doing it
     unprompted; if the planner wants strict CONTEXT-literal scope, skip it and file a
     one-line follow-up defect instead.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A (no new external packages) — HIGH by default (nothing to verify)
- Architecture: HIGH — every pattern verified against actual source, exact line numbers cited
- Pitfalls: HIGH for LIBX-01/02/04 (grounded in direct code read); MEDIUM for the LIBX-03
  canvas-jsdom pitfall specifically (flagged as an open question requiring a pre-implementation
  spike, not empirically confirmed in this research session)

**Research date:** 2026-07-21
**Valid until:** Stable — this is all first-party source code in an actively-developed repo
with no external API/version dependency; valid until the four target files are next
refactored (no natural expiry date; treat as valid through this phase's execution window).
