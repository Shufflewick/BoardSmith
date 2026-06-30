# Phase 111: Host-Gated Teaching Lockout - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the embedding host (e.g. shufflewick.pub) a way to disable the teaching/assist
features through the iframe so they cannot be used to cheat in a real game. BoardSmith
stays host-agnostic — it does NOT model "ranked" or any host concept; it receives a
single "teaching disabled" signal at session creation and complies.

**When disabled:** the AI move hint, move-quality / evaluation heatmap, AI-vs-AI
narrated demo, and tutorial are all unavailable. **Action help** (hover/tap text that
explains what an action does) stays enabled — it explains the rules, not a good move,
so it is not a cheat.

Requirement: **LOCK-01**. This is the final phase of milestone v4.1 (Tutorial
Primitives). The need surfaced during the Phase 110 live demo.

**In scope:** the flag (single source of truth at session creation), client gating
(hide affordances), server enforcement in BOTH session paths (fail-loud op rejection),
broadcast reflection, default-unchanged behavior, and a dev-host CLI flag to exercise it.

**Out of scope:** any host/"ranked" concept in BoardSmith; mid-game toggling of the
flag (it is set once at creation); changing what action help shows.

</domain>

<decisions>
## Implementation Decisions

### Flag home & shape (Gray area A — user chose "Dedicated session config field")
- **D-01:** The lockout is a **first-class, session-level `teachingDisabled` boolean**,
  NOT folded into `gameOptions`. Rationale: it is host anti-cheat policy, not a game
  rule — keeping it separate prevents collision with a game that names its own option
  `teachingDisabled`, and makes it discoverable as the single source of truth.
- **D-02:** **Delivery path:** host → embedded GameShell via the existing platform-mode
  `init` postMessage as `data.teachingDisabled` (alongside `data.seat`), AND into the
  session as a config flag at creation. One value, set once at session creation.
- **D-03:** **Broadcast reflection:** the flag is injected into broadcast player state
  (e.g. `state.teachingDisabled`) post-`buildPlayerState`, the same injection seam the
  transient teaching annotations already use (`game-session.ts:~827`). Every connected
  client (reconnect, second window) therefore hides the affordances consistently
  (criterion 4) by reading broadcast state, not local init alone.

### Dev-host exercise path (Gray area B — user chose "Add CLI flag")
- **D-04:** Add a **`boardsmith dev --lock-teaching`** flag (mirroring the existing
  `--ai` flag) that creates the dev-host session with `teachingDisabled: true`. This
  drives the dev-host enforcement path AND lets the lockout be verified live in the
  browser (pit-of-success: demonstrable + testable end-to-end).

### Server enforcement shape (Claude's discretion — locked to fail-loud by criterion 3)
- **D-05:** When `teachingDisabled` is set, the `hint`, `heatmapToggle`, `demoStart`,
  and `startTutorial`/`start-tutorial` ops are **rejected fail-loud** (throw / return an
  error with an actionable message, e.g. "Teaching features are disabled for this
  session."), consistent with each layer's existing op-error pattern (e.g.
  `requestHint` already throws "Cannot hint: seat … is not awaiting input"). Enforced in
  BOTH the production `GameSession` methods AND the dev-host `executeOp`
  (`stateless-ops.ts`) / `SnapshotSessionHost.handleOp` (`demoStart`) — so a player who
  crafts the op directly, bypassing the hidden UI, still cannot use the feature.
- **D-06:** **Action help is never gated** — `help-toggle` and the per-action "?"
  affordance stay fully functional when teaching is disabled (criterion 2). `exitTutorial`
  is NOT blocked (exiting is always safe; only starting teaching is blocked).

### Client gating (Claude's discretion — from criterion 2)
- **D-07:** GameShell/ControlsMenu does not render Get-a-hint, Show-move-quality,
  Watch-AI-demo, or Start-tutorial affordances when the broadcast flag is set. This
  composes with the existing `showHint` (AI-present) and `hasTutorial`/`hasActionHelp`
  gates — teaching-disabled is an additional AND condition.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirement & roadmap
- `.planning/ROADMAP.md` § "Phase 111: Host-Gated Teaching Lockout" — 5 locked success
  criteria + LOCK-01.
- `.planning/REQUIREMENTS.md` — LOCK-01 requirement text.

### Integration points (read before implementing)
- `src/ui/components/GameShell.vue:962-977` — platform `init` postMessage handler
  (`data.type === 'init'`, consumes `data.seat` + theme); add `data.teachingDisabled` here.
- `src/ui/components/GameShell.vue:777-862` — `handleTeachingAction` (hint / demo-toggle /
  heatmap-toggle / help-toggle / start-tutorial / exit-tutorial) + the `showHint`/
  `hasTutorial`/`hasActionHelp` gating computeds.
- `src/ui/components/ControlsMenu.vue` — Teaching group + Tutorial group render gates.
- `src/session/game-session.ts` — `requestHint`, `setHeatmapVisible`, `startDemo`,
  `startTutorial`; constructor/config threading (~256, ~351); broadcast injection seam
  (~827, post-`buildPlayerState`).
- `src/session/stateless-ops.ts` — `Op` union (~32) + `executeOp` switch (~944): cases
  `hint` (handleHint ~531), `heatmapToggle` (handleHeatmapToggle ~594), `startTutorial`
  (~1014); host-only `demoStart`/`demoStop` fallback (~1058).
- `src/session/snapshot-session-host.ts` — `handleOp` (demoStart/demoStop lifecycle) +
  `runDemoLoop`; dev-host session creation (where `--lock-teaching` sets the flag).
- `src/cli/dev-host/bridge.ts` — wire-op routing (where the dev host maps client ops to
  `executeOp`/`handleOp`); and the dev CLI entry that parses `--ai` (sibling for `--lock-teaching`).
- `src/session/utils.ts` — `buildPlayerState` (broadcast state shape) + `canUndo`/gating helpers.

### Prior-phase substrate this builds on
- `.planning/phases/107-ai-assisted-teaching/` — hint/heatmap/demo session state.
- `.planning/phases/108-lightweight-action-help/` — action help (stays enabled).
- `.planning/phases/109-checkers-tutorial-content/` + `110-*` — start/exit-tutorial ops + demo controls.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Platform `init` postMessage seam** (`GameShell.vue:968`) — already carries `seat` +
  theme override; `teachingDisabled` rides the same message. `consumeInitMessage` is the
  pattern for consuming init fields.
- **Broadcast injection seam** (`game-session.ts:~827`) — transient teaching annotations
  are already injected post-`buildPlayerState`; `teachingDisabled` reflects the same way.
- **`platformRequest(op, payload)`** (`GameShell.vue:409`) — single helper all teaching
  ops route through; the dev bridge + production host both implement the server side.
- **Existing op-error pattern** — `requestHint` throws actionable errors; enforcement
  mirrors this for fail-loud rejection.
- **ControlsMenu gating props** — `showHint`, `hasTutorial`, `hasActionHelp` (added in
  Phase 110/R-14b) are the precedent for an additional gating prop.

### Established Patterns
- **Dual enforcement** — every teaching op already exists in BOTH the production
  `GameSession` and the dev-host `stateless-ops`/`SnapshotSessionHost`. The lockout must
  be enforced in both (criterion 3) — no parallel/duplicate validation path.
- **CLI flag parsing** — `--ai N` in the dev host is the sibling pattern for `--lock-teaching`.
- **Single source of truth** — the flag is set once at creation and read everywhere via
  broadcast; no client trusts only its own local init.

### Integration Points
- Init postMessage → session config → broadcast state → client gating (the full stack
  for one boolean; trace it end-to-end per CLAUDE.md testing rule).
- Both session paths' op dispatch (production + dev-host) reject the four ops.

</code_context>

<specifics>
## Specific Ideas

- Demonstrable via `npx boardsmith dev --ai 2 --lock-teaching`: Teaching affordances
  gone from ControlsMenu, action help still works, crafted ops rejected fail-loud.
- The Phase 107–110 test suites staying green is the default-unchanged proof (criterion 5).

</specifics>

<deferred>
## Deferred Ideas

- **Mid-game toggling** of teaching-disabled — out of scope; the flag is set once at
  session creation (criterion 1). A future need could add a host signal to flip it live.
- **Per-feature granularity** (disable hint but allow demo, etc.) — not requested; LOCK-01
  is all-or-nothing across the four assist features. Could be a future refinement.
- **R-05 (from Phase 110):** suppress Undo during guided tutorial steps — unrelated
  session-hook work, separate phase.

None of the above belongs in Phase 111.

</deferred>

---

*Phase: 111-host-gated-teaching-lockout*
*Context gathered: 2026-06-29*
