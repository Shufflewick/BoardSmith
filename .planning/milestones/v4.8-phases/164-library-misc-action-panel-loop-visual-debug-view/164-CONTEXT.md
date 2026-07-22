# Phase 164: Library Misc — Action-Panel, Loop, Visual, Debug-View - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix four independent single-game library defects, each with a fail-on-pre-fix / pass-after test (PROC-01):
- **LIBX-01** (D28 + C.3-lib): per-action dock/action-panel suppression (not all-or-nothing) + fence the blunt `suppressActionPanel` prop behind an explicit platform escape hatch.
- **LIBX-02** (D29): `loop()` can express an unbounded game via an explicit valve; `maxIterations` exit is documented + observable.
- **LIBX-03** (D30): `PlayerToken` glyph ink adapts to seat color (not hardcoded white).
- **LIBX-04** (D31): time-travel debug view no longer desyncs `#game-board` so clicks cannot commit against the live engine.

Library layer only (BoardSmith repo). No game-repo edits in this phase.
</domain>

<decisions>
## Implementation Decisions

### LIBX-01 — Per-action dock suppression + fence `suppressActionPanel`
- Per-action suppression is declared on the **action definition** and flows through `actionMetadata` — the action owns its dock presentation (Pit of Success). ActionPanel/GameShell filters the rendered dock buttons by this per-action flag.
- The blunt `suppressActionPanel` prop is **kept but renamed loud** to signal it is a platform-only escape hatch (e.g. `platformActionPanelEscapeHatch`), and **removed from the ordinary author-facing scaffold/bridge surface** (de-documented as a normal prop; documented as platform-only, agent told not to use without the client — the skills half is SKILLDEF-03/Phase 166).
- A suppressed action is **still executable** via custom UI / board through `useBoardInteraction` — suppression only hides the dock button, it does not disable the action.
- When **all** dock actions are suppressed, fall back to the **bare turn-prompt strip** (never leave the player with no turn indicator).

### LIBX-02 — loop() unbounded valve + maxIterations observability
- Express an unbounded loop via an explicit **`unbounded: true`** opt-in on `LoopConfig`, which makes `maxIterations` optional. Greppable, self-documenting, fail-loud if misused.
- The **bounded** cap-hit keeps its current **loud throw** (it is already not silent/winnerless) — improve the message + document it as a safety assertion, not a terminator.
- Even when `unbounded: true`, retain a **high hard-safety global runaway tripwire** (`DEFAULT_MAX_ITERATIONS` whole-flow guard) so a genuinely stuck loop still fails loud rather than hanging the process.
- Document `maxIterations` / `unbounded` semantics in the flow docs; the cap-hit throw is the observable exit signal.

### LIBX-03 — PlayerToken glyph-ink contrast
- Ink color is **luminance-based auto-contrast** computed from the seat `color` (black on light seats, white on dark).
- **Reuse the existing v2.5 player-color luminance/contrast utility** if one exists; otherwise add a small self-contained helper.
- The `text-shadow` is **derived opposite** to the chosen ink (or dropped when ink is dark) so the halo aids legibility rather than fighting it.
- Threshold uses **WCAG relative-luminance** (pick whichever of black/white contrasts more).

### LIBX-04 — Time-travel debug-view `#game-board` desync
- **Both** fixes (defense in depth): (a) feed the displayed (historical) state to the board `:state` slot during time-travel, AND (b) gate the action bridge so board clicks **cannot commit** while `isViewingHistory`.
- A board click during history is an **inert no-op commit** (no live mutation); minimum bar is no live-engine mutation.
- **Consolidate** the board so it always reads the *displayed* state — a single source of truth. Remove the divergent always-live `:state` prop during history (allowed under the no-backward-compat rule).
- **Verify + regression-test** that exiting history clears `timeTravelState` back to live correctly.

### Claude's Discretion
- Exact renamed identifier for the fenced escape-hatch prop, helper naming, and test file placement are at Claude's discretion, consistent with codebase conventions.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/ui/components/GameShell.vue` — `suppressActionPanel` prop (decl ~140, default ~177, dock render 2381-2464; `v-if` gates at 2425/2436). `gameView` computed (473-477) already returns historical `timeTravelState.view`; `handleTimeTravel` (1786-1794); `isViewingHistory` (338). Board slot passes BOTH `:game-view="gameView"` (historical) and `:state="state"` (2342, always live) — the desync source.
- `src/ui/components/ActionPanel.vue` — owns per-action button rendering; receives `availableActions`.
- `src/ui/composables/useBoardActionBridge.ts:15` — documents `#action-panel` slot + `suppressActionPanel` interplay; board clicks flow bridge → `useActionController` → live engine (no `isViewingHistory` guard today).
- `src/ui/components/PlayerToken.vue:86` — `.tok .ini` ink hardcoded `rgba(255,255,255,.95)`; `color` prop only drives shape fill via `--tc`.
- `src/engine/flow/builders.ts:79-108` — `loop()` throws at construction if `maxIterations` undefined; `turnLoop()`/`stateLoop()` default cap 100.
- `src/engine/flow/types.ts:87-102` — `LoopConfig` (`while`, `maxIterations?`, `do`).
- `src/engine/flow/engine.ts` — `executeLoop` (1268-1308) clean-exits only on `while`-false, **throws** on cap-hit (1287-1301, "safety assertion, NOT a terminator"); `DEFAULT_MAX_ITERATIONS=10000` (line 30), whole-flow tripwire 1149-1159.
- `src/session/state-history.ts` — `StateHistory.getStateAtAction`, checkpoint replay (source of historical state for DebugPanel).
- `src/ui/components/DebugPanel.vue` — `selectAction(index)` (1232-1277) emits `time-travel`; `isViewingHistory`/`displayedState` computed 1332-1334.

### Established Patterns
- Pit of Success: the correct path is the easy path; dangerous ops require explicit opt-in; `disabled` returns `string|false` (reason required).
- No backward-compatibility — cleanest implementation, remove the bad thing.
- `actionMetadata` is the existing channel for per-action UI hints — the natural home for per-action dock suppression.

### Integration Points
- Per-action suppression: action definition → `actionMetadata` → GameShell/ActionPanel dock filter.
- Escape-hatch prop rename: GameShell prop + `useBoardActionBridge` doc + any scaffold docs.
- Time-travel guard: `useBoardActionBridge`/`useActionController` gains an `isViewingHistory` guard; GameShell board slot `:state` unified to displayed state.
</code_context>

<specifics>
## Specific Ideas

- Each of the four fixes must ship with a fail-on-pre-fix / pass-after test (PROC-01).
- LIBX-01's skills half (agent told not to use the fenced hatch without the client) is SKILLDEF-03 in Phase 166 — this phase only delivers the library half and must leave the hatch in a state the skill can reference by name.
</specifics>

<deferred>
## Deferred Ideas

- Skills-side enforcement of the escape hatch (SKILLDEF-03) → Phase 166.
- A visible "exit history to act" hint on time-travel board clicks — nice-to-have, not required (min bar is inert no-op).
</deferred>
