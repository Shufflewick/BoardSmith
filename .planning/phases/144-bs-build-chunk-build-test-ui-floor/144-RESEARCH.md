# Phase 144: `/bs-build-chunk` — Build & Test with UI Floor - Research

**Researched:** 2026-07-04
**Domain:** Claude Code slash-command skill authoring (markdown reference files) + one real library change (CLI scaffold template)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### File Decomposition & Scaffold Work
- New reference files: `src/cli/slash-command/bs/build/build.md` + `src/cli/slash-command/bs/build/test.md`
- The first-UI-chunk design ask gets its own `src/cli/slash-command/bs/build/design-ask.md`, invoked from ask.md via a small edit (keeps ask.md lean); remove/replace the corresponding forward-reference markers in build-chunk.md
- Placeholder policy in practice lives in `build.md` (build renders placeholders), citing DESIGN.template.md's placeholder policy — never duplicated
- REAL CODE: modify the `boardsmith init` scaffold template so generated games ship an axe-core devDependency + an example a11y test harness (the plan's "decided once at the scaffold-template level — not per game"); this is testable library work done in this phase
- ActionPanel keyboard-only completion test: the skill instructs writing a per-chunk keyboard-only test using BoardSmith's existing testing / @vue/test-utils patterns; researcher identifies the exact harness precedent (e.g. ActionPanel tests, interaction-integration tests) to cite as the copyable pattern

#### Step Semantics
- Build step contract (plan-verbatim): executor reads (1) raw rulebook slices and (2) the approved interpretation — interpretation is design layered on the slice, never a replacement; extends existing code; restructuring verified code requires a user gate; appends data-model/naming decisions to DECISIONS.md; records a per-file manifest in CHUNK.md so a mid-build crash resumes file-by-file; rewrites the chunk's test script in actual interaction terms; git protocol: commit before build starts (WIP vs verified baseline)
- Test step command list (plan-verbatim): `tsc --noEmit`; eslint with the boardsmith plugin (no-timers/no-nondeterminism/no-network); unit + integration tests; the full accumulated suite (regression); a random-simulation playthrough (TestGame random sim to a terminal state N times); for `ui: touches|major` chunks the a11y floor checks
- Design ask directions: (A) Adopt — physical game's identity, requires user-supplied box art/photos, trade-dress caution for someone else's commercial game; (B) Derive — original web design in the game's palette/mood, no asset dependence, DEFAULT recommendation; (C) Original — invoke the frontend-design skill for 2–3 one-page throwaway HTML mood sketches. Decision recorded in DESIGN.md — created HERE at the first UI chunk's ask (per the Phase 142 CR-05 fix), filled from DESIGN.template.md; reads the ingest visual survey (rulebook/00-visual-survey.md) as evidence
- Token discipline: color literals live only in the theme block; everything else references `--bsg-*` tokens/applyTheme(); placeholders use component-inventory aspect ratios; asset arrival replaces fill, never geometry (zero-layout-diff swaps)
- A11y floor (UIQ-03, all five items): keyboard-only ActionPanel completion as an executable test; axe-core scan on board + ActionPanel; no-color-literal grep with contrast assertion for new game-local pairs; real controls (buttons or role/tabindex/keydown) with game-semantic aria-labels, decorative glyphs aria-hidden; focus not stranded + prefers-reduced-motion honored. AutoUI renderers' `.a11y.test.ts` files cited as the copyable pattern

#### Verification
- Extend `build-chunk.test.ts` with BUILD-05, BUILD-06, UIQ-01, UIQ-02, UIQ-03 describe blocks + updated REFERENCED_PATHS (build.md, test.md, design-ask.md now exist; forward-reference markers for 145/146 remain)
- The scaffold-template change gets a real unit test (init template contains the axe-core devDependency + harness file)
- Behavioral proof deferred to Phase 149's dry-run

### Claude's Discretion
- design-ask.md vs ask.md edit mechanics, exact section names, per-file manifest format details, N for random-sim runs

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| BUILD-05 | Build reads raw slices + approved interpretation, extends rather than restructures verified code (restructure requires a user gate), appends to DECISIONS.md, and keeps a per-file manifest for mid-step resume | Pattern 2 (fresh-context executor exception), Pattern 3 (Build Manifest already exists in CHUNK.template.md — no new section needed), Pattern 7 (placeholder policy citation, not restatement) |
| BUILD-06 | The test step runs tsc, boardsmith eslint, unit/integration tests, the full accumulated suite, and a random-simulation playthrough to a terminal state | Pattern 4 (`simulateRandomGames` real API), Pattern 5 (`boardsmith lint` already wired to the eslint-plugin), Pitfall 1 (regex-heuristics vs. sandbox-rule distinction) |
| UIQ-01 | The first UI chunk's ask is a design ask offering Adopt / Derive / Original (frontend-design mood sketches), recorded in DESIGN.md with token overrides and component recipes | Architecture Diagram (design-ask.md hook flow), Open Question 1 (hook mechanics into ask.md) |
| UIQ-02 | Components awaiting assets render designed placeholders (correct aspect ratio, DESIGN.md tokens, labeled) whose asset swap never changes geometry | Pattern 7 (cite DESIGN.template.md's Placeholder Policy verbatim, never duplicate) |
| UIQ-03 | UI chunks enforce the a11y floor: ActionPanel keyboard-only completability test, axe scan, no-color-literals grep, real controls with game-semantic labels, focus management, reduced-motion | Standard Stack (axe-core addition + Package Legitimacy Audit), Pattern 6 (`.a11y.test.ts` + `interaction-integration.test.ts` precedents), Pitfall 2 (axe/jsdom contrast limitation), Code Examples (scaffold axe-core harness) |
</phase_requirements>

## Summary

Phase 144 is almost entirely markdown-authoring work that follows an already-established idiom
(`bs/build/{investigate,redteam,ask}.md`, Phase 143), plus one small, well-scoped real code change:
adding `axe-core` as a scaffold-template devDependency and one example a11y test file to `boardsmith
init`'s generated output. Every mechanism the skill's prose needs to cite — `TestGame` random
simulation, the ESLint sandbox rules, the `.a11y.test.ts` keyboard-interaction pattern, the
`boardsmith lint`/`validate` pipeline — already exists in this repo and was directly inspected.
Nothing needs to be invented; the work is citing real, verified APIs instead of describing
hypothetical ones.

The scaffold-template change is the only place this phase touches actual TypeScript: `src/cli/lib/
project-scaffold.ts`'s `generatePackageJson()` (add `axe-core` devDependency) and
`generateScaffoldFiles()` (add one new generated test file). `src/cli/commands/init.test.ts` and
`src/cli/lib/project-scaffold.test.ts` are the existing test files to extend — both use vitest with
direct function calls against the generator functions, no fixture directory needed.

**Primary recommendation:** Author `build/build.md`, `build/test.md`, and `build/design-ask.md` as
lean reference files that cite `state-machine.md`/`templates/*.template.md` rather than restating
them (matching `investigate.md`/`redteam.md`/`ask.md`'s established shape); make the scaffold-template
change as a small, directly-testable diff to `project-scaffold.ts`; extend `build-chunk.test.ts`
in place rather than creating a new test file (it already has the exact scaffolding — `REFERENCED_
PATHS`, `FORWARD_REFERENCE_MARKERS`, per-requirement `describe` blocks — this phase needs to grow).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Build step prose (`build/build.md`) | CLI / skill markdown | — | Consumed by an agent session, not parsed by runtime code |
| Test step prose (`build/test.md`) | CLI / skill markdown | — | Same; cites real CLI commands (`tsc`, `boardsmith lint`, `vitest`) it does not reimplement |
| Design-ask prose (`build/design-ask.md`) | CLI / skill markdown | — | Hooked from `build/ask.md` at the first UI chunk |
| axe-core devDependency + example test | CLI scaffold generator (`project-scaffold.ts`) | Generated game project (`tests/`) | Decided once at the template level, inherited by every generated game — not a per-game decision |
| `boardsmith lint`/`validate` (ESLint sandbox rules) | CLI (`sandbox-scan.ts` + `eslint-plugin`) | Generated game (consumes via `npm run lint`) | Already built and shipped; this phase only cites it, does not change it |
| Random-sim playthrough | BoardSmith `testing` module (`simulateRandomGames`) | Generated game's own test suite | Already built; this phase cites the real API signature |
| ActionPanel keyboard-only completion test | Generated game's `tests/` (per-chunk, written by the build step) | BoardSmith `ui` module (`ActionPanel.vue`, `useBoardInteraction`) | The library provides the accessible input path; each chunk's build step writes the game-specific test exercising it |

## Standard Stack

### Core (already in this repo — cite, do not re-derive)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `boardsmith/testing` — `simulateRandomGames` | in-repo, `src/testing/random-simulation.ts` | Random-sim playthrough to a terminal state, N times, with reproducible seeds | This IS the "random-simulation playthrough" the plan's test-step contract names — no alternative needed |
| `eslint` (`Linter` class, programmatic) | `^9` (repo's installed version) | Runs the `boardsmith` plugin's sandbox rules over generated-game source | Already wired end-to-end via `src/cli/lib/sandbox-scan.ts`; both `boardsmith lint` and `boardsmith validate` delegate to it |
| `eslint-plugin-boardsmith` (`src/eslint-plugin/index.ts`) | in-repo, exported as `boardsmith/eslint-plugin` | `no-network`, `no-filesystem`, `no-eval` (security, all `src/`) + `no-timers`, `no-nondeterministic` (determinism, `src/rules` + shared modules only, `off` under `src/ui`) | The exact "eslint with the boardsmith plugin" the plan's test-step contract names |
| `vitest` | `^2.0.0` (scaffold devDependency, already present) | Unit/integration tests, `tests/game.test.ts` | Generated game's existing test runner |
| `@vue/test-utils` | `^2.4.11` (BoardSmith's own devDependency — NOT yet in the scaffold's generated `package.json`) | Mounting Vue components for a11y/keyboard tests | Established pattern in BoardSmith's own `.a11y.test.ts` suite (see Code Examples) |

### Supporting (new — this phase's real library work)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `axe-core` | `4.12.1` [VERIFIED: npm registry + official docs (dequelabs/axe-core)] | Structural accessibility scan (ARIA validity, name/role/value, contrast where jsdom supports it) run against a rendered component's DOM | Added to the **scaffold template's** generated `package.json` devDependencies — decided once, inherited by every generated game, per the locked decision. NOT added to BoardSmith's own `package.json`. |

**Do NOT add `vitest-axe` or `jest-axe`.** Investigated and rejected — see Package Legitimacy
Audit below. Call `axe.run()` directly against the mounted component's root DOM element and assert
`results.violations.length === 0`; this needs no wrapper package and avoids a fragile,
low-adoption dependency.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bare `axe-core` + manual `results.violations` assertion | `vitest-axe` (custom matcher wrapping axe-core) | `vitest-axe@0.1.0` is a single-maintainer fork of `jest-axe`, last published over a year ago, pre-1.0, adds 5 transitive deps (`aria-query`, `chalk`, `dom-accessibility-api`, `lodash-es`, `redent`) for a `toHaveNoViolations()` convenience matcher that is trivial to write inline. Rejected: unnecessary dependency surface for a one-line assertion. |
| jsdom-based axe scan | `@axe-core/playwright` in a real browser | More accurate (real layout/contrast), but this phase's floor runs inside the same `vitest`+`jsdom` unit/integration suite as everything else in `test.md`'s command list — no browser-launch step. Full-browser a11y auditing (screen reader, 200% zoom, colorblind pass) is explicitly Phase 145/146 territory (design-review audit, design-QA chunk), not this phase's floor. |

**Installation (scaffold-template diff only, not applied to BoardSmith's own `package.json`):**
```bash
# This is what generatePackageJson() emits into the GENERATED game's devDependencies —
# do not run this against BoardSmith's own package.json.
npm install -D axe-core
```

**Version verification:** `npm view axe-core version` → `4.12.1`, published by `dequelabs`
(official Deque Systems axe-core maintainers), repository `github.com/dequelabs/axe-core`,
license `MPL-2.0`. Confirmed directly via `npm view` during this research session — see Package
Legitimacy Audit for the full verification trail (including a stray accidental install into
BoardSmith's own `package.json`/`package-lock.json` during testing, which was reverted with `git
checkout` before this document was written — verify `git status` shows no `axe-core` diff on
BoardSmith's own manifests before merging any plan built from this research).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|--------------|-----------|-------------|
| `axe-core` | npm | 11 yrs (created 2015-06-08) | very high (industry-standard a11y engine; Deque Systems) | `github.com/dequelabs/axe-core` | `[OK]` | Approved — add to scaffold template devDependencies only |
| `vitest-axe` | npm | ~1.5 yrs since last publish (0.1.0, published 2025-01-22) | low (single maintainer, pre-1.0, fork of jest-axe) | `github.com/chaance/vitest-axe` | not run — rejected before install | REMOVED from consideration — see Alternatives Considered |

`slopcheck install axe-core` was run and returned `[OK]` (scanned 1 package, 1 OK). **Caution for
whoever executes this phase's plan:** `slopcheck install` actually performs an `npm install`
(it is not scan-only) — running it inside the BoardSmith repo root installs the package into
*this* repo's `node_modules`/`package.json`/`package-lock.json`, not a scaffold-generated game.
This research session hit exactly that side effect and reverted it with `git checkout --
package.json package-lock.json && rm -rf node_modules/axe-core` before writing this document.
The build-step plan for this phase must verify (`git status --short`) that BoardSmith's own
`package.json`/`package-lock.json` carry no `axe-core` line after any legitimacy-check tooling
runs, and that the only place `axe-core` is added is inside `generatePackageJson()`'s returned
string (a template-string literal, never `npm install` against the repo itself).

**Packages removed due to slopcheck `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none (`vitest-axe` was rejected on maintenance/necessity
grounds before reaching slopcheck, not flagged by it).

## Architecture Patterns

### System Architecture Diagram

```
build-chunk.md (orchestrator, Phase 143 — unchanged by this phase except two edits)
    │
    │  Step 3 dispatch table: "build" row now points to a LIVE file (was forward-reference)
    ▼
build/build.md  ──reads──▶  (1) chunk's cited rulebook slices  (raw ground truth)
    │                       (2) approved interpretation (CHUNK.md ## Interpretation, post-ask)
    │                       (3) DESIGN.md, if ui: touches|major (placeholder policy + tokens)
    │
    │  writes: generated-game source files, DECISIONS.md appends, CHUNK.md ## Build Manifest
    │          (per-file Status: written/pending — crash-resume granularity)
    │
    │  git: commit BEFORE this step starts (WIP vs. last verified baseline)
    ▼
build/test.md  ──runs (in the GENERATED GAME project, not BoardSmith)──▶
    1. npx tsc --noEmit
    2. npx boardsmith lint          (delegates to scanSandboxViolations → eslint-plugin-boardsmith)
    3. npx vitest run <chunk unit/integration tests>
    4. npx vitest run               (full accumulated suite — regression)
    5. TestGame random-sim playthrough (simulateRandomGames(GameClass, {count, playerCounts}))
    6. IF ui: touches|major → a11y floor (5 checks, see below)
    │
    │  writes: CHUNK.md Step Checklist check-off for `test`; test-step failures loop back to
    │          `build` (still group 2 — {build, test} is one session-handoff seam)
    ▼
  (group boundary — session hands off; next group is {audit, repair}, Phase 145)

Separately, hooked off build/ask.md (Phase 143, edited by this phase):
ask.md Step 3 (first UI chunk detected: this chunk's `## ui:` tag is touches|major AND DESIGN.md
does not yet exist on disk)
    │
    ▼
build/design-ask.md  ──presents──▶  3-way choice: Adopt / Derive (default) / Original
                                     reads rulebook/00-visual-survey.md as evidence
    │
    │  writes: DESIGN.md (fills DESIGN.template.md — Chosen Direction, Theme Block,
    │          Typography & Spacing, Component Recipes, Placeholder Policy, Do/Don't)
    ▼
  (DESIGN.md now exists — every subsequent ui: touches|major chunk's investigate/build/audit
   step reads it as the visual-identity source of truth)

Scaffold-template change (real code, independent of the markdown flow above):
boardsmith init  ──calls──▶  generateScaffoldFiles(config)  [project-scaffold.ts]
    │
    ├── generatePackageJson(config)  → devDependencies now include "axe-core": "^4.12.1"
    └── (new) generateA11yExampleTestTs()  → tests/a11y.example.test.ts
         (axe-core + @vue/test-utils against the scaffold's own GameTable.vue stub)
```

### Recommended File Layout (this phase's new files)

```
src/cli/slash-command/bs/build/
├── build.md          # NEW — build step (BUILD-05)
├── test.md            # NEW — test step (BUILD-06)
├── design-ask.md       # NEW — first-UI-chunk design ask (UIQ-01), invoked from ask.md
├── ask.md              # EDITED — small hook: detect first UI chunk, dispatch to design-ask.md
├── investigate.md      # unchanged (Phase 143)
└── redteam.md          # unchanged (Phase 143)

src/cli/slash-command/bs/build-chunk.md   # EDITED — dispatch table rows for build/test become
                                            # live, forward-reference markers for audit/repair/
                                            # playtest/revise/close (145/146) remain

src/cli/slash-command/bs/build-chunk.test.ts   # EXTENDED — new describe blocks (BUILD-05,
                                                 # BUILD-06, UIQ-01, UIQ-02, UIQ-03), updated
                                                 # REFERENCED_PATHS and FORWARD_REFERENCE_MARKERS

src/cli/lib/project-scaffold.ts            # EDITED — generatePackageJson() axe-core devDep,
                                             # generateScaffoldFiles() new example test entry
src/cli/lib/project-scaffold.test.ts        # EXTENDED — unit test asserting the devDep + file
src/cli/commands/init.test.ts               # existing pattern for scaffold-template unit tests
```

### Pattern 1: Reference-file citation discipline (established, Phase 143)

**What:** Every `bs/build/*.md` file cites `state-machine.md` and `templates/*.template.md`
sections by name rather than restating their rules; the file's own job is the step-specific
prose plus explicit cross-references.

**When to use:** For every new file this phase authors (`build.md`, `test.md`, `design-ask.md`).

**Example (from `build/ask.md`, verbatim pattern to replicate):**
```markdown
Cite `state-machine.md` "Session Handoff Seams" for the four fixed group boundaries — do not
restate them here.
```

### Pattern 2: Fresh-context subagent for the executor step (`build`)

**What:** Per `bs-skills-plan.md`'s "Subagent discipline" hard rule, "Exception: `build` runs
with the full raw slice (main context or a dedicated executor)" — unlike investigate/redteam,
the build step is explicitly exempted from the orchestrator-never-reads-sources rule, because it
is the one step that must write real code against the raw slice, not a summary.

**When to use:** `build/build.md`'s dispatch prompt should read (1) raw cited slices, (2) the
approved interpretation from CHUNK.md `## Interpretation`, (3) DESIGN.md for UI chunks — directly,
not through a summarized return shape.

### Pattern 3: Per-file Build Manifest already has a home (do not invent a new section)

**What:** `templates/CHUNK.template.md` already ships a `## Build Manifest` section (`| File |
Status |` table, "written / pending") — this is the exact per-file manifest the locked decisions
call for. `build/build.md` fills this table row-by-row as files are written; it does not need a
new template section.

**Example (from CHUNK.template.md, verbatim):**
```markdown
## Build Manifest
| File | Status |
|------|--------|
<!-- | src/... | written / pending | -->
```

### Pattern 4: Random-sim playthrough — real API signature

**Source:** `src/testing/random-simulation.ts` (in-repo, directly read).

```typescript
// Source: src/testing/random-simulation.ts (this repo)
import { simulateRandomGames } from 'boardsmith/testing';

const results = await simulateRandomGames(MyGame, {
  count: 100,             // required
  playerCounts: [2, 3, 4], // required — runs `count` games at EACH listed player count
  timeout: 5000,           // optional, ms per game
  seed: 'some-base-seed',  // optional — omit to get a random base seed back on results.seed
});

// results: { completed, crashed, timedOut, exceededMaxActions, stuck, total, games,
//            averageActions, averageDuration, errors, seed }
expect(results.crashed).toBe(0);
expect(results.stuck).toBe(0);
```

A failing game can be reproduced deterministically:
```typescript
// Source: src/testing/random-simulation.ts JSDoc example (this repo)
const failure = results.games.find(g => g.crashed || g.stuck);
if (failure) {
  const repro = await replayRandomGame(MyGame, {
    seed: failure.seed,
    playerCount: failure.playerCount,
  });
}
```

`test.md` should cite this signature directly — "N" (count) and playerCounts are Claude's
discretion per 144-CONTEXT.md; a reasonable default is `count: 50` per declared player count for
the light path and `count: 100` for full-ceremony rules-bearing chunks, but this is a
recommendation, not a verified requirement.

### Pattern 5: `boardsmith lint` already IS "eslint with the boardsmith plugin"

**What:** The generated game's `package.json` already has `"lint": "npx boardsmith lint"` (see
`src/cli/lib/project-scaffold.ts` `generatePackageJson()`). `boardsmith lint`
(`src/cli/commands/lint.ts`) calls `scanSandboxViolations(cwd)` (`src/cli/lib/sandbox-scan.ts`),
which programmatically constructs an ESLint `Linter` instance with the `boardsmith` plugin's
7 rules pre-wired (`no-network`/`no-filesystem`/`no-eval` for all of `src/`;
`no-timers`/`no-nondeterministic` for `src/rules` + shared modules, `off` under `src/ui`) — **no
`eslint.config.js` needs to exist in the generated game project.** `test.md` should cite `npx
boardsmith lint` (or the equivalent `npm run lint`) directly; it does not need to describe ESLint
flat-config mechanics because the generated game never sees that config file.

**Source (verbatim comment from this repo, `src/cli/lib/sandbox-scan.ts`):**
```typescript
/**
 * Sandbox scanner — the single source of truth for determinism/network/timer/
 * filesystem/eval enforcement in BoardSmith games.
 *
 * It runs the AST-based `boardsmith` ESLint plugin rules over ALL game source
 * under `src/` (not just `src/rules`)... Both `boardsmith validate` and
 * `boardsmith lint` delegate here, so there is exactly one implementation.
 */
```

### Pattern 6: `.a11y.test.ts` keyboard-interaction precedent (cite for UIQ-03 item 1 and item 4)

**Source:** `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` (in-repo, directly
read). The copyable shape: mount the component with `@vue/test-utils`, assert `role="button"` +
`tabindex="0"` on the selectable root, then `trigger('keydown', { key: 'Enter' })` /
`{ key: ' ' }` and assert the interaction-trigger spy fired exactly once.

```typescript
// Source: src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts (this repo)
// @vitest-environment jsdom
it('keydown Enter fires triggerElementSelect exactly once', async () => {
  const wrapper = mountWithInteraction(CardRenderer, { element: makeCardElement(), depth: 0 }, bi);
  await wrapper.find('.card-container').trigger('keydown', { key: 'Enter' });
  expect(triggerSpy).toHaveBeenCalledTimes(1);
});
```

For a generated game's per-chunk keyboard-only completion test, the closest heavier-weight
precedent (driving a REAL `ActionPanel` + real controller/bridge wiring, not a mock) is
`src/ui/composables/interaction-integration.test.ts` — it wires `useActionController` +
`useBoardActionBridge` + `createBoardInteraction` together with no mock controller, specifically
because "using a mock controller misses the fill → fetchChoicesForPick → snapshotVersion++ →
currentChoices reactive chain." `build/test.md` should cite both: `.a11y.test.ts` files for the
individual-control shape (role/tabindex/keydown), `interaction-integration.test.ts` for the
end-to-end "complete an entire action via keyboard only" shape a per-chunk test needs.

### Pattern 7: Placeholder policy (build step) — cite DESIGN.template.md, never restate

**What:** `DESIGN.template.md`'s `## Placeholder Policy` section already documents "correct
aspect ratio, styled with this file's own tokens... a placeholder never looks 'broken,' only
'not-yet-final.'" `build/build.md`'s job is to say "when this chunk's build step renders a
component with no asset yet, follow this chunk's `DESIGN.md` `## Placeholder Policy` verbatim" —
not to re-derive or restate the placeholder rules.

### Anti-Patterns to Avoid

- **Restating `state-machine.md`/template rules inline in `build.md`/`test.md`/`design-ask.md`:**
  Every existing `bs/build/*.md` file cites rather than restates (see Pattern 1). A restatement
  drifts from the shared file over time; a citation cannot.
- **Inventing a new CHUNK.md section for the build manifest:** `## Build Manifest` already exists
  in `CHUNK.template.md`. Do not add a duplicate section under a different name.
- **Describing ESLint flat-config setup for the generated game:** the generated game never has
  an `eslint.config.js` — `boardsmith lint` handles it programmatically. Documenting flat-config
  mechanics in `test.md` would describe a file that doesn't exist and never needs to.
- **Adding `axe-core` (or any new devDependency) to BoardSmith's own `package.json`:** the locked
  decision is scaffold-template-only. Verify `git status` on BoardSmith's own manifests after any
  legitimacy-check tooling run (see Package Legitimacy Audit caution above).
- **Using `vitest-axe`/`jest-axe`:** rejected per Package Legitimacy Audit — call `axe.run()`
  directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Random-simulation playthrough | A custom random-move generator loop | `simulateRandomGames` (`boardsmith/testing`) | Already derives valid moves from each action's own choice introspection, handles seeding/reproducibility, and reports `crashed`/`stuck`/`timedOut` distinctly |
| Sandbox rule enforcement (determinism/network/timers/eval) | A regex-based custom checker | `boardsmith lint` → `scanSandboxViolations` → `eslint-plugin-boardsmith` | AST-based, already the single source of truth shared with `boardsmith validate`; a regex checker would duplicate and drift from it |
| Accessibility structural scan | Manual DOM inspection assertions for ARIA/contrast rules | `axe-core` (`axe.run()`) | Industry-standard, exhaustively maintained ruleset; manual re-derivation of WCAG success criteria is exactly the "deceptively complex problem" class this section exists to flag |
| Keyboard-only completion harness | A bespoke keyboard-simulation utility | `@vue/test-utils`'s `trigger('keydown', {...})` on the real `ActionPanel`, wired to the real controller/bridge (per `interaction-integration.test.ts`) | Already the established, working pattern in this exact repo |

**Key insight:** every mechanical piece `test.md`'s command list needs already exists and is
already wired end-to-end in this repo (`sandbox-scan.ts`, `random-simulation.ts`, the `.a11y.test.ts`
suite). The only genuinely new code this phase writes is the axe-core scaffold-template addition —
everything else is citation and orchestration prose.

## Common Pitfalls

### Pitfall 1: Confusing `boardsmith lint`'s custom regex rules with the AST-based sandbox rules

**What goes wrong:** `src/cli/commands/lint.ts` ALSO runs a separate set of custom regex-based
heuristics (`element-includes`, `element-equality`, `loop-no-max`, etc. — see `LINT_RULES` in
`lint.ts`) in addition to `scanSandboxViolations`. `test.md`'s prose must be precise that the
plan's "eslint with the boardsmith plugin (no-timers/no-nondeterminism/no-network)" contract maps
to the `scanSandboxViolations` half of `boardsmith lint`'s output, not the regex heuristics half
— both run under the same `npm run lint` invocation, but only the sandbox-rule violations are
hard "silently break replay/undo/AI" errors; the regex heuristics are warnings/info.

**Why it happens:** Both live behind the same CLI command and the same `npm run lint` script,
so it's easy to conflate "the eslint plugin rules" with "everything `boardsmith lint` reports."

**How to avoid:** `test.md` should cite `boardsmith/eslint-plugin`'s 7 rule names explicitly
(`no-network`, `no-filesystem`, `no-timers`, `no-nondeterministic`, `no-eval`,
`no-element-identity-comparison`, `no-element-array-state`) as the hard-gate subset, distinct
from the regex-heuristic warnings the same command also surfaces.

**Warning signs:** A plan or generated test that treats every `boardsmith lint` warning as a
build-blocking failure (including `info`-severity heuristics like `missing-register`) when only
the sandbox-rule `error`-severity violations should gate the test step.

### Pitfall 2: axe-core in jsdom does not validate everything a real browser would

**What goes wrong:** Some axe-core rules (notably `color-contrast`) require real layout/paint
information jsdom does not provide and are known to under-report or skip entirely in a jsdom
environment. A generated game's a11y floor test could pass axe-core cleanly in jsdom while still
having real contrast issues.

**Why it happens:** jsdom has no rendering engine — `getComputedStyle` returns defaults for
anything not explicitly set inline, and axe's contrast checker needs actual computed colors.

**How to avoid:** The per-chunk a11y floor's item 3 ("token discipline grep — no color literals
outside the theme block, contrast assertion for new game-local pairs") is the actual mechanism
that catches contrast problems in this pipeline — it's a static grep against source, not a
runtime scan, and it's what UIQ-03 item 3 already calls for independent of axe. `test.md` should
frame the axe-core scan as catching structural/semantic a11y issues (missing labels, invalid ARIA,
missing form labels, duplicate IDs) — real, jsdom-safe wins — while explicitly noting contrast is
covered by the separate token-discipline grep, not by the axe scan. Full-browser contrast
validation (screen reader, real rendering) is Phase 146's design-QA chunk, out of this phase's
scope.

### Pitfall 3: `slopcheck install` performs a real install, not a dry-run scan

**What goes wrong:** Running `slopcheck install <pkg>` inside the BoardSmith repo root actually
runs `npm install <pkg>` against BoardSmith's own `package.json`/`package-lock.json`/
`node_modules` — this research session hit exactly this, adding `axe-core` to BoardSmith's own
manifests by accident, and had to `git checkout -- package.json package-lock.json && rm -rf
node_modules/axe-core` to revert.

**Why it happens:** The tool's name suggests a scan, but its actual behavior (per its own
`--help`) is "Check packages against their registry, block slop, then install what's clean" —
installation is the point, not a side effect to avoid.

**How to avoid:** Whoever executes this phase's plan and needs to re-verify `axe-core`'s
legitimacy should run `slopcheck install axe-core` from a scratch/scaffold directory (or a
throwaway `package.json`), never from the BoardSmith repo root — or use `npm view axe-core`
(read-only) for the registry-fact checks and treat the slopcheck verdict already recorded in this
document (`[OK]`) as settled, since axe-core's identity has not changed between this research
session and plan execution.

**Warning signs:** `git status` showing `package.json`/`package-lock.json` diffs after running
any legitimacy-check tooling.

## Code Examples

### axe-core scan against a mounted Vue component (new pattern for the scaffold example test)

No BoardSmith precedent exists for this exact pattern (axe-core itself is new to this repo) — this
is synthesized from axe-core's own documented API (`axe.run(context, options?)` returns a Promise
of `{ violations, passes, ... }`) combined with this repo's established `@vue/test-utils` +
`// @vitest-environment jsdom` mounting convention (Pattern 6 above).

```typescript
// @vitest-environment jsdom
// Illustrative shape for the scaffold's generated tests/a11y.example.test.ts —
// NOT a verified in-repo file; synthesizes axe-core's documented API with this
// repo's established @vue/test-utils mounting convention.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import axe from 'axe-core';
import GameTable from '../src/ui/components/GameTable.vue';

describe('GameTable — a11y floor (axe-core scan)', () => {
  it('has no axe-core violations', async () => {
    const wrapper = mount(GameTable, {
      props: {
        gameView: null,
        playerSeat: 0,
        isMyTurn: true,
        availableActions: [],
        actionController: {} as never, // stub — this is a structural scan, not an interaction test
      },
    });
    const results = await axe.run(wrapper.element);
    expect(results.violations).toEqual([]);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| No accessibility scanning in generated games | `axe-core` devDependency + example harness in the scaffold template | This phase (144) | Every game generated after this phase ships with an a11y-scanning example a chunk's build step can copy per the plan's UIQ-03 floor |
| `build-chunk.md`'s Step 3 dispatch table names `build`/`test` as forward references only | `build`/`test` rows become live dispatches to real files | This phase (144) | The drift test's `REFERENCED_PATHS` and `FORWARD_REFERENCE_MARKERS` arrays both change shape (see Validation Architecture below) |

**Deprecated/outdated:** none — this phase only adds capability, it does not remove or replace
any existing mechanism.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `axe-core` is the correct/best-practice package name for structural a11y scanning in a Vue+vitest+jsdom stack (as opposed to some other engine) | Standard Stack | Low — `axe-core` is the underlying engine virtually every JS a11y-testing wrapper (`jest-axe`, `vitest-axe`, `@axe-core/*`) is built on; this is training-data + WebSearch informed, not Context7/official-doc-confirmed for "best practice," even though the package's existence and registry facts are directly verified |
| A2 | A reasonable default N for random-sim runs is ~50-100 games per player count | Pattern 4 / Code Examples | Low — explicitly marked Claude's discretion in 144-CONTEXT.md; any reasonable default is acceptable and can be tuned per-chunk |
| A3 | axe-core's jsdom limitations (esp. color-contrast) are accurately characterized | Common Pitfalls #2 | Medium — based on training knowledge of axe-core's known jsdom caveats, not verified against axe-core's own CHANGELOG/docs in this session; if wrong, the floor's contrast coverage story (relying on the separate token-discipline grep) would need re-justifying, but the grep requirement itself is independently locked in CONTEXT.md/UIQ-03 regardless of this claim's accuracy |

## Open Questions (RESOLVED — Q1: pre-check before Part (a), plan 144-04; Q2: GameTable.vue target, plan 144-02)

1. **Exact hook mechanics for `design-ask.md` inside `ask.md`**
   - What we know: `ask.md` currently has no first-UI-chunk detection logic; CONTEXT.md marks
     "design-ask.md vs ask.md edit mechanics, exact section names... " as Claude's discretion.
   - What's unclear: whether the detection ("this chunk's `## ui:` tag is touches|major AND
     DESIGN.md does not yet exist on disk") should live as a new numbered step inside `ask.md`'s
     existing flow, or as a pre-check before the 4-part presentation format begins.
   - Recommendation: insert it as a pre-check before Part (a) of the 4-part format — the design
     ask is a completely different presentation shape (3-way Adopt/Derive/Original choice, not
     rules interpretation) and should not be interleaved with the rules-ask parts. `design-ask.md`
     runs to completion (writing DESIGN.md) before `ask.md`'s normal 4-part gate proceeds for that
     same chunk, OR runs as a fully separate sub-step this chunk's session performs before its own
     ask — either shape is defensible; the planner should pick one and the drift test should pin
     whichever is chosen.

2. **Whether the example a11y test targets `App.vue`/`GameShell` (full integration) or the
   `GameTable.vue` stub alone**
   - What we know: `App.vue`'s "auto" branch imports `GameShell` + `AutoUI`, both of which have
     real WS/lifecycle wiring that would need substantial mocking to mount in a unit test.
     `GameTable.vue` (the custom-UI stub) is a plain, dependency-free component.
   - What's unclear: whether the plan should scan the full `App.vue` (more representative, more
     mocking overhead) or just `GameTable.vue` (simple, immediately runnable, matches this
     research's Code Examples sketch).
   - Recommendation: target `GameTable.vue` — it is the file the scaffold explicitly designates
     as "start here when you want to design a bespoke interface," and per-chunk a11y tests written
     by real games' `build` steps will be scanning custom UI components in exactly this shape, not
     `GameShell` internals (which are BoardSmith's own concern, already covered by its own
     `.a11y.test.ts` suite).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | all steps | ✓ | (repo `engines.node: >=20`) | — |
| npm | `slopcheck install`, `npm view` | ✓ | (bundled with Node) | — |
| `slopcheck` (pip) | Package Legitimacy Gate | ✓ (0.6.1, already installed) | 0.6.1 | `npm view` alone if unavailable |
| vitest | test-step execution in generated games | ✓ (already a scaffold devDependency) | `^2.0.0` | — |
| eslint (programmatic `Linter`) | `boardsmith lint`/`validate` | ✓ (BoardSmith's own dependency, used by the CLI the generated game invokes via `npx`) | repo-installed | — |

No missing dependencies with or without fallback — everything this phase needs is already present
in the repo or trivially installable via the scaffold-template diff itself.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest `^2.1.0` (BoardSmith repo) / `^2.0.0` (generated-game scaffold) |
| Config file | none dedicated — `// @vitest-environment jsdom` per-file pragma is the established convention for DOM-dependent tests in this repo (see `.a11y.test.ts` files, `interaction-integration.test.ts`) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` (drift test) / `npx vitest run src/cli/lib/project-scaffold.test.ts` (scaffold unit test) |
| Full suite command | `npm test` (repo root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| BUILD-05 | `build/build.md` documents: reads raw slices + approved interpretation; extends not restructures (gate for restructure); appends DECISIONS.md; per-file Build Manifest resume | structural (drift-pin) | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-05"` | ❌ new `describe` block, this phase |
| BUILD-06 | `build/test.md` documents the exact command list: tsc, boardsmith-eslint, unit/integration, full suite, random-sim, (UI) a11y floor | structural (drift-pin) | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-06"` | ❌ new `describe` block, this phase |
| UIQ-01 | `build/design-ask.md` offers Adopt/Derive/Original, recorded in DESIGN.md | structural (drift-pin) | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-01"` | ❌ new `describe` block, this phase |
| UIQ-02 | `build/build.md` cites DESIGN.template.md's placeholder policy (never duplicates it) | structural (drift-pin) | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-02"` | ❌ new `describe` block, this phase |
| UIQ-03 | `build/test.md` documents all 5 a11y floor items; scaffold template ships axe-core + example harness | structural (drift-pin) + real unit test | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-03"` AND `npx vitest run src/cli/lib/project-scaffold.test.ts -t "axe"` | ❌ both new, this phase |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` (fast, no
  full suite needed for markdown-prose changes) plus `npx vitest run src/cli/lib/project-scaffold.test.ts`
  when the scaffold diff lands.
- **Per wave merge:** `npm test` (full repo suite — catches any accidental regression in
  `project-scaffold.ts`'s existing generator functions).
- **Phase gate:** Full suite green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Extend `src/cli/slash-command/bs/build-chunk.test.ts`: new `describe` blocks for BUILD-05,
      BUILD-06, UIQ-01, UIQ-02, UIQ-03; update `REFERENCED_PATHS` to add `build/build.md`,
      `build/test.md`, `build/design-ask.md`; update `FORWARD_REFERENCE_MARKERS` to remove
      `'authored in Phase 144'` (only 145/146 markers remain); update the "REFERENCED_PATHS does
      NOT include any Phase 144-146 step file" test's `excluded` array to drop `build/build.md`
      and `build/test.md` (they now exist and ARE referenced) while keeping
      `build/{audit,repair,playtest,revise,close}.md` excluded.
- [ ] Extend `src/cli/lib/project-scaffold.test.ts`: assert `generatePackageJson(...)` contains
      `"axe-core"` in `devDependencies`, and assert `generateScaffoldFiles(...)` includes the new
      example a11y test file's path.
- [ ] No new test framework/config install needed — vitest is already fully wired in both the
      BoardSmith repo and the scaffold template.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|---------------------|
| V2 Authentication | no | This phase touches CLI-authoring markdown + a scaffold devDependency; no auth surface |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | No new user-input-handling code; `build/build.md`'s prose governs an agent session, not a runtime input path |
| V6 Cryptography | no | — |

The one piece of genuinely new supply-chain-relevant surface is the `axe-core` devDependency
itself — covered by the Package Legitimacy Audit above, not a traditional ASVS category. `axe-core`
is a devDependency only (test-time), never bundled into a shipped game's production build, which
further limits its blast radius even if a future version introduced a vulnerability.

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Supply-chain risk from a new devDependency (typosquat/slopsquat) | Tampering | Package Legitimacy Gate (slopcheck + npm registry verification), already run — see Package Legitimacy Audit |
| Sandbox escape via generated-game code (network/filesystem/eval/nondeterminism) | Tampering / Elevation of Privilege | Already enforced by `eslint-plugin-boardsmith`'s 5 sandbox rules, delegated to by `boardsmith lint`/`validate` — this phase only cites this existing mitigation, does not need to build a new one |

## Sources

### Primary (HIGH confidence — direct repo inspection)
- `src/cli/lib/project-scaffold.ts` — scaffold generator functions (`generatePackageJson`,
  `generateScaffoldFiles`, `getRequiredDirectories`)
- `src/cli/commands/init.ts` — `initCommand`, `generateGameTs`/`generateTestTs` etc.
- `src/testing/random-simulation.ts` — `simulateRandomGames`, `replayRandomGame` full signatures + JSDoc
- `src/cli/lib/sandbox-scan.ts` — `scanSandboxViolations`, the ESLint `Linter` + `eslint-plugin-boardsmith` wiring
- `src/cli/commands/lint.ts` — `boardsmith lint`'s dual regex-heuristic + sandbox-scan structure
- `src/eslint-plugin/index.ts` — the 7 rule names and the `recommended` flat-config shape
- `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` — keyboard-interaction test pattern
- `src/ui/composables/interaction-integration.test.ts` — real controller/bridge wiring pattern
- `src/cli/slash-command/bs/build-chunk.md`, `bs/build/ask.md`, `bs/build/investigate.md` — established reference-file idiom
- `src/cli/slash-command/bs/build-chunk.test.ts` — exact drift-test scaffolding to extend
- `src/cli/slash-command/bs/templates/{CHUNK,DESIGN}.template.md` — parse contracts, Build Manifest, Placeholder Policy sections
- `src/cli/slash-command/bs/state-machine.md` — Session Handoff Seams, Write Order, Git Protocol
- `.planning/bs-skills-plan.md` — canonical contract (§build-chunk steps 4-5, §UI)
- `.planning/REQUIREMENTS.md` — BUILD-05, BUILD-06, UIQ-01/02/03 exact wording
- `npm view axe-core version repository.url license` — `4.12.1`, `dequelabs/axe-core`, `MPL-2.0`
- `slopcheck install axe-core` — `[OK]` verdict (with the install-side-effect caveat documented in Common Pitfalls #3)

### Secondary (MEDIUM confidence)
- `npm view vitest-axe` — registry metadata (single maintainer, pre-1.0, last published 2025-01-22) used to justify rejecting it in favor of bare `axe-core`

### Tertiary (LOW confidence)
- axe-core's jsdom color-contrast limitation (Common Pitfall #2) — training-knowledge characterization, not verified against axe-core's own docs/changelog in this session; flagged in Assumptions Log (A3)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every existing mechanism directly read from source; the one new package (`axe-core`) directly verified via `npm view` + slopcheck
- Architecture: HIGH — file layout and dispatch-table mechanics directly observed in `build-chunk.md`/`build-chunk.test.ts`
- Pitfalls: MEDIUM-HIGH — Pitfalls 1 and 3 are directly observed in this session; Pitfall 2 (axe-core/jsdom contrast limitation) is training-knowledge, flagged as such

**Research date:** 2026-07-04
**Valid until:** 30 days (stable domain — internal CLI conventions + a mature, slow-moving library like axe-core)
