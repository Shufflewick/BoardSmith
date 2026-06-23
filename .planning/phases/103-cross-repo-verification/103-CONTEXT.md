# Phase 103: Cross-Repo Verification - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-accept from spec (v4.0 autonomous run; verification gate)

<domain>
## Phase Boundary

The milestone gate. After the v4.0 redesign (Phases 97-102), every consuming game and MERC must still **build, pass tests, and play in the browser** with the new Slate chrome. No BoardSmith feature code is written here — this phase verifies, and fixes any cross-repo breakage the redesign caused (games are updated to match deliberate BoardSmith changes per No-Backward-Compatibility; a genuine BoardSmith regression is fixed in BoardSmith). Requirements: VERIFY-01..04.

**Repos under test:**
- `~/BoardSmithGames/` — the games present today: **checkers, cribbage, go-fish, hex, polyhedral-potions, demo-action-panel, demo-animation, demo-complex-ui** (8 dirs; the old 9th, `floss-bitties`, is no longer in the repo — verify against what's actually present, don't invent it).
- MERC at `~/Dropbox/MERC/BoardSmith/MERC` — consumes a **vendored tarball** (`vendor/boardsmith-*.tgz`); the cross-repo canary.

</domain>

<decisions>
## Implementation Decisions

### Consumption mechanisms (confirmed by recon)
- **Games** depend via `"boardsmith": "file:../../BoardSmith"` (a local link to THIS repo) and build/test with `npx boardsmith build` / `vitest`. To pick up the redesign: ensure BoardSmith is built (`npm run build` in BoardSmith), then per game `npm install` (refresh the link) → `npx boardsmith build` → `npm test`.
- **MERC** depends via `"boardsmith": "file:./vendor/boardsmith-0.0.1-<timestamp>.tgz"`. It must be **re-vendored**: pack the new BoardSmith into a fresh timestamped tarball and install it into MERC (the established re-vendor pattern — prefer `npx boardsmith pack --target ~/Dropbox/MERC/BoardSmith/MERC` if that flag exists; otherwise pack, drop the tgz in `MERC/vendor/`, point `package.json` at it, `npm install`). Then `boardsmith build` + run MERC's test suite.

### VERIFY-01 — games build + test (automated, backgroundable)
- Each of the 8 games: clean `npm install` + build + full test suite green. Capture pass/fail per game.

### VERIFY-03 — MERC re-vendor + build + test (automated, backgroundable)
- Re-vendor the new BoardSmith into MERC, build, run MERC's suite. MERC is the canary for any shared-plumbing change (it has a large custom UI). Capture results.

### VERIFY-04 — BoardSmith suite + boundary tests (automated)
- Confirm BoardSmith's own suite is green (1245 after Phase 102) and that an integration test exists for each cross-layer boundary the redesign touched: **token→render** (the `theme.contrast.test.ts` both-theme assertions), **keyboard→select** (the `useSelectable` activation/roving tests), **postMessage→theme** (the `applyTheme` override / GameShell init theme tests). Add any that are missing.

### Cross-repo breakage policy
- If a game/MERC fails to build/test due to a **deliberate** BoardSmith change this milestone (e.g. the `--bs-*`→`--bsg-*` token rename referenced in a custom UI, the removed `showUndo`, an `applyTheme` signature change), **fix the consuming repo** to match — that is the No-Backward-Compatibility cross-repo migration. Document each such fix.
- If a failure reveals a genuine **BoardSmith regression**, fix it in BoardSmith (and re-run the affected repos).
- Do NOT commit changes inside `~/BoardSmithGames/*` or the MERC Dropbox repo without surfacing them — list them so the orchestrator/user decides. (BoardSmith-side fixes follow normal commits.)

### VERIFY-02 — browser playthrough (orchestrator-driven, NOT backgrounded)
- The browser verification is performed by the **main orchestrator** using the Claude-in-Chrome extension (interactively-authenticated; a background agent can't drive it). Coverage: at minimum one game per renderer archetype so every renderer path is exercised in the real Slate chrome — **hex** (HexBoardRenderer), **checkers** (GridBoardRenderer + multi-step), **go-fish or cribbage** (Card/Hand/Deck renderers), **polyhedral-potions** (dice/tableau). For each: the board renders in Slate and fits with no scrollbars; two-step (click/keyboard) selection works AND drag works; the turn status + prompt show; no console errors. Capture a screenshot each.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- The boundary integration tests (contrast, useSelectable, applyTheme) were added across Phases 99/101 — VERIFY-04 mostly confirms, not creates.
- v1.2 added `boardsmith pack` with timestamp versioning + a `--target` flag for consumer integration (the re-vendor path).

### Established Patterns
- Cross-repo re-vendor pattern: pack BoardSmith → install into consumer (MERC) → rebuild. MERC is the canary; project memory notes prior milestones re-vendored MERC per finding.
- CLAUDE.md: don't leave dev servers running; verify behavior by running the app, not just code; enumerate all affected code paths.

### Integration Points
- BoardSmith `dist` (built output the games/MERC consume), the `boardsmith` CLI (`build`/`pack`/`dev`), the games' `file:` link, MERC's vendored tarball.

</code_context>

<specifics>
## Specific Ideas

This is a verification phase — the "deliverable" is a clean cross-repo report + any migration fixes, not a feature. Requirements VERIFY-01..04 in `.planning/REQUIREMENTS.md`. After this passes, the milestone runs its lifecycle (audit → complete → cleanup).

</specifics>

<deferred>
## Deferred Ideas

- Full manual screen-reader pass of all 8 games (the inherently-human A11Y spot-checks from Phase 101) — a representative AT pass during browser verification is enough for the gate; exhaustive AT audit is optional follow-up.
- Host-repo (ShufflewickPub) verification → future host milestone (host is out of scope this milestone).
