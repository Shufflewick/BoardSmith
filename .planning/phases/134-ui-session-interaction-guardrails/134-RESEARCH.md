# Phase 134: UI & Session Interaction Guardrails - Research

**Researched:** 2026-07-03
**Domain:** Vue 3 composables (action controller, drag-drop, auto-zoom), GameShell chrome, GameSession accessor API
**Confidence:** HIGH — every claim below is a direct file:line trace against current source (post Phase-133), not training-data recall. No Context7/WebSearch was needed; this is 100% internal codebase research.

## Summary

This phase closes six "silent wrong-path" footguns identified by Audit #3 (F17, F18, F19, F29, F30, F31), all clustered in developer-facing composables and one session accessor. Every finding was re-traced against current source in this research pass (PROC-01 discipline) and all six remain LEGITIMATE with no material drift from the audit's original evidence. Five of six fixes are small, additive, and low-risk (return-type widening, one new guard clause, one accumulation change, one CSS/dev-check addition). The sixth (SESS-01, the `session.runner` facade) is a clean break but has **zero non-test production call sites** anywhere in `src/` — grep confirms `GameSession.runner`'s only consumers are 10 test files that all do read-only operations (`getSnapshot()`, `.game`, `.actionHistory`) already present on `GameRunner`, so a read-only `Pick<>`-style facade requires no test-file rewrites for those reads, only removes reachability of `.performAction()` (which no test or production code currently calls through `session.runner`).

**Primary recommendation:** Implement all six fixes as thin, additive changes co-located with their existing code (no new files needed except doc updates); route ALL new user-facing feedback through `GameShell.vue`'s existing `toast`/`assertiveMessage` mechanism (one new `watch()` block, no new component); reject the UIX-03 structural-CSS-fix option outright — it is fundamentally incompatible with the v4.0 zoom-to-fit architecture (evidence below) — and ship the dev-console-error + docs path as the complete UIX-03 fix.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Action-failure toast surfacing (UIX-01) | Frontend Server/Client (Vue component — GameShell.vue) | — | GameShell is the single chrome-owning component; it already owns all other toast/live-region calls |
| `start()` return-value contract (UIX-01) | Client composable (useActionController.ts) | — | Pure composable API surface, consumed identically by ActionPanel and custom UIs |
| `fill()` multiSelect guard (UIX-02) | Client composable (useActionController.ts) | — | Client-side validation guard, mirrors existing `toggleMultiSelect` guard in the same file |
| Board 0×0 dev-check (UIX-03) | Client composable/component (useAutoZoom.ts or GameShell.vue) | — | Both candidates live in the browser-rendering tier; GameShell has the "state arrived" signal, useAutoZoom has the measurement |
| `session.runner` read-only facade (SESS-01) | API/Backend (session layer — game-session.ts) | — | Session is the server-side (or in-process host) authority; the facade is a read surface for host/test code, not game code |
| `dragProps()` `when` gating (UIX-04) | Client composable (useDragDrop.ts) | — | Pure DOM-prop composable |
| `setBeforeAutoExecute` accumulation (UIX-05) | Client composable (useActionController.ts) | — | Same file/tier as UIX-01/02 |

## User Constraints (from CONTEXT.md)

<user_constraints>
### Locked Decisions

- **UIX-01 (F17)**: All three parts: (1) GameShell centrally watches `lastError` (and failed execute/fill results) and fires `toast.error` — custom UIs get the same failure feedback ActionPanel users get, for free; (2) `start()` returns `Promise<result>` (ActionResult/ValidationResult) so failure is programmatically detectable; (3) devWarn when `start()` is called for an unavailable action. Docs updated to model checking results.
- **SESS-01 (F29)**: **Read-only facade** — `GameSession.runner` no longer exposes the raw `GameRunner`; it returns a read-only facade (state/view/history getters only) with no `performAction` reachable. All write-paths go through `session.performAction` (persistence, broadcast, checkpoints, tutorials, AI scheduling intact). Clean break per No Backward Compatibility; internal callers migrate.
- **UIX-02 (F18)**: `fill()` **rejects a scalar for a multiSelect pick with an actionable error**, mirroring `toggleMultiSelect`'s existing reverse guard: "selection X is multiSelect (min/max) — use toggleMultiSelect()/confirmMultiSelect() or pass an array". No silent auto-wrap.
- **UIX-04 (F30)**: **Implement `when`** — `dragProps()` honors the documented `when` option by returning inert props (`draggable: false`, no live handlers) when the condition is false.
- **UIX-05 (F31)**: **Accumulate hooks** — `setBeforeAutoExecute` registers multiple hooks, runs all in registration order, returns an unregister function. Docs/JSDoc updated (the "REPLACES" note goes away).
- **UIX-03 (F19)**: **Loud dev-mode error + docs**: once game state has arrived and the #game-board slot has children, if the zoom container measures ~0×0 (board collapsed under `width:max-content`), fire an actionable `console.error` pointing at a new "board sizing" section in docs/custom-ui-guide.md (covering max-content, percentage widths, container-type, boardregion measurement). Research additionally evaluates a structural CSS fix (giving the slot a definite containing width) — adopt ONLY if proven not to break the v4.0 zoom-to-fit architecture; otherwise the dev-error + docs is the complete fix. **This research's verdict: REJECT the structural fix — see "UIX-03 Structural Fix Evaluation" below.**
- PROC-01 verify-first: per-finding verdict in `134-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED recorded in SUMMARY.
- Same-phase doc updates (DOCX-04). Full suite green per wave.
- **Custom-UI/ActionPanel parity rule (CLAUDE.md hard rule)**: all interaction changes must work in Custom UI and Action Panel in parity through useBoardInteraction.

### Claude's Discretion

- Toast implementation reuse (GameShell already has a toast/message mechanism from v4.0 — reuse it; do not add dependencies).
- Facade type name and exact getter surface for SESS-01 (state/view/history + whatever read-only accessors internal consumers need).
- Whether UIX-01's `start()` return type unifies with `execute()`'s existing result shape.
- Exact placement of the UIX-03 dev check (GameShell vs useAutoZoom) — wherever the 0-size signal is reliable post-state-arrival.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | `session.runner.performAction()` not reachable as an easy wrong path | Read-only facade design below; zero-breakage consumer audit (grep evidence) |
| UIX-01 | Custom-UI action failures surfaced; `start()`/submission APIs return checkable result | `lastError` central-watch design; `start()` return-type change; devWarn design |
| UIX-02 | `fill()` rejects scalar for multiSelect pick | `resolveMultiSelectConfig()` reuse pattern traced at useActionController.ts:1695-1706 |
| UIX-03 | Responsive custom boards no longer silently collapse to 0 | Structural-fix rejection evidence + dev-check design (useAutoZoom.ts / GameShell.vue) |
| UIX-04 | `dragProps()` honors `when` | Exact diff against `drag()`'s existing `evalCondition()` pattern |
| UIX-05 | `setBeforeAutoExecute()` supports multiple hooks or fails loudly on replace | Array-based hook registry design + unregister-function contract |
</phase_requirements>

## Standard Stack

No new dependencies. This phase is 100% internal composable/component API surface work using the project's existing stack: Vue 3 (Composition API, `ref`/`watch`), the existing `useToast()`/`Toast.vue` mechanism, and `@vue/test-utils` + Vitest for tests. `npm view` / registry verification is not applicable — no packages are installed.

## Package Legitimacy Audit

Not applicable — this phase introduces zero new dependencies (explicit CONTEXT.md constraint, confirmed against `package.json`; no `npm install` step in any plan for this phase).

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── GameShell.vue (chrome owner) ─────────────────────────┐
│                                                                                     │
│  useActionController(options) ──creates──▶ actionController (shared instance)     │
│         │                                        │                                │
│         │ lastError (ref)                        │ provide('actionController')    │
│         ▼                                        ▼                                │
│  NEW: watch(lastError, ...) ──▶ toast.error() + assertiveMessage (UIX-01 part 1)  │
│                                                                                     │
│         #game-board slot ──────┬──── ActionPanel.vue (auto UI)                    │
│         (custom UI consumer)   │         │                                        │
│                    │            │         │  both call the SAME actionController   │
│                    ▼            ▼         ▼  instance → parity by construction     │
│              start()/fill()/execute() ──▶ sendAction() ──▶ session.performAction   │
│                    │                                            (server/session)   │
│                    │ Promise<ActionResult|ValidationResult>          │             │
│                    ▼ (UIX-01 part 2 — was Promise<void>)             ▼             │
│              caller can branch on .success                    GameSession         │
│                                                                  #runner (private)  │
│                                                              get runner() ──▶ NEW:  │
│                                                              read-only facade       │
│                                                              (SESS-01)              │
│                                                                                     │
│  .game-shell__zoom-container { width: max-content }  ◀── boardEl for useAutoZoom  │
│         │                                                                          │
│         │ percentage-width / container-type board inside ──▶ collapses to 0×0     │
│         ▼                                                                          │
│  NEW: dev-mode console.error once state arrived + slot has children + 0×0 (UIX-03) │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

useDragDrop.ts: dragProps(ref, {when}) ──▶ NEW: inert props when when===false (UIX-04)
                                            (mirrors drag()'s existing evalCondition())

useActionController.ts: beforeAutoExecuteHook (single ref)
                         ──▶ NEW: beforeAutoExecuteHooks (array, run in order) (UIX-05)
```

### Recommended Project Structure

No new files. All six fixes are edits to existing files:
```
src/ui/composables/useActionController.ts          # UIX-01 (start/execute return+devWarn), UIX-02 (fill guard), UIX-05 (hook array)
src/ui/composables/useActionControllerTypes.ts      # UIX-01 (start() return type), UIX-05 (unregister return type)
src/ui/composables/useDragDrop.ts                   # UIX-04 (dragProps when-gating)
src/ui/components/GameShell.vue                     # UIX-01 (central lastError watch → toast), UIX-03 (dev-check placement candidate)
src/ui/composables/useAutoZoom.ts                   # UIX-03 (dev-check placement candidate — alternative to GameShell)
src/session/game-session.ts                         # SESS-01 (read-only facade type + get runner() change)
docs/custom-ui-guide.md                              # DOCX-04: UIX-01 result-checking examples, UIX-02 multiSelect guidance, new "Board Sizing" section (UIX-03)
```

### Pattern 1: Central failure surfacing via a single `watch()` in GameShell

**What:** GameShell already owns every other toast call and the two ARIA live regions (`politeMessage`/`assertiveMessage` at lines 339-340, rendered at 1849-1850). Add one `watch(actionController.lastError, ...)` block near the existing toast-owning code (the undo-toast pattern at lines 656-676 is the closest precedent) that fires `toast.error(...)` and sets `assertiveMessage` whenever `lastError` transitions from null/previous to a new non-null value.

**When to use:** This is the ONLY toast-owning chokepoint for action failures — do not add a parallel error path inside ActionPanel.vue (UI-SPEC explicitly forbids this; parity holds by construction because both ActionPanel and custom UIs share the same `actionController` instance provided via `provide('actionController', actionController)` at line 966).

**Example:**
```typescript
// Source: src/ui/components/GameShell.vue:656-676 (existing undo-error pattern to mirror)
async function handleUndo() {
  try {
    const result = await performUndo();
    if (!result.success) {
      toast.error(result.error || 'Undo failed.');
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Undo failed.');
  }
}

// NEW pattern for UIX-01 (co-located near line 656, after `toast`/`actionController` are defined):
watch(actionController.lastError, (err) => {
  if (!err) return;
  toast.error(err);
  assertiveMessage.value = err; // route into existing role="alert" live region (line 1850)
});
```

**Important nuance discovered in this pass:** `lastError` is set by MANY code paths inside `useActionController.ts` (11 call sites: 966, 989, 1036, 1049, 1075, 1089, 1097(clear), 1102, 1126, 1253, 1260, 1269(clear), 1388, 1441, 1522, 1591, 1684(clear)) — some of these are cleared-then-immediately-reset in the same tick (e.g. `execute()` sets `lastError.value = null` at entry then may set it again before returning). A naive `watch` with default flush timing will only observe the FINAL value at the end of the synchronous/microtask block, which is correct behavior (Vue's reactivity batches synchronous mutations) — no special `flush: 'sync'` is needed. Confirm this in a test that calls `execute()` and asserts exactly one toast fires per failed call, not one per intermediate `lastError` mutation.

### Pattern 2: Multi-hook accumulation (replaces single-ref slot)

**What:** Replace `beforeAutoExecuteHook: Ref<Hook | undefined>` with `beforeAutoExecuteHooks: Ref<Hook[]>`. `setBeforeAutoExecute(hook)` pushes and returns an unregister closure. The auto-execute watcher (useActionController.ts:853-858) awaits each hook **sequentially** (not `Promise.all`) to preserve registration-order semantics for animation-position capture, where ordering may matter (e.g. board-level fly animation must capture positions before a player-stats-panel hook reads state).

**When to use:** Any composable/component in `#game-board` or `#player-stats` slots that needs pre-execute capture (documented use case: `useActionAnimations.ts`).

**Example:**
```typescript
// Source: src/ui/composables/useActionController.ts:179-183 (current single-slot state)
// BEFORE:
const beforeAutoExecuteHook = ref<Hook | undefined>(initialBeforeAutoExecute);
function setBeforeAutoExecute(hook: Hook): void {
  beforeAutoExecuteHook.value = hook;
}
// watcher at line 856-858:
if (beforeAutoExecuteHook.value) {
  await beforeAutoExecuteHook.value(currentAction.value, buildServerArgs());
}

// AFTER (UIX-05):
const beforeAutoExecuteHooks = ref<Hook[]>(initialBeforeAutoExecute ? [initialBeforeAutoExecute] : []);
function setBeforeAutoExecute(hook: Hook): () => void {
  beforeAutoExecuteHooks.value.push(hook);
  return () => {
    const idx = beforeAutoExecuteHooks.value.indexOf(hook);
    if (idx !== -1) beforeAutoExecuteHooks.value.splice(idx, 1);
  };
}
// watcher:
for (const hook of beforeAutoExecuteHooks.value) {
  await hook(currentAction.value, buildServerArgs());
}
```

**Breaking test to flip RED→GREEN:** `useActionController.test.ts:521` — `'setBeforeAutoExecute replaces the previous hook (single-slot)'` currently asserts replace-semantics (`calls` array only contains `'second'`). This test's assertion must be inverted to assert BOTH `'first'` and `'second'` fire, in that order (PROC-02 regression test).

### Pattern 3: Symmetric guard for fill() rejecting multiSelect scalars

**What:** Mirror `toggleMultiSelect`'s existing reverse-direction guard (useActionController.ts:1727-1735, which rejects non-multiSelect selections). Add the opposite check at the top of `fill()` (useActionController.ts:1311+): resolve the selection's multiSelect config via the SAME helper (`resolveMultiSelectConfig`, already defined at line 1695, handles both static `multiSelect` and `dependsOn`-scoped `multiSelectByDependentValue`), and if a config exists AND the incoming value is not an array, return `{ valid: false, error: '...' }` without mutating any state — do not auto-wrap.

**Example:**
```typescript
// Source: src/ui/composables/useActionController.ts:1716-1735 (toggleMultiSelect's existing reverse guard — the template)
const cfg = resolveMultiSelectConfig(selection);
if (!cfg) {
  devWarn(/* ... 'is not a multiSelect selection... use fill()' ... */);
  return;
}

// NEW symmetric guard inside fill(), before validateSelection() is called (~line 1320):
const multiCfg = resolveMultiSelectConfig(selection);
if (multiCfg && !Array.isArray(value)) {
  const error = `fill('${selectionName}', ...) rejected: '${selectionName}' is a multiSelect selection ` +
    `(min ${multiCfg.min ?? 0}, max ${multiCfg.max ?? '∞'}) and requires an array. ` +
    `Use toggleMultiSelect()/confirmMultiSelect(), or pass an array directly to fill().`;
  lastError.value = error;
  return { valid: false, error };
}
```

Copy text matches UI-SPEC's Copywriting Contract verbatim (row "UIX-02").

**Caveat found during trace:** `fill()` already has an earlier auto-unwrap block (lines 1321-1332) that unwraps `{ value, display }` choice objects BEFORE this new guard would run. The multiSelect guard must be placed AFTER that unwrap (so a caller passing a single choice-object for what should be a multiSelect array still gets the actionable multiSelect error, not a confusing "invalid selection" from `validateSelection`), and BEFORE the `selection.repeat` / `hasOnSelect`/`pendingOnServer` branches (lines 1335-1341) since those routes bypass `validateSelection` entirely and would otherwise let a scalar silently reach the server.

### Pattern 4: `dragProps()` `when` gating

**What:** `dragProps()` (useDragDrop.ts:212-235) currently ignores `options.when` entirely — only `drag()` (line 324) and `dragClasses()` (line 307) call the existing `evalCondition()` helper (line 299-302). Wire the same helper into `dragProps()`.

**Example:**
```typescript
// Source: src/ui/composables/useDragDrop.ts:212 (current — always draggable:true)
const dragProps = (ref: ElementRef, options?: DragOptions): DragProps => ({
  draggable: true,
  onDragstart: (e) => { /* ... */ },
  onDragend: () => { /* ... */ },
});

// NEW (UIX-04) — return type must widen to DragProps | { draggable: false }:
const dragProps = (ref: ElementRef, options?: DragOptions): DragProps | { draggable: false } => {
  if (!evalCondition(options)) {
    return { draggable: false };
  }
  return {
    draggable: true,
    onDragstart: (e) => { /* unchanged */ },
    onDragend: () => { /* unchanged */ },
  };
};
```

**Type-surface consequence:** `UseDragDropReturn['dragProps']` return type (useDragDrop.ts:178) must change from `DragProps` to `DragProps | { draggable: false }`. This is a narrower, additive union — no existing TS consumer breaks (v-bind spreads either shape fine in a template), but any code doing `dragProps(...).onDragstart` without a type guard will now get a type error when `when` is in scope — grep for such direct property access before/after to confirm no in-repo consumer does this (none found in BoardSmith or reference games as of this research pass — only `drag()`'s existing `.props` access pattern is used, and that already handles the `{}`-shaped inert case).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-value condition evaluation for drag gating | A new "when" evaluator inside `dragProps` | The existing `evalCondition()` helper (useDragDrop.ts:299-302) | Already handles both boolean and function forms; `drag()`/`dragClasses()` already depend on it — a second implementation would drift |
| MultiSelect config resolution (dependsOn-scoped) | A new lookup inside `fill()` | The existing `resolveMultiSelectConfig()` helper (useActionController.ts:1695-1706) | Already handles the `dependsOn` + `multiSelectByDependentValue` case that `toggleMultiSelect` relies on; a parallel implementation in `fill()` would diverge from `toggleMultiSelect`'s notion of "is this a multiSelect selection" |
| Toast/live-region plumbing | A new toast component or ARIA live region | `useToast()` + GameShell's existing `assertiveMessage`/`politeMessage` refs | CONTEXT.md explicitly forbids new dependencies/components; GameShell is the established one-chokepoint owner |
| A read-only wrapper class for `GameRunner` | A new class implementing every `GameRunner` member manually | A TypeScript `Pick<GameRunner<G>, 'game' | 'actionHistory' | 'getSnapshot' | 'getPlayerView' | 'getAllPlayerViews' | 'getFlowState' | 'getFlowDebugInfo' | 'getPendingAction' | 'isComplete' | 'getWinners'>` type, with `get runner()` returning `this.#runner` typed AS that narrower interface (not a new object — same instance, narrower compile-time surface) | Zero runtime cost, zero new object allocation per access, and TypeScript already treats `readonly game`/`readonly actionHistory` as non-reassignable — the facade only needs to hide `performAction` at the type level since no consumer needs a runtime-enforced block (see Assumptions Log A1) |

**Key insight:** Every fix in this phase has an existing sibling pattern in the same file to mirror (guard-clause symmetry for UIX-02/UIX-04, hook-array precedent nowhere else needed since it's novel, toast precedent for UIX-01). Resist inventing new abstractions — the audit findings are about MISSING calls to existing machinery, not missing machinery.

## Common Pitfalls

### Pitfall 1: Widening `start()`'s return type without misrepresenting what it returns

**What goes wrong:** A planner or implementer might assume `start()`'s new `Promise<ActionResult | ValidationResult>` return value reflects the EVENTUAL outcome of the action (including auto-execute results that happen later via the `watch(isReady, ...)` reactive watcher at useActionController.ts:853-858).

**Why it happens:** `start()` (lines 1245-1309) is synchronous-shaped in its control flow but the actual action execution for wizard-mode actions happens asynchronously, later, triggered by a SEPARATE reactive watcher — NOT inside `start()`'s own call stack. `start()` only performs: (1) availability check, (2) metadata check, (3) initial arg assignment, (4) fetching choices for the first unfilled selection. None of these steps call `sendAction()`.

**How to avoid:** `start()`'s return value can only faithfully represent the TWO synchronous failure modes it already detects today (`"Action X is not available"` at line 1253, `"No metadata for action X"` at line 1260) plus a success acknowledgment that wizard mode began (e.g. `{ success: true }` with no `data`/`error`). Document this precisely in both the JSDoc and `docs/custom-ui-guide.md` — do NOT imply `start()`'s return value tells the caller whether the eventual action succeeded. Callers who need the eventual result must still watch `lastError` (now toast-surfaced for free) or use `execute()` directly (which DOES return the true server result, synchronously awaited).

**Warning signs:** A test or doc example that does `const r = await start('foo'); if (!r.success) ...` and expects `r` to reflect server-side action failure will be WRONG — it will only ever reflect the two synchronous pre-checks.

### Pitfall 2: The UIX-03 dev-check firing on every legitimate transient 0×0 during startup

**What goes wrong:** `useAutoZoom.ts`'s `onBoardResize()` (lines 97-104) is called by a `ResizeObserver` that fires on EVERY resize event, including the normal 0×0 state before game state has arrived over the socket (the composable's own doc comment explicitly says "the board can be 0×0 for a while before session state arrives" — line 100). A naive dev-check placed directly in `onBoardResize` would fire false-positive `console.error`s on every game's normal startup sequence.

**Why it happens:** There is no built-in signal inside `useAutoZoom.ts` for "game state has arrived" — that signal lives in GameShell (`gameView`/`state` refs) or the parent's knowledge of when the `#game-board` slot renders real content (the `shellMounted` gate at GameShell.vue:2124, `v-if="shellMounted"`).

**How to avoid:** Per CONTEXT.md's explicit condition — "once game state has arrived AND the #game-board slot has children" — the check MUST be gated on BOTH: (1) `gameView`/`state` is non-null (GameShell already has this), AND (2) enough time has passed for a legitimate board to have rendered (use the SAME `SETTLE_MS`-style debounce useAutoZoom already uses, or simplest: only fire the dev-check from GameShell's own `watch`, keyed off `gameView` transitioning non-null, checked one tick + one `SETTLE_MS`-equivalent delay later — reusing `useAutoZoom`'s existing settle timer avoids inventing a second timing constant). **Recommended placement: inside `useAutoZoom.ts`'s existing `onBoardResize` → `endStartup` flow**, since it already has the "has this fit ever succeeded" state machine (`startupDone`) — add a counter/timeout: if `startupDone` is still `false` after N settle-cycles (or a fixed timeout, e.g. 2 seconds) post the FIRST resize callback that occurred after `boardEl`'s children exist, fire the dev console.error once. This requires threading a "state has arrived" boolean into `useAutoZoom`'s options (a small new `Ref<boolean>` input) rather than adding logic in GameShell — but GameShell placement is also defensible since GameShell already holds `gameView`. **Discretion is explicitly left to the implementer per CONTEXT.md — either is architecturally sound; the GameShell placement is slightly simpler because it avoids adding a new option to `useAutoZoom`'s public signature, but the useAutoZoom placement is more cohesive with the existing 0×0-detection state machine.** This research does not force a choice; document the tradeoff so the plan can pick one and commit.

**Warning signs:** Any reference game's console showing the new error on every normal load — this would be an immediate regression to catch in browser verification (CLAUDE.md requires this before marking complete).

### Pitfall 3: Confusing `GameRunner.game`'s readonly TYPE with a runtime-enforced read-only object

**What goes wrong:** SESS-01's facade, if implemented purely as a TypeScript type narrowing (`Pick<GameRunner<G>, ...>` cast) rather than a runtime Proxy/wrapper, does NOT prevent a determined caller from casting past the type system (`(session.runner as any).performAction(...)`) or from calling mutating methods reachable via `.game` (e.g. `session.runner.game.someCustomMutatingMethod()` — `Game` instances are not immutable).

**Why it happens:** The audit finding's harm model is specifically about the EASY, TYPE-CHECKING wrong path (`session.runner.performAction(...)` — same name/signature as `session.performAction`, discoverable via autocomplete). It is NOT about a hostile actor deliberately bypassing types. A compile-time-only facade fully satisfies "not reachable as an easy wrong path" (REQUIREMENTS.md's exact phrasing) without needing runtime enforcement.

**How to avoid:** Per the UI-SPEC's Copywriting Contract, ONLY add a runtime throw for the untyped/JS-caller case (`session.runner.performAction is undefined` naturally throws a TypeError in JS if the facade object is a real narrower object rather than just a type cast — but if using a pure type-cast of the SAME underlying `#runner` instance, `.performAction` remains callable at runtime from JS). **Decision needed for the plan:** if the facade must also protect untyped JS/dynamic callers (per the UI-SPEC's fallback runtime-throw copy), the facade cannot be a pure type-cast — it must be a genuinely narrower object (e.g. `{ get game() { return runner.game; }, getSnapshot: () => runner.getSnapshot(), ... }`, a real object literal exposing only the allowed members, NOT `runner` itself). This is a small additional object per session (created once, not per-access) — cache it in a private field (`#runnerFacade`) built alongside `#runner` assignment (both at construction, line 341, and at the two reassignment sites, lines 379 and 484) so `get runner()` returns a stable reference.

## Code Examples

### SESS-01 facade shape (recommended concrete implementation)

```typescript
// Source: src/session/game-session.ts:858-860 (current)
get runner(): GameRunner<G> {
  return this.#runner;
}

// NEW — genuinely narrower runtime object (not just a type cast), built once per
// #runner assignment so `session.runner` is referentially stable across repeated reads:
export interface ReadOnlyRunnerFacade<G extends Game = Game> {
  readonly game: G;
  readonly actionHistory: readonly SerializedAction[];
  getSnapshot(): GameStateSnapshot;
  getPlayerView(playerPosition: number): PlayerStateView;
  getAllPlayerViews(): PlayerStateView[];
  getFlowState(): FlowState | undefined;
  getFlowDebugInfo(): FlowDebugInfo;
  getPendingAction(playerPosition: number): PendingActionState | undefined;
  isComplete(): boolean;
  getWinners(): Player[];
}

function buildRunnerFacade<G extends Game>(runner: GameRunner<G>): ReadOnlyRunnerFacade<G> {
  return {
    get game() { return runner.game; },
    get actionHistory() { return runner.actionHistory; },
    getSnapshot: () => runner.getSnapshot(),
    getPlayerView: (p) => runner.getPlayerView(p),
    getAllPlayerViews: () => runner.getAllPlayerViews(),
    getFlowState: () => runner.getFlowState(),
    getFlowDebugInfo: () => runner.getFlowDebugInfo(),
    getPendingAction: (p) => runner.getPendingAction(p),
    isComplete: () => runner.isComplete(),
    getWinners: () => runner.getWinners(),
  };
}

// In GameSession, alongside `#runner` (private field, line 236):
#runnerFacade: ReadOnlyRunnerFacade<G>;
// ...set at every #runner assignment site (constructor line 341, restore line 379, line 484):
this.#runnerFacade = buildRunnerFacade(this.#runner);

get runner(): ReadOnlyRunnerFacade<G> {
  return this.#runnerFacade;
}
```

**Call-site migration required:** `src/session/game-session.ts` itself must NOT go through `this.runner` (the public getter) internally — it already uses `this.#runner` directly everywhere (confirmed: all internal uses at lines 858-1345 reference `this.#runner`, never `this.runner`), so ZERO internal production call sites need migration. The only migration needed is in the 10 test files listed in "Runtime State Inventory is N/A" section below (not applicable here — this is not a rename phase — but functionally equivalent audit was performed; see Sources).

## State of the Art

Not applicable in the traditional sense (no external library version drift to track) — this section instead documents what changed WITHIN this codebase across recent phases that this research must respect:

| Old Approach (pre-Phase-133) | Current Approach (Phase 133, user-approved) | When Changed | Impact on Phase 134 |
|--------------------------|------------------|---------------|--------|
| `simultaneousActionStep` failures silently succeeded | `FlowHaltedError` contract: failures surface as `{success: false}` through engine→runner→session→client | Phase 133 | UIX-01's `lastError`-watch/toast must ALSO catch these `FlowHaltedError`-originated failures — confirmed they arrive through the SAME `sendAction()` → `result.success === false` → `lastError.value = result.error` path already traced above, so no special-casing needed; the existing `lastError` watch covers them automatically |

**Deprecated/outdated:** None — this phase does not deprecate any prior API; UIX-05's "REPLACES" JSDoc language is removed but the underlying `setBeforeAutoExecute` function name/call signature at the call-site level is unchanged (only its return type gains a value: `void` → `() => void`, additive for existing non-capturing callers like CribbageBoard.vue:539 and demo-animation's GameTable.vue:344, which currently discard the return value — both continue to compile with zero changes needed).

## UIX-03 Structural Fix Evaluation (required by CONTEXT.md)

**Verdict: REJECT the structural CSS fix. Adopt dev-error + docs as the complete fix**, per the CONTEXT.md fallback clause.

**Evidence:**

1. `.game-shell__zoom-container` (GameShell.vue:2817-2839) is deliberately `width: max-content` so that `useAutoZoom.ts`'s `measureAndFit()` (lines 57-82) can read the board's INTRINSIC (natural, unzoomed) size via `getBoundingClientRect()` and compute a fit-to-available-space zoom factor (`computeFitZoom`, lines 32-40). This is the entire mechanism the v4.0 zoom-to-fit feature depends on: "natural size" must be genuinely intrinsic, not stretched to a container.

2. If the zoom container were given a definite width (e.g. `width: 100%` of `.boardregion`, matching the CONTEXT.md-suggested structural fix), then `measureAndFit()`'s `natural` measurement would equal `avail` in the width dimension for EVERY board, regardless of the board's actual content size — because `getBoundingClientRect()` would report the CONTAINER's stretched width, not the board's intrinsic content width. `computeFitZoom`'s `fit = Math.min(avail.width / natural.width, avail.height / natural.height)` would then always yield `avail.width / avail.width = 1` for the width term, silently breaking the fit calculation for every board smaller OR larger than the available region — a regression far worse than the trap being fixed (which only affects developers who opt into percentage-width/container-type boards, a narrower set than "every board").

3. This is not a theoretical concern — it is exactly the constraint the v4.0 UI redesign's own memory notes record: *"container-type collapses the board to 0; GameShell sizes board to max-content by design; RO/window-resize don't fire on programmatic iframe resize"* (see `custom-ui-responsive-sizing.md` memory, cited in CONTEXT.md's code_context). The maintainers already tried and rejected percentage/container-type sizing for the shell's own architecture.

4. A narrower structural fix — giving ONLY the `#game-board` slot's immediate wrapper a definite width while leaving `.game-shell__zoom-container` itself at `max-content` — was considered but rejected: `useAutoZoom` measures `zoomContainerEl` (the `.game-shell__zoom-container` element itself, per `boardEl: zoomContainerEl` at GameShell.vue:290), NOT the slot's rendered content directly. Since CSS box sizing means a `max-content`-width parent's size IS determined by its content's natural size, inserting an intermediate definite-width wrapper INSIDE the zoom container would make the zoom container's own `max-content` measurement equal that wrapper's fixed width — reproducing exactly problem #2 above, just one level deeper.

**Conclusion:** No structural CSS fix exists that both (a) supports percentage-width/container-type board roots and (b) preserves accurate intrinsic-size measurement for the zoom-to-fit calculation. These are mutually exclusive by the nature of CSS percentage sizing (a percentage width can only resolve against an ancestor with a definite size, which is precisely what `max-content` denies it) combined with `getBoundingClientRect()`-based intrinsic measurement (which requires the measured element to size to its content, not to a definite value). The dev-error + docs path is correctly the complete fix.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The SESS-01 facade needs to be a genuinely narrower runtime object (not a pure TypeScript type-cast) to satisfy the UI-SPEC's fallback runtime-throw copy for untyped/JS callers | Common Pitfalls #3, Code Examples | If a pure type-cast is acceptable instead (i.e. the runtime-throw fallback is optional / TS-only guard is sufficient), the facade could be simpler (a cast, zero new allocation) — LOW risk either way since both satisfy REQUIREMENTS.md's "not reachable as an easy wrong path"; the UI-SPEC copy row is explicitly framed as "if an untyped/JS caller reaches for it at runtime" (conditional), suggesting either implementation satisfies the requirement. Flag for planner to pick one during plan-phase; either choice is defensible. |
| A2 | UIX-03's dev-check placement (GameShell vs useAutoZoom) — this research documents both options' tradeoffs but does not mandate one, per CONTEXT.md's explicit "Claude's Discretion" on exact placement | Common Pitfalls #2 | LOW — CONTEXT.md explicitly defers this to implementation; both placements are architecturally sound per the evidence gathered |
| A3 | Toast.vue's error variant relies on background-color alone (`--bsg-danger`) to distinguish itself from success/info/warning visually — no icon, border-style, or text-label differentiator exists beyond the `role="alert"` vs `role="status"` ARIA distinction (which is non-visual) | Toast.vue trace (Common Pitfalls / Sources) | MEDIUM if WCAG 2.2 AA 1.4.1 (Use of Color) is being actively enforced this milestone — this is a genuine pre-existing gap, confirmed by direct read of Toast.vue lines 84-102. Per UI-SPEC FLAG #1, this is explicitly OUT OF SCOPE for Phase 134 (flag back to phase owner, do not silently expand scope) — documented here as the flag-back trigger. |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Should the UIX-03 dev-check use a fixed timeout (e.g. 2s post-first-resize-after-state-arrival) or a settle-cycle count, and where exactly does "game state has arrived" get read from inside `useAutoZoom.ts` if that's the chosen placement?**
   - What we know: `useAutoZoom.ts` currently has no knowledge of game-state arrival; GameShell has `gameView`/`state` but doesn't currently pass either into `useAutoZoom`'s options.
   - What's unclear: whether adding a new required/optional `Ref<boolean>` option to `useAutoZoom`'s public signature is acceptable scope for this phase, versus keeping the dev-check entirely inside GameShell (reading `zoomContainerEl.value?.getBoundingClientRect()` directly in a `watch(gameView, ...)` with a `setTimeout` debounce, duplicating a SMALL amount of the 0×0-check logic already in `computeFitZoom`).
   - Recommendation: keep the dev-check in GameShell.vue (reuse `computeFitZoom`'s exported natural/avail check style, or simply `zoomContainerEl.value.getBoundingClientRect()` width/height < 1 check) triggered off `watch(gameView, ...)` + `nextTick()` + a short settle delay (reuse the exported `SETTLE_MS` constant from useAutoZoom.ts for consistency) — this avoids widening `useAutoZoom`'s public API for a single dev-mode diagnostic.

2. **Does the `lastError`-watch toast need to be deduplicated against errors already toasted elsewhere in GameShell (e.g. the undo-error toast at line 656-676, which is a DIFFERENT code path than action execution)?**
   - What we know: `handleUndo()`'s toast calls are for the UNDO flow, which does not set `actionController.lastError` (confirmed: `lastError` is set only inside `useActionController.ts`'s own execute/start/fill functions — undo goes through a separate `performUndo()` composable/function, not through `actionController`).
   - What's unclear: whether any OTHER GameShell toast call site could double-fire alongside a `lastError`-triggered toast for the same user action (e.g. if a future code path sets both).
   - Recommendation: no dedup needed today — confirmed no overlap between `lastError`'s 11 set-sites (all inside useActionController.ts) and GameShell's other ~20 toast call sites (all outside useActionController.ts, covering lobby/undo/hint/demo/restart flows). Revisit only if a future phase merges these paths.

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies beyond the existing Node/npm/Vitest toolchain already present and verified working in prior phases (131-133 all shipped green in this same environment).

## Validation Architecture

`workflow.nyquist_validation` is absent from `.planning/config.json` → treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (via `vitest.config.ts`, `environment: 'node'` default, per-file `// @vitest-environment jsdom` override for DOM-dependent specs) |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` |
| Quick run command | `npx vitest run src/ui/composables/useActionController.test.ts src/ui/composables/useDragDrop.test.ts src/ui/components/GameShell.test.ts src/session/game-session.test.ts` (targeted) |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UIX-01 | `start()` returns checkable result for unavailable/no-metadata cases | unit | `npx vitest run src/ui/composables/useActionController.test.ts -t "start"` | ✅ existing file, new `it()` blocks needed |
| UIX-01 | GameShell toasts on `lastError` | component | `npx vitest run src/ui/components/GameShell.test.ts -t "action failure toast"` | ✅ existing file (`// @vitest-environment jsdom`), new `it()` block needed |
| UIX-02 | `fill()` rejects scalar for multiSelect | unit | `npx vitest run src/ui/composables/useActionController.selections.test.ts -t "multiSelect"` (or `.test.ts` — confirm exact file during planning; multiSelect-specific tests live in `useActionController.selections.test.ts` per file-header comment at `useActionController.test.ts:13`) | ✅ existing file, new `it()` block needed |
| UIX-03 | dev-console.error fires on 0×0 board post-state-arrival, NOT on legitimate startup 0×0 | unit | `npx vitest run src/ui/composables/useAutoZoom.test.ts` or new assertions in `GameShell.test.ts` depending on placement decision | ✅ existing files, new `it()` block(s) needed |
| SESS-01 | `session.runner` exposes only read-only surface; `.performAction` unreachable | unit + type-level | `npx vitest run src/session/game-session.test.ts -t "runner facade"` + a `// @ts-expect-error` compile-time assertion that `session.runner.performAction` doesn't type-check | ⚠️ `game-session.test.ts` — confirm exists; if not, add to the closest existing session test file (10 test files already reference `session.runner`, e.g. `restore-snapshot-authoritative.test.ts`) |
| UIX-04 | `dragProps()` returns inert props when `when` is false | unit | `npx vitest run src/ui/composables/useDragDrop.test.ts -t "when"` | ✅ existing file, new `it()` block needed |
| UIX-05 | `setBeforeAutoExecute` accumulates hooks, returns unregister fn | unit | `npx vitest run src/ui/composables/useActionController.test.ts -t "beforeAutoExecute"` | ✅ existing file — **flip the RED test at line 521 (`'setBeforeAutoExecute replaces the previous hook (single-slot)'`) to assert accumulation instead of replacement** |

### Sampling Rate

- **Per task commit:** targeted test file(s) for the fix just made
- **Per wave merge:** `npm test` (full suite — baseline is 168 files / 2183 tests green per STATE.md/CONTEXT.md; expect a net +1 file NOT needed, only new `it()` blocks in existing files, plus 1 flipped test at useActionController.test.ts:521)
- **Phase gate:** Full suite green before `/gsd:verify-work`, PLUS a manual browser-verification pass per CLAUDE.md (boardsmith dev + a reference game — hex or go-fish are simplest for exercising drag-drop/toast/wizard-mode; kill the dev server when done, never leave it running)

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. All target files already have `.test.ts` companions with established patterns (`createMockSendAction`, `createTestMetadata` helpers in `useActionController.helpers.ts`; `@vitest-environment jsdom` for GameShell.test.ts). One test (`useActionController.test.ts:521`) requires inversion (RED→GREEN via assertion flip), which counts as the PROC-02 regression test for UIX-05.

## Security Domain

`security_enforcement` not found in `.planning/config.json` → treated as enabled, but this phase's ASVS applicability is narrow: it is entirely developer-facing API ergonomics (composable return types, dev-console diagnostics, drag-prop gating) plus ONE session-layer access-control tightening (SESS-01, which REDUCES attack/misuse surface by removing a reachable write path, not adding one).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Not touched — no auth logic in this phase |
| V3 Session Management | yes (narrow) | SESS-01 restricts `GameSession.runner` to a read-only surface — this is an access-control HARDENING, not a new session mechanism. No new session state introduced. |
| V4 Access Control | yes (narrow) | Same as V3 — the facade enforces "developers cannot bypass `session.performAction`'s persistence/broadcast/checkpoint bookkeeping via the runner accessor." This is a DX/correctness control, not a player-vs-player security boundary (the runner accessor was never reachable from client/network code — it's an in-process host/test API). |
| V5 Input Validation | yes | `fill()`'s new multiSelect-scalar rejection (UIX-02) IS input validation, but purely client-side (UX guardrail) — the engine's server-side `validateSelection` (action.ts, fixed in Phase 133's ENG-04) remains the actual security boundary. This phase's UIX-02 fix does not change server-side enforcement. |
| V6 Cryptography | no | Not touched |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Developer bypasses session bookkeeping via a lookalike API (`session.runner.performAction`) | Tampering (of session state consistency, not security in the adversarial sense) | SESS-01's read-only facade (this phase) |
| Client-only validation trusted as the sole guard | Tampering | N/A for this phase — UIX-02's `fill()` guard is explicitly UX-only; the actual security-relevant server-side multiSelect enforcement was already fixed in Phase 133 (ENG-04, per audit finding evidence at index "chooseFrom multiSelect min/max is client-side only"). This phase must NOT be mistaken for closing that gap — it's already closed. |

## Sources

### Primary (HIGH confidence — direct file:line trace against current source, this session)

- `src/ui/composables/useActionController.ts` (2002 lines) — full trace of `lastError` (11 set-sites), `start()` (1245-1309), `fill()` (1311-1392), `validateSelection()` (446-499), `toggleMultiSelect()`/`resolveMultiSelectConfig()` (1690-1789), `setBeforeAutoExecute()` (919-942), auto-execute watcher (850-858)
- `src/ui/composables/useActionControllerTypes.ts` (492 lines) — `ActionResult`/`ValidationResult` interfaces (122-134), `start`/`fill` public type signatures (395-400)
- `src/ui/composables/useDragDrop.ts` (350 lines) — `DragOptions`/`DragProps` (109-132), `dragProps()` (212-235), `evalCondition()`/`drag()`/`dragClasses()` (299-327)
- `src/ui/composables/useDragDropTargets.ts` — Case B auto-start call site (277-306) confirming `actionController.start()` return value is currently discarded there (safe for the return-type widening)
- `src/ui/composables/useAutoZoom.ts` (133 lines, full file read) — `computeFitZoom()` (32-40), `measureAndFit()` (57-82), startup state machine (`onBoardResize`/`endStartup`, 89-115)
- `src/ui/components/GameShell.vue` (2922 lines) — toast/live-region ownership (339-340, 752, 1750-1850), zoom container CSS (2817-2839), `useAutoZoom` wiring (287-291), `#game-board`/`#player-stats` slots (1964-1971, 2110-2168), `provide('actionController', ...)` (966)
- `src/ui/components/Toast.vue` (126 lines, full file read) — error variant styling (89-92), role attribution (19), NO non-color cue beyond `role` (resolves UI-SPEC FLAG #1 — confirmed gap, out of scope per UI-SPEC)
- `src/ui/composables/useToast.ts` (66 lines, full file read) — `error()` default duration 4000ms (45-47), confirms UI-SPEC's timing claim
- `src/session/game-session.ts` (2603 lines) — `#runner` field (236), `get runner()` (858-860), all 3 reassignment sites (341, 379, 484), confirmed zero internal uses of the public `this.runner` getter (all internal access via `this.#runner`)
- `src/runtime/runner.ts` (partial read, targeted grep) — `GameRunner` public member inventory (66-494): `game` (68, readonly), `actionHistory` (74, readonly), `performAction` (155), `getSnapshot`/`getPlayerView`/`getAllPlayerViews`/`getFlowState`/`getFlowDebugInfo`/`getPendingAction`/`isComplete`/`getWinners` (all confirmed read-only-safe)
- `grep -rn "\.runner\b" src` (full repo grep) — confirmed `session.runner` (the GameSession accessor) has exactly 10 consumers, ALL in `*.test.ts` files, ALL read-only (`getSnapshot()`, `.game`, `.actionHistory`); zero production consumers; zero `.performAction` calls through this accessor anywhere in the repo
- `docs/custom-ui-guide.md` (targeted reads at lines 100-150, 230-260, 300-330) — confirmed fire-and-forget `start()` example (Pattern B) and unchecked `fill()` example needing DOCX-04 updates
- `.planning/tmp/v4.5-audit-findings.json` — full read of findings F17, F18, F19, F29, F30, F31 (indices in file, cross-referenced with REQUIREMENTS.md's UIX-01..05/SESS-01 mapping) — all six verdicts re-confirmed against current post-Phase-133 source; no drift found from the audit's original evidence
- `vitest.config.ts` — test environment config (`node` default, per-file jsdom override pattern confirmed via `GameShell.test.ts:1`)
- `/Users/jtsmith/BoardSmithGames/cribbage/src/ui/components/CribbageBoard.vue:539` — confirmed the ONLY reference-game consumer of `setBeforeAutoExecute` besides `demo-animation/src/ui/components/GameTable.vue:344`; both discard the return value today (safe for the `void` → `() => void` return-type addition)

### Secondary (MEDIUM confidence)

None — this research required no external verification; it is entirely internal codebase tracing.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all internal
- Architecture: HIGH — every pattern traced to exact file:line against current source, cross-checked with reference-game consumers
- Pitfalls: HIGH — all three pitfalls derived from direct code reads (not speculation), including the UIX-03 structural-fix rejection which is grounded in the exact CSS/measurement mechanism traced above
- SESS-01 blast radius: HIGH — full-repo grep confirms zero production consumers and exactly 10 test-file read-only consumers

**Research date:** 2026-07-03
**Valid until:** Stable — this is internal-codebase research tied to the exact post-Phase-133 commit; valid until the next phase touches any of the six target files (Phase 134 itself will invalidate parts of this research by design — re-verify against PROC-01 before Phase 135+ if any of these files are touched again)
