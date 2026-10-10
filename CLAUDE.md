This app is BoardSmith, a library for designing digital board games.

Have a subagent read the relevant docs in the docs folder to get started.

## Motto: The Pit of Success

### What This Means in Practice

**API Design**
- Secure defaults, not opt-in security
- Required parameters for dangerous operations
- Impossible to represent invalid states in types

**UI Design**
- The action panel is a simple, accessible, text-based representation of available player actions. 
- The custom UI is a visual representation of available player actions. 
- The action panel and the custom UI must remain in sync at all times. They are two different representations of the same state in the game.

**Architecture**
- Single source of truth for each piece of data
- Idempotent operations where possible
- Explicit state machines over implicit transitions

**Error Handling**
- Fail fast and loud, not silently
- Error messages should be as descriptive as possible for users
- Never leak implementation details (line numbers, stack traces, internal paths)
- Graceful degradation that's visible, not hidden

**Testing**
- If it's hard to test, the design is probably wrong
- Integration tests for the happy path
- Property-based tests for invariants

---

# Modules

- **engine** - Core game rules: elements (cards, pieces, dice, grids), flow control, actions, and state-authoritative snapshots/checkpoints (NOT event sourcing — state is restored whole, never replayed). Also carries world mode (r17), an opt-in residency model where only named partitions are resident and the engine reports which a move dirtied — see docs/core-concepts.md.
- **session** - Game lifecycle management: player handling, action validation, checkpoints, undo, and storage/broadcast adapters.
- **ui** - Vue 3 components: GameShell, AutoUI, drag-drop, animations (FLIP, flying elements), action panels, and theming.
- **types** - Shared protocol types for WebSocket messages, lobby state, and action requests.
- **client** - TypeScript SDK for connecting to game servers with matchmaking and state management.
- **runtime** - Game execution: serialization, snapshots, per-action checkpoints, and GameRunner for action execution.
- **testing** - Test utilities: TestGame, action simulation, random simulation, assertions, and scenario builders.
- **bot-trainer** - Bot tuning: weight evolution of the game's own objectives from `bot.ts`, and benchmarking.
- **bot** - Bot creation using Monte Carlo Tree Search with configurable difficulty.
- **eslint-plugin** - ESLint rules enforcing game design constraints (no-network, no-timers, no-nondeterministic, etc).
- **cli** - Command-line interface for dev server, game creation, testing, and local server setup.

# Related Repositories

This library is developed alongside two sibling repos. When a BoardSmith change affects games, verify against them.

- **`~/BoardSmithGames/`** — example games. Reference games: Hex (simplest), Go Fish (cards), Checkers (grid + multi-step), Cribbage (complex multi-phase); plus Polyhedral Potions and demo-* apps. Each game depends on BoardSmith via `"boardsmith": "file:../../BoardSmith"`, and `node_modules/boardsmith` is a **symlink to this repo** — so `npx boardsmith dev` in a game picks up local BoardSmith source changes live (Vite HMR). Quickest way to browser-test a UI change: `cd ~/BoardSmithGames/go-fish && npx boardsmith dev` (serves on :5173). **Each game is its own private repository** under the `Shufflewick` org (issue #193); a machine without them runs ShufflewickPub's `bash ~/ShufflewickPub/scripts/clone-game-catalogue.sh`, and work in a game is not safe until it is pushed. `boardsmith catalogue` validates each game's committed `main` against the BoardSmith checkout it is run in, in temporary exports that never touch the games' checkouts, and caches passes (`src/cli/lib/catalogue-check.ts`, #591). It is a step of `agent-policy verify`; a game is left out only by a `--skip` in `.agent-policy.json` that names its issue.
- **`~/Dropbox/MERC/BoardSmith/MERC`** — our most complex game. It does NOT symlink; it uses a **vendored copy** of BoardSmith that must be re-vendored to pick up library changes (see its commit history for the re-vendor pattern).

# `boardsmith dev` host (CLI)

`npx boardsmith dev` serves a multiplayer dev host (`src/cli/dev-host/DevHost.vue`): each browser is a real player connecting over WS, rendering its seat via a GameShell **iframe** (the exact code production runs). The outer page is the "Dev" chrome (seat selector w/ Follow-active-seat, UI switcher, New game, End step while a timed step is open, Table setup, Debug). The Debug panel lives inside the iframe but is toggled from the Dev header via postMessage. To repro GameShell's mobile breakpoint without shrinking the whole window, shrink the iframe element width via JS in the page context.

# Shared Agent Rules

The rules every Shufflewick repo shares, and which model and reasoning level each kind of work uses, live in the `Shufflewick/agent-policy` repo, installed as `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`. `.agent-policy.json` here lists the checks `agent-policy verify` runs before any agent may report done: `boardsmith audit --dupes-baseline --health-baseline --duplication`, then `boardsmith test`, then `boardsmith catalogue`. `agent-policy thread merge` runs the same checks on the merged tree.

# Hard Rules
- **No Backward Compatibility**: Always pursue the cleanest implementation. No deprecation cycles—remove the bad thing and add the good thing. We're a library in active development, not a legacy system.
- **Prove Before Fix**: When fixing a bug, never guess at the cause. Always prove the root cause through investigation before attempting a fix.
- All UI interactions must work in a Custom UI and Action Panel in parity with shared state through useBoardInteraction
- **Stop only the processes you started, by their pid. Never by name** (`pkill -f vitest`, `killall node`): every agent on this machine runs vitest, and a kill by name ends all of their runs and any merge in progress. That is what cut `boardsmith test` short in #429.

# Testing
- Verify behavior by running the application, not just reviewing code structure. Confirm features work end-to-end in the browser before marking work complete.
- Enumerate all code paths a change affects (e.g. lobby mode, `--bot` mode, presets) and verify each one — not just the primary happy path.
- Trace at least one real value through the full stack (config → engine → session → UI) to confirm data survives every layer boundary.
- Treat identified test gaps as blockers, not observations. If verification flags untested code within the scope of the change, address it before completion.
- Write at least one integration test per cross-layer boundary the change touches.
- A fixture program that writes to a path it is handed (an argument, an environment variable) runs in `fixtureSandbox` (`src/testing/fixture-sandbox.test-helper.ts`), where it can write only inside its own temp tree. A merge-script stub handed the wrong path once overwrote the machine's `node` (#430); `scripts/fixture-writes-sandboxed.test.mjs` refuses such a fixture outside a sandbox.
- Never assert how long something took. `boardsmith test` runs on a busy machine during merges, so a wall-clock budget fails with nothing wrong. Assert the work done (calls, reads, timers scheduled) or the path taken; `scripts/no-wall-clock-budgets.test.mjs` refuses a budget (#360). Do slow one-time setup (a heavy module import, a bundle) at the top of the test file, where no test timeout applies, not inside the first test (#354, #355, #363). A module load inside a function in a test file (a test body, a hook, a helper) needs a `// Dynamic import: <why>` comment directly above it, for the loads that belong there (after `vi.resetModules()` or `vi.doMock`, a file the test wrote, the import under test); `scripts/no-in-test-dynamic-imports.test.mjs` refuses one without it (#365).

# Typechecking and Merging
- **`boardsmith typecheck` is the one type check.** It runs `vue-tsc` over the whole package (every `.ts` and `.vue` file under `src/` and `docs/`), and `main` is at zero errors. `docs/typecheck.md` says exactly what it covers. Plain `tsc` cannot read `.vue` files, so it is not a substitute.
- **`boardsmith test` type-checks first** and runs no test if that fails. A bare `npx vitest run` does not type-check.
- **Every task is done in a thread.** Start one with `agent-policy thread start <slug>` (branch `codex/<slug>` in `.worktrees/<slug>`), and work only there.
- **A branch reaches `main` only through `agent-policy thread merge <slug> --summary "<what it does (#issue)>"`**, run from any checkout. `--summary` is required, and the merge commit reads `Merge branch '<branch>': <summary>`, the format BoardSmith's merge commits have always had. It validates the merged tree with `boardsmith test` and refuses the merge otherwise, leaving `main` as it was. Merges are serialised: a second one waits for the first. Let it wait; do not hand-merge around it.
- Remove a merged thread with `agent-policy thread clean <slug>`. `agent-policy thread clean <slug> --discard` is the one way to throw a thread's work away.

# Code Quality Audits
- Run `boardsmith audit` after significant refactors. **It checks the files your branch changed against its base branch, not the whole repository**, and it subtracts this repo's committed baselines (`.fallow-dead-code-baseline.json`, `.fallow-dupes-baseline.json`, `.fallow-health-baseline.json`). So it reports what your change introduced — unused exports, dead files, circular dependencies, complexity and duplication — and a clean branch passes it. See `docs/fallow-gate.md` for why the baselines exist.
- **fallow, jscpd and eslint are pinned: each is an exact `dependencies` entry of boardsmith (fallow 3.28.0, jscpd 5.3.2, eslint 10.11.0), and the CLI always runs boardsmith's own copy**, resolved from boardsmith's install, never PATH, `npx` or a game's `node_modules` (#545, #551, #595). vitest, vue-tsc and stylelint must match the game's own install, so they run only from the game's `node_modules/.bin`, and a missing one stops with the `npm install -D` command; nothing is ever fetched through `npx`. The baselines are only valid for the version that recorded them, so changing fallow's version means re-recording every baseline in the same change; `docs/fallow-gate.md` § "Which fallow runs" and § "Regenerating the baselines" say how. After `npm install`, `node_modules/.bin/fallow` is the pinned copy; a global fallow is not.
- **`agent-policy verify` and every thread merge run `boardsmith audit --dupes-baseline --health-baseline --duplication`** (`.agent-policy.json`), so a branch whose change leaves either baseline out of date, or adds a Vue template or style clone `.jscpd-accepted.json` does not accept (#596), cannot merge. If verify says a check changed the working tree, the audit re-addressed moved clone groups: commit the two dupes files (and `.jscpd-accepted.json`, if it was rewritten) and verify again. If `thread:merge` refuses because the checks changed the working tree, the merge itself moved lines: merge `main` into the branch, run `boardsmith audit`, commit what it rewrites, and merge again. New duplication or complexity is yours to remove or, deliberately, to record.
- It runs four checks: `--dupes-baseline` (duplication recorded by content, #232), `--changes` (Fallow, changed files), `--duplication` (jscpd over `.vue` template and style blocks only, against the content-keyed `.jscpd-accepted.json`; script code is left to fallow, #596), `--health-baseline` (baseline drift, #159). With no flag, all four run, in that order — the dupes baseline first because `--changes` is what reads the file it re-addresses (#256).
- **`.fallow-dupes-baseline.json` is DERIVED and must not be regenerated with `fallow dupes --save-baseline`.** The record is `.fallow-dupes-accepted.json`, keyed by the clone group's own text so an unrelated edit above it cannot invalidate an entry. **`boardsmith audit` re-addresses the derived file itself when the content still matches, and says it did — commit the two files it rewrites.** There is no manual step for that any more (#256); what still fails is a clone group whose CONTENT changed and any new duplication, and a failing run writes nothing. An accepted entry whose duplication is gone also fails, naming the entry; `boardsmith audit --rekey-dupes` drops it (#353), which only narrows the record, and otherwise remains only for recording a tree from scratch, deliberately. `--rekey-dupes` also creates `.jscpd-accepted.json` when it is missing and drops its gone entries, and refuses on any template clone the record does not accept. `docs/fallow-gate.md` § "The duplication baseline is keyed by CONTENT" says why.
- **A run with nothing in scope says so and gives no verdict.** On `main` right after a merge there is no diff against the base branch, so the audit checks nothing — that is not a pass. Widen it with `boardsmith audit --since <ref>` (e.g. `--since origin/main` in CI, or `--since HEAD~5`).
- `boardsmith audit --backlog` reports the whole repository's dead code with the baselines set aside. That is the repo's accepted backlog (hundreds of findings, see `docs/fallow-gate.md`), so it is informational only — it never gates and always exits 0. Never treat it as the gate.
- **`boardsmith audit --sweep` is the whole-repository duplicate-export sweep (#265), and it FILES rather than gates.** The changed-files audit reports a duplicate export only when more than one of the declaring files is in the diff, so a duplicate whose halves never change together stays invisible — the `ElementRef` triplicate of #263 sat in the tree until two unrelated tickets touched two of its three files in one merge window. The sweep applies `.fallow-dead-code-baseline.json`, so it reports only what nothing has accepted, and it always exits 0. Add `--file-issue` to open one GitHub issue per finding; each body carries a fingerprint the sweep searches for (open AND closed issues) first, so it never files the same finding twice. This repo has no CI, so the cadence is a crontab line or a run by hand — `docs/fallow-gate.md` § "The gate cannot see a duplicate whose halves never change together" has the recipe and says why this is neither `--backlog` nor a wider `--since`.
- Note: Fallow's "unused class members" findings are mostly false positives for BoardSmith — our public API is consumed by external game projects, not internally. Focus on unused files, exports, and dependencies.
