# Phase 114: Go-Fish Action Help & Host Lockout - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Two light tasks that prove v4.1 substrate generalizes to a card game:
- **GFHELP-01:** the go-fish `ask` action carries author-supplied help text revealed on hover/tap, governed by the global "Show action help" toggle (reuses the Phase 108 substrate: `help?` field, `.help()` builder, propagation, `ActionHelpPopover`, ControlsMenu toggle).
- **GFLOCK-01:** verify the v4.1 `teachingDisabled` host lockout gates go-fish's hint/AI-demo/tutorial affordances (hidden in UI + ops rejected fail-loud) while leaving action help enabled — proving the lockout generalizes to a card game.

Content + tests land cross-repo in `~/BoardSmithGames/go-fish` (symlinked boardsmith — no re-vendor). `.planning/` stays in BoardSmith. No BoardSmith `src/` changes expected (the lockout + action-help substrate is built; flag + fix only if a real gap surfaces).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Action Help Text (GFHELP-01)
- Add **`.help(text)` to the `ask` action** in `go-fish/src/rules/actions.ts` (mirror checkers' `.help()` on `move`/`endTurn`). `ask` is go-fish's ONLY player action — **drawing is automatic inside ask's `execute()`** (`game.drawFromPond`), not a separate action — so the requirement's "draw from deck" is covered WITHIN the ask help text.
- Help text: one clear, actionable string covering the ask and its Go-Fish consequence, e.g. *"Ask an opponent for a rank you already hold. If they have it they give you all of them and you go again; if not, you draw from the pond (Go Fish!)."* (final wording at implementation discretion; keep it actionable per CLAUDE.md).
- Authoring is pure substrate reuse — no new BoardSmith code. Help flows via `buildActionMetadata` → `ActionMetadata.help` to both AutoUI and the custom UI (the custom GameTable.vue action panel reveals it through `actionController.getActionMetadata('ask')?.help`).
- **Action-level help only** (per-selection target/rank help is deferred substrate-wide).

### Area 2 — Host Lockout Verification (GFLOCK-01)
- Verify via a **go-fish test (mirror checkers `teaching.test.ts` + `ControlsMenu` LOCK-01-B):** with `teachingDisabled: true`, `requestHint`/`startDemo`/`startTutorial` throw the fail-loud "Teaching features are disabled for this session." error, AND the Teaching UI group is hidden; **action help stays enabled** (the "Show action help" toggle still renders, help text still reveals). Assert BOTH halves (hide teaching + keep action-help).
- **Browser checkpoint** via `boardsmith dev --lock-teaching`: confirm the Teaching group (hint/demo/tutorial/heatmap) is hidden, "Show action help" is visible, and the ask action's help text reveals when the toggle is ON. (`--lock-teaching` exists, so this is feasible — unlike the GFAI-02 demo click. Kill the dev server after.)
- **Heatmap "Show move quality" toggle quirk — OUT of scope for 114.** It shows for gridless go-fish when UNLOCKED because it's gated on `showHint !== undefined` (AI present), not board presence. It IS correctly hidden when locked (part of the Teaching group), so GFLOCK is satisfied. Note it as a pre-existing substrate cosmetic quirk (candidate: gate on `hasBoard`) for a future fix and for DOC-03 (Phase 115) — do not change the substrate here.
- **BoardSmith `src/` changes:** none expected; flag + fix only if a real gap surfaces (never a go-fish workaround).

### Area 3 — Scope & "each action"
- **GFHELP "each action" is satisfied by the single `ask` action** — go-fish has exactly one player action; the auto-draw is documented as covered within ask help.
- GFLOCK test honesty: assert the lockout error is the real one AND action-help remains, mirroring checkers' LOCK-01-B (do not assert only the hide half).

### Claude's Discretion
- Final help-text wording; the exact go-fish lockout test file/structure; whether the lockout test exercises the session ops directly vs. through a TestGame harness; how the browser checkpoint is scripted (must use `--lock-teaching` and kill the dev server).
</decisions>

<code_context>
## Existing Code Insights (from scout)

### Action-help substrate (BoardSmith v4.1 Phase 108 — reuse as-is)
- `ActionDefinition.help?: string` (`src/engine/action/types.ts:460`); `.help(text)` builder (`src/engine/action/action-builder.ts:105`), mirrors `.prompt()`.
- Propagation: `buildActionMetadata()` (`src/session/utils.ts:116`) copies `help` → `ActionMetadata.help` (`src/session/types.ts` + UI `useActionControllerTypes.ts`). Serves AutoUI AND custom UI (`actionController.getActionMetadata(name)?.help`).
- Reveal: `src/ui/components/helpers/ActionHelpPopover.vue` ("?" affordance, hover/tap, Escape/outside-dismiss). Toggle: `ControlsMenu.vue:217-234` "Show action help" (`menuitemcheckbox`), gated by `v-if="hasActionHelp"` (NOT by teachingDisabled — Play group, line 218). State: `GameShell.vue:361,386` `isActionHelpVisible` (localStorage) + `hasActionHelp` computed (`meta[name].help || disabledActions[name]`).
- Checkers example: `checkers/src/rules/actions.ts` `.help('Pick one of your pieces…')` on `move`, `.help('Confirm your move…')` on `endTurn`.

### teachingDisabled lockout substrate (BoardSmith v4.1 Phase 111 — reuse as-is)
- Set: `GameSessionOptions.teachingDisabled?` (`game-session.ts:116`) → private `#teachingDisabled` (`:271`), never toggled after construction. Dev host: `DevHostConfig.teachingDisabled` (`cli/dev-host/config-types.ts:46`) via CLI flag **`boardsmith dev --lock-teaching`** (`dev.ts:363`), delivered to the GameShell iframe via init postMessage. Broadcast: `state.teachingDisabled` sent unconditionally (`game-session.ts:2014`).
- Fail-loud throw sites (all "Teaching features are disabled for this session."): `requestHint` (`:973`), `setHeatmapVisible` (`:1065`), `startDemo` (`:1174`), `startTutorial` (`:1916`). NOT blocked: `exitTutorial` (always allowed); action-help toggle (always available, D-06).
- UI gating: `ControlsMenu.vue:297` `<template v-if="(showHint !== undefined || hasTutorial) && !teachingDisabled">` hides hint/demo/heatmap/tutorial. ControlsMenu prop `teachingDisabled?` (`:71`, default false).
- Tests (the analogs to mirror): `src/session/teaching.test.ts:541-617` (`makeLockedSession()`; all four ops throw; exitTutorial allowed; unlocked doesn't throw); `src/ui/components/ControlsMenu.tutorial-toggle.test.ts:158-171` (LOCK-01-B: with teachingDisabled, "Show action help" still renders when hasActionHelp).

### go-fish (the target)
- `ask` action: `src/rules/actions.ts:32-191` — `chooseFrom('target')` + `chooseFrom('rank')`, then `execute()`; **draw is automatic** at `:139` (`game.drawFromPond(player)`). No `.help()` today. No separate draw action.
- `gameDefinition.ai = { objectives, hintTargetFromMove }` (`src/rules/index.ts:23-26`) → `showHint !== undefined` true → teaching affordances (incl. the heatmap "Show move quality" toggle) appear when unlocked.

### Browser feasibility
- `boardsmith dev --lock-teaching` sets the lockout for the dev host → `state.teachingDisabled` broadcasts → Teaching group hidden, action-help kept. So the GFLOCK browser checkpoint IS feasible.
</code_context>

<specifics>
## Specific Ideas

- Both requirements are light substrate-reuse: GFHELP adds one `.help()` call; GFLOCK is verification (tests + a `--lock-teaching` browser checkpoint).
- The custom GameTable.vue uses an action panel — confirm action help reveals through the custom UI path (`getActionMetadata('ask')?.help`), not only AutoUI (CLAUDE.md parity hard rule). If the custom UI doesn't surface action help, that's a go-fish custom-UI gap to fix in go-fish (like the Phase 112 anchorAttrs gap) — flag it.
- Keep BoardSmith vitest green; no src changes expected.
</specifics>

<deferred>
## Deferred Ideas

- Gating the heatmap "Show move quality" toggle on board presence (so it hides for gridless go-fish when unlocked) — pre-existing substrate cosmetic quirk; future fix + noted in DOC-03.
- Per-selection (target/rank) help text — deferred substrate-wide.
- Developer documentation (DOC-*) → Phase 115.
- Wiring/removing go-fish's unwired MCTS bot hooks (113 WR-01) — separate go-fish AI cleanup, not this phase.
</deferred>
