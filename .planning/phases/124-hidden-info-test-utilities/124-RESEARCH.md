# Phase 124: Hidden-Info Test Utilities - Research

**Researched:** 2026-07-01
**Domain:** BoardSmith engine visibility model + Vue component test infrastructure (internal codebase, no external packages)
**Confidence:** HIGH — every claim below is grounded in direct file:line reads of this repo, cross-checked against the CONTEXT.md audit evidence.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Visibility Assertion API (VIS-01/02)**
- Visibility is computed from the SAME serialization path the wire uses (`toJSONForPlayer`/`getPlayerView` machinery) — assertions cannot drift from actual leak behavior (pit of success)
- `getVisibleElements(seat)` returns live engine elements (ElementCollection — queryable with the existing collection API), not serialized JSON
- `diffPlayerViews` returns a structured object (`{onlyInA, onlyInB, attributeDiffs}`-style) plus a readable `describe()` string — mirrors the Phase 123 FlowDebugInfo pattern
- Add assertion helpers `assertHidden`/`assertVisible` in testing/assertions with rich failure messages that embed what leaked and to which seat

**DOM-Leak Test Utility (VIS-03)**
- Headless vitest utility in `boardsmith/testing` that mounts a UI component with a seat-filtered gameView (reuse BoardSmith's existing Vue component-test infrastructure)
- Forbidden identity markers are AUTOMATICALLY derived from the elements hidden from that seat (attribute values, data-* attributes, image paths) — no manual leak lists
- Attribute-focused matching with a configurable allowlist to avoid false positives (e.g. a legitimate "7" elsewhere in the UI)
- Prove in-repo against the AutoUI card renderer this phase; example games adopt the utility in Phase 129

**Visibility Semantics**
- Three-state visibility model: **visible** (identity serialized) / **present-but-hidden** (element exists on the wire as a back/count but identity attrs excluded) / **absent** (not serialized at all)
- Spectator (seat 0) supported in all APIs
- Browser/devtools exposure: none this phase — testing-layer only

### Claude's Discretion
- Exact names/types — follow the v4.3 introspection family conventions (`getActionSpace`/`getPlayerView` naming style)

### Deferred Ideas (OUT OF SCOPE)
- Game-repo adoption of these utilities (go-fish/cribbage DOM-leak tests) — Phase 129 migration
- Devtools/browser exposure of visibility diffing — not needed; per-seat state already visible via seat switching
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| VIS-01 | Developer can assert per-seat element visibility in tests via `isElementVisible(element, seat)` / `getVisibleElements(seat)` on TestGame (no hand-parsing ElementJSON) | Pattern 1 — thin wrapper over the existing `GameElement.isVisibleTo(seat)` primitive; verified as the exact function `toJSONForPlayer` already calls, so no drift risk. Code example provided. |
| VIS-02 | Developer can diff what two seats see (`diffPlayerViews`-style utility) to verify hidden information stays hidden | Pattern 2 — positional (not id-based) diff walker, informed by the engine's documented id-preservation asymmetry (Pitfalls 1/2) between individually-hidden and zone-hidden elements; Open Question 1 flags the `attributeDiffs` scoping decision for planning. |
| VIS-03 | Developer can run a DOM-leak test utility that renders the game UI as seat N and fails when hidden-element identity (rank/suit/face attributes) appears in the rendered DOM | Pattern 3 (minimal `AutoUI` mount contract) + Pattern 4 (auto-derived forbidden markers from unfiltered `toJSON()`); existing jsdom/`@vue/test-utils` mount conventions cited from `CardRenderer.a11y.test.ts`/`GameOverCard.test.ts`; Pitfall 4 flags the required `@vitest-environment jsdom` pragma. |
</phase_requirements>

## Summary

Phase 124 is pure internal-surface work: no new dependencies, no external APIs. The engine
already has a single, well-factored visibility primitive (`GameElement.isVisibleTo(seat)`,
`src/engine/element/game-element.ts:696`) that `Game.toJSONForPlayer()`
(`src/engine/element/game.ts:2671`) uses internally for every per-element hide/show decision on
the wire (then applies a `GameClass.playerView` post-transform, game.ts:2813-2816, which the
final-tree derivation also honors).
This means VIS-01 (`isElementVisible`/`getVisibleElements`) can be a *thin wrapper* around
`isVisibleTo` — literally the same function the serializer calls — which satisfies the CONTEXT.md
"same serialization path" decision without needing to walk ElementJSON at all for the
live-element APIs.

VIS-02 (`diffPlayerViews`) is harder: it must diff two `PlayerStateView.state` (`ElementJSON`)
trees, and the engine deliberately anonymizes IDs for zone-hidden children (negative
synthetic IDs, `src/engine/element/game.ts:2753`) so raw id-matching across two per-seat views
will not line up. The diff must walk both trees positionally (by child index within each
parent, mirroring the existing generic differ in `src/testing/debug.ts:402` `findDiffs`) rather
than by id, and special-case the `__hidden`/`childCount`/anonymized-id shape as "present but
opaque" rather than naively reporting every anonymized id as "added"/"removed" noise.

VIS-03 (DOM-leak utility) has a ready-made, minimal mount contract: `AutoUI.vue` only requires
`gameView` (an `ElementJSON`/`GameElement`-shaped object — i.e. `PlayerStateView.state`) and
`playerSeat` as props (`src/ui/components/auto-ui/AutoUI.vue:21-29`); it does not require a
`GameShell` wrapper or a `provideBoardInteraction()` call — `CardRenderer.vue` calls
`tryUseBoardInteraction()` (not the throwing `useBoardInteraction()`), which degrades to
`undefined` outside a `GameShell`. Existing tests in
`src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` and
`src/ui/components/GameOverCard.test.ts` already establish the `@vitest-environment jsdom` +
`@vue/test-utils` `mount()` pattern this utility should reuse. The forbidden-marker source is
the FULL (unfiltered) `game.toJSON()` attributes of every element that is NOT visible to the
target seat — diffed against the filtered view already available via
`isElementVisible`/`getVisibleElements` from VIS-01, so VIS-03 composes VIS-01 rather than
re-deriving visibility.

**Primary recommendation:** Build all three utilities directly on the two existing engine
primitives — `element.isVisibleTo(seat)` and `game.toJSONForPlayer(seat)` — and the existing
`AutoUI` component's minimal prop contract. Do not build a parallel visibility evaluator, a new
DOM traversal library, or a new Vue test harness — reuse `@vue/test-utils` `mount()` exactly as
the existing renderer tests do.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-seat element visibility check (VIS-01) | Engine (`src/engine/element`) | Testing (`src/testing`) | `isVisibleTo`/`getEffectiveVisibility` already live in the engine as the single source of truth; testing layer only wraps/queries it |
| Live-element query by seat (`getVisibleElements`) | Testing (`src/testing/test-game.ts`) | Engine (`ElementCollection`) | Testing composes `game.all(GameElement).filter(...)`; no new engine API needed |
| Per-seat view diff (VIS-02) | Testing (`src/testing`) | — | Operates on `PlayerStateView` (already an engine/runtime output); pure test-layer logic, no engine changes |
| DOM-leak rendering (VIS-03) | Testing (`src/testing`) | UI (`src/ui/components/auto-ui/AutoUI.vue`) | Testing utility drives the existing UI component in isolation (headless mount); UI component itself is unmodified — it's the proof target, not something to change |
| Assertion helpers (`assertHidden`/`assertVisible`) | Testing (`src/testing/assertions.ts`) | — | Pure test-layer convenience wrapping VIS-01/02 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@vue/test-utils` | `^2.4.11` (installed, `package.json`) [VERIFIED: package.json devDependencies] | Mount `AutoUI.vue` headlessly for the DOM-leak utility | Already used by every existing renderer test (`CardRenderer.a11y.test.ts`, `GameOverCard.test.ts`) — no new dependency |
| `jsdom` | `^29.1.1` (installed, `package.json`) [VERIFIED: package.json devDependencies] | DOM environment for the mount (`// @vitest-environment jsdom` per-file pragma) | Already the established per-file pragma pattern across `src/ui/components/**/*.test.ts`; vitest.config.ts default environment is `node`, so this phase's new test files MUST add the pragma |
| `vitest` | `^2.1.0` (installed) [VERIFIED: package.json devDependencies] | Test runner | Existing project standard |

### Supporting
None — no new runtime dependencies are needed. This phase adds pure TypeScript utility functions to `src/testing/`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@vue/test-utils` `mount()` | `happy-dom` + manual `render()` | Project already standardized on jsdom + `@vue/test-utils`; switching adds inconsistency for zero benefit |
| Reusing `isVisibleTo` | Building a parallel "visibility evaluator" that re-implements zone/owner rules | Would violate the CONTEXT.md "same serialization path" decision and create a second source of truth that can silently drift from `toJSONForPlayer` |

**Installation:** None required — all dependencies already present in `package.json`.

## Package Legitimacy Audit

Not applicable — this phase installs no new packages. All libraries used (`@vue/test-utils`,
`jsdom`, `vitest`) are pre-existing project dependencies confirmed via `package.json` reads
(`npm view` / registry checks are unnecessary since nothing new is being installed).

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │  Game (engine)                           │
                    │  toJSONForPlayer(seat) ──┐               │
                    │       calls               │               │
                    │  GameElement.isVisibleTo(seat)            │
                    │  (SAME primitive, both paths)             │
                    └──────────┬────────────────┬───────────────┘
                               │                 │
                 (A) live-element path   (B) serialized-view path
                               │                 │
                               ▼                 ▼
                 ┌─────────────────────┐  ┌──────────────────────────┐
                 │ isElementVisible()  │  │ getPlayerView(seat)       │
                 │ getVisibleElements()│  │  → PlayerStateView.state  │
                 │ (src/testing/       │  │  (ElementJSON, __hidden   │
                 │  test-game.ts)      │  │   placeholders applied)   │
                 └──────────┬──────────┘  └───────────┬───────────────┘
                            │                          │
                            │              ┌───────────┴────────────┐
                            │              │                        │
                            ▼              ▼                        ▼
                 ┌────────────────┐  ┌─────────────┐   ┌─────────────────────┐
                 │ assertHidden/   │  │diffPlayerViews│  │ DOM-leak utility    │
                 │ assertVisible   │  │ (VIS-02)      │  │ (VIS-03):           │
                 │ (VIS-01 assert) │  │ two seats'    │  │ mount AutoUI with   │
                 │                 │  │ .state trees  │  │ gameView=view.state,│
                 │                 │  │ walked         │  │ scan wrapper.html() │
                 │                 │  │ positionally   │  │ for markers derived │
                 │                 │  │               │  │ from FULL (unfiltered)
                 │                 │  │               │  │ attrs of hidden elems│
                 └────────────────┘  └─────────────┘   └─────────────────────┘
```

### Recommended Project Structure
```
src/testing/
├── test-game.ts          # ADD: isElementVisible(element, seat), getVisibleElements(seat)
├── assertions.ts          # ADD: assertHidden(testGame, element, seat), assertVisible(...)
├── view-diff.ts           # NEW FILE: diffPlayerViews(viewA, viewB) — structured + describe()
├── dom-leak.ts            # NEW FILE: renderAsSeat()/assertNoHiddenInfoLeak() — mounts AutoUI
└── index.ts               # export the above
```

### Pattern 1: Reuse `isVisibleTo` directly for live-element visibility (VIS-01)
**What:** `isElementVisible(element, seat)` is a one-line wrapper: `element.isVisibleTo(seat)`.
`getVisibleElements(seat)` enumerates `game.all(GameElement)` and filters by the same call.
**When to use:** Any test needing "is X visible to seat N" without hand-parsing ElementJSON.
**Example:**
```typescript
// Source: src/engine/element/game-element.ts:696 (existing primitive)
isVisibleTo(player: Player | number): boolean {
  const seat = typeof player === 'number' ? player : player.seat;
  const visibility = this.getEffectiveVisibility();
  const ownerSeat = this.getEffectiveOwner()?.seat;
  return canPlayerSee(visibility, seat, ownerSeat);
}

// New testing-layer wrapper (Phase 124):
export function isElementVisible(element: GameElement, seat: number): boolean {
  return element.isVisibleTo(seat);
}

export function getVisibleElements(game: Game, seat: number): ElementCollection<GameElement> {
  return game.all(GameElement).filter((e) => e.isVisibleTo(seat));
}
```
**IMPORTANT — count-only zones:** `isVisibleTo` already returns `false` for a `count-only`
element (`canPlayerSee` treats `'hidden'` and `'count-only'` identically — both return `false`
unless the seat is in `addPlayers`). This exactly matches `toJSONForPlayer`'s own
`visibility.mode === 'count-only' && !element.isVisibleTo(...)` branch
(`src/engine/element/game.ts:2682`) — confirming `isVisibleTo` matches the wire's PER-ELEMENT hide/show branch. **Caveat:**
`toJSONForPlayer` also runs a `GameClass.playerView(state, seat, game)` POST-TRANSFORM
(`src/engine/element/game.ts:2813-2816`) AFTER the per-element filter — so `isVisibleTo` alone is
NOT the full final view for games defining `static playerView`. VIS-01/02/03 therefore derive
visibility/markers from the FINAL `toJSONForPlayer` tree, using `isVisibleTo` only as a fast path
when `playerView` is undefined. No divergence risk.

### Pattern 2: Positional (not id-based) diff for `diffPlayerViews` (VIS-02)
**What:** Walk `viewA.state` and `viewB.state` (both `ElementJSON`) recursively, comparing
children BY INDEX within the same parent — not by `id`, because zone-hidden children get
synthetic negative IDs recomputed per call (`-(element._t.id * 1000 + i)`,
`src/engine/element/game.ts:2753`), which are NOT stable identifiers a viewer's seat A can be
matched against seat B's placeholder for the "same" underlying card. Individually-hidden
elements (not zone-hidden) DO keep their real, stable `id` (`src/engine/element/game.ts:2724`,
intentional for FLIP animation) — so id CAN be used to correlate those specific nodes across
seats, but the algorithm must handle both shapes (index-correlated anonymized children vs.
id-correlated individually-hidden elements).
**When to use:** Building `diffPlayerViews(viewA, viewB)`.
**Example — the existing generic differ this can extend/mirror:**
```typescript
// Source: src/testing/debug.ts:402 (existing pattern to build on, NOT a hidden-info-aware diff)
function findDiffs(before: any, after: any, path: string, diffs: string[]): void {
  // ... recursively walks two JSON trees positionally, path-based reporting
}
```
Recommendation: do NOT reuse `findDiffs` verbatim (it produces string diffs, not the
`{onlyInA, onlyInB, attributeDiffs}` structured shape CONTEXT.md locks in) — write a
purpose-built walker in `view-diff.ts` that mirrors its positional-walk strategy but returns
structured objects, following the Phase 123 `FlowDebugInfo` shape convention
(`src/engine/flow/describe-flow-position.ts:115` — structured fields + a `describe(): string`
method).

### Pattern 3: Minimal `AutoUI` mount contract for the DOM-leak utility (VIS-03)
**What:** `AutoUI.vue` requires only two props to render a full board: `gameView` and
`playerSeat` (`presentation`/`flowState` optional).
**When to use:** Headlessly rendering "what seat N's UI looks like" without a `GameShell`.
**Example:**
```typescript
// Source: src/ui/components/auto-ui/AutoUI.vue:21-29 (existing component contract)
defineProps<{
  gameView: GameElement | null | undefined;
  flowState?: FlowState;
  playerSeat: number;
  presentation?: PresentationOverlay;
}>();
```
```typescript
// New DOM-leak utility (Phase 124) — mount pattern mirrors CardRenderer.a11y.test.ts / GameOverCard.test.ts
// @vitest-environment jsdom  <-- REQUIRED pragma; vitest.config.ts default environment is 'node'
import { mount } from '@vue/test-utils';
import AutoUI from '../ui/components/auto-ui/AutoUI.vue';

const view = testGame.getPlayerView(seat);         // PlayerStateView (filtered, __hidden-marked)
const wrapper = mount(AutoUI, {
  props: { gameView: view.state, playerSeat: seat },
});
const html = wrapper.html();
// scan `html` for forbidden markers derived from hidden elements' FULL (unfiltered) attrs
```
**Note:** `tryUseBoardInteraction()` (used by `CardRenderer.vue`, `PieceRenderer.vue`, etc.)
returns `undefined` outside a `GameShell`/`provideBoardInteraction()` context — confirmed by
`CardRenderer.a11y.test.ts`'s pattern of calling `provideBoardInteraction()` only when it wants
to assert on interaction state, implying it is optional otherwise. No `GameShell` wrapper or
WebSocket/session mocking is needed for the DOM-leak mount.

### Pattern 4: Deriving forbidden markers automatically (VIS-03 locked decision)
**What:** For each element NOT visible to the target seat (`!element.isVisibleTo(seat)`),
collect its FULL, unfiltered attribute values from `game.toJSON()` (NOT `toJSONForPlayer`) —
these are the ground-truth identity values (rank, suit, name, `$image` URL string, etc.) that
must never appear in the rendered DOM for that seat.
**When to use:** Building the "no manual leak lists" requirement from CONTEXT.md.
**Example:**
```typescript
// Pseudocode for the marker-derivation step
const hiddenElements = game.all(GameElement).filter((e) => !e.isVisibleTo(seat));
const forbiddenMarkers = new Set<string>();
for (const el of hiddenElements) {
  const fullJson = el.toJSON(); // UNFILTERED — the real identity
  for (const [key, value] of Object.entries(fullJson.attributes ?? {})) {
    if (typeof value === 'string' && value.length > 0) forbiddenMarkers.add(value);
    // numeric rank/suit-index values also need string-coercion + scanning
  }
  if (fullJson.name) forbiddenMarkers.add(fullJson.name);
}
```
Then scan `wrapper.html()` (or `wrapper.element.outerHTML`) for each marker as a substring,
respecting the CONTEXT.md-mandated configurable allowlist (to avoid false positives like a
legitimate "7" elsewhere in the UI — e.g. a turn counter or score).

### Anti-Patterns to Avoid
- **Re-deriving visibility rules instead of calling `isVisibleTo`:** Any new logic that
  re-implements "is this owner-only / count-only / hidden" would create a second source of
  truth that can silently diverge from `toJSONForPlayer` — exactly the failure mode CONTEXT.md's
  locked decision is designed to prevent.
- **ID-based diffing across seats in `diffPlayerViews`:** Zone-hidden children get
  regenerated synthetic negative IDs (`-(element._t.id * 1000 + i)`) — matching by ID across two
  different seats' views will produce false "onlyInA"/"onlyInB" noise for every anonymized
  child, even when the underlying zone contents are identical.
- **Requiring a full `GameShell` mount for the DOM-leak utility:** Adds WebSocket/session
  mocking complexity `AutoUI.vue`'s prop contract does not require.
- **Naive substring scan without an allowlist:** A card rank "7" or suit-count is a common,
  legitimately-visible UI value (turn number, score, other visible cards) — an allowlist (or at
  minimum, scoping the scan to `data-*` attributes + `img[src]` + `.card-image` background-image
  URLs specifically, as CONTEXT.md's specifics call out) avoids false-positive test failures.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-seat visibility determination | A parallel zone/owner visibility evaluator | `element.isVisibleTo(seat)` (`src/engine/element/game-element.ts:696`) | Already the exact function `toJSONForPlayer` calls; a second evaluator is a drift risk by construction |
| Rendering "what seat N sees" | A custom headless DOM renderer / manual attribute-walker of ElementJSON | Mount the existing `AutoUI.vue` with `@vue/test-utils` | `AutoUI` + `CardRenderer.vue` etc. already IS the production rendering logic (image selection, `__hidden` handling, anchor attrs) — mounting it directly tests the real leak surface, not a reimplementation of it |
| JSON tree diffing infrastructure | A brand-new generic diff library/dependency | Extend the existing positional-walk pattern in `src/testing/debug.ts:402` (`findDiffs`) | In-repo precedent already solves the "walk two parallel JSON trees" problem; only the output shape needs to change to the CONTEXT.md-locked structured format |

**Key insight:** Every piece of this phase already has an in-repo analog (a visibility
primitive, a JSON differ, a renderer component with a minimal prop contract, and a debug-info
structured-object convention from Phase 123). The job is composition and shaping outputs to the
locked API contract — not new algorithms.

## Common Pitfalls

### Pitfall 1: Assuming ElementJSON id is a stable cross-seat identifier
**What goes wrong:** A `diffPlayerViews` implementation that matches children by `id` across
two different seats' `PlayerStateView.state` trees will report every anonymized (zone-hidden)
child as both "removed from A" and "added in B", even when the underlying hand contents are
byte-identical.
**Why it happens:** `toJSONForPlayer` assigns fresh synthetic negative IDs
(`-(element._t.id * 1000 + i)`) to zone-hidden children on every serialization call — these are
positional placeholders, not identity.
**How to avoid:** Diff positionally (by index within a parent), and treat the whole
"anonymized child" subtree as a single opaque comparison unit (compare `className` + `childCount`
+ redacted-attribute-shape only, never `id`).
**Warning signs:** A diff utility that reports large `onlyInA`/`onlyInB` sets even when two
seats are known (from a game-logic assertion) to see the same set of face-down cards.

### Pitfall 2: Individually-hidden elements DO keep stable IDs — don't blanket-strip them either
**What goes wrong:** Assuming ALL hidden elements get anonymized IDs (over-generalizing from
Pitfall 1) and writing a diff/leak-check that discards `id` universally, missing an actual
identity leak carried via a real, stable id for a single face-down card placed in an otherwise
visible parent (`hideFromAll()`/`showOnlyTo()` case, `src/engine/element/game.ts:2698-2731`, an
intentional design tradeoff for FLIP animation correlation).
**Why it happens:** The engine's own code comment calls this "INTENTIONAL ASYMMETRY" — the two
hidden-element code paths (individually-hidden vs. zone-hidden-child) deliberately have
DIFFERENT id-preservation behavior.
**How to avoid:** Read `src/engine/element/game.ts:2694-2732` (individually-hidden branch, keeps
stable id) vs. `2739-2788` (zone-hidden children, synthetic ids) before writing any id-comparison
logic in `diffPlayerViews` or the DOM-leak marker set. Handle both shapes explicitly rather than
assuming one rule for all hidden elements.

### Pitfall 3: Scanning rendered DOM without an allowlist produces false-positive leak failures
**What goes wrong:** A naive "does the HTML contain the string '7'" check will false-positive on
any legitimate visible UI text containing that substring (turn counters, scores, other visible
cards' ranks, CSS class names with numbers).
**Why it happens:** Rank/suit values (`'7'`, `'AS'`, etc.) are short, common substrings likely to
appear elsewhere in a real game UI for unrelated reasons.
**How to avoid:** CONTEXT.md already locks in "configurable allowlist" — scope the scan to
attribute-value matches on specific surfaces (`data-*` attribute values, `img[src]` / CSS
`background-image` URL fragments) rather than a blind substring search of the entire rendered
text content, and let callers pass known-safe overlapping values (e.g. a turn counter that
happens to equal a hidden card's rank).

### Pitfall 4: `vitest.config.ts` default environment is `node`, not `jsdom`
**What goes wrong:** A new DOM-leak test file that doesn't add the `// @vitest-environment
jsdom` pragma will fail (no `document` global) or silently no-op depending on what `mount()`
does under a non-DOM environment.
**Why it happens:** `vitest.config.ts` sets `environment: 'node'` project-wide (verified:
`vitest.config.ts:9`); every UI component test in this repo opts into `jsdom` per-file via the
pragma comment (confirmed across 10+ files in `src/ui/components/**/*.test.ts`).
**How to avoid:** Any new test file (or the utility's own internal test) that calls `mount()`
MUST start with `// @vitest-environment jsdom` as the first line.
**Warning signs:** `ReferenceError: document is not defined`, or `@vue/test-utils` throwing on
`mount()`.

### Pitfall 5: `name` is stripped for hidden elements, but don't assume EVERY identity-bearing field is
**What goes wrong:** Confidently asserting "no leak" because `element.name` is absent for
hidden elements, while missing that `attributes.notation` (used for `data-bs-el-notation` via
`anchorAttrs`, `src/ui/composables/useBoardInteraction.ts:408`) could leak identity through a
different attribute path if a game defines a custom notation scheme that isn't covered by
`redactHiddenElementAttrs`'s `SAFE_LAYOUT_KEYS` allowlist.
**Why it happens:** `redactHiddenElementAttrs` (`src/engine/element/game.ts:363`) drops all
non-`$`-prefixed keys and all unknown `$`-keys by default (fail-safe design) — this is verified
correct for the CURRENT `SAFE_LAYOUT_KEYS` set, but a future game or future engine change adding
a new `$`-key could silently punch a hole if `SAFE_LAYOUT_KEYS` isn't updated in lockstep. This
is a defense-in-depth argument FOR the DOM-leak utility (VIS-03) as a regression guard, not a
reason to skip building it.
**How to avoid:** The DOM-leak utility derives its forbidden-marker set from the FULL unfiltered
`toJSON()` attributes (Pattern 4 above) — NOT from a hardcoded list of "known identity fields"
like `rank`/`suit`/`name`. This makes it correctly catch any attribute the engine's redaction
allowlist might miss for a given game's custom attribute names, satisfying the "no blind spots"
Highest-Risk-Item #2 concern in STATE.md.

## Code Examples

### `isElementVisible` / `getVisibleElements` (VIS-01)
```typescript
// Source: composing src/engine/element/game-element.ts:696 + src/engine/element/game-element.ts:450 (game.all)
import { Game, GameElement } from '../engine/index.js';
import type { ElementCollection } from '../engine/index.js';

export function isElementVisible(element: GameElement, seat: number): boolean {
  return element.isVisibleTo(seat);
}

export function getVisibleElements(game: Game, seat: number): ElementCollection<GameElement> {
  return game.all(GameElement).filter((e) => e.isVisibleTo(seat));
}
```

### `assertHidden` / `assertVisible` (VIS-01 assertions)
```typescript
// Pattern mirrors assertActionAvailable's rich-failure-message style (src/testing/assertions.ts:206-241)
export function assertHidden(element: GameElement, seat: number): void {
  if (element.isVisibleTo(seat)) {
    const leaked = Object.keys(element.toJSON().attributes ?? {});
    throw new Error(
      `Element ${element.constructor.name}#${element.id} is visible to seat ${seat} ` +
      `(expected hidden): serialized attributes [${leaked.join(', ')}] present in seat ${seat}'s view`
    );
  }
}

export function assertVisible(element: GameElement, seat: number): void {
  if (!element.isVisibleTo(seat)) {
    throw new Error(
      `Element ${element.constructor.name}#${element.id} is hidden from seat ${seat} ` +
      `(expected visible)`
    );
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Hand-parsing `ElementJSON` for hidden-info assertions (the audit's stated problem) | `isElementVisible`/`getVisibleElements` on live engine elements | This phase (124) | No JSON parsing needed for visibility assertions |
| Manual DOM inspection for leak-checking (go-fish's only prior art was broadcast-message text matching, not DOM) | Automated `AutoUI` mount + auto-derived forbidden-marker scan | This phase (124) | First DOM-level leak guard in the framework; go-fish's message-leak test remains a separate, complementary regression guard (not superseded) |

**Deprecated/outdated:** None — this is net-new test-utility surface, no existing API is being
replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `tryUseBoardInteraction()` returns `undefined` (not throwing) outside a `GameShell`/`provideBoardInteraction()` context, so `AutoUI` can be mounted standalone without a board-interaction provider | Pattern 3 | If wrong, the DOM-leak utility mount would need a `provideBoardInteraction()` stub wrapper component (small fix, not a redesign) — verify with a one-off `mount(AutoUI, {...})` spike before locking the plan |

Everything else in this research was verified directly by reading the cited file:line in this
repository — a codebase read is a HIGH-confidence, VERIFIED source per this project's own
conventions (not `[ASSUMED]`).

## Open Questions (RESOLVED)

1. **Exact shape of `diffPlayerViews`'s `attributeDiffs` for individually-hidden vs.
   zone-hidden elements**
   - What we know: the two branches have different id-preservation behavior (Pitfall 2) and the
     structured output must distinguish "an element only one seat can see" from "an element both
     seats see but with different attribute values."
   - What's unclear: whether zone-hidden anonymized children should appear in `attributeDiffs`
     at all (their attributes are already redacted-to-nothing by design) or should be entirely
     excluded from the diff as "known-opaque, not a diff-worthy discrepancy."
   - Recommendation: Planner should scope `diffPlayerViews` to report `onlyInA`/`onlyInB` for
     elements visible-to-exactly-one-seat (using `isElementVisible` under the hood) and
     `attributeDiffs` only for elements BOTH seats can see but disagree on attribute values —
     this reframes VIS-02 as composing VIS-01's per-element visibility check rather than a raw
     JSON tree diff, which sidesteps the anonymized-id correlation problem entirely. Confirm this
     framing during planning/discuss-phase since it's a design choice, not a verified fact.
   - **RESOLVED (adopted by 124-02):** diffPlayerViews scopes onlyInA/onlyInB to
     elements visible-to-exactly-one-seat and attributeDiffs to elements BOTH seats see,
     composing 124-01's final-tree isElementVisible over the post-playerView PlayerStateView.state.

2. **Allowlist mechanism shape for the DOM-leak utility**
   - What we know: CONTEXT.md locks in "configurable allowlist to avoid false positives."
   - What's unclear: whether the allowlist is a caller-supplied list of exempt strings/attribute
     names, or a caller-supplied predicate function, or scoped by CSS selector.
   - Recommendation: Given the codebase's existing style (predicate-based finders throughout
     `ElementFinder`/`Sorter` types), a predicate-based allowlist
     (`(marker: string, context: {attribute: string; element: unknown}) => boolean`) fits the
     established API idiom better than a flat string list — but this is a `Claude's Discretion`
     item per CONTEXT.md; the planner should pick the simplest shape that satisfies "configurable."
   - **RESOLVED (adopted by 124-03):** the allowlist is a caller-supplied predicate
     `(marker: string, context: { attribute?: string }) => boolean` (matches the ElementFinder/Sorter idiom).

## Environment Availability

Skipped — this phase has no external tool/service dependencies. All required libraries
(`@vue/test-utils`, `jsdom`, `vitest`) are already installed project dependencies (verified via
`package.json` read); no new installs, runtimes, or services are needed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 (existing project standard) |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` |
| Quick run command | `npx vitest run src/testing/ --reporter=dot` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIS-01 | `isElementVisible(element, seat)` / `getVisibleElements(seat)` return correct per-seat results for owner/hidden/count-only/all visibility modes | unit | `npx vitest run src/testing/test-game.test.ts -t visib` | ❌ Wave 0 — add cases to `src/testing/test-game.test.ts` or a new `src/testing/visibility.test.ts` |
| VIS-02 | `diffPlayerViews(viewA, viewB)` returns correct `{onlyInA, onlyInB, attributeDiffs}` + `describe()` for a known hidden-info scenario (e.g. two hands with different cards) | unit | `npx vitest run src/testing/view-diff.test.ts` | ❌ Wave 0 — new file |
| VIS-03 | DOM-leak utility mounted with a seat-filtered `gameView` fails when a hidden card's rank/suit/face-image appears in `wrapper.html()`, and passes on the redacted (`toJSONForPlayer`) view | unit (jsdom) | `npx vitest run src/testing/dom-leak.test.ts` | ❌ Wave 0 — new file; MUST include `// @vitest-environment jsdom` pragma |

### Sampling Rate
- **Per task commit:** `npx vitest run src/testing/ --reporter=dot`
- **Per wave merge:** `npm test` (full suite — this phase touches shared `src/testing/index.ts`
  exports, so a full-suite run catches any export-barrel regression)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/testing/visibility.test.ts` (or extend `test-game.test.ts`) — covers VIS-01, needs a
      test game fixture with owner/hidden/count-only zones (an in-repo minimal test-fixture game,
      following the pattern already used by `test-game.test.ts`/`action-builder.test.ts`)
- [ ] `src/testing/view-diff.test.ts` — covers VIS-02, needs a 2-seat scenario with both an
      individually-hidden element AND a zone-hidden collection to exercise both id-preservation
      branches (Pitfall 2)
- [ ] `src/testing/dom-leak.test.ts` — covers VIS-03, needs `// @vitest-environment jsdom` and a
      positive-control assertion (proves the matcher actually catches a deliberately-injected
      leak, not just that it passes on already-correct code — a leak-detector with no failing
      case is unproven per Highest-Risk-Item #2 in STATE.md)
- [ ] No new framework install needed — `@vue/test-utils`/`jsdom`/`vitest` already present

## Security Domain

`security_enforcement` not found as `false` in `.planning/config.json` context provided — but
this phase is test-tooling only (no new user input paths, no new auth/session/crypto surface).
ASVS categories are not meaningfully applicable to internal test utilities that operate on
already-trusted, already-serialized engine state. Noting explicitly rather than omitting
silently: **no ASVS category applies** — this phase does not introduce a new attack surface,
it builds a regression guard against an EXISTING information-disclosure risk (hidden-info
leakage), which is itself a testing/QA control, not a new control surface requiring its own
threat-model entry.

## Sources

### Primary (HIGH confidence — direct codebase reads, 2026-07-01)
- `src/engine/element/game.ts:2671-2820` (`toJSONForPlayer`, `redactHiddenElementAttrs`) — the
  serialization visibility machinery
- `src/engine/element/game-element.ts:663-739` (`isVisibleTo`, `getEffectiveVisibility`,
  `getEffectiveOwner`) — the single visibility primitive
- `src/engine/command/visibility.ts` (`canPlayerSee`, `resolveVisibility`, `VisibilityState`) —
  the visibility rule engine both paths share
- `src/runtime/runner.ts:463-472` (`getPlayerView`, `getAllPlayerViews`)
- `src/engine/utils/snapshot.ts:97-258` (`PlayerStateView` interface, `createPlayerView`)
- `src/testing/test-game.ts:1-60, 300-380` (`TestGame.getPlayerView`, existing doc conventions)
- `src/testing/assertions.ts` (existing assertion style/failure-message conventions)
- `src/testing/debug.ts:388-441` (`findDiffs` — existing generic JSON differ precedent)
- `src/engine/flow/describe-flow-position.ts` (Phase 123 structured-object + `describe()`
  pattern to mirror)
- `src/ui/components/auto-ui/AutoUI.vue`, `AutoRenderer.vue` — minimal mount contract
- `src/ui/components/auto-ui/renderers/CardRenderer.vue` — face/back image resolution,
  `__hidden` handling, `anchorAttrs` usage
- `src/ui/composables/useBoardInteraction.ts:396-414` (`anchorAttrs`)
- `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts`,
  `src/ui/components/GameOverCard.test.ts` — existing Vue mount test patterns
- `vitest.config.ts` — default `environment: 'node'`, confirming the per-file jsdom pragma
  requirement
- `package.json` — confirms `@vue/test-utils`, `jsdom`, `vitest` versions already installed
- `~/BoardSmithGames/go-fish/tests/no-hidden-info-leak.test.ts` — existing (message-only, not
  DOM) hidden-info regression test, the prior art this phase generalizes
- `.planning/phases/124-hidden-info-test-utilities/124-CONTEXT.md` — locked decisions and audit
  evidence
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — requirement text,
  phase scope, risk register

### Secondary / Tertiary
None used — all findings verified directly against the local repository (no external web
sources were needed; this is a fully internal-surface phase).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing versions read directly from `package.json`
- Architecture: HIGH — every pattern is grounded in specific file:line reads of the actual engine/UI code, including the exact serialization branches and their id-preservation asymmetry
- Pitfalls: HIGH — pitfalls 1/2 are derived from explicit code comments in `game.ts` documenting the intentional asymmetry; pitfall 4 confirmed by reading `vitest.config.ts` + existing test file pragmas

**Research date:** 2026-07-01
**Valid until:** Stable for the life of this milestone (internal surface, no external dependency drift risk) — re-verify only if `toJSONForPlayer`/`isVisibleTo` are refactored in a later phase.
