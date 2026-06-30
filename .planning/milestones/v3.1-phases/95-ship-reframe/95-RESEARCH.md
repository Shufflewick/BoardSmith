# Phase 95: Ship & Reframe — Research

**Researched:** 2026-06-22
**Domain:** CLI scaffold generator, Vite build tooling, docs/framing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Fresh scaffold opens in auto-UI by default — playable immediately — with an empty/ready custom-UI slot. No split-screen comparison.
- **D-02:** `boardsmith.json` `"ui"` field is the author-facing selector. Must resolve to exactly ONE static import in the generated/production entry so tree-shaking drops unselected UIs. No runtime registry. No `rollupOptions.input`.
- **D-03:** Scaffold generates a minimal empty custom-UI stub (clearly marked "start here"); game renders via auto-UI until author fills stub and sets `"ui"` to it.
- **D-04:** Strict single-UI in dev — `boardsmith dev` shows exactly the chosen UI (from `boardsmith.json "ui"`). No live switcher, no `?ui=auto` peek, no dual-mount. The split-screen dev host is replaced by single-UI.

### Claude's Discretion
- `boardsmith.json` schema details for `"ui"`, the custom-UI stub's exact contents, README/CLI/doc wording for the reframe, and how `boardsmith dev`/`build` resolve `"ui"` are planner's discretion within the above.
- Reframe applies to scaffold generator + dev host + docs; migrating EXISTING games' scaffolds is Phase 96.

### Deferred Ideas (OUT OF SCOPE)
- Cross-repo migration of all existing games + MERC canary + old-path deletion + `npm run audit` — Phase 96.
- N-UI registry + live dev-time switcher (§0 C5c) — later milestone.
- Auto-generate-then-eject (S10) — later milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHIP-01 | Auto-UI is a selectable, shippable production UI, not merely a dev/debug panel — reframe all docs/CLI/scaffold that call it "debug aid", "reference implementation", or "prototyping only" | Exact file locations and offending strings catalogued in § Reframe Surface below |
| SHIP-02 | Production build emits single UI — removing scaffold's static `import { AutoUI }` lets tree-shaking drop unselected UIs (no registry, no `rollupOptions.input`) | Build pipeline traced in § Build Pipeline section; tree-shaking path confirmed |
| SHIP-03 | Scaffold generates game that opens in chosen UI; no split-screen "Custom vs Auto-Generated" panel | `generateAppVue()` is the only source of split-screen; exact replacement pattern documented |
</phase_requirements>

---

## Summary

Phase 95 is a CLI/scaffold/docs phase. Almost all the work is in two files: `src/cli/lib/project-scaffold.ts` (which generates every file a new game starts with) and the doc/slash-command files that frame AutoUI as a "debug/prototype" tool. The underlying build tooling (Vite + Rollup in `boardsmith build`) already provides perfect tree-shaking for free — it just needs the scaffold to stop generating a split-screen App.vue that imports both AutoUI and GameTable simultaneously.

The dev host (`DevHost.vue`, `dev.ts`) does **not** mount a split-screen today. The split-screen is entirely inside the game's own `App.vue` template that the scaffold generates. Fixing the scaffold fixes `boardsmith dev` automatically — because dev serves the game's `App.vue` through an iframe, so a single-UI `App.vue` yields single-UI dev with zero changes to `dev.ts`.

**Primary recommendation:** Edit `generateAppVue()` and `generateBoardsmithJson()` in `project-scaffold.ts`; add `"ui": "auto"` to the config schema; reframe ~6 doc locations that use prototype/debug/reference framing.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UI selector (`boardsmith.json "ui"`) | CLI (build-time) | — | Drives `generateAppVue()` at scaffold time; no runtime registry |
| Single static import in App.vue | Frontend (game project) | CLI (generator) | The static import IS the tree-shaking boundary |
| Dev server UI rendering | Frontend (iframe / game App.vue) | CLI (dev plugin) | DevHost wraps an iframe; App.vue content determines what renders |
| Production bundle tree-shaking | Vite/Rollup | — | Native ES module tree-shaking; no extra config needed |
| Reframe framing | Docs / CLI text | — | Text-only changes in doc files and scaffold templates |

---

## Standard Stack

No new packages are introduced in this phase. All work is edits to existing code.

| Tool | Current Version | Role | Notes |
|------|----------------|------|-------|
| Vite | `^5.0.0` (per scaffold `devDependencies`) | Builds game UI bundle | Tree-shaking is native Rollup; already works |
| `boardsmith/ui` | local monorepo | Exports `AutoUI`, `AutoRenderer` | Both exported from `src/ui/index.ts` line 33–35 |
| chalk, ora | existing | CLI output | No changes |

## Package Legitimacy Audit

No new packages are installed in this phase.

---

## Architecture Patterns

### How `boardsmith dev` serves a game today (confirmed by code trace)

```
boardsmith dev
  └── dev.ts devCommand()
        ├── reads boardsmith.json → BoardSmithConfig
        ├── loadGameRuntime() → esbuild bundles src/rules/ for Node
        ├── MultiplayerHost (Node WS host, authoritative game state)
        └── Vite dev server
              ├── '/' → serves host.html (DevHost.vue) [boardsmithDevHostPlugin]
              └── '/__boardsmith/play' → SPA fallback → game's index.html
                    → src/main.ts → src/ui/index.ts → App.vue (iframe content)
```

**Key insight:** The iframe at `/__boardsmith/play` serves the game's own `App.vue`. The DevHost itself (`DevHost.vue`) is only the outer lobby/WS bridge. The split-screen today is 100% inside the game's `App.vue` template — not in DevHost. Changing `App.vue` to render AutoUI only immediately achieves D-04 with zero changes to `dev.ts` or `DevHost.vue`. [VERIFIED: code trace of `src/cli/commands/dev.ts` and `src/cli/dev-host/DevHost.vue`]

### How `boardsmith build` produces the UI bundle (confirmed by code trace)

```
boardsmith build
  └── build.ts buildCommand()
        ├── viteBuild({ lib: { entry: 'src/rules/index.ts' } }) → dist/rules/rules.js
        └── viteBuild({ root: cwd }) → dist/ui/
              uses game's index.html → src/main.ts → App.vue as entry
              Rollup tree-shakes from that entry — only imported components end up in bundle
```

**Key insight:** The production UI build is a standard Vite/Rollup SPA build from `index.html`. If `App.vue` imports only `AutoUI`, only `AutoUI` (and its transitive deps) appear in the bundle. If `App.vue` imports only `GameTable`, only `GameTable` appears. No `rollupOptions.input` manipulation is needed — this is standard Rollup tree-shaking. [VERIFIED: `src/cli/commands/build.ts` lines 85–98]

### Tree-shaking mechanism (D-02)

The `boardsmith.json "ui"` field is a **scaffold-time selector**, not a runtime registry. At `boardsmith init`, `generateAppVue()` reads the `"ui"` field and generates an `App.vue` with exactly one static import. After that, Vite/Rollup's native tree-shaking drops anything not reachable from that import.

```
"ui": "auto"           → App.vue: import { AutoUI } from 'boardsmith/ui'
                          Result: AutoUI IS in bundle; GameTable stub is not
"ui": "./ui/GameTable.vue" → App.vue: import GameTable from './components/GameTable.vue'
                              Result: AutoUI is NOT in bundle (dropped by Rollup)
```

This is exactly §0 C5b: "nearly free: remove the scaffold's static `import { AutoUI }`, after which ordinary tree-shaking drops it." [ASSUMED — exact behavior depends on tree-shaking; see Validation Architecture for proof command]

---

## Current Scaffold — Exact State

Everything a new `boardsmith init my-game` generates comes from `generateScaffoldFiles()` in `src/cli/lib/project-scaffold.ts` line 471–485. [VERIFIED: `src/cli/lib/project-scaffold.ts`]

### Generated files today

| Path | Generator Function | Phase 95 Change? |
|------|-------------------|-----------------|
| `boardsmith.json` | `generateBoardsmithJson()` L102 | YES — add `"ui": "auto"` field |
| `src/ui/App.vue` | `generateAppVue()` L263 | YES — replace split-screen with single AutoUI |
| `src/ui/components/GameTable.vue` | `generateGameTableVue()` L353 | YES — replace placeholder warning with "start here" comment |
| `src/main.ts` | `generateMainTs()` L216 | No |
| `src/ui/index.ts` | `generateUiIndexTs()` L251 | No (or minor cleanup) |
| `package.json`, `tsconfig.json`, etc. | various | No |

### The split-screen in `generateAppVue()` (exact source)

`src/cli/lib/project-scaffold.ts` lines 263–348. The offending code:

```typescript
// Line 265 — imports both UIs:
import { GameShell, AutoUI } from 'boardsmith/ui';
import GameTable from './components/GameTable.vue';

// Lines 277–296 — side-by-side grid:
<div class="board-comparison">     // grid-template-columns: 1fr 1fr
  <div class="board-section">
    <h2 class="board-title">Custom UI</h2>
    <GameTable ... />
  </div>
  <div class="board-section">
    <h2 class="board-title">Auto-Generated UI</h2>   // ← offending label
    <AutoUI ... />
  </div>
</div>
```

### The placeholder warning in `generateGameTableVue()` (exact source)

`src/cli/lib/project-scaffold.ts` lines 385–386:

```html
<div class="placeholder-notice">
  ⚠️ This is a placeholder UI - customize GameTable.vue for your game!
</div>
```

This positions GameTable as mandatory and auto-UI as secondary — exactly the framing to remove.

---

## Reframe Surface (SHIP-01) — Complete Inventory

Every location that uses "debug/prototype/reference" framing for AutoUI: [VERIFIED: grep of entire repo]

### 1. `src/cli/lib/project-scaffold.ts`

| Location | Offending text | Fix |
|----------|---------------|-----|
| `generateAppVue()` line 288 | `<h2 class="board-title">Auto-Generated UI</h2>` | Remove entirely (no split-screen) |
| `generateGameTableVue()` line 386 | `⚠️ This is a placeholder UI - customize GameTable.vue for your game!` | Replace with "start here" comment |

### 2. `docs/ui-components.md`

| Line | Offending text | Fix |
|------|---------------|-----|
| 139 | `Automatic UI generation from game state. Useful for prototyping or as a reference implementation.` | Reframe: "A production-ready UI for any game. Ideal for simple games or as a starting point." |
| 155–161 | Bullet list ends with no production framing | Add: "Ships as your production UI for simple games — no custom UI required" |

### 3. `docs/component-showcase.md`

| Line | Offending text | Fix |
|------|---------------|-----|
| 103 | `Automatic UI generation for prototyping.` | Reframe: "Production-ready automatic game UI." |
| 115 | `- Rapid prototyping` | Keep (it IS good for prototyping, just not ONLY that) |
| 117 | `- Debugging game state` | Remove or reframe as secondary |
| 118 | `- Reference implementation` | Remove |

### 4. `docs/nomenclature.md`

| Line | Offending text | Fix |
|------|---------------|-----|
| 416 | `Auto-generated game interface that renders any game without custom UI code. Useful for prototyping and as a reference implementation.` | Add shippable-peer framing |
| 421 | `"Use AutoUI to test rules before building custom UI"` | Update: "Use AutoUI to ship simple games or build rules before investing in custom UI" |

### 5. `src/cli/slash-command/instructions.md`

| Line | Offending text | Fix |
|------|---------------|-----|
| 702 | `**You MUST customize GameTable.vue to show actual game elements.** Never leave the JSON dump placeholder.` | Update: only mandatory when building custom UI; AutoUI is a valid shipping choice |
| 1029 | `**DO NOT SKIP THIS STEP.** The scaffold creates a placeholder UI. You MUST replace it with a custom UI that shows actual game elements.` | Reframe: explain that AutoUI ships and GameTable is an on-ramp, not a requirement |
| 1035 | `After customizing, the Custom UI panel should show:` | Update to reflect single-UI (no "Custom UI panel" in split-screen) |

**Note on `instructions.md`:** The design-game slash command flow currently assumes the developer MUST customize GameTable.vue immediately. With the new scaffold (D-01/D-03), the flow becomes: (1) `boardsmith init` → game is playable immediately via AutoUI, (2) author optionally fills the stub and switches `"ui"` when they want a custom UI. The instructions need to reflect this branching path. [VERIFIED: `instructions.md` lines 698–703, 1027–1040]

### 6. `docs/llm-overview.md`

| Line | Offending text | Fix |
|------|---------------|-----|
| 13 | `AutoUI can render any game without custom components` | Add: "and can ship as the production UI for simple games" |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tree-shaking unused UI | `rollupOptions.input` multi-entry or runtime registry | Ordinary static import elimination by Rollup | One static import in App.vue is sufficient; Rollup eliminates unreachable modules |
| Virtual entry point for UI selection | Custom Vite plugin with `virtual:boardsmith-ui` | Scaffold-generated `App.vue` with correct static import | The scaffold IS the code generator; no runtime indirection needed |

**Key insight:** The N-UI registry + live switcher (D-04 explicitly excludes) would require a runtime import-all approach that defeats tree-shaking. The single-static-import approach is both simpler and correctly tree-shakeable.

---

## Common Pitfalls

### Pitfall 1: Breaking the design-game slash-command flow

**What goes wrong:** The `/design-game` skill (`instructions.md`) currently instructs the LLM to "DO NOT SKIP — customize GameTable.vue." After Phase 95, a newly scaffolded game opens in AutoUI and the custom-UI stub is optional. If `instructions.md` is only partially updated, the LLM may still force-replace App.vue with a GameTable reference, overriding the scaffold's correct state.

**Why it happens:** `instructions.md` is a self-contained embedded skill document; it has its own copy of the App.vue template and its own step-by-step instructions. Updating only the scaffold generator and docs but not `instructions.md` leaves the skill misaligned.

**How to avoid:** Update `instructions.md` in the same plan wave as the scaffold changes. The new flow should: scaffold → play with AutoUI → optionally fill GameTable stub → update `boardsmith.json "ui"` and `App.vue` to switch.

**Warning signs:** After Phase 95, running `/design-game` and seeing a split-screen still appears means `instructions.md` was not updated.

### Pitfall 2: Desync between `boardsmith.json "ui"` and App.vue

**What goes wrong:** If the `"ui"` field is informational-only (set at scaffold time) but App.vue is edited manually later, the two can desync. An author who manually edits App.vue to use GameTable but forgets to update `boardsmith.json "ui"` would have `"ui": "auto"` in config but GameTable in App.vue.

**Why it happens:** The config field and the App.vue import are two separate artifacts. Phase 95's design keeps them in sync only at scaffold time.

**How to avoid:** For Phase 95, document in the README/docs that changing the UI requires two edits: (1) update `boardsmith.json "ui"`, (2) update `App.vue` import and template. The planner may choose to add a validation in `boardsmith validate` that checks consistency (out of scope for this phase but worth noting).

**Warning signs:** `boardsmith.json "ui"` says `"auto"` but App.vue imports GameTable.

### Pitfall 3: GameTable.vue stub accidentally imported by GameShell slot

**What goes wrong:** The scaffold generates a custom-UI stub (`GameTable.vue`) that exists on disk. If `App.vue` accidentally imports it (e.g., via a wildcard import or re-export in `src/ui/index.ts`), the stub's code enters the bundle even when `"ui": "auto"`.

**Why it happens:** Currently `generateUiIndexTs()` explicitly re-exports GameTable: `export { default as GameTable } from './components/GameTable.vue';`. This means `import App from './ui/index.js'` transitively pulls in GameTable.

**How to avoid:** Remove the GameTable re-export from `src/ui/index.ts` generator (`generateUiIndexTs()`), OR ensure App.vue doesn't import from `./ui/index.ts` (it imports directly from `'boardsmith/ui'` and the stub). The generated `src/main.ts` imports from `./ui/index.js` — check that tree-shaking from the main entry is clean.

**Warning signs:** Bundle grep for `GameTable` or stub code shows up even when `App.vue` doesn't directly import it.

### Pitfall 4: `boardsmith.json` schema validation rejecting the new `"ui"` field

**What goes wrong:** `src/cli/commands/validate.ts` checks `boardsmith.json` fields. If `"ui"` is not in the allowed schema, `boardsmith validate` would warn/error on the new field even though it's valid.

**Why it happens:** `validate.ts` has a field list. The `$schema` URL points to `https://boardsmith.io/schemas/game.json` which may also need updating.

**How to avoid:** Add `"ui"` to whatever field validation `validate.ts` performs. Since the schema URL is a stub, focus on the in-code validation. [VERIFIED: `src/cli/commands/validate.ts` line 93–97 checks required fields; optional field may pass silently, but verify]

---

## Code Examples

### New `generateBoardsmithJson()` — add `"ui"` field

```typescript
// Source: src/cli/lib/project-scaffold.ts — generateBoardsmithJson()
const json = {
  $schema: 'https://boardsmith.io/schemas/game.json',
  name: config.name,
  displayName: config.displayName,
  // ... existing fields ...
  ui: 'auto',   // ← add this; value is "auto" or relative path like "./ui/GameUI.vue"
};
```

### New `generateAppVue()` — single AutoUI (no split-screen)

```typescript
// Source: src/cli/lib/project-scaffold.ts — generateAppVue() replacement
export function generateAppVue(config: ProjectConfig): string {
  return `<script setup lang="ts">
import { GameShell, AutoUI } from 'boardsmith/ui';
</script>

<template>
  <GameShell
    game-type="${config.name}"
    display-name="${config.displayName}"
    :player-count="${config.playerCount.min}"
  >
    <template #game-board="{ gameView, playerSeat, state }">
      <AutoUI
        :game-view="gameView || null"
        :player-seat="playerSeat"
        :flow-state="state?.flowState as any"
      />
    </template>

    <template #player-stats="{ player }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span class="stat-value">{{ (player as any).score || 0 }}</span>
      </div>
    </template>
  </GameShell>
</template>
...styles...`;
}
```

Key changes: no `GameTable` import, no `board-comparison` grid, no `board-title` headers.

### New `generateGameTableVue()` — "start here" stub (no placeholder warning)

```typescript
// Source: src/cli/lib/project-scaffold.ts — generateGameTableVue() replacement
export function generateCustomUIVue(config: ProjectConfig): string {
  return `<script setup lang="ts">
/**
 * Custom UI — start here when you want to design a bespoke interface.
 *
 * To activate: in boardsmith.json set "ui": "./ui/components/GameUI.vue"
 * and update App.vue to import this component instead of AutoUI.
 */
import type { UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();
</script>

<template>
  <!-- Build your custom UI here. The auto-UI (AutoUI) handles everything
       until you're ready — switch "ui" in boardsmith.json when you want this. -->
  <div class="custom-game-ui">
    <p>Custom UI — implement me!</p>
  </div>
</template>
`;
}
```

### Tree-shaking proof command

```bash
# Build a scaffold game that uses "ui": "./ui/components/GameUI.vue" (no AutoUI import in App.vue)
# Then verify AutoUI symbols are absent from the bundle:
boardsmith build
grep -r "AutoUI\|AutoRenderer" dist/ui/ && echo "FAIL: AutoUI leaked" || echo "PASS: AutoUI not in bundle"
```

---

## Runtime State Inventory

> This is a scaffold/docs/CLI-only phase. No rename of stored state. SKIPPED.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-----------------|--------------|--------|
| Auto-UI as debug/comparison panel (split-screen) | AutoUI as shippable production peer | Phase 95 | Authors ship with AutoUI for simple games; no split-screen scaffolding |
| `generateAppVue()` imports both AutoUI + GameTable | `generateAppVue()` imports only selected UI | Phase 95 | Tree-shaking now eliminates unselected UI from production bundle |
| Scaffold "placeholder notice" forcing custom UI | Scaffold stub marked "start here" (optional) | Phase 95 | First `boardsmith init` → `boardsmith dev` sequence is immediately playable |

**Still to do (Phase 96):**
- Existing games in `~/BoardSmithGames/` still have the split-screen App.vue; migration deferred.
- `MIGRATE-03`: delete old auto-UI renderer files — deferred.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | `vitest.config.ts` at monorepo root |
| Quick run command | `npm test -- --run src/cli` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHIP-01 | Scaffold README/docs contain no "debug aid"/"reference implementation" framing | Snapshot / grep assertion | `npm test -- --run src/cli/lib/project-scaffold.test.ts` | ❌ Wave 0 |
| SHIP-02 | Production bundle for a custom-UI-only game does NOT contain AutoUI symbols | Build smoke test (file grep) | Manual or shell script | ❌ Wave 0 |
| SHIP-03 | Fresh scaffold App.vue renders single AutoUI — no split-screen grid, no GameTable import | Snapshot test of `generateAppVue()` | `npm test -- --run src/cli/lib/project-scaffold.test.ts` | ❌ Wave 0 |

**Note on SHIP-02 (tree-shaking proof):** A full build integration test is heavyweight. The practical verification is:
1. Build the scaffold with `"ui": "auto"` → App.vue imports only AutoUI → `dist/ui/` bundle contains AutoUI (correct).
2. Manually update `boardsmith.json "ui"` to `"./ui/components/GameUI.vue"` and App.vue to import only GameUI → rebuild → `grep -r "AutoUI\|AutoRenderer" dist/ui/` returns nothing (tree-shaking confirmed).

This can be verified by inspection during implementation rather than requiring a CI integration test for Phase 95. The planner may add a `checkpoint:human-verify` for this.

### Sampling Rate
- **Per task commit:** `npm test -- --run src/cli/lib/project-scaffold.test.ts` (fast, if test file created in Wave 0)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + manual browser smoke-test of `boardsmith dev` on freshly scaffolded game

### Wave 0 Gaps
- [ ] `src/cli/lib/project-scaffold.test.ts` — snapshot tests for `generateAppVue()` (no split-screen), `generateBoardsmithJson()` (contains `"ui": "auto"`), `generateGameTableVue()` (no placeholder warning)
- [ ] Existing test file may exist; check before creating

---

## Environment Availability

> Step 2.6: SKIPPED for CLI changes themselves. No new external tooling required.
> The `boardsmith build` / `boardsmith dev` commands are tested manually in-repo.

---

## Security Domain

> SHIP-01/02/03 are scaffold/docs/build changes. No authentication, session, input validation, or cryptography surface is touched.
> Security enforcement check: no ASVS categories apply to this phase.

---

## Open Questions

1. **Should `boardsmith.json "ui"` be read by `boardsmith dev`/`build` to generate a virtual entry?**
   - What we know: Current build uses the game's existing App.vue as the entry. The field drives `generateAppVue()` at scaffold time only.
   - What's unclear: If the author changes `boardsmith.json "ui"` after scaffold (without regenerating App.vue), the config and App.vue desync.
   - Recommendation: For Phase 95, scaffold-time generation is sufficient. Document in `boardsmith.json` schema comments that changing `"ui"` requires updating App.vue. Planner may add a `boardsmith validate` check for this — that's a cheap safety net.

2. **Rename `GameTable.vue` stub to `GameUI.vue`?**
   - What we know: The stub is the "start here" custom UI slot. Current name is `GameTable.vue`.
   - What's unclear: Whether "GameTable" is a well-known term in BoardSmith (it is — it's in the nomenclature).
   - Recommendation: Keep `GameTable.vue` as the filename for now; cross-repo migration (Phase 96) is the right time to rationalize naming. The stub comment is what matters for D-03.

3. **Does `generateUiIndexTs()` need to drop the GameTable re-export?**
   - What we know: Current `generateUiIndexTs()` line 256 exports `GameTable` from `./components/GameTable.vue`. This is a transitive import when `src/main.ts` imports from `./ui/index.js`.
   - What's unclear: Whether Rollup tree-shakes unused re-exports when the top-level consumer (App.vue) doesn't reference them.
   - Recommendation: Modern Rollup tree-shakes unused named exports from ES modules. The re-export in `src/ui/index.ts` does NOT pull in GameTable if nothing in App.vue uses it. Verify empirically (grep bundle for GameTable code). If it leaks, remove the re-export from the generator. [ASSUMED — depends on Rollup behavior with side-effect-free modules]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Modern Rollup tree-shakes unused re-exports from `src/ui/index.ts` so that GameTable.vue does not appear in the production bundle when App.vue only imports AutoUI | Open Questions #3, Tree-shaking | Bundle would contain GameTable stub; easy to verify with grep and fix by removing re-export |
| A2 | Changing App.vue to import only AutoUI (no GameTable import) causes standard Vite build to exclude AutoUI when the inverse is true | Code Examples / tree-shaking proof | If verification fails, needs `rollupOptions.treeshake` config — but this is standard Rollup behavior |

**If these tables are empty of HIGH-risk items:** Both assumptions are verifiable by running `boardsmith build` and grepping the output. Neither assumption affects correctness of the scaffold changes themselves.

---

## Sources

### Primary (HIGH confidence)
- `src/cli/lib/project-scaffold.ts` — direct code inspection; all scaffold generators verified
- `src/cli/commands/dev.ts` — full code trace of dev server pipeline
- `src/cli/commands/build.ts` — full code trace of Vite build invocation
- `src/cli/dev-host/DevHost.vue` — confirmed split-screen is NOT in DevHost; it's in game's App.vue
- `src/ui/index.ts`, `src/ui/components/auto-ui/index.ts`, `src/ui/components/auto-ui/AutoUI.vue` — AutoUI export chain verified

### Secondary (MEDIUM confidence)
- `docs/ui-components.md`, `docs/component-showcase.md`, `docs/nomenclature.md`, `src/cli/slash-command/instructions.md` — grep-verified framing strings

---

## Metadata

**Confidence breakdown:**
- Scaffold changes (SHIP-02, SHIP-03): HIGH — exact code confirmed, pattern is clear
- Reframe surface (SHIP-01): HIGH — all offending strings grep-verified
- Tree-shaking guarantee: MEDIUM-HIGH — standard Rollup behavior, but verify with bundle grep during implementation
- `instructions.md` impact on design-game workflow: MEDIUM — the file is large (~2400 lines); planner should diff carefully to avoid breaking unrelated sections

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable: Vite, Rollup, CLI structure all stable)

---

## RESEARCH COMPLETE

Phase 95 is a focused CLI/scaffold/docs phase with no new packages and no runtime changes. The split-screen "Custom vs Auto-Generated" comparison lives entirely in `generateAppVue()` in `src/cli/lib/project-scaffold.ts`; replacing it with a single AutoUI renders the game immediately playable via auto-UI and automatically achieves tree-shaking correctness because Vite/Rollup drops any component not reachable from the static import in `App.vue`. The six doc/text locations using prototype/debug/reference framing for AutoUI are enumerated with exact line numbers. The dev command and build command need no changes — the iframe-based dev host already serves whatever `App.vue` contains. The main cross-cutting risk is the `/design-game` slash-command in `instructions.md`, which has its own embedded copy of the App.vue template and a mandatory "DO NOT SKIP — customize GameTable" instruction; this must be updated in the same plan wave as the scaffold generator to keep the LLM-assisted design workflow aligned with the new single-UI default.
