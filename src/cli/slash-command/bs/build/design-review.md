# Design Review — Screenshot-Armed Adversarial UI Audit (UIQ-04)

Referenced by `build/audit.md`'s "Three Lenses" section as a 4th lens, dispatched only for
chunks whose `## ui:` tag is `touches` or `major` (`state-machine.md` "Session Handoff Seams" —
this step lives inside the `{audit, repair}` session group, it is not a top-level dispatch-table
entry of its own). `build/test.md`'s a11y floor already proves the UI is operable
(keyboard-only completion, axe-core, aria-labels); none of that catches whether the UI actually
*looks right* — matches `DESIGN.md`'s token contract, stays visually cohesive with the chunks
built before it, and holds up across breakpoints and themes. `design-review` is the first point
in the pipeline where a lifecycle agent can fail a chunk for exactly that class of defect.

## Single Fresh-Context Adversarial Dispatch

Same independence discipline as `build/redteam.md`'s "Independence: Fresh-Context, No-Framing
Dispatch", scaled to one dispatch instead of three: this is a SEPARATE Task-tool dispatch with
no inherited conversation — never the orchestrator's running conversation, never
`build/investigate.md`'s or `build/ask.md`'s framing, and never CHUNK.md's `## Interpretation`.
The agent reads `DESIGN.md` and the chunk's own built code fresh, takes its own screenshots, and
returns findings independently. Its findings land in the SAME `## Findings Ledger`
(`templates/CHUNK.template.md`) the fidelity/visibility/undo lenses write to — through the
orchestrator, never a separate track. This is the same repair loop `build/repair.md` already
governs; a design-review finding is fixed or refuted exactly like any other Findings Ledger
entry, bounded by the same `state-machine.md` "Repair Loop Bound".

## Dev-Host Lifecycle: Serve → Capture → Kill

Copy the exact numbered serve-check-kill sequence `ingest/scaffold.md`'s "Verification
Sequence" steps 2-3 establish (NOT `build/test.md`, which never starts a server) — a single
sequence, never split across steps, never a footnote:

1. **Serve** — `cd` into the generated game project and start the dev host in non-interactive
   mode:

   ```bash
   npx boardsmith dev --no-open
   ```

   `--no-open` is required, not optional: without it the machine's real browser steals seat 1
   (the same footgun `scaffold.md` documents), which would silently hand this design-review
   session's screenshots the wrong seat's view.

2. **Wait for ready, never `networkidle`** — wait for the exact ready-state line
   `Ready! Press Ctrl+C to stop.` and/or a specific board/seat selector before driving the
   browser. Explicitly wait on `domcontentloaded`, the `load` event, or a selector — **never**
   `networkidle`. The dev host holds an open WebSocket connection for real-time play and never
   reaches network idle; a `networkidle` wait on this page hangs forever and is not evidence the
   page failed to render.

3. **Capture** — run the breakpoint × theme capture loop (below).

4. **Kill** — an explicit, numbered step in this SAME sequence, never a footnote left for later:
   kill the dev server process started in step 1 before this agent returns. Leaving a dev server
   running is a repo-wide hard rule violation (`CLAUDE.md`: "Don't leave a dev server running
   that you start.") and independently required here: this agent must never return with the
   server still up.

## Capture Loop: 3 Breakpoints × 2 Themes = 6 Screenshots

Cite `src/ui/theme.ts`'s `BREAKPOINTS` constant by exact name and value — do not re-derive or
guess these numbers:

- `compact: 640`
- `medium: 1024`
- `wide: 1440`

**These are tier boundaries, NOT capture widths.** `theme.ts:18` defines the tiers as
`compact ≤639px · medium 640–1023px · wide ≥1024px`. `BREAKPOINTS.compact` (640) and
`BREAKPOINTS.medium` (1024) are the *ceilings of the tier below* (640 = phone ceiling → at/above
it is medium; 1024 = tablet ceiling → at/above it is wide), and `BREAKPOINTS.wide` (1440) is the
wide-tier max-width cap, not a tier boundary at all. So driving `iframe.style.width` to a raw
`BREAKPOINTS` value renders the tier *above* the one you meant to capture (640 → medium, 1024 →
wide) — the compact/phone tier would never actually be screenshotted and a broken phone layout
would pass review unseen. Capture at a representative width that falls clearly *inside* each
tier, and label each file by the tier NAME that actually renders at that width:

| Tier (name) | Tier range (theme.ts:18) | Capture width | Why this width lands in-tier |
| --- | --- | --- | --- |
| `compact` | ≤639px | **375** | below `BREAKPOINTS.compact` (640) — real phone layout |
| `medium`  | 640–1023px | **800** | between `BREAKPOINTS.compact` (640) and `BREAKPOINTS.medium` (1024) — tablet layout |
| `wide`    | ≥1024px | **1440** | ≥ `BREAKPOINTS.medium` (1024); equals `BREAKPOINTS.wide` (1440), also exercising the max-width cap |

For each of the 3 tiers, capture both themes (light and dark), for 6 screenshots total. Save
each into `chunks/<slug>/shots/` with filenames labelled by tier NAME — `compact-light.png`
through `wide-dark.png` — so the filename matches the tier that actually rendered at its capture
width, never the raw `BREAKPOINTS` number. The shots directory is committed — it is both the
evidence trail for this round's review and the cohesion-diff source for the *next* UI chunk's
design-review pass.

**Theme injection — no toggle UI exists.** There is no button to click. Set the theme by
injecting `document.documentElement.dataset.theme` (or the GameShell iframe's own
`contentDocument`, since the iframe renders in platform mode — see the CLI's own dev-host
framing), not by clicking anything.

**Iframe-resize caveat.** After setting `iframe.style.width` to a tier's capture width (e.g.
`375` for compact), call `iframe.contentWindow.location.reload()` so the board remeasures.
`ResizeObserver` does not fire on a programmatic iframe resize — skipping the reload captures a
stale, un-remeasured layout that looks wrong for reasons that have nothing to do with the
chunk's actual code.

**Screenshot mechanism — mechanism-first, never a hardcoded tool name.** Drive whatever
browser-automation tooling this session provides: navigate to the dev host URL, resize/inject as
above, and capture. Do not hardcode a single `mcp__`-prefixed tool name in this file — the exact
Claude-in-Chrome MCP tool names are not stable across sessions. The proven fallback, if no
browser tool is otherwise available: Playwright headless (project memory
`browser-testing-playwright-fallback`) — launch Chromium, `page.goto()` the dev host's
`:5173` URL, use `page.frames()` to reach the GameShell iframe, then screenshot each of the 6
combinations from there.

## Review Against DESIGN.md and Cohesion Drift

Two review passes, both performed fresh (never from `## Interpretation`):

1. **Token/craft review** — read `DESIGN.md`'s `## Theme Block`, `## Component Recipes`, and
   `## Do / Don't` sections and check the 6 screenshots against them: no color literal outside
   the Theme Block, component recipes followed, Do/Don't items honored.
2. **Cohesion diff** — diff the 6 fresh shots against the previous chunk's stored shots in its
   own `chunks/<slug>/shots/` directory (a different `<slug>`, the most recently verified UI
   chunk) for visual drift: does this chunk's UI still look like it belongs to the same game as
   the last one, or has something silently drifted (spacing, type scale, accent color) without a
   corresponding `DESIGN.md` edit? A drift with no `DESIGN.md` edit backing it is itself a
   finding — `DESIGN.md`'s own header note states any re-styling edit to that file is itself a
   chunk (the Restyle/Cutover Rule), so silent drift with no such edit is a defect, not a style
   choice.

## Findings Destination

Every finding this agent surfaces — token violation, craft defect, or unexplained cohesion drift
— is appended to CHUNK.md's `## Findings Ledger` (`templates/CHUNK.template.md`) by the
orchestrator, using the same stable-ID (`F1`, `F2`, ...) and disposition (`fixed` / `deferred` /
`refuted`) shape the fidelity/visibility/undo lenses already use. This is not a separate ledger
and not a separate repair track — `build/repair.md`'s fix-or-refute-with-citation loop and
round-bound enforcement apply identically to a design-review finding.
