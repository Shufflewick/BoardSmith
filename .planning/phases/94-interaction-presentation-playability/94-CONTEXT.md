# Phase 94: Interaction, Presentation & Playability Gate - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire board-centric interaction into the Phase 93 renderer, ship the per-UI presentation
overlay, and prove playability:
- Board-anchored choices actioned on the board by default; footer ActionPanel becomes the fallback.
- `ActionPanel` is suppressible (GameShell no longer mounts it unconditionally).
- `protocol.ts` + `buildActionMetadata` support multi-element highlight metadata.
- A per-UI presentation overlay (sibling file) maps element class/name/attribute → visuals,
  resolved AFTER engine visibility filtering.
- **Playability Gate:** Hex, Go Fish, and Checkers each played start-to-finish in the browser
  using ONLY the auto-UI (no custom UI code).

In scope: INTERACT-01/02/03, PRESENT-01/02/03, the three playability gates.
Out of scope / already done elsewhere: the renderer + archetype templates + animation wiring
(RENDER-05) are **Phase 93** — animation is NOT re-done here despite the goal's umbrella phrasing.
Ship/reframe is Phase 95; cross-repo migration is Phase 96.
</domain>

<decisions>
## Implementation Decisions

### Multi-ref highlight metadata (INTERACT-03)
- **D-01:** **Generalize to a `refs` array.** Replace the singular `sourceRef`/`targetRef`/`ref`
  in `protocol.ts` + `buildActionMetadata` with a single `refs: { ref: ElementRef; role:
  'source' | 'target' | 'highlight' }[]`. Singular becomes the 1-element case — one way to
  express board anchors (No Backward Compatibility; pit-of-success). Update all consumers
  (`useBoardInteraction` ref-matching, ActionPanel, the new renderer's highlight logic). A
  multi-jump in Checkers populates multiple `refs` so all source/target cells highlight at once.

### ActionPanel suppression (INTERACT-02)
- **D-02:** **Auto-absent + explicit escape.** The footer ActionPanel is **automatically absent**
  (not merely hidden) when every active choice has a board anchor — board-centric is the
  zero-config default. Board UIs can additionally force-suppress via an explicit prop/slot on
  `GameShell` (e.g. `:suppress-action-panel` and/or a `#action-panel` slot override). `GameShell`
  stops mounting the panel unconditionally (it currently mounts it at ~`GameShell.vue:1280-1295`).

### Board-centric default + mixed anchors (INTERACT-01)
- **D-03:** **Hybrid presentation for mixed-anchor actions.** Anchored choices get on-board
  affordances (highlight/click the cell/card); the panel shows ONLY the remaining non-anchored
  choices — never duplicating what's already actionable on the board. When all choices are
  anchored → board only (panel absent, per D-02). When none are anchored → panel only (fallback).

### Presentation overlay (PRESENT-01/02/03)
- **D-04:** **Prop-passed object map, resolved after visibility filtering.** A UI declares its
  overlay as a plain object exported from a sibling file, keyed by element className / name /
  attribute → `{ image, label, stats, render }`, and passes it to the auto-UI / GameShell as a
  `:presentation` prop. Naturally per-UI (P1): a custom UI passes its own overlay or none; the
  engine carries NO value-bearing `$`-presentation props (`$image`/`$stats`/`$label`/`$render`/
  `$owner` rejected — ownership stays on `.player`). The resolver applies the overlay to the
  ALREADY visibility-filtered tree (PRESENT-02) so overlay data for a hidden element is never in
  the payload an unauthorized player receives — leak-closed by construction.

### Claude's Discretion
- Exact prop/slot names, `ElementRef`/`refs` field naming, overlay key-resolution precedence
  (instance > name > class), and per-game presentation overlay contents are planner's discretion
  within the decisions above. Playability-gate verification is human-driven browser testing
  (like Phase 92's checkpoint) — full game start-to-finish per the success criteria.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative design (read §0 first)
- `docs/auto-ui-redesign-research.md` §0 C1 (multi-ref protocol does NOT exist yet — `boardRefs`
  was cited as if real but isn't; ActionPanel mounted unconditionally at GameShell.vue:1280-1295;
  animation must be explicitly wired) + C2 (GameShell is a mandatory host) + C7 (presentation
  overlay security/layering: keep `$` for abstract topology only, move visuals to per-UI overlay
  resolved after visibility filtering; `$owner` rejected — use `.player`).
- `docs/auto-ui-redesign-research.md` §5 S6 (board-centric action surface) + §2c (interaction as a
  projection of the action model) + §2e (override via separate overlay).
- `.planning/PROJECT.md` "Key Decisions" / "Out of Scope" — v3.1 locked decisions (presentation overlay = option A1; no value-bearing `$`-props).
- `.planning/REQUIREMENTS.md` INTERACT-01/02/03, PRESENT-01/02/03, the three playability gates.

### Upstream phase dependencies
- `.planning/phases/93-renderer-rebuild/93-CONTEXT.md` — the new renderer this phase wires interaction into (and its registry); animation (RENDER-05) lives there.
- `.planning/phases/91-security-leak-fix/91-VERIFICATION.md` — the `toJSONForPlayer` redaction the overlay's after-visibility resolution must not undo.

### Code being touched
- `src/types/protocol.ts` + `buildActionMetadata` — generalize to `refs` array (D-01).
- `src/ui/components/.../GameShell.vue` (~1280-1295) — make ActionPanel suppressible (D-02).
- `useActionController` / `useBoardInteraction` — ref-matching + board-anchored selection (D-03). REUSE the substrate; extend only where C1 requires.
- The Phase 93 renderer + registry — consume `refs` + presentation overlay.
- Example games (Hex, Go Fish, Checkers in `~/BoardSmithGames/`) — playability gates + per-UI overlays.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useActionController` + `useBoardInteraction` — the interaction substrate (drive it; extend only per C1).
- `boardRef`/`PickMetadata` plumbing — the singular ref system being generalized to `refs` (D-01).
- Phase 93 renderer + ranked-tester registry — interaction + presentation plug into it.

### Established Patterns
- §0 C1: three substrate edits are real work here (multi-ref protocol, suppressible panel) — budget for them.
- §0 C7: overlay resolved AFTER visibility filtering — never before (security).
- P1: presentation is per-UI; custom UIs pass their own overlay; engine stays UI-agnostic.

### Integration Points
- `protocol.ts` wire format change ripples to client + UI consumers (generalize, don't dual-path).
- Presentation overlay passed via GameShell prop → renderer.
- Playability gates exercise the full stack in-browser (human-verify checkpoint).

### Critical constraints
- Engine carries NO value-bearing `$`-presentation props. Overlay lives in the `ui` layer.
- Overlay resolution must not re-expose data redacted by Phase 91's `toJSONForPlayer`.
</code_context>

<specifics>
## Specific Ideas

- `refs: { ref, role }[]` — one anchor model; multi-jump highlights all cells.
- Panel auto-absent when all choices anchored; explicit `:suppress-action-panel` escape hatch.
- Overlay = sibling file object map keyed by class/name/attribute, passed as `:presentation` prop.
- Mixed anchors → hybrid (board for anchored, panel for the remainder only).
</specifics>

<deferred>
## Deferred Ideas

- Shippable-peer reframe + single-UI export + scaffold reframe → **Phase 95**.
- Cross-repo migration of all games + MERC canary + old-path deletion + `npm run audit` clean → **Phase 96**.
- General layout solver (S2), responsive primitives (S2b), phase/scoring renderers (S7),
  N-UI live switcher (S12c), auto-eject (S10), engine model additions (S11) → later milestone.
</deferred>

---

*Phase: 94-interaction-presentation-playability*
*Context gathered: 2026-06-21*
