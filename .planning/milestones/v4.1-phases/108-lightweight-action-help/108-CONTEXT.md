# Phase 108: Lightweight Action Help - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Let a game author attach per-action help text and let a player reveal it on demand (pointer hover + touch tap) and toggle it globally, persisting across actions. Builds on the v2.8 disabled-reason "why-disabled" friction surface — and closes that surface's loose end by rendering the currently-dead `disabledActions` reason. Substrate + AutoUI rendering land in this repo; checkers-specific help text is authored in Phase 109; browser visual confirmation is Phase 110.

Requirements: HELP-01 (author attaches help; player reveals on hover/tap), HELP-02 (player toggles action help globally).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Authoring & propagation
- Add `help?: string` to `ActionDefinition` (`src/engine/action/types.ts`) and a `.help(text)` method to the action DSL builder, mirroring `.prompt()`. Display-only metadata, never a predicate.
- Propagate help through the existing chain so BOTH UI paths get it for free (parity): `buildActionMetadata()` (`src/session/utils.ts`) copies `actionDef.help` → `ActionMetadata.help?` (`src/session/types.ts`) → `useActionControllerTypes.ActionMetadata.help?` (UI composable). AutoUI reads `action.help`; custom UI reads `actionController.getActionMetadata(name)?.help`.
- Content model: **plain string**, one help text per action (lightweight, per goal). No markdown/rich text.
- Granularity: **action-level only** this phase (HELP-01 = "each action"). Per-selection help is deferred.

### Area 2 — Reveal interaction (pointer + touch)
- Build a small custom **help popover/tooltip** anchored to the action button — one reveal path that serves pointer hover, touch tap, AND the global toggle. (Native `:title` is invisible on touch and not toggleable, so it is NOT the mechanism — though it may remain as a pointer-fallback for disabled-choice reasons elsewhere.)
- Touch reveal: an explicit **"?" info affordance** on/next to the action button that taps to reveal/dismiss. Long-press stays reserved for card zoom (`useZoomPreview`).
- Render/dismiss: popover with `role` + `aria-describedby` (or `role="tooltip"`); dismiss on outside tap / Escape; keyboard focus on the "?" affordance reveals it.
- A11y/motion: reduced-motion = instant (no animation); keyboard accessible; the "?" affordance is a non-color cue (icon/glyph, not color-only). WCAG 2.2 AA, v4.0 Slate tokens.

### Area 3 — Global toggle & persistence
- Toggle lives in **ControlsMenu** as a "Show action help" pill, reusing the existing `.toggle` pill + `menuitemcheckbox` pattern (the Phase 107 heatmap toggle is the blueprint).
- Persist via **localStorage** — action help is a client display preference needing no server round-trip; mirror the existing player-name localStorage pattern in `GameShell.vue`. Holds across actions and reloads.
- Default state **ON**: when ON the "?" help affordances are shown; when OFF they are hidden entirely (no indicators).
- Scope: a single **global client boolean** for the whole client (not per-game), holds across actions and sessions.

### Area 4 — Dead disabledActions surface, parity & scope
- **Wire the currently-dead `disabledActions`**: `PlayerGameState.disabledActions` (v2.8) is populated server-side but rendered nowhere in the UI today. Render its per-action reason on disabled action buttons, reusing the same reveal surface. This closes the "why-disabled" friction loop the goal explicitly builds on. (Keep minimal — surface the existing reason string; do not add a new gating path.)
- Parity: help text + disabled reason flow via `actionMetadata`/broadcast and are tested in BOTH AutoUI and a custom-UI fixture (hard rule), mirroring Phase 105/107.
- Scope boundary: substrate + AutoUI rendering here; checkers-specific help text → Phase 109; browser visual confirmation → Phase 110.
- Verification: vitest — engine help field + `.help()` builder (unit), `buildActionMetadata` propagation + disabledActions surfacing (integration), ActionPanel reveal + global toggle + parity (component).

### Claude's Discretion
- Exact "?" affordance glyph/placement, popover component file name and positioning approach (reuse the overlay/anchor patterns from TutorialOverlay/HeatmapOverlay where sensible), the localStorage key name, and whether the popover is a new small component vs. an extension of an existing helper — at implementation discretion, consistent with v4.0 Slate + existing patterns. As long as the reveal routes through `actionMetadata` (parity) and is set in ONE shared place, not per-UI.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ActionDefinition` (`src/engine/action/types.ts:429-455`) with `.prompt()` on the builder (`action-builder.ts:95`) — `.help()` mirrors it. No `help` field today.
- `disabledActions?: Record<string,string>` on `PlayerGameState` (`src/session/types.ts:447`), populated by `buildActionMetadata`/`getTutorialDisabledActions`, transmitted in broadcast — but `grep "disabledActions" src/ui` = 0 hits (DEAD in UI).
- Per-choice disabled reasons render today as native `:title` on buttons in `ActionPanel.vue` (e.g. :864). No Tooltip/popover component exists anywhere.
- `useZoomPreview.ts` (touchstart→400ms long-press→reveal) is the only existing touch-reveal pattern — model touch handling on it, but use an explicit tap affordance rather than long-press.
- ControlsMenu `.toggle` pill + `menuitemcheckbox` pattern (`ControlsMenu.vue:401-427`) — heatmap toggle (Phase 107) is the exact blueprint.
- Player-name localStorage read/write in `GameShell.vue:88-96` — the persistence pattern to mirror.

### Established Patterns
- Action metadata flows: `buildActionMetadata()` (`session/utils.ts:35-81`) → `ActionMetadata` (`session/types.ts`) → AutoUI prop / `actionController.getActionMetadata()` (custom UI). Adding `help` here serves both paths.
- Overlay/anchor + reduced-motion + aria patterns from TutorialOverlay/HeatmapOverlay (Phase 105/107) for the popover.

### Integration Points
- Engine: `help` field + `.help()` builder.
- Session: `buildActionMetadata` copies help; `ActionMetadata.help`; surface `disabledActions` consumption.
- UI: ActionPanel "?" affordance + popover; ControlsMenu "Show action help" toggle; GameShell localStorage persistence + wiring; custom-UI parity via `getActionMetadata().help`.

### Gaps to build (from scout)
1. `help?: string` on ActionDefinition + `.help()` DSL.
2. help propagation through buildActionMetadata → ActionMetadata → useActionControllerTypes.ActionMetadata.
3. ActionPanel reveal: "?" affordance + custom popover (pointer hover + touch tap).
4. Global "Show action help" toggle in ControlsMenu + localStorage persistence.
5. Render the dead `disabledActions` reason on disabled buttons.
</code_context>

<specifics>
## Specific Ideas

- The goal frames this as "building on the v2.8 disabled-reason 'why-disabled' friction surface" — hence Area 4's decision to actually render the dead `disabledActions` field as part of the same reveal surface.
- Keep it LIGHTWEIGHT (the phase name) — plain-string help, one shared reveal path, reuse existing toggle/persistence patterns, zero new deps.
</specifics>

<deferred>
## Deferred Ideas

- Per-selection (choice/element) help text → future phase.
- Markdown/rich help content → future.
- Checkers-specific help text authoring → Phase 109.
- Browser end-to-end visual confirmation of hover/tap/toggle → Phase 110 demo gate.
</deferred>
