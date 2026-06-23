---
phase: 101
slug: accessibility-wcag-wave-4
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-23
---

# Phase 101 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: extracted from 101-RESEARCH.md "Validation Architecture" (lines ~727-772).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.0 (+ @vue/test-utils ^2.4.11 for jsdom component mounts) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/ui/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-60 seconds (UI module quick run); full suite ~few min |

**DOM test note:** component-mount tests must declare `// @vitest-environment jsdom` as the first line (per `HamburgerMenu.test.ts:1`). Pure-logic composable tests (useSelectable element activation, contrast math) can run in the default node env.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/ui/`
- **After every plan wave:** Run `npm test` (full suite) + `npm run lint:css` (stylelint color-no-hex must stay green)
- **Before `/gsd:verify-work`:** Full suite must be green (1066 baseline after Phase 100 + new a11y tests)
- **Max feedback latency:** ~60 seconds (UI quick run)

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| A11Y-01 | `useSelectable()` calls `triggerElementSelect` on Enter/Space | unit | `npx vitest run src/ui/composables/useSelectable.test.ts` | ❌ W0 (101-01) | ⬜ pending |
| A11Y-01 | Roving tabindex: Arrow/Home/End move focus; Enter/Space activate | unit | `npx vitest run src/ui/composables/useSelectable.test.ts` | ❌ W0 (101-01) | ⬜ pending |
| A11Y-01/04 | CardRenderer has `role="button"` + `tabindex="0"` + aria-label/-selected when selectable | component (jsdom) | `npx vitest run src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` | ❌ W0 (101-02) | ⬜ pending |
| A11Y-01/04 | Piece/Deck/Hand/Space/Die migrated: keyboard-activatable, aria from same booleans | component (jsdom) | parametrized variant in `CardRenderer.a11y.test.ts` (warning-3 fix) | ❌ W0 (101-02/03) | ⬜ pending |
| A11Y-01/04 | GridBoardRenderer `role="grid"` board + `role="gridcell"` cells; Arrow nav advances currentIdx | component (jsdom) | `npx vitest run src/ui/components/auto-ui/renderers/GridBoardRenderer.a11y.test.ts` | ❌ W0 (101-04) | ⬜ pending |
| A11Y-01 | HexBoardRenderer `<g role=gridcell tabindex=0>`; ArrowRight advances currentIdx (partial — Safari/VO manual) | component (jsdom) | `npx vitest run src/ui/components/auto-ui/renderers/HexBoardRenderer.a11y.test.ts` | ❌ W0 (101-04, warning-4 fix) | ⬜ pending |
| A11Y-01 | No `handleClick`/`handleCellClick`/`handleHexClick` survive — composable is the only wiring point | unit (source grep) | `npx vitest run src/ui/components/auto-ui/renderers/useSelectable.divergence.test.ts` | ❌ W0 (101-11) | ⬜ pending |
| A11Y-01/02 | Two-step click/Enter selection AND drag-to-select both work post-migration | integration (jsdom) | `npx vitest run src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts` | ❌ W0 (101-11) | ⬜ pending |
| A11Y-02 | `splitAnchoredChoices` returns secondary list (never drops anchored choices) | unit | `npx vitest run src/ui/components/auto-ui/action-panel-helpers.test.ts` | ❌ W0 (101-06) | ⬜ pending |
| A11Y-02 | Secondary-list button triggers same selection as clicking the board element; footer not fully suppressed | component (jsdom) | ActionPanel test in 101-06 | ❌ W0 (101-06) | ⬜ pending |
| A11Y-03 | isMyTurn/connectionStatus/flowState.complete/winner write expected text to live regions | component (jsdom) | GameShell live-region test (warning-5 fix, 101-05) | ❌ W0 (101-05) | ⬜ pending |
| A11Y-03 | GameHistory is `role="log" aria-live="polite"` | component (jsdom) / grep | grep `role="log"` in GameHistory.vue returns ≥1 | ✅ extend | ⬜ pending |
| A11Y-06 | No `outline: none` survives without a ring; global `:focus-visible` ring present | source grep | `grep -c "outline: none" src/ui/components/auto-ui/ActionPanel.vue src/ui/components/GameHeader.vue` → 0 | manual/CI | ⬜ pending |
| A11Y-07 | `useFocusTrap` moves focus on open, traps Tab, Escape closes (escapeToClose option), restores on close | unit | `npx vitest run src/ui/composables/useFocusTrap.test.ts` | ❌ W0 (101-01) | ⬜ pending |
| A11Y-07 | HamburgerMenu `role="dialog" aria-modal="true"`; GameOverCard `aria-modal="true"` + escapeToClose:false | component (jsdom) | extend `HamburgerMenu.test.ts` + `GameOverCard.test.ts` | ✅ extend (101-08) | ⬜ pending |
| A11Y-08 | `prefers-reduced-motion: reduce` halts pulse/slide/toast; active-player → static high-contrast border | source/grep | grep global `prefers-reduced-motion` block in GameShell + PlayersPanel static border | ✅ partial (101-05/07/10) | ⬜ pending |
| A11Y-09 | Toast warning ≥4.5:1 BOTH themes; muted text (`--bsg-ink-2`) ≥4.5:1 | unit | `npx vitest run src/ui/theme.contrast.test.ts` | ✅ extend (101-01) | ⬜ pending |
| A11Y-09 | cancel/clear/hamburger/⋯ ≥44px; dev swatches/controls ≥24px | source/grep | grep `min-height: 44px`/`min-width: 44px` on named selectors | manual/CI (101-06/08/09) | ⬜ pending |
| A11Y-10 | Toast has `role="status"` (alert for error) + dismiss `<button aria-label="Dismiss">` | component (jsdom) | `npx vitest run src/ui/components/Toast.a11y.test.ts` | ❌ W0 (101-05) | ⬜ pending |
| A11Y-10 | Skip link → `#main`; visually-hidden `<h1>` present in shell | grep | grep `class="sr-skip"` + `<h1` in GameShell.vue | ✅ extend (101-05) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 (plan 101-01) is the composable + token foundation. New test stubs created during the phase:

- [ ] `src/ui/composables/useSelectable.test.ts` — A11Y-01 keyboard activation + roving tabindex (101-01)
- [ ] `src/ui/composables/useFocusTrap.test.ts` — A11Y-07 focus lifecycle (101-01)
- [ ] Extend `src/ui/theme.contrast.test.ts` — Toast warning + muted-text both-theme assertions (101-01)
- [ ] `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` (+ Piece/Deck parametrized variant) — A11Y-01/04 (101-02)
- [ ] `src/ui/components/auto-ui/renderers/GridBoardRenderer.a11y.test.ts` — A11Y-01 grid roles + nav (101-04)
- [ ] `src/ui/components/auto-ui/renderers/HexBoardRenderer.a11y.test.ts` — A11Y-01 hex roving tabindex (101-04, partial/manual-VO)
- [ ] `src/ui/components/auto-ui/action-panel-helpers.test.ts` — A11Y-02 splitAnchoredChoices (101-06)
- [ ] `src/ui/components/Toast.a11y.test.ts` — A11Y-10 role/button (101-05)
- [ ] GameShell live-region announcement test — A11Y-03 watcher writes (101-05)
- [ ] `src/ui/components/auto-ui/renderers/useSelectable.divergence.test.ts` — A11Y-01 source-grep guard (101-11)
- [ ] `src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts` — drag regression + keyboard parity (101-11)
- [ ] Extend `HamburgerMenu.test.ts` + `GameOverCard.test.ts` — A11Y-07 dialog assertions (101-08)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HexBoardRenderer `<g>` focus under Safari/VoiceOver | A11Y-01 | SVG `<g tabindex>` focus reliability cannot be asserted in jsdom; real AT behavior is browser-specific | In Safari with VoiceOver on, Tab into the hex board, Arrow between cells, confirm VO announces per-cell aria-labels and Enter selects. If focus does not land, escalate to overlay-button fallback (research Open Q3). |
| Screen-reader narration of turn/error/disconnect/game-over | A11Y-03 | Live-region announcement timing/voicing is AT-observable, not DOM-assertable beyond text writes | With VoiceOver/NVDA, play a turn handoff, force a disconnect, and finish a game; confirm "Your turn", "Reconnecting", "Game over — X wins" are spoken (game-over assertive). |
| Two-step + drag interaction across all 9 games in browser | A11Y-01/A11Y-02 | Cross-repo real-board interaction (VERIFY-02) | Keyboard-only: Tab to board, activate cells with Enter; then pointer-drag — both must move pieces with no console errors. |
| Focus-visible ring + ≥44px target visual check | A11Y-06/A11Y-09 | Visual rendering of the ring + tap-target size | Tab through chrome; confirm the 2px-bg/4px-accent double ring is visible on every control and touch targets are comfortably tappable. |

---

## Validation Sign-Off

- [x] All requirement behaviors map to an automated verify or a documented manual-only verification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (grep-only renderer migrations are backed by parametrized component tests per warning-3/4 fixes)
- [x] Wave 0 covers all MISSING test references
- [x] No watch-mode flags (all commands use `vitest run`)
- [x] Feedback latency < 60s (UI quick run)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-23
