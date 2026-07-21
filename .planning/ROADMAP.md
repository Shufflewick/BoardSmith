# Roadmap — BoardSmith

## Milestones

- ✅ **v4.7 Playtest Follow-Up Fixes** — Phases 152–154 (shipped 2026-07-06) — 5/5 requirements; closed DEF-A (asset completeness), DEF-C (dev-host reconnect turn-desync), and propagated DEF-B to MERC (738/7 green). Full detail: [`milestones/v4.7-ROADMAP.md`](milestones/v4.7-ROADMAP.md) · [requirements](milestones/v4.7-REQUIREMENTS.md) · [audit](milestones/v4.7-MILESTONE-AUDIT.md)
- ✅ **v4.6 BS Skills (Rulebook-Driven Game Building)** — Phases 140–151 (shipped 2026-07-05; reopened + re-closed same day for the human-playtest follow-up, Phases 150–151) — 36/36 requirements, human gate CLOSED, `v4.6.1` — full detail: [`milestones/v4.6-ROADMAP.md`](milestones/v4.6-ROADMAP.md) · [requirements](milestones/v4.6-REQUIREMENTS.md) · [audit](v4.6-MILESTONE-AUDIT.md)

_Prior milestones (v0.1–v4.5) archived under `.planning/milestones/`._

## Active Milestone: v4.8 Battery Post-Mortem Fixes

Fixes everything the 5-game build-battery post-mortem surfaced (`~/BoardSmithLab/findings/BATTERY-POST-MORTEM.md`, 2026-07-20): the 32 deduped library/platform defects (Part A, D1–D32), the two filed skills defects + the autonomy rewrite (Part B), the new platform features (Part C.1/C.2/C.3), and the final post-fix game de-workaround sweep across the five game repos (Part E #6). The lab-methodology item (Part G) is OUT OF SCOPE.

Phases are ordered by the Part A priority ranking: multi-game defects first (D1, D7, D10, D12, D2), then AI-blocking (D9, D8), then simultaneous-step + single-game/minor, then dev-host/test tooling, then skills, features, and the sweep last. Continues global phase numbering from v4.7 (ended at Phase 154) — starts at **Phase 155**.

Every fix phase bakes in JT's discipline (PROC-01): **fix → write tests → adversarially verify the fix holds → only then close.** Suggested plan breakdowns below are a starting shape; each phase's final `NN-0X-PLAN.md` files are produced when JT runs `/gsd:plan-phase`.

### Phases

- [ ] **Phase 155: Undo / Rewind Family Correctness** — enforce `.notUndoable()` server-side, fence undo at flow-node/`finished` boundaries, stop solo-undo wipe, fix animation-id rewind (D1, D2, D5, D6)
- [x] **Phase 156: Sole-Option Auto-Execute** — a single-option action auto-*starts* but never auto-*executes*; the shell stops playing for the player (D7)
- [x] **Phase 157: Game-Over UI + Forward Exits** — suppressable/dismissable `GameOverCard` + working Rematch/New Game/dev-restart (D10, D11)
- [x] **Phase 158: Auto-Zoom Re-Fit** — `useAutoZoom` re-fits on dock/board/region resize instead of once against a stale layout (D12)
- [x] **Phase 159: MCTS Soundness + Dynamic multiSelect** — dynamic/function-valued `multiSelect` in enumeration + panel (delivers C.2), redacted-view MCTS for hidden info (D9, D8)
- [x] **Phase 160: Simultaneous-Step Correctness** — per-seat undo checkpointing, any-seat undo, `allDone` crash, seat-status/commit leak (D3, D4, D21, D27)
- [x] **Phase 161: Dev-Host Tooling** — gameOption/preset selection, bare solo start, first-seat orphan race, color palette (D13, D14, D15, D16)
- [x] **Phase 162: Test-Tooling Ergonomics** — asset-scan comment false-positive + export surface, module-scope `matchMedia`, symmetric-deck leak assert (D17, D18, D19, D20)
- [x] **Phase 163: Engine Space Lifecycle & Element Integrity** — sealed/append-only Space, Space removal/re-parent, hidden-count leak, class-name collision, metadata divergence (D22, D23, D24, D25, D26)
- [ ] **Phase 164: Library Misc — Action-Panel, Loop, Visual, Debug-View** — per-action dock suppression + fence `suppress-action-panel` (C.3-lib), unbounded `loop()`, token glyph ink, time-travel desync (D28, D29, D30, D31)
- [ ] **Phase 165: Platform Logging Hygiene** — stop shipping `[DRAWDROP]` debug logging to the production console (D32)
- [ ] **Phase 166: Skills Defects — Session-Lock + UI/Library Boundary** — fix the close-ceremony lock seam, fence the game/library boundary, tell the agent not to use the fenced suppress hatch (B.8 ×2, C.3-skills)
- [ ] **Phase 167: Skills Autonomy Rewrite** — playtest-gate, question discipline, batch, run-while-away, auto-advance, context ≥50% + sub-agent offload, loud completion, process lessons — preserving Part D disciplines (B.1–B.7, B.9)
- [ ] **Phase 168: Platform Feature Spike — Seed-to-State** — scope/feasibility spike for seeding a game into a target playtest state (C.1)
- [ ] **Phase 169: Post-Fix Game De-Workaround Sweep** — remove every now-unneeded workaround across the five game repos, gated on verified fixes + green suites; close BSR-12; reclassify BS-10 (Part E #6)

### Phase Details

#### Phase 155: Undo / Rewind Family Correctness
**Goal**: The undo/rewind subsystem — the battery's #1 structural weak point — is correct: a non-undoable action cannot be undone server-side, undo cannot cross a completed `execute()` barrier or leave a `finished` phase, a solo undo rewinds exactly one move (never wipes the game), and rewind does not make the client drop replayed animation beats.
**Depends on**: Nothing (first phase; highest-leverage, hits 4+3 games).
**Requirements**: UNDO-01 (D1), UNDO-02 (D2), UNDO-03 (D5), UNDO-04 (D6), PROC-01
**Success Criteria** (what must be TRUE):
1. A server-side undo executor refuses an undo that would cross an action flagged `.notUndoable()` (`hasNonUndoableAction` honored), proven by a test that fails on pre-fix code (D1). D1 and D2 are fixed together — the post-mortem notes one fix largely closes both.
2. Undo is fenced so it cannot rewind through a completed `execute()` barrier or out of `finished`; a regression test reproduces the pre-fix data-loss / hidden-info rewrite and passes after (D2).
3. In a solo game, one undo rewinds exactly one move — `computeUndoInfo` has no game-erasing fallback and `moveCount` is published (D5).
4. Rewind no longer resets the animation-event id sequence such that the client's watermark dedupe drops beats (D6).
5. Each of D1/D2/D5/D6 is closed only after fix + regression test + adversarial verification (PROC-01).
**Plans:** 2/5 plans executed

Plans:
- [x] 155-01-PLAN.md — Shared undo guard: `.notUndoable()` + `finished`-phase fence, all four entry points [UNDO-01, UNDO-02] (wave 1)
- [x] 155-04-PLAN.md — Animation-seq monotonicity across checkpoint restore (server-primary) [UNDO-04] (wave 1)
- [x] 155-02-PLAN.md — Durable `execute()` barrier record + third guard check [UNDO-02] (wave 2)
- [x] 155-03-PLAN.md — `moveCount` always published, backward-scan fallback deleted, undo suites rewritten to "one undo = one action-step" [UNDO-03] (wave 3)
- [x] 155-05-PLAN.md — Client watermark reset on detected rewind (`state.actionCount`) [UNDO-04] (wave 4)

#### Phase 156: Sole-Option Auto-Execute
**Goal**: When an action is the only legal option, the shell auto-*starts* it (surfacing it to the player) but never auto-*executes* it — the player still takes the beat (e.g. the draw is never silently played for them).
**Depends on**: Nothing (independent of 155; ordered by priority #2).
**Requirements**: AUTOEXEC-01 (D7), PROC-01
**Success Criteria** (what must be TRUE):
1. A sole/single-option action built with `ActionBuilder.manual()` is auto-started but requires the player to execute it — no auto-execution, no deleted draw beat (D7).
2. A regression test drives a 3-games-affected scenario (auto-draw) and fails on pre-fix code, passes after.
3. The default (non-`manual()`) behavior remains a deliberate, documented choice; the pit-of-success path is the correct one.
**Plans** (1 plan, finalized at plan-phase):
- [x] 156-01-PLAN.md — `ActionBuilder.manual()` API + metadata threading + shell gate + one-time dev warning, RED->GREEN->adversarial [AUTOEXEC-01, PROC-01]

#### Phase 157: Game-Over UI + Forward Exits
**Goal**: A game controls its own end state — the shell `GameOverCard` is suppressable/dismissable and never mislabels a no-winner ending, and every forward exit (Rematch / New Game / dev-restart) actually restarts, unblocking multi-game formats.
**Depends on**: Nothing (independent; priority #3 + #6).
**Requirements**: ENDGAME-01 (D10), ENDGAME-02 (D11), PROC-01
**Success Criteria** (what must be TRUE):
1. A game can suppress/replace the shell `GameOverCard` via a `#game-over` slot / `providesOwnGameOverUI` flag, and the default card no longer mislabels a no-winner ending; the card is dismissable (D10, 3 games).
2. Rematch / New Game / dev-restart from a finished game actually restart the game (D11, 2 games).
3. Both are covered by tests that fail on pre-fix behavior (unsuppressable card; inert forward exit) and pass after (PROC-01).
**Plans** (2 plans):
- [x] 157-01-PLAN.md — `#game-over` slot + `providesOwnGameOverUI` + draw/unknown labeling + dismiss + isDraw threading (wave 1) [ENDGAME-01, PROC-01]
- [x] 157-02-PLAN.md — forward-exit routing (Rematch/New Game/dev-restart/DebugPanel) + DevHost routing (guard already admitted finished games) + DevHost debug:restart handler (wave 2, depends 157-01) [ENDGAME-02, PROC-01]

#### Phase 158: Auto-Zoom Re-Fit
**Goal**: `useAutoZoom` keeps the board fitted as the layout changes — it re-fits on dock/board/region resize instead of fitting once against a stale layout and leaving regions unreachable.
**Depends on**: Nothing (independent; priority #4).
**Requirements**: ZOOM-01 (D12), PROC-01
**Success Criteria** (what must be TRUE):
1. When the dock lands on the board or a region resizes, `useAutoZoom` re-fits so all regions stay reachable (D12, 3 games) — no manual Fit button needed.
2. A regression test (or deterministic layout-change harness) reproduces the stale-fit unreachable-region symptom pre-fix and passes after (PROC-01).
**Plans:** 1 plan

Plans:
- [x] 158-01-PLAN.md — Persistent region-obs + dock-watch rAF-coalesced re-fit, `userControlled` guard, RED→GREEN→adversarial [ZOOM-01, PROC-01] (wave 1)

#### Phase 159: MCTS Soundness + Dynamic multiSelect
**Goal**: AI opponents are unblocked and sound — dynamic/function-valued `multiSelect` enumerates and drives through the panel natively (delivering feature C.2), and MCTS reasons over a per-seat redacted view rather than cloning un-redacted state and sequentializing simultaneous reveals.
**Depends on**: Nothing (independent; the AI-blocking cluster).
**Requirements**: AI-01 (D9, delivers C.2), AI-02 (D8), PROC-01
**Success Criteria** (what must be TRUE):
1. Function-valued / dynamic `multiSelect` enumerates in MCTS (no "No available moves" throw) AND completes through the action-panel auto-UI without falling back to single-select — closing run-003 BSR-12 and Doom BS-5, and delivering feature C.2 (panel-completable multi-element selection) natively (D9).
2. An MCTS bot for a hidden-info game clones only a per-seat redacted view and does not sequentialize simultaneous reveals — verified as non-exploitable where the naive bot was (D8).
3. Both fixes carry tests that fail on pre-fix code and pass after; the previously "un-enumerable so silently skipped" damage case now enumerates and is exercised (PROC-01 + fail-loud principle).
**Plans** (3 plans; wave 1 = 01+03 parallel, wave 2 = 02):
- [x] 159-01-PLAN.md — Dynamic `multiSelect` enumeration in MCTS + shared `resolveMultiSelect` helper + fail-loud test [AI-01, PROC-01] (wave 1)
- [x] 159-02-PLAN.md — Panel-completable multi-element selection via `buildPickMetadata` — delivers C.2 [AI-01, PROC-01] (wave 2, depends on 01's helper)
- [x] 159-03-PLAN.md — Redacted-view MCTS clone (`toJSONForPlayer`) + simultaneous-reveal soundness + exploitability test [AI-02, PROC-01] (wave 1)

#### Phase 160: Simultaneous-Step Correctness
**Goal**: Simultaneous steps — the battery's #2 structural weak point — are correct under undo and status display: per-seat `completed` is checkpointed, undo works for any seat, an empty `awaitingPlayers` with `allDone` doesn't crash, and the shell never shows a contradictory turn status or leaks a commit.
**Depends on**: 155 (undo fencing) recommended before simultaneous-undo work, but the crash/status items are independent.
**Requirements**: SIM-01 (D3), SIM-02 (D4), SIM-03 (D21), SIM-04 (D27), PROC-01
**Success Criteria** (what must be TRUE):
1. Simultaneous-step undo checkpoints per-seat `completed` state and no longer desyncs/hangs (D3).
2. Simultaneous-step undo works for any seat, not just seat-1 — no `currentPlayer` pinning (D4).
3. `simultaneousActionStep` honors `allDone` on an empty `awaitingPlayers` instead of crashing (D21).
4. During a simultaneous step the shell shows correct seat status (no "Your move" + "waiting" contradiction) and leaks no commit (D27).
5. Each item has a fail-on-pre-fix / pass-after test (PROC-01).
**Plans:** 3 plans (D3+D21 combined at the engine layer; see plan-phase note)
Plans:
- [x] 160-01-PLAN.md — Engine simultaneous-step correctness: getState deep-copy (D3/SIM-01) + allDone-on-empty (D21/SIM-03) + reusable simultaneous fixture
- [x] 160-02-PLAN.md — Per-seat (any-seat) simultaneous undo, boundary from own action, fences intact (D4/SIM-02)
- [x] 160-03-PLAN.md — Shell seat-status self-filter + commit-leak execute gate (D27/SIM-04)

#### Phase 161: Dev-Host Tooling
**Goal**: The `boardsmith dev` host is fully usable for the games that hit its gaps — it can select a declared `gameOption`/preset, start a bare solo game, doesn't orphan its own first seat, and honors the game's color palette.
**Depends on**: Nothing (dev-host layer; independent of library phases).
**Requirements**: DEVHOST-01 (D13), DEVHOST-02 (D14), DEVHOST-03 (D15), DEVHOST-04 (D16), PROC-01
**Success Criteria** (what must be TRUE):
1. The dev host can select a declared `gameOption`/preset (D13).
2. `boardsmith dev` supports a bare solo start (no hardcoded `--players 2`) (D14).
3. The dev host no longer orphans its first seat via a race; the seat stays claimable (D15).
4. `boardsmith dev` honors the game's color palette instead of red/blue/green (D16).
5. Each fix has a regression test / scripted dev-host proof that fails pre-fix (PROC-01).
**Plans:** 4 plans
Plans:
- [x] 161-01-PLAN.md — Bare solo start (default `--players` to minPlayers) + canonical color-palette source [DEVHOST-02, DEVHOST-04]
- [x] 161-02-PLAN.md — gameOption/preset selection (CLI flags + host selection message) [DEVHOST-01]
- [x] 161-03-PLAN.md — Dev-host lobby gameOption/preset selector UI [DEVHOST-01]
- [x] 161-04-PLAN.md — First-seat orphan race fix (disconnect-mid-start reconciliation) [DEVHOST-03]

#### Phase 162: Test-Tooling Ergonomics
**Goal**: The test/build tooling stops producing false FAILs and jsdom throws, and exposes the helpers games need — asset-scan ignores `<img` in comments and is exported, `boardsmith/ui` doesn't read `matchMedia` at module scope, and hidden-info leak assertion works for symmetric decks.
**Depends on**: Nothing (tooling layer).
**Requirements**: TOOL-01 (D17), TOOL-02 (D18), TOOL-03 (D19), TOOL-04 (D20), PROC-01
**Success Criteria** (what must be TRUE):
1. `scanAssetReachability` no longer matches `<img` in comments (no false build FAIL) (D17).
2. `scanAssetReachability` is on the published export surface (D18).
3. `boardsmith/ui` no longer reads `window.matchMedia` at module scope; imports under jsdom without a shim (D19).
4. `assertNoHiddenInfoLeak` works for symmetric decks (markers not name-based-only) (D20).
5. Each has a test proving the old failure mode is gone (PROC-01).
**Plans:** 2 plans
- [x] 162-01-PLAN.md — asset-scan comment-stripping + boardsmith/testing export [TOOL-01, TOOL-02]
- [x] 162-02-PLAN.md — side-effect-free boardsmith/ui import + elementId-keyed leak detection [TOOL-03, TOOL-04]

#### Phase 163: Engine Space Lifecycle & Element Integrity
**Goal**: The `Space`/element subsystem's structural gaps are closed — a sealed/append-only Space whose `onExit` survives restore, Space removal/re-parenting, no hidden-child-count leak, no silent class-name-collision rename, and no `availableActions`/`actionMetadata` divergence that strands the board.
**Depends on**: Nothing (engine layer; single-game correctness cluster).
**Requirements**: SPACE-01 (D22), SPACE-02 (D23), SPACE-03 (D24), SPACE-04 (D25), SPACE-05 (D26), PROC-01
**Success Criteria** (what must be TRUE):
1. A sealed/append-only `Space` exists; its `onExit` is not bypassed on restore and does not corrupt on reject (D22).
2. A `Space` can be removed / re-parented so slots can be torn down (D23).
3. A hidden `Space` no longer leaks its exact child count via the serializer; `concealFromEverySeat` smell retired (D24).
4. A library-class name collision (`Hand`) is surfaced actionably, not silently renamed to `Hand2` (D25).
5. `availableActions` and `actionMetadata` cannot diverge into a `start()` "No metadata" board-stranding (D26).
6. Each item is closed via fix + regression test + adversarial verify (PROC-01).
**Plans**: 4 plans in 2 waves
- [x] 163-01-PLAN.md — Sealed/append-only Space + Space removal/re-parent (lift moveToInternal to GameElement) [SPACE-01, SPACE-02]
- [x] 163-02-PLAN.md — Hidden-Space child-count serializer suppression [SPACE-03]
- [x] 163-03-PLAN.md — Class-name-collision guard (replace silent registry clobber) [SPACE-04]
- [x] 163-04-PLAN.md — availableActions/actionMetadata single-source reconciliation + UI no-op [SPACE-05]

#### Phase 164: Library Misc — Action-Panel, Loop, Visual, Debug-View
**Goal**: The remaining single-game library defects are fixed — per-action dock suppression (with the blunt `suppress-action-panel` prop fenced behind an explicit escape hatch, delivering feature C.3's library half), an unbounded-game `loop()` valve, a non-white token glyph ink, and a time-travel debug view that doesn't commit clicks against the live engine.
**Depends on**: Nothing (library layer). Note LIBX-01 (fence `suppress-action-panel`) is the library half of C.3; the skills half is SKILLDEF-03 (Phase 166).
**Requirements**: LIBX-01 (D28 + C.3-lib), LIBX-02 (D29), LIBX-03 (D30), LIBX-04 (D31), PROC-01
**Success Criteria** (what must be TRUE):
1. Dock/action-panel suppression is per-action (not all-or-nothing), AND `suppress-action-panel` is removed from the ordinary scaffold surface / gated behind an explicit platform escape hatch — delivering the library half of C.3 (D28 + C.3).
2. `loop()` can express an unbounded game via an explicit valve, and the `maxIterations` exit is documented + observable, not silent/winnerless (D29).
3. `PlayerToken` glyph ink is not hardcoded white; the chip renders on light seat colors (D30).
4. The time-travel debug view no longer desyncs `#game-board` such that clicks commit against the live engine (D31).
5. Each fix has a fail-on-pre-fix / pass-after test (PROC-01).
**Plans:** 4 plans
Plans:
- [ ] 164-01-PLAN.md — `loop()` unbounded valve + `maxIterations` observability [LIBX-02, PROC-01] (wave 1)
- [ ] 164-02-PLAN.md — `PlayerToken` glyph-ink WCAG contrast fix [LIBX-03, PROC-01] (wave 1)
- [ ] 164-03-PLAN.md — Per-action dock suppression + fence `suppressActionPanel`→`platformActionPanelEscapeHatch` (C.3-lib) [LIBX-01, PROC-01] (wave 1)
- [ ] 164-04-PLAN.md — Time-travel debug-view `#game-board` desync fix (displayedState + bridge history guard) [LIBX-04, PROC-01] (wave 2, depends 164-03)

#### Phase 165: Platform Logging Hygiene
**Goal**: The deployed platform no longer ships verbose `[DRAWDROP]` debug logging to the live production console.
**Depends on**: Nothing (platform layer; small standalone phase per the post-mortem's "platform logging" grouping).
**Requirements**: PLATLOG-01 (D32), PROC-01
**Success Criteria** (what must be TRUE):
1. `[DRAWDROP]` (and any sibling verbose debug logging) is gated so it does not reach the production console (D32).
2. A test / build check asserts the debug logging is absent from the production build path (PROC-01).
**Plans** (suggested breakdown; finalized at plan-phase):
- Gate/remove `[DRAWDROP]` production logging + guard test [PLATLOG-01]

#### Phase 166: Skills Defects — Session-Lock + UI/Library Boundary
**Goal**: The two filed `bs-skills` defects are fixed and the game/library boundary is fenced — the `close` ceremony reliably releases its lock (no fabricated timestamp, no CHUNK.md overwrite, no same-day-resume false alarm), and the skills forbid suppressing built-in UI or editing the library, telling the agent to file gaps instead (including not using the fenced suppress hatch from LIBX-01).
**Depends on**: 164 (LIBX-01) for the fenced escape hatch that SKILLDEF-03 references; the two B.8 fixes are independent.
**Requirements**: SKILLDEF-01 (B.8 session-lock), SKILLDEF-02 (B.8 never-suppress/never-edit-library), SKILLDEF-03 (C.3-skills), PROC-01
**Success Criteria** (what must be TRUE):
1. The `close` ceremony releases its lock deterministically, never fabricates the lock timestamp, and cannot overwrite CHUNK.md; a same-day resume does not false-alarm (SKILLDEF-01).
2. The skills state both boundaries explicitly: the agent controls the game board only, `node_modules/boardsmith` (a live symlink) is read-only, built-in BoardSmith UI must not be suppressed, and library gaps are FILED not patched (SKILLDEF-02).
3. The skills tell the agent not to use the fenced `suppress-action-panel` escape hatch (LIBX-01) without the client (SKILLDEF-03, C.3-skills).
4. Skill-guidance changes are regression-tested (e.g. `build-chunk.test.ts` / `templates.test.ts` style) per PROC-01.
**Plans** (suggested breakdown; finalized at plan-phase):
- Close-ceremony lock/crash-consistency fix + CHUNK.md-overwrite guard + same-day-resume test [SKILLDEF-01]
- Game/library boundary prose ("board only; library read-only; file gaps, never patch/suppress") + tests [SKILLDEF-02]
- Fenced-suppress-hatch instruction (do not use without client) [SKILLDEF-03]

#### Phase 167: Skills Autonomy Rewrite
**Goal**: The `bs-skills` build as autonomously as possible while every human interruption stays meaningful — playtest-gate policy, question discipline, batched questions, run-while-away, auto-advance, a ≥50% context threshold with sub-agent offload, and loud completion — WITHOUT eroding any Part D discipline that kept provenance clean.
**Depends on**: 166 (skills defects fixed first so the autonomy rewrite builds on a fenced boundary). Tracks `.planning/bs-skills-plan.md`.
**Requirements**: SKILLAUTO-01..08 (B.1–B.7, B.9), PROC-02, PROC-01
**Success Criteria** (what must be TRUE):
1. Human playtest gates are exactly B.1's three milestones (core loop, scoring/endgame, final acceptance) + "always stop for a rules adjudication / open question"; no per-chunk client-playtest stop (SKILLAUTO-01).
2. Question discipline is codified — ask only when genuinely undetermined AND load-bearing AND no reasonable default; no re-asking granted approval; no playtest ask for a UI-less chunk (SKILLAUTO-02).
3. Questions are batched and unblocked work continues between batches (SKILLAUTO-03); the pipeline makes autonomous progress while the human is away (SKILLAUTO-04); it auto-advances to the next logical step (SKILLAUTO-05).
4. The context threshold is ≥50% before winding down, with heavy work offloaded to sub-agents (SKILLAUTO-06); completion is a loud, unambiguous banner + summary card (SKILLAUTO-07).
5. The three B.9 process gaps are closed — close-time ledger reconciliation, a shared cross-session ruling authority store, and fail-loud tests/sims (SKILLAUTO-08).
6. **PROC-02**: The rewrite preserves every Part D discipline (escalate-don't-hack, reuse-not-rebuild, honest-derived labeling, surface-don't-fabricate, in-process redteam, build-literally) — autonomy applies to *how to build*, never to *what the rules are*; genuine rule ambiguity is still surfaced (batched), never fabricated.
**Plans** (suggested breakdown; finalized at plan-phase):
- Playtest-gate policy + question discipline (B.1/B.2) [SKILLAUTO-01, 02]
- Batch-questions + run-while-away + auto-advance (B.3/B.4/B.5) [SKILLAUTO-03, 04, 05]
- Context threshold ≥50% + sub-agent offload + loud completion (B.6/B.7) [SKILLAUTO-06, 07]
- B.9 process gaps: ledger reconciliation, shared ruling store, fail-loud tests [SKILLAUTO-08]
- Part D preservation guardrails woven through all of the above [PROC-02]

#### Phase 168: Platform Feature Spike — Seed-to-State
**Goal**: Scope and prove feasibility of "seed a game into a target playtest state" — a scenario/seed the platform can load directly so the pipeline can put a game into the exact state it wants a human to test, bringing the human in not-already-annoyed.
**Depends on**: Nothing hard; benefits from a stable post-fix library (155–165). This is a spike, not a full build — output is a scoped design + feasibility finding, not necessarily shipped feature code.
**Requirements**: FEAT-01 (C.1)
**Success Criteria** (what must be TRUE):
1. A design/feasibility spike for seed-to-state exists: the mechanism (scenario/seed format, load path, how the pipeline requests a target state) is scoped with a recommendation on cost/shape (FEAT-01).
2. If a thin proof-of-concept is built, it loads a game into a declared target state deterministically; if deferred to a follow-up build, the spike says so explicitly with rationale (surface-don't-overreach).
3. Note: feature C.2 (panel multi-select) is delivered by Phase 159 (AI-01), NOT here — this phase is C.1 only.
**Plans** (suggested breakdown; finalized at plan-phase):
- Seed-to-state design + feasibility spike (format, load path, pipeline request API) [FEAT-01]
- Optional thin PoC or explicit deferral finding [FEAT-01]

#### Phase 169: Post-Fix Game De-Workaround Sweep
**Goal**: Once the library/platform/skills fixes have landed and are verified, every workaround and deferment that existed *only* because of a now-fixed bug is removed across all five game repos, each removal gated on its specific fix being verified in the shipped library and each game's suite staying green; the deferred AI opponents are re-verified and closed, and the stale Doom BS-10 filing is reclassified.
**Depends on**: ALL fix phases (155–165) verified in the shipped library; skills phases (166–167) for the ledger-reconciliation discipline. This is the FINAL phase and spans the GAME repos (`~/BoardSmithGames/{lanternfall,seven,one-two-punch,doom-machine}`, `~/BoardSmithGames2/seven`), NOT the library repo.
**Requirements**: SWEEP-01 (Part E #6), PROC-01
**Success Criteria** (what must be TRUE):
1. Each of the five game repos has every now-unneeded workaround removed — game-side undo-hole mitigations (D1/D5), `actionStep({maxMoves})` + single-element-pick D9 workarounds, manual Fit button (D12), color/palette + asset-path workarounds, the `concealFromEverySeat` smell (D24) — with each removal gated on its specific fix being verified in the shipped library.
2. Every game's full test suite is green after its workarounds are removed (no regression traded for cleanliness).
3. The deferred AI opponents are re-verified and closed — run-003 BSR-12 (previously blocked on D9) now builds and passes (ties to AI-01).
4. The stale Doom BS-10 filing is reclassified/closed as a game-side art-path fix (absolute `/cards/`, commit `6949fde`), NOT re-fixed as a library bug; the scaffold `<base href="/">` gap is folded into a scaffold-default recommendation rather than left as an open engine defect.
5. No workaround is removed whose underlying fix is not verified present (a removal gated on an unverified fix is a blocker, not a silent skip) (PROC-01).
**Plans** (suggested breakdown; finalized at plan-phase):
- Lanternfall sweep (D12 Fit button, D16 palette, D29 loop valve, D30/D31, D17/D26 guards) + green suite [SWEEP-01]
- Seven ×2 sweep (both repos: D1/D2 undo, D22/D24 Space, D27 status, D16 palette) + green suites [SWEEP-01]
- One-Two-Punch sweep (D6/D8 AI, D18/D19/D20 tooling shims, undo-by-construction review) + green suite [SWEEP-01]
- Doom sweep (D1/D5 undo, D9 multi-die + AI, D13/D14 dev-host, D23 slot teardown, D32 logging) + BS-10 reclassify + green suite [SWEEP-01]
- Close BSR-12 deferred AI (re-verify against AI-01) + close-time ledger reconciliation across all repos [SWEEP-01]

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155. Undo / Rewind Family Correctness | 2/5 | In Progress|  |
| 156. Sole-Option Auto-Execute | 0/? | Not started | — |
| 157. Game-Over UI + Forward Exits | 0/? | Not started | — |
| 158. Auto-Zoom Re-Fit | 0/? | Not started | — |
| 159. MCTS Soundness + Dynamic multiSelect | 0/? | Not started | — |
| 160. Simultaneous-Step Correctness | 0/? | Not started | — |
| 161. Dev-Host Tooling | 0/? | Not started | — |
| 162. Test-Tooling Ergonomics | 0/? | Not started | — |
| 163. Engine Space Lifecycle & Element Integrity | 0/? | Not started | — |
| 164. Library Misc — Action-Panel, Loop, Visual, Debug-View | 0/4 | Planned | 4 plans, 2 waves |
| 165. Platform Logging Hygiene | 0/? | Not started | — |
| 166. Skills Defects — Session-Lock + UI/Library Boundary | 0/? | Not started | — |
| 167. Skills Autonomy Rewrite | 0/? | Not started | — |
| 168. Platform Feature Spike — Seed-to-State | 0/? | Not started | — |
| 169. Post-Fix Game De-Workaround Sweep | 0/? | Not started | — |
