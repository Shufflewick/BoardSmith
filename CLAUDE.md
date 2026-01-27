This app is BoardSmith, a library for designing digital board games.

Read everything in the docs folder to get started.

# Hard Rules
- All UI interactions must work in a Custom UI and Action Panel in parity with shared state through useBoardInteraction
- Don't leave a dev server running that you start.

# Testing
- Verify behavior by running the application, not just reviewing code structure. Confirm features work end-to-end in the browser before marking work complete.
- Enumerate all code paths a change affects (e.g. lobby mode, `--ai` mode, presets) and verify each one — not just the primary happy path.
- Trace at least one real value through the full stack (config → engine → session → UI) to confirm data survives every layer boundary.
- Treat identified test gaps as blockers, not observations. If verification flags untested code within the scope of the change, address it before completion.
- Write at least one integration test per cross-layer boundary the change touches.
