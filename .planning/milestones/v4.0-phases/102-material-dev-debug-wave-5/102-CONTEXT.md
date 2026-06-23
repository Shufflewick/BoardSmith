# Phase 102: Material Polish & Dev/Debug Parity (Wave 5) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-accept from spec (v4.0 autonomous run)

<domain>
## Phase Boundary

Bring the dev/debug surfaces up to the Slate standard and restore the dev's "god-mode" capability. A reskinned DebugPanel, a collapsible dev bar with a working seat switcher + presence strip + "Table setup" panel, voiced loading/empty/error states, read-only player history, a destructive-action confirm, and the Slate material layer. Requirements: DEV-01..08.

**In scope (this repo):** `DebugPanel.vue`, the dev-server chrome (`src/cli/dev-host/` — `DevHost.vue`, `host.html`), `AutoRenderer.vue`, `UnsupportedTopologyPanel.vue`, `GameHistory.vue`.
**Out of scope (host repo):** the ShufflewickPub `main.css` grain/vignette and host lobby — DEV-08's material layer applies to the **in-repo dev/standalone chrome only**.

</domain>

<decisions>
## Implementation Decisions

### DEV-01 — DebugPanel reskin + a11y
- Reskin `DebugPanel.vue` to Slate tokens (graphite surface, `--bsg-accent` tab, `--bsg-mono` for data, amber-ish syntax via tokens). No raw hex (lint:css stays green).
- Its toggle becomes a real `<button aria-expanded>`. Gate the bare `D` keyboard shortcut behind a **modifier** (e.g. Ctrl/Cmd+D won't conflict — pick a safe combo) AND a `contenteditable`/input-focus guard so typing "d" in a field never opens it.
- Apply the **ARIA tabs pattern** (`role="tablist"`/`tab`/`tabpanel`, arrow-key nav) to its tabbed sections. On phone, re-dock to a bottom sheet; replace `calc(100vh-280px)` with flex `min-height:0`.

### DEV-02 — dev chrome collapse
- The dev-server bar auto-collapses to a slim **pull-tab** (echoing a tab/sign), **default-collapsed once seated**, persisted in `localStorage`. Below 640px, controls become icon-only with a `…` overflow. Cinzel-free (Slate uses Hanken/`--bsg-font`); drop any duplicated game title the iframe already renders.

### DEV-03, DEV-04 — restore dev god-mode
- The dev **seat badge becomes a working seat switcher** (wire the dead `leaveSeat`/seat-select path, or replace it with a real switcher; integrate with the existing follow-active-seat dev toggle if present). 
- Add a **presence strip** showing who is connected / AI / away (per-seat status).
- Add a tucked-away **"Table setup" panel** that renders the already-injected `aiSeats`/`aiLevel`/`playerCount`/`gameOptions`/`playerOptions` (currently surfaced nowhere) — read-only display is fine; editing is not required by the requirement.

### DEV-05 — voiced states
- Loading → a **skeleton with a timeout→retry** affordance (`AutoRenderer.vue:154`), not a bare spinner forever.
- Split `UnsupportedTopologyPanel.vue` into a **friendly player-facing message** + a **dev-only** console/Debug guidance block with a real link. Players never see raw dev diagnostics.

### DEV-06 — history cleanup
- Player-facing `GameHistory` becomes **read-only**; move **Copy/Clear into `DebugPanel`**. Fix the silent un-clear bug where local `clearHistory` silently un-clears (`GameHistory.vue:90`).

### DEV-07 — destructive-action confirm
- The dev "New game" (broadcasts `restart` to all seats) requires a **two-click confirm** (or a small confirm popover), **neutral styling** (not the emerald CTA — Phase 99 already demoted it), and emits a **broadcast toast** so all seats know a restart happened. (Honors CLAUDE.md `always_confirm_destructive`.)

### DEV-08 — Slate material layer (dev/standalone only)
- Replace the white dot-grid grain (reads as TV static) with a **low-opacity SVG noise + a screen vignette** in the in-repo dev/standalone chrome (`src/cli/dev-host/host.html` / DevHost). Neutral/graphite, not warm. Drop `background-attachment:fixed` for a fixed decorative layer if it causes jank. Subtle — the board stays the hero.

### Scope guardrails
- Slate only; `npm run lint:css` stays green (empty ignore list). Keep tests green (1186 after Phase 101). Add tests for: the `D`-shortcut guard, the New-Game confirm + broadcast toast, the history read-only + Copy/Clear-moved behavior, the seat switcher, and skeleton timeout→retry.
- This is the LAST implementation wave — do not start Phase 103 (cross-repo verification). Do not touch host-repo files.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- All Slate tokens (incl. `--bsg-mono`, surfaces, accent) exist from Phase 98; the focus-trap util + focus-ring + reduced-motion from Phase 101 apply to the new dev dialogs/sheets.
- The dev already injects `aiSeats`/`aiLevel`/`playerCount`/`gameOptions`/`playerOptions` (DEV-04 just surfaces them). A follow-active-seat dev toggle may already exist (see project memory) — integrate the seat switcher with it rather than duplicating.
- `Toast` (now `role=status` + dismiss, Phase 101) is the broadcast-toast mechanism for DEV-07.

### Established Patterns
- Dev chrome lives in `src/cli/dev-host/`. CLAUDE.md: `always_confirm_destructive` (DEV-07), no fallbacks, Pit of Success, "don't leave a dev server running."

### Integration Points
- `DebugPanel.vue`, `DevHost.vue`, `host.html`, `AutoRenderer.vue`, `UnsupportedTopologyPanel.vue`, `GameHistory.vue`.

</code_context>

<specifics>
## Specific Ideas

Design sources: `planning/boardsmith-ui-redesign-spec.md` Wave 5 (lines ~1342-1354) + the Dev-Server Chrome redesign section (lines ~757-857) for the collapse/seat-switcher/Table-setup detail. Slate material (neutral noise + vignette), NOT the tavern wood/candle described in the spec body.

</specifics>

<deferred>
## Deferred Ideas

- Host-repo material/grain (`main.css`), host lobby, host connection banner → future host milestone.
- Cross-repo game + MERC verification → Phase 103.

</deferred>
