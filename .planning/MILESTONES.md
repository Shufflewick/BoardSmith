# Project Milestones: BoardSmith

## v4.8 Battery Post-Mortem Fixes (Shipped: 2026-07-22)

**Phases completed:** 14 phases, 44 plans, 44 tasks

**Key accomplishments:**

- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Plan:
- Added an explicit `unbounded: true` opt-in on `loop()` that makes `maxIterations` optional for genuinely unbounded games, while keeping the bounded per-loop cap-hit as a loud safety assertion and the whole-flow runaway tripwire fully intact — verified with five new PROC-01 tests, two of which demonstrably failed against the pre-fix source.
- Added a pure, DOM-free WCAG relative-luminance `contrastInk` helper and wired it into `PlayerToken` so the identity-letter ink is black on light seat colors and white on dark, with the halo `text-shadow` derived opposite the chosen ink — replacing the previously hardcoded white ink that was invisible on light seats like the standard "White" (`#ecf0f1`) palette entry.
- Per-action `.suppressFromDock()` rides the existing `actionMetadata` channel (mirroring `manual` exactly) to hide one action's dock button while it stays fully board-executable; the blunt `suppressActionPanel` prop is renamed to the loud, platform-only `platformActionPanelEscapeHatch`, and GameShell now falls back to the bare turn-prompt strip whenever every available action's dock button is suppressed — never a silent zero-indicator board.
- Unified GameShell's board + sidebar-extra `:state` slots on a single `displayedState` computed (historical during time-travel, live otherwise) and gated all four `useBoardActionBridge` mutating functions on `isViewingHistory`, so a board click during time-travel is now a defense-in-depth inert no-op instead of a possible live-engine mutation.
- Fixed the `bs-build-chunk` close ceremony to release its session lock (root-fixing the run-004 same-day false-alarm), sourcing the lock timestamp only from an explicit `date -u` clock-read and adding a session/chunk identity to the lock grammar — verified by 10 new failing-first drift assertions across two vitest suites.
- Fenced the game/library boundary into the `bs-build` skill: a new "## Boundaries" section in build.md forbids patching or suppressing anything under `node_modules/boardsmith` (a read-only live symlink) and mandates filing library gaps instead, `investigate.md` carries the read-only rule forward before any fix is proposed, `final-acceptance.md` forbids overruling an explicit client instruction, and build.md's UI section now forbids the fenced `platformActionPanelEscapeHatch` without the client while naming `.suppressFromDock()` as the only sanctioned per-action dock-hiding mechanism — all verified by 10 new failing-first drift assertions.
- Moved the human client-playtest stop from every chunk to exactly three sketch-time-flagged milestone chunks (core-loop, scoring/endgame, final-acceptance) plus an always-stop for genuine rules adjudication — the highest-leverage autonomy lever in the phase.
- Codified the ask triple-gate (undetermined + load-bearing + no reasonable default, else proceed and record) with a batched open-questions queue, and retired the residual print-and-hand-off stop so cross-chunk continuation — including generate-AI → final-acceptance — auto-advances by default with the printed resume command surviving only as a crash fallback.
- Added an explicit >=50% context wind-down floor beneath the existing 60% harness-warning ceiling, codified sub-agent offload of research/audits/large reads/repairs as the lever that keeps the main thread under the ceiling while still clearing the floor, and gave the game's actual finish a loud delimited banner + three-field summary card distinct from a new lighter per-chunk completion line.
- Closed the three B.9 "green but wrong" process gaps: a close-time step that reconciles the filings/asset-debt/waived-chunk ledgers against what each chunk actually changed and re-touches stale paperwork on a fix, a strengthened RULINGS.md re-touch obligation, and a fail-loud assertion that a random-sim (and, by extension, a human playtest) actually exercised this chunk's new actions rather than passing on the four zero-checks alone.
- Wove an explicit "autonomy = how-not-what; surfaced never fabricated" statement into state-machine.md's top-level prose (mirrored in build-chunk.md), then added a six-discipline "Part D survives the autonomy rewrite" regression describe block that verified — with zero restoration needed — every Part D provenance discipline (escalate-don't-hack, reuse-not-rebuild, honest-derived labeling, surface-don't-fabricate, in-process redteam, build-literally) survived Plans 01-04's autonomy rewrite intact; closed the phase with a green full-suite gate (317 bs tests, 3110 project-wide).
- Wrote docs/seed-to-state.md establishing that loading a game into an exact playtest state is already solved via the existing GameRunner.fromSnapshot state-authoritative restore — the only new work is a record-from-play authoring recipe and a small `--seed` dev-host wiring flag — backed by a citation-existence guard test that verifies every cited source file against the real codebase.
- Wired a `--seed <file>` dev-host flag that seeds `boardsmith dev`'s initial game state from a recorded `GameStateSnapshot` via the EXISTING `runnerFromSnapshot`/`stateEnvelope` load path (no rebuilt load machinery), proven by a record→seed→load→assert integration test with four legs: distinct-mid-game RECORD, exact-state PASS-WITH, differs-without FAIL-WITHOUT, and byte-identical LOAD-TWICE-IDENTICAL.
- Built the grep-verified SC-5/PROC-01 removal gate: a per-filing crosswalk from all 5 game repos' own bug ledgers (lanternfall BUG 1-7, seven BSR-1..12, one-two-punch BUG 1-8, doom-machine BS-1..11, BoardSmithGames2/seven BUG-01..05) to their v4.8 Dxx defects, paired with a PRESENT/ABSENT verdict for each fix's exact code anchor in this library repo's live source.
- Conservative gated sweep of lanternfall: BUG 6's stale loop-valve comment refreshed (D29 confirmed PRESENT, valve kept), BUG 7's metadata guard removal attempted-and-reverted after proving it turns the suite red (D26 confirmed PRESENT but guard is genuinely defensive, not dead weight), lanternfall's AI recorded as untracked-but-passing for BSR-12.
- Removed seven's now-redundant `.notUndoable()` re-guard docs (BSR-5/D1) and `concealFromEverySeat` element-hide compensating call (BSR-1/D24); flipped 5 self-cancelling undo tripwires + 1 unrelated ActionBuilder.manual() tripwire from `it.fails` to passing; re-verified BSR-12/D9 AI closed via a scratch repro — suite went from a previously-unnoticed 196/205 to 204/205, with the 1 residual failure an unrelated pre-existing SIM-family issue.
- Kept the reimplemented undo guard after empirically proving it load-bearing beyond BUG 3, and closed BSR-12 (BUG 8) by confirming the upstream MCTS now uses a redacted per-seat clone plus a pre-reveal simultaneous baseline.
- Deferred the risky D9/BS-5 native-multiSelect rewrite with comment-only refresh, kept D12/D23 targets as load-bearing (not pure workarounds), and reclassified BS-10 as a game-side art-path fix already handled — one file-scoped commit on `sweep/v4.8-dework`, doom-machine's suite unchanged at 399/405.
- Closed BOARDSMITH-BUG-02 (its own repo's `.notUndoable()` filing) by flipping the pinned-defect test block to assert the now-correct refused-undo behavior, verified BSR-12 via a scratch AI repro that plays a full game to completion, and rendered the phase's final aggregated BSR-12 CLOSED verdict plus complete 5-repo ledger reconciliation.

---

## v4.7 Playtest Follow-Up Fixes (Shipped: 2026-07-06)

**Delivered:** Closed the three tracked follow-ups from v4.6's human playtest — DEF-A (generated-game asset completeness), DEF-C (dev-host multi-client reconnect turn-desync), and DEF-B propagation to MERC — hardening the `bs-` pipeline's output and the dev host, then proving it all reaches the most complex vendored consumer.

**Phases completed:** 3 phases (152–154), 8 plans, 10 tasks. BoardSmith suite 2677 green; MERC 738/7 green.

**Key accomplishments:**

- **DEF-A (Phase 152):** `generateAssetImageVue()` emits a preload-then-swap `AssetImage.vue` into every `npx boardsmith init` project so missing/unresolved card or piece art always degrades to a drawn game-semantic fallback, never a broken `<img>`. Extended in scope (user-approved) to fix BoardSmith's own AutoUI `CardRenderer`/`PieceRenderer`, which carried the identical unguarded-`<img>` bug — so `ui:auto` games are covered too.
- **DEF-A gate (Phase 152):** `scanAssetReachability(cwd)` — a file-system-only bare-`<img>` static gate (never an HTTP probe; Vite's SPA fallback 200s a missing asset), wired build-blocking into the `bs-build-chunk` `test` step so an asset-referencing-but-asset-less game FAILS instead of shipping green — the exact gap that let DEF-A ship. Real-browser Playwright proof confirmed zero visible broken images with no hand-added assets.
- **DEF-C (Phase 153):** Root cause *empirically reproduced*, then fixed — a stale-socket `close` handler in `dev.ts` that orphaned a reloaded client (new socket's `hello` races ahead of the old socket's `close`, which then wrongly marked the reconnected seat disconnected and dropped its broadcasts). A one-line socket-identity guard, TDD RED→GREEN real-`ws` regression test, later refactored into a shared `connection-handler.ts` both `dev.ts` and the test import (so the test guards the literal code). Playwright 5× reload-storm + reconnect + AI-handoff proof: client never orphaned.
- **DEF-B propagation (Phase 154):** Re-vendored MERC to current BoardSmith HEAD (carrying DEF-B `281e8155` + the v4.7 fixes); MERC's full suite passes at baseline (738 passed / 7 skipped), no MERC-side changes needed — the milestone's capstone cross-repo integration proof.
- **Both automated quality gates earned their keep:** code review caught a genuine critical in Phase 152 (the shipped `AssetImage.vue` didn't reset on `src` change) and a maintainability drift-risk in Phase 153, both fixed and regression-locked.

**Known deferred items at close:** 5 pre-existing, non-v4.7 open artifacts acknowledged (see STATE.md Deferred Items) — a stale knowledge-base debug session + 4 dev-host/UI todos (AI open-seat scheduling, debug-toggle panel, standalone-shell height gap, Slate token/a11y polish). None are v4.7 scope.

---

## v4.4 Agent-Ergonomics Gaps (Audit Fixes) (Shipped: 2026-07-02)

**Delivered:** Closed every verified gap from the 2026-07-01 agent-ergonomics audit — hidden-info verification, headless simulation, structured errors, a fully scriptable dev host, an animation/drag-drop test story, and flow/debug introspection with enforced determinism — then updated docs and migrated all example games + MERC onto the new surface.

**Phases completed:** 8 phases (123-130), 28 plans

**Key accomplishments:**

- **Determinism & flow introspection (123):** killed every `Math.random` fallback in `space.ts`/`element-collection.ts`, deterministic-by-default `playUntilComplete`, `describeFlowPosition`/`getFlowDebugInfo`, `TestGame.getPendingAction`/disabled-choices introspection, and devtools + `debug:flow-state` WS parity.
- **Hidden-info test utilities (124):** `isElementVisible`/`getVisibleElements`/`assertHidden`/`assertVisible` derived from the final post-`playerView` wire tree, `diffPlayerViews` (structured + `describe()`), and an async DOM-leak matcher (`renderAsSeat`/`assertNoHiddenInfoLeak`) with auto-derived markers + proven positive controls.
- **Headless simulation (125):** `createHeadlessSession` promoted to the public `boardsmith/session` export (clean break), plus a seeded `boardsmith simulate` CLI (`--json`, non-zero exit on failure, replay hints).
- **Structured error surfacing (126):** structured `warnings[{code,message,source}]` on pick/op results, runner `ENGINE_ERROR`/`ACTION_EXECUTION_ERROR` codes threaded through the bridge wire, `onPersistenceError`/`persistenceHealthy` on both hosts, and a dev-host `debug:logs` ring-buffer op + DebugPanel Logs tab.
- **Scriptable dev host (127):** `getState`/`getLobby`/`debugToggle`/`uiSwitch` WS ops, a Node-capable `GameConnection` (injectable `globalThis.WebSocket`), and `createDevHostClient` proven by a browserless real-WS integration test.
- **Animation & drag-drop test story (128):** a Vue-free animation test mode + trace recorder, direct unit tests for all five animation/drag composables (previously zero), and fail-loud missing-anchor throws via `isDevThrowEnabled()`.
- **Migration + docs (129/130):** all 8 games + MERC re-vendored green (fixed a real eager `@vue/test-utils` import regression), and seven docs updated in place with every claim grep-verified against `src/`.

**Stats:** `src/` 99 files changed, +9,737/-303 lines · 8 phases, 28 plans · git range 9b01726..v4.4 (185 commits) · started 2026-07-01, shipped 2026-07-02.

**Verification:** 23/23 requirements · 8/8 phases `passed` · cross-phase integration 7/7 wired · 3/3 E2E agent flows proven · BoardSmith 159 files / 2081 tests + all 8 games (go-fish 84, cribbage 22, checkers 38, hex 19, polyhedral 24, demo-animation 9, demo-complex-ui 4) + MERC re-vendored 738/7 green. Audit passed (`milestones/v4.4-MILESTONE-AUDIT.md`).

**Tech debt carried:** 2 pre-existing eslint no-shadow errors in `useFlyingElements.ts`; pre-existing tsc test-file looseness in some `src/ui` test files; pending dev-host Debug-toggle panel todo. All predate v4.4, non-blocking.

## v4.1 Tutorial Primitives (Shipped: 2026-06-30)

**Phases completed:** 8 phases, 35 plans, 61 tasks

**Key accomplishments:**

- One-liner:
- `src/engine/tutorial/gate.ts`
- Per-selection `suppressAutoFill` guard wired into `useActionController.tryAutoFillSelection` so tutorial steps can preserve the learner's click when a single enabled choice would otherwise auto-resolve
- One-liner:
- `Annotation[]` discriminated-union content model on TutorialStep and TutorialStepView with AnnotationTarget (element/action/panel), engine-local ElementRef, and a projection round-trip guard test
- `anchorAttrs(ref: ElementRef): Record<string, string>`
- 1. [Rule 3 - Blocking] CSS.escape unavailable in jsdom test environment
- TutorialOverlay mounted in GameShell .boardregion and MR-01 closed: suppressAutoFill now live in production via tutorialStep computed threaded into useActionController
- Dual-path parity proof via MinimalAutoUIRenderer (useSelectable path) and MinimalCustomUIRenderer (anchorAttrs path) producing identical rings and bubble text for element and action targets, with non-vacuity grep enforced
- One-liner:
- `src/engine/tutorial/predicates.ts`
- Post-action advanceWhen predicate pump wired into GameSession with flash-and-skip guard, fail-loud MR-03 start validation, and engine-delegated step transitions
- `src/testing/simulate-tutorial.ts`
- In-repo criterion #3 proof: `simulateTutorial` with `afterTurns`+`whenForced` is GREEN on intact rules and RED on two deliberate breaks (gate drift via tutorial def change, predicate drift via capture-rule removal)
- 1. [Rule 1 - Bug] Fixed early-return path returning wrong type
- Transient hint/heatmap teaching state injected post-buildPlayerState into broadcast, with per-seat DoS guards and undo/rewind clear via replaceRunner callback.
- `onBeforeMove` narration seam in AIController + GameSession all-seats demo mode with configurable delay and narrator, cleanly restoring the original controller on stop.
- HintOverlay, HeatmapOverlay, and narration card render teaching aids via shared data-bs-el-id anchors — identical in custom UI and AutoUI — with ControlsMenu Teaching group wired to platformRequest ops for Phase 109 bridge integration.
- 1. [Rule 1 - Bug] Test spy corrected from start() to execute()
- One-liner:
- SelectionMatcher type + per-selection getGateReasonForValue: gate piece-by-id and destination-by-toNotation independently within a two-step action
- `src/session/stateless-ops.ts`
- CHECKERS_TUTORIAL teaching mandatory-capture + two-step gated move + multi-jump via deterministic b6->d4->b2 preset registered on gameDefinition
- CI-verifiable checkers tutorial test (TUT-04): intact walkthrough via simulateTutorial + assertTutorialCompletes, plus green→red proof that playerHasCaptures enforces the capture-tip CHK-02 predicate
- 1. [Rule 1 - Bug] Null guard in mergeTransientState for stub views
- hint op runs MCTS bot.play() + extracts board target; heatmapToggle runs playWithStats() + deduplicates by cell key; both store results in SnapshotSessionHost transientTeachingState and re-broadcast; hint clears on next action, all clears on undo
- aiSuggest op previews MCTS move read-only; runDemoLoop narrates before executing the exact same args; demoAbort checked before AND after delay; finally always clears demoRunning; fake-timer tests assert vi.getTimerCount()===0 after stop AND game-over
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:

---

## v4.0 UI Redesign (Slate) (Shipped: 2026-06-23)

**Delivered:** Rebuilt the entire BoardSmith UI on a single load-bearing `--bsg-*` token system in the neutral "Slate" design language (graphite palette, single teal accent, Hanken Grotesk + JetBrains Mono, OS light/dark), got the chrome out of the board's way, and closed the critical accessibility gaps — without breaking a single game.

**Phases completed:** 7 phases (97-103), 42 plans

**Key accomplishments:**

- **Single token contract (Wave 1/98):** collapsed three color namespaces (`--bs-*`/`--bg-*`/`--bsg-*`) into one `--bsg-*` system emitted by `theme.ts` with full Slate defaults, OS light/dark, `applyTheme()` as the sole host-overridable knob, and a `color-no-hex` stylelint guard.
- **Neon → Slate sweep (Wave 2/99):** swept all 8 renderers + chrome + DevHost from neon literals to tokens — teal primary button, `outline`-not-`border` selection, solid display type, shared tokenized card back, calm active-player cue — verified by both-theme contrast assertions (caught 5 invisible-text cases).
- **Board is the hero (Wave 3/100):** no standing header in platform mode, turn status + always-on prompt, action dock only when actionable, fluid container-query board sizing (retired the zoom-as-fit crutch), real responsive tiers, ControlsMenu, and a Game Over result card.
- **WCAG 2.2 AA (Wave 4/101):** closed the two Critical findings — a shared `useSelectable()` keyboard composable across all 8 renderers (drag preserved as enhancement) and board-anchored action-panel parity — plus live regions, dialog focus-traps, non-color cues, focus-visible, reduced-motion, and a contrast/target sweep.
- **Dev/debug parity (Wave 5/102):** Slate DebugPanel with ARIA tabs, dev chrome collapse-to-tab, working seat switcher + presence strip + Table-setup panel, voiced states, read-only history, two-click New-Game confirm, and a neutral material layer.
- **Cross-repo verified (103):** all 8 `~/BoardSmithGames/` games + MERC (the canary, 738 tests) build and pass; browser-verified the Slate chrome across hex / cards / grid renderers + a custom UI with zero console errors. BoardSmith: 1245/1245 tests, lint:css clean.

**Stats:** 196 files changed, +31,251 / -1,933 lines · 7 phases, 42 plans · ~9 hours (2026-06-22 23:14 → 2026-06-23 08:03).

**Known deferred items at close:** 3 follow-up todos (dev-standalone shell height gap; pre-existing dev-host AI-turn issue — not a v4.0 regression; Slate token/a11y polish incl. the platform-mode connection-announce seam) + Phase 101 manual AT spot-checks (covered by the Phase 103 browser pass). See `.planning/todos/pending/` and `milestones/v4.0-MILESTONE-AUDIT.md`.

**Out of scope (deferred to a future host milestone):** the ShufflewickPub host skin (lobby, GameFrame, PrimeVue preset, connection banner) — HOST-01..04. The BoardSmith-side token/`applyTheme`/postMessage infra is host-overridable and ready.

## v3.0 Animation Timeline (Shipped: 2026-02-08)

**Delivered:** Replaced v2.9 theatre view and mutation capture with a client-side animation timeline -- animation events are a pure data channel, playback is 100% client-owned, and the server never waits on animation state.

**Phases completed:** 85-90 (6 phases, 10 plans total)

**Key accomplishments:**

- Complete theatre erasure -- removed all theatre state, mutation capture, and acknowledgment code across engine, session, client, and UI layers
- Pure data animation API -- `game.animate(type, data)` emits data events with optional callback, no mutation capture
- Command stack integration -- animation events recorded as `AnimateCommand` entries for future replay/rewind
- Client-side animation queue -- FIFO processing with wait-for-handler semantics, configurable timeout, and reactive state
- AbortSignal support -- `skipAll()` aborts in-flight animation handlers via cooperative cancellation
- Documentation and migration -- updated docs, created migration-guide.md, migrated demo-animation and cribbage games

**Stats:**

- 63 files modified
- +6,435 / -3,315 lines TypeScript/Vue
- 6 phases, 10 plans, 47 commits
- 1 day from start to ship (2026-02-07 to 2026-02-08)
- 61 new animation tests, 540 total passing

**Git range:** `feat(85-01)` to `chore: remove orphaned acknowledgeAnimationEvents`

**What's next:** Animation system complete. Ready for next milestone.

---

## v2.9 Theatre View (Shipped: 2026-02-07)

**Delivered:** Replaced fire-and-forget animation events with scoped `game.animate()` callbacks that capture mutations per event, maintain a theatre view (pre-animation state advancing per-acknowledgment), and thread that view through session and UI so components never show "the future" while animations play.

**Phases completed:** 80-84 (5 phases, 11 plans total)

**Key accomplishments:**

- `game.animate(type, data, callback)` scoped callback API with mutation capture — element tree changes and custom property changes tracked per animation event
- Theatre state engine with lazy snapshot, per-event advancement, and serialization round-trip safety
- Session integration — theatre view as default in `buildPlayerState()`, bandwidth-optimized `currentView` opt-in, WebSocket `acknowledgeAnimations` handler
- UI composables — `useCurrentView()` truth opt-in, per-event acknowledge in `processQueue`, GameShell wired with ActionPanel gating
- Clean break — `emitAnimationEvent()` removed entirely, demo-animation and cribbage games migrated to `game.animate()`
- Client type alignment — `PlayerState` type updated to match server `PlayerGameState`, eliminating `as any` casts

**Stats:**

- 25 source files modified
- +2,841 / -135 lines TypeScript/Vue
- 5 phases, 11 plans, 49 commits
- 1 day from start to ship (2026-02-06 → 2026-02-07)
- 100 new tests + 119 migrated, 633 total passing

**Git range:** `docs(80)` → `fix: align client PlayerState type`

**What's next:** Animation pipeline complete. Ready for next milestone.

---

## v2.8 Disabled Selections (Shipped: 2026-02-06)

**Delivered:** Added `disabled` state to element and choice selections with mandatory reason strings, threaded through engine, session, and UI layers with defense-in-depth enforcement.

**Phases completed:** 75-79 (5 phases, 8 plans total)

**Key accomplishments:**

- `AnnotatedChoice<T>` type system with `disabled: string | false` enforcing reason strings (pit of success)
- Disabled callbacks on `chooseElement`, `fromElements`, `chooseFrom` with filter/disabled separation
- Session wire threading — `ValidElement` and `ChoiceWithRefs` carry `disabled?: string` through PickHandler
- Full UI rendering — ActionPanel disabled buttons with tooltips, `bs-element-disabled` CSS, custom UI API
- Defense in depth — disabled enforced at engine validation, client fill() rejection, and board click guard
- Gap closure — Phase 79 fixed element-type picks dropping disabled in `getChoices()`, caught by audit

**Stats:**

- 18 source files modified (51 total with planning)
- +1,126 / -116 lines TypeScript/Vue
- 5 phases, 8 plans, 15 tasks
- 2 days from start to ship (2026-02-05 → 2026-02-06)
- 27 disabled-specific tests added

**Git range:** `feat(75-01)` → `fix(79-01)`

**What's next:** Feature complete. Ready for next milestone.

---

## v2.7 Dead Code & Code Smell Cleanup (Shipped: 2026-02-02)

**Delivered:** Eliminated all identified dead code, type duplication, and code smells — fixing stale config paths, consolidating lobby types, removing deprecated flying APIs, extracting shared helpers, and documenting breaking changes.

**Phases completed:** 69-74 (6 phases, 6 plans total)

**Key accomplishments:**

- Fixed stale config paths in vitest.config.ts and eslint.config.mjs
- Consolidated 4 duplicated lobby types (LobbyState, SlotStatus, LobbySlot, LobbyInfo) to types/protocol.ts
- Removed deprecated flyCard/flyCards/FlyCardOptions APIs after migrating internal callers
- Extracted shared helpers from FlowEngine and useActionController (~130 lines deduplication)
- Replaced module-level suppressNextWatcherFetch flag with scoped fetchedSelections Set
- Created BREAKING.md with v2.7 migration guide for external users

**Stats:**

- 418 files changed
- +10,259 / -62,541 lines (massive cleanup!)
- 6 phases, 6 plans
- Same day ship (2026-02-01 → 2026-02-02)

**Git range:** `826c5ed` → v2.7 tag

**What's next:** Codebase pristine. Ready for next milestone.

---

## v2.6 Code Consolidation (Shipped: 2026-01-29)

**Delivered:** Fixed "Pit of Success" violations in animation API consolidation — restoring multi-container FLIP support, adding flyOnAppear helper, and implementing autoWatch for automatic cross-container flying animations.

**Phases completed:** N/A (post-mortem driven, no formal phases)

**Key accomplishments:**

- Extended `useFLIP` with `containers` array for multi-container FLIP animations
- Added `flyOnAppear()` helper to `useFlyingElements` for declarative fly-on-appear
- Added `autoWatch` option for automatic cross-container flying (replaces useAutoAnimations)
- Added `countBasedRoutes` for tracking hidden element movements
- Deleted 7 deprecated composables (clean break, no backward compatibility)
- Updated documentation with migration examples

**Stats:**

- 32 files changed
- +391 / -2,610 lines (net reduction!)
- 0 phases (direct implementation from post-mortem feedback)
- Same day ship (2026-01-29)

**Git range:** `ab2450a` → v2.6 tag

**What's next:** Animation API consolidation complete. Ready for next milestone.

---

## v2.5 Player Colors Refactor (Shipped: 2026-01-25)

**Delivered:** Engine-managed player colors with `player.color` property, game-level color configuration, lobby color picker, and automatic conflict validation — eliminating the fragmented `DEFAULT_PLAYER_COLORS` pattern.

**Phases completed:** 64-68 (5 phases, 5 plans total)

**Key accomplishments:**

- Added `player.color` property auto-assigned by engine from configurable palette
- Game-level `colors` and `colorSelectionEnabled` configuration in GameOptions
- Color conflict validation in lobby with clear error messages
- Auto-injected color picker in WaitingRoom when enabled
- Conditional player color indicators in PlayersPanel
- Deprecated DEFAULT_PLAYER_COLORS with migration guidance
- Migrated Hex and Checkers games to new API

**Stats:**

- 37 files changed
- +4,130 / -81 lines
- 5 phases, 5 plans
- 47 days from start to ship (2025-12-09 → 2026-01-25)

**Git range:** `fb42d3f` → `826c5ed`

**What's next:** Player color system complete. Ready for next milestone.

---

## v2.4 Animation Event System (Shipped: 2026-01-22)

**Delivered:** Infrastructure-level support for dramatic UI playback of game calculations — enabling games to animate combat sequences, card draws, and other events while game state advances immediately (soft continuation pattern).

**Phases completed:** 59-63 (5 phases, 6 plans total)

**Key accomplishments:**

- Added `game.emitAnimationEvent(type, data, options?)` API with unique IDs and timestamps
- Animation buffer serializes/restores with game state (checkpoint/replay safe)
- Session layer exposes `animationEvents` array and `acknowledgeAnimations()` method
- Created `useAnimationEvents` composable with handler registration, skip, and pause control
- ActionPanel automatically gates on pending animations (`showActionPanel` computed)
- Documented animation event system in ui-components.md and nomenclature.md

**Stats:**

- 42 files changed
- +7,668 / -107 lines
- 5 phases, 6 plans
- Same day from start to ship (2026-01-22)

**Git range:** `ebcb3b2` → `0e2ab7d`

**What's next:** Animation infrastructure complete. Ready for game developers to implement custom animations.

---

## v2.3 Nomenclature Standardization (Shipped: 2026-01-22)

**Delivered:** Consistent terminology across the entire codebase, documentation, and games — standardizing on Table (not Board), Seat (not Position), and Pick (not Selection) before external adoption.

**Phases completed:** 54-58 (5 phases, 14 plans total)

**Key accomplishments:**

- Created authoritative `docs/nomenclature.md` with 33 terms across 7 categories
- Renamed `GameBoard.vue` → `GameTable.vue` in all 4 extracted games and CLI templates
- Renamed `Player.position` → `Player.seat` across engine, session, client, and UI layers
- Renamed `currentSelection` → `currentPick` and `SelectionHandler` → `PickHandler` with deprecation aliases
- Created `docs/migration-guide.md` with v2.3 API rename tables and migration steps
- Cross-referenced nomenclature.md from all key documentation entry points

**Stats:**

- 174 files changed
- +20,420 / -20,246 lines (net +174 lines of terminology changes)
- 5 phases, 14 plans
- 44 days from start to ship (2025-12-09 → 2026-01-22)

**Git range:** `7ba2826` → `2a431ec`

**What's next:** Terminology standardized. Ready for external adoption or next milestone.

---

## v2.2 Game Design Aspects (Shipped: 2026-01-21)

**Delivered:** Added composable aspect templates (Dice, PlayingCards, HexGrid, SquareGrid) to `/design-game` that auto-detect from interview answers and merge into generated code.

**Phases completed:** 51-53 (3 phases, 3 plans total)

**Key accomplishments:**

- Created 4 aspect templates with element setup, action patterns, and UI components
- Keyword-based aspect detection added to interview (Phase 2B)
- Multiple aspects can be detected and combined in a single game
- Templates embedded inline in instructions.md (self-contained skill)
- Aspect templates include findElements(), safe defaults, documentation links
- E2E flow verified: Interview → Detection → Template Access → Generation

**Stats:**

- 16 files changed
- +4,031 / -167 lines
- 3 phases, 3 plans
- 1 day from start to ship (2026-01-21)

**Git range:** `1ba5985` → `604160f`

**What's next:** Aspect system complete. Ready for nomenclature standardization.

---

## v2.1 Design-Game Skill Redesign (Shipped: 2026-01-19)

**Delivered:** Transformed `/design-game` from a monolithic code generator into an iterative, state-driven skill that guides non-programmer game designers through building games one phase at a time.

**Phases completed:** 47-50 (4 phases, 7 plans total)

**Key accomplishments:**

- State detection routes designers to interview (new), continuation (complete), or resume (in-progress)
- 6-question structured interview gathers core mechanics without scope creep
- Governor pattern (ACDR) captures deferred ideas while maintaining focus
- Code generation produces minimal playable game (elements, game, flow, actions)
- Continuation flow: playtest feedback → ranked options → mini-interview → feature generation
- Resume flow: checkpoint-based recovery with three-level error hierarchy
- Self-contained slash commands (no external file permission prompts)
- `npx boardsmith claude` installs everything with a single command

**Stats:**

- 5 files changed
- +1,320 / -194 lines (1,342-line instructions.md)
- 4 phases, 7 plans
- Same day from start to ship (2026-01-19)

**Git range:** `9cd5c30` → `dff1e6b`

**What's next:** /design-game skill complete. Ready for real-world testing with game designers.

---

## v2.0 Collapse the Monorepo (Shipped: 2026-01-19)

**Delivered:** Transformed BoardSmith from a pnpm monorepo with 12 `@boardsmith/*` packages into a single `boardsmith` npm package with 11 subpath exports, extracted all games to separate repos.

**Phases completed:** 39-46 (8 phases, 23 plans total)

**Key accomplishments:**

- Replaced 12 separate packages with single `boardsmith` npm package
- Consolidated 179 source files into unified `src/` structure (git history preserved)
- Configured 11 subpath exports (`boardsmith`, `boardsmith/ui`, `boardsmith/session`, etc.)
- Colocated all library tests (*.test.ts next to source files)
- Rewrote all internal imports to relative paths
- Extracted 9 games to `~/BoardSmithGames/` as standalone git repos
- Updated CLI for both monorepo and standalone game contexts
- Complete migration guide for external team

**Stats:**

- 293 files changed
- +19,773 / -7,278 lines
- 8 phases, 23 plans
- 2 days from start to ship (2026-01-18 → 2026-01-19)

**Git range:** `5bba218` → `d3fd429`

**What's next:** Package structure complete. Ready for v2.1 enhancements or new features.

---

## v1.2 Local Tarballs (Shipped: 2026-01-18)

**Delivered:** Parallel development workflow with `boardsmith pack` command producing immutable tarball snapshots.

**Phases completed:** 37-38 (2 plans total)

**Key accomplishments:**

- `boardsmith pack` command with timestamp versioning
- `--target` flag for consumer project integration
- Vendor directory management with dependency updates

**Stats:**

- 12 files modified
- +1,200 lines
- 2 phases, 2 plans
- 1 day from start to ship

**Git range:** `feat(37-01)` → `docs(38)`

**What's next:** Monorepo collapse (v2.0)

---

## v1.1 MCTS Strategy Improvements (Shipped: 2026-01-16)

**Delivered:** Advanced MCTS search techniques including playout lookahead, threat response, RAVE, gradient objectives, dynamic UCT, and proof number search - making AI play strategically better with measurable improvements.

**Phases completed:** 29-36 (+30.1 inserted), 10 plans total

**Key accomplishments:**

- Playout lookahead with depth-based presets (+17.5% P1 win rate)
- Threat response forcing via threatResponseMoves hook (blocks straight-line exploits)
- RAVE algorithm for rapid action value estimation across simulations
- Gradient objectives (0-1) replacing boolean win/loss for finer evaluation
- Dynamic UCT constant tuned by game phase (exploration → exploitation)
- Proof Number Search (+7.5% P2 win rate as disadvantaged player)

**Stats:**

- 35 files modified
- +4,943 / -152 lines
- 9 phases (including 30.1), 10 plans
- 2 days from start to ship (2026-01-15 → 2026-01-16)

**Git range:** `27c7892` → `08cd681`

**What's next:** AI system complete. Ready for new features or next milestone.

---

## v0.4 Public API Docs (Shipped: 2026-01-09)

**Delivered:** Comprehensive JSDoc documentation for all public APIs in @boardsmith/engine and @boardsmith/testing packages, enabling IDE autocompletion and clear API understanding.

**Phases completed:** 10 (3 plans total)

**Key accomplishments:**

- Element system JSDoc: Game, GameElement, Space, Piece, Card, Deck, Hand, Die, Grid classes
- Action/flow system JSDoc: Action builder methods, ActionExecutor, FlowEngine class docs
- Testing package JSDoc: TestGame, assertions, fixtures, debug utilities with @throws and @example
- Package-level @packageDocumentation with usage examples
- Established patterns: @module, @internal, @typeParam, @throws

**Stats:**

- 14 files modified
- +866 / -78 lines
- 1 phase, 3 plans
- Same day start to ship (2026-01-09)

**Git range:** `docs(10-01)` → `docs(10-03)`

**What's next:** Documentation complete. Ready for new feature work.

---

## v0.3 Flow Engine Docs (Shipped: 2026-01-09)

**Delivered:** Section dividers and JSDoc improvements to the 1032-line FlowEngine file, following the established MCTS Bot documentation pattern.

**Phases completed:** 9 (1 plan total)

**Key accomplishments:**

- 7 section dividers grouping major FlowEngine subsystems
- Enhanced JSDoc for 3 key complex methods (run, executeActionStep, resumeSimultaneousAction)
- Section divider pattern now applied to both major engine files

**Stats:**

- 4 files created/modified
- +192 / -23 lines
- 1 phase, 1 plan
- Same day start to ship (2026-01-09)

**Git range:** `docs(09-01)` commits

**What's next:** Public API JSDoc documentation (v0.4)

---

## v0.2 Concerns Cleanup (Shipped: 2026-01-09)

**Delivered:** Addressed all technical concerns from v0.1: eliminated type assertions, added error logging, improved documentation, and updated CONCERNS.md with resolution status.

**Phases completed:** 5-8 (10 plans total)

**Key accomplishments:**

- Type-safe choice validation with type guards (eliminated `as any` in useActionController)
- WeakMap pattern for DOM metadata storage (eliminated `as any` in useZoomPreview)
- Added error logging for silent catch blocks (boardRefs, JSON.parse)
- Added MCTS Bot documentation (7 section dividers + JSDoc improvements)
- Removed incomplete API (unused withChoices parameter)
- Added fallback checker warnings in code-generator
- Updated CONCERNS.md with all resolution statuses

**Stats:**

- 33 files created/modified
- +2,091 / -131 lines
- 4 phases, 10 plans
- 2 days from start to ship (2026-01-08 → 2026-01-09)

**Git range:** `docs(05)` → `docs(08-01)`

**What's next:** Project goals achieved. Ready for new feature work or next refactoring milestone.

---

## v0.1 Large File Refactoring (Shipped: 2026-01-08)

**Delivered:** Split four largest files (8,325 lines total) into 16 focused modules while preserving all public APIs and maintaining 442 passing tests.

**Phases completed:** 1-4 (14 plans total)

**Key accomplishments:**

- GameSession refactored: 2,585 → 1,249 lines (52% reduction) with 5 extracted modules
- useActionController refactored: 1,807 → 1,423 lines (21% reduction) with 3 extracted files
- Action module refactored: 1,845 → 1,361 lines (26% reduction) with builder/executor separation
- Test suite restructured: 2,088 lines split into 3 focused files with shared helpers
- All 442 unit tests passing, zero regressions

**Stats:**

- 48 files created/modified
- +8,183 / -3,461 lines (net +4,722)
- 4 phases, 14 plans, ~50 tasks
- 1 day from start to ship (2026-01-08)

**Git range:** `feat(01-01)` → `docs(04-03)`

**What's next:** Milestone complete. Project goals achieved.

---

- **v4.6 BS Skills (Rulebook-Driven Game Building)** — SHIPPED 2026-07-05 — Phases 140-149, 34/34 requirements, audit passed. `bs-` skill family (rulebook→game pipeline) replaces `/design-game`; proven end-to-end vs Go Fish. Known deferred items at close: 7 (see STATE.md Deferred Items).
