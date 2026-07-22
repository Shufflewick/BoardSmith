# Phase 168: Platform Feature Spike — Seed-to-State - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Scope and prove feasibility of "seed a game into a target playtest state" (FEAT-01 / C.1) — a scenario/seed the platform can load directly so the pipeline can put a game into the exact state it wants a human to test, bringing the human in not-already-annoyed. This is a **spike**: the deliverable is a scoped design + feasibility finding PLUS a thin proof-of-concept. C.2 is delivered by Phase 159, NOT here.

**Feasibility (from scout): mostly-already-possible.** Loading a game into an exact mid-game state is a solved, exported, deterministic capability — `GameRunner.fromSnapshot(snapshot, GameClass)` + `GameStateSnapshot`, already wired through the stateless dev-host (`SnapshotSessionHost` / `handleStart` in `stateless-ops.ts`) and stateful `GameSession.restore`. The ONLY genuinely new work is the **authoring surface** (there is no target-state/scenario builder today) + a small wiring change to seed the host's initial snapshot.
</domain>

<decisions>
## Implementation Decisions

### Deliverable
- Ship BOTH a **design/feasibility doc** (the FEAT-01 spike finding: mechanism, format, load path, pipeline request API, cost/shape recommendation) AND a **thin PoC** proving deterministic load. Feasibility is high and the load path already exists, so the PoC is cheap and satisfies success criterion 2's deterministic-load bar.

### Seed format
- The seed IS a **serialized `GameStateSnapshot` JSON** (the existing format: element tree via `game.toJSON()`, `flowState`, `sequence`, `randomState`, `gameOptions`). **No new format.** Determinism is already covered by the snapshot's `seed` + `randomState` fields (mulberry32 RNG state), both already restored by `fromSnapshot`. Note: `actionHistory` in a snapshot is only needed for undo, NOT to reach the state — a seed does not need a real play history.

### Authoring surface
- **Record-from-play** is the primary authoring path: drive a `TestGame` (`src/testing/test-game.ts`) to the target state with real actions, then capture `TestGame.getSnapshot()` and write it to a seed file. **Zero new engine work.**
- A hand-authoring / snapshot-validation helper is noted as a **future** enhancement (surface-don't-overreach), not built in this spike.

### Pipeline request API
- The pipeline requests a target state via a **named seed file** the playtest step loads (ties into the bs-skills pipeline / playtest step). Design doc specifies the file location convention + how a bs-skills playtest script would reference a seed. (No skills edits required in THIS phase — the API shape is documented for a future skills wire-up.)

### Dev-host wiring
- Add a **`--seed <file>` CLI flag** to `boardsmith dev` that, at game start, seeds the host's initial snapshot from the seed file **instead of** `handleStart`'s freshly-started snapshot. The host already treats "the snapshot" as opaque authoritative state, so this is a small change — no new load machinery.

### PoC
- Prove it against **go-fish** (reference card game): capture a mid-game `GameStateSnapshot` (record-from-play via TestGame), write it as a seed fixture, load it via `--seed`, and assert the game deterministically renders/continues at that exact state. Ship a test that fails without the seed wiring and passes with it (PROC-01 spirit).

### Claude's Discretion
- Exact seed-file location convention, the `--seed` flag's precise plumbing through the dev-host, the record-from-play helper's shape/name, and the design-doc filename are at Claude's discretion.
</decisions>

<code_context>
## Existing Code Insights (from scout)

### Reusable building blocks (the load path already exists — do NOT rebuild)
- `src/engine/utils/snapshot.ts` — `createSnapshot`, `GameStateSnapshot`, `createActionCheckpoint`. Snapshot contains element tree (`.state` = `game.toJSON()`), `flowState`, `actionHistory`, `seed`, `sequence`, `randomState`, `gameOptions`, `actionCheckpoints`, `executeBarrierIndex`.
- `src/runtime/runner.ts` — `GameRunner.getSnapshot` / `fromSnapshot` (line ~608): state-authoritative, deterministic restore (NOT replay). Rebuilds tree via `game.loadSerializedState`, restores RNG via `setRandomState`, rebuilds FlowEngine via `restoreFlowState`. Exported via `src/runtime/index.ts` + `src/engine/index.ts`.
- `src/engine/element/game.ts` — `loadSerializedState` (~3001), `restoreGame` (~3217), `restoreFlowState` (~1861), `createSeededRandom`/`getRandomState`/`setRandomState` (~302/1882/1891).
- `src/session/stateless-ops.ts` — `handleStart` (~291): `new GameRunner` → `runner.start()` → returns `stateEnvelope.snapshot = runner.getSnapshot()`. **The seed plug-in point** — replace the fresh start snapshot with the seed snapshot.
- `src/session/game-session.ts` — `GameSession.create` (~667) / `GameSession.restore` (~838, calls `GameRunner.fromSnapshot`). Stateful path equivalent.
- `src/cli/dev-host/multiplayer-host.ts` + `snapshot-session-host.ts` — the dev CLI's SnapshotSessionHost holds the opaque snapshot; `--seed` seeds it.
- `src/testing/test-game.ts` — `TestGame` (builds state by playing actions; `getSnapshot()` emits a `GameStateSnapshot`). The record-from-play authoring surface.

### Established Patterns
- Determinism eslint-enforced (no-network/no-timers/no-nondeterministic); RNG is a single mulberry32 state number — fully captured by snapshot fields.
- Pit of Success / no-backward-compat / prove-before-fix.
- No existing scenario/seed/fixture target-state abstraction (only `simulate-tutorial.ts` scripted actions + `TestGame` play-to-state).

### Integration Points
- Seed load: seed file → `GameStateSnapshot` → `SnapshotSessionHost` initial snapshot (via `--seed` in dev CLI) → existing `fromSnapshot` render.
- Future: bs-skills playtest step references a named seed file (documented, not wired this phase).
</code_context>

<specifics>
## Specific Ideas
- Post-mortem C.1 (`~/BoardSmithLab/findings/BATTERY-POST-MORTEM.md:246`): "For bigger games it takes a long time to play up to the specific feature… set the game into the exact state… bring the human in not already annoyed." Acknowledged as a substantial platform feature, high leverage on human-in-the-loop quality.
- The feasibility finding REDUCES the perceived cost: loading is solved; only authoring + a small wiring flag are new.
</specifics>

<deferred>
## Deferred Ideas
- Hand-authoring / snapshot-validation helper (author a target board position without playing to it) — future.
- Wiring the seed into the bs-skills playtest step — future skills work (this phase documents the API shape only).
- A higher-level scenario DSL over raw snapshots — future, only if raw-snapshot authoring proves too low-level in practice.
- The game de-workaround sweep → Phase 169.
</deferred>
