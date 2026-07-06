# Phase 152: Asset Completeness in bs-build-chunk - Research

**Researched:** 2026-07-06
**Domain:** Vue 3 SFC generation (CLI scaffold codegen + Markdown skill prose), static-analysis CI gate
**Confidence:** HIGH (all claims grounded in direct source reads of this repo; no external library research needed — this is entirely internal architecture)

## Summary

DEF-A's root cause is now fully reproducible from source: `~/BoardSmithGames/go-fish-dryrun/src/rules/game.ts` sets `card.$images = { face: '/cards/${rank}${suit}.svg', ... }` and `GameTable.vue:223` renders `<img v-if="cardImage(card,'face')" :src="cardImage(card,'face')" ...>` with **no `onload`/`onerror` handling at all** — a bare, unguarded `<img>`. The interim fix that shipped in Phase 151 (`scripts/generate-cards.mjs` generating the missing SVGs) is exactly the class of one-off hand-patch this phase must NOT repeat as the general solution — the UI code is unchanged and still structurally capable of rendering a broken image the moment any future chunk introduces an asset path with nothing behind it.

Critically, this same bare-`<img>` bug also exists **inside BoardSmith's own AutoUI renderers** — `CardRenderer.vue` (`src/ui/components/auto-ui/renderers/CardRenderer.vue:372-378`) and `PieceRenderer.vue` (`src/ui/components/auto-ui/renderers/PieceRenderer.vue:164-175`) both render `<img v-else-if="...?.type === 'url'" :src="...">` with no `onload`/`onerror` fallback swap. AutoUI's only defensive path is "no `$images` at all" (baseline 3/4, a compile-time-known absence) — it has zero handling for "`$images` present but the URL 404s at runtime," which is exactly DEF-A's failure mode. This is in scope to at least document as a known related gap (see Open Questions) even though the locked CONTEXT.md scope is the `bs-build-chunk`-generated custom UI, not AutoUI itself.

BoardSmith already has one internal precedent for the exact "drawn-fallback + swap-on-load" pattern the phase wants: `Die3D.vue:492-527`'s `createImageTexture()` uses a real `new Image()` + `img.onload`/`img.onerror` preload-check before committing to either the loaded texture or a drawn canvas fallback. This is a Canvas/WebGL texture use case, not a DOM `<img>`, but the preload-then-swap *shape* is directly reusable for the Vue component this phase needs.

The scaffold that actually emits generated-game source code is `src/cli/lib/project-scaffold.ts` (consumed by `npx boardsmith init` via `src/cli/commands/init.ts`), NOT the `bs-ingest/scaffold.md` skill markdown (that file only orchestrates *running* `init` + compile/serve verification — it contains zero code-generation logic). `generateScaffoldFiles()` already writes `src/ui/App.vue` and `src/ui/components/GameTable.vue` into every freshly-`init`'d project via string-template generator functions (`generateAppVue()`, `generateGameTableVue()`). This is the load-bearing mechanism: adding a new `generateAssetImageVue()` function (or similarly named) to this same array means **every generated game inherits the fallback component from Chunk 0**, before any UI chunk exists — exactly what CONTEXT.md's locked decision requires ("a reusable scaffold component... every generated game inherits it").

**Primary recommendation:** Ship a new `<AssetImage>` (or `<CardFace>`/`<PieceFace>`) Vue SFC as a literal generator function in `project-scaffold.ts`, added to `generateScaffoldFiles()`'s returned file list (e.g. `src/ui/components/AssetImage.vue`), following the `Die3D.vue` preload-then-swap pattern with a `$images`-aware, rank/suit-and-label-aware drawn fallback styled in `--bsg-*` tokens. Extend `build/build.md`'s existing UIQ-02 Placeholders section to prohibit any bare asset `<img>` and mandate routing through this component. Add a new static-analysis asset-reachability check as a first-class module (mirroring `sandbox-scan.ts`'s single-source-of-truth pattern) wired into both a new `boardsmith lint`-style check and `build/test.md`'s ordered sequence as a `ui: touches|major`-conditional, build-blocking item.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Drawing the fallback UI (rank+suit / label) | Frontend Server / Browser (Vue SFC) | — | Pure presentational component, runs in the browser iframe like all custom UI |
| Detecting image load failure (`onload`/`onerror`) | Browser | — | `<img>` load events are a browser-only signal; no server round-trip |
| Emitting the reusable component into every generated project | Build tooling (CLI, `project-scaffold.ts`) | — | Runs once, at `npx boardsmith init` time, on the designer's machine — not a runtime service |
| Prohibiting bare `<img>` during chunk authoring | Skill prose (`build.md`, agent-authored code) | — | Enforced by instruction to the LLM authoring the chunk's UI, not by a runtime guard |
| Asset-reachability gate (ASSET-02) | CLI static-analysis tool (new module, mirrors `sandbox-scan.ts`) | Build tooling (`test.md` orchestration) | AST/text scan over generated project source; must run as a real command, not prose |
| Fallback design tokens (`--bsg-*`) | Frontend Server / Browser (CSS custom properties) | — | Already established by `DESIGN.template.md`'s Theme Block |

## Standard Stack

This phase does not introduce any new external dependency. All work is internal: Vue 3 SFC generation (already a project dependency), Node `fs`/`path` (already used by `project-scaffold.ts` and `sandbox-scan.ts`), and the existing `vitest`/`@vue/test-utils`/`axe-core` test stack already wired into generated projects (`generatePackageJson()` in `project-scaffold.ts`).

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 `<script setup>` SFC | (already pinned in generated `package.json`) | The `AssetImage` fallback component itself | Matches every other scaffold-generated component (`App.vue`, `GameTable.vue`) |
| Node `node:fs`/`node:path` | built-in | Reading generated-project source for the ASSET-02 static scan | Matches `sandbox-scan.ts`'s existing implementation exactly — zero new deps |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` + `@vue/test-utils` (already generated into every project) | pinned in `generatePackageJson()` | Before/after fixture test proving the gate catches DEF-A's class | Already the generated project's test runner — no new tooling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static-analysis asset-reachability check (grep/AST over source + emitted-files diff) | A real headless-browser render pass (Playwright) asserting `naturalWidth > 0` | Browser-render proof is stronger but far slower and non-hermetic for a build-blocking gate that must run on every chunk; CONTEXT.md's locked decision already chose "static asset-reachability," reserving the actual browser proof for the separate before/after Success-Criterion-2 regeneration check (already decided, not open) |
| New `boardsmith` CLI subcommand (`boardsmith lint`-style first-class check) | A one-off script embedded only in `test.md`'s prose | A first-class module (like `sandbox-scan.ts`) is single-source-of-truth and testable in BoardSmith's own suite; embedding only in prose risks drifting/duplicating logic per generated game — reject the informal option |

**Installation:** None — no new packages.

## Package Legitimacy Audit

No external packages are installed by this phase. Skipped per the gate's own scope condition ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
npx boardsmith init <name>
        │
        ▼
project-scaffold.ts: generateScaffoldFiles()
        │  (NEW) generateAssetImageVue() → src/ui/components/AssetImage.vue
        │        generateGameTableVue()  → src/ui/components/GameTable.vue (unchanged stub)
        ▼
<generated project>/  ← compiles + serves (scaffold.md's verification sequence), BEFORE any chunk exists
        │
        ▼
/bs-build-chunk  build step (build/build.md)
        │  UIQ-02 (extended): "no bare asset <img>; route through <AssetImage>"
        │  agent writes chunk UI importing <AssetImage :images="card.$images" kind="card" :rank :suit>
        ▼
<generated project>/src/ui/... (chunk's own components, e.g. GameTable.vue)
        │
        ▼
/bs-build-chunk  test step (build/test.md)
        │  NEW ordered item: asset-reachability gate (ui: touches|major only)
        │    scanAssetReachability(cwd) → finds every UI-source asset-path reference
        │    → each must (a) resolve to an emitted file under public/ OR
        │                 (b) be passed through <AssetImage> (the only sanctioned wrapper)
        │  FAIL routes chunk back to `build` (repair loop), same as any other test.md item
        ▼
Chunk passes test.md → audit/repair → playtest (human) → close
```

### Recommended Project Structure

New/changed files, all inside **this** repo (BoardSmith itself), not any generated game:

```
src/cli/lib/
├── project-scaffold.ts        # ADD generateAssetImageVue(); add to generateScaffoldFiles()
├── project-scaffold.test.ts   # ADD assertions for the new generated file
└── asset-scan.ts              # NEW — mirrors sandbox-scan.ts's shape; single source of truth
                                #        for ASSET-02, consumed by test.md's gate (and, if a
                                #        first-class CLI surface is warranted, `boardsmith lint`)

src/cli/slash-command/bs/
├── build/build.md             # EXTEND UIQ-02 section: prohibit bare asset <img>, cite AssetImage.vue
├── build/test.md              # ADD new ordered item (ui: touches|major-conditional) citing asset-scan.ts
├── build-chunk.test.ts        # ADD assertions the new prose exists (mirrors existing UIQ-0x tests)
└── templates/DESIGN.template.md  # (no structural change — Placeholder Policy already covers this;
                                   #  just confirm AssetImage.vue is the operationalization of it)
```

Inside a **generated** game project (what ships to designers), the new file lands at:
```
<generated-project>/src/ui/components/AssetImage.vue   # emitted at init time, before chunk 1 exists
```

### Pattern 1: Preload-then-swap (the `Die3D.vue` precedent, adapted to DOM `<img>`)

**What:** Always render the drawn fallback synchronously; separately construct a real `Image()` (or bind `onload`/`onerror` directly on the rendered `<img>`) and only reveal/overlay the real asset once `onload` fires, reverting to the fallback on `onerror`.
**When to use:** Any place a generated game references `$images`/asset paths for card or piece art.
**Example (existing precedent in this repo, Canvas/WebGL texture context — cite as the pattern's origin):**
```typescript
// Source: src/ui/components/dice/Die3D.vue:492-527 (existing BoardSmith code)
function createImageTexture(imageUrl: string, backColor: string): Promise<THREE.CanvasTexture> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { /* build texture from img, resolve(texture) */ };
    img.onerror = () => { /* build a drawn Canvas fallback, resolve(texture) */ };
    img.src = imageUrl;
  });
}
```
**Adapted for a DOM `<img>` (the shape the new `AssetImage.vue` should follow):**
```vue
<!-- Always-drawn fallback rendered underneath; overlay <img> only swaps in on load -->
<template>
  <div class="asset-image" :style="{ aspectRatio: aspectRatio }">
    <div class="asset-fallback" :class="{ 'is-loaded': loaded }">
      <!-- kind='card': rank+suit; kind='piece': label — game-semantic, styled with --bsg-* -->
      <slot name="fallback">{{ label }}</slot>
    </div>
    <img
      v-if="src"
      :src="src"
      class="asset-real"
      :class="{ 'is-loaded': loaded }"
      :alt="label"
      @load="loaded = true"
      @error="loaded = false"
    />
  </div>
</template>
```

### Anti-Patterns to Avoid
- **Generating placeholder asset files as the "fix":** This is what Phase 151's `generate-cards.mjs` did for the one hand-fixed `go-fish-dryrun` project. It papers over the missing structural guarantee — the next chunk/game that introduces a new asset path with nothing behind it reproduces DEF-A exactly. The phase's own CONTEXT.md explicitly rejects this shape ("never as a one-off hand-patch to a single generated game").
- **`v-if="hasImages"` as the only guard (current bug shape):** Both the hand-written `go-fish` UI and BoardSmith's own `CardRenderer.vue`/`PieceRenderer.vue` only branch on "does `$images` exist," never on "did the URL actually resolve." This is the exact gap DEF-A exploited — `$images.face` was truthy (a string), so the `v-else` CSS-drawn fallback branch never fired even though the file didn't exist.
- **Relying on Vite's dev-server SPA fallback behavior as a signal:** DEF-A's root cause included Vite serving `index.html` (`HTTP 200`, `text/html`) for the missing `/cards/*.svg` path instead of a 404. Any reachability check must not assume a missing asset ⇒ non-200 response; it must check the emitted file's actual existence on disk (build-time) rather than trust an HTTP status.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting whether an image URL will actually load | A custom fetch-and-check-content-type probe | The DOM's own `<img>` `load`/`error` events (or `new Image()` preload, per `Die3D.vue`'s existing pattern) | The browser already does this correctly and for free; a manual HTTP probe duplicates work and can diverge from what the real `<img>` tag will do (caching, CORS, redirects) |
| Static asset-reachability scanning | A second bespoke regex scanner living only inside `test.md`'s prose | A new dedicated module (`asset-scan.ts`) following `sandbox-scan.ts`'s "single source of truth, both `validate` and `lint` delegate here" precedent | `sandbox-scan.ts`'s own header explicitly states this exact principle: "so there is exactly one implementation of these guardrails — no duplicated regex scanners." Violating it here (embedding scan logic only in markdown prose) repeats a mistake this codebase has already deliberately avoided elsewhere |

**Key insight:** BoardSmith already has both halves of this solution living uninstalled in its own codebase — `Die3D.vue`'s preload-then-swap pattern, and `sandbox-scan.ts`'s single-source-of-truth static-scan architecture. This phase is substantially an act of *generalizing existing internal patterns* into the scaffold layer, not inventing new techniques.

## Common Pitfalls

### Pitfall 1: AutoUI's own renderers have the same unguarded bug — scope ambiguity
**What goes wrong:** A designer who chooses `ui: auto` (the scaffold's default) never reaches `build/build.md`'s prose at all — AutoUI's `CardRenderer.vue`/`PieceRenderer.vue` render the exact same bare `<img>` (no `onload`/`onerror`) as the custom-UI bug DEF-A exposed. If ASSET-01 is implemented only as a new component for the custom-UI path, an AutoUI-only game remains exposed to DEF-A's failure mode.
**Why it happens:** `CardRenderer.vue`/`PieceRenderer.vue` were built for the "no `$images` at all" case (baseline 3/4) — a compile-time-known-absent case — never for "`$images` present but URL 404s," a runtime-only failure.
**How to avoid:** Explicitly scope-check with the user/planner whether ASSET-01 must also patch `CardRenderer.vue`/`PieceRenderer.vue` themselves (since they are BoardSmith library code, changing them is a normal PIT-of-success library fix, not a "one-off hand-patch to a generated game" — it fixes every AutoUI-based game at once). CONTEXT.md's Phase Boundary text says "any card/piece art the build emits" without restricting to custom UI; recommend the planner treat this as in-scope unless explicitly descoped.
**Warning signs:** A regeneration proof run only against Go Fish's custom-UI path (per CONTEXT.md's stated proof target) would not catch this gap at all — plan a targeted unit test against `CardRenderer.vue`/`PieceRenderer.vue` directly, independent of the Go Fish regeneration.

### Pitfall 2: Vite's SPA fallback masks a missing asset as HTTP 200
**What goes wrong:** A runtime reachability check that does `fetch('/cards/AH.svg')` and checks for a non-200 status will falsely report "reachable" — Vite's dev server serves `index.html` (200, `text/html`) for any unmatched path.
**Why it happens:** SPA routing fallback is a deliberate Vite/dev-server feature, not a bug — but it defeats any HTTP-based reachability probe.
**How to avoid:** ASSET-02's check must be a **file-system-level static check** (does the referenced path resolve to an actual file under the generated project's `public/` at build time?), never an HTTP-status probe. This matches CONTEXT.md's locked decision ("static asset-reachability").

### Pitfall 3: The fallback wrapper must not defeat the zero-layout-diff guarantee
**What goes wrong:** `build.md`'s existing UIQ-02 section already guarantees "asset arrival later replaces the placeholder's fill only... never changes geometry or layout." If `AssetImage.vue`'s drawn-fallback and real-`<img>`-overlay have different intrinsic sizing behavior (e.g. the fallback is a fixed-size `<div>` but the `<img>` uses `object-fit: contain` inside a differently-sized box), swapping between them at runtime could visibly reflow content — the exact defect UIQ-02 was written to prevent.
**Why it happens:** Two different DOM elements (a drawn `<div>` fallback and an `<img>`) rendered in the same visual slot need identical box dimensions, driven by the SAME declared aspect ratio — easy to get subtly wrong if the fallback's CSS and the `<img>`'s CSS are authored independently.
**How to avoid:** `AssetImage.vue` should size both the fallback and the `<img>` from one shared CSS custom property/aspect-ratio input (see `DESIGN.template.md`'s Component Recipes convention: "card face uses a 2:3 aspect-ratio frame"), and overlay the `<img>` absolutely inside the same box rather than swapping which element is in flow.
**Warning signs:** A visual regression where card art "pops in" with a size change; catch via the same design-review screenshot grid (`build/design-review.md`'s 3x2 breakpoint/theme grid) already run for UI chunks.

### Pitfall 4: `jsdom` never fires real image load/error events by default
**What goes wrong:** A `@vue/test-utils` unit test that mounts `AssetImage.vue` under `@vitest-environment jsdom` and asserts the `onload`/`onerror` branch will hang or silently never trigger — `jsdom` does not perform real network requests for `<img src>`, so neither `load` nor `error` fires naturally, and `img.naturalWidth` stays `0` regardless of whether the URL would really resolve.
**Why it happens:** `jsdom` is a DOM emulation, not a browser; it has no image-decoding pipeline.
**How to avoid:** Unit tests for `AssetImage.vue`'s branch logic must manually dispatch a synthetic `load`/`error` event (`wrapper.find('img').trigger('load')` / `.trigger('error')`) rather than relying on a real asset fetch — mirroring how any DOM-event-driven Vue component is tested in this repo (`useSelectable`'s `keydown` tests use the identical `trigger()` pattern). The actual "zero broken `<img>`s in production" proof must come from the separate real-browser regeneration check (Success Criterion 2), not from the `jsdom` unit suite.
**Warning signs:** A test that asserts `wrapper.find('img').element.naturalWidth > 0` under `jsdom` will always be `0` — this is a broken/false test, not a real DOM assertion; do not write this pattern into the generated project's own test suite.

## Code Examples

### The precedent this phase generalizes
```typescript
// Source: src/ui/components/dice/Die3D.vue:492-527 (this repo, existing code)
// Preload-check via new Image() + onload/onerror, falling back to a drawn Canvas.
// AssetImage.vue's <img @load>/<img @error> handlers are the DOM equivalent of this pattern.
```

### The bug being fixed, verbatim (do not repeat this shape)
```vue
<!-- Source: ~/BoardSmithGames/go-fish-dryrun/src/ui/components/GameTable.vue:223 (post-DEF-A-fix, STILL has the bug) -->
<img v-if="cardImage(card, 'face')" :src="cardImage(card, 'face')" class="card-image" :alt="`${card.rank}${card.suit}`" />
<!-- No onload/onerror. If cardImage() returns a truthy string whose file doesn't exist,
     this renders a broken image unconditionally — DEF-A's exact defect, unchanged by the
     Phase 151 interim fix (which only added the missing SVG files, not this guard). -->
```

### The single-source-of-truth scan pattern to mirror for ASSET-02
```typescript
// Source: src/cli/lib/sandbox-scan.ts (this repo) — cite the file's own header comment:
// "Both `boardsmith validate` and `boardsmith lint` delegate here, so there is exactly
//  one implementation of these guardrails — no duplicated regex scanners."
// asset-scan.ts should follow the identical shape: one exported scanAssetReachability(cwd)
// function, consumed by both test.md's gate and (optionally) `boardsmith lint`.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Hand-patch a single generated game's missing assets (`generate-cards.mjs`) | Scaffold-level always-drawn-fallback component + build-blocking gate | Phase 152 (this phase) | Every future generated game inherits the guarantee; no per-game asset-generation scripts needed |
| `test.md`'s test bar covers compile/lint/unit/random-sim/a11y but not rendered asset bytes | Adds a 7th ordered item: asset-reachability (this phase's ASSET-02) | Phase 152 | Closes the exact gap the 149-HUMAN-UAT.md meta-finding named: "the pipeline needs an asset-completeness / broken-`<img>` check" |

**Deprecated/outdated:** None — this is new ground, not a replacement of an existing documented mechanism.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The reusable component should be named `AssetImage.vue` and generated via a new `generateAssetImageVue()` function added to `project-scaffold.ts`'s `generateScaffoldFiles()` array | Architecture Patterns, Summary | This is a recommended concrete name/location, not verified against any existing planning artifact; the planner/user may prefer a different name (`CardFace.vue`, `AssetFallback.vue`) or a different injection point (e.g. a literal file copied via `SHARED_DIRS`'s `templates/` instead of codegen). The underlying mechanism (ship it at `init` time so every game inherits it from Chunk 0) is the load-bearing claim, not the exact name. |
| A2 | `CardRenderer.vue`/`PieceRenderer.vue` (AutoUI) should be considered in-scope for this phase, not just the custom-UI scaffold path | Common Pitfalls (Pitfall 1) | If the planner descopes AutoUI, a designer using `ui: auto` remains exposed to DEF-A's exact class of bug, undermining the phase's own stated guarantee ("a game generated by the bs-build-chunk pipeline never renders a broken `<img>`") for a whole category of generated games |
| A3 | A new dedicated `asset-scan.ts` module (rather than embedding the scan only in `test.md` prose) is warranted, mirroring `sandbox-scan.ts` | Don't Hand-Roll, Architecture Patterns | If the planner judges this "first-class tooling" premature (per CONTEXT.md's Deferred Ideas, which explicitly reserves a general-purpose `boardsmith` CLI asset-lint subcommand as "only if the static check proves it needs first-class tooling"), a simpler embedded-script approach in `test.md` may be preferred for v1, with `asset-scan.ts` as a future extraction |

**None of these are verified against an authoritative external source** — they are architectural recommendations derived from direct reading of this repo's own code, which is the correct and only relevant source for an internal-tooling phase like this. They are flagged `[ASSUMED]`-equivalent here because they represent design choices, not established facts, and should be confirmed with the user/planner before being locked.

## Open Questions (RESOLVED)

> **RESOLVED 2026-07-05** — both questions were decided during discuss/planning and are recorded in
> `152-CONTEXT.md`. Q1 (AutoUI scope): **IN SCOPE** — user-confirmed; realized by plan 152-02. Q2
> (wrapper-detection heuristic): **coarse check** (any bare `<img>` outside `AssetImage.vue` = FAIL);
> realized by plan 152-03. Retained below for audit history.

1. **Does ASSET-01's guarantee extend to AutoUI's `CardRenderer.vue`/`PieceRenderer.vue`, or only the custom-UI scaffold path?**
   - What we know: CONTEXT.md's Phase Boundary describes the guarantee in terms of "a game generated by the `bs-build-chunk` pipeline," without restricting to the custom-UI path; Go Fish (the proof target) uses custom-from-chunk-1, so the regeneration proof alone won't exercise AutoUI.
   - What's unclear: whether fixing `CardRenderer.vue`/`PieceRenderer.vue` themselves is considered part of "the fix lives in the skill/scaffold layer... never a hand-patch to one generated game" (since these are BoardSmith library files, not generated-game files — arguably an even cleaner fix, fixing every AutoUI game universally) or whether it's out of this phase's stated boundary and should be tracked as a follow-up.
   - Recommendation: Surface this explicitly to the user during planning; recommend including the `CardRenderer.vue`/`PieceRenderer.vue` fix in this phase's scope, since it is strictly smaller in surface area (2 existing files, both already reachable in this repo's own test suite) than building an entirely new scaffold component, and closes the same defect class for the other half of the pipeline's UI options.

2. **Exact wrapper-detection heuristic for ASSET-02's "OR is rendered through the fallback wrapper" clause.**
   - What we know: CONTEXT.md locks the check's shape as "every asset path referenced by UI source either resolves to an emitted file OR is rendered through the fallback wrapper."
   - What's unclear: how the static scanner concretely proves "rendered through the wrapper" for an arbitrary chunk's code — e.g. does it require the asset path literal to appear only as a prop passed into `<AssetImage>` (an AST/text-adjacency check), or does it grep for "no bare `<img>` tag exists anywhere outside `AssetImage.vue` itself" (a coarser, simpler, and probably sufficient check given `build.md`'s parallel prohibition)?
   - Recommendation: Favor the coarser check first (per Pit of Success: make the wrong path hard, not exhaustively provable) — scan all UI source for `<img\b` tags outside `AssetImage.vue`'s own definition; any hit is an automatic FAIL regardless of `src` content. This sidesteps needing to trace prop plumbing and is trivially cheap to implement and to reason about.

## Environment Availability

Skipped — this phase has no external tool/service dependencies beyond what's already installed in this repo and in every `boardsmith init`-generated project (Node, npm, Vue, Vite, Vitest — all already verified present by existing CI/tests in this repo).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (this repo's own suite: `project-scaffold.test.ts`, `build-chunk.test.ts`; generated projects also use Vitest per `generatePackageJson()`) |
| Config file | `vitest.config.ts` (this repo, root) |
| Quick run command | `npx vitest run src/cli/lib/project-scaffold.test.ts src/cli/lib/asset-scan.test.ts src/cli/slash-command/bs/build-chunk.test.ts` |
| Full suite command | `npm test` (this repo) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASSET-01 | `AssetImage.vue` (or equivalent) is emitted by `generateScaffoldFiles()` and always renders a drawn fallback, overlaying the real image only on `load` | unit | `npx vitest run src/cli/lib/project-scaffold.test.ts -t AssetImage` | ❌ Wave 0 — new test needed |
| ASSET-01 | `AssetImage.vue` reverts to the drawn fallback on a synthetic `error` event (jsdom-safe pattern per Pitfall 4) | unit | `npx vitest run src/cli/lib/project-scaffold.test.ts -t "onerror"` | ❌ Wave 0 |
| ASSET-01 | `build/build.md` prohibits a bare asset `<img>` and cites the new component by name | skill-guidance | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "bare.*img\|AssetImage"` | ❌ Wave 0 — extend existing UIQ-02 describe block |
| ASSET-02 | `asset-scan.ts`'s reachability scan FAILS on a fixture project with an asset-referencing-but-asset-less UI, PASSES once wrapped in `AssetImage` | unit (fixture) | `npx vitest run src/cli/lib/asset-scan.test.ts` | ❌ Wave 0 — new file, new fixture pair |
| ASSET-02 | `build/test.md` names the new gate as an ordered, `ui: touches|major`-conditional, build-blocking item | skill-guidance | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "asset-reachability"` | ❌ Wave 0 — extend existing BUILD-06 describe block |
| ASSET-01 (Success Criterion 2) | Regenerated Go Fish renders every card with zero broken `<img>` (`naturalWidth > 0`) in a real browser | e2e (manual/Playwright) | `cd ~/BoardSmithGames/<regenerated-go-fish> && npx boardsmith dev --no-open` + Playwright check, per `149-HUMAN-UAT.md`'s existing script shape | ❌ Wave 0 — this is inherently a real-browser check; `jsdom` cannot prove it (Pitfall 4) |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed test file>`
- **Per wave merge:** `npm test` (this repo's full suite — must stay green, matching every prior phase's precedent)
- **Phase gate:** Full suite green + the real-browser regeneration proof (Success Criterion 2) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/lib/asset-scan.test.ts` — new file, needs a passing fixture (asset wrapped in `AssetImage`) and a failing fixture (bare `<img>` to a nonexistent path), covers ASSET-02
- [ ] `project-scaffold.test.ts` — extend with `AssetImage.vue` generation + fallback/overlay/onerror assertions, covers ASSET-01
- [ ] `build-chunk.test.ts` — extend existing UIQ-02 (`describe('UIQ-02 — designed placeholders')`) and BUILD-06 (`describe('BUILD-06 — test step')`) blocks with the new prose assertions
- [ ] No new test framework install needed — Vitest/`@vue/test-utils`/`axe-core` are already wired into both this repo and every generated project

## Security Domain

Not applicable — this phase touches no authentication, session management, access control, or cryptography surfaces. The one relevant ASVS-adjacent concern (V5 Input Validation) is already handled by existing conventions: `$images` values are always developer/rulebook-authored asset paths (not user input), and CardRenderer's existing XSS-guard precedent (`action-selectable` background comment: "T-93-03 XSS guard") shows this codebase already treats element-attribute-driven rendering carefully — no new guard is needed for this phase's `AssetImage.vue`, which renders `:src` and `:alt` from the same trusted `$images`/label data the existing renderers already handle safely.

## Sources

### Primary (HIGH confidence — direct source reads in this repo)
- `src/cli/slash-command/bs/ingest/scaffold.md` — confirms this file is orchestration-only (naming, `init`, compile/serve verification), not a code generator
- `src/cli/lib/project-scaffold.ts` — the actual code-generating scaffold; `generateScaffoldFiles()`, `generateGameTableVue()`, `generateAppVue()` read in full
- `src/cli/slash-command/bs/build/build.md` — existing UIQ-02 Placeholders section, to be extended
- `src/cli/slash-command/bs/build/test.md` — existing ordered, stop-on-failure test sequence + a11y floor conditional, the shape the new ASSET-02 item must follow
- `src/cli/lib/sandbox-scan.ts` — single-source-of-truth scan pattern to mirror for `asset-scan.ts`
- `src/cli/commands/lint.ts` — confirms `boardsmith lint` has no first-class asset-checking today; regex-based, informational-severity rules only, plus the AST-based sandbox scan
- `src/ui/components/auto-ui/renderers/CardRenderer.vue`, `PieceRenderer.vue` — confirms the SAME unguarded-`<img>` bug exists in BoardSmith's own AutoUI library code
- `src/ui/components/dice/Die3D.vue:492-527` — the existing preload-then-swap (`onload`/`onerror`) precedent in this repo
- `src/cli/slash-command/bs/templates/DESIGN.template.md`, `ASSETS.template.md` — Placeholder Policy / asset ledger contract this component operationalizes
- `src/cli/slash-command/bs/build-chunk.test.ts`, `src/cli/slash-command/bs/templates.test.ts` — existing skill-guidance regression test shape to extend
- `src/cli/commands/install-claude-command.ts` — confirms `SHARED_DIRS = ['build', 'ingest', 'templates', 'aspects']` are copied recursively; if the fallback component were instead placed as a literal file under `templates/`, no installer change would be needed (moot if it's generated via `project-scaffold.ts` instead, since that's part of the `boardsmith` package itself, not the installed skill files)
- `~/BoardSmithGames/go-fish/src/ui/components/GameTable.vue` (hand-built reference) and `~/BoardSmithGames/go-fish-dryrun/src/ui/components/GameTable.vue`, `src/rules/game.ts`, `scripts/generate-cards.mjs` (pipeline-built, DEF-A repro) — both confirmed to still have the bare, unguarded `<img>` pattern even post-"fix"
- `.planning/milestones/v4.6-phases/149-end-to-end-dry-run-validation/149-HUMAN-UAT.md` — DEF-A root cause writeup and meta-finding
- `.planning/phases/152-asset-completeness-in-bs-build-chunk/152-CONTEXT.md` — locked decisions (this document's binding constraint set)

### Secondary / Tertiary
None used — this phase required no external library research; all claims are grounded in direct reads of this repository's own source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all tooling already exists and verified via direct file reads
- Architecture: HIGH — the exact injection point (`project-scaffold.ts`'s `generateScaffoldFiles()`) is directly observed, not inferred
- Pitfalls: HIGH — all four pitfalls are grounded in directly-observed code (the DEF-A repro files, `jsdom`'s documented lack of image decoding, this repo's own UIQ-02 zero-layout-diff guarantee text)

**Research date:** 2026-07-06
**Valid until:** Effectively indefinite for the architectural claims (internal source, not a moving external target) — but re-verify against `project-scaffold.ts`/`CardRenderer.vue`/`PieceRenderer.vue` current line numbers if this phase's planning is delayed past any other phase that touches those same files, since exact line references will drift.
