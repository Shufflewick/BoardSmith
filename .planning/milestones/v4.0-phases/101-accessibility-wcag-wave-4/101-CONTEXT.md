# Phase 101: Accessibility — WCAG 2.2 AA (Wave 4) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-accept from spec (v4.0 autonomous run; a11y markup pinned to the canonical mockup)

<domain>
## Phase Boundary

Close the accessibility gaps — including the milestone's only **Critical** findings. Make the board fully keyboard-operable through ONE shared composable; announce state via live regions; expose semantic names/state; pair every color with a non-color cue; restore focus rings; give dialogs real semantics; honor reduced-motion; meet contrast + touch-target floors. Requirements: A11Y-01..10. Target: WCAG 2.2 AA.

**In scope (this repo):** all 8 renderers + composables, `ActionPanel.vue`, `GameShell.vue`, `GameHistory.vue`, `PlayersPanel.vue`, `Toast.vue`, `HamburgerMenu.vue`, `ControlsMenu.vue`, `GameOverCard.vue`, `DebugPanel.vue`, `DevHost.vue`.
**Out of scope (host repo):** host `default.vue`/`[sessionId].vue`/`GameLobby.vue` skip-link/h1/live-region relays — the BoardSmith side exposes the data (announce postMessage, etc.); the host consumes it later (deferred).

**The canonical mockup `planning/mockups/boardsmith-chrome.html` already demonstrates the target a11y markup — mirror it.**

</domain>

<decisions>
## Implementation Decisions

### A11Y-01 — keyboard-operable board (CRITICAL, architectural) — do it ONCE
- Create a shared **`useSelectable()`** composable that centralizes the copy-pasted `handleClick` across renderers and binds `@click` **and** `@keydown.enter/space` to the **same** `triggerElementSelect`. It emits a real `<button>` or `role="button"` + `tabindex`, and implements a **roving-tabindex grid** for board renderers (`role="grid"` on the board, `role="gridcell"` on cells, arrow-key + Home/End navigation, one tab stop into the grid).
- Apply to **all 8 renderers + the hex `<g>`**. Build it once in the composable so divergence is impossible (the spec's #2 highest-risk item).
- **Drag becomes progressive enhancement** — two-step click/Enter selection is the primary movement path. Wire the already-computed `isDropTarget` set to click/Enter activation (`CardRenderer.vue:348`, `GridBoardRenderer.vue:151`, etc.). **Regression-test that drag still works.**
- Mirror the mockup: `role="grid" aria-label="Game board, N by M"`, `role="gridcell"`, selectable cells `tabindex="0" aria-label="c8, selectable"`.

### A11Y-02 — action-panel parity (CRITICAL)
- `filterAnchoredChoices` (`ActionPanel.vue:255`) must return board-anchored choices in a **secondary focusable list** rather than dropping them, and the footer must never fully suppress while picks are pending. (Phase 100 already keeps the prompt visible; this adds the keyboard-reachable choice list so SR/keyboard users always have an operable control even when every pick is board-anchored.)
- This guarantees the two Critical user classes (keyboard, screen-reader) can always act.

### A11Y-03 — live regions & SR narration
- Add a visually-hidden **`role="status" aria-live="polite"`** region and a **`role="alert" aria-live="assertive"`** region (mirror the mockup's `#live`/`#alive`). Place in `GameShell` + `AutoUI` (and `DevHost` for dev). Make `GameHistory` `role="log" aria-live="polite"`.
- Write announcements on phase/WS transitions: "Your turn", "Alice is playing…", "Maeve disconnected", "Game over — Bram wins", "Reconnecting". The BoardSmith side also emits an `announce` postMessage so a future host can relay (host relay deferred).

### A11Y-04 — semantic names & state
- Each renderer computes an `aria-label` ("e5, white knight, selectable") and sets `aria-selected`/`-disabled`/`-current` from the **same booleans** that drive the CSS. Grids `role="grid"`; hands `role="group" aria-label="Your hand, 5 cards"`; hex SVG `role="group"` + per-cell labels + a non-color owner glyph. Players panel `role="list"`/`role="listitem"` (mockup).

### A11Y-05 — non-color state cues + legend
- Pair every color state with a shape/icon/border-style + label: selected = ring/check, selectable = dashed border, drop-target = dotted/stripes (much of this shipped visually in Phase 99 — here formalize it, ensure each has an accompanying label/icon, and add the **legend** the mockup shows). Player identity = color + letter-holding **shape** (mockup `.sh-circle`/`.sh-hexagon`/etc.) so seats are distinguishable without color (handles the Sam/Sally initial collision via the ring variant). Colorblind-safe.

### A11Y-06 — visible focus ring (pin the mockup's treatment)
- Global `:focus-visible` ring exactly as the mockup: `outline:none; box-shadow: 0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent); border-radius: var(--bsg-r-sm)` on every interactive element. **Delete the two `outline:none` declarations** that kill focus (`ActionPanel.vue:1366`, `GameHeader.vue:193`) — replace with the ring.

### A11Y-07 — dialog semantics + focus management
- The hamburger drawer, the `ControlsMenu` ⋯ menu, and the `GameOverCard` overlay become `role="dialog" aria-modal="true"` (menu may use `role="menu"`/`aria-haspopup="menu"` per the mockup's `#menuToggle`) with: focus move on open, **focus trap**, **Escape-to-close**, restore-focus on close, and `inert` on the rest of the app while open. Reuse a single composable/util for trap+restore so all three behave identically.

### A11Y-08 — reduced motion (single global block)
- Add the one global block so vestibular-sensitive users get instant state:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .01ms !important; animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }
  ```
- Ensure the active-player breathe (Phase 99) and any FLIP/drag/toast animation degrade to static under it. The turn cue becomes a static high-contrast border when reduced.

### A11Y-09 — contrast + touch-target sweep
- Route every `#666`/`#888`/`opacity:.35` muted text through `--bsg-ink-2`/`--bsg-ink-3` (the verified Slate muted inks). **Fix the Phase-99 carry-over:** Toast `.warning` is 3.37:1 in light mode — bump it to ≥4.5:1 for small text (darker warn ink or larger/bolder text). Re-run the both-theme contrast assertions and extend them to cover toasts + muted text.
- Enforce a **≥44px** target floor (24px CSS-px minimum per SC 2.5.8, but use 44px) on action buttons, ✕ controls, hamburger/⋯, color swatches, rail toggle, and dev controls.

### A11Y-10 — toasts + skip link + h1
- Toasts become `role="status"` (assertive variant `role="alert"`) with a real `<button aria-label="Dismiss">` and an auto-timeout.
- Add the mockup's **`.sr-skip` skip link → `#main`** and ensure a real `<h1>` exists for the play view (in-repo shell). (Host lobby skip-link/h1 are out of scope.)

### Scope guardrails
- Slate only — no new neon; `npm run lint:css` stays green. Keep tests green (1066 after Phase 100). Add a11y tests: keyboard activation per renderer, roving-tabindex nav, live-region writes on transitions, focus-trap+restore on each dialog, aria-label/-selected correctness, reduced-motion, contrast.
- Preserve the "Custom UI ↔ Action Panel parity via `useBoardInteraction`" invariant — `useSelectable` must work for custom UIs too, not just auto-UI.
- Do NOT do Phase 102 work (DebugPanel reskin/tabs beyond its dialog/focus a11y, dev collapse, seat switcher, New-Game confirm) except where a control needs a name/focus ring/target-size to pass this wave.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Booleans already exist on every renderer: `isSelectable`/`isSelected`/`isDropTarget`/`isDisabled` (drive both CSS and the new aria-* and the composable). `triggerElementSelect` is the single selection entry point. `useBoardInteraction` is the shared interaction substrate.
- `ControlsMenu.vue` + `GameOverCard.vue` were created in Phase 100 and now need dialog semantics here.
- The mockup `planning/mockups/boardsmith-chrome.html` is a complete a11y reference: focus ring, skip link, dual live regions, grid/gridcell roles, roving tabindex, list roles, shape-based identity, legend.

### Established Patterns
- Phase 99 added dashed/solid/dotted interaction visuals (the non-color cues) and Phase 98 added the focus-ring tokens (`--bsg-accent`, `--bsg-bg`).
- CLAUDE.md: parity invariant (Custom UI + Action Panel), Pit of Success (the keyboard path must be the easy/default path, drag is the enhancement), no fallbacks.

### Integration Points
- One shared `useSelectable()` consumed by all 8 renderers + a shared focus-trap util consumed by the 3 dialogs. Live-region writes hook the same phase/WS transition points the turn status uses.

</code_context>

<specifics>
## Specific Ideas

Design sources: `planning/mockups/boardsmith-chrome.html` (a11y markup — authoritative) and `planning/boardsmith-ui-redesign-spec.md` "Accessibility Plan (WCAG 2.2 AA)" (§1-11, lines ~995-1182) + Wave 4 (lines ~1319-1338) for the deliverable list, file anchors, and the dev verification checklist (use it as the test plan).

</specifics>

<deferred>
## Deferred Ideas

- DebugPanel full reskin/ARIA-tabs/`D`-shortcut gating, dev chrome collapse-to-tab, seat switcher, "Table setup" panel, New-Game two-click confirm, material/vignette layer → Phase 102 (Wave 5). (This phase only gives those controls names/focus/target-size where needed.)
- Host-side skip-link/h1/live-region relay, host nav-shade `inert` → future host milestone.

</deferred>
