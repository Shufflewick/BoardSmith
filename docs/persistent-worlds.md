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
- **No host in this repository runs a world yet.** `boardsmith dev` plays your
  project's **table** game, constructed with `worldMode: true`. It dispatches no
  world command, runs no genesis, projects no world view, fires no scheduled
  event and reports no presence. Issue #167 is the ticket that changes that;
  until it lands, a local browser session of your world does not exist.
- **`boardsmith build` does build a world's UI.** A project with a `world.html`
  entry gets a second bundle mounting `WorldShell`, which is what a world loads
  on the hosting platform. Building it is not running it.
- **The command surface is transitional.** See the next section.

So the loop for writing a world today is: write the rules, drive them from a
test file against `createWorld`, and publish to a host that has a world runtime.

## The transitional part, named up front

A world's verbs are a flat **command table** today. That is why a world has no
board clicks, no accessible action panel, no move enumeration and no bots: those
are all built over the engine's **Action** system, and a world does not use it.

Issue #169 replaces a world command with an Action. When it lands, these types
change shape or disappear:

| Type | What happens to it |
| --- | --- |
| `WorldCommandHandler` | Becomes an Action. `partitions()` becomes an ordered walk driven by the action's own selections. |
| `WorldCommandContext` | Replaced by the engine's action context. `now`, `timing`, `presence`, `schedule` and `complete` all survive in some form; `args` and `partition` change shape. |
| `WorldCommandArgument` | Replaced by a selection. |
| `WorldCommandOffer`, `commandOffers()` | Deleted. A world gets asked the same enumeration question a table is asked. |
| `WorldCommandTable`, and the `genesis` / `view` / `presence` signatures | Change with them. |
| `ScheduleRequest.command` | Renamed to `action`. A rename, not a concept: the clock and a player still reach the same registry. |
| `WorldCommandHandler.clockOnly` | Likely renamed rather than deleted. Under Actions the same fact is "this verb has no acting seat". |

The types are exported and marked rather than hidden, because a bundle has to
name the shape it exports, and hand-copying it is how the contract drifted in the
first place. Write against them. Expect one migration pass in which every
catalogue game is updated at once. The design for it is in issue #169.

Nothing else on this page is transitional: partitions, residency, genesis, the
dirty set, scopes, views, presence, the schedule semantics, the refusals and the
budgets are the model, and Actions do not change any of them.

## Declaring a world

Two declarations, and they must agree.

**`boardsmith.json`** declares the intent to the catalogue:

```json
{ "name": "gloamhall", "world": { "maxPlayers": 200 } }
```

**The block's existence is what makes a game a world.** There is no `--world`
flag and no run-time choice, because a world is what a game *is*.
`boardsmith validate` requires `maxPlayers` once the block exists: a world block
that declares nothing says nothing about the world.

**`gameDefinition.world`** implements it:

```ts
import type { GameDefinition } from 'boardsmith/session';

export const gameDefinition: GameDefinition = {
  gameClass: GloamhallGame,
  gameType: 'gloamhall',
  minPlayers: 1,
  maxPlayers: 200,
  world: { commands, view, genesis, presence },
};
```

`GameDefinition.world` is typed by `WorldDefinition` from `boardsmith/world`, so
you get the shape checked without importing anything extra. `commands` and
`view` are required; `genesis` and `presence` are optional.

**`maxPlayers` is declared twice on purpose.** The manifest's number is checked
at build time. The number a host actually seats against is
`gameDefinition.maxPlayers`, read out of your **compiled** rules by
`worldSeatCount`, because nothing that reads a manifest can see inside a bundle.
A hand-built bundle with a spotless manifest and `maxPlayers: 10_000_000` was
handed straight to `new GameClass({ playerCount })`, which is why the second door
exists. Keep the two the same.

A host also caps you: `budgets.maxPlayers` is the largest world that host is
prepared to keep resident, and a bundle declaring more is refused with
`bundle-not-a-world`.

If a bundle's manifest declares a world and its compiled rules export no
`world.commands`, or no `world.view`, it is refused on the world's first wake,
with a message written for you rather than for whoever is reading the log.
That is the first moment anything *can* check.

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

## A command: declare, then run

Every world verb is two functions, and the split is the whole cost model.

```ts
interface WorldCommandHandler {
  readonly args: readonly WorldCommandArgument[];
  readonly prompt?: string;
  readonly clockOnly?: boolean;
  partitions(
    args: Readonly<Record<string, unknown>>,
    seat: number | null,
    world: WorldResidency,
  ): readonly string[];
  run(context: WorldCommandContext): WorldEvents;
}
```

### `args`: what this command asks a player for

Required, and `args: []` is a legal answer. Making it explicit is what stops
"asks for nothing" and "never got round to declaring" from looking identical
from outside.

Three kinds, and no more, because each is a control a generic surface can
actually draw: `choice` (a select), `number` (a number field), `text` (a text
field). Anything else would put the free-text JSON box back under a new name.

A `choice`'s options are what the **game** can state without loading anything:
every kind of holding, every suit. Whether a particular option is legal *this
instant* is the handler's business, because the handler is the side with the
world in front of it. A surface that offered only what is legal right now would
have to load the world to draw a form.

Four declarations are refused at construction, with `invalid-command-args`,
because each produces a form whose every submission fails:

- an argument named `now`. That name is reserved: a client does not get to say
  what time it is, and a frame carrying one is refused before it runs. Read
  `ctx.now` instead.
- two arguments with one name.
- an argument with no name.
- a `choice` between nothing.

### `partitions(args, seat, world)`: what must be loaded

Answered **before** anything is loaded. That is what "absent until named" means:
a partition is not in memory until a declaration asks for it.

- `args` is the player's own frame.
- `seat` is the acting seat, or `null` when the clock is acting. A command that
  needs a seat and is handed `null` must say so by throwing. Use `seat` to name
  a player's own partition rather than making them pass it as an argument with
  exactly one legal answer.
- `world` is what an **earlier round** of this same declaration already loaded.

**Everything named on the last round is loaded, and is reported dirty whether or
not `run` wrote to it.**

**Two-phase declaration.** A world whose player location is itself state cannot
answer this in one go: to know which room a player's `look` is about, you must
first read a partition. So the declaration is asked again once what it named is
resident:

```ts
partitions: (args, seat, world) => {
  const index = world.partition('wanderers');
  if (!index) return ['wanderers'];            // round 1: nothing is resident
  return ['wanderers', roomPartitionFor(index, seat)];  // round 2: read it
},
```

Round one sees `undefined` for every partition. Keep naming what you already
asked for: what is named on the final round is what gets loaded.

A declaration is asked at most **four** times (`WORLD_DECLARATION_ROUNDS`).
Three is the deepest chain a declaration has a reason to have, and the fourth is
the round that comes back empty and proves it settled. A declaration that names
something new every round is walking the world rather than declaring, and is
refused with `declaration-unsettled`. A declaration whose first round asks for
nothing is never asked again, so the steady state costs one round.

**A declaration may not write.** What `world.partition(name)` hands you is a
read-only projection, and an assignment through it is refused with
`declaration-write`. A declaration runs before the rollback snapshot on the
write path, and with no snapshot at all on the read path, so nothing it writes
could ever be checkpointed: it would either survive a command the player was
told was refused, or be reverted at the next hibernation with nobody told. Do
the write in `run`.

### `run(context)`: change the world and say what happened

```ts
interface WorldCommandContext {
  readonly args: Readonly<Record<string, unknown>>;
  readonly seat: number | null;
  readonly now: number;
  readonly timing: { readonly due: number; readonly missedCount: number } | null;
  readonly presence: ReadonlySet<number>;
  partition(name: string): GameElement;
  schedule(request: ScheduleRequest): void;
  complete(): void;
}
```

**There is no `game`.** You read and write the world through `partition()`, and
only through partitions this command declared. Reaching a resident but
undeclared partition through a global query used to be possible, and it was
silent: every watcher saw the new value, the checkpoint never wrote it, and
hibernation reverted it. A cross-partition move travels on an element reference
a declared partition already holds; the engine tracks the re-parent whichever way
the reference was obtained. Reading an undeclared partition is refused with
`undeclared-partition`.

**`ctx.now` is the only clock you may read.** It is the platform's stamped
arrival instant for a player's command, and a scheduled event's own `due` for one
the clock issued, so a world drained a week late computes exactly what a punctual
one would. `Date.now()` inside the isolate is the execution instant, which
diverges from the arrival instant exactly when the world is busy. `args` is the
client's frame, and a player who could name the time would finish every timer the
moment they started it.

**`ctx.timing`** is `null` for a player's command. For a scheduled event, `due`
is the scheduled instant, never the wall clock. `missedCount` is how many
occurrences of a recurrence got no call of their own and were folded into this
one; this call is not one of them, so integrate with `1 + timing.missedCount`.
It is `0` whenever the world kept up, so a handler that never reads it is correct
on a healthy world.

**`ctx.presence`** is the set of seats holding at least one open connection at
this instant. Per seat, so a player with two tabs is present once. Derived at the
moment of the call and never stored, so a world woken hours after parking sees
whoever is actually there, usually nobody. It does not distinguish "left" from
"dropped and reconnecting": a world that wants durable consequences of leaving
writes them as state, through commands. Presence is not world state unless a
handler deliberately makes it so.

**`clockOnly: true`** marks a command as the clock's own. It is left out of
`commandOffers()`, so no surface draws a button for it, and a player's frame
naming it is refused at the door with `clock-only-command`, before any partition
is read. Both halves are needed: filtering alone would leave the rule enforceable
only by the client. It says nothing about what the command may *do*; whether a
due burn is legal this instant is still your judgement, made with the holding in
front of you.

### Events, and what `scope` means

`run` returns events:

```ts
return [{ scope: roomPartition(here.key), payload: { said: seat, text } }];
```

`scope` is what makes a broadcast cost what the room costs rather than what the
world contains. A scope is either:

- the reserved string **`"world"`**, meaning everybody seated in this world; or
- **the name of a partition this world currently has loaded**.

The engine resolves the scope into the seats that can see it, and the host's job
is a membership test against the seat behind each attached socket. You express
co-location by giving two players the same scope. A scope that is neither the
reserved word nor a loaded partition is refused with `unknown-scope`: an event
addressed to a place nobody can be in reaches nobody, and it is better refused
than delivered silently to no one.

Nothing reads inside `payload`. It is yours.

**Events are a world's narration, and there is no second channel.** The game
root's message log lives outside every partition, so a checkpoint never persists
it. Anything you want a player to be told, tell them with a scoped event.

### What a command returns to the host

`WorldCommandResult` carries the routed events, the **dirty set** (the partitions
whose serialized form changed, which is the engine's answer and not the host's
guess), any schedule requests, and `ending: "completed"` if the handler called
`ctx.complete()`. An empty dirty set with a full event list is legal and normal:
a command that only tells people something changed nothing durable.

## `view(seat, world)`: what one seat sees

```ts
view: (seat, world) => readonly string[];
```

Required. It is the read path's counterpart to `partitions()`, and it is
required for the same reason `args` is: a game that never declared one and a
game that declared nothing must not look the same from outside. A world whose
view needs no partition writes `view: () => []`.

It is answered with the same two-phase rule and the same read-only projection, so
a look at the room a player is standing in names the index first and reads the
room from it on the next round.

What the seat receives is `{ player, state, phase }`, where `state` is the
engine's own per-player projection, with its fog of war already applied, **pruned
to exactly the partitions this declaration named**. Pruning matters: residency is
everybody's doing, and a view built from the raw resident tree grew with the
world's popularity rather than with what the seat asked for. What a seat sees is
a function of its own declaration.

There is no turn, no available-action list and no message log in a world's view.
A world's flow does not run, its verbs come from `commandOffers()` rather than
from the tree, and its narration is its events.

## Presence

```ts
presence?: {
  onArrive?: string;
  onDepart?: string;
  departGraceMs?: number;
};
```

Each hook names a `clockOnly` command from your **own** command table, so an
arrival or a departure is the clock issuing one of your world's verbs. A world
still has exactly one way to change. A player who could send "seat 3 departed"
would forge it; `clockOnly` is what makes that structural.

The library types the declaration. What a host *does* with it is that host's
lifecycle policy: how long a departure's grace really is, whether a dropped
socket counts as a departure at all, whether presence is observable in the first
place. A laptop with one browser tab answers that differently from a platform
holding 500 sockets, and should.

## Scheduling

```ts
ctx.schedule({ delayMs, command, args?, key?, everyMs? });
```

A **request**, never an insertion. The queue belongs to the host, and your
handler runs in a child isolate with no bindings, so the only thing a handler can
do is ask. The request rides home on the command's result and the host stamps the
owner from the acting seat, enforces the caps and inserts. The abusive path
cannot reach the queue, rather than failing a check on the way in.

- **`delayMs`** is measured from `ctx.now`, so a world woken late schedules the
  instant a punctual one would. It is the delay the event actually fires at.
- **`command`** names a verb in your own command table. A scheduled event is the
  clock issuing one of the world's verbs, not a second kind of thing a world can
  be told. (Renamed to `action` by #169.)
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
from `ctx.now` and compute it on read. That costs nothing at all and the world
sleeps through the whole thing. This is the lazy half of the timer primitive and
it is the one you should reach for first.

`ctx.schedule()` **throws** when the request cannot be taken, at the offending
line, so the whole command unwinds and the player is told no over a world that
did not change.

## Ending a season

`ctx.complete()` declares this season over. It takes no argument, so it cannot
name any other ending: only the game may declare a completion, because if ending
a world counted as completing it, a publisher could end seasons on demand to
harvest verification. Every other way a world can stop, cancellation and parking
included, is the host's own answer about a world that stopped.

Calling it does not stop the command. The handler runs to its end and its events
and dirty set are reported normally; what ends is the season, once the command's
changes are durable.

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
| `unknown-command` | A client named a command this world does not have. |
| `unknown-player` | A command named somebody this world does not seat. |
| `clock-only-command` | A player sent a `clockOnly` command. |
| `world-full` | A seating would exceed the bundle's own `maxPlayers`. Seats are assigned once and never handed on. |
| `seat-conflict` | A seating named a player who already holds a different seat. |
| `rate-limited` | A connection sent frames faster than the host accepts. Well-formed traffic, refused at the door. |

**`game`**: your bundle's own doing. Fix these; the same bundle does the same
thing next time.

| Code | What happened |
| --- | --- |
| `bundle-not-a-world` | The manifest declares a world and the compiled rules export no `world.commands`, no `world.view`, or a `maxPlayers` the host will not seat. |
| `invalid-command-args` | An `args` declaration that cannot be drawn: a reserved `now`, a repeated name, a nameless argument, a choice between nothing, or a missing `args`. |
| `undeclared-partition` | `run` read a partition `partitions()` did not declare. |
| `declaration-unsettled` | A `partitions()` or `view` named something new on every round. |
| `declaration-write` | A declaration tried to write through the read-only projection. Do it in `run`. |
| `unknown-scope` | An event was addressed to something that is neither `"world"` nor a loaded partition. |
| `partition-missing` | A declaration named a partition this world's store does not have. Usually a typo, or a partition nothing has created yet. |
| `invalid-partition-name` | A partition name a store may not hold: empty, over 128 characters, outside `A-Za-z0-9._:@/-`, or one of `__proto__`, `constructor`, `prototype`. |
| `partition-too-large` | A partition serialized past `partitionMaxBytes`. The fix is to split it. See the next section. |
| `schedule-cap` | This owner's unkeyed pending events are at the cap. Use a key. |
| `schedule-key-cap` | This owner holds as many distinct keys as one owner may. Reuse a key rather than minting one per action. |
| `schedule-batch-cap` | One command asked for more scheduled events than a command may ask for. |
| `schedule-world-cap` | The world's whole queue is at its ceiling. |
| `invalid-schedule-delay` | A negative or non-finite `delayMs`. |
| `invalid-schedule-interval` | A non-positive or non-finite `everyMs`, which is a wake that re-arms instantly forever. |
| `invalid-schedule-command` | A schedule request that names no command, which is a wake that runs nothing. |
| `engine-not-world-mode` | The engine was built over a game that is not in world mode. |
| `child-timeout` | The bundle did not answer a host's call inside its deadline. |

**`platform`**: a host's own bookkeeping broke. Not yours to fix, and
deterministic, so a host with a park ladder parks on it:
`partition-not-resident`, `partition-vanished`, `checkpoint-unknown-partition`,
`unknown-child-op`, `child-generations-exhausted`, `world-engine-unavailable`.

**`infrastructure`**: a service the host depends on did not answer.
`bundle-store-unavailable` is the one code, and it repairs itself when the
service comes back. It costs the event nothing while it lasts.

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
| `maxCandidatesPerSelection` | 200 | Candidates one selection may offer. **Nothing enforces this yet**; it is declared so #169 configures a budget rather than inventing one. |

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
| What a world *is*: residency, declare-then-run, rollback baselines, the dirty set, per-seat views, event routing by scope | The session that holds a world in memory, sockets and transport |
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

// A host asks the declaration first, and sends back whatever it says is
// missing. Everything genesis created is already here, so `needs` is empty.
const { needs } = await runner.declare({ name: 'tend', args: {} }, 'alice', {});

const result = await runner.apply({
  player: 'alice',
  command: { name: 'tend', args: {} },
  timing: null,
  arrivedAt: 1_800_000_000_000,
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  presence: [1],
});
// result.events, result.dirty, result.schedules, result.ending

const bytes = await runner.serialize([...result.dirty]);
```

`runner.declareViews(...)` and `runner.viewsFor(...)` drive the read path the
same way, and `runner.evict(names)` releases partitions. Every refusal on this
page is reachable from a test file.

The example worlds each drive their whole world contract from their own project
under plain `vitest`: `~/BoardSmithGames/example-mud/tests/world.test.ts` and
`~/BoardSmithGames/example-rts/tests/world.test.ts`. Both of those predate this
module, so each carries a **hand-written harness** that imitates a host and a
**hand-copied** version of the authoring types. They are deliberately left that
way for now: #169 changes the command shape itself, so moving them onto
`boardsmith/world` first would mean rewriting every example twice.

**On a hosting platform.** The world runtime a published world runs under is the
host's, built over this module.

**Not yet under `boardsmith dev`.** See "What works today" at the top of this
page. `boardsmith dev` plays your project's table half, and #167 is what makes it
run the world half.
