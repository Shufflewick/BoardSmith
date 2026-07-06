# Test — The Verification Sequence + A11y Floor (BUILD-06 / UIQ-03)

Referenced by `build-chunk.md` Step 5 (`test`, second of the `{build, test}` session step
group — see `state-machine.md` "Session Handoff Seams"). This step proves the chunk `build`
just wrote actually works, in the GENERATED game project (not BoardSmith's own repo). Its
command outputs — pass/fail, violation lists — are what routes this chunk on to `repair`
(Phase 145) if anything fails; this step does not re-read chunk sources to interpret a failure,
only the tool output the commands themselves produce.

## The Ordered Sequence (non-reorderable, stop-on-failure)

Run the following as ONE numbered sequence immediately after `build` completes. Do not skip
steps, do not reorder them, and do not treat an earlier step's pass as license to skip a later
one. A failure at any step STOPS the sequence with an actionable message (what failed, the exact
error, what to fix) — never proceed past a failing step assuming a later step will "catch it
anyway." A failing step routes this chunk to `repair`; it does not get silently worked around
here.

1. **Compile gate** — `tsc --noEmit`. Catches type errors before anything else runs.

2. **Sandbox lint** — `boardsmith lint`. This command surfaces two different kinds of finding
   from one invocation, and only one kind is build-blocking here: the AST-based sandbox rules
   (`error` severity) are the hard gate; the separate regex-heuristic warnings the same command
   also reports are informational, not a `test`-step failure. The seven sandbox rules are the
   hard gate, name them explicitly rather than treating "any lint output" as a stop:
   - `no-network`
   - `no-filesystem`
   - `no-timers`
   - `no-nondeterministic`
   - `no-eval`
   - `no-element-identity-comparison`
   - `no-element-array-state`

   These are the AST-based determinism/network/timer/filesystem/eval enforcement rules
   `src/cli/lib/sandbox-scan.ts` implements as the single source of truth for both
   `boardsmith validate` and `boardsmith lint` — do not reimplement or duplicate this scan; cite
   it and run the real command.

3. **Chunk unit/integration tests** — the tests written or extended for this chunk's own new
   behavior.

4. **Full accumulated suite (regression)** — the entire generated project's test suite, not just
   this chunk's new tests. A chunk that passes its own tests but breaks an earlier chunk's
   tests is not done; this step is what catches that.

5. **Random-sim playthrough** — a scripted run of `simulateRandomGames` (from `boardsmith/testing`)
   against the accumulated game, proving it doesn't crash or get stuck with this chunk's rules
   in place:

   ```typescript
   import { simulateRandomGames } from 'boardsmith/testing';

   const results = await simulateRandomGames(MyGame, {
     count: 50,          // 50 light / 100 full — use judgment for the chunk's ceremony
     playerCounts: [2, 3, 4],
     timeout: 5000,      // optional
     seed: 'some-base-seed', // optional
   });

   expect(results.crashed).toBe(0);
   expect(results.stuck).toBe(0);
   expect(results.timedOut).toBe(0);
   expect(results.exceededMaxActions).toBe(0);
   ```

   All four of `results.crashed`, `results.stuck`, `results.timedOut`, and
   `results.exceededMaxActions` must be `0` (the real fields on `SimulationResults` —
   `src/testing/random-simulation.ts`). Asserting only `crashed`/`stuck` misses the flow-deadlock
   class this step exists to catch: a flow that loops forever while still producing *valid* moves
   is neither `crashed` nor `stuck` (stuck = "could not produce a valid move") — it surfaces as
   `timedOut` or `exceededMaxActions`. This is the real API — do not reimplement a hand-rolled
   random-play loop in its place.

6. **Asset-reachability gate (conditional on `ui: touches|major`)** — if this chunk's CHUNK.md
   `## ui:` tag is `touches` or `major`, run `scanAssetReachability(cwd)` from
   `src/cli/lib/asset-scan.ts` against the generated project. A `ui: none` chunk skips this item
   entirely — it has no UI to check. This is the single source of truth for ASSET-02's bare-`<img>`
   scan — do not reimplement or duplicate this scan in prose; cite it and run the real function,
   the same discipline item 2 above applies to `sandbox-scan.ts`. Any non-empty result (any bare
   asset `<img>` found outside `AssetImage.vue`) is a build-blocking FAIL that routes this chunk
   back to `build` (see "Failures Loop Back to `build`" below) — never silently worked around
   here.

7. **A11y floor (conditional on `ui: touches|major`)** — if this chunk's CHUNK.md `## ui:` tag
   is `touches` or `major`, run all five a11y floor items below as part of this same numbered
   sequence. A `ui: none` chunk skips this item entirely — it has no UI to check.

## The A11y Floor — All Five Items (UIQ-03)

Every `ui: touches|major` chunk's test step runs all five of these, every time, as executable
tests — never a manual visual pass:

1. **Keyboard-only ActionPanel completion.** A test that completes this chunk's action(s)
   through the ActionPanel using only keyboard events — no pointer/click simulation. Follow two
   precedents together, one for shape and one for real-wiring: `CardRenderer.a11y.test.ts`'s
   individual-control shape (mount the component, `trigger('keydown', { key: 'Enter' })`, assert
   the expected handler fired exactly once) for the control-level assertion, and
   `interaction-integration.test.ts`'s end-to-end shape (`useActionController` +
   `useBoardActionBridge` + `createBoardInteraction` wired together with no mock controller) for
   the full completion path — a mocked controller misses the real
   `fill → fetchChoicesForPick → snapshotVersion++ → currentChoices` reactive chain, so this test
   must exercise the real wiring, not a mock.

2. **`axe-core` structural/semantic scan.** Mount this chunk's board and ActionPanel components
   and run `axe-core` over the rendered output:

   ```typescript
   // @vitest-environment jsdom
   import { mount } from '@vue/test-utils';
   import axe from 'axe-core';

   // Mount WITH `attachTo: document.body` — axe.run() only scans nodes that are
   // in the document; a plain `mount` renders a DETACHED node and axe throws
   // "No elements found for include in page Context". Detach in `finally` so the
   // node never leaks into the next test (mirrors Toast.a11y.test.ts).
   const wrapper = mount(SomeComponent, { attachTo: document.body, props: { /* ... */ } });
   try {
     const results = await axe.run(wrapper.element);
     expect(results.violations).toEqual([]);
   } finally {
     wrapper.unmount();
   }
   ```

   Frame this scan as structural/semantic only — missing labels, invalid ARIA, duplicate IDs.
   `axe-core` does not evaluate color contrast under `jsdom`; contrast is covered separately by
   item 3 below, not by this scan.

3. **No-color-literal grep with a contrast assertion for new game-local token pairs.** Grep this
   chunk's new component source for hardcoded color literals (hex/rgb values outside the
   `--bsg-*` token system) and, for any new game-local foreground/background token pair this
   chunk introduces, assert its contrast ratio meets the WCAG threshold. This grep-plus-contrast-
   assertion is what actually catches contrast regressions — `axe-core` in `jsdom` does not.

4. **Real controls with game-semantic aria-labels; decorative glyphs `aria-hidden`.** Every
   interactive control this chunk adds is a real control — a `<button>`, or an element with
   `role`/`tabindex`/a `keydown` handler — never a `<div onclick>` with no keyboard path. Each
   carries an `aria-label` written in the game's own vocabulary (e.g. "Draw a card from the
   deck", not "Button 3"). Purely decorative glyphs or icons that carry no independent meaning
   are marked `aria-hidden`.

5. **Focus management + `prefers-reduced-motion` honored.** Confirm focus is never stranded —
   after a control triggers a state change (a dialog opens/closes, a panel appears/disappears),
   focus lands somewhere sensible, never lost to `document.body` or left on a now-detached
   element. Confirm any animation this chunk adds respects the `prefers-reduced-motion` media
   query — reduced-motion users get the state change without the animated transition, not a
   forced motion sequence they can't opt out of.

## Failures Loop Back to `build`

A failure at any step in the ordered sequence above — including any of the five a11y floor
items — routes this chunk back to `build` (still session group 2, `{build, test}`); it does not
advance to `audit`. `test` and `build` stay in the same group specifically so a failing test can
be fixed without a session handoff in between.

## Downstream Shape (cite, never restate)

Once every step above passes (and, for `ui: touches|major` chunks, all five a11y floor items
pass), this chunk is `Status: built` and ready for the `{audit, repair}` step group — authored in
Phase 145. This file does not restate that group's structure.
