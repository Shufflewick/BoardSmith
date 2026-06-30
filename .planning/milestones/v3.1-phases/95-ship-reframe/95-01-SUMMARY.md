---
phase: 95-ship-reframe
plan: "01"
subsystem: cli
tags: [scaffold, single-ui, tree-shaking, auto-ui, validate]
dependency_graph:
  requires: []
  provides: [single-ui-scaffold, ui-field-config, no-gametable-reexport]
  affects: [src/cli/lib/project-scaffold.ts, src/cli/commands/validate.ts]
tech_stack:
  added: []
  patterns: [tdd-red-green, string-generator, optional-field-validation]
key_files:
  created:
    - src/cli/lib/project-scaffold.test.ts
  modified:
    - src/cli/lib/project-scaffold.ts
    - src/cli/commands/validate.ts
decisions:
  - "config.ui ?? 'auto' drives a single static import in generateAppVue; no runtime registry"
  - "GameTable re-export removed from generateUiIndexTs (tree-shaking landmine closed)"
  - "generateGameTableVue stub is 'start here' optional on-ramp, not mandatory placeholder"
  - "validate.ts accepts 'auto' or any './' path; rejects all other ui values with actionable message"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-22"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
---

# Phase 95 Plan 01: Single-UI Scaffold & Tree-Shaking Summary

**One-liner:** Replace split-screen scaffold with single-UI AutoUI default driven by `boardsmith.json "ui"` field, removing the `GameTable` barrel re-export tree-shaking landmine.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | `636f26d` | test(95-01): add failing scaffold-generator tests (RED) |
| 2 (GREEN) | `f010405` | feat(95-01): rewrite scaffold generators to single-UI (GREEN) |
| 3 | `3ed8588` | feat(95-01): validate optional ui field in boardsmith.json |

## What Was Built

### Task 1: Failing Tests (RED Gate)

`src/cli/lib/project-scaffold.test.ts` — 9 assertions across 5 describe blocks:
- `generateAppVue({ui:'auto'})`: asserts single AutoUI import, no `GameTable`, no split-screen markup, AutoUI in `#game-board` slot
- `generateAppVue({ui:'./...'})`: asserts custom component import, no AutoUI
- `generateBoardsmithJson`: asserts `parsed.ui === 'auto'`
- `generateUiIndexTs`: asserts no `GameTable` string (re-export removed)
- `generateGameTableVue`: asserts no placeholder warning text, has "start here" content

8 of 9 tests failed against the old generators (RED confirmed before Task 2).

### Task 2: Generator Rewrite (GREEN Gate)

`src/cli/lib/project-scaffold.ts` — four functions modified:

1. **`ProjectConfig` interface**: added `ui?: string` (default treated as `"auto"`)

2. **`generateBoardsmithJson`**: added `ui: config.ui ?? 'auto'` to the JSON object literal before `JSON.stringify`

3. **`generateAppVue`**: full branch on `config.ui ?? 'auto'`:
   - `"auto"` → `import { GameShell, AutoUI } from 'boardsmith/ui'` + `<AutoUI>` in `#game-board` slot; no GameTable, no board-comparison grid
   - relative path → `import { GameShell } from 'boardsmith/ui'` + single default import of the custom component (name derived from filename); no AutoUI

4. **`generateUiIndexTs`**: removed `export { default as GameTable } from './components/GameTable.vue'` line entirely — the tree-shaking landmine that would have pulled the stub into the bundle even when App.vue only imports AutoUI

5. **`generateGameTableVue`**: removed `placeholder-notice` div + `⚠️` text + `.placeholder-notice` CSS; replaced with a `/** Custom UI — start here */` JSDoc block explaining the optional on-ramp pattern, including the Pit of Success framing ("easy path = auto-UI until you're ready")

All 9 tests pass (GREEN).

### Task 3: Validate Optional "ui" Field

`src/cli/commands/validate.ts` — added optional-field check after playerCount validation (lines ~108):

```typescript
if (config.ui !== undefined) {
  if (config.ui !== 'auto' && !String(config.ui).startsWith('./')) {
    issues.push('"ui" must be "auto" or a relative path (e.g. "./ui/components/GameTable.vue")');
  }
}
```

- `"ui"` is NOT in the `required` array (optional field)
- Accepts `"auto"` or any `"./"` prefixed string
- Rejects absolute paths, npm package names, and other values with an actionable error message
- Full CLI suite: 46/46 tests pass

## TDD Gate Compliance

- RED commit (`636f26d`) precedes GREEN commit (`f010405`) — gate sequence verified
- 8/9 tests failed before implementation (1 passing test: `generateAppVue auto renders AutoUI` — the `#game-board` slot check was incidentally satisfied by existing code, does not indicate a false negative since `board-comparison` and `GameTable` tests correctly failed)

## Deviations from Plan

None — plan executed exactly as written. The four generator functions were modified per the exact patterns in 95-PATTERNS.md and 95-RESEARCH.md.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. The `config.ui` value flows from `boardsmith.json` (local author-supplied file) into scaffold-time code generation only. Task 3 constrains it to `"auto"` or a `"./"` relative path at validate time, satisfying T-95-01 mitigation.

## Known Stubs

None — the `generateGameTableVue` stub is intentionally minimal (it IS the "start here" stub; its empty-ish content is the feature, not a stub).

## Self-Check: PASSED

Files verified:
- `src/cli/lib/project-scaffold.test.ts` — exists, 9 tests
- `src/cli/lib/project-scaffold.ts` — modified, no `board-comparison` or `Auto-Generated UI` strings remain
- `src/cli/commands/validate.ts` — modified, `ui` field check present

Commits verified:
- `636f26d` — test(95-01): RED gate
- `f010405` — feat(95-01): GREEN gate
- `3ed8588` — feat(95-01): validate.ts
