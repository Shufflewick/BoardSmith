# Phase 144: `/bs-build-chunk` — Build & Test with UI Floor - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 8 (3 new markdown reference files, 1 small markdown edit, 1 markdown edit,
1 real TS scaffold-generator edit, 2 test-file extensions)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/slash-command/bs/build/build.md` (new) | skill reference-file (agent-consumed prose) | request-response (executor step, gated by prior approval) | `src/cli/slash-command/bs/build/ask.md` | exact — same "referenced by build-chunk.md Step N of session group" shape, same citation discipline |
| `src/cli/slash-command/bs/build/test.md` (new) | skill reference-file | batch (sequential command-list execution) | `src/cli/slash-command/bs/ingest/scaffold.md` "Verification Sequence" | exact — numbered, non-reorderable, stop-on-failure command sequence |
| `src/cli/slash-command/bs/build/design-ask.md` (new) | skill reference-file (human-approval gate) | request-response (gate-before-write) | `src/cli/slash-command/bs/build/ask.md` | exact — same gate-before-write / write-order discipline, smaller-scope 3-way choice instead of 4-part format |
| `src/cli/slash-command/bs/build/ask.md` (small hook edit) | skill reference-file, edited | request-response (dispatch hook) | itself, pre-edit (read above) — new pre-check inserted before Part (a) | role-match — editing in place, not a fresh analog |
| `src/cli/slash-command/bs/build-chunk.md` (routing-table edit) | orchestrator/router (skill) | request-response (dispatch table) | itself, pre-edit — Step 3 dispatch table rows | role-match — same file, only the two rows + Reference Files list change |
| `src/cli/slash-command/bs/build-chunk.test.ts` (extend) | test (drift-pin / structural) | transform (string-pin assertions over markdown) | itself, pre-edit + `src/cli/slash-command/bs/ingest.test.ts` | exact — identical `read()`/`describe`-per-requirement/`REFERENCED_PATHS` scaffolding already in the file |
| `src/cli/lib/project-scaffold.ts` (`generatePackageJson` + `generateScaffoldFiles` edits) | config/utility (string-template generator) | transform (config object → generated file content) | itself, pre-edit — `generatePackageJson()`/`generateScaffoldFiles()`/`generateGameTableVue()` | exact — same file, same function shapes, additive edits only |
| `src/cli/lib/project-scaffold.test.ts` (extend) | test (unit, function-call-based) | transform (generator output → parsed assertions) | itself, pre-edit | exact — same file, same `JSON.parse(generateX(config))` idiom |

## Pattern Assignments

### `src/cli/slash-command/bs/build/build.md` (new)

**Analog:** `src/cli/slash-command/bs/build/ask.md` (structure) + `src/cli/slash-command/bs/build/investigate.md` (fresh-context-subagent framing, since `build` is the one step exempted from the "orchestrator never reads sources" rule per Pattern 2 of 144-RESEARCH.md)

**Header / "Referenced by" framing pattern** (`build/ask.md` lines 1-8):
```markdown
# Ask — The Human-Approval Gate (BUILD-04)

Referenced by `build-chunk.md` Step 3 (`ask`, third and last of the `{investigate, redteam,
ask}` session step group — see `state-machine.md` "Session Handoff Seams"). This is the
human-approval boundary: the point where a plain-language design is authorized before a single
line of code is written. Mirrors `ingest-rules.md` Step 6 (Approval Gate) + Step 7 (Write
Files) — same negotiate-then-gate posture, same single-point-of-write discipline...
```
Copy this exact shape for `build.md`'s opening: "Referenced by `build-chunk.md` Step 4 (`build`,
first of the `{build, test}` session step group...)".

**Fresh-context subagent exception framing** (144-RESEARCH.md Pattern 2, cross-referenced against
`build/investigate.md` lines 60-95, the "Fan-Out Dispatch" section): `build/build.md` is the ONE
step allowed to read raw slices directly (either main context or a dedicated executor) rather
than going through a summarized subagent return — cite this explicitly as the exception to the
Context-Economics Hard Rule every other step restates.

**Build Manifest — do not invent a new section** (`templates/CHUNK.template.md` lines 126-133,
verbatim, already exists — fill it, never restructure):
```markdown
## Build Manifest
<!-- Per-file build manifest for build-step crash/resume — file-by-file, not step-by-step, so a
     session that crashes mid-build knows exactly which files were already written vs. still
     pending, without re-deriving that from git status alone. -->

| File | Status |
|------|--------|
<!-- | src/... | written / pending | -->
```

**Placeholder policy citation, never restatement** (`templates/DESIGN.template.md` lines 72-78,
verbatim — `build.md` must cite this section by name, not restate its rules):
```markdown
## Placeholder Policy

<!-- How this game handles a missing asset (see ASSETS.md) at the presentation layer.
     A missing asset never blocks a chunk: record a designed placeholder here — correct aspect
     ratio, styled with this file's own tokens, so a placeholder never looks "broken," only
     "not-yet-final." State the concrete placeholder treatment (e.g. "a token-colored rounded
     rect at the asset's declared aspect ratio, with the component's label centered on it"). -->
```

**Git protocol citation** (`build-chunk.md` lines 228-233, verbatim — cite, do not restate):
```markdown
## Git Protocol

Cite `state-machine.md` "Git Protocol" — commit at every step completion
(`chunk-<slug>/step-<name>`), revise rounds as `chunk-<slug>/revise-2` etc., and commit **before**
`build` starts (144's territory, but the protocol is cited here since this router names `build`
as the group-2 entry point).
```

**Downstream Shape footer pattern** (`build/investigate.md` lines 136-146, `build/ask.md` lines
136-140 — every reference file ends with a "Downstream Shape (cite, never restate)" section
naming its consumer without restating that consumer's structure):
```markdown
## Downstream Shape (cite, never restate)

Once `Status: approved` lands, the settled, user-approved interpretation from `build/redteam.md`
is the upstream authority for `build/build.md` (authored in Phase 144) — the next session picks
up the step group `{build, test}`. This file does not restate that step group's structure.
```
`build.md` should open by consuming this exact handoff (it is the "Phase 144" `build/build.md`
that `ask.md`'s footer names) and close with its own Downstream Shape section pointing at
`build/test.md`.

---

### `src/cli/slash-command/bs/build/test.md` (new)

**Analog:** `src/cli/slash-command/bs/ingest/scaffold.md` "Verification Sequence" (lines 70-124)
— the closest existing numbered, stop-on-failure, non-reorderable command-sequence idiom in this
codebase.

**Numbered stop-on-failure sequence shape** (`ingest/scaffold.md` lines 70-76, verbatim pattern
to replicate for the 5-6 test-step commands):
```markdown
Run the following as ONE numbered sequence immediately after `init` succeeds. Do not skip steps,
do not reorder them, and do not treat "it compiled" as sufficient without also confirming it
serves. Failures at any step STOP the sequence with an actionable message (what failed, the exact
error, and what to fix) — never proceed past a failing step assuming it will "work once deployed."
```
Adapt directly for `test.md`'s ordered list: `tsc --noEmit` → `boardsmith lint` → chunk
unit/integration tests → full accumulated suite → random-sim playthrough → (conditional) a11y
floor.

**"Kill the process" explicit-numbered-step pattern** (`ingest/scaffold.md` lines 113-119 — if
`test.md`'s command list ever needs to start any long-running process, e.g. is tempted to spin up
`boardsmith dev` for a live a11y check, this is the precedent for treating teardown as a first-
class numbered step, never a footnote):
```markdown
3. **Kill the process** — this is an explicit, numbered step in the SAME sequence as steps 1-2,
   never a footnote or an afterthought left for later.
```
Note: per 144-RESEARCH.md, the a11y floor runs inside the same `vitest`+`jsdom` suite as
everything else — no browser/dev-server launch step is needed, so this precedent is cited for
discipline, not literally reused as a process-kill step in `test.md`.

**Random-sim playthrough — real API to cite verbatim** (`src/testing/random-simulation.ts`,
already directly read by the researcher — 144-RESEARCH.md Pattern 4):
```typescript
import { simulateRandomGames } from 'boardsmith/testing';

const results = await simulateRandomGames(MyGame, {
  count: 100,
  playerCounts: [2, 3, 4],
  timeout: 5000,   // optional
  seed: 'some-base-seed', // optional
});

expect(results.crashed).toBe(0);
expect(results.stuck).toBe(0);
```

**`boardsmith lint` sandbox-rule citation** (`src/cli/lib/sandbox-scan.ts` doc comment, verbatim
— 144-RESEARCH.md Pattern 5, cite the 7 rule names explicitly to avoid Pitfall 1's regex-vs-AST
conflation):
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
The 7 rule names to name explicitly (`src/eslint-plugin/index.ts` lines 16-22, confirmed
directly):
```typescript
'no-network': noNetwork,
'no-filesystem': noFilesystem,
'no-timers': noTimers,
'no-nondeterministic': noNondeterministic,
'no-eval': noEval,
'no-element-identity-comparison': noElementIdentityComparison,
'no-element-array-state': noElementArrayState,
```

**a11y-floor keyboard-only completion pattern to cite** (two precedents, per 144-RESEARCH.md
Pattern 6 — cite both, one for the individual-control shape and one for the end-to-end shape):

Individual-control shape (`src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` lines
1-25, 343-347 — directly read):
```typescript
// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
...
it('keydown Enter fires triggerElementSelect exactly once', async () => {
  const wrapper = mountWithInteraction(CardRenderer, { element: makeCardElement(), depth: 0 }, bi);
  await wrapper.find('.card-container').trigger('keydown', { key: 'Enter' });
  expect(triggerSpy).toHaveBeenCalledTimes(1);
});
```
End-to-end shape: `src/ui/composables/interaction-integration.test.ts` — wires
`useActionController` + `useBoardActionBridge` + `createBoardInteraction` together with NO mock
controller, because "using a mock controller misses the fill → fetchChoicesForPick →
snapshotVersion++ → currentChoices reactive chain." `test.md` should instruct a generated game's
per-chunk keyboard-completion test to follow this real-wiring shape, not a mocked one.

**axe-core scan shape** (144-RESEARCH.md Code Examples section — synthesized, no direct in-repo
precedent since axe-core is new to this repo; cite as the pattern the scaffold's example test
implements and each chunk's test copies):
```typescript
// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import axe from 'axe-core';
import GameTable from '../src/ui/components/GameTable.vue';

describe('GameTable — a11y floor (axe-core scan)', () => {
  it('has no axe-core violations', async () => {
    const wrapper = mount(GameTable, { props: { /* ... */ } });
    const results = await axe.run(wrapper.element);
    expect(results.violations).toEqual([]);
  });
});
```
Frame the axe scan as catching structural/semantic issues only (missing labels, invalid ARIA,
duplicate IDs) — contrast is covered by the separate token-discipline grep (Pitfall 2), not by
this scan.

---

### `src/cli/slash-command/bs/build/design-ask.md` (new)

**Analog:** `src/cli/slash-command/bs/build/ask.md` in full — this is the same human-approval-
gate shape (gate-before-write, write-order-last, RULINGS.md-append-only precedent) applied to a
narrower 3-way choice instead of the 4-part interpretation presentation.

**Gate-before-write pattern** (`build/ask.md` lines 102-126, verbatim structure to replicate —
present, negotiate, do not write until explicit yes, then write in a fixed order ending with the
`Status:`/derived-pointer write last):
```markdown
## Gate-Before-Write

Present all four parts, then negotiate: the user's answer wins on any ambiguity in part (b)
unless a hard dependency is violated, in which case name the dependency concretely and propose
the minimal resolution. Do **not** write anything durable... until the user has given explicit
approval. Presenting is not approving; only an explicit yes authorizes the write.

Only after that explicit yes:
1. Write any RULINGS.md `### Ruling N` entries...
2. Write any ASSETS.md ledger row updates...
3. Check off `ask` on CHUNK.md's Step Checklist...
4. Write `Status: approved` to CHUNK.md **last**, after every other write for this gate has
   landed...
5. Then update this chunk's derived-status pointer in SKETCH.md to match...
```
For `design-ask.md`, adapt this to: present the 3-way choice (Adopt/Derive/Original) + rationale,
negotiate, then write `DESIGN.md` (filling `templates/DESIGN.template.md`'s sections) only after
explicit approval, citing the same CHUNK.md-then-SKETCH.md write-order discipline if any chunk-
level status is touched by this ask.

**DESIGN.md template contract to fill, never restructure** (`templates/DESIGN.template.md` lines
23-27, parse contract, and lines 29-44, the Chosen Direction section that design-ask.md's 3-way
choice fills):
```markdown
<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, "## Chosen Direction",
     "## Theme Block (--bsg-* / applyTheme() overrides)", "## Typography & Spacing",
     "## Component Recipes", "## Placeholder Policy", "## Do / Don't". -->

## Chosen Direction
<!-- One of exactly three directions, plus the rationale for choosing it:
     - Adopt: use BoardSmith's default Slate palette/typography as-is, no overrides.
     - Derive: keep Slate's structure/contrast guarantees but override specific tokens...
     - Original: a from-scratch visual identity, still expressed entirely through --bsg-* token
       overrides... -->

Direction: <!-- Adopt | Derive | Original -->
Rationale: <!-- why this direction fits this game -->
```

**Never-blocking placeholder framing to reuse** (`build/ask.md` lines 80-93, verbatim — the same
"a missing asset never blocks" posture design-ask.md must state about DESIGN.md itself, per
144-CONTEXT.md's "Changing DESIGN.md later is itself a chunk... 'I don't have art yet' never
blocks — placeholder policy + ASSETS.md debt"):
```markdown
Request any assets this chunk's build needs, keyed to `ASSETS.md`'s existing component
inventory... A missing asset never blocks a chunk: if the user doesn't have final art yet, that's
fine — "I don't have art yet" never blocks the chunk from proceeding.
```

**Downstream Shape / upstream-hook framing** (`build/ask.md` lines 136-140 — `design-ask.md` is
hooked FROM `ask.md`, so its own "Referenced by" line should point at `build/ask.md`'s pre-check,
not at `build-chunk.md` directly):
```markdown
Referenced by `build/ask.md`'s pre-check (first-UI-chunk detection: this chunk's `## ui:` tag is
touches|major AND DESIGN.md does not yet exist on disk) — runs to completion before `ask.md`'s
own 4-part gate proceeds for that same chunk.
```

---

### `src/cli/slash-command/bs/build/ask.md` (small hook edit)

**Analog:** itself, pre-edit (already read in full above). The edit inserts a pre-check before
Part (a) of the 4-part format (per 144-RESEARCH.md Open Question 1's recommendation) — do not
restructure the existing 4-part presentation, prepend a conditional dispatch:

```markdown
## First-UI-Chunk Design Check (pre-check, before Part (a))

If this chunk's `## ui:` tag is `touches` or `major` AND `DESIGN.md` does not yet exist on disk,
dispatch `build/design-ask.md` to completion (it writes `DESIGN.md`) before continuing to Part
(a) of this file's 4-part presentation for this same chunk.
```
Keep the existing footer's forward-reference to Phase 144 intact/updated (`build/ask.md` line
139 currently reads "the next session picks up the step group `{build, test}`" — this becomes a
live reference once `build.md`/`test.md` exist).

---

### `src/cli/slash-command/bs/build-chunk.md` (routing-table edit)

**Analog:** itself, pre-edit (already read in full above).

**Rows to flip from forward-reference to live dispatch** (lines 116-129, current state):
```markdown
| build | `build/build.md` — authored in Phase 144 |
| test | `build/test.md` — authored in Phase 144 |
```
becomes:
```markdown
| build | `build/build.md` |
| test | `build/test.md` |
```
Per 144-RESEARCH.md's State of the Art table: "the drift test's `REFERENCED_PATHS` and
`FORWARD_REFERENCE_MARKERS` arrays both change shape" — `REFERENCED_PATHS` gains
`build/build.md`, `build/test.md`, `build/design-ask.md`; `FORWARD_REFERENCE_MARKERS` drops
`'authored in Phase 144'`, keeping only 145/146 markers. The "Reference Files" list (lines
243-261) similarly moves `build/build.md`/`build/test.md` out of the "forward-referenced only"
bullet list and into the live bullet list alongside `investigate.md`/`redteam.md`/`ask.md`; add
`build/design-ask.md` to the live list too.

---

### `src/cli/slash-command/bs/build-chunk.test.ts` (extend)

**Analog:** itself, pre-edit (already read in full above) + `src/cli/slash-command/bs/ingest.test.ts` (same `read()` helper idiom, confirmed by this file's own header comment).

**Existing scaffolding to extend, not replace** (lines 95-110, verbatim — update these two
constant arrays):
```typescript
const REFERENCED_PATHS = [
  'build/investigate.md',
  'build/redteam.md',
  'build/ask.md',
  'state-machine.md',
  'templates/CHUNK.template.md',
  'templates/RULINGS.template.md',
  'templates/ASSETS.template.md',
] as const;

const FORWARD_REFERENCE_MARKERS = [
  'authored in Phase 144',
  'authored in Phase 145',
  'authored in Phase 146',
] as const;
```
Add `'build/build.md'`, `'build/test.md'`, `'build/design-ask.md'` to `REFERENCED_PATHS`; drop
`'authored in Phase 144'` from `FORWARD_REFERENCE_MARKERS` (only 145/146 remain).

**Exclusion-list test to update** (lines 378-391, verbatim — this is the test the plan explicitly
calls out to fix):
```typescript
it('REFERENCED_PATHS does NOT include any Phase 144-146 step file', () => {
  const excluded = [
    'build/build.md',
    'build/test.md',
    'build/audit.md',
    'build/repair.md',
    'build/playtest.md',
    'build/revise.md',
    'build/close.md',
  ];
  for (const path of excluded) {
    expect((REFERENCED_PATHS as readonly string[]).includes(path)).toBe(false);
  }
});
```
Drop `'build/build.md'` and `'build/test.md'` from this `excluded` array (they now exist AND are
referenced) — keep `build/{audit,repair,playtest,revise,close}.md` excluded (Phase 145/146
territory).

**describe-per-requirement pattern to replicate** (e.g. lines 143-178's `BUILD-02 — investigate`
block is the template shape for the five new blocks — `BUILD-05`, `BUILD-06`, `UIQ-01`, `UIQ-02`,
`UIQ-03`): one `describe`, each `it` calling `read()` inside its own body (never at describe-
level, per the file's header comment: "so a missing file fails only that one assertion instead of
aborting the whole suite's collection phase"), pinning specific verbatim strings from the newly
authored markdown files (e.g. BUILD-06's block should pin the exact command names `tsc --noEmit`,
`boardsmith lint`, and the sandbox-rule names; UIQ-03's block should pin all five a11y floor item
names).

---

### `src/cli/lib/project-scaffold.ts` (edit — REAL CODE)

**Analog:** itself, pre-edit (already read in full above) — additive edits to two existing
functions, no new file needed beyond one new generator function + one new `GeneratedFile` entry.

**`generatePackageJson` devDependencies block to extend** (lines 121-147, verbatim — add
`axe-core` alongside the existing three devDependencies):
```typescript
export function generatePackageJson(config: ProjectConfig): string {
  const deps = getDependencyPaths();
  const pkg = {
    name: config.name,
    version: '0.0.1',
    type: 'module',
    scripts: { /* unchanged */ },
    dependencies: { boardsmith: deps.boardsmith, vue: '^3.4.0' },
    devDependencies: {
      '@vitejs/plugin-vue': '^5.0.0',
      typescript: '^5.7.0',
      vitest: '^2.0.0',
      // NEW:
      'axe-core': '^4.12.1',
      '@vue/test-utils': '^2.4.11',   // needed to mount GameTable.vue in the example test
    },
  };
  return JSON.stringify(pkg, null, 2);
}
```
Note per 144-RESEARCH.md Standard Stack: `@vue/test-utils` is "NOT yet in the scaffold's
generated `package.json`" — this phase's diff must add it too, since the example a11y test
mounts a real Vue component.

**`generateScaffoldFiles` array entry to add** (lines 468-482, verbatim — follow the exact
`{ path, content }` shape already used for every other generated file):
```typescript
export function generateScaffoldFiles(config: ProjectConfig): GeneratedFile[] {
  return [
    { path: 'boardsmith.json', content: generateBoardsmithJson(config) },
    { path: 'package.json', content: generatePackageJson(config) },
    // ...unchanged entries...
    { path: 'src/ui/components/GameTable.vue', content: generateGameTableVue() },
    // NEW:
    { path: 'tests/a11y.example.test.ts', content: generateA11yExampleTestTs() },
    { path: '.gitignore', content: generateGitignore() },
  ];
}
```

**New generator function shape to follow** (model on `generateGameTableVue()`, lines 357-452 —
a plain string-template function returning file content, doc-commented at the top explaining its
purpose to the reader of the generated file, exactly like `generateGameTableVue`'s own opening
comment "Custom UI — start here when you want to design a bespoke interface."):
```typescript
/**
 * Generate tests/a11y.example.test.ts
 *
 * Example accessibility test demonstrating the axe-core scan pattern every UI
 * chunk's a11y floor (UIQ-03) copies. Scans the scaffold's own GameTable.vue
 * stub — replace with your own component(s) as you build UI chunks.
 */
export function generateA11yExampleTestTs(): string {
  return `// @vitest-environment jsdom
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
        actionController: {} as never,
      },
    });
    const results = await axe.run(wrapper.element);
    expect(results.violations).toEqual([]);
  });
});
`;
}
```

**Hard warning (repo-wide, from CLAUDE.md + 144-RESEARCH.md Common Pitfalls #3 and the
Anti-Patterns list):** do NOT run `npm install axe-core` or `slopcheck install axe-core` against
BoardSmith's own `package.json`/`package-lock.json` while implementing this — `axe-core` is added
ONLY inside `generatePackageJson()`'s returned template-string literal. Verify `git status
--short` shows no `axe-core` diff on BoardSmith's own manifests before considering this file's
edit complete.

---

### `src/cli/lib/project-scaffold.test.ts` (extend)

**Analog:** itself, pre-edit (already read in full above) — same `JSON.parse(generateX(config))`
/ `toContain` idiom used throughout the existing file (e.g. `generateBoardsmithJson` describe
block, lines 75-90).

**Pattern to replicate for the new assertions:**
```typescript
describe('generatePackageJson — axe-core scaffold devDependency', () => {
  it('includes axe-core in devDependencies', () => {
    const parsed = JSON.parse(generatePackageJson(config));
    expect(parsed.devDependencies).toHaveProperty('axe-core');
  });

  it('includes @vue/test-utils in devDependencies (needed to mount components for the a11y example)', () => {
    const parsed = JSON.parse(generatePackageJson(config));
    expect(parsed.devDependencies).toHaveProperty('@vue/test-utils');
  });
});

describe('generateScaffoldFiles — a11y example test harness', () => {
  it('includes tests/a11y.example.test.ts', () => {
    const files = generateScaffoldFiles(config);
    expect(files.some((f) => f.path === 'tests/a11y.example.test.ts')).toBe(true);
  });
});
```
Follow the existing file's import style — add `generatePackageJson`, `generateScaffoldFiles`,
`generateA11yExampleTestTs` to the existing `import { ... } from './project-scaffold.js'` block
(lines 7-14) rather than adding a new import statement.

## Shared Patterns

### Reference-file citation discipline (applies to `build.md`, `test.md`, `design-ask.md`)
**Source:** `src/cli/slash-command/bs/build/ask.md`, `investigate.md`, `redteam.md` — every file
opens with a "Referenced by `build-chunk.md` Step N..." line, cites `state-machine.md` and
`templates/*.template.md` sections by name instead of restating their rules, and closes with a
"Downstream Shape (cite, never restate)" section.
```markdown
Cite `state-machine.md` "Session Handoff Seams" for the four fixed group boundaries — do not
restate them here.
```
**Apply to:** all three new `build/*.md` files.

### Context-Economics Hard Rule restatement (applies to `test.md` only, not `build.md`)
**Source:** `build-chunk.md` lines 14-30, `build/investigate.md` lines 10-28, `build/redteam.md`
lines 11-21 — every step EXCEPT `build` restates "the orchestrator never reads X itself" with the
one sanctioned state-file-read carve-out named explicitly. `test.md` is a step that runs shell
commands against the generated game's own files (not chunk-state prose), so it needs a narrower
version: reference the fact that its command outputs (pass/fail, violation lists) are what
routes to `repair`, not raw source re-reading.
**Apply to:** `build/test.md` (as a lighter restatement than the full Hard Rule); `build/build.md`
inherits the EXCEPTION (fresh raw-slice read is allowed here) rather than the restriction itself.

### Gate-before-write / write-order-last discipline
**Source:** `build/ask.md` "Gate-Before-Write" (lines 102-126) and `state-machine.md` "Write
Order" (cited, not re-read in full here but confirmed present via `build-chunk.md`'s own
citations at lines 189-197, 228-233).
```markdown
Do **not** write anything durable... until the user has given explicit approval... Write
`Status: approved` to CHUNK.md **last**, after every other write for this gate has landed.
```
**Apply to:** `design-ask.md` (writing `DESIGN.md` only after explicit approval of the 3-way
choice).

### Append-only ledger discipline (ASSETS.md, RULINGS.md, CHUNK.md's Redteam Rounds/Findings/Revision sections)
**Source:** `build/ask.md` lines 89-93, 94-100; `templates/CHUNK.template.md` lines 81-124 —
never restructure a ledger's header, never renumber or overwrite a prior entry, corrections are
always new appended entries.
**Apply to:** `build.md`'s per-file Build Manifest fills (row-by-row, never restructuring the
`| File | Status |` header) and any DECISIONS.md appends `build.md`'s contract calls for.

### Sandbox-rule vs. regex-heuristic distinction (Pitfall 1)
**Source:** `src/cli/commands/lint.ts`'s dual `LINT_RULES` (regex heuristics, `info`/warning
severity) + `scanSandboxViolations` (AST-based, `error` severity) structure, both invoked by the
same `npm run lint` / `boardsmith lint` command.
**Apply to:** `test.md` — the test-step command list must gate on the sandbox-rule subset only,
naming the 7 rules explicitly, never treat every `boardsmith lint` warning as build-blocking.

## No Analog Found

None. Every file this phase touches has a direct, previously-read analog in this codebase — the
only genuinely new *code* (not prose) is the `axe-core` scaffold-template addition, which itself
follows the exact `generateX()` / `GeneratedFile` shape every other scaffold generator function in
`project-scaffold.ts` already uses.

## Metadata

**Analog search scope:** `src/cli/slash-command/bs/` (all `build/*.md`, `build-chunk.md`,
`build-chunk.test.ts`, `templates/*.template.md`, `ingest/scaffold.md`), `src/cli/lib/
project-scaffold.ts` + its test file, `src/ui/components/auto-ui/renderers/*.a11y.test.ts`,
`src/ui/composables/interaction-integration.test.ts`, `src/testing/random-simulation.ts`,
`src/cli/lib/sandbox-scan.ts`, `src/eslint-plugin/index.ts`.
**Files scanned (fully read):** 11 (`build/ask.md`, `build/investigate.md`, `build/redteam.md`,
`build-chunk.md`, `build-chunk.test.ts`, `templates/CHUNK.template.md`,
`templates/DESIGN.template.md`, `ingest/scaffold.md`, `project-scaffold.ts`,
`project-scaffold.test.ts` (partial), `CardRenderer.a11y.test.ts` (partial)) — plus targeted
`grep` confirmation of `src/eslint-plugin/index.ts`'s 7 rule names.
**Pattern extraction date:** 2026-07-04
