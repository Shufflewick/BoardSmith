This app is BoardSmith, a library for designing digital board games.

Read everything in the docs folder to get started.

## Motto: The Pit of Success

> Make the easy path the right path, and the wrong path the hard path.

Every design decision should guide developers and users toward correct behavior by default. When someone takes the path of least resistance, they should end up doing the right thing. Mistakes should require deliberate effort.

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
- Clear error messages with actionable next steps
- Graceful degradation that's visible, not hidden

**Testing**
- If it's hard to test, the design is probably wrong
- Integration tests for the happy path
- Property-based tests for invariants
- Local dev: `wrangler` (Cloudflare) + `convex dev` (Convex) running together
- Stripe test mode for all payment testing
- Seed data scripts for common scenarios

---

# Modules

- **engine** - Core game rules: elements (cards, pieces, dice, grids), flow control, actions, and state-authoritative snapshots/checkpoints (NOT event sourcing — state is restored whole, never replayed). Also carries world mode (r17), an opt-in residency model where only named partitions are resident and the engine reports which a move dirtied — see docs/core-concepts.md.
- **session** - Game lifecycle management: player handling, action validation, checkpoints, undo, and storage/broadcast adapters.
- **ui** - Vue 3 components: GameShell, AutoUI, drag-drop, animations (FLIP, flying elements), action panels, and theming.
- **types** - Shared protocol types for WebSocket messages, lobby state, and action requests.
- **client** - TypeScript SDK for connecting to game servers with matchmaking and state management.
- **runtime** - Game execution: serialization, snapshots, per-action checkpoints, and GameRunner for action execution.
- **testing** - Test utilities: TestGame, action simulation, random simulation, assertions, and scenario builders.
- **bot-trainer** - Bot training: MCTS bots, parallel training, feature generation, weight evolution, and benchmarking.
- **bot** - Bot creation using Monte Carlo Tree Search with configurable difficulty.
- **eslint-plugin** - ESLint rules enforcing game design constraints (no-network, no-timers, no-nondeterministic, etc).
- **cli** - Command-line interface for dev server, game creation, testing, and local server setup.

# Related Repositories

This library is developed alongside two sibling repos. When a BoardSmith change affects games, verify against them.

- **`~/BoardSmithGames/`** — example games. Reference games: Hex (simplest), Go Fish (cards), Checkers (grid + multi-step), Cribbage (complex multi-phase); plus Polyhedral Potions and demo-* apps. Each game depends on BoardSmith via `"boardsmith": "file:../../BoardSmith"`, and `node_modules/boardsmith` is a **symlink to this repo** — so `npx boardsmith dev` in a game picks up local BoardSmith source changes live (Vite HMR). Quickest way to browser-test a UI change: `cd ~/BoardSmithGames/go-fish && npx boardsmith dev` (serves on :5173). Kill the server when done. **Each game is its own private repository** under the `Shufflewick` org (issue #193); a machine without them runs `bash ~/BoardSmithGames/scripts/clone-catalogue.sh`, and work in a game is not safe until it is pushed.
- **`~/Dropbox/MERC/BoardSmith/MERC`** — our most complex game. It does NOT symlink; it uses a **vendored copy** of BoardSmith that must be re-vendored to pick up library changes (see its commit history for the re-vendor pattern).

# `boardsmith dev` host (CLI)

`npx boardsmith dev` serves a multiplayer dev host (`src/cli/dev-host/DevHost.vue`): each browser is a real player connecting over WS, rendering its seat via a GameShell **iframe in platform mode** (the exact code production runs). The outer page is the "Dev" chrome (seat selector w/ Follow-active-seat, UI switcher, New game, Table setup, Debug). The Debug panel lives inside the iframe but is toggled from the Dev header via postMessage. To repro GameShell's mobile breakpoint without shrinking the whole window, shrink the iframe element width via JS in the page context.

# Hard Rules
- **Pit of Success**: The right path is always the easy path, the wrong path is always hard. Design APIs and code so correct usage is obvious and incorrect usage is difficult.
- **No Backward Compatibility**: Always pursue the cleanest implementation. No deprecation cycles—remove the bad thing and add the good thing. We're a library in active development, not a legacy system.
- **Prove Before Fix**: When fixing a bug, never guess at the cause. Always prove the root cause through investigation before attempting a fix.
- All UI interactions must work in a Custom UI and Action Panel in parity with shared state through useBoardInteraction
- Don't leave a dev server running that you start.

# Testing
- All development is done as test-driven development, meaning you'll write a test first, make sure it is failing. Then you will fix the code or add the code and you are not done until all of the tests are green.
- Verify behavior by running the application, not just reviewing code structure. Confirm features work end-to-end in the browser before marking work complete.
- Enumerate all code paths a change affects (e.g. lobby mode, `--bot` mode, presets) and verify each one — not just the primary happy path.
- Trace at least one real value through the full stack (config → engine → session → UI) to confirm data survives every layer boundary.
- Treat identified test gaps as blockers, not observations. If verification flags untested code within the scope of the change, address it before completion.
- Write at least one integration test per cross-layer boundary the change touches.

# Code Quality Audits
- Run `boardsmith audit` after significant refactors. **It checks the files your branch changed against its base branch, not the whole repository**, and it subtracts this repo's committed baselines (`.fallow-dead-code-baseline.json`, `.fallow-dupes-baseline.json`, `.fallow-health-baseline.json`). So it reports what your change introduced — unused exports, dead files, circular dependencies, complexity and duplication — and a clean branch passes it. See `docs/fallow-gate.md` for why the baselines exist.
- It runs four checks: `--dupes-baseline` (duplication recorded by content, #232), `--changes` (Fallow, changed files), `--duplication` (jscpd, whole repo), `--health-baseline` (baseline drift, #159). With no flag, all four run, in that order — the dupes baseline first because `--changes` is what reads the file it re-addresses (#256).
- **`.fallow-dupes-baseline.json` is DERIVED and must not be regenerated with `fallow dupes --save-baseline`.** The record is `.fallow-dupes-accepted.json`, keyed by the clone group's own text so an unrelated edit above it cannot invalidate an entry. **`boardsmith audit` re-addresses the derived file itself when the content still matches, and says it did — commit the two files it rewrites.** There is no manual step for that any more (#256); what still fails is a clone group whose CONTENT changed and any new duplication, and a failing run writes nothing. `boardsmith audit --rekey-dupes` remains only for recording a tree from scratch, deliberately. `docs/fallow-gate.md` § "The duplication baseline is keyed by CONTENT" says why.
- **A run with nothing in scope says so and gives no verdict.** On `main` right after a merge there is no diff against the base branch, so the audit checks nothing — that is not a pass. Widen it with `boardsmith audit --since <ref>` (e.g. `--since origin/main` in CI, or `--since HEAD~5`).
- `boardsmith audit --backlog` reports the whole repository's dead code with the baselines set aside. That is the repo's accepted backlog (hundreds of findings, see `docs/fallow-gate.md`), so it is informational only — it never gates and always exits 0. Never treat it as the gate.
- Note: Fallow's "unused class members" findings are mostly false positives for BoardSmith — our public API is consumed by external game projects, not internally. Focus on unused files, exports, and dependencies.
