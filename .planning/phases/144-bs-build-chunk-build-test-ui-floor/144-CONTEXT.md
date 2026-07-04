# Phase 144: `/bs-build-chunk` — Build & Test with UI Floor - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Author `/bs-build-chunk`'s second step group: the build step (BUILD-05), the test step (BUILD-06), the first-UI-chunk design ask (UIQ-01), the placeholder policy in practice (UIQ-02), and the per-chunk a11y floor (UIQ-03) — plus the real library work the floor requires: the `boardsmith init` scaffold template gains an axe-core devDependency and an example a11y test harness. Audit/design-review (UIQ-04) is Phase 145; design-QA chunk (UIQ-05) content belongs to final acceptance (146/149 territory). Behavioral proof is Phase 149.

Canonical contract: `.planning/bs-skills-plan.md` §build-chunk steps 4–5, §UI (identity decision, placeholder policy, per-chunk floor), §Hard Rules; plus `bs/state-machine.md`, `bs/templates/{CHUNK,DESIGN,ASSETS}.template.md`, and the Phase 143 orchestrator (`bs/build-chunk.md` forward-references "authored in Phase 144" for build/test).

</domain>

<decisions>
## Implementation Decisions

### File Decomposition & Scaffold Work
- New reference files: `src/cli/slash-command/bs/build/build.md` + `src/cli/slash-command/bs/build/test.md`
- The first-UI-chunk design ask gets its own `src/cli/slash-command/bs/build/design-ask.md`, invoked from ask.md via a small edit (keeps ask.md lean); remove/replace the corresponding forward-reference markers in build-chunk.md
- Placeholder policy in practice lives in `build.md` (build renders placeholders), citing DESIGN.template.md's placeholder policy — never duplicated
- REAL CODE: modify the `boardsmith init` scaffold template so generated games ship an axe-core devDependency + an example a11y test harness (the plan's "decided once at the scaffold-template level — not per game"); this is testable library work done in this phase
- ActionPanel keyboard-only completion test: the skill instructs writing a per-chunk keyboard-only test using BoardSmith's existing testing / @vue/test-utils patterns; researcher identifies the exact harness precedent (e.g. ActionPanel tests, interaction-integration tests) to cite as the copyable pattern

### Step Semantics
- Build step contract (plan-verbatim): executor reads (1) raw rulebook slices and (2) the approved interpretation — interpretation is design layered on the slice, never a replacement; extends existing code; restructuring verified code requires a user gate; appends data-model/naming decisions to DECISIONS.md; records a per-file manifest in CHUNK.md so a mid-build crash resumes file-by-file; rewrites the chunk's test script in actual interaction terms; git protocol: commit before build starts (WIP vs verified baseline)
- Test step command list (plan-verbatim): `tsc --noEmit`; eslint with the boardsmith plugin (no-timers/no-nondeterminism/no-network); unit + integration tests; the full accumulated suite (regression); a random-simulation playthrough (TestGame random sim to a terminal state N times); for `ui: touches|major` chunks the a11y floor checks
- Design ask directions: (A) Adopt — physical game's identity, requires user-supplied box art/photos, trade-dress caution for someone else's commercial game; (B) Derive — original web design in the game's palette/mood, no asset dependence, DEFAULT recommendation; (C) Original — invoke the frontend-design skill for 2–3 one-page throwaway HTML mood sketches. Decision recorded in DESIGN.md — created HERE at the first UI chunk's ask (per the Phase 142 CR-05 fix), filled from DESIGN.template.md; reads the ingest visual survey (rulebook/00-visual-survey.md) as evidence
- Token discipline: color literals live only in the theme block; everything else references `--bsg-*` tokens/applyTheme(); placeholders use component-inventory aspect ratios; asset arrival replaces fill, never geometry (zero-layout-diff swaps)
- A11y floor (UIQ-03, all five items): keyboard-only ActionPanel completion as an executable test; axe-core scan on board + ActionPanel; no-color-literal grep with contrast assertion for new game-local pairs; real controls (buttons or role/tabindex/keydown) with game-semantic aria-labels, decorative glyphs aria-hidden; focus not stranded + prefers-reduced-motion honored. AutoUI renderers' `.a11y.test.ts` files cited as the copyable pattern

### Verification
- Extend `build-chunk.test.ts` with BUILD-05, BUILD-06, UIQ-01, UIQ-02, UIQ-03 describe blocks + updated REFERENCED_PATHS (build.md, test.md, design-ask.md now exist; forward-reference markers for 145/146 remain)
- The scaffold-template change gets a real unit test (init template contains the axe-core devDependency + harness file)
- Behavioral proof deferred to Phase 149's dry-run

### Claude's Discretion
- design-ask.md vs ask.md edit mechanics, exact section names, per-file manifest format details, N for random-sim runs

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` §build-chunk steps 4–5 + §UI — the spec
- `bs/build-chunk.md` (post-143 fixes) — routing, {build+test} session group, forward-reference markers to replace
- `bs/build/{investigate,redteam,ask}.md` + `bs/build-chunk.test.ts` (43 tests) — established idioms and pins
- `bs/templates/DESIGN.template.md` (placeholder policy, token rules) + `ASSETS.template.md` (debt ledger) + `CHUNK.template.md` (per-file manifest home, test-script section)
- `src/cli/commands/init.ts` + its template source (researcher maps the exact template files to change for axe-core)
- BoardSmith testing module (TestGame random sim — `src/testing`), eslint-plugin rules, AutoUI `.a11y.test.ts` files, ActionPanel tests as keyboard-run precedent

### Established Patterns
- Lean orchestrator / fat reference files; citation-not-restatement; subagent context economics; gate-before-write; byte-identical drift pins; per-step persistence to CHUNK.md before next step

### Integration Points
- Phase 145 (audit/repair) reads the same CHUNK.md state and DESIGN.md; the a11y floor checks defined here are re-checked by 145's audit lenses
- Phase 148 installs the new reference files
- Generated games consume the scaffold-template change immediately

</code_context>

<specifics>
## Specific Ideas

- Changing DESIGN.md later is itself a chunk (re-opens verified chunks) — design-ask.md must state this
- "I don't have art yet" never blocks — placeholder policy + ASSETS.md debt
- Hidden info is solved server-side (visibleAttributes); the floor checks labels of face-down placeholders don't smuggle hidden info

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
