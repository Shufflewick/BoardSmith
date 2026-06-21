# Phase 95: Ship & Reframe - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the auto-UI a legitimate, shippable production peer:
- Docs/CLI/scaffold READMEs frame the auto-UI as a valid production choice (no "debug/reference aid" language).
- A production build emits only the chosen UI (single-UI export).
- A freshly scaffolded game opens in its chosen UI — no split-screen "Custom vs Auto-Generated" comparison.
- `boardsmith dev` / `boardsmith build` "just work" for an auto-UI-only game (no framework friction).

In scope: SHIP-01/02/03. Out of scope: cross-repo migration of existing games + old-path deletion
+ `npm run audit` (Phase 96); the N-UI registry + live dev switcher (§0 C5c — DEFERRED); auto-generate-then-eject (S10 — deferred).
</domain>

<decisions>
## Implementation Decisions

### Default UI for a new scaffold (SHIP-03)
- **D-01:** A freshly scaffolded game **opens in the auto-UI by default** — playable immediately with
  zero UI code — with an **empty/ready custom-UI slot** the author fills later. Matches the milestone
  core value ("play a basic game before any custom UI is written") and §0's shippable-peer framing.
  No split-screen comparison.

### Single-UI production export mechanism (SHIP-02)
- **D-02:** **`boardsmith.json` `"ui"` field** is the author-facing selector for the chosen UI
  (e.g. `"ui": "auto"` or `"ui": "./ui/GameUI.vue"`). **IMPORTANT reconciliation with SHIP-02 / §0 C5:**
  the user chose a config field over §0's pure import-convention suggestion. This is acceptable ONLY IF
  the config drives a **single static import** in the generated/production entry — i.e. the scaffold/build
  translates `"ui"` into exactly one `import` of the chosen UI component, so ordinary tree-shaking still
  drops every unselected UI. It MUST NOT introduce a runtime registry that imports all UIs, and MUST NOT
  require `rollupOptions.input` manipulation (SHIP-02's explicit constraints). The config is a build-time
  selector, not a runtime indirection. Planner: preserve the tree-shaking guarantee and prove it
  (removing/!selecting AutoUI drops its bundle).

### Custom-UI stub in the scaffold (SHIP-03)
- **D-03:** The scaffold **generates a minimal empty custom-UI component stub** (clearly marked
  "start here"), but the game renders via the auto-UI (per D-01/D-02 `"ui": "auto"`) until the author
  fills the stub and sets `"ui"` to it. Gives an obvious on-ramp without an eject command (S10 stays deferred).

### Dev-time UI viewing (SHIP-03 + §0 C5c)
- **D-04:** **Strict single-UI in dev.** `boardsmith dev` shows exactly the chosen UI (from `boardsmith.json`
  `"ui"`). NO live switcher, NO `?ui=auto` peek, NO dual-mount — honoring the §0 C5c deferral and avoiding
  the frozen-UI-vs-evolving-`gameView` trap §0 warned about. To peek at the auto-UI, the author temporarily
  sets `"ui": "auto"` (or swaps the import). The existing split-screen dev host is replaced by single-UI.

### Claude's Discretion
- `boardsmith.json` schema details for `"ui"`, the custom-UI stub's exact contents, README/CLI/doc wording
  for the reframe, and how `boardsmith dev`/`build` resolve `"ui"` are planner's discretion within the above.
  Reframe applies to the SCAFFOLD GENERATOR + dev host + docs; migrating EXISTING games' scaffolds is Phase 96.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative design (read §0 first)
- `docs/auto-ui-redesign-research.md` §0 C5 — S12 is three separable things: (a) shippable-peer reframe
  (build, cheap); (b) single-UI export — "nearly free: remove the scaffold's static `import { AutoUI }`,
  after which ordinary tree-shaking drops it. No registry, no `rollupOptions.input`"; (c) N-UI registry +
  live switcher — DEFER/CUT. **Note the D-02 divergence above:** user chose a `boardsmith.json "ui"` field;
  it must still resolve to a single static import so (b)'s tree-shaking holds.
- `docs/auto-ui-redesign-research.md` §5 S12 + P3 (single-UI production export, dev switching deferred).
- `.planning/PROJECT.md` "Out of Scope" (N-UI registry + live switcher deferred) + "Key Decisions".
- `.planning/REQUIREMENTS.md` SHIP-01/02/03.

### Code/tooling being touched
- The CLI scaffold generator (`src/cli/`) — `boardsmith init`/scaffold templates (default to auto-UI + empty custom stub + `boardsmith.json "ui"`).
- The dev host / `boardsmith dev` — replace split-screen with single chosen UI.
- `boardsmith build` — single-UI export resolving `boardsmith.json "ui"` to one static import (tree-shaking preserved).
- Docs/READMEs — reframe auto-UI as shippable (no "debug aid" language).

### Upstream dependency
- `.planning/phases/94-...-CONTEXT.md` + playability outcome — the "shippable" claim rests on Phase 94 proving Hex/Go Fish/Checkers playable on the auto-UI.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The new auto-UI (`AutoUI.vue` / `AutoRenderer.vue`, Phase 93) is the shippable peer being reframed.
- Existing CLI scaffold generator + dev host (split-screen today) — the reframe targets.

### Established Patterns
- §0 C5b: single-UI export via tree-shaking, not registry/`rollupOptions.input`.
- §0 C5c / P3: N-UI live switcher is deferred — do not build it.

### Integration Points
- `boardsmith.json` gains a `"ui"` field (D-02) read by dev + build.
- Scaffold templates: auto-UI default + empty custom-UI stub.
- Dev host: single-UI (no split-screen).

### Critical constraints
- Tree-shaking guarantee (SHIP-02): config must resolve to ONE static import; no runtime all-UI registry; no `rollupOptions.input`.
- Do NOT build the N-UI live switcher (deferred).
- Existing games' migration is Phase 96, not here.
</code_context>

<specifics>
## Specific Ideas

- New scaffold: auto-UI by default, empty custom-UI stub, `boardsmith.json "ui": "auto"`.
- `boardsmith.json "ui"` field selects the chosen UI; build resolves it to a single static import.
- Strict single-UI dev (no switcher/peek).
- Reframe docs/CLI/README away from "debug aid" → "valid production choice for simple games".
</specifics>

<deferred>
## Deferred Ideas

- Cross-repo migration of all existing games + MERC canary + old-path deletion + `npm run audit` clean → **Phase 96**.
- N-UI registry + live dev-time switcher (§0 C5c) → later milestone.
- Auto-generate-then-eject (S10) → later milestone.
</deferred>

---

*Phase: 95-ship-reframe*
*Context gathered: 2026-06-21*
