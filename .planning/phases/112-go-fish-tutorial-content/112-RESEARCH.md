# Phase 112: Go-Fish Tutorial Content - Research

**Researched:** 2026-06-29
**Domain:** Card-game tutorial authoring (Go Fish cross-repo, BoardSmith substrate extension)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Card Anchoring & Overlay Strategy**
- Name tutorial-relevant cards in the preset so an overlay's `target: { kind: 'element', ref: { name } }` resolves through AutoUI's rendered `data-bs-el-id` — the direct card-game analog of checkers' named pieces (`TUTORIAL_PIECE_NAME`). This is the parity path the milestone is meant to prove (board square `notation` → card `name`).
- The ask-step overlay anchors to the learner's matching cards in their own hand (the rank they hold), with text pointing at the opponent target.
- Rely on AutoUI Card rendering to expose a stable anchor id (`data-bs-el-id` from the card's stable `id`); verify at execution. If AutoUI does not surface a resolvable anchor for named cards, that is a flagged AutoUI/substrate gap to fix in BoardSmith — not a go-fish workaround.
- Overlay tooltip placement defaults to `top`, consistent with checkers.

**Area 2 — Tutorial Preset & Deterministic Hands**
- Add a `resetToTutorialPreset()` (or equivalent setup) on `GoFishGame` that deals scripted, named hands — mirrors checkers' `resetToTutorialPreset()` / `placeTutorialPieces()`.
- One combined scenario forces all four beats: the learner holds three of a rank R plus a second rank that will miss; an opponent holds the fourth R. Flow: a successful ask (turn continuation, beat 4) → an ask that misses → Go Fish draw (beat 2) → completing four-of-R into a book (beat 3). Ask-for-rank gating (beat 1) frames the first ask.
- The preset is toggled in tests via `TestGame.create(..., { tutorialSetup: true })` (checkers parity), invoked from `TutorialDefinition.setup()`.
- Pin a fixed deck seed (e.g. `go-fish-tutorial-pinned`) so the deal and walkthrough are reproducible.

**Area 3 — Step Gating & Advancement Semantics**
- Gate the `ask` action's `rank` and `target` selections via `gate.selections` matching the legal tutorial rank value + opponent. **Flagged risk:** go-fish's `ask` uses `chooseFrom('target')` / `chooseFrom('rank')` with primitive/player-choice values, not element selections — `selectionMatchesValue` may not match these. If it does not, **extend the matcher minimally in BoardSmith with a unit test** (real substrate gap), do not gate around it.
- Beat 2 (Go Fish tip): a `advanceWhen` predicate that fires when an ask misses and the player must draw (reads game state) — NOT `whenForced`.
- Beat 3 (forming a book): a predicate detecting the player's scored-books count increased (book scored and removed from hand) via `game.checkForBooks` state.
- Beat 4 (turn continuation): a predicate detecting `extraTurn` was granted / the same player asks again (the turn does not end on a hit).

**Area 4 — CI Test & Cross-Repo Build/Scope**
- **Green→red proof:** deliberately disable turn-continuation (force `extraTurn: false`) and confirm the tutorial CI test fails — ties directly to a go-fish rule the tutorial teaches.
- **Test structure mirrors checkers:** `~/BoardSmithGames/go-fish/tests/tutorial.test.ts` using `simulateTutorial(testGame, GO_FISH_TUTORIAL, { seat, scenario, seed })` + `assertTutorialCompletes`, asserting `stepsVisited` contains all four beats.
- **Cross-repo build loop:** rely on go-fish's symlinked `node_modules/boardsmith` (live source per CLAUDE.md); no re-vendor. Keep BoardSmith vitest green throughout.
- **BoardSmith `src/` scope:** none expected; the only allowed change is extending the `selections` matcher (with a unit test) if the Area 3 gap is confirmed.

### Claude's Discretion
- Exact preset hand composition (which rank R, the missing rank, filler cards) as long as it deterministically forces the four beats in order.
- The exact tutorial step count and ids; the precise predicate expressions; named-card naming scheme.
- How the launch surface is confirmed (the v4.1 ControlsMenu "Start tutorial" + `start-tutorial` op should light up purely from attaching `tutorial:` to `gameDefinition` — verify, no new substrate expected).

### Deferred Ideas (OUT OF SCOPE)
- Go-fish AI teaching (move hint + narrated AI-vs-AI demo, GFAI-*) → Phase 113.
- Go-fish action help (GFHELP-01) and host teaching-lockout verification (GFLOCK-01) → Phase 114.
- Developer documentation of the substrate (DOC-*) → Phase 115.
- The evaluation heatmap stays board-only — explicitly out of scope for go-fish.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GFT-01 | A new player can complete a guided ask-for-a-rank step — action gating restricts the choice to a legal ask (an opponent + a rank the player holds), and an annotation overlay anchors to the relevant cards/action. | Confirmed by gate analysis (Q1 below). `target` matcher works as-is; `rank` matcher needs minimal BoardSmith extension. Card name anchoring works via existing `ref: { name }` path. |
| GFT-02 | A predicate-triggered tip explains the Go Fish! draw the first time an ask misses and the player must draw from the deck. | Confirmed: `advanceWhen` predicate using `pond.count(Card) < PRESET_POND_SIZE` detects the draw from game state. `TutorialGateContext` does NOT provide `lastActionResult`; all predicates must use game state. |
| GFT-03 | The tutorial teaches forming a book — completing four of a rank scores it and removes it from the hand. | Confirmed: `(player as GoFishPlayer).bookCount > 0` or `getPlayerBooks(player).count(Card) > 0` detects book formation from game state. `checkForBooks()` is the sole book-formation path. |
| GFT-04 | The tutorial teaches turn continuation — a successful ask lets the same player go again (the turn does not end on a hit). | Confirmed: `flow.ts` at line 77 uses `ctx.lastActionResult?.data?.extraTurn` to set `turnEnded`. The game state signal is hand size growth (step1 advanceWhen) or pond-count change (step2 advanceWhen). |
| GFT-05 | The go-fish tutorial is launchable from the game in both GameShell and the `boardsmith dev` host. | Confirmed: attaching `tutorial: GO_FISH_TUTORIAL` to `gameDefinition` in `index.ts` is the ONLY wiring needed. All v4.1 substrate (ControlsMenu `hasTutorial` prop, GameShell `handleTeachingAction`, bridge `start-tutorial` op, stateless-ops `startTutorial`) is already shipped. No new BoardSmith changes for GFT-05. |
| GFT-06 | The go-fish tutorial is authored as a CI-verifiable artifact (the `testing` DSL) that fails a test when a go-fish rule change breaks it. | Confirmed: `simulateTutorial` + `assertTutorialCompletes` pattern from checkers. Green→red proof: monkey-patch `checkForBooks = () => []` → `bookCount` never increments → step 1 `advanceWhen` (`bookCount > 0`) never fires → "Tutorial drift (predicate)" throw. |
</phase_requirements>

---

## Summary

Phase 112 authors the go-fish tutorial cross-repo (`~/BoardSmithGames/go-fish`), proving the v4.1 substrate generalizes from a grid board (checkers) to a hidden-information card game. The phase follows the checkers Phase 109 pattern closely: a `TutorialDefinition` constant, a `resetToTutorialPreset()` method on `GoFishGame`, and a CI test using `simulateTutorial` + `assertTutorialCompletes`.

There is one confirmed BoardSmith substrate gap: `selectionMatchesValue` in `src/engine/tutorial/gate.ts` returns false for all primitive values (strings/numbers). Go-fish's `rank` selection yields primitive strings from `getPlayerRanks()`, so `gate.selections.rank` cannot match them as-is. The fix is a two-line change to `selectionMatchesValue` adding `{ value: primitiveValue }` matcher support, plus a JSDoc update and a unit test. The `target` selection is unaffected (player choices are objects `{ value: seat, display: name }` and match via the existing general-field-equality path).

All other substrate (overlay anchoring by card name, launch surface, CI DSL, advanceWhen predicates) works with the existing v4.1 code. No other BoardSmith `src/` changes are expected. The cross-repo dev loop is live via symlink — no re-vendor needed.

**Primary recommendation:** Plan three waves — (1) BoardSmith matcher extension + unit test, (2) go-fish preset + tutorial definition, (3) CI test + green→red proof. Execute waves 1 and 2/3 sequentially (2 depends on 1 being correct).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tutorial gate enforcement (rank/target) | Engine (BoardSmith `src/engine/tutorial/gate.ts`) | — | Gate logic lives in `selectionMatchesValue`; already called by `getGateReasonForValue` in the engine's hot path |
| Tutorial step advance (advanceWhen predicates) | Engine (BoardSmith `src/engine/tutorial/progress.ts`) | Go-fish game state (cross-repo) | `autoAdvanceTutorial` evaluates predicates; predicates read `GoFishGame` state |
| Card-name anchoring (overlay target) | Go-fish game definition (cross-repo) | BoardSmith UI overlay | Cards are named at creation time in `GoFishGame.createDeck()`; overlay resolves by name via `matchesRef` |
| Deterministic preset | Go-fish game class (cross-repo) | TestGame options | `resetToTutorialPreset()` on `GoFishGame`; triggered by `tutorialSetup: true` via `TestGame.create` |
| Launch surface ("Start tutorial" menu) | BoardSmith UI (`ControlsMenu.vue`, `GameShell.vue`) | Bridge, stateless-ops | Already shipped in v4.1 Phase 109; purely a `gameDefinition.tutorial` wiring in `index.ts` |
| CI-verifiable tutorial test | Go-fish tests (cross-repo) | BoardSmith testing DSL | `tests/tutorial.test.ts` in go-fish repo; uses `simulateTutorial` from `boardsmith/testing` |

---

## Standard Stack

### Core (already installed — symlinked live from BoardSmith)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `boardsmith` | symlinked local | Tutorial types, gate, progress, testing DSL | Phase 109 shipped all tutorial substrate; go-fish symlinks to live source |
| `boardsmith/testing` | symlinked local | `simulateTutorial`, `assertTutorialCompletes`, `TestGame`, `TutorialScenarioMove` | Proven in checkers tutorial.test.ts; identical import path |
| `vitest` | (in go-fish package.json) | Test runner | Already configured (`vitest.config.ts`), `npm run test` works |

### No New Packages

This phase installs no new npm packages. All dependencies are already present in `~/BoardSmithGames/go-fish/package.json` (boardsmith symlinked) and `~/BoardSmith/package.json`.

---

## Package Legitimacy Audit

No new packages are installed in this phase. Section not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Tutorial Authoring (go-fish cross-repo)
─────────────────────────────────────────────────────────
                    ┌──────────────────────────────┐
                    │  GO_FISH_TUTORIAL: TutorialDefinition │
                    │  (src/rules/tutorial.ts)      │
                    │  setup() → resetToTutorialPreset()   │
                    │  steps[0]: ask-for-rank gate   │
                    │  steps[1]: turn-continuation   │
                    │  steps[2]: go-fish-tip         │
                    │  steps[3]: book-formed         │
                    └──────────────┬───────────────┘
                                   │ attached to
                    ┌──────────────▼───────────────┐
                    │  gameDefinition (index.ts)     │
                    │  tutorial: GO_FISH_TUTORIAL    │
                    └──────────────┬───────────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               ▼                   ▼                   ▼
   ┌──────────────────┐ ┌─────────────────┐ ┌────────────────────┐
   │ BoardSmith engine │ │  BoardSmith UI  │ │  CI test           │
   │ gate.ts:          │ │  (already live) │ │  tutorial.test.ts  │
   │ selectionMatches  │ │  ControlsMenu   │ │  simulateTutorial  │
   │ Value() extended  │ │  → start-       │ │  assertTutorial    │
   │ for primitives    │ │    tutorial op  │ │  Completes         │
   └──────────────────┘ └─────────────────┘ └────────────────────┘
               ▲
               │ uses
   ┌──────────────────────────────────────┐
   │  GoFishGame.resetToTutorialPreset()  │
   │  (game.ts)                           │
   │  P1: [7H, 7D, QH]                  │
   │  P2: [7S]                           │
   │  Pond: [7C on top, rest 46]         │
   └──────────────────────────────────────┘
```

### Recommended Project Structure (go-fish cross-repo additions)

```
~/BoardSmithGames/go-fish/
├── src/rules/
│   ├── game.ts              # ADD: resetToTutorialPreset(), tutorialSetup option
│   ├── tutorial.ts          # NEW: GO_FISH_TUTORIAL: TutorialDefinition
│   └── index.ts             # EDIT: export GO_FISH_TUTORIAL, gameDefinition.tutorial
└── tests/
    └── tutorial.test.ts     # NEW: simulateTutorial walkthrough + green→red proof
```

BoardSmith `src/` (one file change for matcher extension):
```
src/engine/tutorial/
├── gate.ts                  # EDIT: selectionMatchesValue primitive support
├── gate.test.ts             # EDIT: add primitive-matcher unit test
└── types.ts                 # EDIT: update SelectionMatcher JSDoc
```

---

## Q1: Matcher Gap — Confirmed Substrate Gap

**This is the #1 risk. Full analysis follows.**

### `selectionMatchesValue` — current implementation

Source: `src/engine/tutorial/gate.ts` lines 66–77 [VERIFIED: read directly]

```typescript
function selectionMatchesValue(matcher: SelectionMatcher, value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;  // ← blocks ALL primitives
  const val = value as Record<string, unknown>;

  // ElementRef precedence: if matcher specifies id, that alone determines match.
  if ('id' in matcher) return val['id'] === matcher['id'];
  if ('notation' in matcher) return val['notation'] === matcher['notation'];
  if ('name' in matcher) return val['name'] === matcher['name'];

  // General field equality for choice objects (DestinationChoice, etc.).
  return Object.entries(matcher).every(([k, v]) => val[k] === v);
}
```

### go-fish `ask` selection value shapes

Source: `actions.ts` lines 35–70 + `game.ts` lines 2070–2088 + `action.ts` line 388 [VERIFIED: read directly]

`getGateReasonForValue` is called in `action.ts` line 388:
```typescript
const gateReason = getGateReasonForValue(tutorialStep, actionName!, choice, selection.name);
```

where `choice` is the **raw value from the `choices()` function**, before any `extractChoiceValue` unwrapping.

| Selection name | `choices()` return type | Raw value passed to gate | `selectionMatchesValue` result |
|----------------|------------------------|--------------------------|-------------------------------|
| `target` | `game.playerChoices()` → `{ value: number; display: string }[]` | `{ value: 2, display: 'Bob' }` (object) | **Works**: general field equality on `{ value: 2 }` matcher → `val['value'] === 2` → true |
| `rank` | `game.getPlayerRanks()` → `string[]` | `'7'` (primitive string) | **Fails**: first line `typeof value !== 'object'` → `return false` — ALL rank choices blocked |

### Verdict

- **`target` selection**: `gate.selections: { target: { value: opponentSeat } }` works as-is via the general field equality path on the `{ value, display }` choice object. [VERIFIED: confirmed by tracing `playerChoices()` return type and `selectionMatchesValue` logic]
- **`rank` selection**: primitive string → `selectionMatchesValue` returns false. **CONFIRMED SUBSTRATE GAP.** [VERIFIED: confirmed by code inspection]

The types.ts JSDoc (line 122–124) acknowledges this limitation with "use a `TutorialGateCondition` predicate instead." The CONTEXT.md decision overrides this: "extend the matcher minimally in BoardSmith with a unit test (real substrate gap), do not gate around it."

### Minimal fix

Edit `src/engine/tutorial/gate.ts`, `selectionMatchesValue`:

```typescript
function selectionMatchesValue(matcher: SelectionMatcher, value: unknown): boolean {
  // Primitive support: { value: primitiveValue } matches a primitive string/number choice.
  // Enables gate.selections for chooseFrom() with string/number choices (e.g. rank: { value: '7' }).
  if (typeof value !== 'object' || value === null) {
    return 'value' in matcher && matcher['value'] === value;
  }
  const val = value as Record<string, unknown>;

  if ('id' in matcher) return val['id'] === matcher['id'];
  if ('notation' in matcher) return val['notation'] === matcher['notation'];
  if ('name' in matcher) return val['name'] === matcher['name'];

  return Object.entries(matcher).every(([k, v]) => val[k] === v);
}
```

Also update `SelectionMatcher` JSDoc in `types.ts` to replace the "NOTE: not supported" paragraph with documentation of the `{ value: primitiveValue }` form.

Unit test to add in `gate.test.ts`:
```typescript
it('selections: primitive rank string matched via { value } key', () => {
  const step: TutorialStep = {
    id: 's',
    gate: { action: 'ask', selections: { rank: { value: '7' } } },
  };
  expect(getGateReasonForValue(step, 'ask', '7', 'rank')).toBeNull();     // '7' allowed
  expect(getGateReasonForValue(step, 'ask', 'K', 'rank')).not.toBeNull(); // 'K' blocked
  expect(getGateReasonForValue(step, 'ask', 7, 'rank')).not.toBeNull();   // number 7 ≠ string '7'
});
```

---

## Q2: Card Anchoring

### How cards are named

Source: `go-fish/src/rules/game.ts` lines 82–93 [VERIFIED: read directly]

```typescript
private createDeck(): void {
  for (const suit of GoFishGame.SUITS) {
    for (const rank of GoFishGame.RANKS) {
      const card = this.pond.create(Card, `${rank}${suit}`, { suit, rank });
      // ...
    }
  }
}
```

The second argument to `create()` is the element's `name`. Cards are named `'7H'`, `'7D'`, `'7C'`, `'7S'`, `'QH'`, etc. These names are stable, collision-free (rank+suit is unique), and match the tutorial preset card identities.

### Overlay resolution path

`target: { kind: 'element', ref: { name: '7H' } }` resolves via:
1. `matchesRef` in `useBoardInteraction` — name precedence: id > notation > name
2. Since only `name` is specified, it finds the element with `element.name === '7H'`
3. That element's numeric `id` is found
4. The DOM element with `data-bs-el-id="<numeric-id>"` is highlighted

This is identical to checkers' `{ ref: { name: 'tutorial-p1' } }` for named pieces. **Works as-is. No substrate gap.** [VERIFIED: confirmed by reading checkers tutorial.ts pattern and go-fish createDeck()]

### Tutorial preset card naming

For the tutorial overlay anchor on step 1 (ask-for-rank), anchor to one of the 7s in P1's hand:
```typescript
target: { kind: 'element' as const, ref: { name: '7H' } }
```

This resolves to the card named `'7H'` (created by `this.pond.create(Card, '7H', { suit: 'H', rank: '7' })`) now residing in P1's hand after `resetToTutorialPreset()` moves it there.

---

## Q3: Deterministic Preset

### TestGame.create option passthrough

Source: `src/testing/test-game.ts` lines 91–99 [VERIFIED: read directly]

```typescript
static create<G extends Game>(GameClass, options: TestGameOptions): TestGame<G> {
  const { playerCount, playerNames: _pn, seed: _s, autoStart: _a, ...extraOptions } = options;
  const runner = new GameRunner({
    GameClass,
    gameType: GameClass.name.toLowerCase(),
    gameOptions: {
      ...extraOptions,  // ← tutorialSetup: true flows through here
      playerCount,
      playerNames,
      seed,
    },
  });
```

`tutorialSetup: true` flows from `TestGame.create(GoFishGame, { tutorialSetup: true })` → `GameRunner` → `GoFishGame` constructor options. ✓ [VERIFIED: confirmed by reading test-game.ts]

### GoFishGame constructor changes needed

Current `GoFishOptions` (game.ts line 9–12):
```typescript
export interface GoFishOptions extends GameOptions {
  seed?: string;
}
```

Add:
```typescript
export interface GoFishOptions extends GameOptions {
  seed?: string;
  /**
   * When true, skips shuffle+deal and calls resetToTutorialPreset() instead.
   * Used by the CI tutorial test for a stable, reproducible hand layout.
   */
  tutorialSetup?: boolean;
}
```

Constructor change (after `createDeck()`):
```typescript
// Current:
this.pond.shuffle();
this.dealCards();

// With tutorialSetup:
if (options.tutorialSetup) {
  this.resetToTutorialPreset();
} else {
  this.pond.shuffle();
  this.dealCards();
}
```

### resetToTutorialPreset() design

**Preferred preset (matches CONTEXT.md scenario order):**
- P1 (learner, seat 1): [7H, 7D, QH] — 2 sevens + 1 queen (3 cards)
- P2 (opponent, seat 2): [7S] — 1 seven (1 card)
- Pond: 48 remaining cards, with **7C at the top** (next draw position)

This forces the 4-beat ordering from CONTEXT.md:
1. Gated ask for 7 → P2 gives 7S → P1 has 3×7, no book, extraTurn=true (beat 4 precondition)
2. P1 asks for Q on extra turn → miss, go fish → draw 7C (4th 7) → book forms (beats 2+3) → extraTurn=false

**Implementation risk: pond top positioning.** `Pond` uses `setOrder('stacking')`. Whether `card.putInto(pond)` places the card at the draw-first position depends on the stacking implementation. The plan must verify and test this at implementation time. If explicit top-positioning is unreliable, fall back to Option B (see below).

**Option B preset (simpler, no pond ordering required):**
- P1: [7H, 7D, 7C, QH] — 3 sevens + 1 queen (4 cards)
- P2: [7S] — 1 seven
- Pond: 47 cards, any order

Beat ordering with Option B:
1. Gated ask for 7 → P2 gives 7S → 4×7 → book forms immediately (beat 3) → extraTurn=true
2. Step auto-advances (book-formed, beat 3) → step 3 (turn-continuation, beat 4) requires action
3. P1 asks for Q on extra turn → miss → go fish (beat 2) → draw from pond → no book → extraTurn=false

Steps 4 and 5 (go-fish-tip and end) auto-advance via pump. All 4 beats in `stepsVisited`.

**Recommendation:** Attempt the preferred preset (Option A with pond top control). The implementation should verify that after `sevenC.putInto(this.pond)` as the final step in `resetToTutorialPreset()`, `pond.drawTo(hand, 1, Card)` returns `sevenC` first. If this cannot be made reliable, switch to Option B.

```typescript
resetToTutorialPreset(): void {
  // Reset book counts
  for (const player of [...this.all(Player)] as GoFishPlayer[]) {
    player.bookCount = 0;
    // Move hand cards back to pond
    for (const card of [...this.getPlayerHand(player).all(Card)]) {
      card.putInto(this.pond);
    }
    // Clear books pile
    for (const card of [...this.getPlayerBooks(player).all(Card)]) {
      card.putInto(this.pond);
    }
  }

  const learner = this.getPlayer(1) as GoFishPlayer;
  const opponent = this.getPlayer(2) as GoFishPlayer;
  const learnerHand = this.getPlayerHand(learner);
  const opponentHand = this.getPlayerHand(opponent);

  // P1 hand: 2×7 + 1×Q
  this.first(Card, '7H')!.putInto(learnerHand);
  this.first(Card, '7D')!.putInto(learnerHand);
  this.first(Card, 'QH')!.putInto(learnerHand);

  // P2 hand: 1×7
  this.first(Card, '7S')!.putInto(opponentHand);

  // Put 7C LAST into pond so it's the first drawn card (stacking order)
  const sevenC = this.first(Card, '7C')!;
  sevenC.putInto(this.pond);  // Must verify at implementation: is this the draw-first position?
}
```

### TutorialDefinition.setup

```typescript
export const GO_FISH_TUTORIAL: TutorialDefinition = {
  setup: (game) => (game as GoFishGame).resetToTutorialPreset(),
  steps: [ ... ],
};
```

`simulateTutorial` does NOT call `setup()`. The CI test uses `TestGame.create(GoFishGame, { tutorialSetup: true })` to get the preset, matching the checkers pattern. `setup()` is called by `startTutorial` in the session layer for the production path. [VERIFIED: confirmed by reading simulate-tutorial.ts]

---

## Q4: advanceWhen Predicates — CRITICAL: Game State Only

### TutorialGateContext shape

Source: `src/engine/tutorial/types.ts` lines 99–105 [VERIFIED: read directly]

```typescript
export interface TutorialGateContext {
  /** The current game instance. Read-only; do NOT mutate. */
  game: Game;
  /** The seat number of the tutorial learner (1-indexed). */
  seat: number;
}
```

`TutorialGateContext` provides ONLY `game` and `seat`. There is **no `lastActionResult` field.** All `advanceWhen` predicates must read from game state, NOT from action result data. [VERIFIED: confirmed by reading types.ts]

This is the key structural difference from the CONTEXT.md's description of "reads `lastActionResult` / game state" — `lastActionResult` is NOT available. Only game state is accessible.

### Available go-fish game state for predicates

Source: `game.ts`, `elements.ts` [VERIFIED: read directly]

| Game State | Access Path | Purpose |
|------------|-------------|---------|
| Book count | `(game.getPlayer(ctx.seat) as GoFishPlayer).bookCount` | Beat 3: book formed (incremented by `checkForBooks()`) |
| Books pile cards | `(game as GoFishGame).getPlayerBooks(learner).count(Card)` | Beat 3: book cards visible |
| Pond size | `(game as GoFishGame).pond.count(Card)` | Beat 2: go fish draw (pond shrank) |
| Hand size | `(game as GoFishGame).getPlayerHand(learner).count(Card)` | Beat 4: got cards (hand grew) |
| Ranks in hand | `(game as GoFishGame).getPlayerRanks(learner)` | Detecting remaining askable ranks |

`bookCount` is a serializable `number = 0` on `GoFishPlayer` (elements.ts line 42), incremented by `checkForBooks()`. [VERIFIED: read directly]

### Beat→predicate mapping

**For the preferred preset (Option A, CONTEXT.md order):**

The preset starts with P1=[7H, 7D, QH] (3 cards), P2=[7S], Pond=[47 cards, 7C on top].
Define constant `const TUTORIAL_PRESET_POND_SIZE = 47` in tutorial.ts.

| Step | Beat | advanceWhen predicate | Fires when | Game state used |
|------|------|-----------------------|------------|-----------------|
| `ask-for-rank` (step 1) | Beat 1 + gate | `(ctx) => (ctx.game as GoFishGame).getPlayerHand(learner).count(Card) > 3` | P1 got 7S from P2 (hand grew 3→4) | hand count |
| `turn-continuation` (step 2) | Beat 4 | `(ctx) => (ctx.game as GoFishGame).pond.count(Card) < TUTORIAL_PRESET_POND_SIZE` | P1 drew from pond on go-fish miss | pond count |
| `go-fish-tip` (step 3) | Beat 2 | `(ctx) => (ctx.game as GoFishGame).pond.count(Card) < TUTORIAL_PRESET_POND_SIZE` | Same condition — fires immediately via pump | pond count |
| `book-formed` (step 4) | Beat 3 | `(ctx) => ((ctx.game as GoFishGame).getPlayer(ctx.seat) as GoFishPlayer).bookCount > 0` | 4×7 book formed from the go-fish draw | bookCount |

Note: steps 3 and 4 auto-advance consecutively in a single pump call (the pump loops up to `def.steps.length` times). Both appear in `stepsVisited` because `recordCurrentStep()` runs after each pump advance. [VERIFIED: confirmed by reading autoAdvanceTutorial in progress.ts and recordCurrentStep in simulate-tutorial.ts]

**For Option B preset (P1=[7H, 7D, 7C, QH]):**

`TUTORIAL_PRESET_POND_SIZE = 47` still (52 - 4 P1 cards - 1 P2 card).

Step ordering in Option B:
1. `ask-for-rank`: advanceWhen `bookCount > 0` (book forms from first ask with 4×7)
2. `book-formed` (auto-advances via pump if step 1 fires and bookCount already > 0 when step 2 starts — USE DIFFERENT CONDITION): advanceWhen `pond.count < 47` (fires when P1's extra turn ask misses and draws)
3. `turn-continuation`: advanceWhen `pond.count < 47` (fires immediately, same condition) 
4. `go-fish-tip`: advanceWhen `bookCount >= 0` or just use Option B with only 3 steps if beats 3+4 merge

The planner should choose Option A (CONTEXT.md order) and use Option B as fallback if pond top-positioning is unworkable.

---

## Q5: Launch Surface (GFT-05)

### Verdict: one line in index.ts

Source: checkers `src/rules/index.ts` pattern, 109-PATTERNS.md [VERIFIED: read directly]

The entire v4.1 launch surface — `ControlsMenu` "Start tutorial" group (shown when `hasTutorial=true`), `handleTeachingAction('start-tutorial')` in `GameShell`, `bridge.ts` `start-tutorial` wire op, and `stateless-ops.ts` `startTutorial` case — was shipped in Phase 109. No new BoardSmith changes are needed for GFT-05.

The ONLY wiring needed in go-fish is:

```typescript
// src/rules/index.ts
import { GO_FISH_TUTORIAL } from './tutorial.js';

export const gameDefinition = {
  gameClass: GoFishGame,
  gameType: 'go-fish',
  displayName: 'Go Fish',
  minPlayers: 2,
  maxPlayers: 6,
  ai: { objectives: getGoFishObjectives },
  tutorial: GO_FISH_TUTORIAL,  // ← this is the only change needed
} as const;
```

`tutorial` on `gameDefinition` causes:
1. Session layer attaches `GO_FISH_TUTORIAL` to `runner.game.tutorialDefinition`
2. `buildPlayerState` sets `hasTutorial: true` in `PlayerGameState`
3. `ControlsMenu` receives `hasTutorial=true` prop → shows "Tutorial" group
4. User clicks "Start tutorial" → `emit('teaching-action', 'start-tutorial')` → `platformRequest('start-tutorial', { seat })` → bridge → stateless-ops `startTutorial` → sets `tutorialProgress` + calls `setup()` + auto-advance pump

Also export `GO_FISH_TUTORIAL` from `index.ts` for the CI test import:
```typescript
export { GO_FISH_TUTORIAL } from './tutorial.js';
```

---

## Q6: CI Green→Red Proof

### Green test (intact rules)

Two-action walkthrough (preferred preset, Option A):
```typescript
const WALKTHROUGH: TutorialScenarioMove[] = [
  // P1 asks P2 for 7 (gated). Gets 7S. Hand: 3×7 + QH = 4 cards.
  // advanceWhen step1 fires (hand.count > 3) → step2 (turn-continuation).
  { action: 'ask', args: { target: 2, rank: '7' }, expectStep: 'turn-continuation' },

  // P1 asks P2 for Q (extra turn). Miss. Draw from pond (7C). 4×7 → book forms.
  // advanceWhen step2 fires (pond.count < 47) → step3 → step4 auto-advance → completed.
  { action: 'ask', args: { target: 2, rank: 'Q' }, expectStep: 'book-formed' },
];
```

`expectStep: 'book-formed'` is correct because the pump chains step2→step3→step4→completed in one call, leaving `stepId = 'book-formed'` (the last step) at completion.

`assertTutorialCompletes(result)` passes because status is `'completed'`.

`stepsVisited` contains all four ids: `['ask-for-rank', 'turn-continuation', 'go-fish-tip', 'book-formed']`.

### Red test (broken rule → Tutorial drift)

**Deliberate break:** monkey-patch `checkForBooks` to never form books.

```typescript
testGame.game.checkForBooks = () => [];
```

With this break:
- P1 asks for 7 → gets 7S (card transfer still happens) → 4 cards of rank 7 in hand, BUT `checkForBooks` returns `[]` → `player.bookCount` is NOT incremented → `bookCount = 0`
- Pump fires on step 1 (`ask-for-rank`). advanceWhen: `bookCount > 0` → false → does NOT advance
- Scenario move 1 has `expectStep: 'turn-continuation'`, but tutorial is still on `'ask-for-rank'`
- `simulateTutorial` throws: `"Tutorial drift (predicate): expected advance to 'turn-continuation' did not fire. Tutorial for seat 1 is on step 'ask-for-rank'."`

`expect(() => simulateTutorial(...)).toThrow(/Tutorial drift/)` → RED ✓

**Why this is the right break:** `checkForBooks()` is the go-fish rule that turns four-of-a-kind into a scored book. Patching it to return `[]` simulates "books don't score," which directly breaks the thing the tutorial teaches at beat 3 — and transitively prevents the tutorial from advancing past beat 1 (since step 1's `advanceWhen` depends on `bookCount > 0`). This ties the test to a real go-fish rule, identical in spirit to checkers' `playerHasCaptures = () => false` break.

**Alternative break tied to turn continuation (CONTEXT.md's suggestion):** force `extraTurn: false` in the action execute. This causes P1's turn to end after the first ask. The action itself succeeds (cards transfer), but `ctx.set('turnEnded', true)` fires in flow.ts. After step1's pump fires (hand count > 3), the tutorial advances to step2 (turn-continuation). The second scenario move `{ action: 'ask', args: { target: 2, rank: 'Q' } }` fails because it's P2's turn. `simulateTutorial` throws `"Tutorial scenario: action 'ask' by seat 1 ... failed"` (not "Tutorial drift"). Use `/Tutorial/` matcher for this break variant.

Recommended: use the `checkForBooks = () => []` break (throws "Tutorial drift (predicate)") as the primary CI green→red test. Include the `extraTurn: false` break as a secondary test to cover GFT-04 specifically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tutorial step management | Custom state machine | `TutorialDefinition` + `autoAdvanceTutorial` in `progress.ts` | Already shipped; handles pump, bounded advance, completion detection |
| Predicate evaluation | Custom eval loop | `evaluateConditionWithTrace` in `action.ts` | Shared evaluator for gate + advanceWhen; debug labels included |
| CI tutorial assertions | Custom test helpers | `simulateTutorial` + `assertTutorialCompletes` from `boardsmith/testing` | Proven in checkers; detects gate drift, predicate drift, non-completion |
| Overlay anchor resolution | Custom DOM query | `ref: { name: 'cardName' }` in step content | `matchesRef` in `useBoardInteraction` handles id>notation>name precedence |
| Primitive-value gate workaround | Predicate gate for rank | Extend `selectionMatchesValue` (one fix) | Keeps the matcher API consistent; avoids conditional gate-type logic in tutorial authoring |

---

## Common Pitfalls

### Pitfall 1: `lastActionResult` not available in `advanceWhen`

**What goes wrong:** Authoring `advanceWhen: { 'go fish': (ctx) => ctx.lastActionResult?.data?.goFish }` — TypeScript allows it but `ctx` is `TutorialGateContext` with only `{ game, seat }`. The property is `undefined` at runtime, so the predicate silently returns `undefined` (falsy) and the tutorial never advances.

**Root cause:** `TutorialGateContext` is the engine gate context, not the session/flow context that has `lastActionResult`.

**How to avoid:** Always read from `game` instance methods and player properties. Reference Q4's beat→predicate mapping table above. If a new game state signal is needed (e.g., "was this a go-fish turn?"), add a property to `GoFishGame` or `GoFishPlayer`.

**Warning signs:** Predicate never fires even when you believe the condition should be true; tutorial stalls.

### Pitfall 2: Rank selection gate without matcher extension

**What goes wrong:** Adding `gate.selections: { rank: { rank: '7' } }` (without the `selectionMatchesValue` fix) silently blocks ALL rank choices. The learner cannot select ANY rank, including the tutorial rank. The step is effectively unplayable.

**Root cause:** `selectionMatchesValue` early-returns false for any non-object value. `{ rank: '7' }` is not the same shape as `{ value: '7' }` even after the fix — the matcher key must be `value`.

**How to avoid:** Apply the `selectionMatchesValue` primitive fix first (Wave 1). Use `{ value: '7' }` as the matcher for primitive rank values. Verify with the unit test.

**Warning signs:** No rank choices are selectable; console shows all choices disabled.

### Pitfall 3: `suppressAutoFill` not set on gated rank selection

**What goes wrong:** With exactly one rank in hand (e.g., only Q after the 7s booked), the engine auto-fills the sole enabled rank choice before the learner interacts, skipping the teaching beat.

**Root cause:** `tryAutoFillSelection` fills exactly-one-enabled choices; the gate restricts to one rank (7) when learner has multiple ranks, but after booking, only Q remains and auto-fill fires.

**How to avoid:** Set `suppressAutoFill: true` on `ask-for-rank` step (or `suppressAutoFillFor: 'rank'` to scope it). Mirror checkers' `execute-capture` step which sets `suppressAutoFill: true` to prevent auto-selection of the sole valid piece.

**Warning signs:** The rank selection step seems to be skipped silently; learner never sees the choice.

### Pitfall 4: Book-formed beats fire before turn-continuation beat (Option A only)

**What goes wrong:** With P1=[7H, 7D, 7C, QH] preset, the book forms on the FIRST ask (4×7 immediately), so `book-formed` (beat 3) fires BEFORE `turn-continuation` (beat 4) is ever shown. The CONTEXT.md describes beat 4 before beat 3.

**Root cause:** Option A preset forms the book on the first ask; Option B (CONTEXT.md order) requires 2×7 + pond-7C.

**How to avoid:** Use Option A's step ordering (beat 3 first is acceptable) OR implement Option B with verified pond top-positioning. The CONTEXT.md grants Claude's Discretion on exact preset composition.

**Warning signs:** `stepsVisited` order doesn't match the intended teaching sequence.

### Pitfall 5: Pond top-positioning not deterministic (Option B)

**What goes wrong:** With Option B preset, `this.first(Card, '7C')!.putInto(this.pond)` may or may not place 7C at the draw-first position depending on stacking order internals. If 7C isn't drawn first, P1 draws a non-7 card on the go-fish miss, and the book never forms during the tutorial → step 4 advanceWhen (`bookCount > 0`) never fires → tutorial stalls.

**Root cause:** Stacking-order draw behavior is implementation-specific. `putInto` may append to the end (top of stack) or may be a no-op if the card is already in the pile.

**How to avoid:** At implementation time, write a quick test: `game.pond.drawTo(hand, 1, Card)` should return the card named `'7C'`. If not, either reorder the `putInto` calls or switch to Option A.

**Warning signs:** Test flaky under different seeds; tutorial stalls at `go-fish-tip` or `book-formed`.

### Pitfall 6: Missing opponent turns in CI scenario

**What goes wrong:** After P1's scenario actions complete, `simulateTutorial` returns immediately (it doesn't wait for game flow to finish). If the test includes `assertTutorialCompletes(result)` and the pump hasn't fired the last step's advanceWhen, the tutorial isn't completed.

**Root cause:** Unlike checkers (where `eachPlayer` forces P2 to act before the game loop can restart), go-fish's tutorial completes entirely within P1's turn. P2's moves are NOT needed in the scenario for the tutorial to reach `completed`.

**How to avoid:** The go-fish scenario needs only P1's 2 actions (or 1 action for Option A). Do NOT add P2 moves mimicking the checkers pattern — the flow is different.

**Warning signs:** `assertTutorialCompletes(result)` succeeds without P2 moves; this is correct.

---

## Code Examples

### Tutorial definition skeleton

```typescript
// src/rules/tutorial.ts (go-fish)
import type { TutorialDefinition } from 'boardsmith';
import { Card } from './elements.js';
import type { GoFishGame } from './game.js';
import type { GoFishPlayer } from './elements.js';

// Cards in pond after preset: 52 - 3 (P1: 7H,7D,QH) - 1 (P2: 7S) = 48
// OR: 52 - 4 (P1: 7H,7D,7C,QH) - 1 (P2: 7S) = 47 for Option B
const TUTORIAL_PRESET_POND_SIZE = 48; // adjust per chosen preset

export const GO_FISH_TUTORIAL: TutorialDefinition = {
  setup: (game) => (game as GoFishGame).resetToTutorialPreset(),

  steps: [
    {
      id: 'ask-for-rank',
      suppressAutoFill: true,
      gate: {
        action: 'ask',
        selections: {
          target: { value: 2 },   // opponent seat 2 — works as-is (object)
          rank: { value: '7' },   // requires selectionMatchesValue fix (primitive)
        },
      },
      content: [
        {
          text: 'Ask your opponent for your rank. Select a 7 to ask for.',
          target: { kind: 'element' as const, ref: { name: '7H' } },
          placement: 'top' as const,
        },
      ],
      advanceWhen: {
        'got cards from ask': (ctx): boolean => {
          const game = ctx.game as GoFishGame;
          return game.getPlayerHand(game.getPlayer(ctx.seat) as GoFishPlayer).count(Card) > 3;
        },
      },
    },

    {
      id: 'turn-continuation',
      gate: { action: 'ask' },
      content: [{ text: 'You got cards — your turn continues! Ask for another rank.' }],
      advanceWhen: {
        'go fish draw occurred': (ctx): boolean => {
          return (ctx.game as GoFishGame).pond.count(Card) < TUTORIAL_PRESET_POND_SIZE;
        },
      },
    },

    {
      id: 'go-fish-tip',
      gate: { action: 'ask' },
      content: [{ text: 'Go Fish! Your opponent had none, so you drew from the pond.' }],
      advanceWhen: {
        'go fish tip shown': (ctx): boolean => {
          return (ctx.game as GoFishGame).pond.count(Card) < TUTORIAL_PRESET_POND_SIZE;
        },
      },
    },

    {
      id: 'book-formed',
      gate: { action: 'ask' },
      content: [{ text: 'You formed a book! Four of a kind scores a point.' }],
      advanceWhen: {
        'book scored': (ctx): boolean => {
          const player = (ctx.game as GoFishGame).getPlayer(ctx.seat) as GoFishPlayer;
          return player.bookCount > 0;
        },
      },
    },
  ],
};
```

### CI test skeleton

```typescript
// tests/tutorial.test.ts (go-fish)
import { describe, it, expect } from 'vitest';
import { TestGame, simulateTutorial, assertTutorialCompletes } from 'boardsmith/testing';
import type { TutorialScenarioMove } from 'boardsmith/testing';
import { GoFishGame, GO_FISH_TUTORIAL } from '../src/rules/index.js';

describe('Go Fish tutorial — CI walkthrough (GFT-06)', () => {
  it('intact rules: tutorial completes and all four beats are visited', () => {
    const testGame = TestGame.create(GoFishGame, {
      playerCount: 2,
      playerNames: ['Learner', 'Opponent'],
      seed: 'go-fish-tutorial-pinned',
      tutorialSetup: true,
    });

    const WALKTHROUGH: TutorialScenarioMove[] = [
      {
        action: 'ask',
        args: { target: 2, rank: '7' },
        expectStep: 'turn-continuation',
      },
      {
        action: 'ask',
        args: { target: 2, rank: 'Q' },
        expectStep: 'book-formed',
      },
    ];

    const result = simulateTutorial(testGame, GO_FISH_TUTORIAL, {
      seat: 1,
      scenario: WALKTHROUGH,
      seed: 'go-fish-tutorial-pinned',
    });

    assertTutorialCompletes(result);

    expect(result.stepsVisited).toContain('ask-for-rank');
    expect(result.stepsVisited).toContain('turn-continuation');
    expect(result.stepsVisited).toContain('go-fish-tip');
    expect(result.stepsVisited).toContain('book-formed');
  });

  it('break: checkForBooks patched to never score → tutorial stalls at ask-for-rank', () => {
    const testGame = TestGame.create(GoFishGame, {
      playerCount: 2,
      playerNames: ['Learner', 'Opponent'],
      seed: 'go-fish-tutorial-pinned',
      tutorialSetup: true,
    });

    // Simulate "books never score" rule break: checkForBooks always returns []
    // without incrementing bookCount. This prevents step1's advanceWhen
    // (bookCount > 0) from ever firing.
    testGame.game.checkForBooks = () => [];

    expect(() =>
      simulateTutorial(testGame, GO_FISH_TUTORIAL, {
        seat: 1,
        scenario: [
          { action: 'ask', args: { target: 2, rank: '7' }, expectStep: 'turn-continuation' },
        ],
      })
    ).toThrow(/Tutorial drift/);
  });
});
```

### selectionMatchesValue fix

```typescript
// src/engine/tutorial/gate.ts — replace the opening guard
function selectionMatchesValue(matcher: SelectionMatcher, value: unknown): boolean {
  // Primitive support: { value: primitiveValue } matches a primitive string/number choice.
  if (typeof value !== 'object' || value === null) {
    return 'value' in matcher && matcher['value'] === value;
  }
  const val = value as Record<string, unknown>;
  if ('id' in matcher) return val['id'] === matcher['id'];
  if ('notation' in matcher) return val['notation'] === matcher['notation'];
  if ('name' in matcher) return val['name'] === matcher['name'];
  return Object.entries(matcher).every(([k, v]) => val[k] === v);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `from`/`to` flat fields on `TutorialGateAllowList` | `selections` map keyed by selection name | Phase 109 Plan 01 | Per-selection gating; `from`/`to` removed without deprecation |
| Predicate gate for primitive choices | `gate.selections: { name: { value: primitive } }` | Phase 112 (this phase) | Rank gating is now declarative rather than imperative |
| No tutorial support in card games | `TutorialDefinition.setup()` + named cards | Phase 112 (this phase) | Proves substrate generalizes from grid to card games |

**Deprecated/outdated:**
- `whenForced(actionName)`: not used for go-fish (no single-action-only step); all steps use custom `advanceWhen` predicates or broad gates.
- Old `TutorialGateAllowList.from` / `.to`: already removed in Phase 109.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `card.putInto(pond)` after moving other cards to hands places the card at the "top" (first drawn position) for `setOrder('stacking')` | Q3 preset design | Tutorial stalls at `go-fish-tip` / `book-formed` if 7C isn't drawn on P1's go-fish miss. Fallback: Option B preset avoids pond ordering entirely. |
| A2 | After `testGame.game.checkForBooks = () => []`, `player.bookCount` is never incremented (the monkey-patch prevents the entire `checkForBooks` body from running) | Q6 green→red | If `bookCount` is incremented elsewhere (e.g., by the flow or another hook), the break test would fail to go red. Verify by checking all `bookCount++` calls in the codebase. |
| A3 | P2 has no Q cards (so P1's second ask for Q misses) | Preset design | If P2 holds a Q, P1 gets Q from P2 rather than drawing from pond. Go-fish beat doesn't trigger. Verify by ensuring preset moves QH only to P1 and leaves no other Qs in P2's hand (P2 only gets 7S). |

**If this table were empty:** All claims were verified or cited — no user confirmation needed.

---

## Open Questions

1. **Pond top-positioning reliability (Option A)**
   - What we know: `Pond extends Deck`, `pond.setOrder('stacking')`, `pond.drawTo(hand, 1, Card)` draws one card
   - What's unclear: whether `putInto(pond)` as the last call makes that card the first drawn
   - Recommendation: The plan should include a micro-test step: after `resetToTutorialPreset()`, call `pond.drawTo(tmpHand, 1, Card)` and assert the result is `'7C'`. If it fails, switch to Option B preset.

2. **advanceWhen: step 3 and step 4 are "instant" (auto-advance via pump)**
   - What we know: `autoAdvanceTutorial` loops up to `def.steps.length` times; steps 3 and 4 have immediately-true conditions after the second ask
   - What's unclear: whether the UX of two steps flashing through instantly is acceptable for the v4.2 demo
   - Recommendation: acceptable for CI (all 4 steps in `stepsVisited`); the UX concern is deferred to a future "dwell time" substrate improvement (R-05 backlog).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node` | Test runner (vitest) | ✓ | (system node) | — |
| `vitest` | `npm run test` in go-fish | ✓ | configured in `vitest.config.ts` | — |
| `boardsmith` (symlinked) | Tutorial types, testing DSL | ✓ | symlink → `~/BoardSmith/src/` (live) | — |
| Go-fish repo | Cross-repo target | ✓ | `~/BoardSmithGames/go-fish` | — |

**No missing dependencies.** The symlinked boardsmith dev loop is confirmed working (pre-existing game in go-fish).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (go-fish `vitest.config.ts`) + vitest (BoardSmith `vitest.config.ts`) |
| Config file | `~/BoardSmithGames/go-fish/vitest.config.ts` |
| Quick run (go-fish) | `cd ~/BoardSmithGames/go-fish && npx vitest run tests/tutorial.test.ts` |
| Full suite (go-fish) | `cd ~/BoardSmithGames/go-fish && npm run test` |
| BoardSmith gate | `cd ~/BoardSmith && npm test` (must stay green throughout) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GFT-01 | Ask-for-rank gate restricts to correct opponent + rank | integration (simulateTutorial) | `npx vitest run tests/tutorial.test.ts` | ❌ Wave 0 |
| GFT-02 | Go-fish tip fires when ask misses and pond is drawn | integration (simulateTutorial stepsVisited) | `npx vitest run tests/tutorial.test.ts` | ❌ Wave 0 |
| GFT-03 | Book-formed step fires when 4-of-kind complete | integration (simulateTutorial stepsVisited) | `npx vitest run tests/tutorial.test.ts` | ❌ Wave 0 |
| GFT-04 | Turn-continuation step fires after successful ask | integration (simulateTutorial stepsVisited) | `npx vitest run tests/tutorial.test.ts` | ❌ Wave 0 |
| GFT-05 | Tutorial launches in GameShell/dev host (browser) | manual smoke | browser via `npx boardsmith dev` in go-fish | N/A (manual) |
| GFT-06 | CI test goes red when go-fish rule is broken | integration (green→red test) | `npx vitest run tests/tutorial.test.ts` | ❌ Wave 0 |
| Matcher fix | `rank: { value: '7' }` allows '7', blocks 'K' | unit | `cd ~/BoardSmith && npx vitest run src/engine/tutorial/gate.test.ts` | partial (gate.test.ts exists, new cases needed) |

### Sampling Rate

- **Per task commit:** `cd ~/BoardSmithGames/go-fish && npx vitest run tests/tutorial.test.ts`
- **Per wave merge:** `cd ~/BoardSmithGames/go-fish && npm run test` AND `cd ~/BoardSmith && npm test`
- **Phase gate:** Both full suites green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `~/BoardSmithGames/go-fish/tests/tutorial.test.ts` — covers GFT-01 through GFT-06 (new file)
- [ ] `~/BoardSmith/src/engine/tutorial/gate.test.ts` — add primitive-matcher unit test cases (file exists; add new `it()` cases in the existing `describe('allow-list gate')` block)
- [ ] `~/BoardSmithGames/go-fish/src/rules/tutorial.ts` — the `GO_FISH_TUTORIAL` constant (new file)

---

## Security Domain

This phase adds no authentication, session management, input validation for user-facing APIs, or cryptography. Tutorial content is authored as TypeScript constants; predicate functions run in the engine's trusted synchronous call path. No ASVS categories apply to this phase.

---

## Sources

### Primary (HIGH confidence)
- `src/engine/tutorial/gate.ts` — `selectionMatchesValue`, `getGateReasonForValue` (read directly)
- `src/engine/tutorial/types.ts` — `TutorialGateContext`, `TutorialStep`, `SelectionMatcher` (read directly)
- `src/engine/tutorial/progress.ts` — `autoAdvanceTutorial` pump behavior, `initialProgress` (read directly)
- `src/testing/simulate-tutorial.ts` — `simulateTutorial`, `TutorialScenarioMove` (read directly)
- `src/testing/test-game.ts` — `TestGame.create` options passthrough (read directly)
- `src/testing/tutorial-assertions.ts` — `assertTutorialCompletes`, `assertTutorialStep` (read directly)
- `src/engine/action/action.ts` line 388 — how `choice` value is passed to `getGateReasonForValue` (read directly)
- `src/engine/element/game.ts` lines 2070–2088 — `playerChoices()` return type `{ value: number; display: string }[]` (read directly)
- `~/BoardSmithGames/go-fish/src/rules/actions.ts` — `ask` action, `chooseFrom('target')` / `chooseFrom('rank')` (read directly)
- `~/BoardSmithGames/go-fish/src/rules/game.ts` — `GoFishGame`, `createDeck()`, `checkForBooks()`, `drawFromPond()` (read directly)
- `~/BoardSmithGames/go-fish/src/rules/flow.ts` — `extraTurn` flow logic (read directly)
- `~/BoardSmithGames/go-fish/src/rules/index.ts` — current `gameDefinition` shape (no `tutorial` field) (read directly)
- `~/BoardSmithGames/go-fish/src/rules/elements.ts` — `GoFishPlayer.bookCount: number = 0` (read directly)
- `~/BoardSmithGames/checkers/src/rules/tutorial.ts` — template pattern (read directly)
- `~/BoardSmithGames/checkers/tests/tutorial.test.ts` — CI test template (read directly)
- `.planning/milestones/v4.1-phases/109-checkers-tutorial-content/109-PATTERNS.md` — v4.1 pattern map (read directly)

### Secondary (MEDIUM confidence)
- `~/BoardSmithGames/checkers/src/rules/game.ts` lines 139–173 — `resetToTutorialPreset()` / `placeTutorialPieces()` pattern (read directly)
- `~/BoardSmithGames/go-fish/vitest.config.ts` — vitest setup (read directly)
- `~/BoardSmithGames/go-fish/tests/game.test.ts` — existing test utility imports and patterns (read directly)

---

## Metadata

**Confidence breakdown:**
- Matcher gap analysis: HIGH — code read directly; verdict is unambiguous
- Card anchoring: HIGH — confirmed by createDeck() card naming + matchesRef precedence
- Preset design (Option A): MEDIUM — pond ordering assumption A1 not verified at runtime
- Preset design (Option B): HIGH — no pond ordering dependency
- advanceWhen predicates: HIGH — confirmed by TutorialGateContext definition
- Launch surface (GFT-05): HIGH — confirmed by 109-PATTERNS.md and index.ts inspection
- CI test structure: HIGH — mirrors checkers tutorial.test.ts directly

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stable substrate; go-fish game mechanics unlikely to change)
