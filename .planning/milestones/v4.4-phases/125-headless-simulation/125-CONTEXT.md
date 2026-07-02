# Phase 125: Headless Simulation - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Developers can play and audit games headlessly — via a public API and a CLI command — using the deterministic seeding established in Phase 123. Covers SIM-01 (public `createHeadlessSession` export from `boardsmith/session`) and SIM-02 (`boardsmith simulate` CLI with seeded pass/stuck/error reporting).

Scope: `src/session/` (promote headless harness to public surface) + `src/cli/` (simulate command). Depends on Phase 123 (seeded determinism).

</domain>

<decisions>
## Implementation Decisions

### Public Headless Session API (SIM-01)
- MOVE `createHeadlessSession` out of `src/session/testing/` into the session module proper (product surface now, not test-internal); export from `boardsmith/session`; clean break — no re-export shim at the old path
- Keep the existing signature (game definition + gameOptions + aiSeats); verify it exposes seed control and the full op surface; rename only if trivially aligned with the introspection family
- Unit tests for the public path (seeded determinism, AI seats, action ops) + JSDoc with a worked example

### `boardsmith simulate` CLI (SIM-02)
- Flags: `--games N` (default 10), `--seed S` (base seed; per-game seeds derived and recorded in output), `--players N` — follow the dev CLI's existing option conventions
- Output: human-readable summary table by default + `--json` flag for agents (agent-first project)
- Exit code: non-zero when any game is stuck/errored (CI-friendly); failing games print their seed + exact replay instructions
- Implementation: reuse the existing seeded simulation machinery (`simulateRandomGames` in src/testing/random-simulation.ts and/or the headless harness) — research decides the exact reuse; the requirement is the CLI behavior, not a new simulation loop

### Claude's Discretion
- Exact module/file placement for the promoted harness; naming details; whether simulate uses random-simulation or headless-session internally (reuse-not-rebuild is the constraint)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createHeadlessSession` — src/session/testing/headless-harness.ts (in-process session incl. AI seats; currently unexported publicly; package export "./session" → src/session/index.ts)
- `simulateRandomGames`/`replayRandomGame` — src/testing/random-simulation.ts (seeded, replayable, stuck-detection — the reporting semantics simulate should mirror)
- `playUntilComplete` (deterministic by default since Phase 123) + `GameStuckError` with embedded flow position
- CLI command conventions — src/cli/cli.ts (commander), dev command flags (--players, --ai, --ai-level, -p)
- `boardsmith.json` game config loading used by existing CLI commands (rules entry resolution)
- Seed retrievability from GameRunner (Phase 123, runner.ts)

### Established Patterns
- CLI commands live in src/cli/commands/<name>.ts, registered in cli.ts
- Package exports map in package.json (subpath exports, src TS directly)

### Integration Points
- src/session/index.ts (new export), src/session/testing/* (move from), src/cli/cli.ts + src/cli/commands/simulate.ts (new)
- Existing headless-harness consumers inside BoardSmith tests (update import paths — clean break)

</code_context>

<specifics>
## Specific Ideas

- Failure output should teach the replay loop: "Game 7 stuck (seed go-fish-7-abc123). Replay: boardsmith simulate --games 1 --seed <seed>" plus the readable flow position from GameStuckError
- `--json` output shape should be stable/parseable: per-game {index, seed, status: complete|stuck|error, turns, winner, error?}
- Determinism criterion from ROADMAP: running simulate twice with the same seed produces identical results

</specifics>

<deferred>
## Deferred Ideas

- `boardsmith screenshot` / HTTP endpoints — v2 requirements (TOOL-01/02)
- Game-repo adoption/docs — Phases 129/130

</deferred>
