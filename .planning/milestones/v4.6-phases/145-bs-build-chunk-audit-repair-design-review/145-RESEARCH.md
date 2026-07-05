# Phase 145: `/bs-build-chunk` — Audit & Repair with Design Review - Research

**Researched:** 2026-07-04
**Domain:** Markdown-authored Claude Code skill reference files (agentic orchestration prose), BoardSmith hidden-info testing API, dev-host browser affordances
**Confidence:** HIGH (state-machine/template contracts, testing APIs, dev-host source) / MEDIUM (dev-host theme-toggle mechanism — no existing UI affordance, must be scripted) / LOW (exact Claude-in-Chrome MCP tool names — not present anywhere in this repo)

## Summary

Phase 145 is a pure markdown-authoring phase: no runtime code ships, only three new reference files (`build/audit.md`, `build/repair.md`, `build/design-review.md`) plus edits to `build-chunk.md` (replace two forward-ref rows, register new files) and `build-chunk.test.ts` (new describe blocks + updated `REFERENCED_PATHS`/exclusion list). Every governing rule already exists verbatim in `state-machine.md` ("Repair Loop Bound", "Session Handoff Seams", "Rulings Outrank Rulebook") and `templates/CHUNK.template.md` ("Findings Ledger") — the new files must **cite**, not restate, exactly as `build/redteam.md` and `build/test.md` already do for their neighboring rules. The two-seat visibility-leak lens has a real, already-shipped API to cite: `diffPlayerViews()` in `src/testing/view-diff.ts` (VIS-02) and `assertNoHiddenInfoLeak()` in `src/testing/dom-leak.ts` (VIS-03) — both exported from `boardsmith/testing`. The design-review agent's mechanics (breakpoints, theme toggling, dev-host affordances, server-kill) are all groundable in source, with one gap: BoardSmith's dev-host has **no UI theme-toggle control** — theme switching must be done by directly setting `document.documentElement.dataset.theme` (or via `applyTheme(undefined, { scheme })`) through the browser tool's JS-injection capability, not a button click. The exact Claude-in-Chrome MCP tool names are **not verifiable from this repo** — no `.mcp.json`, no existing skill file, and no memory note names a specific `mcp__*` tool; the project's own established fallback (Playwright headless via scratchpad script, per `browser-testing-playwright-fallback` memory) is the only technique already proven in this codebase and should be cited as the fallback path, with the primary path described mechanism-first ("use whatever browser-automation tool is available this session") rather than a hardcoded tool name.

**Primary recommendation:** Author `build/audit.md`, `build/repair.md`, `build/design-review.md` as thin, citation-heavy reference files following the exact idiom of `build/redteam.md` (adversarial fresh-context dispatch discipline) and `build/test.md` + `ingest/scaffold.md` (server-lifecycle discipline for design-review.md specifically, since `scaffold.md`'s 3-step numbered serve-check-kill sequence is the closest server-kill analog in the codebase — closer than `test.md`, which never starts a server at all).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Audit dispatch orchestration (fresh subagents, ledger writes) | Orchestrator (build-chunk.md router) | — | Router dispatches subagents and records structured returns per the Context-Economics Hard Rule; never reads slices/code itself |
| Rulebook-fidelity / undo-sanity audit lenses | Subagent (Task-tool dispatch) | — | Fresh-context adversarial agent reads raw slices + RULINGS.md + code directly |
| Visibility/leak-diff audit lens | Subagent (Task-tool dispatch), using `boardsmith/testing` API | Generated game's test harness | The audit agent invokes/reads results from `diffPlayerViews`/`assertNoHiddenInfoLeak` against the generated game's `TestGame` instance — this is the one lens with a concrete library call, not code inspection alone |
| Design-review screenshot capture | Subagent (Task-tool dispatch) + dev-host process (generated game project) | Browser automation tool (session-provided) | The agent starts `npx boardsmith dev` in the generated game project, drives a browser tool against `localhost:5173`, and must kill the process itself before returning |
| Findings Ledger persistence | State file (CHUNK.md in generated game project) | — | Per `state-machine.md` Write Order / Cold-Resume Parse Contract — audit/repair write here, never restructure |
| Repair-loop bound enforcement (max 3 rounds) | Orchestrator (build-chunk.md router), citing `state-machine.md` | — | Same governance layer as Redteam Escalation — a routing/counting responsibility, not a subagent one |

## Standard Stack

### Core
This phase ships no new runtime dependencies. It authors markdown reference files and extends an existing Vitest test file. All APIs cited below already exist in this repo.

| Library/API | Version/Path | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `diffPlayerViews` | `src/testing/view-diff.ts` (exported via `boardsmith/testing`, VIS-02) | Two-seat visibility/leak diff — the exact API the audit's visibility lens must cite | [VERIFIED: read from source] Purpose-built for "verify hidden information stays hidden"; atomic `(testGame, seatA, seatB)` overload avoids the WR-02 footgun (diffing views captured at different game-state instants) |
| `assertNoHiddenInfoLeak` | `src/testing/dom-leak.ts` (VIS-03, exported via `boardsmith/testing`) | DOM-rendered leak assertion (checks rendered UI output, not just JSON view, for smuggled hidden values) | [VERIFIED: read from source] Complements `diffPlayerViews` — catches leaks introduced by UI code (e.g. a placeholder `aria-label` that echoes a hidden card's identity) that a pure JSON-view diff would miss |
| `isElementVisible` / `getVisibleElements` | `src/testing/visibility.ts` (VIS-01) | Per-element/per-seat visibility predicates | [VERIFIED: read from source] Lower-level primitives `diffPlayerViews` and `assertNoHiddenInfoLeak` are built on; cite only if the audit lens needs single-element checks rather than a full two-seat diff |
| `getPlayerView` | `src/runtime/runner.ts:473`, `src/testing/test-game.ts:483` | Produces the `PlayerStateView` (`game.toJSONForPlayer(seat)` post `playerView` hook) each seat's client actually receives | [VERIFIED: read from source] This is the "exact bytes a real client receives" — the ground truth the leak-diff lens operates on |
| Vitest | `^2.1.0` (package.json) | Test runner for `build-chunk.test.ts` drift pins | [VERIFIED: package.json] Already the project's sole test framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `npx boardsmith dev --no-open` | in-repo CLI (`src/cli/commands/dev.ts`) | Starts the dev-host multiplayer server the design-review agent screenshots against | Always for design-review's server start — `--no-open` is required for any non-interactive/scripted drive (confirmed by both `ingest/scaffold.md`'s serve-check and the `browser-testing-playwright-fallback` memory note: without it, "the machine's real browser auto-opens and steals seat 1") |
| Playwright (headless chromium) | already a project pattern, not yet a package.json devDependency confirmed here | Fallback browser driver when the Claude-in-Chrome extension is unavailable | Per project memory `browser-testing-playwright-fallback`: never punt to manual verification: "do NOT fall back to asking the user to verify manually — drive the check with Playwright... via a scratchpad script instead" |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `diffPlayerViews`'s atomic `(testGame, seatA, seatB)` overload | The two-argument `(viewA, viewB)` overload, capturing views manually | Manual capture reintroduces the WR-02 footgun (positional diff misreports ordinary state progression as spurious leaks if the two views were captured at different instants) — audit.md should cite the atomic overload only |
| Claude-in-Chrome browser tool (name unverified) | Playwright headless via scratchpad script | Playwright is the only technique with a proven, cited precedent in this codebase; the Chrome extension path is faster interactively but its exact tool surface is not documented anywhere the researcher could verify |

**Installation:** None — no new packages this phase.

**Version verification:** Not applicable; no new packages.

## Package Legitimacy Audit

**Not applicable.** Phase 145 installs no external packages — it authors three markdown reference files and extends one existing test file (`build-chunk.test.ts`), reusing `boardsmith/testing` APIs (`diffPlayerViews`, `assertNoHiddenInfoLeak`) that already ship in this repo. The Package Legitimacy Gate protocol is skipped for this phase.

## Architecture Patterns

### System Architecture Diagram

```
build-chunk.md (orchestrator/router)
   │  Step 3 dispatch table: audit → build/audit.md, repair → build/repair.md
   │  Session group 3: {audit, repair}  (state-machine.md "Session Handoff Seams")
   │
   ├─► build/audit.md ── dispatches N fresh-context Task-tool subagents
   │        │              (fidelity lens, leak-diff lens, undo-sanity lens,
   │        │               + design-review.md for ui:touches|major chunks)
   │        │
   │        ├─ fidelity/undo agents: read raw slices + RULINGS.md + code
   │        │       (NEVER the ## Interpretation — see Rulings Outrank Rulebook)
   │        │
   │        ├─ leak-diff agent: reads code, then runs/inspects
   │        │       diffPlayerViews(testGame, seatA, seatB)  [src/testing/view-diff.ts]
   │        │       and/or assertNoHiddenInfoLeak(...)       [src/testing/dom-leak.ts]
   │        │       against the generated game's TestGame instance
   │        │
   │        └─ design-review agent (ui chunks only, see design-review.md below)
   │
   │  ◄── each subagent returns structured findings (stable-ID candidates)
   │
   │  orchestrator appends "### Audit Round N" to CHUNK.md's ## Findings Ledger
   │  (state file write BEFORE repair starts — state-machine.md "Write Order")
   │
   └─► build/repair.md ── fix findings OR refute-with-citation (ledger entry,
            │               never a code change) ── loop back to audit
            │               UNLESS: round count == 3 (state-machine.md
            │               "Repair Loop Bound") → triage remaining findings
            │               with the user (plain-language: real blocker /
            │               defer to later chunk / auditor wrong)
            └─► on clear: chunk moves to {playtest, revise, close} group (Phase 146)

design-review.md (dispatched BY audit for ui:touches|major chunks only):
   1. cd into generated game project; `npx boardsmith dev --no-open` (background)
   2. wait for "Ready! Press Ctrl+C to stop." (dev.ts's exact ready line)
        — NOT networkidle (SPA never reaches it — CLAUDE.md rule)
   3. browser tool → dev-host URL → claim/follow a seat
   4. for each of 3 breakpoints × 2 themes (6 shots):
        - resize iframe element width (compact via iframe-shrink + reload,
          medium/wide via real viewport width) — see BREAKPOINTS below
        - toggle data-theme via document.documentElement (no UI button exists)
        - screenshot; save to chunks/<slug>/shots/
   5. diff against previous chunk's stored shots (cohesion drift)
   6. review against DESIGN.md tokens + frontend-design craft criteria
   7. findings → same Findings Ledger (audit's, via the orchestrator)
   8. KILL the dev server process (explicit step, same discipline as
      ingest/scaffold.md's numbered kill step) BEFORE returning
```

### Recommended Project Structure
```
src/cli/slash-command/bs/build/
├── audit.md            # NEW — dispatch discipline for 3 audit lenses + ledger write
├── repair.md            # NEW — fix-or-refute loop, round-bound enforcement, user triage
└── design-review.md     # NEW — UI-chunk screenshot agent (dispatched from audit.md)
```
(Generated game project, per chunk, at runtime — not part of this phase's file changes:)
```
<game-project>/chunks/<slug>/
└── shots/                # screenshot storage per DESIGN & PLAN decisions
    ├── compact-light.png
    ├── compact-dark.png
    ├── medium-light.png
    ├── medium-dark.png
    ├── wide-light.png
    └── wide-dark.png
```

### Pattern 1: Fresh-Context Adversarial Dispatch (copy from `build/redteam.md`)
**What:** Each audit lens is a SEPARATE Task-tool dispatch with a prompt containing ONLY raw slice paths / code paths + RULINGS.md — never the orchestrator's conversation, never a peer lens's findings, never the investigator's or builder's framing/rationale.
**When to use:** All three audit lenses (fidelity, leak-diff, undo) and the design-review agent.
**Example:**
```
// Source: src/cli/slash-command/bs/build/redteam.md, "Independence: Fresh-Context, No-Framing Dispatch"
Each of the 3 agents is a SEPARATE Task-tool dispatch. The dispatch prompt for every agent
contains ONLY the raw slice path(s) and the numbered claims list text ... never the
orchestrator's running conversation, never the investigate subagent's own prompt or rationale,
and never a peer agent's verdict.
```
Apply the same shape to audit: dispatch prompt = raw slice paths + RULINGS.md path + code file paths (never `## Interpretation`).

### Pattern 2: Stable-ID Findings Ledger (cite, don't restate — `templates/CHUNK.template.md`)
**What:** Each finding gets a stable ID (F1, F2, ...) that never changes or is reused; round N+1 auditors read the existing ledger and report ONLY NEW findings.
**When to use:** Every audit round writes here; repair writes disposition (`fixed | deferred | refuted`) against existing IDs, never restructures the section.
**Example:**
```markdown
<!-- Source: src/cli/slash-command/bs/templates/CHUNK.template.md, "## Findings Ledger" -->
### Audit Round 1
- F1: <!-- finding --> — disposition: <!-- fixed | deferred | refuted -->
```

### Pattern 3: Numbered Server-Lifecycle Sequence (copy from `ingest/scaffold.md`, NOT `test.md`)
**What:** Start server → confirm ready-state → **explicit numbered kill step in the same sequence** (never a footnote). `test.md` is not the right analog here because it never starts a server; `ingest/scaffold.md`'s 3-step numbered sequence (compile → serve-check → kill) is the actual server-kill precedent in this codebase.
**When to use:** `design-review.md`'s dev-host lifecycle.
**Example:**
```
// Source: src/cli/slash-command/bs/ingest/scaffold.md, step 2-3
2. Serve-check: npx boardsmith dev --no-open ; wait for "Ready! Press Ctrl+C to stop."
   (curl the resolved URL as an additional confirmation)
3. Kill the process — explicit, numbered, in the SAME sequence, never a footnote.
   Leaving a dev server running after the check is a repo-wide hard rule violation
   (CLAUDE.md: "Don't leave a dev server running that you start.")
```

### Pattern 4: Two-Seat Leak Diff (real API, cite exact names)
**What:** `diffPlayerViews(testGame, seatA, seatB)` — atomic overload, avoids WR-02 (positional-diff-across-different-instants footgun).
**When to use:** The audit's visibility/leak lens, for any chunk with hidden information (per the Visibility Declaration in `## Visibility Declaration`).
**Example:**
```typescript
// Source: src/testing/view-diff.ts (VIS-02)
import { diffPlayerViews } from 'boardsmith/testing';

const result = diffPlayerViews(testGame, 1, 2);
console.log(result.describe());
expect(result.onlyInA).not.toContain('opponent-hand-card'); // opponent's card never leaks
```
Complement with `assertNoHiddenInfoLeak` (`src/testing/dom-leak.ts`, VIS-03) when the leak concern is UI-rendered (e.g. a placeholder's `aria-label` echoing hidden identity), since `diffPlayerViews` operates on the JSON view, not rendered DOM.

### Anti-Patterns to Avoid
- **Audit agents reading `## Interpretation`:** Defeats the entire lens — interpretation errors from `investigate`/`redteam` become invisible to audit too. `state-machine.md` "Rulings Outrank Rulebook" + the phase CONTEXT's explicit rule: audit reads raw slices + RULINGS.md + code, never the interpretation.
- **Restructuring the Findings Ledger:** `CHUNK.template.md`'s parse contract requires `## Findings Ledger` to remain exactly that heading; audit/repair fill it, never invent a new section or rename it.
- **`networkidle` wait on the dev-host:** Per user's global CLAUDE.md, the dev host holds an open WS connection and never reaches network-idle; `design-review.md` must instruct waiting on the `dev.ts` ready-state line + `domcontentloaded`/a specific selector, never `networkidle`.
- **Assuming a theme-toggle button exists:** It does not (see Common Pitfalls below) — scripting `document.documentElement` directly is required.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Two-seat hidden-info leak detection | A custom JSON-diff script per game/chunk | `diffPlayerViews()` (`boardsmith/testing`, VIS-02) | Already handles the id-anonymization asymmetry (zone-hidden children get fresh synthetic negative ids per call; individually-hidden elements keep stable ids) — a naive id-based diff would misreport both cases |
| DOM-rendered leak detection | Manual grep of rendered HTML for suspicious strings | `assertNoHiddenInfoLeak()` (`boardsmith/testing`, VIS-03) | Already derives forbidden-value markers from the game's actual hidden state and scans the rendered surface with an allowlist predicate for legitimate matches |
| Random-simulation regression proof | A hand-rolled random-play loop | `simulateRandomGames` (`boardsmith/testing`, already used by `test.md` step 5) | Not new to this phase, but audit's undo-sanity lens should reuse the same accumulated-suite infrastructure rather than inventing a parallel one |

**Key insight:** BoardSmith's hidden-info testing surface (`visibility.ts`, `view-diff.ts`, `dom-leak.ts`) was purpose-built across v4.3/v4.4 specifically so skills like this audit step never need to hand-roll leak detection — citing the real function names is both more correct and cheaper to author than describing the check in prose.

## Common Pitfalls

### Pitfall 1: Assuming a dev-host theme-toggle UI control exists
**What goes wrong:** design-review.md instructs the agent to "click the theme toggle," but no such control exists anywhere in `DevHost.vue`, `GameShell.vue`, or `DebugPanel.vue` — grepped and confirmed absent (`theme-toggle`, `ThemeToggle`, `toggleTheme` all return zero matches outside `theme.ts`/`theme.test.ts` themselves).
**Why it happens:** `applyTheme(overrides, { scheme })` exists and is host-callable, but nothing in the dev-host chrome wires a button to it — GameShell/DevHost each call `applyTheme()` once at mount with no scheme argument (uses system `prefers-color-scheme` via CSS, since `data-theme` is only set explicitly when overridden).
**How to avoid:** design-review.md must instruct the agent to set the theme via direct script injection against the browser tool — either `document.documentElement.setAttribute('data-theme', 'light'|'dark')` on the dev-host's own document, or (if the theme must be forced inside the GameShell iframe specifically) reach into the iframe's `contentDocument`. Confirm which document actually needs the attribute by checking whether Slate tokens are scoped to `:root` in the iframe's own stylesheet (they are — `theme.ts`'s `themeCSS` is injected per-document by `applyTheme()`, and DevHost.vue's comment confirms "the game runs in a platform-mode iframe that calls applyTheme itself" — so the iframe's own document, not the outer dev-host page, needs the `data-theme` attribute for the board's own tokens to react).
**Warning signs:** Screenshots for "dark" and "light" look identical — the injected attribute landed on the wrong document (outer page vs iframe).

### Pitfall 2: ResizeObserver/`window.resize` silently not firing on programmatic iframe resize
**What goes wrong:** design-review.md resizes `iframe.style.width` for the compact breakpoint, but any board using `useBoardSize()` (content-flow custom boards) never remeasures, so the compact screenshot is actually still the wide layout.
**Why it happens:** Confirmed by project memory (`custom-ui-responsive-sizing`): "ResizeObserver and `window.resize` do NOT fire inside an iframe when its width is changed programmatically from the parent... They DO fire on real viewport resizes."
**How to avoid:** After setting `iframe.style.width`, reload the iframe (`iframe.contentWindow.location.reload()`) so the board remeasures at mount — this is the exact fix the memory note prescribes, and design-review.md should cite it verbatim as an instruction, not leave it implicit.
**Warning signs:** The "compact" screenshot shows a board that overflows or doesn't match the expected mobile layout.

### Pitfall 3: Waiting on `networkidle` for the dev-host page
**What goes wrong:** A `networkidle`/"done loading" wait hangs forever because the dev-host holds an open WebSocket for real-time multiplayer sync.
**Why it happens:** Per the user's global CLAUDE.md rule: "Real-time SPAs... NEVER reach 'network idle.'"
**How to avoid:** design-review.md must explicitly instruct waiting on `domcontentloaded`, the `load` event, or a specific selector (e.g. the seat-picker or board root appearing) — never idle.
**Warning signs:** The browser-automation call times out with no error, and the page is actually already fully rendered (verify via `curl` against SSR content or a screenshot taken manually, per the same CLAUDE.md guidance).

### Pitfall 4: Auto-opened browser stealing seat 1 in scripted/headless drives
**What goes wrong:** `npx boardsmith dev` (without `--no-open`) auto-launches the machine's real browser, which claims seat 1 before the design-review agent's own browser tool connects — the agent then can't take seat 1 and the seat-picker behaves unexpectedly.
**Why it happens:** Confirmed bug/fix in project memory (`browser-testing-playwright-fallback`): "found+fixed in v4.5 Phase 138, commit 7cafb566" — `--no-open` suppresses the auto-launch.
**How to avoid:** Always start the dev-host with `npx boardsmith dev --no-open` for any scripted/agent-driven session, per `ingest/scaffold.md`'s own serve-check precedent.
**Warning signs:** The design-review agent connects but lands in the seat-picker instead of directly in the game, or sees "seat 1 taken" unexpectedly.

### Pitfall 5: Citing an unverifiable MCP tool name as if it were fact
**What goes wrong:** design-review.md hardcodes a specific `mcp__claude-in-chrome__*` tool name that doesn't actually exist in whatever environment executes the skill, causing a hard failure with no fallback.
**Why it happens:** No `.mcp.json`, no prior `bs-` skill file, and no project memory names an exact tool — the "Claude-in-Chrome" reference in the phase's `<additional_context>` and the user's global CLAUDE.md is a description of a capability ("I have the claude code chrome extension enabled"), not a verified tool-name string.
**How to avoid:** Write design-review.md's screenshot mechanism description mechanism-first ("drive the connected browser-automation tooling this session provides — navigate, resize, capture") with the Playwright-headless-via-scratchpad-script path named as the **explicit, proven fallback** (cite `browser-testing-playwright-fallback` memory's technique: launch chromium, `page.goto(':5173')`, `page.frames()` to reach the GameShell iframe), rather than asserting a single MCP tool name as the only path.
**Warning signs:** The plan or a later drift test asserts a literal `mcp__` string that breaks the moment the tool surface changes.

## Code Examples

### Atomic two-seat leak diff (audit's visibility lens)
```typescript
// Source: src/testing/view-diff.ts (VIS-02) — the atomic overload avoids WR-02
import { diffPlayerViews } from 'boardsmith/testing';

const result = diffPlayerViews(testGame, seatA, seatB);
// result.onlyInA / result.onlyInB: readable paths visible to exactly one seat
// result.attributeDiffs: attribute-level differences for elements BOTH seats see
// result.describe(): human-readable multi-line summary
```

### Random-simulation invocation (undo-sanity / regression cross-check, already in test.md)
```typescript
// Source: src/cli/slash-command/bs/build/test.md, step 5 (reuse, don't reinvent)
import { simulateRandomGames } from 'boardsmith/testing';

const results = await simulateRandomGames(MyGame, {
  count: 50,
  playerCounts: [2, 3, 4],
});
expect(results.crashed).toBe(0);
expect(results.stuck).toBe(0);
```

### Server serve-check + explicit kill (design-review's lifecycle, copy scaffold.md's shape)
```bash
# Source: src/cli/slash-command/bs/ingest/scaffold.md, steps 2-3
npx boardsmith dev --no-open
# wait for: "Ready! Press Ctrl+C to stop."   (src/cli/commands/dev.ts, drift-test-pinned string)
# curl the resolved URL as additional confirmation
# ... drive the browser tool, capture screenshots ...
kill %1   # or the captured PID — explicit numbered step, never a footnote
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| No adversarial post-build check on rules/visibility/undo | `audit`/`repair` step group (BUILD-07/08) | This phase (145) | First point in the pipeline where a lifecycle agent can fail a chunk for a rules-fidelity or hidden-info leak defect that `test.md`'s automated suite can't catch (leaks aren't type errors) |
| No UI-quality gate beyond the a11y floor (`UIQ-03`, mechanical) | Screenshot-armed design-review agent (UIQ-04) | This phase (145) | First point where bad *visual/cohesion* design (not just a11y mechanics) can fail a chunk — per the plan: "without this, no agent in the lifecycle can fail a chunk for bad UI" |

**Deprecated/outdated:** None — this is net-new pipeline surface, not a replacement of an existing mechanism.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact Claude-in-Chrome MCP tool name(s) the skill should reference | Common Pitfalls #5, Summary | If a specific tool name is hardcoded and wrong, design-review.md fails hard the first time it's actually run (deferred to Phase 149 behavioral proof, so low near-term risk, but the planner should keep the description mechanism-first) |
| A2 | Whether `data-theme` must be set on the dev-host's outer document or the GameShell iframe's own document to actually change the rendered board's tokens | Pitfall 1 | If set on the wrong document, "light" and "dark" screenshots would be visually identical — a design-review agent might silently produce useless duplicate shots without erroring |
| A3 | Screenshot storage path `chunks/<slug>/shots/` — confirmed as a CONTEXT.md decision, not independently re-derived from source (no existing code creates this path yet) | Recommended Project Structure | Low risk — this is a locked decision from CONTEXT.md, not something research needs to re-verify; flagged only because no prior phase's code creates or reads this directory yet |

## Open Questions

1. **Does the design-review agent run against the generated game project's own `chunks/<slug>/`, or does BoardSmith's own dev-host need any change to support it?**
   - What we know: `npx boardsmith dev` already works fully (confirmed via `ingest/scaffold.md`'s serve-check and CLAUDE.md's own `cd ~/BoardSmithGames/go-fish && npx boardsmith dev` example) — no BoardSmith library change is needed for this phase.
   - What's unclear: whether the `chunks/<slug>/shots/` directory needs to be gitignored or is expected to be committed (screenshots as binary diffs in a designer's game repo).
   - Recommendation: Planner should make an explicit decision (likely: committed, since they're the audit's evidence trail and the cohesion-diff source for the *next* chunk) rather than leaving it implicit in design-review.md.

2. **What exact return-shape field names should the audit subagents use?**
   - What we know: CONTEXT.md explicitly marks "exact subagent return-shape field names" as Claude's Discretion.
   - What's unclear: nothing blocking — this is deliberately open per the locked decisions.
   - Recommendation: Follow the `redteam.md` precedent shape (`claimNumber`, `verdict`, `objection` / `missingInteractions`) — i.e. `findingId` (or let the orchestrator assign the stable ID), `lens`, `description`, `citation`/`codeLocation`, `severity` (if used). Keep field names as flat and grep-able as redteam's.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `npx boardsmith dev`, Vitest | ✓ | v22.21.1 | — |
| npm | package scripts | ✓ | 10.9.4 | — |
| Vitest | `build-chunk.test.ts` drift pins | ✓ | ^2.1.0 (package.json) | — |
| Claude-in-Chrome browser tool | design-review.md's screenshot capture | Unknown (session-dependent; not verifiable from this repo) | — | Playwright headless chromium via scratchpad script (proven project pattern, `browser-testing-playwright-fallback` memory) |
| `boardsmith/testing` exports (`diffPlayerViews`, `assertNoHiddenInfoLeak`, `simulateRandomGames`) | audit's leak-diff lens, undo-sanity lens | ✓ (in-repo source, already exported per `src/testing/index.ts`) | current HEAD | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Claude-in-Chrome browser tool — Playwright headless fallback is already an established, cited project pattern; design-review.md should name both paths rather than assuming the extension is always connected.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 |
| Config file | root `vitest.config.ts` (project-wide; no phase-specific config) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` |
| Full suite command | `npm run test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUILD-07 | `build-chunk.md`'s Step 3 dispatch table names `build/audit.md` as a live dispatch (not "authored in Phase 145"); `audit.md` names 3 lenses, cites `state-machine.md` "Rulings Outrank Rulebook", cites `diffPlayerViews`/`assertNoHiddenInfoLeak` by exact name | drift/content pin | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-07"` | ❌ Wave 0 — new describe block needed |
| BUILD-08 | `repair.md` cites "Repair Loop Bound" (max 3 rounds, only-new-findings, refute-with-citation) byte-consistent with `state-machine.md`; `CHUNK.template.md`'s `## Findings Ledger` heading unchanged | drift/content pin | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-08"` | ❌ Wave 0 |
| UIQ-04 | `design-review.md` names the 3×2 breakpoint/theme grid, the `chunks/<slug>/shots/` path, and an explicit server-kill instruction | drift/content pin | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-04"` | ❌ Wave 0 |
| (cross-file) | `REFERENCED_PATHS` in `build-chunk.test.ts` now includes `build/audit.md`, `build/repair.md`, `build/design-review.md`; the existing "does NOT include" exclusion-list test must drop `build/audit.md`/`build/repair.md` from its excluded set (they now exist) while still excluding `build/playtest.md`/`build/revise.md`/`build/close.md` (Phase 146) | drift/content pin | same file | ❌ Wave 0 |
| (cross-file) | `build-chunk.md`'s forward-reference markers: the "authored in Phase 145" marker must be removed for the `audit`/`repair` rows (now live dispatches) while "authored in Phase 146" remains for `playtest`/`revise`/`close` | drift/content pin | same file | ❌ Wave 0 |

Behavioral proof (an actual audit/repair/design-review run against a real chunk) is explicitly deferred to Phase 149 (VAL-01) per this phase's CONTEXT.md — Phase 145's tests are structural/content pins only, mirroring the existing pattern for `build/test.md` (BUILD-06) in the current `build-chunk.test.ts`.

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts`
- **Per wave merge:** `npm run test` (full suite — confirms no other `bs/` skill test regressed)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New `describe('BUILD-07 — audit', ...)`, `describe('BUILD-08 — repair', ...)`, `describe('UIQ-04 — design-review', ...)` blocks in `build-chunk.test.ts` — no existing test covers these three requirements yet (confirmed: grep of the file shows describe blocks only through BUILD-06/UIQ-03).
- [ ] Update to `REFERENCED_PATHS` (add the 3 new paths) and to the "REFERENCED_PATHS does NOT include" exclusion test (remove `build/audit.md`, `build/repair.md` from the excluded list, keep the Phase-146 three).
- [ ] Update to `FORWARD_REFERENCE_MARKERS`-adjacent test ("carries the three forward-reference markers") — this must become a two-marker or a distinguished-by-step assertion once `audit`/`repair` rows in `build-chunk.md` no longer carry "authored in Phase 145" (only `playtest`/`revise`/`close` still carry "authored in Phase 146").

*(No test framework install needed — Vitest is already wired.)*

## Security Domain

Not applicable in the ASVS sense — this phase authors orchestration prose and test-file content, not application code handling user input, auth, or crypto. The one security-adjacent concern already exists and is unchanged by this phase: `theme.ts`'s `applyTheme()` restricts host-supplied overrides to the `--bsg-*` key pattern (`BSG_KEY_RE`) to prevent CSS injection via `postMessage` — design-review.md's direct `data-theme` manipulation for screenshot purposes is a same-origin dev-tooling action, not a new attack surface, and should not be conflated with that control.

## Sources

### Primary (HIGH confidence)
- `src/cli/slash-command/bs/state-machine.md` — Repair Loop Bound, Session Handoff Seams, Rulings Outrank Rulebook, Write Order, Cold-Resume Parse Contract (read directly)
- `src/cli/slash-command/bs/templates/CHUNK.template.md` — Findings Ledger parse contract, stable-ID/round convention (read directly)
- `src/cli/slash-command/bs/build/redteam.md` — fresh-context adversarial dispatch idiom, escalation/vote-privacy pattern (read directly, closest audit analog)
- `src/cli/slash-command/bs/build/test.md` — ordered-sequence/stop-on-failure idiom, `simulateRandomGames` real API shape (read directly)
- `src/cli/slash-command/bs/ingest/scaffold.md` — the actual server serve-check + explicit numbered kill precedent (read directly; closer analog than test.md for design-review's lifecycle)
- `src/cli/slash-command/bs/build-chunk.md` — Step 3 dispatch table, forward-ref markers, Reference Files list (read directly)
- `src/cli/slash-command/bs/build-chunk.test.ts` — REFERENCED_PATHS/FORWARD_REFERENCE_MARKERS drift-pin pattern (read directly)
- `src/testing/view-diff.ts` — `diffPlayerViews` full implementation and JSDoc, VIS-02 (read directly)
- `src/testing/dom-leak.ts` — `assertNoHiddenInfoLeak`, VIS-03 (read directly, signature-level)
- `src/testing/visibility.ts` — `isElementVisible`/`getVisibleElements`, VIS-01 (read directly, signature-level)
- `src/ui/theme.ts` — `BREAKPOINTS` constant (compact:640, medium:1024, wide:1440), `applyTheme()` implementation, `data-theme` mechanism (read directly)
- `src/cli/dev-host/DevHost.vue` — confirmed no theme-toggle UI control; `applyTheme()` called once at mount on the outer page; the game iframe calls `applyTheme()` itself (read directly)
- `.planning/bs-skills-plan.md` — §build-chunk steps 6-7, §UI design-review agent, §Hard Rules (read directly)
- `.planning/REQUIREMENTS.md` — BUILD-07, BUILD-08, UIQ-04 exact wording (read directly)
- `.planning/phases/145-bs-build-chunk-audit-repair-design-review/145-CONTEXT.md` — locked decisions (read directly)

### Secondary (MEDIUM confidence)
- `~/.claude/projects/-Users-jtsmith-BoardSmith/memory/browser-testing-playwright-fallback.md` — Playwright fallback technique, `--no-open` requirement, seat-1-steal bug (project memory, cross-referenced against `ingest/scaffold.md`'s independent `--no-open` citation — two sources agree)
- `~/.claude/projects/-Users-jtsmith-BoardSmith/memory/custom-ui-responsive-sizing.md` — iframe programmatic-resize ResizeObserver gap and the reload-to-remeasure fix (project memory; internally consistent with `useBoardSize()` source comments)

### Tertiary (LOW confidence)
- Exact Claude-in-Chrome MCP tool name(s) — no source in this repo names them; flagged as Assumption A1 and Open Question territory, not asserted as fact anywhere in this document

## Metadata

**Confidence breakdown:**
- Standard stack / APIs (diffPlayerViews, assertNoHiddenInfoLeak, simulateRandomGames): HIGH — read directly from source, already exported and used elsewhere in the codebase
- Architecture / governing rules (Repair Loop Bound, Findings Ledger, session handoff seams): HIGH — verbatim from state-machine.md and CHUNK.template.md, the exact citation targets the new files must point to
- Design-review mechanics (breakpoints, server lifecycle, iframe-shrink): MEDIUM-HIGH — breakpoints and server lifecycle are HIGH (read from theme.ts/dev.ts/scaffold.md); theme-toggle mechanism is MEDIUM (inferred from absence of a UI control + applyTheme's API, not observed running)
- Browser-tool naming: LOW — flagged explicitly, not asserted as fact

**Research date:** 2026-07-04
**Valid until:** 30 days (stable internal APIs; re-check if `src/testing/` or `src/ui/theme.ts` change before Phase 145 executes)
