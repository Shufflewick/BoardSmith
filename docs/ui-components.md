# UI Components & Composables

BoardSmith provides Vue 3 components and composables for building game UIs. The `boardsmith/ui` package includes everything from high-level shells to low-level animation utilities.

## Core Components

### GameShell

The main wrapper component that provides the complete game UI structure: player panels, game board area, action panel, and game history. It runs inside a host's iframe (`boardsmith dev` locally, Shufflewick in production); opened directly it only says so.

The board itself is not a slot. `GameShell` renders the default UI from the game's registry in `src/ui/uis.ts` (see [Dev-time UI switcher](#dev-time-ui-switcher)) and hands it the props listed under [Board props](#board-props).

A game's `src/ui/App.vue` renders it, importing `GameShell` from `boardsmith/ui`
and `uis` from `./uis.js`. Its template, with two of the shell's slots filled
(`portraitFor` stands for the game's own helper):

```vue
<template>
  <GameShell
    :uis="uis"
  >
    <!-- Custom player stats display. The slot also receives interaction state so a
         player's panel can be actionable (e.g. tap your own ability to use it), not
         just informational: playerSeat (the local seat), isMyTurn, availableActions,
         and actionController. `player` is the panel's player — gate actions on
         `player.seat === playerSeat`. While the player browses history, `player`
         and `players` are as that past position had them, like `gameView`. -->
    <template #player-stats="{ player, players, playerSeat, isMyTurn, availableActions, actionController }">
      <div class="player-stat">
        <span class="label">Score:</span>
        <span class="value">{{ player.score }}</span>
      </div>
      <button
        v-if="player.seat === playerSeat && isMyTurn && availableActions.includes('useAbility')"
        @click="actionController.start('useAbility')"
      >
        Use ability
      </button>
    </template>

    <!-- Content directly BENEATH the seat's identity token, in the card's narrow
         first column — for things that read as part of who the player is (a
         character portrait, a rank pip) rather than as stats. -->
    <template #player-token-extra="{ player }">
      <img class="portrait" :src="portraitFor(player)" alt="" />
    </template>
  </GameShell>
</template>
```

#### Players-panel order

The players panel lists seats **in the order the flow will actually take them**,
not in seat order. Nothing to declare: `eachPlayer` resolves its running order
once per round — applying `direction`, `startingPlayer`, and `filter` — and the
shell reads that back. A rotating dealer, a reversed round, or a round that
skips folded players all read correctly out of the box.

The list is **not** rotated to put the acting player on top. The panel is the one
stable reference surface in the UI: players track opponents by position ("the one
on two cards is second"), and screen-reader users navigate it by index. Moving
every row on every turn costs more than the single wrap it saves when reading
"who's next", so the acting seat is marked in place instead. Rows move only when
the running order itself changes — typically once a round, if the game rotates a
starting player.

Control it with `playerOrder`:

| Value | Behaviour |
|---|---|
| `'turn'` *(default)* | The flow's running order; falls back to seat order when there isn't one. |
| `'seat'` | Plain seat order. The opt-out. |
| `number[]` | An explicit seat order the game supplies. |

```vue
<!-- A co-op whose turn order is each role's printed rank, chosen at setup:
     no eachPlayer frame describes that, so declare it. -->
<GameShell :player-order="playersByRoleRank" ... />
```

Seats you leave out of an explicit array keep their seat-ordered place after the
ones you name — **no seat is ever dropped from the panel**, including one the
round's `filter` excluded. A player sitting the round out still has a name, a
score, and a presence indicator to show.

There is no running order during a simultaneous step (no one is "next"), before
the flow starts, or in a game with a hand-rolled turn structure. All three fall
back to seat order rather than inventing a sequence.

Reordering the panel never changes a player's identity token. The token's shape
comes from the **seat**, so it is the same glyph in the panel, the seat strip,
and the action bar's turn indicator, and it does not change when the running
order rotates. Shape is the identity that survives colour-blindness and
colourless games; it is never positional.

#### Keeping seat cards short

Each seat card is a two-column grid: the identity token, then a name row, the
turn-status sentence, and your `#player-stats` content. A game with rich
per-seat content (portrait, role, rank, an action counter) can run out of
vertical room well before the panel's seat limit, so there are two levers:

- **`#player-token-extra`** puts content under the token, in the narrow first
  column, instead of stacking it below the name row where it costs every card
  its full height.
- **`:show-turn-status="false"`** drops the shell's "Your move" / "{name} is
  playing" sentence. Use it only when your own slot content already states turn
  state for that seat — every other turn cue stays either way: the indicator
  dot, the active-card highlight, the turn-change pulse, and `aria-current`.

#### Turn-change cue

When the turn passes, the newly-active card plays a one-shot ring pulse. It
marks the *transition* — a static highlight alone is easy to miss in a tall
column of near-identical cards, which is exactly when a player misses their own
turn starting. It does not loop: a permanently animating border becomes noise,
and a seat that acts for a long time would never stop. Under
reduced motion (see "Reduce motion" below) the pulse is removed and the standing
high-contrast border carries the cue instead.

The engine helpers behind this are exported if a custom UI wants the same
ordering: `turnSequence(flowState)` and `orderSeatsByTurn(allSeats, sequence)`.
Note that `Game.nextPlayer()` is **not** one of them — it is a hardcoded seat
successor, and it disagrees with the real turn order in exactly the games that
need this.

#### Board props

The board component (the registry's default UI, or the dev switcher's
selection) receives one typed set of props. Declare it by importing the type
rather than restating the list:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import type { TableBoardProps } from 'boardsmith/ui';
const props = defineProps<TableBoardProps>();
</script>
```

`GameShell` builds the object it binds with the function whose return type is
`TableBoardProps`, so the type is exactly what a table board receives.
`WorldShell` does the same with `WorldBoardProps` for a world's board. Both
extend `BoardBaseProps`, which is what a board that renders in either declares.
A board that reads only some of them can declare `Pick<TableBoardProps, ...>`;
anything it leaves undeclared falls through onto its root element as an
attribute.

`BoardBaseProps`, given by both shells:

| Prop | Type | Description |
|------|------|-------------|
| `gameView` | `GameRootView \| null` | Player-filtered element tree, from the game root down. The root also carries `phase`, `isFinished` and `settings` |
| `players` | `GameContextPlayer[]` | Every seat's player, in seat order |
| `myPlayer` | `GameContextPlayer \| undefined` | This seat's player, or undefined for a spectator |
| `playerSeat` | `number` | This seat; -1 before one is assigned |
| `isMyTurn` | `boolean` | Whether this seat may act now |
| `availableActions` | `string[]` | Actions this seat may take now |
| `actionController` | `UseActionControllerReturn` | The one write path: start, fill, execute, cancel. Read the current selection from `actionController.currentArgs` |
| `disabledActions` | `Record<string, string> \| undefined` | Action name → why it is disabled, for greying a control WITH its reason |

`TableBoardProps` adds:

| Prop | Type | Description |
|------|------|-------------|
| `state` | `DisplayedGameState \| null` | This seat's frame, `{ flowState, state }`, for the position shown. `state.flowState` is the part of the flow state every seat may see, and `null` while browsing history |
| `isViewingHistory` | `boolean` | True while the player is browsing a past position (see below) |
| `canUndo` | `boolean` | Whether undo is available |
| `undo` | `() => Promise<void>` | Undo to turn start |
| `setBoardPrompt` | `(text: string \| null) => void` | Replace the action bar's prompt with the board's own text; `null` gives it back |

`WorldBoardProps` adds `presence` (the seats awake, or null), `events` (the
narration since the page mounted), `worldName` and `phase`. WorldShell does not
let a board replace its prompt, so a world board is not given `setBoardPrompt`.

#### Time travel: browsing a past position

Clicking a log line puts the shell into a read-only historical view. Your board
is told, and is pre-gated so it cannot act by accident:

- `isViewingHistory` is `true`.
- `gameView` / `state` show the HISTORICAL position, and `state.flowState` is
  `null`: there is no historical flow state to substitute.
- `isMyTurn` is `false`, `availableActions` is `[]`, `disabledActions` is
  undefined and `canUndo` is `false` for the whole browse, the same values the
  auto-UI's Action Panel gets. A control your board gates on those props
  therefore goes inert on its own.

Use `isViewingHistory` for anything the props cannot gate for you — most often to
tell "the game moved" from "the player clicked a log line" when you react to
`gameView` changing. Do not infer the mode from `state.flowState === null`; the
boolean is the stated fact.

#### Undo, rewind, a new game, and an open pick

An undo or rewind replaces the server's runner, and a new game replaces the
game, and either invalidates every element id captured from the old one.
GameShell handles this for you: it cancels the shared `actionController` and
clears board interaction the moment the server reports the replacement
(`PlayerGameState.restoreEpoch` or `PlayerGameState.gameInstanceId` changes),
then re-offers the action from the new position. A board that drives selection through
`actionController` / `useBoardInteraction` needs no watcher of its own — and
should not add one, since a game-specific "is my snapshot stale" fingerprint can
only restate a fact the shell already acts on.

#### Action state (`actionController.currentArgs`)

`actionController.currentArgs` holds the current action's selection values.
**Use it for reading and display only**: every change goes through
`actionController` methods.

**Reading the selection (safe)**
```vue
<template>
  <div
    v-for="card in cards"
    :key="card.id"
    class="card"
    :class="{ selected: actionController.currentArgs.value.card === card.id }"
  >
    <!-- Card shows selected state from ActionPanel selections -->
  </div>
</template>
```

**Modifying selections (use actionController)**
```typescript
// Starting an action with pre-filled values
actionController.start('move', { args: { piece: pieceId } });

// Filling a selection during an action
actionController.fill('destination', squareId);

// currentArgs is read-only: use fill() instead
// actionController.currentArgs.value.destination = squareId;  // Type error
```

**Why not write directly?**

`currentArgs` is typed read-only, so a write is a type error. The controller
tracks which values it has set, and when it fetches choices from the server it
sends only those, which keeps async steps such as `followUp` chains free of
races.

**Board interactions pattern**
<!-- typecheck: board -->
```vue
<script setup lang="ts">
import type { TableBoardProps } from 'boardsmith/ui';

const props = defineProps<Pick<TableBoardProps, 'actionController'>>();

// When user clicks a piece, start the action with that piece pre-selected
function onPieceClick(pieceId: number) {
  props.actionController.start('move', { args: { piece: pieceId } });
}

// When user clicks a destination during an active action
function onSquareClick(squareId: number) {
  if (props.actionController.currentAction.value === 'move') {
    props.actionController.fill('destination', squareId);
  }
}
</script>
```

#### Replacing the action panel

The `action-panel` slot replaces the built-in Action Panel wholesale. It receives
`boardFailed`: true while the board shows its error message instead of drawing,
false otherwise. The built-in panel lists a large pick's candidates while it is
true, rather than handing the pick to a board that is not there; your panel
should do the same.

```vue
<GameShell :uis="uis">
  <template #action-panel="{ boardFailed }">
    <MyActionPanel :list-every-choice="boardFailed" />
  </template>
</GameShell>
```

#### The action bar can start collapsed

The player can collapse the action bar with the round arrow button on its top
edge. Collapsed, the bar is a thin line along the bottom of the screen holding
only the controls menu (the three dots, drawn horizontally) and that button, and
the board gets the rest of the space. A dot on the button and its spoken label
("Expand action bar, your move") say when the game is waiting on this player. The
bar opens itself while an action is asking a question and collapses again after.

A game whose board already offers most choices can start the bar collapsed:

```vue
<GameShell :uis="uis" action-bar-starts-collapsed />
```

`actionBarStartsCollapsed` sets only the starting state, default open, and
`WorldShell` takes the same prop. The player can still open and close the bar,
and it never goes away, so the controls menu and the button stay reachable by
keyboard and screen reader.

#### Player preferences

A game can declare its own preferences, such as turning off battle effects, and
GameShell lists them in the controls menu under "Preferences". Each one is an
on/off switch (`default: true` or `false`) or a pick from a list (`options` and a
`default` that is one of their values), with a label and an optional short
description:

<!-- typecheck: game src/ui/preferences.ts -->
```ts
import { definePlayerPreferences } from 'boardsmith/ui';

export const preferences = definePlayerPreferences('my-game', {
  battleEffects: { label: 'Battle effects', description: 'Bursts and explosions', default: true },
  flicker: {
    label: 'Flicker',
    options: [{ value: 'full', label: 'Full' }, { value: 'slow', label: 'Slow' }],
    default: 'full',
  },
});
```

Pass them to the shell:

```vue
<GameShell :uis="uis" :preferences="preferences" />
```

and read a value anywhere in the UI. `use` returns a ref that updates the moment
the player changes the setting, typed from the declaration:

```ts
// preferences comes from './preferences'
const battleEffects = preferences.use('battleEffects'); // Ref<boolean>
const flicker = preferences.use('flicker'); // Ref<'full' | 'slow'>
```

Values are saved in this browser's localStorage under
`boardsmith-preference:<game>:<key>`, so two games never share a setting, and
they are never sent to the server or other players. A saved value the game no
longer accepts (an option you removed, say) reads as the declared default.
`definePlayerPreferences` throws if the game name is empty or a default is not
one of its options, and `use` throws for a key that was not declared. On/off
preferences are menu checkboxes and list picks are menu radio buttons, so both
work by keyboard and screen reader.

`WorldShell` takes the same prop. A world has no turn, undo or zoom, so its
controls menu holds only "Preferences": Reduce motion, Show action help, then
the world's own.
Pass them where the world entry mounts the shell, in `src/world-main.ts`:

```ts
render: () => h(WorldShell, { uis, displayName: 'My World', preferences }),
```

#### Action help

Every game also gets a built-in "Show action help" item in "Preferences", just
after Reduce motion, in both GameShell and WorldShell. While it is on, the
action panel puts a "?" beside each action that has `.help(text)` or a disabled
reason, and the "?" shows that text. It is on by default and saved once for all
BoardSmith games in this browser (`boardsmith-preference:boardsmith:actionHelp`).
The item is hidden while no available action has help text or a disabled
reason, so it never shows a switch that does nothing. Host teaching lockout
(`teachingDisabled`) does not hide it: help explains the rules, not a good move.

#### Reduce motion

Every game also gets a built-in "Reduce motion" item at the top of
"Preferences". It is saved once for all BoardSmith games in this browser
(`boardsmith-preference:boardsmith:reduceMotion`), like the device setting it
stands beside: needing less motion belongs to the player, not to one game.
Motion is reduced while either the device asks for less motion or the item is
on, and both script and CSS follow that one setting:

- `prefersReducedMotion` (from `boardsmith/ui`) reads `true`. `useFLIP` and
  `useFlyingElements` skip their animations.
- GameShell and WorldShell keep the class `bs-reduce-motion` on `<html>`, with
  a page-wide rule that cuts every CSS animation and transition under it to
  near zero. Key a
  reduced-motion CSS rule on it, never on the `prefers-reduced-motion` media
  query, which sees only the device and would keep animating for a player who
  turned the item on:

```css
.bs-reduce-motion .my-spinner {
  animation: none;
}
```

A test refuses any `prefers-reduced-motion` in BoardSmith's own source outside
`src/ui/composables/reducedMotion.ts`, the one place that reads the device setting.
A BoardSmith component whose CSS keys on `.bs-reduce-motion` calls
`syncReducedMotionClass()` in its setup, and a stylesheet's classes are set by a
script that calls it (`drag-drop.css` by `useDragDrop`), so the rule works on a
page with no shell. The call does its work once per page. A test refuses a
component or stylesheet that skips it.

### AutoUI

Automatic UI generation from game state. A production-ready UI for any game — ideal for simple games or as a starting point before investing in a custom UI.

`boardsmith dev` always offers it as `Auto` in the UI switcher. To ship it,
make it the game's default UI in `src/ui/uis.ts`:

<!-- typecheck: game src/ui/uis.ts -->
```ts
import { defaultUI, defineGameUIs } from 'boardsmith/ui';
// AutoUI has its own entry point, so a game with a custom UI never ships it
import { AutoUI } from 'boardsmith/ui/auto-ui';

export default defineGameUIs({ Auto: defaultUI(AutoUI) });
```

The auto-generated UI includes:
- **AutoRenderer**: Selects an archetype template by introspection and renders the game element tree via a ranked-tester renderer registry
- **registerRenderer**: Register a higher-priority renderer for an element type to upgrade the auto-UI in place (no core edits)
- **ActionPanel**: Displays available actions with selection UI
- Ships as your production UI for simple games — no custom UI required

#### The start buttons can be a game-authored hierarchy

By default every available action is one button in a flat row. A game that
offers many verbs at once arranges them with `.group()` and `.order()` on the
action: a group takes ONE button at its parent level and opens onto its members,
with `Back`, the current level's name, `Escape`, and focus restored to the button
that opened it. Only available actions contribute, so an emptied group is simply
not there.

**Opening a group is navigation, not a game command** -- no order submitted, no
turn consumed, no persistent state moved -- and grouping changes neither
executability nor server-side validation. A game that declares no grouping keeps
the flat panel exactly as it is. The same metadata reaches this panel in world
mode, where it matters most. The full rule, including how it relates to
`.suppressFromActionPanel()`, is in
[Actions & Flow](./actions-and-flow.md#group-and-order-arrange-the-start-buttons).

#### A pick's choices can be grouped too

The same idea works inside one question. `group` on `chooseFrom` or
`chooseElement` puts each choice under a category path, and the panel shows the
categories and the ungrouped choices first. Opening a category shows its
choices, with `Back` and the category's name; it never submits anything, and a
category with no choices does not appear. The board still offers every choice,
so a board click answers the pick whatever category the panel shows. See
[Actions & Flow](./actions-and-flow.md#group-arranges-the-choices-inside-a-pick).

#### The ActionPanel offers hierarchy, never free text

The panel is a hierarchy a person walks with a few buttons. **It has no search
box, no typed coordinate entry and no filter field, and it will not get one.** A
search box is a second enumeration: it has to decide what matches, and the moment
it decides differently from the engine the panel is showing a different game from
the board and the bots.

For the same reason, **the panel never applies a filter of its own.** Hiding an
option the engine allows is a divergence bug, not a layout improvement. Scoping
by selection is authored inside the action system — a first `chooseElement` step
with a dependent `filter` — so the panel, the board and move enumeration all read
one enumeration. See
[Actions & Flow](./actions-and-flow.md#the-panel-offers-hierarchy-never-free-text),
which is where that rule is stated in full.

**Cardinality is the author's to shape**, with `boardRef` (anchor the step on the
board) or `dependsOn` (narrow it with an earlier step).

**What the panel does with a set that is still too large.** Above
`MAX_FLAT_CHOICE_CANDIDATES` (24, in
`engine/element/action-metadata.ts`, beside the code that builds a pick's
candidates — three things read it: this panel, `boardsmith validate`, and
`worldBudgets`, whose own per-selection cap must sit strictly above it), a pick whose
candidates ALL carry a board ref is handed to the board: the panel keeps the
prompt and renders one control, "Choose on the board (N)", instead of N buttons.
That is an `element`/`elements` pick, or a `chooseFrom` whose every candidate
names its own board element by `id` or `notation` (see `docs/actions-and-flow.md`).
The board is the better surface for a set that size — it draws the candidates in
the geometry the choice actually has.

This is a change of surface, not of content, and three things keep it honest:

- The board offers the identical enumeration. Nothing is dropped, nothing is
  hidden, and the count is stated on the control so a screen-reader user knows
  the size of the choice before walking into it.
- If even ONE candidate lacks a board ref the panel keeps every button, because
  deferring would leave that candidate reachable from neither surface.
- While the board shows its error message in place of the board (it threw while
  drawing), there is no board to choose on, so the panel lists every candidate;
  it hands the pick back once the board draws again (#1153).
- **Focus goes with the choice** (see "Board keyboard handoff" below). Without
  that the player who pressed the control would be standing on something that
  just unmounted.

A `choice` pick below the threshold, or one with a candidate that names no board
element of its own, is partitioned by `splitAnchoredChoices` instead, which keeps
every choice in the panel.

#### Text and number picks are editors, not buttons

A `text` or `number` pick is the one pick the panel cannot draw as a list, so it
draws a labelled editor: the selection's own prompt as a real `<label>` bound to
the field, the bound as a hint below it, and a submit button.

- **The hint states the bound it has.** `up to 1000 characters` for a field with
  only a maximum, `at least 10 characters` for one with only a minimum, `10 to
  1000 characters` for one with both, and nothing at all for one with neither.
  It is built by `textLengthHint` in `action-panel-helpers.ts` so the single-line
  field and the multiline box cannot drift into two different sentences. It
  replaced an interpolated range that rendered `(?-1000 chars)` for the
  commonest field in the library.
- **The number hint does the same, in numbers.** `1 to 10`, `up to 10`, `at
  least 1`, and `whole numbers` on its own for an unbounded integer pick, from
  `numberRangeHint` in the same file. It replaced `(1-?, integer)`: the same
  interpolated range, with the same question mark where a number belongs, and
  "integer" is a programmer's noun in a sentence a player reads.
- **A multiline field states only its floor there**, because its character count
  already carries the ceiling and where the player stands in it. Two lines saying
  the maximum would be the same fact twice, and the action bar caps its own
  height -- the row it costs is the row the count gets scrolled out of.
- **`multiline: true` on `enterText` draws a resizable box** instead of a single
  line, sized to six rows and growable by the player, plus a live character count
  and an explicit submit button so Enter inserts a newline rather than
  submitting. See
  [Actions & Flow](./actions-and-flow.md#entertext---enter-text). It is
  presentation only, except that it admits line feed and tab: the same value,
  the same bounds, the same validation.
- **A refused value says why.** The panel applies the engine's own
  `textRuleErrors` -- imported, not reimplemented -- so the sentence it shows
  before submitting is the sentence the server would answer with. The message is
  `role="alert"`, associated with the field through `aria-describedby`, and the
  field carries `aria-invalid` while it stands.
- **The count is described, not announced.** It sits in the field's
  `aria-describedby`, so it is read on arrival rather than after every keystroke.
  A live region speaks exactly once, at the character limit, which is the one
  moment a keystroke silently stops working.

This is not a free-text search box and the rule above is untouched: a text pick
is a value the ACTION asked for, enumerated by nothing and matched against
nothing.

#### What the player has entered survives the panel

An editor's value is **not** held in `ActionPanel`. It lives in
`useActionController` as `currentPickDraft`, written with `setPickDraft`, beside
`multiSelectDraft` and for the same two reasons.

- **The panel is unmounted more often than it looks.** Collapsing the action bar
  is a `v-if` swap, not a hidden element, so a ref inside the panel goes with it
  -- and 1,000 characters of empire description went with it silently, from a
  control whose whole promise is that it is reversible.
- **A custom UI can see it.** The two surfaces are two representations of one
  state, and a value only the panel could read was a piece of that state a custom
  UI had no way to show.

**The lifetime is exact.** A draft belongs to one action asking one selection in
one round of a repeating pick, and it is stored with that identity and resolved
against it on every read. So it survives any number of collapses and re-renders,
and reads as empty the moment the question changes -- a new action, the next
selection, the next round, a cancel, a submit. That direction matters as much:
before the draft was reset at all, cancelling a 200-character creed opened a
20-character nickname prefilled and already refusing its own contents.

The refusal message is not part of the draft. It is about the player's last
press rather than anything they wrote, so it does not come back with the value.

**The open level of the action hierarchy is held the same way**, as
`actionMenuPath`. The controller stores an opaque list of group labels and never
reads it -- it does not import the menu model and cannot tell a group from an
action, which is what keeps "opening a menu is not a game command" structurally
true. The panel resolves that path against the menu on every read, so a collapse
of any duration is safe: a group that stopped existing while the bar was down
lands the player on the deepest level that did not.

#### Board keyboard handoff

When the panel hands a choice to the board, the board becomes the only path into
it, so it has to be operable without a pointer.

- `boardInteraction.requestBoardFocus()` asks the board to take focus; it bumps
  the monotonic `boardInteraction.boardFocusRequest` counter.
- AutoUI's `GridBoardRenderer` and `HexBoardRenderer` watch that counter and move
  focus onto their **first valid target for the current pick** — not cell 0. They
  get that from `useSelectableGrid`'s new `isCandidate` predicate, which also
  parks the roving tab stop on a candidate whenever a pick starts. Arrow keys
  then move between cells and Enter chooses, exactly as before.
- `useBoardFocusHandoff` (installed by GameShell for every board, custom ones
  included) is the floor beneath that: if nothing inside the board region took
  focus, it focuses the board's first tab stop. A custom board that wants the
  cursor on a real candidate should watch `boardFocusRequest` itself, which
  pre-empts the fallback.


### Dev-time UI switcher

A game declares every board it has in one file, `src/ui/uis.ts`, and passes
that registry to `<GameShell :uis="uis">`:

```ts
// src/ui/uis.ts: defineGameUIs, defaultUI and devUI come from 'boardsmith/ui',
// and HeirloomTable from './heirloom/HeirloomTable.vue'

export default defineGameUIs({
  HeirloomTable: defaultUI(HeirloomTable),
  Classic: devUI(() => import('./components/CribbageBoard.vue')),
});
```

Exactly one entry is `defaultUI()`: that is the board a production build
renders. `devUI()` entries exist only under `boardsmith dev`.
`defaultUI()` takes the board component itself, not a loader and not a bare
functional component (wrap one in `defineComponent`), and refuses a function
both when compiling and when running.

Under `boardsmith dev`, the dev host shows a **UI dropdown** to switch which UI
renders the running game, without restarting. It lists every entry in the
registry, in declared order, and then **Auto**, the built-in auto-UI, which
`GameShell` adds itself in dev builds. Do not list it in `uis.ts`. A game that
declares its own entry named `Auto` (an auto-UI game whose default IS the
auto-UI) keeps that entry, and no second one is added.

Everything dev-only is gated behind `import.meta.env.DEV`, so a production
`boardsmith build` folds it away: neither `devUI()` boards nor the shell's Auto
entry reach the bundle, JS or CSS (see SHIP-02 and `treeshake-bundle.test.ts`).

### DebugPanel

Development tool for inspecting game state, history, and debugging.

```vue
<template>
  <DebugPanel
    :state="state"
    :game-view="gameView"
    :action-history="actionHistory"
  />
</template>
```

## Game Setup

A game is configured before it starts by its host, not by `GameShell`: the
`boardsmith dev` host's Table setup locally, and ShufflewickPub's lobby in
production. Both read the game options, player options and presets the game
declares, so a game declares them once and never draws a lobby of its own.

## Player Colors

Players automatically receive colors from the engine's color palette. Access them via the `color` property:

```typescript
// In rules code
const myColor = player.color;  // '#e74c3c'

// In UI via gameView
const playerColor = gameView.players[playerSeat - 1].color;
```

### Custom Color Palette

To use a custom color palette, specify it in your game definition:

```typescript
export const gameDefinition = {
  // Custom colors (optional - defaults to engine's DEFAULT_COLOR_PALETTE)
  colors: ['#ff0000', '#0000ff', '#00ff00', '#ffff00'],

  // Disable color selection in lobby (optional, default: true)
  colorSelectionEnabled: false,
};
```

### Color Selection

To let players choose colors when they set up a game, define `colorPalette` in `boardsmith.json`:

```json
{
  "colorPalette": [
    { "hex": "#ff0000", "label": "Fire" },
    { "hex": "#0000ff", "label": "Ice" }
  ]
}
```

If `colorPalette` is omitted, the engine's 16 named colours (`DEFAULT_COLOR_PALETTE`: Red, Blue, Green, Yellow, ...) are used. Plain hex strings are also accepted (e.g., `["#ff0000", "#0000ff"]`).

A colour list declared in code (a `color` player option such as `createColorOption()`, or `gameDefinition.colorPalette`) is never published, so `boardsmith dev` refuses to start unless it matches exactly what the lobby will offer; declare custom colours in `boardsmith.json`'s `colorPalette` instead.

## Helper Components

### AssetImage

The one sanctioned way to render game art. A missing, unresolved, or broken `src`
always leaves the game's own drawn fallback visible; a broken `<img>` never
reaches a player. The real image overlays the fallback only after `@load` fires,
and `@error` reverts to the fallback.

The fallback is your DEFAULT SLOT, because the placeholder that reads correctly
is always the game's own drawn face (a card's rank and suit, a part's name and
roll condition, a piece's glyph) — never something the library could guess at.
The fallback layer is a bare `position: absolute; inset: 0` box, so your slot
content owns its own presentation.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { AssetImage } from 'boardsmith/ui';

defineProps<{ artSrc: string | null; cardName: string; rank: string; suit: string }>();
</script>

<template>
  <AssetImage class="card-art" :src="artSrc" aspect-ratio="2 / 3" :alt="cardName">
    <div class="card-drawn">
      <span class="card-rank">{{ rank }}</span>
      <span class="card-suit">{{ suit }}</span>
    </div>
  </AssetImage>
</template>

<style scoped>
/* The wrapper takes your class, so the game rounds its own corners and crops its
   own art. AssetImage clips to the wrapper (`overflow: hidden`). */
.card-art { border-radius: var(--bsg-r-sm); }
.card-drawn { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
</style>
```

**Props:**
- `src` (`string | null`, default: `null`) - The resolved asset URL, or null when there is no art (yet)
- `aspectRatio` (string, **required**) - The box both the fallback and the image fill, e.g. `'2 / 3'`. Required because reserving the right box is what makes a later asset swap a zero-layout-change edit. Pass `'auto'` when an ancestor already sizes the art
- `alt` (string, **required**) - Alt text for the image. Required so every call site decides; pass `''` when the fallback slot already carries the same words as visible text

`boardsmith audit`'s asset-reachability scan fails a game that renders art with a
bare `<img>` anywhere in `src/ui`, so this is the only path art takes.

### FlyingCardsOverlay

Overlay for card flight animations between positions. Teleports to body to render above all content.

```vue
<template>
  <FlyingCardsOverlay
    :flying-cards="flyingCards"
  />
</template>
```

### GameOverlay

Modal overlay that stays **constrained within the game content area**, keeping the players panel and ActionPanel accessible. Unlike FlyingCardsOverlay, this does NOT teleport to body.

**How it works:** GameOverlay uses `position: fixed` but renders in-place (no Teleport). When inside GameShell's zoom-container (which has `contain: layout`), the fixed positioning is trapped within that container.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { GameOverlay } from 'boardsmith/ui';

const showModal = ref(false);
</script>

<template>
  <GameOverlay :active="showModal" @click="showModal = false">
    <div class="my-modal" @click.stop>
      <h2>Round Summary</h2>
      <p>Game content here...</p>
      <button @click="showModal = false">Continue</button>
    </div>
  </GameOverlay>
</template>

<style scoped>
.my-modal {
  /* Sticky keeps modal in viewport even if game content is taller */
  position: sticky;
  top: 10px;
  margin: 0 auto;
  max-height: calc(100vh - 150px);
  overflow: auto;

  /* Your styling */
  background: #1a1a2e;
  padding: 20px;
  border-radius: 12px;
  max-width: 500px;
  width: 90%;
}
</style>
```

**Props:**
- `active` (boolean) - Whether overlay is visible
- `backdrop` (boolean, default: true) - Enable backdrop blur
- `backdropOpacity` (number, default: 0.85) - Backdrop darkness 0-1

**Events:**
- `@click` - Fires when clicking the backdrop (use `@click.stop` on content to prevent)

**Important:**
- Must be rendered inside the board component GameShell mounts from `src/ui/uis.ts`
- Use `@click.stop` on your modal content to prevent backdrop clicks from closing
- Use `position: sticky` on content for tall game boards

### BoardMessage

Transient/ephemeral message anchored to the game board. **This is the standard
primitive for short-lived board indicators** (e.g. "Select a target cell",
"Captures are mandatory").

> **Standard:** Transient board messages MUST use `<BoardMessage>` (or otherwise
> be absolutely positioned within a `position: relative` board container) so they
> **never reflow the board**. An in-flow status element shifts the board up/down
> each time it appears/disappears — this is not allowed.

**How it works:** BoardMessage is absolutely positioned inside the nearest
`position: relative` ancestor (your board wrapper), so showing/hiding it never
changes layout. It is themed entirely with `--bsg-*` tokens, exposes a
`role="status"` `aria-live="polite"` region for screen readers, and disables its
fade transition under reduced motion (`.bs-reduce-motion`). (Distinct from `Toast`, which is
for global, viewport-edge notifications.)

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { BoardMessage, type TableBoardProps } from 'boardsmith/ui';

defineProps<TableBoardProps>();
</script>

<template>
  <div class="board-wrapper"> <!-- position: relative -->
    <svg class="board">...</svg>
    <BoardMessage :visible="isMyTurn">Select a target cell</BoardMessage>
  </div>
</template>

<style scoped>
.board-wrapper { position: relative; }
</style>
```

**Props:**
- `visible` (boolean, default: true) - Whether the message is shown (toggling fades it without reflow)
- `position` (`'bottom' | 'top' | 'center'`, default: `'bottom'`) - Anchor within the board container

## Composables

### useBoardInteraction

Bidirectional interaction between action panel and game board.

```typescript
// useBoardInteraction, createBoardInteraction and provideBoardInteraction come from 'boardsmith/ui'

// In GameShell (provide)
const boardInteraction = createBoardInteraction();
provideBoardInteraction(boardInteraction);

// In GameTable or ActionPanel (inject)
const boardInteraction = useBoardInteraction();

// Check element states
boardInteraction.isHighlighted(element)  // Hovered in action panel
boardInteraction.isSelected(element)     // Currently selected
boardInteraction.isValidTarget(element)  // Valid drop/selection target
boardInteraction.isSelectableElement(element)  // Can be clicked to select

// Trigger selections
boardInteraction.triggerElementSelect(element)

// Drag and drop
boardInteraction.canStartDrag(element)  // False for a disabled candidate, as a click on it chooses nothing; the auto-filled source still drags
boardInteraction.startDrag(element)  // Returns false, starting nothing, when canStartDrag refuses: cancel the browser drag then
boardInteraction.endDrag()
boardInteraction.isDropTarget(element)
boardInteraction.isDraggedElement(element)
```

A custom board or panel is always rendered inside `<GameShell>`, so
`useBoardInteraction()` returns a guaranteed instance. It throws an actionable
error if called outside a `<GameShell>`.
If a component must work without a provider, use `tryUseBoardInteraction()`,
which returns `BoardInteraction | undefined`.

#### Action State Detection

Custom game boards can detect which action is currently being filled in. This is useful when:
- Showing visual feedback based on the active action
- Displaying on-demand choices (e.g., cards drawn when action clicked)
- Customizing the board based on current selection step

<!-- typecheck: game src/ui/action-state.ts -->
```typescript
import { useBoardInteraction, type GameViewElement } from 'boardsmith/ui';
import { computed, watch } from 'vue';

const boardInteraction = useBoardInteraction();

// Current action being filled in (null if none)
boardInteraction.currentAction         // string | null

// Which selection step the player is on (0-based)
boardInteraction.currentPickIndex // number

// Name of the current pick
boardInteraction.currentPickName  // string | null
```

**Example: Detecting when "Hire First MERC" is clicked**

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, watch } from 'vue';
import { findElement, useBoardInteraction, type GameViewElement, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

const boardInteraction = useBoardInteraction();

// Detect when hiring action is active
const isHiringMerc = computed(() => boardInteraction.currentAction === 'hireFirstMerc');

// Get drawn mercs from game settings (stored by on-demand choices callback)
const drawnMercs = computed(() => {
  if (!isHiringMerc.value) return [];

  const ids = props.gameView?.settings._drawnMercsForHiring as number[] | undefined;
  if (!ids?.length) return [];

  // Find the elements by ID in the game view
  return ids
    .map((id) => findElement(props.gameView, { id }))
    .filter((merc): merc is GameViewElement => merc !== undefined);
});

// React to action changes
watch(() => boardInteraction.currentAction, (action, prevAction) => {
  if (action === 'hireFirstMerc') {
    console.log('Player started hiring a MERC');
  }
  if (prevAction === 'hireFirstMerc' && !action) {
    console.log('Hiring action completed or cancelled');
  }
});
</script>

<template>
  <div class="game-board">
    <!-- Show drawn MERC cards when hiring -->
    <div v-if="isHiringMerc && drawnMercs.length" class="hiring-overlay">
      <h3>Choose a MERC to hire:</h3>
      <div class="drawn-mercs">
        <div v-for="merc in drawnMercs" :key="merc.id" class="merc-card">{{ merc.name }}</div>
      </div>
    </div>
  </div>
</template>
```

> **Note:** Action state is automatically cleared when the action completes, is cancelled, or the turn ends.

### useTableActionWiring

Builds a table's action controller and the board bridge that feeds the board
from it, out of one seat's published state. GameShell calls it, so a game built
on the shell never does. Call it yourself only where you mount a board without
the shell, which in practice means a test (see the a11y floor in
`src/cli/slash-command/bs/build/test.md`).

<!-- typecheck: game tests/wiring.ts -->
```typescript
import { computed, ref, type Ref } from 'vue';
import type { PlayerGameState } from 'boardsmith/session';
import {
  createBoardInteraction,
  provideBoardInteraction,
  useTableActionWiring,
  type TableActionWiringOptions,
} from 'boardsmith/ui';

export function wireSeat(
  seatState: Ref<PlayerGameState | null>, // replaced on every broadcast
  seat: number,
  // How this seat's moves reach the game, e.g. a test session's.
  sendAction: TableActionWiringOptions['sendAction'],
  fetchPickChoices: TableActionWiringOptions['fetchPickChoices'],
) {
  const board = createBoardInteraction();
  provideBoardInteraction(board);
  return useTableActionWiring({
    seatState,
    availableActions: computed(() => seatState.value?.availableActions ?? []),
    isMyTurn: computed(() => seatState.value?.isMyTurn),
    playerSeat: ref(seat),
    boardInteraction: board,
    autoEndTurn: ref(true),
    isViewingHistory: ref(false),
    sendAction,
    fetchPickChoices,
  });
}
```

It reads the action metadata, disabled reasons, tutorial step and which game
tree the state came from (`gameInstanceId`, `restoreEpoch`) off `seatState`, so
an undo or a new game cancels an open pick with nothing passed for it. The
bridge underneath is not exported: see the migration guide, contract r106.

### useDragDrop

Composable for drag-and-drop in custom UIs. Call once at setup, get functions that work with any element. ActionPanel automatically orchestrates drag-drop by detecting when drag starts, finding matching actions, and executing on drop.

#### Quick Start (Recommended)

Use the pit-of-success API with the library's CSS for minimal boilerplate:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, useBoardInteraction, useDragDrop, type TableBoardProps } from 'boardsmith/ui';
import 'boardsmith/ui/animation/drag-drop.css';

const props = defineProps<TableBoardProps>();
const { drag, drop } = useDragDrop();
const board = useBoardInteraction();

const cards = computed(() => findElements(props.gameView, { className: 'Card' }));
const zones = computed(() => findElements(props.gameView, { className: 'Zone' }));

// A candidate of the open pick, an action's first pick when none is open, or the auto-filled card to drag on.
const canDragCard = (cardId: number) =>
  board.isSelectableElement({ id: cardId }) || board.isDraggableSelectedElement({ id: cardId });
</script>

<template>
  <div
    v-for="card in cards"
    :key="card.id"
    v-bind="drag({ id: card.id }, { when: canDragCard(card.id) }).props"
    :class="drag({ id: card.id }, { when: canDragCard(card.id) }).classes"
  >
    {{ card.name }}
  </div>
  <div
    v-for="zone in zones"
    :key="zone.id"
    v-bind="drop({ id: zone.id }).props"
    :class="drop({ id: zone.id }).classes"
  >
    {{ zone.name }}
  </div>
</template>
```

The library CSS provides:
- `.bs-draggable` - cursor: grab, smooth transitions
- `.bs-dragging` - opacity: 0.5, scale(0.95), cursor: grabbing
- `.bs-drop-target` - green highlight with glow

#### Customizing Drag-Drop Styles

Override CSS variables in your game's stylesheet:

```css
:root {
  --bs-draggable-cursor: grab;
  --bs-dragging-opacity: 0.5;
  --bs-dragging-scale: 0.95;
  --bs-drop-target-bg: rgba(236, 72, 153, 0.15);  /* Pink instead of green */
  --bs-drop-target-border-color: rgba(236, 72, 153, 0.6);
  --bs-drop-target-shadow: 0 0 12px rgba(236, 72, 153, 0.4);
}
```

Or use your own class names alongside the library classes:

```css
/* Game-specific styling that extends the library's bs-* classes */
.card.bs-draggable {
  border-color: rgba(236, 72, 153, 0.6);
  animation: pulse-drag 1.5s ease-in-out infinite;
}

.zone.bs-drop-target {
  background: rgba(236, 72, 153, 0.15);
}
```

#### API Reference

| Function | Signature | Description |
|----------|-----------|-------------|
| `drag` | `(ref, options?) => { props, classes }` | **Recommended.** Combined helper for draggable elements |
| `drop` | `(ref) => { props, classes }` | **Recommended.** Combined helper for drop targets |
| `dragClasses` | `(ref, options?) => DragClasses` | Just the CSS classes for draggable elements |
| `dropClasses` | `(ref) => DropClasses` | Just the CSS classes for drop targets |
| `dragProps` | `(ref) => DragProps` | Low-level: just the drag props |
| `dropProps` | `(ref) => DropProps` | Low-level: just the drop props |
| `isDragging` | `(ref) => boolean` | Check if element is being dragged |
| `isDropTarget` | `(ref) => boolean` | Check if element is valid drop target |

**DragOptions:**
- `when?: boolean | (() => boolean)` - Condition for enabling drag. When false, props are inert and `.bs-draggable` is not applied. A disabled candidate of the pick in progress is never draggable, whatever `when` says, as a click on it chooses nothing; the auto-filled source of the pick still drags on (#1299).

**ElementRef:**
- Can include `id`, `name`, or `notation` to identify the element.
- Matching is **precedence-based**, not OR-based: if `id` is present it is the sole criterion (`name`/`notation` are ignored); otherwise `notation` is tried, then `name`. This prevents duplicate-named elements (e.g. several `'Militia'` pieces) from cross-talking — a ref carrying a precise `id` always resolves to exactly that element. Use `id` for unambiguous selection; reserve bare `name`/`notation` refs for when you genuinely want to match every element sharing that property.
- A board click (`selectElement`) or drag (`startDrag`) starts an action by the same rule: it starts the first action whose first element pick has a candidate that is the ref's element, or whose board ref the element matches as above. So a name-only ref starts an action exactly when the candidate's board ref is that name (#945). With no action open, the client asks the server for each available action's first-pick candidates (`actionController.startCandidates`), so this works when a turn offers several actions and opens none, as Chess does (#1192).
- In the AutoUI, while a pick is open, a piece standing on a square that is one of that pick's candidates is draggable, and its drag carries the square, so it chooses that square's candidate (#943). Checkers is the case: its move action opens on its own, and each piece's board ref is its square's notation. With no action open, the board offers each action's first-pick candidates instead, so a piece is clickable and draggable when it, or the square it stands on, can start an action (#1192).

#### Migration from Verbose Pattern

**Before (verbose):**
```ts
const { dragProps, dropProps, isDragging, isDropTarget } = useDragDrop();

const isDragDropCardSelection = computed(() =>
  currentAction.value === 'moveCard' && currentPick.value?.name === 'card'
);

function isCardDragging(cardId) { return isDragging({ id: cardId }); }
function isZoneDropTarget(zoneName) { return isDropTarget({ name: zoneName }); }
```

```vue
<template>
  <div
    v-bind="isDragDropCardSelection && isSelectable(card.id) ? dragProps({ id: card.id }) : {}"
    :class="{
      'is-dragging': isCardDragging(card.id),
      'draggable': isDragDropCardSelection && isSelectable(card.id),
    }"
  />
</template>

<style>
.draggable { cursor: grab; }
.is-dragging { opacity: 0.5; }
.drop-target { background: rgba(0, 255, 136, 0.3); }
</style>
```

**After (pit of success):**
<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, useBoardInteraction, useDragDrop, type TableBoardProps } from 'boardsmith/ui';
import 'boardsmith/ui/animation/drag-drop.css';

const props = defineProps<TableBoardProps>();
const { drag } = useDragDrop();
const board = useBoardInteraction();
const cards = computed(() => findElements(props.gameView, { className: 'Card' }));

const canDrag = (cardId: number) =>
  board.isSelectableElement({ id: cardId }) || board.isDraggableSelectedElement({ id: cardId });
</script>

<template>
  <div
    v-for="card in cards"
    :key="card.id"
    v-bind="drag({ id: card.id }, { when: canDrag(card.id) }).props"
    :class="drag({ id: card.id }, { when: canDrag(card.id) }).classes"
  />
</template>
```

**Lines reduced:** ~50 -> ~10 (80% reduction)

### Drag-and-Drop in Custom UIs

When building custom game boards with drag-and-drop, use `useDragDrop`. ActionPanel automatically:
1. Detects when drag starts (via `boardInteraction.isDragging`)
2. Finds matching actions for the dragged element
3. Sets up valid drop targets from filtered choices
4. Executes the action when dropped on a valid target

**Example: Assigning Combatants to Squads**

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { useDragDrop } from 'boardsmith/ui';
import 'boardsmith/ui/animation/drag-drop.css';

interface Squad {
  id: number;
  name: string;
  combatants: { id: number; name: string }[];
}

defineProps<{
  squads: Squad[];
}>();

const { drag, drop } = useDragDrop();

// Drag is always enabled for combatants in this simple example
const canDrag = () => true;
</script>

<template>
  <div class="squad-assignment">
    <div
      v-for="squad in squads"
      :key="squad.id"
      class="squad"
      v-bind="drop({ id: squad.id }).props"
      :class="drop({ id: squad.id }).classes"
    >
      <h3>{{ squad.name }}</h3>
      <div
        v-for="combatant in squad.combatants"
        :key="combatant.id"
        class="combatant"
        v-bind="drag({ id: combatant.id }, { when: canDrag() }).props"
        :class="drag({ id: combatant.id }, { when: canDrag() }).classes"
      >
        {{ combatant.name }}
      </div>
    </div>
  </div>
</template>
```

**Real Examples:**

1. **Demo: Complex UI Interactions**

   A dedicated demo showing this feature with multiple simultaneous actions. The custom GameTable:
   - Shows an action status panel displaying the current action and selection step
   - Changes board color based on active action (blue for Collect, red for Discard, etc.)
   - Highlights cards with action-specific colors
   - Includes a debug panel showing raw `boardInteraction` state

2. **Go Fish**

   Uses `boardInteraction.currentAction` to:
   - Show an "Asking:" indicator banner when the player clicks the Ask button
   - Display which selection step they're on (choosing player vs choosing rank)
   - Only highlight selectable elements after the action button is clicked (not just when available)

### useFlyingElements

Unified composable for flying element animations (cards, pieces, tokens).

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { findElement, useFlyingElements, FlyingCardsOverlay, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const deckRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);
const starterRef = ref<HTMLElement | null>(null);
const starterCard = computed(() => findElement(props.gameView, { name: 'starter' }));

const { fly, flyMultiple, flyOnAppear, flyingElements, isAnimating } = useFlyingElements();

async function draw() {
  if (!deckRef.value || !handRef.value) return;
  const deck = deckRef.value;
  const hand = handRef.value;

  // Fly a single element
  await fly({
    id: 'draw-animation',
    startRect: deck,
    endRect: () => handRef.value,  // A function tracks a moving target
    elementData: { rank: 'A', suit: 'S', faceUp: false },
    flip: true,           // Flip element during flight
    duration: 400,        // Animation duration in ms
    elementSize: { width: 60, height: 84 },
  });

  // Fly multiple elements with stagger
  await flyMultiple([
    { id: 'card-1', startRect: deck, endRect: () => hand, elementData: { rank: 'K', suit: 'H' } },
    { id: 'card-2', startRect: deck, endRect: () => hand, elementData: { rank: 'Q', suit: 'H' } },
  ], 100);  // 100ms stagger between elements
}

// Declarative fly-on-appear (replaces useFlyOnAppear)
const { isFlying } = flyOnAppear({
  element: starterCard,  // Ref or ComputedRef that triggers when truthy
  sourceRef: deckRef,
  targetRef: starterRef,
  getElementData: (el) => ({ rank: String(el.attributes?.rank), suit: String(el.attributes?.suit) }),
  flip: true,
});
</script>

<template>
  <div ref="deckRef" class="deck" :class="{ busy: isAnimating }" @click="draw" />
  <div ref="handRef" class="hand" />
  <div ref="starterRef" class="starter" :class="{ arriving: isFlying }" />
  <FlyingCardsOverlay :flying-cards="flyingElements" />
</template>
```

### useActionAnimations

Declarative animations triggered by action execution. Captures element positions before actions execute and animates to the new position after the DOM updates. Integrates with `actionController.onBeforeAutoExecute()`, which returns an unregister function.

**Key Feature: Flip-in-Place Auto-Detection**

When `elementSelector` equals `destinationSelector`, the composable auto-detects a "flip-in-place" animation and configures everything correctly:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { toRef } from 'vue';
import { useActionAnimations, FlyingCardsOverlay, type TableBoardProps } from 'boardsmith/ui';

// The board receives `actionController` and `gameView` as props from GameShell.
const props = defineProps<TableBoardProps>();

const actionAnimations = useActionAnimations({
  gameView: toRef(props, 'gameView'),
  // Tells the composable how each action ended, so a refused one puts its element back.
  actionController: props.actionController,
  animations: [
    // Movement animation (element moves to a different destination)
    {
      action: 'assignToSquad',
      elementSelection: 'combatantName',
      elementSelector: '[data-combatant="{combatantName}"]',
      destinationSelector: '[data-squad="{targetSquad}"]',
      duration: 500,
    },
    // Flip-in-place (auto-detected: same selector = flip animation)
    {
      action: 'flipCard',
      elementSelection: 'card',
      elementSelector: '[data-card-id="{card}"]',
      destinationSelector: '[data-card-id="{card}"]', // Same = flip-in-place!
      duration: 400,
    },
  ],
});

// Returns an unregister function. Called inside setup(), the hook is also
// unregistered automatically when the component's effect scope disposes.
// A game may wrap this hook (to skip some actions, say); pass all three
// arguments through, since `run` is what matches the action to its outcome.
props.actionController.onBeforeAutoExecute(actionAnimations.onBeforeAutoExecute);

// Top-level, so the template unwraps it.
const { flyingElements } = actionAnimations;
</script>

<template>
  <FlyingCardsOverlay :flying-cards="flyingElements" />
</template>
```

A `{selection}` placeholder goes only inside a double-quoted attribute value, as above. Its value is escaped for that spot, so quotes and backslashes in it are safe; a placeholder anywhere else (`#card-{card}`, `[data-x='{card}']`) is refused when `useActionAnimations` is set up.

**Flip-in-Place Behavior:**

When the composable detects a flip-in-place animation (`elementSelector === destinationSelector`), it automatically:
- Hides the element during animation (prevents "double card" effect)
- Enables 3D flip animation
- Uses instant reveal (no crossfade) to prevent visual artifacts
- Configures internal timing to avoid flash/flicker issues

You don't need to set `hideDestination`, `flip`, or `crossfadeDuration` - they're configured automatically.

**When it plays:** the composable listens to `actionController.onAfterAutoExecute` for each action's result. The flight plays only once the server has accepted the action and the state it produced has rendered; a state update from another seat while the action is in flight does not play it. If the server refuses the action, or it is cancelled before it is sent, the hidden element gets back exactly the inline styles it had and no flight plays. If the player cancels while a game's own before-hook is still waiting, no hook after it is called for that action, and its outcome carries the `run` number the hooks were given, so whether the game's hook is registered before or after this one, the cancelled action cannot undo or overwrite the capture of the action the player started next (#1026).

**Animation Config Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `action` | `string` | required | Action name that triggers this animation |
| `elementSelection` | `string` | required | Selection name whose value identifies the element |
| `elementSelector` | `string` | required | CSS selector with `{placeholder}` for action args |
| `destinationSelector` | `string \| function` | required | Where element moves to (same as source = flip-in-place) |
| `duration` | `number` | 400 | Animation duration in ms |
| `elementSize` | `{ width, height }` | 60x84 | Size of flying element |
| `flip` | `boolean` | auto | Enable 3D flip (auto-enabled for flip-in-place) |
| `hideDestination` | `boolean` | auto | Hide destination during animation (auto-enabled for flip-in-place) |
| `getElementData` | `function` | innerHTML | Extract data for rendering flying element |

### useFLIP

Unified FLIP animation API with multi-container support. FLIP (First-Last-Invert-Play) animations smoothly transition elements when they move within containers.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useFLIP, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const boardRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);

// Single container (manual mode)
const manual = useFLIP({
  containerRef: boardRef,
  selector: '[data-element-id]',
  duration: 300,
});

async function moveWithAnimation(change: () => void) {
  manual.capture();   // Before state change
  change();
  await manual.animate();
}

// Multi-container support
const multi = useFLIP({
  containers: [
    { ref: boardRef, selector: '[data-piece-id]' },
    { ref: handRef, selector: '[data-card-id]' },
  ],
  duration: 300,
});

// Auto mode (watches game state automatically)
const auto = useFLIP({
  containerRef: boardRef,
  selector: '[data-element-id]',
  auto: true,
  gameView: () => props.gameView,
});
</script>

<template>
  <div ref="boardRef" class="board" :class="{ moving: auto.isAnimating.value }" />
  <div ref="handRef" class="hand" />
</template>
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `containerRef` | `Ref<HTMLElement \| null>` | Single container (use this OR containers) |
| `containers` | `FLIPContainer[]` | Multiple containers (use this OR containerRef) |
| `selector` | `string` | CSS selector for elements (default: '[data-element-id]') |
| `duration` | `number` | Animation duration in ms (default: 300) |
| `easing` | `string` | CSS easing (default: 'ease-out') |
| `threshold` | `number` | Minimum movement in pixels (default: 1) |
| `auto` | `boolean` | Enable auto-mode with gameView watcher |
| `gameView` | `() => unknown` | Required when auto: true |

### usePlayerStatAnimation

Animate stat changes and fly elements to player stat displays.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { usePlayerStatAnimation, flyToPlayerStat, useFlyingElements } from 'boardsmith/ui';

// Get flyMultiple function from useFlyingElements
const { flyMultiple } = useFlyingElements();
// The stat's element in the players panel, for your own animations
const { getPlayerStatElement } = usePlayerStatAnimation();

// Fly cards to seat 1's "books" stat display (seats are 1-indexed)
function flyBooksHome(removedCards: { rect: DOMRect; rank: string; suit: string }[]) {
  flyToPlayerStat(flyMultiple, {
    cards: removedCards.map((c) => ({ rect: c.rect, rank: c.rank, suit: c.suit })),
    playerSeat: 1,
    statName: 'books',
  });
}
</script>
```

### useGameViewHelpers

Utilities for querying game state.

<!-- typecheck: game src/ui/helpers.ts -->
```typescript
import {
  findElement,
  findPlayerHand,
  getCards,
  getElementOwner,
  isMyElement,
  type GameViewElement,
} from 'boardsmith/ui';

export function describeHand(gameView: GameViewElement, playerSeat: number) {
  // Find specific element
  const deck = findElement(gameView, { type: 'deck' });

  // Find player's hand
  const myHand = findPlayerHand(gameView, playerSeat);

  // Get all cards in an element
  const cardsInHand = getCards(myHand);

  // Check ownership
  const [card] = cardsInHand;
  const owner = getElementOwner(card);
  const isMine = isMyElement(card, playerSeat);

  return { deck, cardsInHand, owner, isMine };
}
```

### useGameGrid

Utilities for square grids (chess notation, etc.).

It reads the board's cells from the game view: the board element (class `Board` by default) and its cells (class `Square`), each carrying its `row` and `col` attributes.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { useGameGrid, toAlgebraicNotation, fromAlgebraicNotation, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

const { getCellAt, toNotation, fromNotation, isInBounds } = useGameGrid({
  gameView: () => props.gameView,
  boardClassName: 'Board',   // the defaults, shown for clarity
  cellClassName: 'Square',
  rows: 8,
  cols: 8,
});

const corner = getCellAt(0, 0);   // the cell at row 0, col 0, or undefined
toNotation(0, 0);                 // "a8": row 0 is the top row by default
fromNotation('e4');               // { row: 4, col: 4 }, or null off the board

// The same conversions without a board
toAlgebraicNotation(0, 0, { rowZeroAtTop: false });   // "a1"
fromAlgebraicNotation('e4');                          // { row: 4, col: 4 }
</script>

<template>
  <div class="grid" :data-corner="corner?.id" :data-in-bounds="isInBounds(7, 7)" />
</template>
```

### useHexGrid

Utilities for hexagonal grids.

It reads the board's cells from the game view. Each cell's axial coordinates come from the attributes the board names in `$qCoord`/`$rCoord` (default `q` and `r`), and the size and orientation from the board's `$hexSize`/`$hexOrientation`, falling back to the defaults you pass.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import {
  useHexGrid,
  hexToPixel,
  getHexPolygonPoints,
  calculateHexDistance,
  type TableBoardProps,
} from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

const {
  cells,
  getHexPosition,
  getHexPoints,
  getNeighbors,
  hexDistance,
  hexGridBounds,
} = useHexGrid({
  gameView: () => props.gameView,
  boardClassName: 'Board',   // the defaults, shown for clarity
  cellClassName: 'Cell',
  defaultHexSize: 30,
  defaultOrientation: 'flat',  // or 'pointy'
});

const hexPoints = getHexPoints();        // one polygon, centred on (0, 0)
const center = getHexPosition(3, 2);     // { x, y } of the hex at q=3, r=2
getNeighbors(3, 2);                      // the six { q, r } around it
hexDistance(0, 0, 3, 2);                 // 5 steps

// The same maths without a board
const { x, y } = hexToPixel(3, 2, 30, 'flat');
const points = getHexPolygonPoints(30, 'flat');
const dist = calculateHexDistance(0, 0, 3, 2);
</script>

<template>
  <svg :viewBox="`${hexGridBounds.minX} ${hexGridBounds.minY} ${hexGridBounds.width} ${hexGridBounds.height}`">
    <polygon
      v-for="cell in cells"
      :key="cell.id"
      :points="hexPoints"
      :transform="`translate(${getHexPosition(Number(cell.attributes?.q), Number(cell.attributes?.r)).x}, ${getHexPosition(Number(cell.attributes?.q), Number(cell.attributes?.r)).y})`"
    />
  </svg>
</template>
```

### useCardDisplay

Card display formatting utilities.

<!-- typecheck: game src/ui/cards.ts -->
```typescript
import {
  useCardDisplay,
  getSuitSymbol,
  getSuitColor,
  getRankName,
  isRedSuit
} from 'boardsmith/ui';

getSuitSymbol('H');  // "♥"
getSuitSymbol('D');  // "♦"
getSuitSymbol('C');  // "♣"
getSuitSymbol('S');  // "♠"

getSuitColor('H');   // "#e74c3c" (red)
getSuitColor('S');   // "#2c3e50" (black)

getRankName('K');    // "King"
isRedSuit('D');      // true
```

### createFLIPSnapshot

One-off FLIP animation for a single update cycle.

<!-- typecheck: game src/ui/flip-once.ts -->
```typescript
import { nextTick, type Ref } from 'vue';
import { createFLIPSnapshot } from 'boardsmith/ui';

export async function sortWithAnimation(containerRef: Ref<HTMLElement | null>, sort: () => void) {
  // Capture positions immediately
  const snapshot = createFLIPSnapshot(containerRef, '[data-card-id]', {
    duration: 300,
    easing: 'ease-out',
  });

  sort();
  await nextTick();

  // After DOM update
  await snapshot.animate();
}
```

## Theming

`applyTheme()` is the only theming knob. It injects the Slate token stylesheet (once, idempotently)
and writes your overrides as inline custom properties on `<html>`.

<!-- typecheck: game src/ui/theme.ts -->
```typescript
import { applyTheme } from 'boardsmith/ui';

applyTheme({
  '--bsg-accent': '#00d9ff',
  '--bsg-accent-2': '#00ff88',
  '--bsg-accent-ink': '#04211d',
  '--bsg-bg': '#1a1a2e',
  '--bsg-surface': '#16213e',
  '--bsg-ink': '#ffffff',
  '--bsg-ink-2': '#888888',
  '--bsg-danger': '#e74c3c',
  '--bsg-ok': '#00ff88',
});
```

**Keys must be `--bsg-*` custom property names.** The signature is
`applyTheme(overrides?: Record<string, string>, options?: { scheme?: 'light' | 'dark' | 'auto' })`,
and every key is filtered through `/^--bsg-[a-z0-9-]+$/` before it is written — this is the
injection guard that stops an untrusted host page from pushing arbitrary CSS through the
`init.theme` postMessage. A key like `primary` or `background` is **not** a token name: it is
dropped (with a console warning naming the rejected keys) and nothing about the theme changes.
There is no `ThemeConfig` type — the overrides argument is a plain `Record<string, string>`.

Force a color scheme independently of the OS preference:

```typescript
applyTheme(undefined, { scheme: 'light' });  // sets <html data-theme="light">
applyTheme(undefined, { scheme: 'auto' });   // clears it; follows prefers-color-scheme
```

Common tokens (the full set lives in `src/ui/theme.ts`, the single source of truth):

| Token | Role |
| --- | --- |
| `--bsg-bg`, `--bsg-bg-2` | Page ground |
| `--bsg-surface`, `--bsg-surface-2`, `--bsg-surface-3` | Raised panels |
| `--bsg-ink`, `--bsg-ink-2`, `--bsg-ink-3` | Text: primary, secondary, tertiary |
| `--bsg-line`, `--bsg-line-2` | Borders and dividers |
| `--bsg-accent`, `--bsg-accent-2`, `--bsg-accent-ink` | Accent, hover accent, text on accent |
| `--bsg-danger`, `--bsg-ok`, `--bsg-warn` | Status colors |
| `--bsg-seat-1` … `--bsg-seat-6` | Per-seat player colors |
| `--bsg-cell`, `--bsg-cell-line` | Board cell fill and gridline colors |
| `--bsg-cell-size`, `--bsg-card-w` | Natural size of a grid cell edge and of a card's width (lengths, not colors) |
| `--bsg-font`, `--bsg-display`, `--bsg-mono` | Font stacks |
| `--bsg-r-sm/md/lg/pill`, `--bsg-s1`…`--bsg-s6` | Radii and spacing steps |

## Animation Events

BoardSmith's animation event system enables game UIs to play back animations asynchronously while game state advances immediately. Animation events are pure data signals emitted via `game.animate()` -- the server broadcasts truth and moves on, never waiting on animation playback. This is called the **soft continuation pattern**.

### Key Concepts

**Animation events are pure data.** Each event carries a `type` string and a JSON-serializable `data` payload. No mutations are attached to the event -- it simply describes what happened so the UI can visualize it.

**Game state advances immediately (soft continuation).** When `game.animate()` is called, the event is emitted and game execution continues. The game never pauses for animations.

**The client owns playback entirely.** The server broadcasts truth and moves on. The client processes events through a FIFO queue, playing animations sequentially via registered handlers. The server has no knowledge of animation playback state.

**Wait-for-handler.** When the queue encounters an event type with no registered handler, it pauses (up to a configurable `handlerWaitTimeout`, default 3s) to allow lazily-mounted components to register their handlers. If a handler registers during the wait, processing resumes immediately. If the timeout expires, the event is skipped with a console warning.

- Game logic remains clean and synchronous
- UI can skip or speed through animations without affecting game correctness
- Reconnecting players see current state immediately (with optional animation replay)
- Players always see truth -- animations are visual overlays on the current state

### Engine-Side: Emitting Events

Use `game.animate(type, data)` to emit pure data animation events during action execution. An optional callback can co-locate game logic with the event for convenience.

**Pure data form (preferred for signals):**

```typescript
// In action execute() or game logic
execute({ attacker, target }: { attacker: Combatant; target: Combatant }) {
  const damage = attacker.attack - target.defense;

  // Emit the animation event as pure data
  game.animate('combat', {
    attackerId: attacker.id,
    targetId: target.id,
    damage,
  });

  // Game state advances via normal code
  target.health -= damage;
  if (target.health <= 0) {
    target.putInto(this.graveyard);
  }
}
```

**Callback convenience form (co-locates game logic with the event):**

```typescript
execute({ attacker, target }: { attacker: Combatant; target: Combatant }) {
  const damage = attacker.attack - target.defense;

  // Callback runs immediately as normal game code
  game.animate('combat', {
    attackerId: attacker.id,
    targetId: target.id,
    damage,
  }, () => {
    target.health -= damage;
    if (target.health <= 0) {
      target.putInto(this.graveyard);
    }
  });
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Event type identifier (e.g., 'combat', 'score', 'cardFlip') |
| `data` | `Record<string, unknown>` | Event-specific payload: plain data, elements and players (see "Elements in event data" below) |
| `callback` | `() => void` | Optional. Runs immediately as normal game code. Convenience for co-locating game logic with the event it describes. Mutations are NOT captured on the event. |

**Pure signal events:**

Many events exist purely to signal the UI (e.g., score reveals, phase transitions). Use the pure data form with no callback:

```typescript
game.animate('score-reveal', { playerId: player.id, total: 42 });
```

**Elements in event data:** pass the element itself, not its id. Each seat receives an element as `{ __elementRef: '<branch>' }`, a path in that seat's own game view, worked out when the view is built, so it reflects where the element is now. A player arrives as `{ __playerRef, seat, color, name }`.

- An element the seat can see keeps its own path.
- An element the seat cannot see is named by the outermost container that conceals it from that seat: a card in another player's hand arrives as the hand, a card in a count-only deck as the deck, a card anywhere inside a `contentsHidden()` zone as the zone. The seat learns which container, never the element's name, real id or place inside it, so a shuffle or a hidden zone's size stays hidden.
- An element in `game.pile` arrives as a reference that names nothing in the seat's view.
- In world mode a reference is written as `{ __elementId }`, and the same rules apply: an element the seat cannot see arrives as its concealer's id, and an element in the pile as the same reference that names nothing. A reference to an element in a partition not loaded on this instance is withheld: every seat receives the same reference that names nothing, so no real id is sent (#1166). These rules cover every element reference a seat receives, in element attributes, settings and message data too (#1043).

A raw id such as `card.id` reaches every seat unchanged, so it gives away which card a hidden one is.

```typescript
game.animate('drew', { card, player });
// The owner's handler: event.data.card -> { __elementRef: '3/1' }, the card in its hand
// Another seat's:      event.data.card -> { __elementRef: '3' }, the owner's hand
```

**No nesting:** `animate()` throws if called inside another `animate()` callback. Each animation event must be a separate call:

```typescript
// WRONG: nested animate() calls
game.animate('attack-start', { attackerId: attacker.id }, () => {
  game.animate('damage', { damage }, () => { ... }); // throws!
});

// RIGHT: sequential animate() calls
game.animate('attack-start', { attackerId: attacker.id });
game.animate('damage', { targetId: target.id, damage }, () => {
  target.health -= damage;
});
```

### UI-Side: Consuming Events

The UI-side uses a composable pattern with provide/inject for component tree access.

**Creating the instance (in GameShell or root component):**

<!-- typecheck: game src/ui/animation-events.ts -->
```typescript
import type { Ref } from 'vue';
import type { PlayerGameState } from 'boardsmith/session';
import { createAnimationEvents, provideAnimationEvents } from 'boardsmith/ui';

// Call from the root component's setup, with the seat's latest state.
export function setUpAnimationEvents(state: Ref<PlayerGameState | null>) {
  const animationEvents = createAnimationEvents({
    // Get events from player state (reactive getter)
    events: () => state.value?.animationEvents,

    // Optional: delay for events without handlers (ms, default: 0)
    defaultDuration: 0,

    // Optional: time to wait for handler registration before skipping (ms, default: 3000)
    handlerWaitTimeout: 3000,
  });

  // Provide to component tree
  provideAnimationEvents(animationEvents);
  return animationEvents;
}
```

**Registering handlers (in game board components):**

```typescript
// In a board's setup. useAnimationEvents comes from 'boardsmith/ui', onUnmounted from 'vue';
// playAttackAnimation and the rest are your game's own animations.
const animations = useAnimationEvents();

// Register handler - returns cleanup function
// The handler's second argument provides a signal for cooperative skip support.
// The third says what skipAll() does to it: 'run' calls it with the signal already
// aborted (for cleanup that must happen), 'drop' discards the event. It is required.
const unregister = animations?.registerHandler('combat', async (event, { signal }) => {
  const { attackerId, targetId, damage, outcome } = event.data;

  // Find DOM elements
  const attackerEl = document.querySelector(`[data-combatant-id="${attackerId}"]`);
  const targetEl = document.querySelector(`[data-combatant-id="${targetId}"]`);

  // Play attack animation
  await playAttackAnimation(attackerEl, targetEl);
  if (signal.aborted) return; // User pressed skip

  // Show damage number
  await showDamageNumber(targetEl, damage);
  if (signal.aborted) return;

  if (outcome === 'kill') {
    await playDeathAnimation(targetEl);
  }
}, { skip: 'drop' });

// Clean up on unmount (optional - composable handles cleanup)
onUnmounted(() => unregister?.());
```

**Composable API:**

| Function | Description |
|----------|-------------|
| `createAnimationEvents(options)` | Create an animation events instance in root component |
| `provideAnimationEvents(instance)` | Provide instance to component tree |
| `useAnimationEvents()` | Inject animation events from ancestor |

**Instance API:**

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `registerHandler(type, handler, { skip })` | `(string, (event, { signal }) => Promise<void>, { skip: 'run' \| 'drop' }) => () => void` | Register handler, returns cleanup function. `signal` is an `AbortSignal` that fires on skip; `skip` says whether a skipped handler still runs (`'run'`, signal pre-aborted) or is dropped. |
| `isAnimating` | `Ref<boolean>` | Whether animations are currently playing |
| `paused` | `Ref<boolean>` | Pause/resume control |
| `skipAll()` | `() => void` | Skip remaining animations |
| `pendingCount` | `Ref<number>` | Number of pending events (for UI indicators) |

### Integration with useFLIP and useFlyingElements

For custom animation needs, combine `useFLIP` and `useFlyingElements` with animation events:

```typescript
// In a board's setup: useFLIP, useFlyingElements and useAnimationEvents come from 'boardsmith/ui'

// FLIP animations for element movements
const { capture, animate } = useFLIP({
  containers: [
    { ref: boardRef, selector: '[data-piece-id]' },
  ],
});

// Flying elements for card transitions
const { fly, flyingElements, flyOnAppear } = useFlyingElements();

// Animation events for custom handlers
const animationEvents = useAnimationEvents();
animationEvents?.registerHandler('combat', async (event, { signal }) => {
  await playCombatAnimation(event.data);
  if (signal.aborted) return; // skip support
}, { skip: 'drop' });
```

This approach gives you full control over each animation system while maintaining clean separation of concerns.

### ActionController Integration

The `useActionController` composable integrates with animation events to gate the ActionPanel on animation completion:

```typescript
const actionController = useActionController({
  // ... other options ...
  animationEvents, // Pass animation events instance for gating
});

// Available computed properties:
// actionController.animationsPending - true when animations playing
// actionController.showActionPanel - true when safe to show action UI
```

**showActionPanel** gates on three conditions:

1. `isMyTurn` - It's this player's turn
2. `!animationsPending` - No animations are currently playing
3. `!pendingFollowUp` - No follow-up action pending

This ensures players don't make decisions before seeing the results of previous actions.

### Common Pitfalls

**1. Mutating event data in handlers**

Event data is a shallow copy - nested objects share references. Don't modify `event.data` directly in handlers.

**2. Not handling handler errors gracefully**

Handler errors are logged but don't stop the processing chain. Design handlers defensively - one broken handler shouldn't break all animations.

**3. Blocking entire UI on animations**

Only gate decision-making (ActionPanel). Let players inspect the board, view history, etc. during animations.

**4. Checking isMyTurn instead of showActionPanel**

Custom UIs should use `showActionPanel` (which includes animation gating), not just `isMyTurn`. Otherwise, actions may be shown during animation playback.

**5. Forgetting handlerWaitTimeout for lazily-mounted components**

If a component registers handlers in `onMounted` and events arrive before mounting, the wait-for-handler mechanism pauses the queue. The default 3s timeout handles most cases, but games with slow-mounting components may need a longer timeout via the `handlerWaitTimeout` option in `createAnimationEvents()`.

See [Nomenclature](./nomenclature.md) for animation event terminology definitions.

## Action Controller API

The `actionController` (type: `UseActionControllerReturn`) is the unified interface for executing and managing game actions. It is passed to the board component as a prop and handles all action execution, wizard mode navigation, and auto-fill logic.

### Controller Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `execute` | `(name: string, args?: Record<string, unknown>) => Promise<ControllerActionResult>` | Execute an action immediately with provided args; resolves to the server's answer as a `ControllerActionResult` (`.success`/`.error`) |
| `start` | `(name: string, options?: StartOptions) => Promise<ControllerActionResult>` | Start wizard mode for a multi-selection action (await before driving further selections). `success: true` means wizard mode began, not that the action ran |
| `fill` | `(name: string, value: unknown) => Promise<PickValidationResult>` | Fill a specific selection in wizard mode (async) |
| `skip` | `(selectionName: string) => void` | Skip an optional selection (requires the selection name) |
| `clear` | `(selectionName: string) => boolean` | Take back a pick and every pick after it, keeping the action open so the cleared pick is asked again. Returns `false` and sets `lastError` when refused: a pick step still waiting on the server, a name that is not one of the action's picks, or a pick at or before an answer the server already holds. The Action Panel's clear button calls it |
| `canClear` | `(selectionName: string) => boolean` | Whether `clear()` would take this pick back now, by the same rules. Draw a clear control only where this is true, as the Action Panel does |
| `cancel` | `() => void` | Cancel wizard mode and clear selections |
| `confirm` | `() => Promise<ControllerActionResult>` | Send the open action to the server with its picks so far. A quoted action is refused until every pick is answered and the price on screen is that draft's price (see `confirmDisabledReason`) |
| `resumeFollowUp` | `() => Promise<void>` | Start the follow-up the server holds for this seat (`heldFollowUp`), even one cancelled before. Does nothing while another action is open, while an action is out to the server, while viewing history, or when no follow-up is held |
| `toggleMultiSelect` | `(selectionName: string, value: unknown) => Promise<void>` | Add or remove a value in the draft of a multiSelect pick of the open action; ignored for a name that is not one. An add past `max` is ignored. Confirms on its own when `min === max` and that count is reached |
| `confirmMultiSelect` | `() => Promise<PickValidationResult \| void>` | Fill the multiSelect or ordered-list selection with its draft |
| `isMultiSelectSelected` | `(selectionName: string, value: unknown) => boolean` | Whether a value is in the draft for that selection |
| `appendListEntry` | `(selectionName: string, value: unknown) => Promise<void>` | Add one entry to an `orderedList` draft (the same value again adds a second entry). Appends past `max` are ignored |
| `removeListEntry` | `(selectionName: string, index: number) => void` | Drop the ordered-list draft entry at `index` |
| `setPickDraft` | `(value: string \| number \| null) => void` | Record what the player has typed into the current number or text editor and not submitted, or `null` to clear it |
| `getChoices` | `(pick: EnrichedPickMetadata) => Array<{ value: unknown; display: string; disabled?: string }>` | Choices for a pick (handles `filterBy` and `dependsOn`). `disabled` is the reason a choice cannot be picked, absent when it can |
| `getValidElements` | `(pick: EnrichedPickMetadata) => EnrichedValidElement[]` | Valid elements for an element pick, from the cache. Not reactive; use `validElements` for the current pick |
| `getActionMetadata` | `(actionName: string) => EnrichedActionMetadata \| undefined` | Metadata for an action |
| `getCollectedPick` | `(name: string) => CollectedPick \| undefined` | A pick collected so far: `{ value, display, skipped }` |
| `onBeforeAutoExecute` | `(hook: BeforeAutoExecuteHook) => () => void` | Add a hook that runs just before a pick auto-executes an action. Returns a function that removes it. See [useActionAnimations](#useactionanimations) |
| `onAfterAutoExecute` | `(listener: AfterAutoExecuteListener) => () => void` | Add a listener told how each auto-executed action ended. Returns a function that removes it |

**StartOptions:**

| Option | Type | Description |
|--------|------|-------------|
| `args` | `Record<string, unknown>` | Values applied immediately to matching selections |
| `prefill` | `Record<string, unknown>` | Values auto-filled when their selection becomes active. A pick that takes a list (chooseElements, multiSelect, ordered list) takes an array, each entry matched against the choices; a lone value for one is refused |

Use `args` for selections that are already available. Use `prefill` for deferred auto-fill of future selections (e.g., when the first selection determines which options appear in the second).

### Controller State

| Property | Type | Description |
|----------|------|-------------|
| `currentAction` | `Ref<string \| null>` | Name of action currently in wizard mode (read `.value`) |
| `currentArgs` | `Readonly<Ref<Readonly<Record<string, unknown>>>>` | Args collected so far for the current action. Read-only; change them with `start`, `fill`, `skip` or `clear` |
| `currentPick` | `ComputedRef<EnrichedPickMetadata \| null>` | Metadata for the current pick step (read `.value`) |
| `validElements` | `ComputedRef<EnrichedValidElement[]>` | **Reactive** list of valid elements for current selection |
| `currentChoices` | `ComputedRef<ChoiceWithRefs[]>` | **Reactive** choices for the current pick; updates when fetched choices arrive |
| `startCandidates` | `ComputedRef<ReadonlyMap<string, StartCandidates>>` | With no action open, each available action that opens with an element pick, mapped to `{ pick, elements }`. Empty off turn |
| `isReady` | `ComputedRef<boolean>` | Whether an action is open with no pick left to answer (a skipped optional pick counts as answered). A quoted action then still waits for `confirm()` |
| `isExecuting` | `Readonly<Ref<boolean>>` | Whether the current seat has an action out to the server (read `.value`) |
| `lastError` | `Ref<string \| null>` | Error message from last failed execution (read `.value`) |
| `errorTick` | `Readonly<Ref<number>>` | Goes up on every failure that sets `lastError`, even a repeat of the same message. Watch it to show each failure once |
| `isLoadingChoices` | `Ref<boolean>` | Whether choices are being fetched from the server |
| `repeatingState` | `Ref<RepeatingState \| null>` | Progress of a repeating selection: `{ selectionName, accumulated, awaitingServer, currentChoices? }` |
| `pendingFollowUp` | `Ref<boolean>` | True between the server handing back a follow-up and it starting. Don't start another action meanwhile |
| `pendingOnServer` | `Readonly<Ref<boolean>>` | True while the current action is a follow-up or an `onSelect` selection. These are never in `availableActions`, so don't cancel the action for being missing from it |
| `stepOutstanding` | `Readonly<Ref<boolean>>` | True while an `onSelect` or repeating pick step is on its way to the server. `cancel()` tells the server too then |
| `heldFollowUp` | `ComputedRef<FollowUpOffer \| undefined>` | The follow-up the server holds for this seat, if any. The seat keeps its turn while it is held; offer `resumeFollowUp` to start it again |
| `actionStartTick` | `Readonly<Ref<number>>` | Goes up each time an action starts, including a restart of the action that just finished. Watch it with `currentAction` |
| `actionCompletedTick` | `Readonly<Ref<number>>` | Goes up each time an action chain fully resolves (once per chain, not per action) |
| `lastActionResult` | `ComputedRef<ResolvedAction \| null>` | The most recently resolved action and its server result — `{ action, seat, result }`. See below. |
| `multiSelectDraft` | `Ref<{ selectionName: string; values: unknown[] } \| null>` | The in-progress multiSelect or ordered-list values, shared by the Action Panel and custom UIs. Not in `currentArgs` until `confirmMultiSelect()` |
| `currentPickDraft` | `ComputedRef<string \| number \| null>` | What the player has entered into the current number or text editor and not submitted; an untouched number pick reads its `initial`. Write it with `setPickDraft` |
| `actionQuote` | `ComputedRef<readonly string[] \| null>` | What the game says the current draft of a quoted action would cost, or `null` when no price is true right now |
| `quotePending` | `ComputedRef<boolean>` | True while the price of the current draft is still being worked out |
| `quoteError` | `ComputedRef<string \| null>` | Why the current draft could not be priced, or `null` |
| `awaitingConfirmation` | `ComputedRef<boolean>` | True when a quoted action's draft is complete and waiting for `confirm()` |
| `confirmDisabledReason` | `ComputedRef<string \| null>` | For an open quoted action, why `confirm()` is refused right now, or `null` when it is allowed. Also `null` when no quoted action is open. Bind it to the confirm control |
| `actionMenuPath` | `Ref<readonly string[]>` | The action-group path the player has opened in the Action Panel; empty at the top level |
| `actionSnapshot` | `Ref<ActionStateSnapshot \| null>` | The current action's state: its metadata, frozen at start (so a follow-up not in `availableActions` has it), and the picks collected so far. Read it; don't write it |
| `animationsPending` | `ComputedRef<boolean>` | Whether animations are playing. Always `false` without `animationEvents` |
| `showActionPanel` | `ComputedRef<boolean>` | Whether to show action UI: `isMyTurn && !animationsPending && !pendingFollowUp` |

### Reading an action's return value (`lastActionResult`)

An action's `execute()` can return a computed value to the seat that took it via
`ActionResult.data` (a map recall, a scout report, a peek at the top of a deck).
`execute()` hands that back to its own caller — but an action driven by picks
(a selection with `onSelect`, or a repeating one) *completes inside `fill()`*,
usually from an ActionPanel click no board code called at all. There is no caller
to return to, so the controller publishes every resolution here instead:

```typescript
watch(actionController.lastActionResult, (resolved) => {
  if (resolved?.action !== 'viewMap' || !resolved.result.success) return;
  cartography.value = resolved.result.data?.cartography as CartographyView;
});
```

Set at every resolution — single-step, `onSelect`-routed, repeating, each link of
a `followUp` chain, and failures as well as successes. A fresh object is assigned
each time, so a `watch` fires even when two consecutive results are identical.
`data` reaches the acting seat only: it never rides `flowState`, a player view, or
the spectator view.

### Element Selections with validElements

When building custom UIs for element selections (`chooseElement`, `chooseElements`), use the **reactive `validElements` computed** instead of `getValidElements()`. This computed automatically updates when:
- The current selection changes
- Choices are fetched from the server
- The gameView updates

```typescript
const { validElements, currentPick } = props.actionController;

// Use the reactive computed directly - it updates automatically!
const selectableCards = computed(() => {
  if (currentPick.value?.type !== 'element') return [];

  return validElements.value.map(ve => ({
    id: ve.id,
    name: ve.display,
    // Full element data is included:
    image: ve.element?.attributes?.image,
    description: ve.element?.attributes?.description,
  }));
});
```

Each `EnrichedValidElement` includes:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `number` | Element ID (for submitting selection) |
| `display` | `string?` | Display text for UI |
| `ref` | `{ id: number }?` | Reference for board highlighting |
| `element` | `GameViewElement?` | Full element with all attributes |

**A large candidate set is a board choice, not a long list.** If a custom UI
renders one button per `validElement`, decide what it does past a couple of
dozen. The auto panel's answer — hand the choice to the board and send focus with
it — is described under [AutoUI](#the-actionpanel-offers-hierarchy-never-free-text).
What a custom UI must NOT do is filter the list down: the engine's enumeration is
the whole enumeration, and narrowing belongs in the action definition.

**Why not `getValidElements()`?** Maps aren't reactive in Vue, so `getValidElements()` won't trigger re-renders when choices load. The `validElements` computed has built-in reactivity tracking.

See [Element Enrichment](./element-enrichment.md) for full documentation.

### Usage Patterns

**Direct execution (single-step actions):**
```typescript
// Execute an action with all args provided
await actionController.execute('draw', { count: 3 });

// Execute an action that requires no selections
await actionController.execute('endTurn');
```

**Wizard mode (multi-step actions):**
```typescript
// Start wizard mode - ActionPanel shows selection UI
actionController.start('move');

// Pre-fill the first selection immediately
actionController.start('move', { args: { piece: pieceId } });

// Prefill a future selection (auto-filled when that step becomes active)
actionController.start('move', {
  args: { piece: pieceId },
  prefill: { destination: targetCellId }  // Applied when 'destination' selection activates
});

// Custom boards can fill selections programmatically
actionController.fill('destination', cellId);

// Skip an optional selection (pass the selection's name)
actionController.skip('destination');

// Take a pick back (and every pick after it). Draw the control only where
// canClear() is true, as the Action Panel does: a value the game set, or a pick
// the server already holds (one a follow-up answered, say), cannot be cleared.
if (actionController.canClear('piece')) actionController.clear('piece');

// Cancel and clear
actionController.cancel();
```

**Reading controller state:**
```typescript
// Check if an action is in progress
if (actionController.currentAction.value === 'move') {
  // Show move-specific UI
}

// Show loading state during execution. Disabling always carries a reason —
// see v-disabled-reason in the Custom UI Guide.
<button v-disabled-reason="actionController.isExecuting.value && 'Finishing your last move.'">
  {{ actionController.isExecuting.value ? 'Working...' : 'Execute' }}
</button>

// Display errors
<div v-if="actionController.lastError.value" class="error">
  {{ actionController.lastError.value }}
</div>
```

## Error Handling in UI

The `actionController` provides error state that your UI should handle gracefully.

### Displaying Action Errors

<!-- typecheck: board -->
```vue
<template>
  <div class="game-board">
    <!-- Error toast/banner -->
    <Transition name="fade">
      <div v-if="actionController.lastError.value" class="error-banner" role="alert">
        {{ actionController.lastError.value }}
        <button aria-label="Dismiss" @click="dismissError">×</button>
      </div>
    </Transition>

    <!-- Game content -->
  </div>
</template>

<script setup lang="ts">
import type { TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

// The next action clears the error itself; this lets the player hide it sooner.
function dismissError() {
  props.actionController.lastError.value = null;
}
</script>

<style>
.error-banner {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: #e74c3c;
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  z-index: 1000;
}
</style>
```

### Loading States During Execution

Show feedback while actions are processing:

```vue
<template>
  <!-- Disable board interactions while executing -->
  <div
    class="game-board"
    :class="{ 'is-loading': actionController.isExecuting.value }"
  >
    <!-- Loading overlay -->
    <div v-if="actionController.isExecuting.value" class="loading-overlay">
      <span class="spinner" />
    </div>

    <!-- Action buttons -->
    <button
      v-for="action in availableActions"
      :key="action"
      v-disabled-reason="
        disabledActions?.[action] || (actionController.isExecuting.value && 'Finishing your last move.')
      "
      @click="executeAction(action)"
    >
      {{ actionController.isExecuting.value ? 'Working...' : action }}
    </button>
  </div>
</template>

<style>
.game-board.is-loading {
  pointer-events: none;
  opacity: 0.7;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
}
</style>
```

### Handling Specific Error Types

Common error messages and how to handle them:

```typescript
async function handleAction(name: string, args: Record<string, unknown>) {
  try {
    await actionController.execute(name, args);
  } catch (e) {
    // actionController.lastError is already set, but you may want custom handling
  }

  // Check error after execution
  const error = actionController.lastError.value;
  if (error) {
    switch (true) {
      case error.includes('Not your turn'):
        // UI should already prevent this, but handle gracefully
        showToast('Please wait for your turn');
        break;

      case error.includes('not available'):
        // Action became unavailable (opponent moved, etc.)
        showToast('This action is no longer available');
        refreshAvailableActions();
        break;

      case error.includes('Invalid selection'):
        // Selection was rejected by the server
        showToast('Invalid selection - please try again');
        actionController.cancel();
        break;

      default:
        // Generic error display
        showToast(error);
    }
  }
}
```

### Preventing Errors with Validation

Check availability before showing interactive elements:

<!-- typecheck: board -->
```vue
<template>
  <!-- Only show clickable cards that are valid selections -->
  <div
    v-for="card in myHand"
    :key="card.id"
    class="card"
    :class="{
      'clickable': isCardPlayable(card),
      'disabled': !isCardPlayable(card),
    }"
    @click="isCardPlayable(card) && playCard(card)"
  >
    {{ card.attributes?.rank }}{{ card.attributes?.suit }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { findElements, type BaseElementAttributes, type GameViewElement, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

interface CardAttributes extends BaseElementAttributes {
  rank?: string;
  suit?: string;
}

const myHand = computed(() =>
  props.gameView ? (findElements(props.gameView, { className: 'Card' }) as GameViewElement<CardAttributes>[]) : [],
);

// Check if card can be played
function isCardPlayable(card: GameViewElement): boolean {
  // Must be our turn and action available
  if (!props.availableActions.includes('play')) return false;

  // If in wizard mode, check validElements
  const { currentPick, validElements } = props.actionController;
  if (currentPick.value?.name === 'card') {
    return validElements.value.some(ve => ve.id === card.id);
  }

  return true;
}

function playCard(card: GameViewElement) {
  if (props.actionController.currentPick.value?.name === 'card') {
    void props.actionController.fill('card', card.id);
  } else {
    void props.actionController.start('play', { args: { card: card.id } });
  }
}
</script>
```

### Error Recovery Patterns

```typescript
// Retry failed actions
async function executeWithRetry(
  name: string,
  args: Record<string, unknown>,
  maxRetries = 2
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await actionController.execute(name, args);

    if (!actionController.lastError.value) return; // Success

    if (attempt < maxRetries) {
      // Wait before retry (connection issues)
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // All retries failed
  showToast('Action failed - please try again');
}

// Reset UI state on persistent errors
function handlePersistentError() {
  actionController.cancel();
  // Refresh game state from server
  refreshGameState();
}
```

## Building Custom UIs

## Game View Data Structure

The `gameView` prop contains serialized game state. Each element has this structure:

```typescript
interface GameViewElement {
  id: number;              // Unique element ID - use this for action args!
  className: string;       // Element class name (e.g., 'Merc', 'Card')
  name?: string;           // Optional element name
  attributes: {            // Game-specific properties
    rank?: string;
    suit?: string;
    health?: number;
    // ... your custom properties
  };
  children?: GameViewElement[];  // Child elements
}
```

**Key point:** The `id` is at the top level, NOT inside `attributes`.

```typescript
// Correct - ID is at top level
const mercId = merc.id;  // ✓

// Wrong - ID is not in attributes
const mercId = merc.attributes.id;  // ✗ undefined
```

### Finding Elements by ID vs by Attributes

A common pattern is having UI data (like a selected equipment name) and needing to find the element's numeric ID for API calls. The element data you display comes from `attributes`, but the ID you need for actions is at the top level.

**The Problem:**
```typescript
// You have equipment stats displayed in the UI
const selectedEquipment = { name: 'Laser Rifle', damage: 10 };

// But you need the element ID to drop it
// How do you find the ID?
```

**The Solution:** Use `findElement` to search the merc's subtree. Its `name` criterion compares the element's own top-level `name` (the name the game gave the element when it created it), never anything in `attributes`. So this works only when the equipment element's `name` is the same string the UI is showing:

<!-- typecheck: game src/ui/drop-equipment.ts -->
```typescript
import { findElement, getElementId, type GameViewElement, type UseActionControllerReturn } from 'boardsmith/ui';

export async function dropEquipment(
  actionController: UseActionControllerReturn,
  merc: GameViewElement,
  selectedEquipment: { name: string },
): Promise<void> {
  // Only right when the element's own `name` equals the displayed name
  const equipment = findElement(merc, { name: selectedEquipment.name });
  const equipmentId = getElementId(equipment);

  if (equipmentId) {
    await actionController.execute('dropEquipment', {
      actingMerc: merc.id,
      equipment: equipmentId,
    });
  }
}
```

### Helper Functions for Finding Elements

The `boardsmith/ui` package provides several helpers for finding elements:

| Function | Description | Use When |
|----------|-------------|----------|
| `findElement(view, { id, type, name, className })` | First element anywhere in the tree matching every criterion given | Finding one container, or the element for a known ID |
| `findElements(view, { id, type, name, className })` | Every element anywhere in the tree matching every criterion given | Finding all cards, squares, etc. |
| `findPlayerHand(view, seat)` | The hand owned by a seat, wherever it sits in the tree | Finding a player's hand |
| `getElementId(element)` | Get numeric ID from element | Extracting ID for action calls |

`findElement` and `findElements` have no attribute criterion: `name` is the element's own `name`, and `type` is the `$type` attribute only. To match on any other attribute, take the candidates with `findElements` and filter on `attributes` yourself.

**Example: Equipment Modal**

```typescript
// User selects equipment from a modal showing equipment data
const selectedEquipmentName = 'Plasma Cannon';

// Find the merc that has this equipment
const merc = findElement(gameView, { className: 'Merc' });

// Find the equipment element by name within the merc.
// This assumes each equipment element's own `name` is its display name.
const equipment = findElement(merc, { name: selectedEquipmentName });

if (equipment) {
  console.log('Found equipment ID:', equipment.id);  // e.g., 42
  await actionController.execute('dropEquipment', {
    actingMerc: merc.id,
    equipment: equipment.id  // Use the numeric ID
  });
}
```

**Example: Finding Any Element by Name**

```typescript
// Find a sector anywhere in the game by its unique name.
// The game must have created the sector with the name 'alpha-3'.
const sector = findElement(gameView, { name: 'alpha-3' });
if (sector) {
  await actionController.execute('moveTo', { destination: sector.id });
}
```

**Example: Finding an Element by an Attribute**

When the value you have is stored in an attribute rather than in the element's `name` (here a `sectorId` attribute), `{ name }` will not find it. Filter on the attribute instead:

```typescript
// Every sector, then the one whose sectorId attribute matches
const sector = findElements(gameView, { className: 'Sector' })
  .find(el => el.attributes?.sectorId === 'alpha-3');
if (sector) {
  await actionController.execute('moveTo', { destination: sector.id });
}
```

## Calling Actions from Custom UIs

### When to Use `execute()` vs `start()`

The `actionController` has two main ways to trigger actions. Choosing the right one depends on whether you have all the information needed upfront.

| Method | Use When | What Happens |
|--------|----------|--------------|
| `execute(name, args)` | You have all selection values ready | Action executes immediately |
| `start(name, options?)` | User needs to make selections via ActionPanel | Enters wizard mode, ActionPanel shows selection UI |

**Decision Guide:**

```
Do you have ALL required selection values?
├── YES → Use execute()
│   Example: await execute('draw', { count: 3 })
│
└── NO → Use start()
    │
    ├── Do you have SOME values to pre-fill?
    │   └── YES → start('action', { args: { known: value } })
    │
    └── Should later selections auto-fill when they become active?
        └── YES → start('action', { prefill: { later: value } })
```

**Common Patterns:**

```typescript
// Pattern 1: No selections required (e.g., endTurn, pass)
await actionController.execute('endTurn');

// Pattern 2: All selections known (direct board click)
await actionController.execute('move', {
  piece: clickedPiece.id,
  destination: clickedCell.id
});

// Pattern 3: Start wizard mode (let ActionPanel handle selections)
actionController.start('play');

// Pattern 4: Pre-fill first selection, let user choose rest
actionController.start('move', { args: { piece: clickedPiece.id } });

// Pattern 5: Pre-fill dependent selection (auto-fills when reached)
actionController.start('dropEquipment', {
  args: { actingMerc: merc.id },
  prefill: { equipment: equipmentId }  // Applied when 'equipment' step activates
});
```

**args vs prefill:**

- `args`: Applied immediately when `start()` is called. Use for selections that are available now.
- `prefill`: Applied later when that selection step becomes active. Use for dependent selections where the choice isn't visible until a prior selection is made.

When calling `actionController.execute()` or `actionController.fill()`, pass **numeric element IDs**:

```typescript
// For chooseElement / chooseElements selections, pass the element ID
await actionController.execute('dropEquipment', {
  actingMerc: merc.id,       // number (e.g., 42)
  equipment: equipment.id,   // number (e.g., 17)
});

// For chooseFrom selections, pass the choice value
await actionController.execute('selectColor', {
  color: 'red',  // The actual choice value
});
```

The framework automatically converts element IDs to actual element objects before passing to the `execute()` handler.

### Complete Custom UI Flow Example

```typescript
// 1. Find elements in gameView
const myMercs = computed(() =>
  findElements(props.gameView, { className: 'Merc' })
    .filter(m => m.attributes?.player?.seat === props.playerSeat)
);

// 2. User clicks a merc
async function onMercClick(merc: GameViewElement) {
  if (!props.availableActions.includes('dropEquipment')) return;

  // 3. Start wizard mode with merc pre-selected
  await props.actionController.start('dropEquipment', {
    args: { actingMerc: merc.id }  // Pass numeric ID
  });
}

// 4. User clicks equipment (using validElements from actionController)
async function onEquipmentClick(equipment: GameViewElement) {
  const { currentPick, validElements } = props.actionController;

  // Check if this equipment is selectable
  if (currentPick.value?.name !== 'equipment') return;
  if (!validElements.value.some(ve => ve.id === equipment.id)) return;

  // Fill the selection with the equipment ID
  await props.actionController.fill('equipment', equipment.id);
}
```

### Debugging Action Calls

To debug what's being sent to the server, add logging:

```typescript
async function executeAction(name: string, args: Record<string, unknown>) {
  console.log('[Action]', name, 'args:', JSON.stringify(args, null, 2));
  await props.actionController.execute(name, args);
}
```

Or check the Network tab in browser dev tools - look for WebSocket messages or `/action` API calls.

### Example: Custom Game Board

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import {
  useBoardInteraction,
  useFLIP,
  findPlayerHand,
  getCards,
  type GameViewElement,
  type UseActionControllerReturn
} from 'boardsmith/ui';

const props = defineProps<{
  gameView: GameViewElement | null;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

const boardInteraction = useBoardInteraction();
const containerRef = ref<HTMLElement | null>(null);
const { capture, animate } = useFLIP({
  containerRef,
  selector: '[data-element-id]',
});

// Extract data from game view
const myHand = computed(() => {
  const hand = findPlayerHand(props.gameView, props.playerSeat);
  return hand ? getCards(hand) : [];
});

// Handle card click
async function onCardClick(card: any) {
  if (!props.isMyTurn) return;
  if (!props.availableActions.includes('play')) return;

  // Check if card is selectable via board interaction (wizard mode active)
  if (boardInteraction.isSelectableElement(card)) {
    boardInteraction.triggerElementSelect(card);
  } else {
    // Direct action execution
    await props.actionController.execute('play', { card: card.id });
  }
}

// Animate state changes
watch(() => props.gameView, (newView, oldView) => {
  if (containerRef.value && oldView) {
    capture();
    nextTick(() => {
      animate();
    });
  }
});
</script>

<template>
  <div ref="containerRef" class="game-board">
    <div class="hand">
      <div
        v-for="card in myHand"
        :key="card.id"
        class="card"
        :class="{
          'highlighted': boardInteraction.isHighlighted(card),
          'selected': boardInteraction.isSelected(card),
          'selectable': boardInteraction.isSelectableElement(card),
        }"
        :data-element-id="card.id"
        @click="onCardClick(card)"
      >
        {{ card.attributes?.rank }}{{ card.attributes?.suit }}
      </div>
    </div>
  </div>
</template>
```

## Related Documentation

- [Core Concepts](./core-concepts.md) - Understanding game state
- [Actions & Flow](./actions-and-flow.md) - How actions work
- [Element Enrichment](./element-enrichment.md) - Using validElements for custom selection UIs
- [Game Examples](./game-examples.md) - Real UI implementations
