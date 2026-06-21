# Research Summary — v3.1 Dynamic Auto-UI

> This milestone reuses a bespoke research effort instead of GSD's generic domain researchers. The full artifact is **`docs/auto-ui-redesign-research.md`** (§0 is authoritative). It was produced by 5 parallel research agents (engine model, current AutoUI, example games + MERC, Boardzilla, external schema-driven-UI research) and hardened by 5 adversarial red-team agents. This file is the condensed input for roadmapping.

## Problem

The current Auto UI (`AutoElement.vue` + `AutoGameBoard.vue`, ~2791 lines) can show *what components exist* but you can't actually *play* a game with it. The interaction substrate is already good; the **renderer** is the rot.

## What holds up (build on these — verified against code)

- **Reuse the interaction substrate**: `useActionController`, `useBoardInteraction` (throws outside GameShell — it's a mandatory host), drag orchestration (`useDragDropTargets`, wired once in GameShell), per-player visibility filtering (`toJSONForPlayer`), and the FLIP/flying-element primitives.
- **Replace only the renderer**: `AutoElement.vue` (per-element dispatch, text-box piece fallback at `:1277-1289`, 8×8 grid fallback at `:607-657`) and `AutoGameBoard.vue` (flex column/row heuristic, FLIP wiring).
- Closed-form layout math already exists: `useGameGrid`, `useHexGrid`.

## Locked decisions (2026-06-20)

1. **Layout = archetype templates now, general solver later.** Ship ~3–5 hierarchy-bearing templates (grid-board / card / tableau) selected by introspection, with closed-form grid/hex math inside. Do **not** build the Boardzilla-style general percentage-relative solver upfront — it reproduces the disliked "equal-subdivision, no hierarchy, labeled-box" look and is multiple engineer-weeks. The solver earns its way in only when a real game's topology can't be templated (and such a game is a custom-UI candidate anyway).
2. **Presentation metadata = per-UI overlay in the `ui` layer, sibling file per UI.** Keyed by element class/name/attribute, resolved *after* visibility filtering. Engine stays UI-agnostic. `$`-props reserved for abstract topology only (`$type`/`$layout`/coords; `$zone` only as a validated enum). **Rejected**: `$image`/`$thumbnail`/`$label`/`$stats`/`$render`/`$owner` on engine elements (security leak + can't be per-UI; `.player` already carries ownership).

## Corrections the red team forced (must inform planning)

- **"Keep the plumbing unchanged" is false.** A good board UI requires: (a) **multi-ref highlight metadata** — `protocol.ts` has only singular `sourceRef`/`targetRef`/`ref`; `boardRefs` (plural) does not exist. Castling / multi-jump / area-effects need `protocol.ts` + `buildActionMetadata` extended. (b) The footer `ActionPanel` is mounted **unconditionally** (`GameShell.vue:1280-1295`); board-centric default needs it suppressible. (c) The new renderer must **explicitly consume `useAnimationEvents`** — the old auto path never did.
- **"Peers, not layers" → "custom renderer in a shared mandatory shell."** Every UI (incl. MERC) ships the auto-UI's ActionPanel footer. You're never forced onto the auto-UI's *layout/renderer*, but GameShell + its controller are shared.
- **The custom/auto gap is not "almost entirely cosmetics."** Derived/computed display values (e.g. "STR 4 (3 base +1 terrain)") and partial info beyond binary hidden/count-only are fundamentally un-introspectable; bespoke interactive sub-systems (MERC combat) always need custom code. Auto-UI absorbs *boilerplate* (tree-walking, pick loop, selectable lists, hands), not these.
- **Re-target the "biggest visual win" from cards to pieces.** Cards already render from `$images` (`AutoElement.vue:264-291`); the 52-card regex is only used in hand sort/preview. The real text-only-box bug is **pieces**.
- **S12 decomposed**: (a) shippable-peer reframe + (b) single-UI export are cheap — (b) is achieved by removing the scaffold's static `import { AutoUI }`, after which ordinary tree-shaking drops it (no registry needed). (c) the N-UI registry + live switcher is deferred.

## Independent security bug (in scope this milestone)

`toJSONForPlayer` (`game.ts:2205-2289`) whitelists every `$`-prefixed key as non-secret on hidden/owner-only/count-only elements. Today `$images.face` URLs ship for **face-down** cards → identity-encoding filenames leak the card to all players. Fix: stop emitting face-side image refs for elements the viewer can't see (filter `$images` by visibility), and audit the `$`-whitelist so it only passes genuine layout descriptors.

## Revised MVP & sequencing (supersedes the doc's original §6)

1. Pieces render with images/labels + fix 8×8 grid fallback (days, no architecture change).
2. Renderer rebuild — scoped to **coordinate-addressable topologies only** (grid/hex/stack/hand): ranked-tester dispatch + ~3 hierarchy-bearing archetype templates + closed-form layout + board-centric interaction (with its required protocol/shell edits) + the per-UI presentation overlay.
3. Prove playability on Hex, Go Fish, Checkers in the browser — the milestone-defining acceptance gate.
4. Auto-UI as shippable peer + single-UI export + scaffold reframe.
5. Migration & cleanup (mandatory exit criterion): every game playable on the new auto-UI, MERC green on the plumbing, old paths deleted, `npm run audit` clean — verified by *playing* each game.

Plus the `$images.face` leak fix, sequenced early (independent, security).

## Deferred to a future milestone

General layout solver; responsive container-query primitives; phase/scoring-summary renderers; N-UI registry + dev switcher; auto-generate-then-eject; engine model additions (adjacency graph, free-form positioning, z-order); touch/mobile, a11y, i18n.
