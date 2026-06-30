# Phase 114: Go-Fish Action Help & Host Lockout — Research

**Researched:** 2026-06-30
**Confidence:** HIGH — both substrates are built (v4.1 Phase 108 action help; Phase 111 teachingDisabled lockout) and proven for checkers. go-fish needs one `.help()` call + verification. Source: codebase scout (file:line verified).

## RESEARCH COMPLETE

## Summary

GFHELP-01 is a single `.help(text)` call on go-fish's `ask` action (its only player action — draw is automatic inside ask). GFLOCK-01 is verification (tests + a `boardsmith dev --lock-teaching` browser checkpoint) that `teachingDisabled` hides/throws hint+demo+tutorial while keeping action help. No BoardSmith `src/` changes expected.

## Action-help substrate (reuse — BoardSmith `src/`)
- `ActionDefinition.help?: string` (`src/engine/action/types.ts:460`); `.help(text)` builder (`action-builder.ts:105`, mirrors `.prompt()`).
- Propagation: `buildActionMetadata()` (`src/session/utils.ts:116`) → `ActionMetadata.help` (`src/session/types.ts` + UI `useActionControllerTypes.ts`). Both AutoUI (`action.help`) and custom UI (`actionController.getActionMetadata(name)?.help`).
- Reveal: `ActionHelpPopover.vue` ("?" affordance, hover/tap, Escape/outside-dismiss). Toggle: `ControlsMenu.vue:217` "Show action help" gated by `hasActionHelp` (NOT teachingDisabled). State: `GameShell.vue:361,386` `isActionHelpVisible` (localStorage) + `hasActionHelp` (`meta[name].help || disabledActions[name]`).
- Checkers analog: `.help('Pick one of your pieces…')` on `move` in `checkers/src/rules/actions.ts`.

## teachingDisabled lockout substrate (reuse — BoardSmith `src/`)
- Set via `GameSessionOptions.teachingDisabled` (`game-session.ts:116`/`:271`); dev host CLI `boardsmith dev --lock-teaching` (`dev.ts:363`); broadcast `state.teachingDisabled` (`:2014`).
- Fail-loud throws ("Teaching features are disabled for this session."): `requestHint` (`:973`), `setHeatmapVisible` (`:1065`), `startDemo` (`:1174`), `startTutorial` (`:1916`). NOT blocked: `exitTutorial`, action-help toggle.
- UI gate: `ControlsMenu.vue:297` `v-if="(showHint !== undefined || hasTutorial) && !teachingDisabled"` hides hint/demo/heatmap/tutorial.
- Test analogs: `src/session/teaching.test.ts:541-617` (`makeLockedSession`; ops throw; exitTutorial allowed); `src/ui/components/ControlsMenu.tutorial-toggle.test.ts:158-171` (LOCK-01-B: action-help toggle still renders when locked).

## go-fish additions (the whole phase)
1. `src/rules/actions.ts` — add `.help('Ask an opponent for a rank you already hold. If they have it they give you all of them and you go again; if not, you draw from the pond (Go Fish!).')` to the `ask` action (only player action; draw automatic at `:139`).
2. Test(s): action-help propagation (the `ask` action's `ActionMetadata.help` is present) + lockout verification (mirror checkers `teaching.test.ts` / `ControlsMenu` LOCK test): with `teachingDisabled`, hint/demo/tutorial throw + UI hidden; action-help stays.
3. Browser checkpoint: `boardsmith dev --lock-teaching` — Teaching group hidden, "Show action help" visible, ask help reveals.

## Pitfalls
1. **Custom UI parity:** go-fish uses the custom `GameTable.vue` action panel. Verify action help reveals through the custom-UI path (`getActionMetadata('ask')?.help`), not only AutoUI (CLAUDE.md hard rule). If the custom action panel doesn't render the help "?" affordance, that's a go-fish custom-UI gap (like the Phase 112 anchorAttrs gap) to fix IN go-fish — flag it; the browser checkpoint will catch it.
2. **One action only:** "each action" (GFHELP-01) is satisfied by `ask`; do not invent a draw action — drawing is part of ask resolution. Document this.
3. **Heatmap toggle quirk:** the "Show move quality" toggle shows for gridless go-fish when unlocked (gated on `showHint`, not `hasBoard`). It IS hidden when locked, so GFLOCK passes. Out of scope to fix here; note for DOC-03.
4. **Lockout is construction-time:** `teachingDisabled` is set at session creation and never toggled — the lockout test must construct a locked session (mirror `makeLockedSession`), not flip a flag mid-game.

## Environment Availability
| Dependency | Available | Note |
|------------|-----------|------|
| action-help substrate | ✓ | v4.1, symlinked live |
| teachingDisabled lockout + `--lock-teaching` | ✓ | v4.1; dev-host flag exists → browser check feasible |
| vitest (both repos) | ✓ | — |

## Open Questions (RESOLVED)
1. **Does the auto-draw need its own help target?** RESOLVED: no — go-fish has one player action (`ask`); the draw is covered within ask help (CONTEXT Area 1/3).
2. **Can the lockout be browser-verified?** RESOLVED: yes — `boardsmith dev --lock-teaching` sets it (unlike the GFAI-02 demo, which had no such flag).

## Validation Architecture
To prove GFHELP-01 and GFLOCK-01:
- **GFHELP-01:**
  - Integration (go-fish): the `ask` action's `ActionMetadata.help` is the authored string (propagates through `buildActionMetadata`). Assert via a TestGame/session that available-action metadata for `ask` carries `help`.
  - Custom-UI parity (browser checkpoint): the "?" affordance + popover reveal the ask help in the custom GameTable action panel when "Show action help" is ON.
- **GFLOCK-01:**
  - Integration (go-fish): construct a `teachingDisabled: true` session for go-fish; assert `requestHint`/`startDemo`/`startTutorial` each throw the lockout error; assert action help is unaffected (metadata still carries `help`; the toggle gate `hasActionHelp` is independent of teachingDisabled).
  - Browser checkpoint: `--lock-teaching` → Teaching group (hint/demo/tutorial/heatmap) hidden; "Show action help" visible and functional; the four ops would reject (UI hides them so they can't be invoked).
- **Negative/guardrails:** the lockout error must be the real fail-loud message (not a silent no-op); action help must NOT be gated by teachingDisabled (assert both halves).

Test framework: vitest (both repos). Quick: `npm test -- help` / `npm test -- lock` (go-fish). Full: `npm test` each repo. Browser: `boardsmith dev --lock-teaching` human-verify checkpoint (kill server after).
