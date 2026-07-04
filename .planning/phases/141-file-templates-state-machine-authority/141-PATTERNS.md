# Phase 141: File Templates & State-Machine Authority - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 8 (6 templates + state-machine.md + templates.test.ts)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/cli/slash-command/bs/templates/SKETCH.template.md` | config (shared-reference content skeleton) | file-I/O (static text, read by future skills) | `src/cli/slash-command/aspects/dice.md` | role-match (content-style), `design-game.template.md` (naming) |
| `src/cli/slash-command/bs/templates/CHUNK.template.md` | config (shared-reference content skeleton) | file-I/O | `src/cli/slash-command/aspects/dice.md` | role-match |
| `src/cli/slash-command/bs/templates/RULINGS.template.md` | config (shared-reference content skeleton) | file-I/O | `src/cli/slash-command/aspects/dice.md` | role-match |
| `src/cli/slash-command/bs/templates/DECISIONS.template.md` | config (shared-reference content skeleton) | file-I/O | `src/cli/slash-command/aspects/dice.md` | role-match |
| `src/cli/slash-command/bs/templates/DESIGN.template.md` | config (shared-reference content skeleton) | file-I/O | `src/cli/slash-command/aspects/dice.md` | role-match |
| `src/cli/slash-command/bs/templates/ASSETS.template.md` | config (shared-reference content skeleton) | file-I/O | `src/cli/slash-command/aspects/dice.md` | role-match |
| `src/cli/slash-command/bs/state-machine.md` | config (shared-reference rules doc, registry-like) | file-I/O | `src/cli/slash-command/aspects/index.md` | role-match (registry/rules-list style) |
| `src/cli/slash-command/bs/templates.test.ts` | test (content-assertion / drift-guard) | transform (readFileSync string → assertions) | `src/cli/commands/init.test.ts` (lines 74-96) | exact — same pattern: `readFileSync` a real source/doc file, assert exact substrings present/absent |

No component/service/controller/model files exist in this phase — it is pure static-content authoring plus one drift test, matching RESEARCH.md's architectural responsibility map.

## Pattern Assignments

### `src/cli/slash-command/bs/templates/*.template.md` (all six)

**Analog A — content style/structure:** `src/cli/slash-command/aspects/dice.md`
**Analog B — file naming convention:** `src/cli/slash-command/design-game.template.md`

**Naming pattern** (from `design-game.template.md`, whole file, 17 lines):
- File is named `<Thing>.template.md` (PascalCase-ish topic + literal `.template.md` suffix) — mirrors exactly: name the six files `SKETCH.template.md`, `CHUNK.template.md`, `RULINGS.template.md`, `DECISIONS.template.md`, `DESIGN.template.md`, `ASSETS.template.md`.
- Unlike `design-game.template.md` (a **thin pointer** — "Read and follow the instructions in: `{{BOARDSMITH_ROOT}}/...instructions.md`"), the phase's templates must NOT be thin pointers. CONTEXT.md/RESEARCH.md are explicit: these are **standalone full-content skeletons**, closer in spirit to `aspects/*.md`.

**Content-style pattern** (from `aspects/dice.md`, full file):
```markdown
# Dice Aspect

**Documentation:** Read `docs/dice-and-scoring.md` before using this template.

## Element Setup (game.ts)

```typescript
...
```
```
- Top-level `# <Title>` heading, immediately followed by a short pointer/context line, then `##` sections each containing either a fenced code block or a prose/list body.
- Inline caveats are written as **bold-prefixed warning lines directly in the body text** (e.g. `**HMR-SAFE:** ...`, with WRONG/CORRECT contrast pairs) rather than as a separate "gotchas" appendix — this is the direct precedent for how the templates should express their HTML-comment fill-in guidance: inline, next to the exact spot it applies to, not collected elsewhere.
- Ends with a numbered `## Key Rules` list summarizing the hard constraints of the file — this is a strong precedent for `state-machine.md`'s own list-based rule sections (Authority, Write Order, Repair Loop Bound, etc.), and for a short "Key Rules" recap at the bottom of CHUNK.template.md if useful.

**Applying to this phase's templates:**
- Use `#`/`##` headings exactly as in `dice.md` (no deeper nesting than `##`/`###` — CHUNK.template.md's append-only rounds use `##` for the section family and `###` for each numbered round, per RESEARCH.md Pattern 2).
- Fill-in guidance goes inline as HTML comments (`<!-- ... -->`) directly beneath/inside the relevant heading — same placement discipline as `dice.md`'s inline bold-warning convention, just swapped to HTML comments per CONTEXT.md's locked format decision (comments, not bold prose, because these must stay invisible when rendered but present in raw markdown for a session to read).
- Do NOT write these as thin pointers like `design-game.template.md` — no "read the instructions in X" indirection; the content itself must be present in each `.template.md` file.

---

### `src/cli/slash-command/bs/state-machine.md`

**Analog:** `src/cli/slash-command/aspects/index.md`

**Registry/rules-list pattern** (full file, 47 lines):
```markdown
# Aspect Registry

This file lists available aspects and their detection keywords.

## Available Aspects

| Aspect | Template File | Keywords |
|--------|--------------|----------|
| Dice | `dice.md` | dice, roll, d4, d6, d8, d10, d12, d20, rolling |
...

## Detection Rules

1. **Keyword matching is case-insensitive**
2. **Multiple aspects can be detected** - A game can have Dice + SquareGrid
...

## Usage

After the interview, scan the component answers for keywords:
...
```
- `index.md` is the direct precedent for a **shared cross-cutting rules document that other files/skills consult rather than duplicate** — exactly the role CONTEXT.md assigns to `state-machine.md` ("every bs- skill will cite/include it rather than duplicating rules").
- Structure to copy: `# <Title>` → short one-line mission statement → a table for enumerable facts (here: aspect→file→keywords; for `state-machine.md`: could use a table for the status enum or step-name list if that reads better than prose) → numbered "Rules" list sections → a closing `## Usage` section showing how a consumer applies the rules.
- `index.md`'s numbered "Detection Rules" list (`1. **Keyword matching is case-insensitive**` style — bold lead-in, single-sentence rule) is the exact style to reuse for `state-machine.md`'s "Authority", "Write Order", "Repair Loop Bound", "Redteam Escalation" sections (RESEARCH.md's skeleton already drafts this; match `index.md`'s exact bold-lead-in-plus-terse-sentence phrasing).

---

### `src/cli/slash-command/bs/templates.test.ts`

**Analog:** `src/cli/commands/init.test.ts` (lines 1-96, especially the `describe('init command — no -t/--template surface ...')` block, lines 74-96)

**Imports pattern** (lines 15-21):
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateGameTs, generateTestTs } from './init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
```
For `templates.test.ts`, drop the `generateGameTs`/`generateTestTs` import (no generator functions exist for these files — they're read directly off disk) but keep the `readFileSync` + `fileURLToPath`/`dirname`/`join` + `__dirname` boilerplate verbatim; it is the standard project convention for a vitest file that needs to read sibling source/doc files from disk without a build step.

**Core disk-read content-assertion pattern** (lines 74-96):
```typescript
describe('init command — no -t/--template surface (CLIX-05 / F33)', () => {
  it('does not register -t/--template on the init command in cli.ts', () => {
    const cliSrc = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    const initBlockStart = cliSrc.indexOf(".command('init <name>')");
    expect(initBlockStart).toBeGreaterThan(-1);
    const initBlockEnd = cliSrc.indexOf('.action(initCommand)', initBlockStart);
    expect(initBlockEnd).toBeGreaterThan(initBlockStart);
    const initBlock = cliSrc.slice(initBlockStart, initBlockEnd);
    expect(initBlock).not.toContain('--template');
    expect(initBlock).not.toContain('-t,');
  });

  it('does not remove the unrelated pack command --target flag', () => {
    const cliSrc = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    expect(cliSrc).toContain("-t, --target <path>");
  });

  it('init.ts has no InitOptions.template field (the InitOptions type itself is gone)', () => {
    const initSrc = readFileSync(join(__dirname, 'init.ts'), 'utf-8');
    expect(initSrc).not.toContain('template');
    expect(initSrc).not.toContain('InitOptions');
  });
});
```
This is the exact shape `templates.test.ts` should follow for every TMPL-01/02/03 assertion:
1. `readFileSync(join(__dirname, 'templates', 'CHUNK.template.md'), 'utf-8')` (or `join(__dirname, 'state-machine.md')`) once per `describe` block (or per file, hoisted like `init.test.ts` hoists `const src = generateGameTs('Demo');` at line 24).
2. Use `indexOf`/`slice` to isolate a sub-block before asserting `toContain`/`not.toContain` — precedent for isolating "just the CHUNK.template.md Status line region" or "just the step-checklist section" rather than asserting against the whole file body, which matches RESEARCH.md's Pitfall 3 (cross-file step-name consistency: read both `CHUNK.template.md` and `state-machine.md`, assert the same exact step-name string appears in both).
3. Group tests under a `describe` block named after the requirement/bug it guards (here `'init command — no -t/--template surface (CLIX-05 / F33)'`) — for this phase, name blocks after the requirement IDs, e.g. `describe('TMPL-01 — exact step names and status enum', ...)`, `describe('TMPL-03 — CHUNK/state-machine consistency', ...)`, matching RESEARCH.md's own test-map naming (`-t "TMPL-01"` grep-by-describe-name convention).
4. File header comment style (lines 1-14 of `init.test.ts`) — a block comment explaining *why* the test exists (bug/regression context) before the imports. Use the same convention: a short header comment citing TMPL-01/02/03 and RESEARCH.md's drift-protection rationale.

**Location convention:** `init.test.ts` sits directly beside the file(s) it inspects (`src/cli/commands/init.test.ts` next to `init.ts` and `cli.ts` one directory up). `templates.test.ts` at `src/cli/slash-command/bs/templates.test.ts` follows the same co-location rule — no separate `__tests__/` directory, no config change (vitest's `include: ['src/**/*.test.ts', ...]` already covers it, confirmed in RESEARCH.md).

---

## Shared Patterns

### Static shared-reference content (not thin pointer)
**Source:** `src/cli/slash-command/aspects/dice.md`, `src/cli/slash-command/aspects/index.md`
**Apply to:** All 6 `.template.md` files + `state-machine.md`
Both existing `aspects/*.md` files are full, standalone, self-contained content — no `{{BOARDSMITH_ROOT}}`-style indirection, no "read the instructions elsewhere" pointer. This phase's 7 new files (6 templates + state-machine.md) must follow this precedent, NOT the `design-game.template.md` thin-pointer precedent (that pattern is reserved for files meant to bootstrap a *separate* long instructions.md, which doesn't apply here — templates ARE the content).

### `.template.md` naming suffix
**Source:** `src/cli/slash-command/design-game.template.md`, `src/cli/slash-command/generate-ai.template.md`
**Apply to:** All 6 files under `src/cli/slash-command/bs/templates/`
Confirmed by `ls` — two existing top-level `.template.md` files already use this exact suffix convention. `state-machine.md` itself is NOT a `.template.md` (it's a rules doc, not something a session fills in) — this matches CONTEXT.md's naming decision and RESEARCH.md's project structure exactly (`state-machine.md` sits at `bs/` root, siblings sit in `bs/templates/`).

### Disk-read content-assertion test pattern
**Source:** `src/cli/commands/init.test.ts` lines 15-21, 74-96
**Apply to:** `src/cli/slash-command/bs/templates.test.ts` (the only test file in this phase)
`readFileSync(join(__dirname, ...), 'utf-8')` + `indexOf`/`slice` block isolation + `toContain`/`not.toContain` assertions, grouped in `describe` blocks named by requirement ID. No markdown parser, no snapshot testing — plain string matching, confirmed as the project's existing convention for exactly this kind of "does the shipped file contain expected literal text" drift guard.

### No index.md/registry needed for templates/
**Source:** `src/cli/slash-command/aspects/index.md` (registry pattern) vs this phase's explicit non-need
RESEARCH.md explicitly notes `aspects/` needs `index.md` because aspects are *conditionally selected by keyword*; the 6 templates are a fixed, always-used set — do not create a `templates/index.md`. This is a documented anti-pattern to avoid copying wholesale from the `aspects/` precedent.

## No Analog Found

None — every file in this phase has a strong analog. The two existing precedent families (`aspects/*.md` for content style, `design-game.template.md`/`generate-ai.template.md` for naming, `init.test.ts` for the test pattern) together cover all 8 files with role-match or exact quality.

## Metadata

**Analog search scope:** `src/cli/slash-command/` (all files + `aspects/` subdir), `src/cli/commands/*.test.ts`, `src/cli/lib/*.test.ts`
**Files scanned:** `design-game.template.md`, `generate-ai-instructions.md`, `generate-ai.template.md`, `instructions.md`, `aspects/dice.md`, `aspects/index.md`, `aspects/hex-grid.md` (listed, not read — redundant with dice.md), `aspects/playing-cards.md` (listed, not read), `aspects/square-grid.md` (listed, not read), `project-scaffold.test.ts`, `init.test.ts`, `vitest.config.ts` (referenced from RESEARCH.md, not re-read)
**Pattern extraction date:** 2026-07-04
