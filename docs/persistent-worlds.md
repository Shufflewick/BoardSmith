# Persistent worlds and this engine

A **persistent world** is a publisher-owned game that runs continuously on the
hosting platform, seats its players as data rather than as a table's roster, and
is driven by commands and scheduled events instead of turns. This page exists to
answer one question honestly: **which half of that is BoardSmith's, and where
does the other half live?** It is a pointer, not a contract — it deliberately
specifies nothing, because a second specification is free to drift from the one
that is enforced, and that is the failure this page was written after (#304).

## What this engine owns

Exactly one thing: **`GameOptions.worldMode`**, the residency model. A game
constructed with it keeps only named partitions resident, reports which of them
a move dirtied, and writes `{ __elementId }` attribute references so a restored
world does not read references against a residency model that never wrote them.
`definePartition`, `adoptSubtree`, `evictSubtree` and `takeTouchedPartitions`
are its API.

That is documented in [core concepts](./core-concepts.md), under "Snapshot Mode
and World Mode", and it is the whole of the engine's share.

## What this engine does not own

`gameDefinition.world` — the block a world bundle exports, holding the
game's commands, its genesis, its per-seat view and its optional presence hooks.
**Nothing in this repo reads it.** The hosting platform's world runner calls
every member of it, validates the block on a world's first wake, and refuses a
game that declared a world in `boardsmith.json` without implementing one.

So `GameDefinition.world` is typed here as an open record and no more
(`src/session/types.ts`). The authoring contract — what a command handler
receives, what `ctx.schedule` promises, what a view may read, what presence is,
what a world may cost — belongs to the platform, and is written in
**ShufflewickPub `docs/PERSISTENT-WORLDS.md`**. What `ctx.schedule` promises
is its own short page there, **`docs/WORLD-SCHEDULE.md`**, worked through the
Example RTS slow burn. Read those before writing a world; nothing in this repo
is allowed to restate them.

## What `boardsmith dev` does with a world project

It plays the project's **table game**, constructed with `worldMode: true`.

Both example worlds ship a table half deliberately, and that is what you are
playing. The dev host dispatches no world command, runs no genesis, projects no
world view, fires no scheduled event and reports no presence — it contains no
world runner. `world.html` is not served either: the dev host routes the host
page and the game surface and answers everything else with a plain-text 404.

`boardsmith build` **does** build a world's UI: a project with a `world.html`
entry gets a second bundle mounting `WorldShell`, which is what a resident world
loads on the platform (a table loads `index.html` and `GameShell`). Building it
is not running it.

## Where a world actually runs

- **Its whole contract, under plain `npm test`.** Each example world drives
  genesis, command dispatch, its view, scheduled events and the refusals from
  its own project: `~/BoardSmithGames/example-mud/tests/world.test.ts` and
  `~/BoardSmithGames/example-rts/tests/world.test.ts`. This is the fastest loop
  there is for writing a world's rules, and it is where a second world should
  start.
- **A real published bundle, in a real isolate.** The platform runs vendored
  copies of both example bundles through its own world session and storage under
  `cd games && npm test` in ShufflewickPub.
- **A browser, end to end.** ShufflewickPub's dev stack serves a live world, and
  its Playwright world specs attach to one, take a turn, and watch a scheduled
  event land. See that repo's `docs/ENVIRONMENTS.md` and `docs/E2E-TESTING.md`.

## Declaring one

```json
{ "name": "gloamhall", "world": { "maxPlayers": 200 } }
```

The block's PRESENCE is what makes a game a world — there is no `--world` flag
and no run-time choice, because a world is what a game IS. `maxPlayers` is the
capacity the platform sizes it against and `boardsmith validate` requires it.
