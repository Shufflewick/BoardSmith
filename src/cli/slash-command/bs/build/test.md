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
one. The type check, the whole suite, the build, `boardsmith validate` and the in-browser smoke test
are not steps of their own: they are part of the last step, `boardsmith verify`, which runs them
together and records the result. A failure at any step STOPS the sequence with an actionable message (what failed, the exact
error, what to fix) — never proceed past a failing step assuming a later step will "catch it
anyway." A failing step routes this chunk to `repair`; it does not get silently worked around
here.

1. **Sandbox lint** — `boardsmith lint`. This command surfaces two different kinds of finding
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

2. **Chunk unit/integration tests — the red-to-green check.** These tests are NOT authored here:
   they are the files CHUNK.md's `## Spec Manifest` lists. `build/spec.md` wrote most of them from
   the approved interpretation and observed every one of them FAILING before any implementation
   existed, and `build` wrote the code that makes them pass. A row can also come later: a regression
   test `build` wrote and saw fail before its fix, or a measurement test `repair` wrote and saw fail
   before its cap (`build/spec.md` "Persistence"). This step re-runs them and requires them all
   GREEN. Run them with `boardsmith test <pattern>`, naming
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

   (c) **The tests can fail — run `boardsmith test-step-check <slug>`.** A green suite says the
       tests pass; it does not say they would catch a regression. Run this command once the chunk's
       tests are green. It exits non-zero on any finding, and a non-zero exit is a failure of this
       step like any other: route the chunk back per "Failures Loop Back to `build`". There is no
       flag that skips part of it, and its findings are never argued away in prose. It enforces
       seven rules, each of which a real build run broke while its suite was green:

       - **Every Spec Manifest claim names a test that exists.** Each `## Spec Manifest` row names a
         test file on disk with `RED Observed: yes`, and for every claim the row lists, a test in
         that file that is not skipped cites the claim (`claim N` in its title or in a comment
         directly above it). Every live `## Interpretation` claim is listed by some row. A row that
         claims coverage no test gives is a false record, not a formatting slip.
       - **Every verb the chunk adds is dispatched through the engine** in at least one of the
         chunk's tests: `testGame.doAction`, `tryAction`, `action(...).execute()`,
         `simulateAction(s)`, `assertActionSucceeds`, `runner.performAction`, or a world's `take`,
         with the verb's name written literally. Calling the rules function directly skips the
         engine's selections, conditions and flow, so it does not count, and neither does a verb
         only ever dispatched through `assertActionFails`.
       - **No guard is called unreachable.** A line the chunk added that calls a guard unreachable
         ("unreachable", "should never happen", "can't happen") is a finding. Either the compiler
         proves it (an exhaustive check assigning to a `never`-typed variable, with no such
         wording), or it is reachable: make it a human-readable error that says what happened and
         what to do, and add a test that reaches it and asserts that message.
       - **No test hand-builds a shell's context.** A test file the chunk wrote or changed that
         provides, by hand, a key only one of the two shells provides (`GAME_CONTEXT_KEYS.gameState`,
         `dueSeats`, `timeTravelDiff`, `turnDeadline`, `ANNOUNCER_KEY`, `ANIMATION_EVENTS_KEY`,
         `WORLD_CONTEXT_KEY`) is a finding: a board reading it passes the test and throws in the
         other shell. Mount with `renderAsSeat`, `tableShellContext` or `worldShellContext`.
       - **Mutation: every claim and every test can fail.** The command makes one small change at a
         time to the lines this chunk added (a flipped comparison, a negated condition, a removed
         statement, a return value replaced) and runs the chunk's test files against each. In a
         `.vue` component that is its `<script>` blocks and the expressions of its template bindings,
         conditions and interpolations; event handlers and loops are not mutated. A test
         that survives every mutant asserts nothing the chunk's code controls, and a claim none of
         whose tests fail under any mutant has no real test; both are findings. A test that reads
         source as text (the a11y floor's scans below) can never fail under a mutant, so it is a
         guard (next rule). Mutants are served
         to vitest in memory, never written over the source. This runs one vitest process per
         mutant, so it takes minutes on a large chunk; let it finish.
       - **A guard holds scans only.** A file under `tests/guards/` reads source as text (the a11y
         floor's scans below) and is never mutation-tested, so the Spec Manifest never lists it and a
         row naming one is a finding. A guard the chunk wrote or changed that runs the game's code is
         a finding too: one that imports a `.vue` component (a `?raw` import is text and is fine),
         `@vue/test-utils` or `boardsmith/testing`, uses `renderAsSeat`, dispatches an action, or
         makes any other import from the game's `src/` that does not end `?raw`, directly or through a
         support file under `tests/`. The one exception is literal constants under `src/ui/`, such as
         a TypeScript palette whose colours a contrast check needs: a guard may import names written
         out as literal data (strings, numbers, arrays and objects of them) and types, from a module
         that runs nothing when it loads. A function from that module is code. A test that runs the
         game belongs in the chunk's own test file, where the mutation check shows it can fail.
       - **A new test file that runs the game is a Spec Manifest row.** Every test file the chunk
         created anywhere in the project that runs the game's code (by the same measure as a guard
         above), at any step, spec, build or repair, is a `## Spec Manifest` row, or the mutation
         check never runs it and nothing shows it can fail. A regression test build writes and a
         measurement test repair writes are rows like any other. Moving an earlier chunk's test file
         (or deleting it and writing a similar one) counts as creating a new file: the new path is
         this chunk's. The exemptions are every file under `tests/browser/`, which only Playwright
         runs and vitest never collects, so no mutant can reach it (the smoke test
         `tests/browser/smoke.spec.ts` among them), the generated `tests/examples/<slug>.examples.test.ts`, a measurement harness under
         `design/chunks/<slug>/evidence/` (`state-machine.md` "Project Layout"), scan-only guards
         under `tests/guards/`, and an earlier chunk's test file this chunk edits in place. A file
         that only reads source as text is not a row: it belongs under `tests/guards/`. A row must
         have its red observed, with one exception: an exempt chunk that pins an earlier chunk's
         behaviour lists that test as its own row with Claims Covered `none (regression)`, excused
         from the observed red because the behaviour already exists (`build/build.md`). It is still
         mutation-tested. Nothing else is excused.

       A finding here goes back to `build` (or to `spec`, when the fix is a test that pins the claim
       properly), never to an edit of the Spec Manifest that makes the row claim less. The two
       manifest edits a finding asks for are removing a row that names a guard (that row never
       belonged there, and the guard's scans still run in the full suite) and adding a row for a new
       test file that runs the game, with `RED Observed: yes` only once its tests were seen failing.

3. **Worked-example tests (TEST-01)** — this chunk's cited worked examples become executable
   tests as part of this same build, generated and immediately run, never left as a one-time
   seed for hand-written tests to accumulate by hand. Run these sub-steps in order, citing the
   real commands below — never compose their output by hand and never restate their logic in
   this file's own prose:

   (a) Run `boardsmith verify-example-replay --project <dir> --chunk <this chunk's slug> --json`
       to enumerate this chunk's cited rulebook slices and obtain each pending slice's
       extraction dispatch payload (`extractionPayload`).

   (b) For each pending slice, dispatch that slice's `extractionPayload` UNCHANGED to a subagent
       of the `judgement` role (`npx boardsmith agent judgement`, `routing.md`; a
       `### Dispatch N` entry, `Work: extract-example <slice>`, in the chunk's run log) carrying
       `${CLAUDE_SKILL_DIR}/../bs-shared/verify/extract-example.md`'s
       `BS-EXAMPLE-EXTRACT-V1` handshake, and save its return to a file UNCHANGED — the one
       `{ "examples": [...] }` object that contract returns. Never unwrap it or rebuild it.

   (c) Run `boardsmith verify-example-translate --project <dir> --slice-path <that slice>
       --extraction <that return file> --json` to obtain one translation dispatch payload per
       extracted example. This command is the ONLY source of those bytes: never compose a
       translation prompt by hand here, and never restate the project's exported API surface in
       this file's own prose — that surface is collected mechanically inside the command above,
       never duplicated in this skill's text.

   (d) Dispatch each returned `payloads[].translationPayload` UNCHANGED and SEPARATELY to a
       second subagent of the `judgement` role (`npx boardsmith agent judgement`;
       `Work: translate-example <example id>` in the run log) carrying `translate-example.md`'s
       `BS-EXAMPLE-TRANSLATE-V1` handshake.
       Two separate dispatches, never one combined pass — a combined pass would let the model
       work backward from code it can already see, producing agreement with itself rather than a
       real test of the printed example. Save the slice's returns to ONE file: a JSON object
       that files each return, unchanged, under the `exampleId` its payload came with —
       `{ "<exampleId>": <that example's return>, ... }`.

   (e) Record both files through exactly ONE `boardsmith verify-example-record --project <dir>
       --slice-path <p> --extraction <f> --translations <f>` invocation per SLICE. It replaces
       everything the ledger held for that slice, leaving other slices alone. It records each example as
       `example-inconsistent`, `unexecutable` (with the translator's named reason), or `not-run`
       carrying the test the translator wrote.
       A slice whose extraction returned `{ "examples": [] }` is recorded too, with `{}` as its
       translations file (steps (c) and (d) have nothing to do for it): the ledger then records it
       as having no worked examples, and (a) stops reporting it pending until the lines the
       extractor reads change. A slice (a) reports `notDispatchable` has nothing to extract and
       is not pending; skip it.

   (f) Run `boardsmith verify-example-emit --project <dir> --chunk <slug>` to write this chunk's
       single generated test file from the ledger, then `boardsmith verify-example-run --project
       <dir> --chunk <slug>`, which runs that file with the project's own vitest and records each
       `not-run` example as `agrees` (its test passed) or `disagrees` (it failed, with the failure
       as the observed outcome).
       Both refuse while a recorded example no longer sits on the slice line whose text it
       recorded. When the text only moved, run `npx boardsmith ingest-check`, which moves the
       record to its new line, then emit and run again. When the text is gone, (a) reports that
       slice pending again: record it again from (b).
       The recorded verdict comes from actually running the emitted test,
       never from the translator's own `verdictHint`, which is a model's guess, not an observation. A test that
       is skipped or a file that fails to load is refused, not recorded: re-dispatch that
       example's translator, record again, emit, and run again.

   (g) A `disagrees` result is BUILD-BLOCKING and routes this chunk back to `build`, the same way
       every other step in this ordered sequence does (see "Failures Loop Back to `build`"
       below) — this is deliberately asymmetric with `/bs-verify-game`'s own worked-example check,
       which is advisory: in build, the chunk was JUST written to satisfy those exact slices, so a
       mismatch here is precisely the drift this step exists to catch, not a staleness question a
       verify pass has to weigh separately. Once `build` has fixed the code, run
       `boardsmith verify-example-run` again; the emitted file does not change, so it needs no
       re-emit.

   (h) An `unexecutable` or `example-inconsistent` result is NOT a build failure. Route an
       `example-inconsistent` finding to the designer via `## Open Rules Gaps`; record an
       `unexecutable` finding with its own named reason. Never turn either into a passing test.
       An entry `verify-example-translate` reports under `notTranslated[]` was never dispatched
       for translation at all — record it as returned, never re-judge it here.

   (i) A chunk whose cited slices contain zero worked examples SKIPS this step and names the
       exemption explicitly in the generated test file's own comment — the same
       "a chunk with zero new actions is exempt; name that exemption explicitly" discipline item
       4 below already uses for its per-action coverage counter, never a silent omission.

4. **Random-sim playthrough** — a scripted run of `simulateRandomGames` (from `boardsmith/testing`)
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

   The simulator plays only moves a player could make: it never submits an action its `.disabled()`
   rule refuses (or a tutorial gate refuses). A seat whose actions are all refused waits while
   another seat plays, and a game where no seat has an enabled action stops with "no player has an
   enabled action to take", naming each refused action and its reason. So `.disabled()` is never a
   reason to reshape a rule or this test.

   **A chunk whose game cannot end yet declares its rest with `isResting`.** Before the chunk that
   builds the ending, a random game either stops with no move left, which by default is `stuck`,
   the same as a deadlock, or, when its seats can always act (a seat that has not checked in can
   always check in), never stops at all and runs to `timedOut` or `exceededMaxActions`. Pass
   `isResting`: it is asked after every move the simulator applies, handed the game as that move
   left it, and returns the reason the game rests there, or `false`. The first reason stops the game
   as `resting`. Check the resting state inside it, so a game that stops anywhere else stays `stuck`
   and one that never gets there still times out:

   ```typescript
   const results = await simulateRandomGames(MyGame, {
     count: 50,
     playerCounts: [2],
     // Deployment ends at check-in, which chunk `check-in` builds. Remove this then.
     isResting: (game) =>
       game.players.every((p) => p.supply < CHEAPEST_PACK)
         ? 'every player has spent their supply; check-in is not built yet'
         : false,
   });

   expect(results.crashed).toBe(0);
   expect(results.stuck).toBe(0);
   expect(results.timedOut).toBe(0);
   expect(results.exceededMaxActions).toBe(0);
   expect(results.resting).toBe(results.total);
   ```

   Never relax `results.stuck` instead (no `toBe(results.total)`, no replaying stuck games to excuse
   them), and never relax `results.timedOut` or `results.exceededMaxActions` for a game that can
   always act: its rest is found the same way, because `isResting` is asked after every move. It
   only turns a game that reached its rest into `resting`, so a crash, a rejected move, a move the
   simulator cannot build, or a game that never reaches the rest still fails. Record the
   rest and the chunk that removes it in DECISIONS.md, and delete `isResting` in that chunk, so the
   game's `stuck` check is a plain zero again. `boardsmith simulate` has no `isResting`: it reports
   every game of such a chunk stuck, so it is not this chunk's gate. `boardsmith validate`'s choice
   cardinality check still counts such a game, because every choice it offered before stopping was
   counted.

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

5. **Asset-reachability gate (conditional on `ui: touches|major`)** — if this chunk's CHUNK.md
   `## ui:` tag is `touches` or `major`, run `scanAssetReachability(cwd)`, imported from
   `boardsmith/asset-scan`, against the generated project, as a test in the guard file
   `tests/guards/a11y-floor.test.ts` ("The A11y Floor" below says why it lives there). A `ui: none` chunk skips this item
   entirely — it has no UI to check. This is the single source of truth for ASSET-02's bare-`<img>`
   scan — do not reimplement or duplicate this scan in prose; cite it and run the real function,
   the same discipline item 1 above applies to `sandbox-scan.ts`. Any non-empty result (any bare
   asset `<img>` found anywhere in the game's own `src/ui`, since `AssetImage` lives in
   `boardsmith/ui`) is a build-blocking FAIL that routes this chunk
   back to `build` (see "Failures Loop Back to `build`" below) — never silently worked around
   here.

6. **A11y floor (conditional on `ui: touches|major`)** — if this chunk's CHUNK.md `## ui:` tag
   is `touches` or `major`, run all five a11y floor items below as part of this same numbered
   sequence. A `ui: none` chunk skips this item entirely — it has no UI to check.

7. **The done gate: `boardsmith verify`**. Commit the chunk's work (`chunk-<slug>/step-test`,
   `state-machine.md` "Git Protocol"), then run `npx boardsmith verify --chunk <slug>`
   (`state-machine.md` "Git Protocol" says what it measures from). It runs, in order and
   without stopping at the first failure, the full suite, typecheck, build, validate, the smoke
   test and a mutation check of the code changed since the chunk began, and writes the result for
   this commit to `.boardsmith/verify/<commit>.json`. The smoke test is the game's
   `tests/browser/smoke.spec.ts` (a required output of any chunk that adds an action or a UI
   control, `build/spec.md`), run in Chromium against `boardsmith dev` served from a fresh copy
   of the project; `npx boardsmith smoke` runs it alone while you work, and a machine without the
   browser gets a failed check telling it to run `npx boardsmith install-browser` once. The full suite is the regression check: a chunk
   that passes its own tests but breaks an earlier chunk's is not done, and this is what catches
   it. The mutation check breaks each changed line one small change at a time and reports, by
   file and line, every change no test noticed. This step is not done until it exits zero on a
   clean tree; a failure routes the chunk back per "Failures Loop Back to `build`",
   using what each failed check names, and the gate runs again on the new commit. Never report
   this step, the chunk, or the suite as done or green without it: `chunk-signoff` refuses a chunk
   whose commit has no passing result covering the chunk's change, and any later step asks
   `npx boardsmith verify --check --chunk <slug>`.

## The A11y Floor — All Five Items (UIQ-03)

Every `ui: touches|major` chunk's test step runs all five of these, every time, as executable
tests — never a manual visual pass.

Where each test lives decides whether `boardsmith test-step-check` can pass. Items 1, 2, 4 and 5
mount the chunk's components and assert what they do, so they go in the chunk's own test file and
its Spec Manifest row, where the mutation check shows they can fail. The scans (item 3's colour
grep and contrast assertion, and the asset-reachability scan, sequence item 5 above) read source as
text, so no change to the code can make them fail, and in a manifest file the mutation check reports
every one. They live in one guard file for the whole game, `tests/guards/a11y-floor.test.ts`: the
first UI chunk writes it, a later chunk extends it when it adds a token pair, and never list it in
the Spec Manifest. The full suite and `boardsmith verify` still run it on every chunk. A guard holds
scans only; a test that mounts a component or cites a claim belongs in the chunk's test file. A guard
reads the game's source with `readFileSync` or an import ending `?raw`; the one game module it may
import is literal constants under `src/ui/`, such as the palette a contrast check reads (rule list
above).

1. **Keyboard-only ActionPanel completion.** A test that completes this chunk's action(s)
   through the ActionPanel using only keyboard events — no pointer/click simulation. Follow two
   precedents together, one for shape and one for real-wiring: `CardRenderer.a11y.test.ts`'s
   individual-control shape (mount the component, `trigger('keydown', { key: 'Enter' })`, assert
   the expected handler fired exactly once) for the control-level assertion, and the real wiring
   for the full completion path: a live `GameSession`, and the controller and board bridge built
   by `useTableActionWiring` from `boardsmith/ui`, the same function GameShell wires them with.
   A mocked controller misses the real
   `fill → fetchChoicesForPick → snapshotVersion++ → currentChoices` reactive chain, so this test
   must exercise the real wiring, not a mock. Never call `useActionController` and a board bridge
   by hand: which state fields the bridge reads is the engine's business, and it changes.

   ```typescript
   // Inside the test host component's setup().
   const seatState = ref(session.buildPlayerState(seat));   // re-read after every move
   const board = createBoardInteraction();
   provideBoardInteraction(board);
   const { controller, actionMetadata, disabledActions } = useTableActionWiring({
     seatState,
     availableActions: computed(() => seatState.value.availableActions ?? []),
     isMyTurn: computed(() => seatState.value.isMyTurn),
     playerSeat: ref(seat),
     boardInteraction: board,
     autoEndTurn: ref(true),
     isViewingHistory: ref(false),
     sendAction: (name, args) => session.performAction(name, seat, args),
     fetchPickChoices: async (action, pick, player, args) => session.getPickChoices(action, pick, player, args),
   });
   ```

   Re-read `seatState` from the session after each move, the way a broadcast arrives. Undo, rewind
   and a new game are handled from that state alone: the helper tears down an open pick when the
   state says the game tree changed, so a test never passes `restoreEpoch` or `gameInstanceId`.

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
   game's `src/ui` source for hardcoded color literals (hex/rgb values outside the
   `--bsg-*` token system) and, for any new game-local foreground/background token pair this
   chunk introduces, assert its contrast ratio meets the WCAG threshold. This grep-plus-contrast-
   assertion is what actually catches contrast regressions — `axe-core` in `jsdom` does not. Both
   are scans, so they go in the guard file `tests/guards/a11y-floor.test.ts`, never in a Spec
   Manifest file.

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
   forced motion sequence they can't opt out of. Pin reduced motion by behaviour, never by scanning
   the source for animation: with `prefers-reduced-motion: reduce` matched, one action puts the
   final state on screen at once and nothing on screen changes afterwards. A chunk that adds no
   animation still writes that test for the controls it adds; it is what fails when a later change
   animates them. To write it: jsdom has no `window.matchMedia`, so stub it with
   `vi.stubGlobal('matchMedia', ...)` returning `{ matches: true, media, addEventListener() {},
   removeEventListener() {} }` for `(prefers-reduced-motion: reduce)` before the test file's first
   mount (the engine reads the preference once, on first use). Use `vi.useFakeTimers()`, perform
   the action, assert the final state, then `vi.advanceTimersByTime` well past the longest
   transition the chunk could run (and `await nextTick()`) and assert the rendered output is
   unchanged.

## Failures Loop Back to `build`

A failure at any step in the ordered sequence above — including any of the five a11y floor
items — routes this chunk back to `build` (still session group 2, `{spec, build, test}`); it does not
advance to `audit`. `test` and `build` stay in the same group specifically so a failing test can
be fixed without a session handoff in between.

A failure is a failure of `build` at the role that did it: the first is retried once at that
role, and a second one goes one role up (`routing.md` "When a Step Fails: Once More at the Same
Role, Then One Role Up"). The build dispatch has
no check when it returns; its check is this step's verify. So the build's run log entry stays
`Outcome: pending` (with `Finished at: pending`) until this step's done gate answers, and is then
filled once: `Outcome: done` when it passes, or `Outcome: failed`, with the check that failed in
its Detail, when it does not. After a first failure, the next `build` goes to the same role again,
handed the failed check's output and recorded as a new `### Dispatch N` entry with
`Retry of: Dispatch N`, naming the failed build. After a second failure at `bounded`,
`npx boardsmith agent bounded --escalate` names the `judgement` agent that takes the next `build`,
recorded the same way. When `build` has failed twice at `judgement` too, stop and put it to the
designer (in orchestrated mode, a `repair-triage` gate) and dispatch nothing more for it until
they answer.

## Downstream Shape (cite, never restate)

Once every step above passes (and, for `ui: touches|major` chunks, all five a11y floor items
pass), this chunk is `Status: built` and ready for the `{audit, repair}` step group — authored in
Phase 145. This file does not restate that group's structure.
