# Test — The Verification Sequence + A11y Floor (BUILD-06 / UIQ-03 / TEST-01)

Referenced by `build-chunk.md` Step 6 (`test`, last of the `{spec, build, test}` session step
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
   - `no-silent-dispatch-fallthrough`

   These are the AST-based determinism/network/timer/filesystem/eval enforcement rules
   `src/cli/lib/sandbox-scan.ts` implements as the single source of truth for both
   `boardsmith validate` and `boardsmith lint` — do not reimplement or duplicate this scan; cite
   it and run the real command.

3. **Chunk unit/integration tests — the red-to-green check.** These tests are NOT authored here:
   `build/spec.md` wrote them from the approved interpretation and observed every one of them
   FAILING before any implementation existed, and `build` wrote the code that makes them pass. This
   step re-runs them and requires them all GREEN. Run them with `boardsmith test <pattern>`, naming
   this chunk's test files. Generated projects carry no npm scripts on purpose: `boardsmith test`
   is the one way to run a game's tests, so `npm test` will fail with "Missing script".

   Two failure modes here are NOT ordinary red-routes-to-`repair` and must be surfaced instead of
   fixed in place:

   (a) **A `spec` test is missing.** Cross-check the run against CHUNK.md's `## Spec Manifest`: a
       claim that had a test at `spec` time and has none now means a test was deleted rather than
       satisfied. That is a `build/build.md` "Never edit a spec test to make it pass" violation —
       restore the test and route the chunk back to `build`, never accept the shorter suite.

   (b) **A `spec` test's assertion changed.** `git diff chunk-<slug>/step-spec -- <test files>`
       shows what `build` did to the tests it was supposed to satisfy. New tests appended are
       expected and fine; a changed expected value, a loosened matcher, or a removed case in a
       `spec`-authored test is the same violation as (a). Route back to `build`.

   Both checks are cheap and they are the only thing standing between "the tests pass" and "the
   tests still test what `ask` approved."

4. **Worked-example tests (TEST-01)** — this chunk's cited worked examples become executable
   tests as part of this same build, generated and immediately run, never left as a one-time
   seed for hand-written tests to accumulate by hand. Run these sub-steps in order, citing the
   real commands below — never compose their output by hand and never restate their logic in
   this file's own prose:

   (a) Run `boardsmith verify-example-replay --project <dir> --chunk <this chunk's slug> --json`
       to enumerate this chunk's cited rulebook slices and obtain each pending slice's
       extraction dispatch payload (`extractionPayload`).

   (b) For each pending slice, dispatch that slice's `extractionPayload` UNCHANGED to a subagent
       carrying `${CLAUDE_SKILL_DIR}/../bs-shared/verify/extract-example.md`'s
       `BS-EXAMPLE-EXTRACT-V1` handshake, and save the returned structured object to a file.

   (c) Run `boardsmith verify-example-translate --project <dir> --slice-path <that slice>
       --extraction <that return file> --json` to obtain one translation dispatch payload per
       extracted example. This command is the ONLY source of those bytes: never compose a
       translation prompt by hand here, and never restate the project's exported API surface in
       this file's own prose — that surface is collected mechanically inside the command above,
       never duplicated in this skill's text.

   (d) Dispatch each returned `payloads[].translationPayload` UNCHANGED and SEPARATELY to a
       second subagent carrying `translate-example.md`'s `BS-EXAMPLE-TRANSLATE-V1` handshake, and
       save the returns to a file. Two separate dispatches, never one combined pass — a combined
       pass would let the model work backward from code it can already see, producing agreement
       with itself rather than a real test of the printed example.

   (e) Record both returns through exactly ONE `boardsmith verify-example-record --project <dir>
       --slice-path <p> --extraction <f> --translation <f>` invocation per SLICE — an atomic
       upsert-append, never a whole-ledger rewrite.

   (f) Run `boardsmith verify-example-emit --project <dir> --chunk <slug>` to write this chunk's
       single generated test file, then RUN that file with the project's own test runner. The
       recorded verdict comes from actually running the emitted test and observing its pass/fail
       result — never from the translator's own `verdictHint`, which is a model's guess, not an
       observation.

   (g) A `disagrees` result is BUILD-BLOCKING and routes this chunk back to `build`, the same way
       every other step in this ordered sequence does (see "Failures Loop Back to `build`"
       below) — this is deliberately asymmetric with `/bs-verify-game`'s own worked-example check,
       which is advisory: in build, the chunk was JUST written to satisfy those exact slices, so a
       mismatch here is precisely the drift this step exists to catch, not a staleness question a
       verify pass has to weigh separately.

   (h) An `unexecutable` or `example-inconsistent` result is NOT a build failure. Route an
       `example-inconsistent` finding to the designer via `## Open Rules Gaps`; record an
       `unexecutable` finding with its own named reason. Never turn either into a passing test.
       An entry `verify-example-translate` reports under `notTranslated[]` was never dispatched
       for translation at all — record it as returned, never re-judge it here.

   (i) A chunk whose cited slices contain zero worked examples SKIPS this step and names the
       exemption explicitly in the generated test file's own comment — the same
       "a chunk with zero new actions is exempt; name that exemption explicitly" discipline item
       6 below already uses for its per-action coverage counter, never a silent omission.

5. **Full accumulated suite (regression)** — `boardsmith test` with no pattern, running the
   entire generated project's test suite, not just this chunk's new tests. A chunk that passes
   its own tests but breaks an earlier chunk's tests is not done; this step is what catches that.

6. **Random-sim playthrough** — a scripted run of `simulateRandomGames` (from `boardsmith/testing`)
   against the accumulated game, proving it doesn't crash or get stuck with this chunk's rules
   in place:

   ```typescript
   import { simulateRandomGames } from 'boardsmith/testing';

   const results = await simulateRandomGames(MyGame, {
     count: 50,          // 50 light / 100 full — use judgment for the chunk's ceremony
     playerCounts: [2, 3, 4],
     timeout: 5000,      // optional
     seed: 'some-base-seed', // optional
     // Required when this chunk's rules only apply under a game option — the
     // harness otherwise simulates the default configuration only, and reports
     // green about a configuration nobody asked about.
     gameOptions: { difficulty: 'hard' },
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

   **Fail-loud: the sim must have EXERCISED this chunk's new actions (SKILLAUTO-08).** The four
   zero-checks above prove the run didn't crash, stall, or run away — they do NOT prove the run
   ever actually reached this chunk's new action(s). Passing all four zero-checks while never once
   invoking the chunk's target action is a silent-coverage failure this assertion exists to catch,
   not a passing test: a chunk whose action is unreachable (a wiring bug, a rules-flow regression
   that routes around it) can produce a perfectly clean `SimulationResults` and still be broken.
   `SimulationResults` (`src/testing/random-simulation.ts`) has no built-in per-action-name
   coverage field — do not invent one. Instead, instrument this chunk's own action(s) for the
   duration of the sim call: wrap or extend the new action's `.execute()` callback with a
   test-local counter (increment it inside `execute`, the same callback the action already runs)
   and assert, after `simulateRandomGames` resolves, that the counter for EACH new action this
   chunk introduced is greater than zero:

   ```typescript
   let auctionBidCount = 0;
   // ... within the game's action definition for this chunk's new action:
   //   .execute(({ game, player, args }) => { auctionBidCount++; /* existing behavior */ })

   const results = await simulateRandomGames(MyGame, { count: 50, playerCounts: [2, 3, 4] });
   expect(results.crashed).toBe(0);
   // ...existing zero-checks...
   expect(auctionBidCount).toBeGreaterThan(0); // fails loud if the sim never exercised it
   ```

   This is a required, hard gate for every chunk with at least one new action — never optional
   advice, and never satisfied by the four zero-checks alone. A chunk with zero new actions (a
   pure refactor or asset-only chunk) is exempt; name that exemption explicitly in the test file's
   comment rather than silently omitting the assertion.

7. **Asset-reachability gate (conditional on `ui: touches|major`)** — if this chunk's CHUNK.md
   `## ui:` tag is `touches` or `major`, run `scanAssetReachability(cwd)`, imported from
   `boardsmith/asset-scan`, against the generated project. A `ui: none` chunk skips this item
   entirely — it has no UI to check. This is the single source of truth for ASSET-02's bare-`<img>`
   scan — do not reimplement or duplicate this scan in prose; cite it and run the real function,
   the same discipline item 2 above applies to `sandbox-scan.ts`. Any non-empty result (any bare
   asset `<img>` found anywhere in the game's own `src/ui`, since `AssetImage` lives in
   `boardsmith/ui`) is a build-blocking FAIL that routes this chunk
   back to `build` (see "Failures Loop Back to `build`" below) — never silently worked around
   here.

8. **A11y floor (conditional on `ui: touches|major`)** — if this chunk's CHUNK.md `## ui:` tag
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
items — routes this chunk back to `build` (still session group 2, `{spec, build, test}`); it does not
advance to `audit`. `test` and `build` stay in the same group specifically so a failing test can
be fixed without a session handoff in between.

## Downstream Shape (cite, never restate)

Once every step above passes (and, for `ui: touches|major` chunks, all five a11y floor items
pass), this chunk is `Status: built` and ready for the `{audit, repair}` step group — authored in
Phase 145. This file does not restate that group's structure.
