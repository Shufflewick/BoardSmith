# Seed-to-State: Design + Feasibility Spike (FEAT-01)

This document is the Phase 168 spike finding for C.1 from the build-battery
post-mortem: "set the game into the exact state so the human comes in
not-already-annoyed." It scopes the mechanism, load path, authoring surface,
pipeline request API, and a cost/shape recommendation — and states plainly
what the Phase 168 proof-of-concept (plan 168-02) proves versus what is
deferred.

**C.2 (panel multi-select parity) is delivered by Phase 159 (AI-01), NOT by
this phase.** This doc is scoped to C.1 only.

## Problem

From `BATTERY-POST-MORTEM.md` (finding C.1): for bigger games, driving a
`bs-` pipeline playtest step up to the specific feature under test takes a
long time — the human has to manually play through setup and unrelated turns
before reaching the state that actually needs eyes. The ask is a way to seed
the game directly into the exact target state, so the human arrives at the
feature under test not-already-annoyed by rote setup play. This is
acknowledged as a substantial platform feature and high-leverage on
human-in-the-loop playtest quality — it is the single biggest lever on
whether a human reviewer actually engages with the state that matters.

## Mechanism

The seed IS a serialized `GameStateSnapshot` — the exact JSON shape BoardSmith
already uses for persistence, undo/rewind checkpoints, and dev-host state
transmission. **There is no new format.**

`GameStateSnapshot` is defined in `src/engine/utils/snapshot.ts` (~line 12).
The fields that carry the actual game state are:

- `state` — the full element tree, typed as `ReturnType<Game['toJSON']>`
  (i.e. exactly `game.toJSON()`'s output shape, so restore is typed
  end-to-end with no casts).
- `flowState` — the flow engine's current position (which step/action a
  player is awaiting).
- `sequence` — the element-id sequence counter, restored after the tree
  loads so newly-created elements don't collide with existing ids.
- `randomState` — the seeded RNG's internal state (a single mulberry32 state
  number, from `game.getRandomState()`), restored via `game.setRandomState()`
  so the next `game.random()` draw matches exactly.
- `gameOptions` — the original constructor options (including custom options
  like `playerConfigs`), needed to reconstruct the game correctly.
- `seed` — the original random seed string, used to derive `gameOptions.seed`
  when `gameOptions` itself is absent.

Determinism is therefore already fully covered by `seed` + `randomState`: a
loaded seed resumes RNG draws from the exact position captured at record
time, not from a fresh re-seed.

`actionHistory` is also present on the snapshot (`SerializedAction[]`), but
it exists only to support undo (the undo op reads `runner.actionHistory`) —
it is NOT needed to reach the target state. A seed file therefore does not
need to encode a real play history; the `state`/`flowState`/`sequence`/
`randomState`/`gameOptions` fields alone are sufficient to reconstruct the
exact target state.

## Load path

Loading a `GameStateSnapshot` back into a running game is a solved, already-
exported, deterministic capability: `GameRunner.fromSnapshot` in
`src/runtime/runner.ts` (~line 608).

`fromSnapshot` is explicitly documented in its own source comment as "fully
STATE-AUTHORITATIVE, NO replay": it does NOT call `replayCommands`, `start()`,
or re-run `actionHistory` through `continueFlow`. Instead it:

1. Constructs a fresh `GameRunner` with the snapshot's `gameOptions` (or a
   fallback derived from `snapshot.state.settings` + `snapshot.seed`).
2. Adopts the authoritative element tree via `Game.loadSerializedState`
   (which fully clears and rebuilds the tree from `snapshot.state`).
3. Restores the flow position, the element-id `sequence`, and the RNG
   `randomState` directly.
4. Preserves (but does not replay) `actionHistory` and `actionCheckpoints`
   for the undo op.

This deliberate design choice — state-authoritative restore instead of
replay — is what makes seed loading both simple and safe: replay is
documented as unsound in the same file, because selection-step / pending-
completed actions are recorded in neither command nor action history, and
replaying an incomplete `actionHistory` mis-positions the flow (the source
comment cites a real production crash this caused: "Player N is not awaiting
action").

`fromSnapshot` is exported via `src/runtime/index.ts` and re-exported from
`src/engine/index.ts`, so it is already a public, documented entry point —
no new export surface is required for a seed loader.

Two existing entry points already plug snapshots in:

- **Stateless dev-host path.** `executeOp` in `src/session/stateless-ops.ts`
  (~line 1077) dispatches `op.type === 'start'` (~line 1095) to `handleStart`
  (~line 291), which constructs a fresh `GameRunner`, calls `runner.start()`,
  and returns the resulting snapshot via `stateEnvelope`. This is the
  natural seed plug-in point: replacing the freshly-started snapshot with a
  seed file's snapshot (skipping `runner.start()`) hands the exact same
  envelope shape downstream. On the dev-host side,
  `SnapshotSessionHost.start` (`src/session/snapshot-session-host.ts`
  ~line 319) issues `{ type: 'start' }` through `adapters.executeOp` and
  stores the resulting opaque snapshot; it never inspects the snapshot's
  contents, so handing it a seed-derived snapshot instead of a fresh-start
  one requires no changes to `SnapshotSessionHost` itself.
  `MultiplayerHost.startGame` (`src/cli/dev-host/multiplayer-host.ts`
  ~line 646) is what computes `startGameOptions` and routes the CLI's
  `boardsmith dev` session through this same `start` op.
- **Stateful path.** `GameSession.restore` (`src/session/game-session.ts`
  ~line 838) is the stateful-session equivalent: it requires
  `storedState.snapshot` and calls `GameRunner.fromSnapshot` directly
  (snapshot-authoritative restore, same non-replay guarantee), throwing a
  descriptive error if no snapshot is present.

Because both paths already treat "the snapshot" as opaque authoritative
state and both already call into `fromSnapshot`, seeding either path is a
matter of swapping which snapshot gets loaded — not building new load
machinery.

## Authoring surface

**Record-from-play is the primary authoring path**, and it requires zero new
engine work. `TestGame` (`src/testing/test-game.ts`) already exposes
`getSnapshot()` (~line 423), which delegates directly to
`this.runner.getSnapshot()`. The authoring recipe is:

1. Drive a `TestGame` instance with real actions (`doAction`, the
   `ActionBuilder`, etc.) up to the exact target state.
2. Call `testGame.getSnapshot()` to capture a `GameStateSnapshot`.
3. Serialize it to JSON and write it to a seed file.

This reuses `TestGame`'s existing action-driving ergonomics (already used
throughout the test suite and the `bs-` pipeline's scripted-action tests) —
no scenario builder, no new capture API, no engine changes.

**Hand-authoring is explicitly deferred.** A helper that lets a designer
author a target board position without actually playing to it (e.g. directly
constructing element placements) is a plausible future enhancement, but it
is not built in this spike — record-from-play covers the primary use case
(reaching a state through legal play) at zero marginal engine cost, and
hand-authoring adds real validation-surface work (an authored snapshot must
still satisfy every invariant the flow/action layer assumes) that is out of
scope here.

## Pipeline request API

The pipeline requests a target state via a **named seed file** that a future
playtest step loads. This section documents the intended API *shape* only —
**no `bs-` skills edits are made in this phase.**

Proposed convention (Claude's discretion, not yet wired):

- Seed files live under a `seeds/` directory at the game project root, e.g.
  `seeds/<scenario-name>.json` — sibling to the project's existing
  `chunks/`/`rulebook/` pipeline directories, so a designer or a skill step
  can find seeds without needing a separate index.
- Each seed file's contents are exactly a serialized `GameStateSnapshot`
  (the `docs/seed-to-state.test.ts` guard and the `--seed` flag documented
  below both assume this: no wrapper envelope, no extra metadata layer).
- A future `bs-` skill playtest step would reference a named seed by relative
  path (e.g. `seeds/mid-game-scoring.json`) and pass it to `boardsmith dev`
  via the `--seed <file>` flag described next, instead of starting a game
  fresh — putting the human straight into the scenario the chunk under test
  needs verified.

Wiring this reference into `build/playtest.md` (or any other skill file) is
explicitly out of scope for this phase; it is future skills work once the
`--seed` flag exists and has been proven (see Proven vs deferred, below).

## Dev-host wiring

Plan 168-02 (the PoC) adds a `--seed <file>` CLI flag to `boardsmith dev`.
At game start, when `--seed` is supplied, the host seeds its initial
snapshot from the seed file's `GameStateSnapshot` **instead of** the
snapshot `handleStart` would normally produce from a fresh `runner.start()`.

Because `SnapshotSessionHost` (and `MultiplayerHost` above it) already treat
"the snapshot" as opaque authoritative state — never inspecting or
regenerating it once received from `executeOp` — this is a small, targeted
change: it swaps the source of the initial snapshot at the one `start` op
call site, and reuses the exact same `fromSnapshot`-backed load path every
other snapshot restore already goes through. No new load machinery, no new
snapshot shape, no changes to `SnapshotSessionHost.start`,
`MultiplayerHost.startGame`'s downstream broadcast/apply logic, or the
client-side render path.

## Cost / shape recommendation

**Feasibility finding: loading a game into an exact target state is already
solved, exported, and deterministic.** `GameRunner.fromSnapshot` is public
API, state-authoritative (not replay-based, so it doesn't inherit replay's
known unsoundness), and already wired through both the stateless dev-host
path and the stateful `GameSession.restore` path. The perceived cost of this
feature was too high going in — most of "seed a game into a state" is
already built.

The **only genuinely new work** is:

1. The record-from-play authoring convenience (a documented recipe using
   existing `TestGame.getSnapshot()` — no engine changes).
2. The small `--seed <file>` wiring flag on `boardsmith dev` that swaps the
   initial snapshot source at the `start` op call site.

**Recommendation: ship the raw-snapshot seed format (no higher-level
scenario DSL) until raw authoring proves too low-level in practice.** A
`GameStateSnapshot` is already the right level of abstraction for "exact
state" (that's its whole purpose), and adding a DSL on top before there's
evidence raw snapshots are hard to author would be speculative work against
an unproven need.

**Relative cost: low.** The load path already exists end-to-end; the PoC
(168-02) is expected to be a thin proof (flag plumbing + a fixture) rather
than new engine work, which is itself evidence for how low the marginal cost
is.

## Proven vs deferred

**Proven by the Phase 168 PoC (plan 168-02):** a deterministic
record → seed → load → assert cycle against go-fish (the reference card
game) — capture a mid-game `GameStateSnapshot` via `TestGame.getSnapshot()`,
write it as a seed fixture, load it through the dev-host's new `--seed`
flag, and assert the game deterministically renders/continues at that exact
state (including a load-twice-identical check, proving the mechanism has no
hidden non-determinism beyond `seed`/`randomState`).

**Deferred (not built in Phase 168):**

- The hand-authoring / snapshot-validation helper (author a target state
  without playing to it) — see Authoring surface, above.
- Wiring a named seed reference into the `bs-` skills playtest step — see
  Pipeline request API, above; this doc records the API shape only.
- A higher-level scenario DSL over raw snapshots — only worth building if
  raw-snapshot authoring proves too low-level in practice.

**C.2 (panel multi-select) is delivered by Phase 159 (AI-01), not by this
phase or this PoC.** Any pipeline work that references "seed to state" for
playtest purposes should not be conflated with C.2's separate concern
(panel action-selection parity).
