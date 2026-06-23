# Phase 98: Token Foundation (Wave 1) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-accept from spec (v4.0 autonomous run; values pinned from `planning/mockups/boardsmith-chrome.html`)

<domain>
## Phase Boundary

The keystone. Build the single `--bsg-*` token contract emitted by `theme.ts` as the sole source of truth for color, spacing, type, radius, shadow, and motion — defaulting to the neutral **Slate** palette, following OS light/dark, host-overridable via `applyTheme()`, and guarded by a `color-no-hex` lint. Requirements: TOKEN-01..06.

**Critical framing (why this phase is safe in isolation):** today `var(--bsg-*)` has **zero consumers** in `src/ui` — the `theme.ts` token system is dead code. The chrome and renderers hardcode their own neon literals. Therefore **repointing `theme.ts` defaults changes nothing visible** — the neon look persists because nothing reads the tokens yet. The broad neon→token *sweep* is **Phase 99**, not this phase.

**This phase sets up; Phase 99 spends.** Do NOT do the renderer/chrome neon-literal sweep here. The only consumer-side edits allowed in 98 are the mechanical **namespace renames** required by TOKEN-01 (see Decisions).

**The "invisible-text trap" is a Phase 99 concern, not 98** — it only triggers when a component's background flips to `var(--bsg-bg)` while its text is still `#fff` (or vice-versa, especially in light mode). 98 leaves consumers alone, so the trap cannot fire here. 98's CONTEXT records this so the Phase 99 plan inherits the constraint: in 99, sweep each component's background **and** text together, and test both light and dark.

</domain>

<decisions>
## Implementation Decisions

### Token namespace (TOKEN-01)
- One namespace: `--bsg-*`. After this phase, grepping `src/ui` finds **no** `--bs-*`, `--bg-*`, `--text-*`, or `--border-*` custom-property *definitions or references*.
- The existing `--bs-*` drop-target/hover vars (`HandRenderer.vue`, `GridBoardRenderer.vue`) and the ActionPanel light-fallback block (`--bg-secondary`/`--text-*`/`--border-*`, ActionPanel ~1505-1524) are renamed to `--bsg-*` equivalents and their **defaults registered in `theme.ts`**. This is a mechanical rename that preserves behavior; it is the only consumer-side change in 98. (A handful of drop-target swatches may begin reading Slate accent values as a result — that is an acceptable, transient, never-shipped partial change; do not chase the rest of the sweep here.)

### Slate token values (TOKEN-02, TOKEN-03, TOKEN-04) — pinned from the canonical mockup
`theme.ts` emits this as the **default (dark)** set, plus a **light** set under `html[data-theme="light"]` (or the equivalent emission mechanism). Follow OS preference by default (`prefers-color-scheme`), with the host able to force a theme via `applyTheme()`. Values are copied verbatim from `planning/mockups/boardsmith-chrome.html` `:root` (dark) and `html[data-theme="light"]`:

```
                         DARK (default)              LIGHT
--bsg-bg                 #121417                     #f3f2ef
--bsg-bg-2               #171a1e                     #eae8e4
--bsg-surface            #1c2026                     #ffffff
--bsg-surface-2          #232831                     #f7f6f3
--bsg-surface-3          #2b313b                     #edeae5
--bsg-line               rgba(255,255,255,.085)      rgba(22,27,32,.10)
--bsg-line-2             rgba(255,255,255,.17)       rgba(22,27,32,.20)
--bsg-ink                #e8ebef                     #191e24
--bsg-ink-2 (muted)      #99a3af                     #566069
--bsg-ink-3              #69727d                     #8a939b
--bsg-field              rgba(255,255,255,.04)       rgba(22,27,32,.035)
--bsg-accent             #1fb8a6                     #0d9488
--bsg-accent-2           #5fe6d6                     #0f766e
--bsg-accent-ink         #04211d                     #ffffff
--bsg-danger             #ef7a5f                     #c2492f
--bsg-ok (success)       #54cf9c                     #1c8a5a
--bsg-warn               #e6b450                     #b5832a
--bsg-away               #8a939b                     #9aa1a8
--bsg-cell               rgba(255,255,255,.035)      rgba(22,27,32,.025)
--bsg-cell-line          rgba(255,255,255,.07)       rgba(22,27,32,.10)
--bsg-shadow             0 8px 30px rgba(0,0,0,.45)   0 10px 34px rgba(22,27,32,.14)
--bsg-shadow-sm          0 2px 10px rgba(0,0,0,.4)    0 2px 10px rgba(22,27,32,.10)
```

Non-color tokens (same in both themes):
```
--bsg-r-sm:7px;  --bsg-r-md:11px;  --bsg-r-lg:16px;  --bsg-r-pill:999px;
--bsg-s1:4px; --bsg-s2:8px; --bsg-s3:12px; --bsg-s4:16px; --bsg-s5:24px; --bsg-s6:32px;
--bsg-font:'Hanken Grotesk', system-ui, sans-serif;
--bsg-mono:'JetBrains Mono', ui-monospace, monospace;
--bsg-rail:64px;  --bsg-side:286px;
```

Type scale (1.25 ratio, body 16px) and motion tokens (from spec §3/§6, Slate-neutral — NO warm glow):
```
--bsg-text-xs:.75rem; --bsg-text-sm:.875rem; --bsg-text-base:1rem;
--bsg-text-lg:1.25rem; --bsg-text-xl:1.5625rem; --bsg-text-2xl:1.95rem;
--bsg-line-tight:1.2; --bsg-line-normal:1.5;
--bsg-dur-fast:120ms; --bsg-dur-base:200ms; --bsg-dur-slow:360ms;
--bsg-ease:cubic-bezier(.2,0,0,1);
```

**Interaction tokens** (consumed by the Phase 99 sweep; define them now so 99 only references them). Derive from accent per the mockup's `color-mix` usage:
```
--bsg-selectable:  color-mix(in srgb, var(--bsg-accent) 14%, transparent);
--bsg-selected:    var(--bsg-accent);            /* solid; fills/borders use it directly */
--bsg-droptarget:  color-mix(in srgb, var(--bsg-accent) 12%, transparent);
--bsg-ring:        0 0 0 2px var(--bsg-accent);
--bsg-elevation:   var(--bsg-shadow-sm);
```

**Seat palette** `--bsg-seat-1..6` (TOKEN-02 / replaces the hardcoded Flat-UI cycle in `HexBoardRenderer.vue:108`): a muted, ~30%-desaturated 6-color set that stays distinguishable on the graphite ground and is colorblind-aware. The mockup does not pin seat hexes, so this is **executor's discretion** — pick a harmonious Slate-compatible set (e.g. desaturated red / slate-blue / sage / amber / plum / teal), define them as tokens, and have `HexBoardRenderer`/`PieceRenderer`/`DebugPanel` import the one array. Do NOT scatter the values.

### `applyTheme()` as sole knob (TOKEN-05)
- `applyTheme(overrides)` is the single entry point that writes the token values to the document (`:root`/host element). It accepts a partial host-supplied token map so the host can re-skin the chrome **without touching component code**.
- The BoardSmith side must *consume* a theme override delivered at iframe init (the existing init postMessage path / `useGameChrome` theme state). The **host-side call** that sends the override lives in the ShufflewickPub repo and is OUT OF SCOPE — but the BoardSmith receiver + `applyTheme` plumbing must be ready and tested (e.g. a unit test that `applyTheme({ '--bsg-accent': '#abc' })` updates the resolved value).
- Do not invent a second theming path. `applyTheme` is it.

### `color-no-hex` lint (TOKEN-06) — must keep CI green
- Add a stylelint config + npm script with `color-no-hex` scoped to chrome/renderer `.vue` files (NOT `theme.ts` — that is the one place literals are allowed to live).
- **Problem:** those `.vue` files are still full of hex until the Phase 99 sweep, so a blocking rule would fail CI immediately. **Resolution:** enable the rule but temporarily `ignoreFiles` the not-yet-swept components (the 8 renderers + chrome files), so introducing a **new** hex into an already-clean file or a new file fails CI now. Document (in the PLAN and a code comment) that **Phase 99 empties this ignore list** as it sweeps each file, ending with zero exclusions. This satisfies TOKEN-06's intent (the guard exists and bites) while main stays green.

### Safety / scope guardrails
- **Keep the full test suite green** (it was 939 passing after Phase 97). Flipping dead-token defaults must not change any asserted behavior; if a test asserts an old `--bsg-*` default value, update it to the Slate value.
- Do NOT touch ShufflewickPub host files. Do NOT do the Phase 99 neon→token sweep. Do NOT change layout/IA (Phase 100).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/ui/theme.ts` already exports `applyTheme` + a `defaultTheme` (currently the dead light-blue scheme, ~lines 22-29, emitting color-only). This phase rewrites its defaults to the Slate set above and expands it to emit space/type/shadow/radius/seat/interaction/motion tokens.
- The `--bs-*` drop-target vars live in `HandRenderer.vue` (~431) and `GridBoardRenderer.vue` (~324); the `--bg-*`/`--text-*`/`--border-*` fallback block is in `auto-ui/ActionPanel.vue` (~1505-1524).

### Established Patterns
- Vue 3 SFCs, scoped styles. Tokens are CSS custom properties on `:root`/document, set imperatively by `applyTheme`.
- CLAUDE.md hard rules: **No Backward Compatibility** (so do NOT keep old `--bs-*`/`--bg-*` namespaces as shims — rename and delete), no fallbacks/hacks, Pit of Success (one right way = `--bsg-*` + `applyTheme`).

### Integration Points
- `theme.ts` (rewrite), the renderer/ActionPanel files that hold the renamed vars, and wherever the iframe-init theme override is received (`useGameChrome`/GameShell init postMessage handler).

</code_context>

<specifics>
## Specific Ideas

Design source of truth: `planning/boardsmith-ui-redesign-spec.md` → Wave 1 (lines ~1254-1274) for the deliverable list and the high-risk note, and the canonical mockup `planning/mockups/boardsmith-chrome.html` for the exact Slate values (pinned above). Where the spec body says "tavern/warm" values, IGNORE them — this milestone uses the neutral Slate values pinned above (go-forward override).

</specifics>

<deferred>
## Deferred Ideas

- The neon→token **sweep** of all 8 renderers + chrome + DevHost → Phase 99 (Wave 2). Phase 99 also empties the stylelint `ignoreFiles` list and flips any remaining warn→error.
- The atomic background+text constraint and light/dark testing → enforced in the Phase 99 plan (recorded here so it carries forward).
- Host-side `applyTheme` *call* + theme handshake send → HOST-02 (future host milestone).
- Layout/IA use of `--bsg-rail`/`--bsg-side`/spacing → Phase 100.

</deferred>
