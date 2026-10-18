# Migration Guide

## A hidden card's placeholder id is stable and the seat's own (#715)

A card in a zone a seat cannot see used to reach that seat as `-1`, `-2`, ...
in the order of the view, so the same number could name another card after a
move. Now each seat gets its own placeholder id for each such card. The card
keeps it while it stays in its hidden pile. It gets a new one when `shuffle()`
shuffles its space, and when it moves into any place some seat cannot see into
(another hidden zone, or under a hidden element). The ids are large
negative numbers, different for every seat, so do not expect `-1` or compare
them between seats. A test that read a placeholder should take it from the
seat's view or its pick candidates (`validElements`, `choices`), as a client
does.

Where a seat's move enters (an action, a selection step, a choices request,
and a world command or pick), its placeholders are read back into the real
cards. The move is refused, as if the card were not there, when a placeholder's
card has since been reissued or left the seat's sight, when the number is
another seat's placeholder, or when the seat sends the real id of a card it
only knows by placeholder. A bot's move names hidden cards by its seat's
placeholders, so the simulator's `mcts` policy and the bot trainer's benchmark
read them back the same way. Other server-side code is not affected:
`testGame.doAction`, the simulator's other policies and a game's own code still
pass elements or real ids.

A card in a `contentsHidden()` zone is now offered to a pick under such a
placeholder too, so a blind pick from a hidden pile works. The board still does
not draw that zone's cards.

An element whose placeholder was reissued carries a new `placeholderToken` field
in its full serialization (table snapshots and world partitions), which no
seat's view includes. Each reissue spends one value of the game's creation
counter, the same budget element ids come from.

## A grant below a concealed zone's hidden child reaches its seat (#961)

A card whose own visibility shows it to a seat now reaches that seat even when
it sits below a hidden child of a hidden, count-only or owner-only zone (a
card in a box in a `contentsHidden()` deck). The seat's view carries it as a
child of that zone, after the zone's placeholders, and leaves out the
containers in between. Only the card's own grant counts there, never a zone
rule set on a container between; a granted container's own zone rule still
applies to its contents. `isVisibleTo(seat)` is now true for such a card,
where it was false, and message text names the card itself for that seat. A
granted card directly in a concealed zone is now named by message text too,
where it was named by the zone.

A UI that reads a count-only or owner-only zone's `children` may now find more
entries than the zone has direct children; `childCount` still counts only the
direct children, and `getElementCount` now returns `childCount` whenever it
is set, where it used to prefer `children.length`. References to the card in
attributes and animation data still name the zone, since the card's real place
would show where the hidden containers are.

## `review-gate` needs the verify result of the round it scopes from; `ledger-check` fits Agent to Role (#1001)

`boardsmith review-gate <slug>` now refuses unless the commit the latest
finished review round names in `Verify:` has a passing
`boardsmith verify --chunk <slug>` result in `.boardsmith/verify/` of the
checkout it runs in. `chunk-merge` copies a chunk's results from its worktree
into the main checkout, but a chunk merged before this change, or a fresh
clone, has none: with a clean tree, `git checkout <that commit>`, run
`npx boardsmith verify --chunk <slug>`, check out your branch again, and rerun
the gate.

`boardsmith ledger-check` now refuses a dispatch whose `Agent` the project's
`agents` mapping (or the bs- defaults) dispatches as other roles and not the
recorded `Role`, such as `Role: mechanical` with `Agent: bs-judgement`. An
agent no role is mapped to now is let through, so remapping `agents` leaves
old run logs valid. Fix the `Role` to the role the work was dispatched as.

## Hidden elements in message text and unloaded world references are withheld (#1165, #1166)

`game.message()` text is now worked out for each seat when the message is
written, from what that seat could see then, and never changes afterwards. An
element the seat cannot see is named by the nearest container whose name it
can see, as element references name its concealer (#1043): a public
`'{{player}} drew {{card}}'` reads "drew Hand" for a seat that cannot see the
card, and the card's name only for a seat that can. A test that read another
seat's log for a hidden card's name now reads the container's name.

Each `MessageEntry` in `game.messages` gains `readings`, the text each seat
reads, and `text` stays the template. A message log saved by an older engine
has no `readings` and is refused when formatted, with a message saying to start
a new game; finish or restart games saved before this change.

In world mode, a seat's view no longer carries the real id of an element in a
partition not loaded on this instance. The reference arrives as
`{ __elementRef: 'pile/removed' }`, the reference that names nothing, which
decodes to `undefined`. A world UI that followed such an id must treat it as
unknown.

## A crash in a world action's condition, `validate` or `choices` is `rules-error` (#1015)

A seated world action whose condition, `validate` or `choices` throws something
other than a `PlayerFacingError` now makes `applyCommand` (and `TestWorld.take`)
throw a `WorldRefusal` with the game-owned code `rules-error` and the shared
crash sentence, as a throw from `execute` already did. Before, the thrown error
itself escaped, and a plain `Error` looked the same as the rules saying no. A
host that treated an uncoded throw from these callbacks as a refusal now sees a
crash; a refusal (a `PlayerFacingError`, a `validate` returning a string,
`{ success: false, error }`) is still uncoded. Throw a `PlayerFacingError` where
the callback means to refuse.

## `createColorOption` takes no colours, and code player options are published (#994, #992)

`createColorOption(colors, label)` is now `createColorOption(label)`. It always
offers the engine's `DEFAULT_COLOR_PALETTE`. Move a custom list into
`boardsmith.json`'s `colorPalette`, the one list dev and the live lobby use, and
delete the `color` option from your `gameDefinition`; dev builds it from that
palette:

```typescript
// Before
playerOptions: { color: createColorOption([{ value: '#ff0000', label: 'Fire' }]) }
// After: no `color` player option in code, and boardsmith.json has
// "colorPalette": [{ "id": "fire", "hex": "#ff0000", "label": "Fire" }]
```

The player options your `gameDefinition` declares are now merged with
`boardsmith.json`'s `playerOptions` by key, in `boardsmith dev` and in the
manifest `boardsmith build` publishes. Before, dev dropped the code ones and the
live lobby never saw them. A key declared in both places must be declared the
same in both, or dev and build refuse it, naming the key; keep each option in
one place. An id `boardsmith.json` declares twice is refused, and so is a
`color` entry in its `playerOptions`: move those colours to `colorPalette`.

A player option the platform's manifest cannot carry is now refused by both
`boardsmith dev` and `boardsmith build`, naming the option and what it needs.
The platform takes only `number`, `select`, `boolean` and `exclusive` options;
a `select` or `exclusive` needs a string `default` and `choices` given as
`{ "value", "label" }` pairs, and a `select`'s default must be one of them. A
`text` option, or an exclusive with no choices, is refused. The code types
match: `ExclusivePlayerOption` now requires `choices` and a string `default`
(no seat number), and `StandardPlayerOption` is a `select` with a required
`default` and `{ value, label }` choices, with no `text` or plain-string form.
A `color` option is typed as `ColorOptionDefinition`. MERC's `isDictator` is an
example (Shufflewick/MERC#72):

```typescript
// Before: refused, it has no choices
isDictator: { type: 'exclusive', label: 'Dictator', default: 'last' }
// After
isDictator: { type: 'exclusive', label: 'Dictator', default: 'last', choices: [{ value: 'dictator', label: 'Dictator' }] }
```

## `shuffle()` clears the visibility of what it shuffles (#962)

`space.shuffle()` now clears the own visibility of every element in the space
and everything inside them, the same as calling `clearVisibility()` on each:
grants from `addVisibleTo`, `showToAll`, `showOnlyTo`, `hideFrom` and
`setVisibility` are gone after a shuffle, so a seat that peeked at a card no
longer sees it at its new position. The space's own visibility and its zone
rule (`contentsHidden()` and the like) are unchanged. A game that wants a card
to stay revealed after shuffling applies its grant again after the shuffle.

## `createBot` and `new MCTSBot` take no action history; seat snapshots carry none (#1167)

The bot never read the history it was given: it searches from the game's
state. Its seat snapshot did carry that history, unredacted, so it named
hidden elements by their real place. Drop the fifth argument:

```typescript
// Before
createBot(game, MyGame, 'my-game', 2, runner.actionHistory, 'hard', strategy);
new MCTSBot(game, MyGame, 'my-game', 2, [], config, strategy);
// After
createBot(game, MyGame, 'my-game', 2, 'hard', strategy);
new MCTSBot(game, MyGame, 'my-game', 2, config, strategy);
```

`createSnapshot` no longer takes a `{ forSeat, reseed }` option. Use
`createSeatSnapshot(game, gameType, seed, { forSeat, reseed })`, which takes no
history and returns a `SeatSnapshot` whose `actionHistory` is always `[]`.

## `boardsmith test --selection` is removed (#986)

`boardsmith test` no longer takes `--selection <path>`, the authored-test
selection that ran only the files and test names listed in a manifest such as
`.agent-policy-tests.json`. `agent-policy verify` now runs the tests related to
a change instead, so nothing reads a selection. Delete any selection manifest
and run `boardsmith test` (optionally with filename filters) instead.

## Three unused public names are gone (#929)

`provideAnnouncer` is removed from `boardsmith/ui`; provide the announcer with
`provide(ANNOUNCER_KEY, announcer)`. `engineRootFieldAudience` is removed from
the root export. `GameRunner.getFlowDebugInfo()` is removed; call
`runner.game.getFlowDebugInfo()` instead.

## `handleOp` and the headless `send` take only ops a seat may send (#1109)

`SnapshotSessionHost.handleOp` and `HeadlessSession.send` now take a `SeatOp`,
not any `Op`, so `start`, `restoreEarlier` and `botSuggest` no longer compile
there. They were already refused at run time (#1102). Use the host's own entry
points instead: `host.start()`, `host.restoreEarlier(snapshot)` and
`host.runBotTurns()` (in a headless session, `session.start()` and
`session.arrange()`; bot seats move on their own). Code that passes ops read
from the wire as `Op` should type them as `SeatOp` where they are built, or
keep relying on the run-time refusal for input it cannot type.

## boardsmith.json has no `scoreboard` key any more (#930)

Nothing ever read `scoreboard`; only `boardsmith new` wrote it. `boardsmith
validate` now refuses it as an unknown key. Delete it from your
`boardsmith.json`.

## `simulateTutorial` starts a tutorial as the server does (#914)

`simulateTutorial` now starts a tutorial through the same function as the
server's `startTutorial` op. It runs the tutorial's `setup` before the first
scripted move, restarts the flow with the learner seat to move, and gives only
the learner seat a tutorial. So:

- `scenario` is now a function of the game, called once after `setup` has run,
  so its moves name the elements `setup` left on the board (#1079). A list is
  no longer accepted. A list built before the call named elements a `setup`
  that recreates them had already replaced, and the move failed with "That
  choice is no longer available". Before:

  ```typescript
  const scenario = buildWalkthrough(testGame.game);
  simulateTutorial(testGame, MY_TUTORIAL, { scenario });
  ```

  After:

  ```typescript
  simulateTutorial(testGame, MY_TUTORIAL, { scenario: (game) => buildWalkthrough(game) });
  ```

  A scenario that names no elements just wraps its list:
  `scenario: () => [{ action: 'pass' }]`. Patch the game in the function, not
  before the call, when the patch moves elements `setup` replaces.
- Moves by other seats are no longer gated by the tutorial's steps.
- A move's `expectStep` names the learner's step, whichever seat moves.
- A `learnerSeat` other than the seat that opens the game now gets the opening
  turn, as on the server: drop scripted moves for the seats before it.

## `review-gate` reads what is under review from the run log (#829)

`boardsmith review-gate` no longer takes `--since` or `--work-role`. It reads
the chunk's run log, `design/run-log/<slug>.md`: the change under review is
everything since the commit the latest finished review round names in its
`Verify:` line (the chunk's verify base before any round), and it counts as
mechanical only when every dispatch logged since that round has
`Role: mechanical`. Drop both flags from any script or skill that passes them,
and keep the run log current before the gate runs.

## `toDebugString` drops the unused `showHidden` option (#913)

`DebugStringOptions.showHidden` is removed; it was never read. Delete it from
any `toDebugString(game, { ... })` call. The "Current Player" line now reads
`(seat N)` instead of `(position undefined)`.

## The game-over card has no New Game or Rematch button (#902)

GameShell's game-over card and controls menu no longer offer New Game or
Rematch, and the `#game-over` slot no longer passes `rematch` or `newGame`.
Starting another game belongs to the host that started this one. A game whose
`#game-over` slot used either prop must drop the button that called it.

## Chunk work runs `boardsmith verify --chunk <slug>`, with no selection (#985)

`boardsmith verify --selection <path>` is removed, and so is the `focused`
block a game's `.agent-policy.json` used to opt into it. A chunk's gates
(`chunk-signoff`, `review-gate`, `verify --check --chunk`) take only the
result of `boardsmith verify --chunk <slug>`, which picks the chunk's own tests
itself: the test files it added or changed since it began, plus typecheck. It
needs no selection manifest. The full `boardsmith verify` runs once, before
`boardsmith publish`.

In a game that still uses either:

- Delete the `focused` block from `.agent-policy.json`, and delete its selection
  manifest (such as `.agent-policy-tests.json`).
- Replace `boardsmith verify --chunk <slug> --selection <path>` (or
  `boardsmith verify --selection <path>`) with `boardsmith verify --chunk <slug>`.
- A chunk that adds no test of its own must mark itself exempt in its Spec
  Manifest with the row `| exempt | <reason> | n/a |`, or `verify --chunk`
  refuses it.

A run log's `Scope:` field and a MERGE-SIGNOFFS.md entry's `Scope:` and
`Selection:` lines are no longer written or read. Leave old ones in place.
Sign-offs no longer record an `Equivalence:` line, and chunk merges no longer
check one: mutant equivalences are proven and checked at publish.

## `game.currentPlayer` comes from the flow (#780)

`game.currentPlayer` and `player.isCurrent()` now read the seat the flow is
running for: the `eachPlayer` seat, or the player an `actionStep` names.
`game.setCurrentPlayer()` and `player.setCurrent()` are removed, so a game that
called them stops type-checking. `game.currentPlayer` is `undefined` before the
flow starts, once it is complete, and while a simultaneous step is open (its
conditions included), since every seat acts there.

Replace a hand-set current player with the flow node that names the seat:

```diff
-  game.setCurrentPlayer(game.getPlayer(2)!);
-  // ...
-  actionStep({ actions: ['bid'] }),
+  actionStep({ player: (ctx) => ctx.game.getPlayer(2)!, actions: ['bid'] }),
```

For a turn per seat, use `eachPlayer({ do: ... })` (with `TurnOrder.CONTINUE`
to start from the seat the flow last ran for).

## Historical run logs keep their unrecorded routing facts (#710)

The run-log template before #454 requested `Pipeline`, dispatch and finish times,
`Outcome`, and `Detail`. It did not request `Work`, `Role`, or `Agent`.
Leave those original entries unchanged. `boardsmith ledger-check` recognizes an
old-template dispatch when it has a nonempty `Pipeline`, none of `Work`, `Role`,
`Agent`, `Retry of`, or `Designer answer`, and git blame dates its heading,
`Pipeline`, and `Dispatched at` lines before #454 reached main:
`2026-10-01T02:32:39Z` (commit `8387a9a1`). Keep that git history available.

Missing routing metadata means **unrecorded**, not that an agent was launched.
An original `Detail: never launched: ...` records that no launch occurred; retain
it. Never fill in a role or agent from old dispatch instructions, a current agent
mapping, or commit coauthors. This check does not infer those facts or rewrite
the log. Its timestamp, ordering, duplicate-number, and citation checks still run.

Every new dispatch, including one appended to an old log, requires the current
`Work`, `Role`, and actual `Agent`. A backdated `Dispatched at` does not qualify:
the check uses git commit times, not the timestamp's value. Untracked entries
and entries with any current routing fields are checked under the current rules.
Historical entries supply no role or retry count to the current routing ladder.
A new retry or review cannot name one as its routing source; record the current
work in a new dispatch under the current rules before retrying or reviewing it.

## `boardsmith publish` requires a full `boardsmith verify` (#984)

`boardsmith publish` now refuses unless a full `boardsmith verify` passed for
the commit being published, on a clean tree, with its mutation check measured
from the last published commit (the repository's first commit before any
publish). Commit your work and run the `boardsmith verify --base <sha>` the
refusal names, then publish again. There is no skip flag.

## `boardsmith publish` keeps ids per platform (#704)

`boardsmith publish` used to keep one `gameId` and `publisherId` at the top of
`boardsmith.json` for every platform, so a `--prod` publish sent dev's ids to
prod and then overwrote them. Each platform now has its own block, and
`boardsmith validate` and `boardsmith publish` refuse the top-level keys. Move
them under the platform that gave them:

```diff
-  "gameId": "j97...",
-  "publisherId": "jd7...",
+  "platforms": {
+    "prod": { "gameId": "j97...", "publisherId": "jd7..." }
+  },
```

If you do not know which platform they came from, delete both and publish
again with `--dev` or `--prod` and `--publisher <slug>`; the platform finds the
game by its slug under that publisher and the ids are saved under the right
block.

## A `chooseFrom` callback receives the value, and `label` is the one label key

A `chooseFrom` choice is a value, or `{ value, label }` to give the value its own
label. Every callback after `choices` (`disabled`, `display`, `boardRefs`,
`validate`, `onSelect`) and `execute` now receive the **value**, and the arg is
typed as it (#509). Only an object whose keys are `value` and an optional string
`label` is read that way; any other object arrives whole. A game written against
the old rules changes in five places:

- **`display` becomes `label` on a choice object.** `{ value, display }` is now an
  ordinary object: it arrives whole and the panel shows it as JSON.

  ```diff
  -  choices: parts.map((p) => ({ value: p.id, display: p.title })),
  +  choices: parts.map((p) => ({ value: p.id, label: p.title })),
  ```

- **Read the value, not `choice.value`, in a callback.** `disabled`, `boardRefs`
  and `display` used to receive the whole choice object; they receive its value,
  as `validate` and `execute` always did. Drop the casts that papered over it.

  ```diff
  -  boardRefs: (choice: { value: number; display: string }) => refsFor(choice.value),
  +  boardRefs: (seat) => refsFor(seat),
  -  const seat = args.target as unknown as number;
  +  const seat = args.target;
  ```

- **`playerChoices()` returns `{ value: seat, label: name }`**, so its arg is the
  seat number. A test or custom UI that submitted `{ value: seat, display: name }`
  submits the seat.
- **`fill()` no longer unwraps a choice object.** Pass `choice.value`; the whole
  `{ value, display }` choice from `getChoices()` is refused like any value that is
  not on offer.
- **A function-valued `multiSelect` or `orderedList` returns a count.** It used to
  be allowed to return `undefined` for "single after all", which made the arg an
  array in some states and a bare value in others. It is now a type error and is
  refused at run time, naming the selection. Return `{ min: 1, max: 1 }` and read
  an array of one. Declaring either option types the arg as an array.
- **A repeating pick's `nextChoices` are labelled choices.** A selection step
  on a repeating `chooseFrom` used to return the next pass's choices as bare
  values, so every pass after the first lost its labels. It now returns
  `{ value, display }` choices, labelled as the first pass's were. A custom UI
  that read `pickStep`'s `nextChoices` reads `choice.value` and `choice.display`.

## The game context's turn signals follow time travel; `usePlayContext()` works in a world

The game context now carries `isViewingHistory`, and while the debug panel shows
history its `isMyTurn` is false and its `availableActions` empty, matching the
board's props (#520). A component that read the live values from the context to
offer controls during a browse now withdraws them, which is the point: those
controls could not commit.

A component shared between a table and a world reads `usePlayContext()` instead of
raw `inject(GAME_CONTEXT_KEYS.<field>)` calls. `tryUseGameContext()` returns
`undefined` in a world instead of throwing.

## `boardsmith/testing` has one way to do each thing

`boardsmith/testing` dropped the exports that duplicated another one or that
nothing used (#517, #518, #519). A game test that imports one of them stops
type-checking. Replace each as follows:

| Removed | Use instead |
|---|---|
| `assertActionSucceeds(g, seat, action, args)` | `g.doAction(seat, action, args)`, which throws with the availability trace, flow position and seed |
| `simulateAction(g, seat, action, args)` | `g.tryAction(seat, action, args)`; the result no longer echoes `action` / `playerSeat` / `args` |
| `simulateActions(g, steps)` | a loop of `g.tryAction(...)` |
| `SimulateActionResult` | `ActionExecutionResult` from `boardsmith/runtime` |
| `playUntilComplete(g)`, `GameStuckError`, `PlayUntilCompleteOptions` | `simulateRandomGames(GameClass, { ... })` or `replayRandomGame(...)`; for a test about `enumerateLegalMoves` itself, a short loop over it with `doAction` |
| `assertFlowState(g, { ... })`, `ExpectedFlowState`, `FlowStateAssertionResult` | `assertActionAvailable` / `assertActionNotAvailable`, or read `g.getFlowState()` |
| `assertGameFinished(g, { winner })` | `expect(g.isComplete()).toBe(true)` and `g.getWinners()` |
| `getVisibleElements(game, seat)`, `testGame.getVisibleElements(seat)` | `game.all(...).filter((e) => isElementVisible(e, seat))` |
| `testGame.isElementVisible(el, seat)` | the standalone `isElementVisible(el, seat)` |
| `assertTutorialStep(...)` | `assertTutorialCompletes(result)`, or `result.finalStepId` |
| `viewPlayerRef(...)`, `assertViewFixtureShape(...)`, `ViewPlayerRef` | capture a real view with `testGame.getPlayerView(seat)` or `renderAsSeat` instead of building one by hand |

`assertActionFails` now returns an `ActionExecutionResult`. The random
simulator now asks the engine's `dueSeats` which seats may act, the same rule
every host uses, so a simultaneous step is never played for a stale
`currentPlayer`.

## GameShell's `providesOwnGameOverUI` is now `providesOwnGameOverUi`

Written in kebab-case, `provides-own-game-over-ui` camelized to
`providesOwnGameOverUi`, which was not the prop's name, so Vue passed it
through as a plain attribute and the shell still drew its game-over card
(#433). The prop is renamed so both forms reach it. A game still passing the
old name gets the same silent miss, so rename it:

```diff
-  <GameShell :providesOwnGameOverUI="true" ...>
+  <GameShell provides-own-game-over-ui ...>
```

Every prop of a component exported from `boardsmith/ui`,
`boardsmith/ui/auto-ui` or `boardsmith/ui/dice` now has to survive that round
trip; `src/ui/public-prop-names.test.ts` fails on one that does not.

## Engine contract r106: a test wires a table's actions with `useTableActionWiring`

Contract r106 (#356) replaced `useBoardActionBridge`'s `restoreEpoch` option
with `runnerIdentity` (`{ gameInstanceId, restoreEpoch }`), so a new game tears
down an open pick the way an undo does. That change shipped with no note here,
and every game test that wired `useActionController` and `useBoardActionBridge`
together stopped type-checking (TS2353, `'restoreEpoch' does not exist`) (#378).

The fix is not the new option name. A game should never have been passing
either: which state fields the bridge reads is the engine's business. So
`useBoardActionBridge` is no longer exported from `boardsmith/ui`, and
`useTableActionWiring` takes its place. It builds the controller and the bridge
from the seat's `PlayerGameState`, reading the action metadata, disabled
reasons, tutorial step and runner identity itself, and GameShell wires its own
actions with the same function.

```diff
-  const controller = useActionController({
-    sendAction, availableActions, actionMetadata, isMyTurn, disabledActions,
-    playerSeat: ref(seat), autoFill: true, autoExecute: true, fetchPickChoices,
-  });
-  useBoardActionBridge({
-    controller, boardInteraction: board, isMyTurn, autoEndTurn: ref(true),
-    actionMetadata, availableActions, disabledActions, isViewingHistory: ref(false),
-    restoreEpoch: computed(() => state.value.restoreEpoch),
-  });
+  const { controller, actionMetadata, disabledActions } = useTableActionWiring({
+    seatState: state,                     // Ref<PlayerGameState>
+    availableActions: computed(() => state.value.availableActions ?? []),
+    isMyTurn: computed(() => state.value.isMyTurn),
+    playerSeat: ref(seat),
+    boardInteraction: board,
+    autoEndTurn: ref(true),
+    isViewingHistory: ref(false),
+    sendAction, fetchPickChoices,
+  });
```

`autoFill` and `autoExecute` are gone from the call: a table auto-fills when
`autoEndTurn` is on and always executes once every pick is filled, as GameShell
always has. Pass the returned `actionMetadata` and `disabledActions` to an
`ActionPanel` you mount beside the board. `src/cli/slash-command/bs/build/test.md`
(the a11y floor, item 1) has the whole test shape.

## Engine contract r17 → r23

A run of upstream fixes. Most need nothing from a game; these four do.

### The game context is provided under typed keys, not strings (r21)

`GameShell` used to `provide()` its twelve context values under bare string keys
while the library's own composables used typed `InjectionKey` symbols, so every
consumer cast and a misspelled key was a silent `undefined`. The string keys are
gone.

A game only feels this if it mounts a BoardSmith component directly — the
common case is an a11y test mounting the real `ActionPanel`, which throws when
it cannot find a controller:

```diff
-  global: { provide: { actionController: controller } }
+  global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } }
```

```typescript
import { GAME_CONTEXT_KEYS } from 'boardsmith/ui';
```

A custom UI reading the context should use `useGameContext()`, which throws
outside a shell rather than returning a bag of `undefined`s:

```typescript
import { useGameContext } from 'boardsmith/ui';
const { gameView, playerSeat, actionController } = useGameContext();
```

### `boardsmith publish` requires a target (r18)

There is no default, because the default used to be production:

```diff
-boardsmith publish
+boardsmith publish --prod    # or --dev
```

### `--bot-level expert` is rejected (r18)

It was never a real preset and silently played at medium. Use `easy`, `medium`,
`hard`, or an explicit iteration count.

### Authoring mistakes now throw (r18)

Four things that used to warn and carry on:

- an attribute that clobbers `id`/`_t`/`_ctx` in `create()`
- an action `condition` that throws (it was read as "condition false", so the
  action silently vanished)
- a flow step naming an action that is not registered
- detected element-tree corruption, at dev/test time

Each was already a bug; the change is that it stops rather than degrades. A game
that was relying on any of them was not doing what it looked like it was doing.

## v4.4: Agent-Ergonomics

v4.4 closes the determinism guarantee (no `Math.random` fallback anywhere in
the engine) and adds the FLOW/VIS/SIM/ERR/DRIVE/ANIM agent-ergonomics
surface documented in [Agent Control](./agent-control.md),
[boardsmith/testing](./api/testing.md), and
[Custom UI Guide](./custom-ui-guide.md). This section lists every
removed/changed API.

### What Changed

- The headless test-harness module moved and lost its old import path.
- `ElementCollection.shuffle()` now requires an explicit RNG argument — no
  silent `Math.random()` fallback.
- Animation helpers (`useFLIP`, `useFlyingElements`)
  now fail loud in development when a target element has no anchor
  attribute, instead of silently no-oping.
- `onPersistenceError` gained two additional arguments.
- `anchorAttrs()` gained a second parameter.

### Step 1: Update the headless test-harness import

```typescript
// Before — internal, test-only module path (never a public package export)
import { createHeadlessSession } from './session/testing/headless-harness.js';

// After — public export from boardsmith/testing (boardsmith/session before r196)
import { createHeadlessSession } from 'boardsmith/testing';
```

The old module (`src/session/testing/headless-harness.ts`) is deleted — there
is no re-export shim at the old path. This only affects code that imported
the internal module directly by relative path; it was never part of a public
subpath export.

### Step 2: Pass an explicit RNG to `ElementCollection.shuffle()`

```typescript
// Before (implicit Math.random() fallback)
someCollection.shuffle();

// After — pass the game's seeded RNG explicitly (same as Space/Deck's own
// shuffle() wrapper already does internally)
someCollection.shuffle(game.random);
```

If you were shuffling a `Deck`/`Space` via its own `.shuffle()` method
(no arguments), nothing changes — that wrapper already threads `game.random`
through internally and was never affected by this break. This change only
affects direct callers of the lower-level `ElementCollection.shuffle(random)`.

### Step 3: Animation helpers fail loud on missing anchors

```typescript
// Before — a custom board element missing data-bs-el-id silently failed to
// animate, with no visible signal during development.

// After — the same gap throws an actionable dev-only error naming the
// composable, the attribute searched for, and the fix. Production builds
// still degrade gracefully (console.error + skip), matching prior behavior.
```

Fix by spreading `anchorAttrs(ref, type)` (or `useSelectable()`'s `attrs`)
onto every animated/draggable board element — see
[Custom UI Guide: Anchor Requirements & Fail-Loud](./custom-ui-guide.md#anchor-requirements--fail-loud-animation).

### Step 4: `onPersistenceError` signature change

```typescript
// Before
onPersistenceError?: (error: PersistenceErrorEntry) => void;

// After — two additional arguments: a running consecutive-failure count and
// a `healthy` flag (flips false after 3 consecutive failures, recovers on
// the next successful save)
onPersistenceError?: (
  error: PersistenceErrorEntry,
  consecutiveFailures: number,
  healthy: boolean,
) => void;
```

See [Agent Control: Structured Errors (ERR)](./agent-control.md#structured-errors-err)
for the full `persistenceHealthy`/`lastPersistenceError` observable-state
story this enables.

### Step 5: `anchorAttrs()` signature change

```typescript
// Before
anchorAttrs(ref: ElementRef): Record<string, string>;

// After — optional `type` label for the missing-anchor dev warning's
// dedup key (defaults to 'unknown' when omitted, preserving prior behavior)
anchorAttrs(ref: ElementRef, type: string = 'unknown'): Record<string, string>;
```

Existing single-argument call sites keep working unchanged. Pass a `type`
(e.g. `'card'`, `'piece'`, `'grid-cell'`) from renderer components so a
missing-anchor bug in your board names the actual component, not a generic
`'unknown'` bucket shared by every board element.

### Checklist

- [ ] Update `createHeadlessSession` imports from `boardsmith/session/testing/headless-harness` to `boardsmith/testing`
- [ ] Pass an explicit RNG to any direct `ElementCollection.shuffle()` calls (not `Deck`/`Space.shuffle()` — that wrapper is unaffected)
- [ ] Spread `anchorAttrs(ref, type)` (or `useSelectable()`'s `attrs`) onto every custom board element that animates or drag-drops
- [ ] Update any `onPersistenceError` callback to accept `(error, consecutiveFailures, healthy)`
- [ ] Pass a `type` label to `anchorAttrs()` calls in custom renderer components (optional but recommended)

## v3.0: Animation Timeline

v3.0 replaces the server-side theatre view system with a client-side animation timeline. Animation events are now pure data signals -- the server broadcasts truth immediately and never waits on animation playback.

For the complete list of removed APIs, see [BREAKING.md](../BREAKING.md).

### What Changed

The theatre view system (server-managed frozen snapshot, mutation capture, acknowledgment round-trips) has been removed entirely. In its place:

- **Pure data events:** Animation events carry only `type` and `data` -- no captured mutations.
- **Single truth view:** There is no theatre/current view split. `gameView` is always truth.
- **Client-owned playback:** The server broadcasts truth and moves on. The client processes events through a local FIFO queue.
- **Wait-for-handler:** Events pause for lazily-mounted handlers instead of being silently consumed.

### Step 1: Update `game.animate()` calls

**Remove empty callbacks:**

```typescript
// Before
game.animate('score', data, () => {});

// After
game.animate('score', data);
```

**Keep truth-advancing callbacks:**

```typescript
// Before
game.animate('score-complete', data, () => {
  this.addPoints(player, 10);
});

// After -- same (callbacks that advance game state are still supported)
game.animate('score-complete', data, () => {
  this.addPoints(player, 10);
});
```

Callbacks still run immediately as normal game code. The only change is that mutations inside the callback are NOT captured on the event.

**Remove mutation-capture patterns:**

```typescript
// Before -- mutations captured on event for theatre view
game.animate('combat', data, () => {
  target.putInto(graveyard);
});

// After -- mutations happen via normal code, event is pure data
game.animate('combat', data);
target.putInto(graveyard);
```

### Step 2: Update `createAnimationEvents()`

**Remove the `acknowledge` parameter:**

Before:

```typescript
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  acknowledge: (upToId) => {
    session.acknowledgeAnimations(playerSeat, upToId);
  },
});
```

After:

```typescript
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  handlerWaitTimeout: 3000, // optional, default 3s
});
```

### Step 3: Remove `useCurrentView()` usage

Before:

```typescript
import { useCurrentView } from 'boardsmith/ui';
const view = useCurrentView();
```

After:

```typescript
// useCurrentView is removed. Use gameView from GameShell directly.
// gameView is always truth -- there is no theatre/current split.
const { gameView } = props;
```

### Step 4: Remove theatre state references

Before:

```typescript
game.theatreState
game.theatreStateForPlayer(seat)
```

After:

```typescript
game.toJSON()            // truth is the only view
game.toJSONForPlayer(seat)
```

### Step 5: Update animation event handlers (optional skip support)

Animation handlers (`registerHandler`) work the same in v3.0. Handlers now receive an optional second argument `{ signal }` with an `AbortSignal` that fires when the user presses "Skip". Handlers can check `signal.aborted` between animation steps to bail out early:

```typescript
// Before (still works)
animations.registerHandler('combat', async (event) => {
  await playAttack(event.data);
  await showDamage(event.data);
});

// After (adds skip support)
animations.registerHandler('combat', async (event, { signal }) => {
  await playAttack(event.data);
  if (signal.aborted) return;
  await showDamage(event.data);
});
```

Existing handlers that don't use the signal still work — the queue will unblock immediately when skip is pressed regardless.

### New in v3.0: Wait-for-Handler

Events arriving before their handler registers now pause the queue (up to `handlerWaitTimeout`, default 3s) instead of being silently consumed. This prevents fire-and-forget event loss when components mount after events arrive.

If the timeout expires, a console warning names the event type and ID, and the event is skipped.

### Checklist

- [ ] Remove all empty `() => {}` callbacks from `game.animate()` calls
- [ ] Keep callbacks that advance game state (e.g., `addPoints()`, `remove()`)
- [ ] Remove `acknowledge` parameter from all `createAnimationEvents()` calls
- [ ] Replace `useCurrentView()` with `gameView` from GameShell props
- [ ] Remove any `game.theatreState` or `game.theatreStateForPlayer()` references
- [ ] Remove any `session.acknowledgeAnimations()` calls
- [ ] Remove any `acknowledgeAnimations` WebSocket message handling
- [ ] Update comments referencing "theatre view", "mutation capture", or "acknowledgment"
- [ ] Test all animation flows in browser after migration
