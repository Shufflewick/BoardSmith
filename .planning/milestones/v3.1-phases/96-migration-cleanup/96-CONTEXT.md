# Phase 96: Migration & Cleanup - Context

**Gathered:** 2026-06-22
**Status:** Reconnaissance complete — scope narrowed before planning

<domain>
## Phase Boundary (from ROADMAP)

Every game in `~/BoardSmithGames/` migrated to the new auto-UI and browser-verified
playable; MERC canary green on shared-plumbing changes; old renderer + split-screen
scaffold deleted; docs updated; `npm run audit` clean.
</domain>

<reconnaissance>
## What is ALREADY done (Phases 93 + 95)

- **Old renderer deleted:** `AutoElement.vue` / `AutoGameBoard.vue` are gone (Phase 93-06). Confirmed absent.
- **Split-screen scaffold removed:** Phase 95-01 replaced the split-screen `generateAppVue` with a single-UI scaffold; the generated game opens single-UI (browser-verified in 95-04).
- **hex / go-fish / checkers** already browser-verified playable on the new auto-UI in Phases 93/94/94.1.

## Current automated state (2026-06-22)

Games are symlinked to current BoardSmith source (`file:../../BoardSmith`), so they run
against the v3.1 changes directly. **All game test suites pass:**

| Game | Tests | Notes |
|------|-------|-------|
| hex | 19 ✓ | already browser-verified (Ph 93/94) |
| go-fish | 30 ✓ | already browser-verified (Ph 94.1) |
| checkers | 15 ✓ | already browser-verified (Ph 94.1) |
| cribbage | 20 ✓ | custom multi-phase UI |
| polyhedral-potions | 24 ✓ | |
| demo-animation | 8 ✓ | |
| demo-complex-ui | 4 ✓ | |
| demo-action-panel | (build-only) | no test script |

8 games total (ROADMAP said "9" — actual is 8). The v3.1 shared-plumbing changes
(refs[] protocol from 94-01, new renderer, overlay) broke **no** game tests.

BoardSmith main suite: **927/927 green** (incl. the 2 pre-existing src/ui failures
fixed this session: useActionController followUp-skip + useBoardActionBridge auto-start).

## `npm run audit` reality

`npm run audit` (fallow dead-code + jscpd duplication) reports ~411 dead-code +
299 dupe + 348 health findings. Per `BoardSmith/CLAUDE.md`, these are **mostly false
positives** — "our public API is consumed by external game projects, not internally."
Literal "audit clean" (zero findings) is neither achievable nor meaningful and was not
true pre-v3.1. The honest criterion: **no NEW genuinely-dead code introduced by the
v3.1 migration** (old renderer already deleted leaves no dangling refs).
</reconnaissance>

<remaining_work>
## What Phase 96 actually still needs

1. **Browser-verify the not-yet-verified games playable** on current BoardSmith:
   cribbage, polyhedral-potions, demo-animation, demo-complex-ui, demo-action-panel.
   (hex/go-fish/checkers already verified.)
2. **MERC canary** (`~/Dropbox/MERC`): build/test green on the shared-plumbing changes.
3. **Docs** updated for any migration-facing changes (the `boardsmith.json "ui"` field,
   single-UI scaffold — much already done in Phase 95-02).
4. **Confirm no new dead code** from the renderer replacement (dangling exports/imports
   to the deleted old renderer) — not a literal zero-findings audit.
</remaining_work>

<scope_decision_pending>
## Open scope question (surfaced to user before planning)

The "delete" half is already done and "audit clean" is not literally achievable, so the
real remaining work is per-game browser verification + the MERC canary. The browser
marathon (5 remaining games + MERC, a large separate Dropbox repo) and the exact
MERC/audit/docs bar are a scope decision for the user.
</scope_decision_pending>
