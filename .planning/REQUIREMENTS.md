# Requirements — v4.8 Battery Post-Mortem Fixes

Derived from the 5-game build-battery post-mortem (`~/BoardSmithLab/findings/BATTERY-POST-MORTEM.md`,
2026-07-20). Closes the 32 deduped library/platform defects (Part A, D1–D32), the two filed skills
defects + the autonomy rewrite (Part B), the new platform features (Part C), and the post-fix game
de-workaround sweep (Part E #6). The lab-methodology item (Part G, "oracle should be an agent") is
OUT OF SCOPE — it belongs to the lab, not this repo.

Every fix requirement inherits JT's discipline (PROC-01): **fix → write tests → adversarially verify
the fix holds → only then close.**

## v4.8 Requirements

### PROC — Fix discipline (applies fractally to every fix phase)

- [x] **PROC-01**: Every defect (D1–D32) and every filed skills defect is closed only after: (a) a fix
  at the correct layer (library/dev-host/tooling/platform/skills — never a per-game hand-patch), (b) a
  regression test that fails on pre-fix code and passes on post-fix code, and (c) an adversarial
  verification that the fix actually holds under the conditions that produced the original filing. No
  defect is marked closed on a green build alone. (Post-mortem Part A closing note + Part E #3.)
- [ ] **PROC-02**: The skills autonomy rewrite (SKILLAUTO-*) preserves every Part D discipline that kept
  provenance clean — escalate-don't-hack / file-don't-workaround, reuse-not-rebuild, honest-derived
  provenance labeling, surface-don't-fabricate on load-bearing rule holes, in-process redteam, and
  build-literally-when-under-determined. Autonomy applies to *how to build*, never to *what the rules
  are*. (Post-mortem Part D + Part B "Caution for the autonomy work".)

### UNDO — Undo / rewind family (D1, D2, D5, D6) — Phase 155

- [x] **UNDO-01** (D1, 4 games, Blocker): `.notUndoable()` is enforced server-side — a server undo
  executor honors `hasNonUndoableAction` so an undo across a non-undoable action is refused, not merely
  hidden from the client button. (Hit by Seven×2, 1-2 Punch, Doom.)
- [x] **UNDO-02** (D2, 3 games, Blocker): Undo is fenced at flow-node / terminal boundaries — it can no
  longer rewind through a completed `execute()` barrier or out of a `finished` phase (which caused data
  loss + hidden-info rewrite). The D1 fix and this fence are designed together (one fix largely closes
  both).
- [x] **UNDO-03** (D5, Doom, High): The solo-game undo path no longer wipes the game — `computeUndoInfo`
  has no game-erasing fallback and `moveCount` is published so a single undo rewinds exactly one move.
- [x] **UNDO-04** (D6, OTP, Med/latent): Rewind no longer resets the animation-event id sequence in a way
  that makes the client's watermark dedupe drop replayed beats.

### AUTOEXEC — Sole-option auto-execute (D7) — Phase 156

- [ ] **AUTOEXEC-01** (D7, 3 games, Blocker): A sole/single-option action is auto-*started* but never
  auto-*executed* — the shell never plays the game for the player (no silent auto-draws that delete the
  draw beat). Delivered as `ActionBuilder.manual()` (auto-start, never auto-execute).

### ENDGAME — Game-over UI + forward exits (D10, D11) — Phase 157

- [ ] **ENDGAME-01** (D10, 3 games, Major/Blocker): The shell `GameOverCard` is suppressable and
  dismissable and never mislabels a no-winner ending — via a `#game-over` slot / `providesOwnGameOverUI`
  flag so a game can present its own end state.
- [ ] **ENDGAME-02** (D11, 2 games, Blocker): Every forward exit from a finished game works — Rematch /
  New Game / dev-restart actually restart, unblocking multi-game formats.

### ZOOM — Auto-zoom re-fit (D12) — Phase 158

- [ ] **ZOOM-01** (D12, 3 games, Major): `useAutoZoom` re-fits when the layout changes (dock/board/region
  resize) instead of fitting once against a stale layout and never re-fitting — regions stay reachable.

### AI — MCTS soundness + dynamic multiSelect (D9, D8) — Phase 159 (delivers C.2)

- [ ] **AI-01** (D9, 2 games, High/Blocks-AI): Function-valued / dynamic `multiSelect` is supported in
  BOTH MCTS enumeration (no more "No available moves" throw) AND the action-panel auto-UI (no more
  fallback to single-select → "requires ≥2, got 1"). This closes the run-003 AI blocker (BSR-12) and the
  Doom multi-die panel error (BS-5), AND delivers feature **C.2** (panel-completable multi-element
  selection) natively so games stop reinventing the workaround.
- [ ] **AI-02** (D8, OTP, High): MCTS no longer clones un-redacted game state or sequentializes
  simultaneous reveals — the bot reasons over a per-seat redacted view so hidden-info games get a sound,
  non-exploitable AI.

### SIM — Simultaneous-step correctness (D3, D4, D21, D27) — Phase 160

- [ ] **SIM-01** (D3, 2 games, Med→Blocker/latent): Simultaneous-step undo checkpoints per-seat
  `completed` state so it no longer desyncs and hangs.
- [ ] **SIM-02** (D4, 2 games, Correctness): Simultaneous-step undo works for any seat, not just seat-1 —
  it is no longer gated on a pinned `currentPlayer`.
- [ ] **SIM-03** (D21, OTP, Med): `simultaneousActionStep` honors `allDone` on an empty `awaitingPlayers`
  set instead of crashing.
- [ ] **SIM-04** (D27, Seven, Correctness/leak): GameShell seat status/dock is correct during a
  simultaneous step — no "Your move" + "waiting" contradiction and no commit leak; status is not derived
  from turn-based assumptions.

### DEVHOST — Dev-host tooling (D13, D14, D15, D16) — Phase 161

- [ ] **DEVHOST-01** (D13, Doom, Med): The dev host can select a declared `gameOption` / preset.
- [ ] **DEVHOST-02** (D14, Doom, Med): `boardsmith dev` supports a bare solo start (no hardcoded
  `--players 2`).
- [ ] **DEVHOST-03** (D15, Seven-dlx, Med): The dev host no longer orphans its own first seat via a race,
  so the seat stays claimable and the loop is not blocked.
- [ ] **DEVHOST-04** (D16, Seven, Low): `boardsmith dev` honors the game's color palette instead of
  dropping it to red/blue/green in dev.

### TOOL — Test-tooling ergonomics (D17, D18, D19, D20) — Phase 162

- [ ] **TOOL-01** (D17, Lanternfall, Med): `scanAssetReachability` no longer matches `<img` inside code
  comments (which produced a false build FAIL).
- [ ] **TOOL-02** (D18, OTP, Med): `scanAssetReachability` is on the published export surface so games can
  call it without hand-rolling.
- [ ] **TOOL-03** (D19, OTP, Blocking): `boardsmith/ui` no longer reads `window.matchMedia` at module
  scope (which threw under jsdom) — no test shim required.
- [ ] **TOOL-04** (D20, OTP, Med): `assertNoHiddenInfoLeak` is usable for symmetric decks — markers are
  not name-based-only.

### SPACE — Engine Space lifecycle & element integrity (D22–D26) — Phase 163

- [ ] **SPACE-01** (D22, Seven, Design): A sealed / append-only `Space` exists whose `onExit` is not
  bypassed on restore and does not corrupt on reject.
- [ ] **SPACE-02** (D23, Doom, Limitation): A `Space` can be removed / re-parented so slots can be torn
  down (no forced slot-outlives-part model).
- [ ] **SPACE-03** (D24, Seven, Correctness): A hidden `Space` no longer leaks its exact child count via
  the serializer (retiring the `concealFromEverySeat` smell).
- [ ] **SPACE-04** (D25, Seven, Pit-of-failure): An element class whose name collides with a library class
  is not silently renamed (`Hand`→`Hand2`) — the collision is surfaced actionably.
- [ ] **SPACE-05** (D26, Lanternfall, Med): `availableActions` and `actionMetadata` cannot diverge such
  that `start()` throws "No metadata" and strands the board.

### LIBX — Library misc: action-panel, loop, visual, debug-view (D28, D29, D30, D31 + C.3) — Phase 164

- [ ] **LIBX-01** (D28 + C.3, Seven, UX): Action-panel/dock suppression is per-action, not all-or-nothing,
  AND the blunt `suppress-action-panel` prop is fenced/removed from the ordinary scaffold surface (gated
  behind an explicit platform escape hatch the agent is told not to use without the client). Delivers the
  library half of feature **C.3**; the skills half is SKILLDEF-03.
- [ ] **LIBX-02** (D29, Lanternfall, Minor): `loop()` can express an unbounded game via an explicit
  valve, and the `maxIterations` exit is neither silent nor winnerless — it is documented and observable.
- [ ] **LIBX-03** (D30, Lanternfall, Med/visual): `PlayerToken` glyph ink is not hardcoded white, so the
  chip is not blank on light seat colors.
- [ ] **LIBX-04** (D31, Lanternfall, Med/dev): The time-travel debug view no longer desyncs `#game-board`
  such that clicks commit against the live engine.

### PLATLOG — Platform logging hygiene (D32) — Phase 165

- [ ] **PLATLOG-01** (D32, Doom, Minor, PLATFORM layer): The verbose `[DRAWDROP]` debug logging is not
  shipped to the live production console.

### SKILLDEF — Filed skills defects + UI/library boundary (B.8 + C.3-skills) — Phase 166

- [ ] **SKILLDEF-01** (B.8, `bs-skills-session-lock-defect.md`): The `close` ceremony reliably releases
  its lock, does not fabricate the lock timestamp, and can never overwrite CHUNK.md — the crash-consistency
  seam is fixed so a same-day resume does not false-alarm (which was training click-through).
- [ ] **SKILLDEF-02** (B.8, `bs-skills-never-suppress-builtin-ui.md`): The skills fence the game/platform
  boundary — the agent controls the game board only, the BoardSmith library is read-only
  (`node_modules/boardsmith` is a live symlink to the real checkout), built-in BoardSmith UI must not be
  suppressed, and library gaps are FILED, never patched or suppressed.
- [ ] **SKILLDEF-03** (C.3-skills): The skills explicitly tell the agent not to use the fenced
  `suppress-action-panel` escape hatch (LIBX-01) without the client — the skills half of feature C.3.

### SKILLAUTO — Skills autonomy rewrite (Part B) — Phase 167

- [ ] **SKILLAUTO-01** (B.1): The playtest-gate rule is a skills default — pause for a client playtest
  only at (1) core play loop complete, (2) scoring/endgame complete, (3) final acceptance; still stop any
  time for a rules adjudication / open question. All internal per-chunk steps (tests, audit,
  self-playtest) are unchanged.
- [ ] **SKILLAUTO-02** (B.2): Question discipline — ask only when the answer is genuinely undetermined by
  rules + prior answers AND the choice is load-bearing AND no reasonable default exists; never re-ask for
  already-granted approval; never route a human playtest for a chunk with no visible UI. Otherwise proceed
  and record the assumption.
- [ ] **SKILLAUTO-03** (B.3): Batch questions — save up open questions and ask them all at once; keep
  working on everything not blocked between batches (GSD autonomous-mode model).
- [ ] **SKILLAUTO-04** (B.4): Run-while-away — the pipeline keeps making progress autonomously on
  reasonable defaults and only parks on a batched question queue, so walking away does not stall the build.
- [ ] **SKILLAUTO-05** (B.5): Auto-advance to the next logical step (e.g. generate the AI opponent, then
  final acceptance) without the human kicking it off; the only human gates are B.1's three milestones.
- [ ] **SKILLAUTO-06** (B.6): Context management — do not wind down before at least 50% context consumed,
  and offload heavy work (research, audits, large reads, repairs) to sub-agents so the main thread fills
  slowly and long autonomous runs are possible.
- [ ] **SKILLAUTO-07** (B.7): Completion is unmistakable — finishing a game is a loud, unambiguous event
  (banner + clean final summary card: what shipped, test count, deferred items), never buried in a wall
  of text.
- [ ] **SKILLAUTO-08** (B.9): The three recurring process gaps are closed — (a) close-time ledger
  reconciliation ("audit the paperwork, not just the code"; re-touch the relevant filing when a fix
  lands), (b) a shared cross-session ruling authority store (not per-session memory — autonomy makes
  divergence worse), (c) tests/sims that stop exercising their target must FAIL LOUD, not pass quietly.

### FEAT — Platform feature spike (C.1) — Phase 168

- [ ] **FEAT-01** (C.1): Spike "seed a game into a target playtest state" — a scenario/seed the platform
  can load directly so the pipeline can set the game into the exact state it wants a human to test
  (bringing the human into the test not-already-annoyed). Scope + feasibility spike; substantial new
  platform feature. (C.2 is delivered by AI-01/Phase 159, not here.)

### SWEEP — Post-fix game de-workaround sweep (Part E #6) — Phase 169

- [ ] **SWEEP-01**: After the library/platform/skills fixes land, an agent sweeps all five game repos
  (`~/BoardSmithGames/{lanternfall,seven,one-two-punch,doom-machine}`, `~/BoardSmithGames2/seven`) and
  removes every workaround/deferment that existed only because of a now-fixed bug — game-side undo-hole
  mitigations (D1/D5), `actionStep({maxMoves})` + single-element-pick D9 workarounds, the manual Fit
  button (D12), color/palette + asset-path workarounds, the `concealFromEverySeat` smell (D24). Each
  removal is GATED on its specific fix being verified in the shipped library, and each game's suite must
  stay green after the workaround comes out. Also: re-verify and CLOSE the deferred AI opponents (run-003
  BSR-12), and reclassify the stale Doom BS-10 filing (game-side art-path fix, not a library bug). Spans
  the game repos, not the library repo.

## Out of Scope

- **Part G — lab methodology ("oracle should be an agent").** Belongs to the lab, not the BoardSmith
  repo. Not scheduled here.
- **Two WITHDRAWN Lanternfall filings** (game-driven seat display names; seat chips ignoring
  `--bsg-seat-N`) — already rejected by the maintainer; the APIs existed. Not counted as open bugs.

## Traceability

| REQ-ID | Defect / Source | Phase |
|--------|-----------------|-------|
| PROC-01 | Part A/E fix discipline | all fix phases |
| PROC-02 | Part D disciplines | 167 |
| UNDO-01..04 | D1, D2, D5, D6 | 155 |
| AUTOEXEC-01 | D7 | 156 |
| ENDGAME-01, 02 | D10, D11 | 157 |
| ZOOM-01 | D12 | 158 |
| AI-01, 02 | D9 (+C.2), D8 | 159 |
| SIM-01..04 | D3, D4, D21, D27 | 160 |
| DEVHOST-01..04 | D13, D14, D15, D16 | 161 |
| TOOL-01..04 | D17, D18, D19, D20 | 162 |
| SPACE-01..05 | D22, D23, D24, D25, D26 | 163 |
| LIBX-01..04 | D28 (+C.3-lib), D29, D30, D31 | 164 |
| PLATLOG-01 | D32 | 165 |
| SKILLDEF-01..03 | B.8 (×2) + C.3-skills | 166 |
| SKILLAUTO-01..08 | B.1–B.7, B.9 | 167 |
| FEAT-01 | C.1 | 168 |
| SWEEP-01 | Part E #6 (BSR-12, BS-10) | 169 |

**Coverage:** All of D1–D32 mapped (32/32, no orphans, no duplicates); both filed skills defects (B.8)
+ the full autonomy rewrite (B.1–B.7, B.9); all three features (C.1→168, C.2→159, C.3→164+166); and the
de-workaround sweep (Part E #6). Part G deliberately excluded (see Out of Scope). 40 requirements across
15 phases (155–169).
