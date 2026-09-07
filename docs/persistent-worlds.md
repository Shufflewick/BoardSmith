# Persistent worlds

A **persistent world** is a game that runs continuously instead of as a match.
It seats its players as data rather than as a table's roster, keeps only the
part of itself somebody is looking at in memory, and is driven by commands and
scheduled events instead of turns.

This page is the authoring guide. Everything it describes is in this repository,
under `src/world/` and exported as **`boardsmith/world`**, and it is the same
module a hosting platform imports. One declaration that both an author and a
host import is the point: three world games hand-copying the same interface is
three places for it to drift, and it drifted.

## A world is the other backend, not a different engine

A **table** holds its whole element tree resident, snapshots after every action,
and keeps history, undo, bots and spectators.

A **world** keeps only named **partitions** resident, checkpoints exactly what a
command dirtied, and wakes itself on a schedule.

Same engine, same element tree. Different storage and checkpoint policy, the way
two storage engines sit under one database. What that buys is the cost model:
a command costs what the room costs, not what the world contains, and a
broadcast costs what its audience costs.

## What works today, and what does not

Read this before you plan your week.

- **The contract and the runtime are here, and they are complete.** `createWorld`
  builds a world from your bundle's own definition, runs genesis, dispatches
  commands, projects per-seat views, routes events, plans schedules and issues
  every refusal. You can drive all of it from an ordinary `vitest` file today.
- **`boardsmith dev` runs your world, on your laptop, with no network** (#167).
  It opens a durable local store beside `boardsmith.json`, runs your genesis
  once into it, walks each action's declaration a round at a time and hydrates
  what each round named before running the action, enumerates what each seat can
  do, projects `view(seat)` for each attached seat and pushes it when it changes,
  fires your scheduled events on their due time, and reports presence from the
  seats it has open. It serves your `world.html` -- and only that: a project that
  has not written one is GIVEN one (#170), the same two files
  `boardsmith init --world` scaffolds, so what you run locally is what production
  loads. Three controls exist because a person is watching: a **seat
  switcher**, so one author can be several players; **fire due events now**,
  which moves the world's clock forward to the instant the next event was due
  rather than making you wait for it; and **wake from parked**, which drops
  everything resident and rehydrates from the store.
- **It is the same library the hosting platform runs.** Same `createWorld`, same
  declaration walk, same schedule planning, same budgets, same refusals in the
  same sentences. What a host owns is its own lifecycle policy -- sockets,
  hibernation, eviction timing, rate limits, the park ladder -- and the table
  further down this page says which is which.
- **`boardsmith build` ALWAYS builds a world's UI.** A project whose manifest
  declares `"backend": "world"` gets a second bundle mounting `WorldShell` over your
  `src/ui/uis.ts`, which is what a world loads on the hosting platform. It is
  emitted whether or not you wrote the entry, because a host that reads "no
  `world.html`" as "this game ships no world UI" cannot tell that apart from a UI
  that failed to deploy (ShufflewickPub #128).
- **A world's verbs are Actions** (#169), so a world is enumerated, clickable
  from the board and drawn by the shared action panel. See the next section.

So the loop for writing a world is the loop for writing anything else: write the
rules, drive them from a test file against `createWorld`, open them in a browser
under `boardsmith dev`, and publish.

`boardsmith dev --reset` deletes the local world and runs genesis again. Nothing
else does: a persistent world that erased itself when its host stopped would be
a session, and closing the laptop is the one thing an author has to be able to
do.

## A world action is an Action

A world's verbs used to be a flat **command table**: a name, a prompt, and typed
arguments of kind `choice`, `number` or `text`. That was a second vocabulary for
something the engine already had, and it is why a world had no board clicks, no
accessible action panel, no move enumeration and no bots -- every one of those is
built over the engine's **Action** system, and a command was not one.

Since #169, a world action **is** an `ActionDefinition`. It is registered in the
same registry a table's action is registered in, reached through the same
`game.getAction`, and enumerated by the same machinery. What a world adds is one
optional block on the definition -- `world: { needs, seatless }` -- and you never
write it by hand: `worldAction()` and `worldClockAction()` produce it.

That one fact is what pays for everything below. The action panel, the board
bridge and the drag-drop targets are written against `ActionMetadata`, and a
world's offer *is* `ActionMetadata`, so a world's surface is the shell rather
than something written beside it -- and a bot reaching a world action through
`getAction` has no world-only path to be taught.

The types that surrounded the old command table -- `WorldCommandHandler`,
`WorldCommandContext`, `WorldCommandArgument`, `WorldCommandOffer`,
`WorldCommandTable`, `WorldCommandChoice` -- are deleted from the library and
from every catalogue game. A bundle that hand-copied one deletes its copy rather
than adapting it.

Nothing else on this page changed with them: partitions, residency, genesis, the
dirty set, scopes, views, presence, the schedule semantics, the refusals and the
budgets are the model, and Actions do not touch any of them.

## Declaring a world

Two declarations, and neither repeats the other.

**`boardsmith.json`** declares which BACKEND runs this game:

```json
{ "name": "gloamhall", "backend": "world" }
```

**That declaration is what makes a game a world.** There is no `--world` flag
and no run-time choice, because a world is what a game *is*. `backend` is
required on every project and has no default: `"table"` holds the whole element
tree resident, snapshots per action, and keeps history, undo, bots and
spectators; `"world"` keeps only named partitions resident, checkpoints what a
command dirtied, and runs continuously.

There is no `world` *block* in `boardsmith.json`. What follows from the backend
is not written by hand anywhere: `boardsmith build` resolves it into the
manifest's `capabilities` object, and every reader — the shell, the CLI, the
publishing platform — reads that object rather than the backend's name.

**`gameDefinition.world`** implements it:

```ts
import type { GameDefinition } from 'boardsmith/session';

export const gameDefinition: GameDefinition = {
  gameClass: GloamhallGame,
  gameType: 'gloamhall',
  world: { maxPlayers: 200, stateVersion: 1, actions, view, genesis, presence },
};
```

`GameDefinition.world` is typed by `WorldDefinition` from `boardsmith/world`, so
you get the shape checked without importing anything extra. `maxPlayers`,
`actions` and `view` are required; `stateVersion`, `genesis` and `presence` are
optional.

**No `minPlayers`/`maxPlayers` on the definition.** Those are a *table's*
roster, and a world has none: it does not start, so there is no minimum to
reach, and a seat is assigned once and never handed on because a departed
player's holdings are still standing in the world. A world game that declared
them shipped a vestigial table half beside its world, and the game page led
with it. `boardsmith build` refuses one now, and it omits `playerCount` from
the manifest entirely — which is how the manifest says "this game has no
table".

`actions` is a plain array of `ActionDefinition`, and it is named here rather
than read off the game because a game class may register a **table's** actions in
its own constructor and those are not this world's verbs. What this list holds is
what a seat may be offered. `createWorld` registers it on the game for you, so
the game class must not register the same actions again; if it registers table
actions whose names collide, guard those with `if (!this.worldMode)`.

**`world.maxPlayers` is declared exactly once.** It lives in your compiled
rules, because that is the number a host actually seats against —
`worldSeatCount` reads it, and nothing that reads a manifest can see inside a
bundle. `boardsmith build` *derives* the manifest's copy from it, so the two
cannot disagree. They used to be two hand-written numbers, and only the
manifest's was ever checked at publish while only the code's was ever enforced
at run time.

A host also caps you: `budgets.maxPlayers` is the largest world that host is
prepared to keep resident, and a bundle declaring more is refused with
`bundle-not-a-world`.

### `world.stateVersion`: what your stored state MEANS

A live world is never rewritten when its bundle is replaced. Its partition bytes
and its queued schedule rows were written by the rules it launched under, and
the next version reads them as they are. A host compares what it can see —
element classes, clock actions, seat count — and refuses a version that dropped
one. What no host can see is a version that keeps every one of them and reads an
existing attribute, or an existing schedule row's frozen arguments, to *mean*
something new.

Only you know that, so only you can say it:

```ts
world: { maxPlayers: 200, stateVersion: 1, actions, view },
```

A whole number from 0 up. **Absent means 0**, and `boardsmith build` writes the
0 down — an absent declaration and an explicit `stateVersion: 0` produce exactly
the same manifest, so the default is a fact of the published bytes rather than a
convention each reader re-implements. A negative, fractional or non-numeric one
is refused with `bundle-not-a-world` at build.

Bump it when a new version reads a live world's stored state differently. Say
nothing more and a hosting platform refuses to move a running world onto it: that world plays
its season out on the rules it started under. Leave it alone and an upgrade is
judged on what the platform can check for itself. **Declare a migration and the
answer changes from "never" to "here is how"** -- see below. The declaration can only ever
refuse *more* than the platform would, never permit more, because the platform's
own comparison runs anyway.

**It is declared in your compiled rules and nowhere else**, exactly like
`maxPlayers`, and for the same reason: `boardsmith build` derives the manifest's
copy, so the number a platform checks and the number your rules state cannot
disagree. `boardsmith.json` has no `world` block at all, and putting one there
is refused by `boardsmith validate`.

## What the backend implies, and what you still declare

`boardsmith build` writes one `capabilities` object into `dist/manifest.json`:

| Capability | A table | A world |
| --- | --- | --- |
| `table` | true | false — no start, no minimum, no end |
| `world` | false | true |
| `undo` | true — the per-action snapshot is what it rewinds to | false — checkpoints on dirty, and a neighbour has already acted |
| `spectators` | true | false — a world projects a view per *seat* |
| `bots` | `gameDefinition.bot` exists | false — no turn, no terminal state to search toward |
| `asyncPlay` | your declared `asyncPlay` | true, always |
| `joinInProgress` | your declared `joinInProgress` | true, always |
| `crossSessionState` | your `gameDefinition.persistence` | true — the partitions *are* the state that survives |

`asyncPlay` and `joinInProgress` are the only two you write, in
`boardsmith.json`, and they are **table-only**: a world is always asynchronous
and always joinable in progress, so writing either on a world is refused rather
than quietly ignored. `bot` and `persistence` are no longer manifest keys at
all — they are read out of your compiled `gameDefinition`, so a manifest can no
longer claim a bot the bundle does not ship.

If a bundle's manifest declares a world and its compiled rules export no
`world.actions`, or no `world.view`, it is refused on the world's first wake with
`bundle-not-a-world`, in a message written for you rather than for whoever is
reading the log. That is the first moment anything *can* check.

## Genesis: the world a first player walks into

```ts
genesis?: (game: Game) => Record<string, GameElement>;
```

Only your game knows what a world contains before anybody has played it, so the
bundle is the authority. Create your elements in the live game and return them
**by partition name**. The host records where each one hangs; you never supply a
parent id, because the parent is outside the subtree and so is not in the
serialized bytes.

Genesis is optional. A world whose first command creates everything is a world,
and refusing it would be the library having an opinion about game design.

Genesis is all or nothing. A store checks every partition's name and size
before it writes any of them (`WorldPartitionWriter.createAll`), so a world
whose genesis names one partition it may not hold is refused outright rather
than left half-created and wedged forever.

### `world.createPartition`: a root built the first time somebody reaches for it

```ts
createPartition?: (game: Game, name: string) => GameElement | undefined;
```

Genesis runs once, at a world's first instant and never again, so without this
every root a world would ever need had to exist from the start: a 500-seat world
paid for 500 empires on the day it opened, and a world whose rooms are
discovered rather than laid out could not be written at all.

A host that looks for a declared partition and finds no stored row asks this
before refusing. Answer the **element** for a name this world creates on demand,
built on the game exactly as genesis builds one, and `undefined` for anything
else -- which keeps a mistyped partition name the loud `partition-missing`
refusal it has always been.

```ts
createPartition: (game, name) =>
  name.startsWith('empire:') ? game.create(Empire, name) : undefined,
```

It is idempotent without any effort on your part: it is reached only when the
store holds nothing for that name, and once built the root is resident and then
stored, so the second reach finds the first one's work. The row is written at
the moment the root is built rather than at the next checkpoint, so a command
that then refuses leaves an empty root rather than a root nothing recorded.

## An action: declare, then execute

Every world verb is an action built with `worldAction()`, and every one of them
declares which partitions each of its steps needs resident before it reads any of
them. That split is the whole cost model: a partition is absent until a
declaration names it, so a verb that could not say what it needs in advance would
have to be run against the whole world.

```ts
import { worldAction } from 'boardsmith/world';

export const tend = worldAction<VillageGame>('tend')
  .prompt("Spend a log putting timber back on a neighbour's land")
  // ROUND ONE: answered before any selection, with nothing resident.
  .needs(({ player }) => [holdingPartition(player.seat)])
  .disabled(({ game, player }) =>
    game.holdingOf(player.seat).woodpile < 1 ? 'You have no log to spend' : false,
  )
  .chooseElement('neighbour', {
    // THIS SELECTION'S ROUND: answered with round one resident.
    needs: ({ player }) => neighboursOf(player.seat).map(holdingPartition),
    // Evaluated with this selection's round resident.
    elements: ({ game, player }) => neighboursOf(player.seat).map((s) => game.holdingOf(s)),
    disabled: (holding) =>
      holding.standing >= STANDING_MAX ? 'Already at full growth' : false,
  })
  .execute(({ neighbour }, ctx) => {
    ctx.game.holdingOf(ctx.player.seat).woodpile -= 1;
    neighbour.standing += 2;
    ctx.world.emit(
      holdingPartition(neighbour.seat),
      { tended: 2 },
      `Seat ${ctx.player.seat} put timber back on your land.`,
    );
  });
```

The builder is the engine's own with every callback's context re-typed, so what
you write is a table action with `ctx.world` in scope and one method added:
`.needs()`. `prompt`, `help`, `condition`, `disabled`, `validate`, `manual`,
`suppressFromActionPanel`, `chooseFrom`, `chooseElement`, `enterText`,
`enterNumber`, `execute` and `build` all mean what they mean on a table. The
result is an ordinary `ActionDefinition`, which is why it needs no world-only
registry, panel or board bridge.

### The ordered declaration walk

The flat command table answered "what do I need?" with one
`partitions(args, seat, world)` function, asked repeatedly until it stopped
naming anything new. That is a **fixpoint**: it needed a round ceiling, and an
author who wrote a traversal instead of a declaration met a
`declaration-unsettled` refusal telling them so.

An action needs no fixpoint, because **an action is already ordered**. Its
selections are a sequence the engine resolves one step at a time, so its
declaration is a list of rounds written against those steps, in the author's own
order, with hydration in between:

| Where you write it | When it is asked | What is resident when it runs |
| --- | --- | --- |
| `.needs()` before any selection | round one | nothing, or whatever an earlier `.needs()` loaded |
| a selection's own `needs:` option | that selection's round | round one, and every earlier selection's round |
| `.needs()` after the last selection | the execute round | everything above |

**Round one is a pure function of the seat.** Nothing is loaded when it is asked,
so it can only be arithmetic on the acting seat and constants from your source.
That is enough for the common case: "my own holding" is a function of the seat,
and asking a player to name it would be a form with exactly one legal answer.

**A selection's own round is answered with round one in front of it,** which is
what lets it read what round one loaded. In `tend` above it does not need to --
the village ring is arithmetic -- but a world whose player location is itself
state depends on exactly this: name the index in round one, read the index, and
name the room it points at in the selection's round.

**The trailing `.needs()` is the execute round, and it exists for the partitions
`execute` writes that no candidate list ever mentioned.** The case that makes it
necessary is a move that can miss: sotf's navigate rolls, and *a declaration may
not roll*, so a jump that could land in any of four sectors must declare all four
even though the player only ever aimed at one. Without this round the action
would either roll inside its declaration -- which is refused, because a
declaration is asked more than once and a rolled declaration would answer
differently each time -- or write into a partition nothing checkpointed.

**This replaces the fixpoint for the write path, and it has no ceiling.** There
is no number to tune and no unsettled refusal to explain, because the walk's
length is the number of rounds you wrote, which is bounded by the action's own
selection count and read off its own source. A host supplies what a round names
and asks again; the loop ends when a round names nothing. There is no round you
are obliged to write: an action whose every partition was named in round one
writes no later round at all.

**`.needs()` may be chained, and two of them in the same position are two
rounds.** The second is answered with what the first loaded, and that is not a
convenience -- it is how a declaration whose subject is *itself state* gets
written by an action that asks no question. An action with a selection hangs its
second round on that selection; an action with none has only this place to write
it.

This is the shipped example, not a sketch of one. It is `look` in the Example
MUD, at `~/BoardSmithGames/example-mud/src/rules/world.ts`:

```ts
const theIndex = (): readonly string[] => [WANDERERS_PARTITION];

const theRoomTheIndexNames = ({ game, player }: WorldNeedsContext<HallGame>): readonly string[] => [
  roomPartition(standingKey(indexOf(game), player.seat)),
];

const look = worldAction<HallGame>('look')
  .manual()
  .needs(theIndex)              // round one: nothing is resident
  .needs(theRoomTheIndexNames)  // round two: reads what round one loaded
  .execute((_args, ctx) => { /* ... */ });
```

**`indexOf` throws when the register is absent, and that is the point.** Round
two is asked only once round one is resident, so an author writes the read
straight. The alternative -- one round that asks "is the index there yet?" and
names less when it is not -- is a fixpoint in disguise: a single round re-asked
until it stops changing its mind. The view path is allowed to be one, because a
view has no steps. **A write is not**, because `walkDeclaration` has no ceiling:
what bounds it is the number of rounds you wrote, and a round that re-answers
differently every time it is asked is not that number.

The same two rounds in a world whose seats are five hundred and whose rooms are
1,600: `look` in `~/BoardSmithGames/sotf/src/rules/world.ts`. There the first
round names the acting seat's own `Character`, and the second reads it for the
one sector out of 1,600 the report is about. A seat nobody has been made on
still HAS a `Character` -- `living: false` -- so the second round distinguishes
"nothing loaded this" from "nobody lives here" instead of answering the same way
to both.

Both are held by tests that fail if the chain folds back to one round, and again
if the second round guards its own read: `tests/world.test.ts` in the MUD and
`tests/world-look.test.ts` in sotf.

`tend` in `~/BoardSmithGames/example-rts/src/rules/world.ts` is the counterpart
worth reading next to them. It also declares in two rounds, but its second round
is arithmetic on the ring rather than a read of the first, so it would settle in
either order. That is the common case; the two above are the case this mechanism
exists for.

A round that names a step the action does not have is refused at construction
with `invalid-world-action`.

**A declaration may not write.** What it is handed is a read-only projection of
the game, and an assignment through it is refused with `declaration-write`. A
declaration runs before the rollback snapshot on the write path, and with no
snapshot at all on the read path, so nothing it writes could ever be
checkpointed: it would either survive an action the player was told was refused,
or be reverted at the next hibernation with nobody told. Do the write in
`execute`.

### Selections: what an action asks a player for

`WorldCommandArgument` is gone, and what replaces it is the engine's own
selections. There are four you may write:

- **`chooseElement(name, { elements, ... })`** -- one element off the board, from
  a list you compute. This is the one worlds existed without: a `Holding` *is* a
  `GameElement`, so the board bridge wires a click straight through with no
  `boardRefs` mapping to write, and the wire carries the two candidates the
  declaration named rather than the five hundred a static choice list would.
  `elements:` is **required**, and the searching form (`from`, `filter`,
  `elementClass`) is refused -- see the next section for why.
- **`chooseFrom(name, { choices, ... })`** -- a choice between values the game
  names, with `choices` precomputed for the same reason.
- **`enterNumber(name, { min, max, integer })`** -- a number, bounded where the
  game knows the bound, so a surface draws a stepper and "at least one log" is a
  fact the shell knows before anything is sent.
- **`enterText(name, { minLength, maxLength, pattern })`** -- free text.

Each of them takes `needs:` as its own declaration round, `optional:`, and
`disabled:` -- and `disabled:` is the one to reach for before `validate:`, for
the reason the next-but-one heading gives.

### `ctx.world`: what a world gives an action that a table cannot

`ActionContext` is `{ game, player, args }` and stays that: the table backend has
no clock and no partitions, and widening the shared context so a world could
reach its own facilities would put `now` on a surface where it means nothing. So
a world's facilities ride on one added property.

```ts
ctx.game       // your game class, typed
ctx.player     // the acting Player -- absent on a seatless action
ctx.args       // what the player sent

ctx.world.now                    // the host's stamped instant
ctx.world.timing                 // {due, missedCount} for a clock action, else null
ctx.world.presence               // ReadonlySet<number> of connected seats
ctx.world.partition(name)        // the resident root of a partition this walk declared
ctx.world.emit(scope, payload, line?) // narration, routed by scope
ctx.world.schedule(request)      // ask the host to wake this world later
ctx.world.cancel(key)            // ask the host to forget a keyed timer
ctx.world.complete()             // declare the season over
```

**`ctx.world.now` is the only clock you may read.** It is the host's stamped
arrival instant for a player's action, and a scheduled event's own `due` for one
the clock issued, so a world drained a week late computes exactly what a punctual
one would. `Date.now()` inside the isolate is the *execution* instant, which
diverges from the arrival instant exactly when the world is busy. And a time
arriving in `args` would be the client's, and a player who could name the time
would finish every timer the moment they started it.

**`ctx.world.timing`** is `null` for a player's action. For a scheduled event,
`due` is the scheduled instant, never the wall clock. `missedCount` is how many
occurrences of a recurrence got no call of their own and were folded into this
one; this call is not one of them, so integrate with `1 + timing.missedCount`. It
is `0` whenever the world kept up, so an action that never reads it is correct on
a healthy world.

**`ctx.world.presence`** is the set of seats holding at least one open connection
at this instant. Per seat, so a player with two tabs is present once. Derived at
the moment of the call and never stored, so a world woken hours after parking
sees whoever is actually there, usually nobody. It does not distinguish "left"
from "dropped and reconnecting": a world that wants durable consequences of
leaving writes them as state, through actions. Presence is not world state unless
an action deliberately makes it so.

**`ctx.world.partition(name)` is refused for a partition this walk did not
declare**, with `undeclared-partition`. Reaching a resident but undeclared
partition used to be possible through a global query, and it was silent: every
watcher saw the new value, the checkpoint never wrote it, and hibernation
reverted it. A cross-partition move travels on an element reference a declared
partition already holds; the engine tracks the re-parent whichever way the
reference was obtained.

Unlike the old `WorldCommandContext`, **`ctx.game` is here**, because an action's
`ctx.game` is the same live game its selections were enumerated against and
`chooseElement` hands you real elements. It does not widen what you may reach:
what an element you were *handed* lets you write is bounded by
`undeclared-partition` on the read side and by the dirty-set comparison on the
write side, exactly as before.

### `.disabled()`: grey it out with a reason, do not throw

A flat command handler could only refuse from inside `run`, which meant a surface
drew a button that looked available, the player pressed it, and the world said no
afterwards. An action has a channel for this and a world uses it:

- **`.disabled(ctx => string | false)`** on the action greys the whole verb with
  the reason. It is evaluated with empty args, so it can only ask about the seat
  and the world, which is exactly the question "may this player do this at all?".
  The reason travels to the client on the offer as `disabled`.
- **`disabled: (candidate, ctx) => string | false`** on a selection greys one
  candidate. A neighbour whose land is already at full growth is shown, greyed,
  with the reason, rather than accepted and refused afterwards.
- **`.condition()`** hides the action entirely, for a verb that is not merely
  unavailable but irrelevant here. Use it sparingly: a hidden verb teaches a
  player nothing, and a false condition also stops the offer walking that
  action's later rounds, so an irrelevant verb costs one predicate and no
  hydration.
- **`.validate()`** is still the whole-action gate, checked at submit with every
  selection resolved. It is the backstop, not the surface: anything `validate`
  can say, a player would rather have been told before they pressed anything.

### The refusal a player can only discover by trying

`.disabled()` covers everything the world can predict. What is left is the class
it cannot: a bank that overflows on the *amount* you chose, a trade that fails on
the *pair* you named. Those are refused from inside `execute`, by throwing -- and
the throw is what triggers the rollback that makes "refused" mean the world is
unchanged.

**Throw a `PlayerFacingError` and your sentence reaches the player. Throw
anything else and it does not.**

```ts
import { PlayerFacingError } from 'boardsmith';

class VillageRefusal extends PlayerFacingError {}

export const kindle = worldAction<VillageGame>('kindle')
  .needs(({ args }) => [String(args.holding)])
  .execute((args, ctx) => {
    const holding = ctx.world.partition(String(args.holding)) as Holding;
    if (holding.woodpile < Number(args.logs)) {
      throw new VillageRefusal(
        `Holding ${holding.seat} has ${holding.woodpile} logs and cannot burn ${args.logs}. Gather first.`,
      );
    }
    // ...
  });
```

A plain `Error` is replaced with *"The "kindle" action could not be completed
because of an error in the game's rules"* before it leaves the isolate, and that
is deliberate rather than an oversight (#47): a throw out of `execute` is as
likely to be an accidental `TypeError: Cannot read properties of undefined
(reading 'woodpile')` as a refusal, and that text leaks implementation detail
while telling the player nothing they can act on. The engine cannot tell the two
apart, so it asks you to. `PlayerFacingError` is how you say *this message was
written to be read*; the log names it whenever a sentence is dropped.

This is deliberately **not** a `WorldRefusal`. That table is the *platform's*
vocabulary and its codes drive a host's park ladder, so giving a game's own
refusal one would relabel every bug in a bundle's rules as one of the platform's
words (#169, #191). A game's refusal travels unclassified, as it always has --
what changed is only that it travels with its sentence intact.

The bar for the message is the one `PlayerFacingError` itself states: it must
name what to do next, and must never carry a stack trace, a file path, an
internal identifier, or the text of an exception you did not write.

### `worldClockAction()`: the clock's own verbs

```ts
import { worldClockAction } from 'boardsmith/world';

export const settleBurn = worldClockAction<VillageGame>('settleBurn')
  .prompt('The clock: a slow burn reaching the fire')
  // Seatless: the declaration reads `{ args, seat: null }`. There is no `player`.
  .needs(({ args }) => [COMMONS_PARTITION, String(args.holding)])
  .execute((args, ctx) => {
    const holding = ctx.world.partition(String(args.holding)) as Holding;
    const commons = ctx.world.partition(COMMONS_PARTITION) as Commons;
    commons.embers += holding.woodpile;
    holding.woodpile = 0;
    ctx.world.emit(COMMONS_PARTITION, { embers: commons.embers });
  });
```

This is what `clockOnly: true` used to mark, and the type says it now rather than
a boolean. A seatless action:

- **declares no selections.** A selection is a question and there is nobody to
  ask; a clock action runs when the event scheduled for it comes due, whether or
  not anybody is here. It takes its arguments from the schedule row. Declaring
  one is refused with `invalid-world-action` at construction.
- **has no `player`,** in its declaration or in its `execute` context. There is
  no synthetic clock seat standing in for one, because inventing a player is the
  kind of fallback that masks the real problem later: the flat table's
  `requireSeat` helpers existed precisely because a null seat could reach a
  handler that assumed one.
- **is left out of every seat's offer, and refused on submit** with
  `clock-only-command`. Both halves, and it must stay both: filtering alone would
  leave the rule enforceable only by the client, which is not a place a rule can
  live, and refusing alone would leave a dead button on the panel.

It has `prompt`, `needs` and `execute`, and nothing else -- there is nothing for
a condition or a disabled reason to speak to.

### Events, and what `scope` means

Events are **emitted**, not returned:

```ts
ctx.world.emit(roomPartition(here.key), { said: seat, text });
```

`scope` is what makes a broadcast cost what the room costs rather than what the
world contains. A scope is either:

- the reserved string **`"world"`**, meaning everybody seated in this world; or
- **the name of a partition this world currently has loaded**.

The engine resolves the scope into the seats that can see it, and the host's job
is a membership test against the seat behind each attached socket. You express
co-location by giving two players the same scope. Who can see a scope is the
engine's answer and not the game's: an action says where something happened, and
the world decides who was there. A scope that is neither the reserved word nor a
loaded partition is refused with `unknown-scope`: an event addressed to a place
nobody can be in reaches nobody, and it is better refused than delivered silently
to no one.

Nothing reads inside `payload`. It is yours.

### The line, which is what the shell says out loud

`emit`'s third argument is the sentence, and it is separate from `payload` for
the reason nothing reads `payload`: the shared shell's log would otherwise have
to print JSON, which is a debug console rather than chrome.

```ts
ctx.world.emit(roomPartition(here.key), { said: seat, text }, `${who} says: ${text}`);
ctx.world.emit(HEARTH, { lit: true }, { text: 'The hearth is lit.', type: 'highlight' });
```

A bare string or `{ text, type }` -- exactly what a table's `game.messages`
takes, because a world's log and a table's are the same log with two transports.
It is **optional, and absent means silence**: an event with no line moves the
board and says nothing, which is most events. `type` is presentation only; no
layer between your rules and the shell reads it as a rule.

The line goes to the same seats the event does. There is no way to say something
to a scope without emitting to it, which is the point: an audience is a fact
about the world, and the world is what resolves it.

**Events are a world's narration, and there is no second channel.** The game
root's message log lives outside every partition, so a checkpoint never persists
it and nobody who was not connected would ever see a `game.message()`. Anything
you want a player to be told, tell them with a scoped event.

`emit`, `schedule` and `complete` all refuse outside a real dispatch. An offer is
a question, and answering a question must not narrate a line, arm a timer or end
a season -- and it is the same boundary a bot needs, since a search rolls the
tree back many times inside one real dispatch and a schedule escapes the tree.

### What a dispatch returns to the host

`WorldCommandResult` carries the routed events, the **dirty set** (the partitions
whose serialized form changed, which is the engine's answer and not the host's
guess), any schedule requests, and `ending: "completed"` if the action called
`ctx.world.complete()`. An empty dirty set with a full event list is legal and
normal: an action that only tells people something changed nothing durable.

## What keeps enumeration O(view), and never O(world)

A world may not build a player view the way a table does, because that evaluates
every registered action's selections against whatever happens to be resident --
and what is resident is a fact about what every *other* player recently touched.
The measured shape of that mistake was 260 KB per view in a 500-seat village.
Enumeration is back since #169, and four rules are what make it affordable.
Three of them -- (a), (c) and (d) -- are refused with `invalid-world-action`;
(b) is refused with `undeclared-partition`, the same code the dispatch path
raises, because it is the same rule asked at a different moment.

**(a) The unbounded element form is refused.** An element selection must supply
`elements:`; `from`, `filter` and `elementClass` are not accepted. With
`elements` absent the engine resolves `from` (defaulting to the whole game) and
walks `all()`, filtering over every result. On a table that is a walk of the
board. In a world it is a walk of the resident tree, so such an action is not
merely slow, it is slow **non-deterministically** -- its cost is a function of
who else has been playing. Name your candidates instead, computed from what this
step's `needs` declared.

**(b) Every candidate must lie inside a partition that step declared.** Checked
at enumeration with the same predicate the dispatch path uses, because two copies
of a residency rule is exactly how a world comes to offer a player a choice its
own dispatch then refuses. It is a real guard and not a formality: everything a
candidate list can reach may well be resident already, in which case the
declaration is the *only* thing standing between the action and the whole
village. An element in no partition at all is refused too -- nothing would
checkpoint a write to it, so choosing it would change the world exactly until the
next hibernation.

**(c) `WorldBudgets.maxCandidatesPerSelection` caps a selection** (200 by
default), checked where the candidates are actually produced. This is the guard
the other two cannot supply: a 500-seat roster is one partition and one perfectly
honest declaration, and enumerating it yields 500 candidates. Every candidate is
evaluated on the read path, so an unbounded selection is paid by every watcher
rather than by whoever acted. Narrow it with an earlier selection -- offer the
exits of the room the player is in, not the rooms of the world.

**(d) A world action may not declare a dependent (`dependsOn`, `filterBy`) or
repeating (`repeat`, `repeatUntil`) selection.** A dependent selection asks the
engine to compute candidates for *every* value of the selection it depends on,
which in a world is a declaration and a hydration per candidate; a repeating one
round-trips once per iteration, and each trip is a declaration and a hydration.
The world protocol is single-shot, so an offer would have to carry the whole
product. The fix is **one action per shape** -- if a game wants kind-dependent
arguments, write an action per kind -- which is also what makes each one's
declaration honest. This is a consequence of the single-shot protocol rather than
a permanent law; a step-wise world protocol is #170.

**What none of this covers, and there is no guard for it.** A `condition` or a
`disabled` predicate is ordinary code with the resident tree in front of it, and
nothing stops one walking it. The four rules bound the *candidates*; they say
nothing about what a predicate does before returning `false`. Write those against
the partitions your declaration named and nothing else. This paragraph is the
whole of the enforcement.

## `offersFor(player, { now, presence })`: what a seat can do here

```ts
const offers = await runner.offersFor('alice', { now, presence: [1, 3] });
```

This replaces `commandOffers()`, and the difference is not a rename. The flat
table answered from the bundle's own static declaration and loaded nothing: it
could say `tend` exists and that it wants a holding, and the only holdings it
could name were all five hundred, because a bundle can state what a world
*contains* and not what is legal this instant. That is a JSON box wearing a
form's clothes.

What comes back is the seat's actions in the table's own **`ActionMetadata`**
shape -- the same shape the shared action panel, the board bridge and the
drag-drop targets already consume -- with an optional `disabled` reason added,
and **each selection's candidates already resolved**. `tend` offers the two
neighbouring holdings that exist right now, as element ids the board bridge wires
straight to a click.

**The candidates arrive with the offer rather than being fetched per pick**
because a world's protocol is single-shot where a table's is step-wise. That is
affordable exactly because rule (d) above holds: no selection's candidates are a
function of another's value, so the whole offer is one pass and there is no
product to enumerate.

Seatless actions are filtered out here. An action whose `condition` is false is
not offered, and neither is one whose non-optional selection has no candidates at
all -- with no dependent selections, "is there a legal path through this action"
is exactly "does every question it asks have at least one answer".

It costs `O(actions) x (condition + each selection's own candidates)`. There is
no term that scales with the world.

### What an offer costs to hydrate, and how to keep it free

An offer walks round one of every action the seat could be offered, then each
selection's round, hydrating as it goes. So **the offer's hydration cost is the
union of the actions' round-one declarations** -- and for every game in the
catalogue that union is a subset of what `world.view(seat)` already names. A seat
that has just looked at the world therefore pays **no storage read at all** for
its offer.

That is a property of how the games are written, not a guarantee the library
makes. If one of your actions declares in round one a partition your `view` omits,
every offer for every seat pays a hydration for it -- one read per action per
offer, on the read path, where it is paid by watchers rather than by whoever
acted. Either name it in the view as well, or move it to the selection's round if
the selection is what actually needs it.

The later rounds are the honest extra cost of enumerating. In the village,
`tend`'s selection round names the two neighbouring holdings, which the view does
not: two reads, and two however large the village gets. The execute round is
deliberately not walked, because an offer executes nothing.

Hosts drive this the same way they drive the write path:
`runner.declareOffers(player, supplied)` names what is still missing,
`runner.offersFor(player, stamp)` answers once everything is resident.

## `view(seat, world)`: what one seat sees

```ts
view: (seat, world) => readonly string[];
```

Required. It is the read path's counterpart to an action's declaration, and it is
required for the same reason: a game that never declared one and a game that
declared nothing must not look the same from outside. A world whose view needs no
partition writes `view: () => []`.

**A view is still a fixpoint, and it is the only thing that still is.** It is
asked, what it named is loaded, and it is asked again until it stops naming
anything new, so a look at the room a player is standing in names the index first
and reads the room from it on the next round. That loop cannot be bounded by the
declaration's own shape the way an action's walk can -- "what is this seat
looking at?" is answered by world state and genuinely has to be asked again -- so
it keeps a ceiling of **four** rounds, and a view that names something new every
round is walking the world and is refused with `declaration-unsettled`. Round one
sees `undefined` for every partition; keep naming what you already asked for,
because what is named on the final round is what gets loaded. A view whose first
round asks for nothing is never asked again, so the steady state costs one round.

It sees the same read-only projection an action's declaration does, and an
assignment through it is refused with `declaration-write`.

What the seat receives is `{ player, state, phase }`, where `state` is the
engine's own per-player projection, with its fog of war already applied, **pruned
to exactly the partitions this declaration named**. Pruning matters: residency is
everybody's doing, and a view built from the raw resident tree grew with the
world's popularity rather than with what the seat asked for. What a seat sees is
a function of its own declaration.

**The roster is pruned to the viewer too.** The game root's player list is in no
partition, so a 500-seat world used to ship 500 serialized `Player` elements in
every seat's view. A view carries the looking seat's own player and nobody
else's. Nothing dangles: a player-valued attribute serializes as
`{ __playerRef, seat, color, name }`, which resolves by seat and carries what a
board reads inline, so `holding.player` says everything it ever said. And there
was nothing else on those elements to carry -- a player is in no partition, so
nothing checkpoints a write to one. **Do not keep world state on a `Player`;**
put it in a partition, exactly as the candidate rule above already requires.

There is no turn, no message log and no available-action list inside a world's
view. A world's flow does not run, its narration is its events, and its verbs
arrive separately through `offersFor()` -- which is what lets a seat's offer be
enumerated at the moment it is asked for rather than baked into a projection.

## Presence

```ts
presence?: {
  onArrive?: string;
  onDepart?: string;
  departGraceMs?: number;
};
```

Each hook names a **seatless** action from your **own** action list -- one built
with `worldClockAction()` -- so an arrival or a departure is the clock issuing
one of your world's verbs. A world still has exactly one way to change. A player
who could send "seat 3 departed" would forge it; seatlessness is what makes that
structural.

The library types the declaration. What a host *does* with it is that host's
lifecycle policy: how long a departure's grace really is, whether a dropped
socket counts as a departure at all, whether presence is observable in the first
place. A laptop with one browser tab answers that differently from a platform
holding 500 sockets, and should.

## Scheduling

```ts
ctx.world.schedule({ delayMs, action, args?, key?, everyMs? });
```

A **request**, never an insertion. The queue belongs to the host, and your action
runs in a child isolate with no bindings, so the only thing it can do is ask. The
request rides home on the dispatch's result and the host stamps the owner from
the acting seat, enforces the caps and inserts. The abusive path cannot reach the
queue, rather than failing a check on the way in.

- **`delayMs`** is measured from `ctx.world.now`, so a world woken late schedules
  the instant a punctual one would. It is the delay the event actually fires at.
- **`action`** names one of this world's actions, and it must be a **seatless**
  one. A scheduled event is the clock issuing one of the world's verbs, not a
  second kind of thing a world can be told -- the clock and a player reach the
  same registry. It has nobody acting, so naming a seated action is refused
  rather than answered by inventing a player for it.
- **`args`** are the action's own, and they must be **JSON scalars**: a string, a
  number, a boolean or null. Never an element, an array or an object. A schedule
  row outlives eviction and rehydration, so a stored element id names an element
  that may not be resident when the event comes due -- or, worse, one that has
  been re-minted since, in which case the id silently names something else. Pass
  a **partition name** and let the action look inside it, which is what every
  clock verb in the catalogue already does.
- **`key`** makes it an **upsert**: it replaces the pending event with the same
  owner and key, so the count under one key never grows. This is the shape you
  should usually be writing, and it is why the cap refusal's first suggestion is
  to use one.
- **`everyMs`** makes it a **recurrence**. `delayMs` is the first occurrence,
  `everyMs` the gap between the rest, and the host re-arms it in the same write
  that settles the occurrence it just ran, so you never write the re-arm and
  cannot forget it. It costs **one queue row for the life of the world**, because
  the drain replaces its own event rather than adding beside it. A recurrence
  that fell behind is **caught up, not replayed**: a few real occurrences and
  then one coalesced call carrying `timing.missedCount`, which is what stops a
  world that was away for a week from delivering a week of notifications at once.

**A scheduled event costs a wake, so do not buy one you do not need.** If the
effect is only visible when somebody next looks, write a `completesAt` timestamp
from `ctx.world.now` and compute it on read. That costs nothing at all and the
world sleeps through the whole thing. This is the lazy half of the timer
primitive and it is the one you should reach for first.

`ctx.world.schedule()` **throws** when the request cannot be taken, at the
offending line, so the whole action unwinds and the player is told no over a
world that did not change.

### Taking a timer back

```ts
ctx.world.cancel("raid");
```

A request in exactly the same way, and the inverse of an arm. It forgets the
pending event this seat holds under that key.

- **Keyed, because a key is the only handle a cancel has.** A pending event is
  addressed by `(owner, key)`, and the owner is stamped from the acting seat --
  so a bundle can no more forget somebody else's timer than charge one to them.
  An **unkeyed event cannot be cancelled at all**, because it has no name to
  address it by. That is one more reason a keyed schedule is the shape to write,
  and it is why the unkeyed cap's first suggestion has always been to use a key.
- **Idempotent.** Cancelling a key nothing holds does nothing. A wake can always
  be late, and your handler cannot read the queue, so a cancel that refused what
  it could not find would unwind a perfectly good answer over a race the author
  can neither observe nor avoid.
- **It gives the budget back**, which is what makes the cap refusals' advice
  true: cancel a keyed timer and the key is free to be spent again in the same
  command.

**Cancel is what an obligation is built on.** The pattern is three parts and one
rule. The obligation is a field on an element **in the partition of the seat it
binds**, so partition fog is the whole fog rule. The deadline is **one keyed
schedule naming a seatless action**, cancelled when the seat answers first. And
the rule: **whoever arrives first clears the field, and the loser finds it
cleared and returns.** Every world action must tolerate arriving after the thing
it was armed for is gone, because a wake can always be late -- which is why the
cancel is idempotent rather than a refusal.

An arm and a cancel ride home on **one ordered list**, in the order your handler
wrote them: cancel-then-arm under one key leaves a timer, arm-then-cancel leaves
none.

## Ending a season

`ctx.world.complete()` declares this season over. It takes no argument, so it cannot
name any other ending: only the game may declare a completion, because if ending
a world counted as completing it, a publisher could end seasons on demand to
harvest verification. Every other way a world can stop, cancellation and parking
included, is the host's own answer about a world that stopped.

Calling it does not stop the action. `execute` runs to its end and its events and
dirty set are reported normally; what ends is the season, once the dispatch's
changes are durable.

### `world.migration`: how the old bytes become the new ones

A veto is the right answer for a change nobody can reconcile. It was the ONLY
answer, so a season anybody was in could never gain a feature -- however plainly
you could say how the old state becomes the new. A migration is that sentence:

```ts
world: {
  stateVersion: 2,
  migration: {
    from: 1,
    partition: (element, { name }) => { element.plots ??= []; },
    event: (queued) => ({ ...queued.args, tier: queued.args.tier ?? 1 }),
  },
  actions, view,
}
```

**One step, not a chain.** A world is migrated only when its own recorded
version is exactly `from`. A world two versions back is refused by name rather
than walked through migrations each written against a world you have not seen;
publish the intermediate version and upgrade twice, which is a thing you can see
the result of.

**Partitions and queued events, because those are the only two things a world
durably holds that outlive its rules.** `partition` is handed the element the
partition's stored bytes deserialized to under the NEW rules, and mutates it in
place. `event` is handed a queued event and answers the arguments the new
handler should see -- a frozen argument is as opaque to a host as a partition's
bytes, and means exactly as much to the new rules.

**And `create`, for the roots a version ADDS.** `partition` transforms a root
that exists; it cannot answer more roots and has nowhere to say what a new one
hangs from, so a world that outgrew its genesis -- twelve empires becoming five
hundred, one shared timeline becoming a region apiece -- had no expressible
upgrade at all.

```ts
migration: {
  from: 1,
  create: (game, { existing }) =>
    Object.fromEntries(
      range(1, 500)
        .map((n) => `empire:${n}`)
        .filter((name) => !existing.includes(name))
        .map((name) => [name, game.create(Empire, name)]),
    ),
}
```

`ctx.existing` is every partition name the world already holds, so being
idempotent is a filter rather than a convention -- and a name that is already
taken is refused by name rather than silently replacing a live partition's
stored bytes with a fresh element. The new roots land in the **same** write as
the transformed ones, so the whole upgrade is still one durable step.

A migration may not REMOVE a root. Deleting a season's stored bytes on a hook
whose failure mode is a typo is not something anything gives back.

**Changing `world.maxPlayers` across an upgrade needs no separate roster
migration.** The roster is the host's, not the bundle's: `maxPlayers` is read
from the compiled rules at construction and bounds who may sit down, so raising
it keeps every seated player exactly where they were and opens the seats above
them. What made that unsafe until #218 was ids rather than seats -- a player is
an element, so a world built for four seats and the same world built for forty
spent the id counter differently, and the wider construction minted ids the
world's stored partitions already held. A world's own elements are now minted
above a reserved floor (`Game#reserveConstructionIdSpace`), so construction and
storage cannot collide however the seat count moves. Lowering `maxPlayers` below a seat
somebody already holds is still refused, because a seat is where a player's
holdings are.

**It is not a command.** No clock, no schedule, no seat: a migration that could
schedule would be arming timers against a world whose own timers are mid-
transformation, and one that could act would be a command no seat sent.

**All of it, or none of it.** Every transformed partition, every queued event's
new arguments, and the version they are now written under commit together. A
migration that landed halfway is a world whose rooms disagree about which rules
wrote them, and unlike a checkpoint there is no retry that could finish it --
the second attempt would read bytes the first had already moved. `boardsmith
dev` gets that from one SQLite transaction; a host whose storage cannot do it
owes the same guarantee by its own means before it may claim this contract.

**If the migration throws, nothing happened.** The world stays on its old rules,
playable, and the failure is reported to whoever started the host.

Refused by name as `world-migration-unavailable`: a version gap with no
migration, a migration declared from a different version, and a bundle older
than the world. In every case the world is not changed.

`boardsmith build` writes `world.migratesFrom` into the manifest when you
declare one, and nothing else about it: a hosting platform decides whether an
upgrade may go ahead **before** it loads any bundle, and that one number is the
whole of what it needs at that moment. The migration itself stays in your rules,
where the elements are.

## An order that survives a lost reply

A player presses "found a colony". The command commits. The reply is lost on the
way back -- a dropped socket, a closed lid, a reload. The page cannot tell "it
never arrived" from "it arrived and I did not hear", and both of the things it
can do are wrong: pressing again founds a second colony, and not pressing again
loses one already paid for.

**The transport answers this, and your game does nothing.** Every player command
carries a `WorldOrder`: an id the page minted and wrote down durably *before*
sending, plus the instant it did so. A host records a **receipt** for every order
it commits, in the same durable write as that command's own effects. A repeat of
an order with a receipt is answered from the receipt -- the handler does not run,
and the offer is not re-enumerated, which matters because the first attempt is
exactly what consumed the candidates.

A repeat of an order that never committed simply runs. It cannot double-spend: an
attempt that had spent anything would have left a receipt.

**Recovery is automatic.** `WorldShell` keeps its unanswered orders in the
browser, scoped to the world's own surface, and re-sends them with the same
identity and the same arguments as soon as it is attached and seated. The player
is asked nothing and shown no sequence number; they are told what became of the
order, because "the colony you founded was already founded" is something they are
entitled to know before pressing anything.

**So do not build any of this into your game.** A `seq` selection on an action, a
game-owned receipt ledger, or a rule that keeps a consumed candidate alive so a
retry can reach it are all the same mistake: transport bookkeeping in a place the
player can see, on a surface the shared action panel will ask them about.

Receipts are bounded by `budgets.receiptRetentionMs` (a fortnight by default). A
repeat older than that is refused with `order-outcome-unknown` -- the one honest
answer, since its receipt may have been swept -- and the world is not changed.

## The refusals

Every way a world can refuse is in one table, `WORLD_REFUSALS`, and each entry
carries an **owner**. The owner is the fact, and it is the same on every host;
what a host *does* about it is that host's lifecycle policy. A platform typically
dead-letters one event for a game-owned refusal and parks the world after two
platform-owned ones. `boardsmith dev` parks nothing.

**`caller`**: one request refused; the world is fine and nothing is wrong with
your game.

| Code | What happened |
| --- | --- |
| `unknown-command` | A client named an action this world does not have. |
| `unknown-player` | A command named somebody this world does not seat. |
| `clock-only-command` | A player sent a seatless action -- one built with `worldClockAction()`, which the clock reaches and nobody else does. |
| `world-full` | A seating would exceed the bundle's own `maxPlayers`. Seats are assigned once and never handed on. |
| `seat-conflict` | A seating named a player who already holds a different seat. |
| `rate-limited` | A connection sent frames faster than the host accepts. Well-formed traffic, refused at the door. |
| `invalid-order` | A player command arrived with no usable order identity: no id, an id past 128 characters, or no mint instant. Every player command carries one -- see [an order that survives a lost reply](#an-order-that-survives-a-lost-reply). |
| `order-outcome-unknown` | A repeat arrived for an order minted before this world's receipt floor, so nothing can say whether it committed. Refused rather than run, because running it is the second spend the identity exists to prevent. |

**`game`**: your bundle's own doing. Fix these; the same bundle does the same
thing next time.

| Code | What happened |
| --- | --- |
| `bundle-not-a-world` | The manifest declares `"backend": "world"` and the compiled rules export no `world.actions`, no `world.view`, no `world.maxPlayers`, a `world.maxPlayers` the host will not seat, a `world.stateVersion` that is not a whole number from 0 up, or a `world.migration` that is not usable (no `from`, a `from` at or past this version, or a hook -- `partition`, `event` or `create` -- that is not a function). |
| `world-migration-unavailable` | A world's recorded `stateVersion` and its bundle's differ, and no migration in that bundle can cross the gap: none declared, one declared from a different version, or a bundle older than the world. Also a `create` hook whose answer is not `name -> element`, or that names a partition the world already holds. The world is not changed. |
| `invalid-world-action` | A world action the platform cannot offer or cannot bound: an action not built with `worldAction()`, an unbounded `from`/`filter`/`elementClass` element form, an element selection with no `elements:`, a candidate outside what the step declared, a selection past `maxCandidatesPerSelection`, a dependent or repeating selection, a seatless action that asks a question, or a round declared before a step the action does not have. |
| `not-in-a-world` | An action built with `worldAction()` reached `ctx.world` with no world running it -- registered on a table, or reached after the dispatch that bound its facilities finished. |
| `undeclared-partition` | `execute` read a partition the action's own walk did not declare. |
| `declaration-unsettled` | A `world.view` named something new on every round. **A view only**, since an action's walk has no ceiling to trip. |
| `declaration-write` | A declaration tried to write through the read-only projection. Do it in `execute`. |
| `unknown-scope` | An event was addressed to something that is neither `"world"` nor a loaded partition. |
| `partition-missing` | A declaration named a partition this world's store does not have, and `world.createPartition` did not build one for that name either. Usually a typo, or a partition nothing has created yet. |
| `invalid-partition-name` | A partition name a store may not hold: empty, over 128 characters, outside `A-Za-z0-9._:@/-`, or one of `__proto__`, `constructor`, `prototype`. |
| `partition-too-large` | A partition serialized past `partitionMaxBytes`. The fix is to split it. See the next section. |
| `schedule-cap` | This owner's unkeyed pending events are at the cap. Use a key. |
| `schedule-key-cap` | This owner holds as many distinct keys as one owner may. Reuse a key rather than minting one per action. |
| `schedule-batch-cap` | One dispatch asked for more scheduled events than one may ask for. |
| `schedule-world-cap` | The world's whole queue is at its ceiling. |
| `invalid-schedule-delay` | A negative or non-finite `delayMs`. |
| `invalid-schedule-interval` | A non-positive or non-finite `everyMs`, which is a wake that re-arms instantly forever. |
| `invalid-schedule-command` | A schedule request that names no action, names a seated one, or carries an argument that is not a JSON scalar. |
| `invalid-schedule-cancel` | A cancel that names no key. A cancel is keyed the way arming is keyed, so a nameless one addresses nothing; cancelling a key nothing holds is a no-op rather than this. |
| `engine-not-world-mode` | The engine was built over a game that is not in world mode. |
| `child-timeout` | The bundle did not answer a host's call inside its deadline. |
**`platform`**: a host's own bookkeeping broke. Not yours to fix, and
deterministic, so a host with a park ladder parks on it:
`partition-not-resident`, `partition-vanished`, `checkpoint-unknown-partition`,
`unknown-child-op`, `child-generations-exhausted`, `world-engine-unavailable`.

**`infrastructure`**: a service the host depends on did not answer.
`bundle-store-unavailable` is the one code, and it repairs itself when the
service comes back. It costs the event nothing while it lasts.

**Your game's own refusals are not in this table, and should not be.** A rule
saying no is not a code a host's lifecycle policy reads; it is a sentence for the
player. Throw a `PlayerFacingError` and it reaches them verbatim -- see [the
refusal a player can only discover by
trying](#the-refusal-a-player-can-only-discover-by-trying).

An unclassified throw from inside your handler is treated as **`game`**. That
default is the safe one: the cost of being wrong is one dead-lettered event,
where the other direction lets a game bug park a live world.

## Budgets, and who sets them

`WorldBudgets` is one object, the library owns the numbers, and the **host**
chooses them by passing `budgets` to `createWorld`. Nothing enforces a ceiling it
was not passed, because a ceiling read rather than passed is one two hosts can
silently disagree about, and a laptop running different budgets from production
makes local behaviour a poor guide to published behaviour.

`worldBudgets()` with no argument gives you the defaults:

| Budget | Default | What it bounds |
| --- | --- | --- |
| `maxPlayers` | 500 | The largest world this host will keep resident. Also bounds the per-seat colour spread at 720. |
| `partitionMaxBytes` | 524288 (512 KiB) | One partition's serialized size, in UTF-8 bytes. A store checks it at genesis and at every checkpoint. |
| `maxUnkeyedPendingPerPlayer` | 32 | Unkeyed pending events one owner may hold. |
| `maxKeyedPendingPerPlayer` | 64 | Distinct keys one owner may hold. Deliberately larger, because a keyed timer is the shape you should be writing. |
| `maxSchedulesPerCommand` | derived: 96 | What one command may ask for. The sum of the two holding caps, so the largest fully admissible ask is everything one owner may hold. |
| `maxPendingEvents` | derived: 16000 | The whole world's queue. `maxPlayers` times the unkeyed cap. |
| `catchUpMaxRealIterations` | 4 | Real occurrences a late recurrence runs before the rest are coalesced into one call. |
| `drainBatch` | 200 | Due events one drain runs. A world still behind re-arms: overload degrades to latency, never refusal. |
| `maxCandidatesPerSelection` | 200 | Candidates one selection may offer, checked at enumeration. A 500-seat roster is one honest partition and one honest declaration, and enumerating it yields 500 candidates, so this is the guard the declaration itself cannot supply. |
| `receiptRetentionMs` | 1209600000 (14 days) | How long a committed order's receipt is kept, and so how long a page may be away and still have an uncertain order answered rather than refused. |

Overriding a holding cap recomputes both derived fields, so a host that raises
`maxPlayers` gets a queue sized for it. Naming a derived field explicitly
overrides the derivation, which is the one way to get the two out of step and
therefore the one way that has to be deliberate. Every budget must be a whole
number greater than zero.

## Sizing a partition, which decides whether your world can exist at all

This is the paragraph to act on before you commit to a data model.

**An over-budget partition is not a world that degrades later. It is a world that
cannot be created.** The check runs at genesis as well as at every checkpoint,
and genesis is all or nothing, so a world whose index does not fit never gets
born. It is measured in UTF-8 bytes rather than characters, because that is what
storage holds: a room full of non-Latin names is up to three times larger than
its length suggests.

**Measure at `maxPlayers`, not at the roster you expect.** The busiest partition
in a 500-seat world is not the busiest partition in the twelve-player world you
are testing with. Two things in particular grow with the roster and are the ones
that overflow: any index that holds a row per seat, and whichever partition the
whole population can crowd into.

Write the measurement as a test in your own project. The worked example is
`~/BoardSmithGames/sotf/tests/world-budget.test.ts`, which builds every
partition at its seat cap, weighs each one with
`Buffer.byteLength(JSON.stringify(element.toJSON()))`, the same bytes a
checkpoint writes, and asserts each is inside the cap with headroom, and that
genesis finishes inside the time a host gives it.

The fix, when a partition is too large, is to **split it**. A partition is the
unit a world is loaded, checkpointed and evicted in, so smaller partitions are
also cheaper commands.

## What a host supplies, and what this library does

Everything in `boardsmith/world` is pure. Nothing reachable from it touches
`node:fs`, `cloudflare:workers`, a socket or a timer-driven clock, because a
hosting platform imports it inside a Worker bundle and a local host imports it
inside a Node process, and the two must get the same world. **Time arrives as an
argument** and **storage arrives as an interface**.

| This library owns | A host owns |
| --- | --- |
| What a world *is*: residency, the declaration walk, rollback baselines, the dirty set, per-seat views, event routing by scope | The session that holds a world in memory, sockets and transport |
| Genesis, seat assignment and the seat ceiling | Attach, authentication, who is allowed in |
| Schedule semantics: drift-free recurrence, keyed upserts, catch-up, the caps | The queue itself, the alarm that fires it, the drain |
| The partition-store *interface* (`WorldPartitionStore`, `WorldPartitionWriter`) and the naming and size rules every store must enforce | The store: a Durable Object's storage, a SQLite file, an in-memory map, its key layout and its atomicity |
| The refusal vocabulary and each refusal's owner | The consequence: dead letters, the park ladder, ending a season, rate limits, ejection |
| The read-only projection a declaration sees | Hibernation and eviction timing, the presence ledger, how long a grace is |
| The budgets, as parameters | Which budgets this host runs |

Two hosts keeping different lifecycle policy over one vocabulary is the
arrangement. Two vocabularies is what the refusal table exists to prevent.

## The engine's own share: `worldMode`

`GameOptions.worldMode` is the residency model itself, and it belongs to the
engine rather than to this module. A game constructed with it keeps only named
partitions in memory, reports which of them a move dirtied, and writes
`{ __elementId }` attribute references so a restored world does not resolve a
reference against a residency model that never wrote it. `definePartition`,
`adoptSubtree`, `evictSubtree` and `takeTouchedPartitions` are its API, and it is
documented in [core concepts](./core-concepts.md) under "Snapshot Mode and World
Mode".

It is declared at construction and is not switchable afterwards: in snapshot mode
an element reference serializes as a positional path, which resolves to the wrong
element once a partition is absent, and a game's subclass constructor builds its
furniture before any later switch could run. `createWorld` passes
`worldMode: true` for you.

## The panel never starts an action for the player (#212)

A table's board bridge auto-starts a seat's SOLE available action -- one obvious
move should not need two presses. A world does not do this, and the difference
is not a preference: a world's offer is enumerated over what one seat can SEE,
so "the only action" is a fact about a moment rather than an obvious next move.
A player who had just paid for a building was put straight back into choosing
another plot, and the surface read as an order they had never placed.

Entering an action in a world is always deliberate: the action panel's own
button, or a candidate on the board. A world has no turn to end either, so
nothing auto-executes at the end of one.

## Editing rules while a world is running (#201)

`boardsmith dev` loads your Node runtime once, before Vite starts, so your UI
edits hot-reload and your **rule** edits used to reach only the browser -- the
new surface acting on the rules the process loaded at startup, and the world
committing the result.

A rule edit is now a **coordinated reload**, and the order is the whole of the
safety:

1. **The new rules are loaded first.** A syntax error or a bundle that will not
   build fails here, and your world is still running, still playable, on the
   rules it had.
2. **The old world is stopped**, which checkpoints whatever its resident tree
   held -- nothing a command left in memory is lost with the isolate.
3. **The same world is opened again on the new rules.** Genesis does not re-run;
   a `stateVersion` bump is migrated or refused exactly as it is on a fresh
   start (see above). Your world, its seats, its holdings and its queue are the
   ones you were just playing.
4. **Every page reloads**, because Vite has hot-reloaded the UI in the same
   moment and a page that kept its socket would be new UI holding a seat in a
   world that has just been rebuilt.

If the new rules cannot run the world -- they declare a `stateVersion` with no
migration, or they are not a world at all -- the refusal is printed and
**nothing on disk changed**: the world is where the old host checkpointed it.

## Running a world today

**Under plain `npm test`, against the real runner.** This is the fastest loop
there is for writing a world's rules, and it is where a second world should
start:

```ts
import { createWorld } from 'boardsmith/world';
import { gameDefinition } from '../src/rules/index.js';

const { runner, seatCount } = createWorld({
  definition: gameDefinition,
  seed: 'a-fixed-seed',
  seats: new Map([['alice', 1], ['bob', 2]]),
});

// What a store would have to write. Genesis created these in the live game, so
// they are already resident in this instance.
const born = await runner.genesis();

// A host walks the declaration: ask what is missing, supply it, ask again. The
// loop ends when the walk names nothing. Everything genesis created is already
// here, so this first ask answers nothing at all.
const command = { name: 'tend', args: { neighbour: 7 } };
const { needs } = await runner.declare(command, 'alice', {});

const result = await runner.apply({
  player: 'alice',
  command,
  timing: null,
  arrivedAt: 1_800_000_000_000,
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  presence: [1],
});
// result.events, result.dirty, result.schedules, result.ending

const bytes = await runner.serialize([...result.dirty]);
```

`runner.declareOffers(player, supplied)` and `runner.offersFor(player, stamp)`
drive the offer path the same way, `runner.declareViews(...)` and
`runner.viewsFor(...)` drive the read path, and `runner.evict(names)` releases
partitions. `walkDeclaration(declare, read)` is the loop itself, exported so a
host writes it once rather than three times; `settleDeclaration` is the view's
fixpoint. Every refusal on this page is reachable from a test file.

The example worlds each drive their whole world contract from their own project
under plain `vitest`: `~/BoardSmithGames/example-mud/tests/world.test.ts` and
`~/BoardSmithGames/example-rts/tests/world.test.ts`. Both are written against
`boardsmith/world` itself, so the types they import are the ones this page
documents and the ones a host imports. `~/BoardSmithGames/example-rts/src/rules/world.ts`
is the shortest complete reading of everything above: four actions, one of them
the clock's own.

**On a hosting platform.** The world runtime a published world runs under is the
host's, built over this module.

**Under `boardsmith dev`.** The same module, driven by
`src/cli/dev-host/world-host.ts` over the durable store in
`src/cli/dev-host/world-store.ts`. Nothing about a world is decided there: the
host owns which sockets are open, when it checkpoints, and the two controls a
watching person needs, and the library owns everything else. That is what makes
"the same world here and in production" a property of the code rather than a
promise on this page.

**On a hosting platform.** The world runtime a published world runs under is the
host's, built over this module.

**Under `boardsmith dev`.** The same module, driven by
`src/cli/dev-host/world-host.ts` over the durable store in
`src/cli/dev-host/world-store.ts`. Nothing about a world is decided there: the
host owns which sockets are open, when it checkpoints, and the two controls a
watching person needs, and the library owns everything else. That is what makes
"the same world here and in production" a property of the code rather than a
promise on this page.
