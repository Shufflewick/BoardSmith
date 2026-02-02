This app is BoardSmith, a library for designing digital board games.

Read everything in the docs folder to get started.

# Modules

- **engine** - Core game rules: elements (cards, pieces, dice, grids), commands, flow control, actions, and event-sourced state.
- **session** - Game lifecycle management: player handling, action validation, checkpoints, undo, and storage/broadcast adapters.
- **ui** - Vue 3 components: GameShell, AutoUI, drag-drop, animations (FLIP, flying elements), action panels, and theming.
- **types** - Shared protocol types for WebSocket messages, lobby state, and action requests.
- **server** - Platform-agnostic HTTP/WebSocket server with game stores (memory, SQLite) and matchmaking.
- **worker** - Cloudflare Worker bindings using Durable Objects and KV for edge deployment.
- **client** - TypeScript SDK for connecting to game servers with matchmaking and state management.
- **runtime** - Game execution: serialization, snapshots, replays, and GameRunner for action execution.
- **testing** - Test utilities: TestGame, action simulation, random simulation, assertions, and scenario builders.
- **ai-trainer** - AI training: MCTS bots, parallel training, feature generation, weight evolution, and benchmarking.
- **ai** - AI bot creation using Monte Carlo Tree Search with configurable difficulty.
- **eslint-plugin** - ESLint rules enforcing game design constraints (no-network, no-timers, no-nondeterministic, etc).
- **cli** - Command-line interface for dev server, game creation, testing, and local server setup.

# Example Games

Example games are located in `~/BoardSmithGames/`. Reference games include Hex (simplest), Go Fish (cards), Checkers (grid + multi-step), and Cribbage (complex multi-phase).

# Hard Rules
- **Pit of Success**: The right path is always the easy path, the wrong path is always hard. Design APIs and code so correct usage is obvious and incorrect usage is difficult.
- **No Backward Compatibility**: Always pursue the cleanest implementation. No deprecation cycles—remove the bad thing and add the good thing. We're a library in active development, not a legacy system.
- **Prove Before Fix**: When fixing a bug, never guess at the cause. Always prove the root cause through investigation before attempting a fix.
- All UI interactions must work in a Custom UI and Action Panel in parity with shared state through useBoardInteraction
- Don't leave a dev server running that you start.

# Testing
- Verify behavior by running the application, not just reviewing code structure. Confirm features work end-to-end in the browser before marking work complete.
- Enumerate all code paths a change affects (e.g. lobby mode, `--ai` mode, presets) and verify each one — not just the primary happy path.
- Trace at least one real value through the full stack (config → engine → session → UI) to confirm data survives every layer boundary.
- Treat identified test gaps as blockers, not observations. If verification flags untested code within the scope of the change, address it before completion.
- Write at least one integration test per cross-layer boundary the change touches.
