---
phase: 100
slug: ia-responsive-wave-3
created: 2026-06-23
status: active
source: extracted from 100-RESEARCH.md "Validation Architecture"
---

# Phase 100 — Validation Strategy (IA & Responsive / Wave 3)

`workflow.nyquist_validation` key absent from `.planning/config.json` → treat as enabled.

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `vite.config.ts` (Vitest inline config) |
| Quick run command | `npm run test` |
| Full suite command | `npm run test` |

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IA-01 | `<GameHeader>` absent in platformMode | unit | `vitest run src/ui/components/GameShell.ia.test.ts` | Wave 0 (to create) |
| IA-01 | connection dot renders (not badge text) in platformMode | unit | same | Wave 0 (to create) |
| IA-02 | prompt line renders when `isMyTurn` | unit | same | Wave 0 (to create) |
| IA-03 | buttons suppressed when `allCurrentChoicesAnchored`; prompt visible | unit | same | Wave 0 (to create) |
| IA-04 | dock absent when `!isMyTurn && !awaitingPlayerNames.length` | unit | same | Wave 0 (to create) |
| IA-04 | `--bsg-dock-h` CSS var set by ResizeObserver | unit | same | Wave 0 (to create) |
| IA-05 | `.grid-cell` width = `var(--cell)` not `50px` | unit/snapshot | `vitest run src/ui/components/auto-ui/renderers/GridBoardRenderer.fluid.test.ts` | Wave 0 (to create) |
| IA-06 | sidebar collapses to rail; phone seat strip carries turn status | unit | `vitest run src/ui/components/GameShell.ia.test.ts` | Wave 0 (to create) |
| IA-07 | Game Over card renders when `flowState.complete` | unit | `vitest run src/ui/components/GameOverCard.test.ts` | Wave 0 (to create) |
| IA-07 | `winnerSeats` captured from `game_state` postMessage | unit | `vitest run src/ui/components/GameShell.ia.test.ts` | Wave 0 (to create) |

## Sampling Rate
- **Per task commit:** `npm run test`
- **Per wave merge:** `npm run test && npm run lint:css`
- **Phase gate:** Full suite (1002+) green before `/gsd:verify-work`

## Wave 0 Gaps (tests to create during execution)
- [ ] `src/ui/components/GameShell.ia.test.ts` — covers IA-01, IA-02, IA-03, IA-04, IA-06, IA-07 (postMessage)
- [ ] `src/ui/components/GameOverCard.test.ts` — covers IA-07 (render + graceful degrade)
- [ ] `src/ui/components/auto-ui/renderers/GridBoardRenderer.fluid.test.ts` — covers IA-05 (cell sizing)
- [ ] `src/ui/components/auto-ui/renderers/CardRenderer.fluid.test.ts` — covers IA-05 (card sizing)

## Dimension 8 Notes
The canonical validation architecture lives here; the same content is mirrored in
`100-RESEARCH.md` "Validation Architecture" for researcher continuity. Plans 100-01..06
each map their requirement(s) to the test files above and run `npm run test` + `npm run lint:css`
in their automated verify steps.
