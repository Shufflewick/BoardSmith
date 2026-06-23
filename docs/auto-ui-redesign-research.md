# Auto-UI Redesign — Research & Suggestions

> Research compiled 2026-06-20. Goal: design a **dynamically-generated UI** that replaces the current AutoUI and is actually good enough to *play* a basic game (Hex, Go Fish, Checkers) before any custom UI is written — while staying a launchpad, not a dead end, for the custom UI every game will eventually have.
>
> This is a discussion document. No code was changed. Findings come from five parallel investigations: the BoardSmith engine/data model, the current AutoUI/UI module, the four reference games + MERC's custom UI, the Boardzilla codebase, and external research on schema-driven/auto-generated UIs.

---

## 0. Red-team verdict & revisions (read this first)

Five adversarial reviewers pressure-tested this document against the code. The core diagnosis survived; much of the prescription did not. **Where §0 conflicts with a later section, §0 wins** — the later sections are preserved as the original research, with corrections noted.

**Decisions locked (2026-06-20):**
- **Layout = templates now, solver later (option C).** Ship ~3–5 hand-tuned, hierarchy-bearing archetype templates (grid-board / card / tableau) selected by introspection, with closed-form grid/hex math (S3, `useGameGrid`/`useHexGrid`) inside them. The general percentage-relative solver (S2) is **not** built upfront — it must be earned by a concrete game whose topology no template covers (and such a game is a custom-UI candidate anyway). The auto-UI has a deliberate boundary; games outside it swap to a custom UI (S12a). This is the accepted design, not a fallback.
- **Presentation metadata = per-UI overlay in the `ui` layer, as a sibling file each UI imports (option A1).** Keyed by element class/name/attribute, resolved *after* the engine visibility filter. The engine stays UI-agnostic; `$`-props are reserved for abstract topology only (`$type`/`$layout`/coords; `$zone` allowed only as a validated enum). `$image`/`$thumbnail`/`$label`/`$stats`/`$render`-on-element are **rejected** (security leak + can't be per-UI). `$owner` rejected (use `.player`). `boardsmith.json` stays free of presentation wiring.
- **Follow-up to file now (independent of the above):** `$images.face` URLs ship for face-down cards via the `$`-whitelist in `toJSONForPlayer` — identity-encoding filenames leak today. File as a security bug regardless of the redesign.

**What held up (build these):**
- **Replace the renderer, not the substrate.** The renderer (`AutoElement.vue` + `AutoGameBoard.vue`) genuinely is the rot; the action wizard, drag orchestration (`useDragDropTargets`, wired once in GameShell — a real strength), visibility filtering, and FLIP primitives are real assets. Confirmed.
- **Kill the pit-of-failure bugs (S5)** — but re-targeted: see correction C4.
- **Ranked-tester dispatch (S4)** replacing the brittle `elementType` cascade — sound, low-risk.
- **Make the auto-UI a shippable, selectable peer + single-UI export (S12 a/b)** — correct and *cheap* (see C5).
- **S11 deferral is valid for the three named games** — verified; adjacency/free-form/z-order aren't needed for Hex/Go Fish/Checkers.
- **Migration (S13)** is mandatory and MERC is the canary for any "non-breaking" plumbing change.

**Major corrections (the doc was wrong or oversold):**

- **C1 — "Keep the plumbing unchanged" is false for a *good* board UI.** Three concrete edits to the supposedly-frozen substrate are required: (1) **multi-ref highlight metadata** — `protocol.ts` has only singular `sourceRef`/`targetRef`/`ref`; **`boardRefs` (plural) does not exist** (my doc cited it as if it did). Castling, multi-jump highlighting, area-effects can't express their board footprint without extending `protocol.ts` + `buildActionMetadata`. (2) **The footer `ActionPanel` is mounted unconditionally** (`GameShell.vue:1280-1295`); S6's "board-centric by default, panel as fallback" requires making it suppressible. (3) The new renderer must **explicitly consume `useAnimationEvents`** (the semantic deal/flip/reveal choreography) — the old auto path never did; animation is *re-wired*, not inherited. **Budget for plumbing edits.**
- **C2 — "Peers, not layers" is misleading.** GameShell is a **mandatory host**: it creates the controller, and `useBoardInteraction()` *throws* outside it. Every custom UI — including MERC — involuntarily ships the auto-UI's `ActionPanel` footer. The honest framing is **"custom renderer in a shared mandatory shell,"** not "peers." (The valuable, true part of P1 — you're never forced to build *on the auto-UI's layout/renderer*, and you can swap the board component — stands. The slogan oversold it.)
- **C3 — "The gap is almost entirely cosmetics" is too rosy.** MERC's combat/hit-allocation/mortar panels are *interactive sub-systems*, not theming. Two categories are **fundamentally un-introspectable**: derived/computed display values (MERC's "STR 4 (3 base +1 terrain)") and partial information beyond binary hidden/count-only ("this card is one of {A,B,C}"). The absorbable part is *boilerplate* (tree-walking, pick loop, selectable lists, hands); bespoke interactive sub-systems and derived/partial-info displays always need custom code.
- **C4 — S5 mis-targets cards.** Card rendering is **already `$images`-driven** (`AutoElement.vue:264-291`); the 52-card regex is only used in hand *sorting*/*preview*, not sprite location. The real text-only-box bug is **pieces** (`AutoElement.vue:1277-1289`). Re-target S5's "biggest visual win" to pieces. (Narrower real card issue: the hardcoded 13×5 sprite *geometry*.)
- **C5 — S12 is three separable things; only two are worth building now.** (a) reframe auto-UI as a shippable selectable peer — **build, cheap**; (b) single-UI production export — **nearly free: it's achieved by removing the scaffold's static `import { AutoUI }`, after which ordinary tree-shaking drops it. No registry, no `rollupOptions.input` needed.** (c) the N-UI registry + live dev switcher — **defer/cut**: justified only by two anecdotes that P1 already makes a ~10-line author concern (`<component :is>`), and the flagship "v1 vs v2 against identical state" use case *fights the engine's evolving contract* (a frozen v1 UI written against the old `gameView` may not render current state). Also: my "reload the iframe like `handleSwitchPlayer`" precedent was **wrong** — `handleSwitchPlayer` uses a `debug:switch-seat` postMessage, not a reload; the real state-preserving mechanism is `DevHost.onIframeLoad` re-feeding cached state over the parent-owned WS, and a reload **drops in-flight interaction**.

**The big strategic decision — S2 is probably a trap:**

- **C6 — Copying Boardzilla's layout engine risks reproducing the exact output the user dislikes.** The doc only catalogued Boardzilla's *mechanical* flaws (580-line function, etc.) and never diagnosed *why its output feels wanting*: **democratic equal-space subdivision with no visual hierarchy, and the labeled-box default.** A `ResizeObserver` makes that arrangement responsive, not good. Additional findings: "discrete testable passes" understates inherent geometric coupling (realistically 600–900 lines + test suite, multiple engineer-weeks); and the **responsiveness mechanism is wrong** — FLIP is for discrete model changes, resize should *snap*; Boardzilla itself gets resolution-independence from a fixed percentage-space + one CSS transform, not per-tick re-solves. Text-legibility clamps, native-asset DPI, and aspect-locked board art (which conflicts with P2's "no board size") are unaddressed.
- **The recommended alternative: lead with closed-form per-topology layout (S3, already in `useGameGrid`/`useHexGrid`) composed by a small set of opinionated, hierarchy-bearing archetype templates** (grid-board / card / tableau) selected by introspection. These cover every named game, can bake in the focal-board/docked-hand hierarchy a general solver structurally can't, and ship in a fraction of the time. **Gate the general solver (S2) behind a concrete game whose topology the closed-form set can't express.** Before greenlighting S2, the doc must answer: *how does our default composition differ aesthetically from Boardzilla's?* If it can't, don't build it.

**C7 — The annotation strategy (S8 / §4) has a security hole and a layering violation; it needs a rewrite:**

- **Security (Blocker):** `toJSONForPlayer` whitelists *every* `$`-prefixed key as non-secret on hidden/owner-only/count-only elements (`game.ts:2205-2289`). Safe today (all `$`-props are static layout descriptors) — but the instant `$stats`/`$label`/`$thumbnail` carry game data, the engine **broadcasts a hidden unit's stats / a face-down card's identity to every player.** (There's even a *current* latent leak worth filing: `$images.face` URLs ship for face-down cards — if filenames encode identity, that's a real leak today.)
- **Layering / P1 / P3:** value-bearing `$`-props are renderer inputs, so they're either a shared *presentation* contract (P1 forbids) or dead cruft in the rules module forever. And a `$`-prop is *global per element* — it **structurally cannot** give a 2D and a WebGL UI different assets, which is the whole point of P3. `$owner` is a second source of truth for ownership (`.player` already exists and is what visibility trusts) — drop it.
- **The fix (which §3 already endorsed, then S8 contradicted):** keep `$` only for **abstract topology** (`$type`/`$layout`/coords/`$direction`/`$fan`/`$overlap`; `$zone` is OK *only* as a validated enum). Move all cosmetic/value-bearing presentation (`image`/`thumbnail`/`label`/`statBlock`/render-hint) into a **per-UI presentation overlay owned by the `ui` layer** (keyed by className/name, resolved *after* visibility filtering — closing the leak by construction). Each of the N UIs supplies its own overlay; a custom UI ignores it; the engine stays UI-agnostic (preserving headless AI/test/replay).

**Other gaps to name (not blockers):** touch/pointer input & tap-target sizing (P2 says "responsive" but only addresses width); accessibility (screen-reader board state, keyboard nav, colorblind-safe player identity — an auto-UI could generate a11y *for free*, a real differentiator); i18n of author strings; and the determinism tension in S3's d3-force graph fallback vs. the project's `no-nondeterministic` culture.

**Revised MVP & sequencing** (supersedes §6):
1. **Pieces render with images/labels** (re-targeted S5) + fix the 8×8 grid fallback. Days, no architecture change.
2. **The renderer rebuild**, scoped to **coordinate-addressable topologies only** (grid/hex/stack/hand): S1 + S4 (ranked dispatch) + **S3 closed-form + ~3 hierarchy-bearing archetype templates** (not the S2 general solver) + S6 board-centric interaction (with its required protocol/shell edits per C1). Plus the per-UI presentation overlay (C7) for visuals beyond defaults.
3. **Prove playability on Hex, Go Fish, Checkers in the browser. Stop and reassess here** — this is the milestone that satisfies the user's actual goal.
4. **Cheap S12 wins:** (a) shippable-peer reframe + (b) single-UI export via removing the static import. Reframe the scaffold away from split-screen.
5. **Earn-their-way-in, later:** the general layout solver (S2) only if a real game needs it; S2b responsive primitives; S7 phase/scoring renderers; the N-UI registry + switcher (S12c); S9/S10.
6. **Separate architecture decisions (rules-layer impact):** S11 engine model additions; and the presentation-overlay design (C7).
7. **Migration & cleanup (S13)** — mandatory exit criterion; every game playable on the new auto-UI, MERC green on the plumbing, old paths deleted, `npm run audit` clean, verified by playing each game.

---

## 1. The core finding

**The interaction plumbing is already right; the rendering layer is what's wrong.**

BoardSmith was deliberately built with a generic UI in mind. The engine enriches every element with `$`-prefixed system properties (`$type`, `$layout`, `$rowCoord`, `$images`, …) specifically so a renderer can introspect them, and it already exposes everything a UI needs to *play* a game:

- **Legal-action enumeration** — `getAvailableActions`, `getSelectionChoices` (with disabled-reasons), `buildActionMetadata` → `PickMetadata`. The UI can ask "what can this player do right now, and what inputs does each step need?" purely from state.
- **Per-player visibility filtering** — `toJSONForPlayer` ships a pre-filtered tree; `__hidden` / `childCount` are the contract for face-down/secret zones. The UI never has to decide what to hide.
- **Turn/flow state** — `FlowState` gives active seat, phase, available actions, simultaneous-seat availability.
- **A solid action state machine + board↔panel bridge** — `useActionController` (start/fill/skip/execute, auto-fill, auto-execute, multiSelect draft, followUp chains) and `useBoardInteraction` (highlight/select/drag, ref-matching by id→notation→name). These enforce the "Custom UI and Action Panel in parity" rule and **should be reused unchanged**.
- **Animation/presentation primitives** — FLIP, flying elements, `Die3D`, zoom preview, drag-drop helpers, `useGameViewHelpers`. All reusable.

The verdict that AutoUI is "almost never useful" is **not** about a missing action path — it's about the *rendering layer* (`AutoGameBoard.vue` + `AutoElement.vue`, ~2300 lines). That layer is the replace target. Its specific failures:

1. **Everything non-standard renders as a text-labeled box.** A checker, a Go stone, a meeple, a resource token all look identical — the element's name/className as text. The only game-specific visual is the one hardcoded hex-piece-as-colored-circle case.
2. **Cards are hardcoded to a 52-card French deck** — extracted by the regex `^(\d+|[AJQK])([CDHS]?)$` against a 13×5 sprite sheet. Any custom-faced card falls back to a text label.
3. **Board layout is naive** — a one-line flex column/row heuristic at the top level; grids assume rectangular numeric coords and **default to 8×8** when they can't infer. Zones are just stacked vertically in tree order. No real spatial arrangement.
4. **The decision surface is generic and detached** — all play happens via camelCase-button lists in `ActionPanel` (a footer sibling, not part of AutoUI). The board is a passive highlighter; it contributes little to comprehension.
5. **It's positioned as a debug view** — every scaffolded game renders it side-by-side with the "real" custom UI under a "Custom vs Auto-Generated" comparison, and the docs call it a debugging/reference aid. That self-fulfilling framing is part of the problem.

**The encouraging corollary** (from the games + MERC study): for the example games, the gap between custom UI and auto-UI is *almost entirely cosmetics and animation, not interactive capability*. MERC's ~19.5k-line custom UI is mostly recurring boilerplate (tree-walking, the action-pick loop, selectable lists, hands, stats, modals, drag-to-zone) wrapped around a small irreducibly-bespoke core (composited board art, the combat sub-system, themed motion). A good auto-UI could own that boilerplate.

---

## 1b. Hard design principles (constraints, not options)

These three are settled direction — everything below must conform.

**P1 — Auto-UI and custom UIs are PEERS, not layers.** Boardzilla's worst trait is that a custom UI is expressed as *overrides hacked into the auto-UI's positioning model*: your JSX renders inside their layout div, layouts are tuned through their cascade, and anything unanticipated goes through string-keyed escape hatches. The "slow migration" benefit is real but the cost is you never fully escape their model. BoardSmith already avoids this (MERC uses zero AutoUI yet keeps full action parity) and we make it a rule: **the shared contract is the data + interaction layer only** (`gameView`, `useActionController`, `useBoardInteraction`, animation composables) — *never* the auto-UI's rendering/layout. A custom UI is just a Vue component in the `#game-board` slot talking to the controllers directly. Migration = swap the whole board component, not progressively override the auto-UI. (Consequence: the ranked renderer registry in S4 is for extending the auto-UI *internally*; it is **not** the custom-UI path.)

**The auto-UI is itself a legitimate, shippable production UI** — not merely a scaffold. For some games (simple abstracts, basic card games) it will be good enough to *ship*, and that's an explicitly supported choice. The point of P1 is that you are never *forced* to build on top of it: writing against the auto-UI is fine when it suffices, and swapping in a peer custom UI is fine when it doesn't. Both are first-class.

**P2 — Fully responsive, viewport-measured. No predefined board/table size.** Reject Boardzilla's `boardSizes`/fixed-aspect-ratio model and its imperative `if (boardSize === 'desktop')` author branching. The percentage-relative layout engine (S2) is inherently responsive; drive it from a real `ResizeObserver` on the actual board container and relayout on resize (recompute-from-scratch + FLIP-diff means resize animates for free). Per-element `aspectRatio` is a *constraint the solver respects*, never a board size it's pinned to. Responsive reflow (fan→row hand on narrow screens, sidebar→drawer) comes from **container-query / breakpoint primitives the engine provides**, not author `if/else`.

**P3 — Multiple UIs per game, switchable at dev time, single-UI production export.** A game declares N named UIs; the dev host switches between them live against one running session (replacing today's split-screen); the production build emits only the chosen one. See S12 for the grounded mechanics.

## 2. The reference model to imitate: Boardzilla

Boardzilla is a near-exact precedent and gets the architecture right. The external research independently confirmed the same patterns converged on by JSONForms, react-admin, and RJSF. The transferable ideas:

### 2a. Declare *relationships*, not coordinates — a percentage-relative layout DSL
Boardzilla's defining idea: authors declare regions/grids/stacks via `layout(applyTo, attributes)`, never pixel positions for individual pieces. A pure engine (`calcLayouts`) then auto-places everything. Everything is **percentages of the parent box (0–100)**, so layouts nest recursively and are resolution/aspect-ratio independent.

Key layout attributes worth adopting as our vocabulary: `area`/`margin` (bounding box, absolute-percent so siblings line up), `rows`/`columns` (fixed or `{min,max}` ranges that grow with child count), `gap`, `scaling: 'fit' | 'fill'`, `alignment` (9-way), `offsetRow`/`offsetColumn` (vector offsets → **non-orthogonal grids: hex, diamond, stacks**), `limit` (render a deck as "3 cards" without drawing the rest), `maxOverlap`, `slots` (hand-authored explicit boxes for irregular maps), `aspectRatio` (couples appearance to layout).

### 2b. Sensible defaults via per-subclass base layout + a default appearance
Every element has a `getBaseLayout()` so **zero config still yields a sensible grid** — the default "divides space equally into the squarest grid that fits, scaled to the container, for any item count." Subclasses encode domain knowledge: `Stack` → deck (1 column, offset, stacking order, hidden, limit 10); `FixedGrid` → static board grid; `HexGrid` → offset vectors per hex axis. A piece with no styling renders as a labeled box (`.bz-default`) with built-in selectable/selected/droppable/invalid states. **You can play your game before drawing a single asset.**

### 2c. Interaction is a *projection* of the action model
Boardzilla derives all click/drag affordances automatically from action/selection definitions — no hand-written click handlers, and the board literally cannot offer an illegal move. It walks the selection tree, prunes impossible branches, collapses forced selections into pre-filled args, indexes each valid choice element by its branch path, and sets clickable/draggable/droppable classes per element. `.move()`/`.swap()` auto-wire drag-drop; controls auto-anchor next to the relevant element. **BoardSmith already has the equivalent substrate** (`useActionController` + `useBoardInteraction` + `PickMetadata` + `boardRef`/`boardRefs`) — this is the part we don't need to invent, only to drive a better renderer.

### 2d. Layout-by-diff animation (FLIP) for free
Boardzilla recomputes layout fresh each update and *diffs* old vs new render trees to derive transforms — authors get movement/shuffle/cross-container animations for free by just mutating the model. BoardSmith's AutoGameBoard already does FLIP + flying cards; the new renderer should keep this and drive it off the same diff.

### 2e. Override via a separate overlay, with mechanically-winning escape hatches
- A **specificity cascade** (instance > name > collection > class) resolves competing layout rules — a CSS-like cascade for layout.
- All built-in CSS ships in a CSS `@layer` so **author CSS automatically wins** — no specificity wars, no `!important`.
- `appearance.render` JSX renders *inside* the framework's positioning div, so authors override looks without touching placement.

### What Boardzilla does *badly* (and we should improve)
- `calcLayouts` is a single ~580-line function — powerful but near-impossible to extend or debug. **Build the solver as discrete, individually-testable passes**: grid-solve → size → scale → place → jitter.
- Per-device layout is imperative `if (boardSize === 'desktop')` branching with copy-paste drift. **Provide responsive/region primitives instead.**
- Irregular boards fall off a cliff from "grid" straight to "hand-author every pixel in a `slots` array." **Provide a graduated escape hatch between those.**
- Heavy stringly-typed magic (`__container__`, `_god*` prefixes, `clientContext` bags). **Keep it typed.**

---

## 3. Lessons from the broader field (schema-driven UI)

The same three pillars recur across JSONForms, RJSF, react-admin, Formily:

1. **Separate the data model from a presentation overlay** (JSONForms data-schema vs UI-schema). Omit the overlay → auto-generate a usable default. Annotate to improve without rewriting.
2. **A type→widget mapping table** is the simple correct default. For our typed action selections: enum→dropdown/radio, boolean→toggle, number→stepper (carry min/max/integer), text→input/textarea, array→repeatable list, and crucially **element-ref → clickable on-board selection / picker** (react-admin's `ReferenceInput` pattern — the FK-becomes-picker idea maps exactly onto `chooseElement` + `boardRef`).
3. **Ranked-tester dispatch over a hardcoded switch** (JSONForms `rankWith`): renderers register with a tester returning a priority; highest wins, `-1` = not-applicable. New widgets register at higher priority instead of editing a central `if/else` chain. This replaces AutoElement's brittle `elementType` cascade with open, pit-of-success extensibility.

**Auto-generate-then-eject** (react-admin guessers): offer a "dump the generated UI as editable code" path so the auto-UI is a launchpad for the custom UI, not a dead end.

**Why auto-UIs usually suck — and how the good ones avoid it:**
- The **80/20 cliff**: fine in the sweet spot, abyss outside. The failure is the *missing escape route* for the last 20%, not the 80%. Principle: "make simple things simple and complex things possible with reasonable effort."
- **Generic look / weak affordances** ("uncanny UI"): generating from generic pixels yields buttons that don't read as buttons. Mitigation: **generate from real, production-tested components** (which already encode hover/focus/disabled/a11y), constrained by domain knowledge — not from guesses. BoardSmith already has these components.
- The usable ones: always render a sane default (guaranteed floor, never a blank screen); override via a separate overlay; make author overrides win mechanically; offer a graduated, **re-enterable** escape ramp.

---

## 4. The introspection surface — what we can infer vs. what authors must annotate

**Inferable automatically today (no author work):** element kind (`$type`/`className`), containment tree, container arrangement defaults (Hand fans, Deck stacks), turn/phase/active-seat, legal actions + selection schemas + live choices, per-player visibility (incl. face-down/count-only), player colors, undo availability, animation events.

**Already annotatable and sufficient:** `$type`/`$layout` tags, grid coords (`$rowCoord`/`$colCoord`/labels, hex `$qCoord`/`$rCoord`/`$hexOrientation`/`$hexSize`), `$images = {face, back}` (URL or sprite), visibility (`contentsVisible*`), ownership (`player.seat`/`color`), element `name` as notation key, and action metadata (`prompt`, `{value, display}` choices, `filter`/`choices` for legality, **`boardRef`/`boardRefs` linking a choice to a clickable board element**). MERC proves this is *already enough* to render every action as "prompt + buttons / board-highlight" — MERC just overrides it for theme.

**Gaps in the model that block a generic UI (these are architectural, weigh carefully):**
- **No absolute / free-form positioning** — only flexbox-style arrangement. The `free-form` layout enum value exists but has no per-element offset data behind it.
- **No adjacency / connection graph between spaces** — graph/route/map boards can't express edges the UI could draw or use for move hints. (Boardzilla has this via `graphology`-backed `ConnectedSpaceMap`/`AdjacencySpace` with `isAdjacentTo`/`distanceTo`/`adjacencies` — a strong precedent if we add it.)
- **No z-order/layering** beyond container order.
- Coordinate **indirection** — the UI must read `$rowCoord` then look up that attribute name on each cell; if the author omits it, positioning/labels degrade.

**Highest-leverage *new* annotations** (the custom UIs encode these by hand today):
1. **`$zone` / container role** — `'board' | 'hand' | 'group' | 'discard' | 'supply'`. MERC and Go Fish infer this fragilely from class names / name substrings. A declarative tag removes the guessing.
2. **`$owner` for per-player zones** — today parsed from element names like `area-{seat}` (there's literally a warning comment about this in MERC).
3. **`$image` / `$label` / `$thumbnail` for non-card pieces** — pieces are currently text-only; this closes the image-less-piece gap (the single biggest visual win).
4. **`$stats`** — which attributes form a visible stat block (labels/icons). MERC's `CombatantCard` hardcodes a 6-stat grid.
5. **Prefer declarative visibility over imperative gating** — `contentsVisibleToOwner()` over logic-gated `canSeeStash()`, so the auto-UI renders hidden info with zero game-specific code. (Pit-of-success.)
6. **Phase + scoring-summary hints** — a declared phase label/prompt surface (Cribbage and MERC switch whole control sets by phase, inferred today from a raw game attribute), and a convention marking a structured payload (Cribbage's `roundSummary` of `{category, points, cardIds, description}`) as "render as a score-breakdown overlay."
- *(Optional)* a per-selection `$render: 'buttons' | 'cards' | 'board-highlight'` hint so authors upgrade the default cheaply.

---

## 5. Concrete suggestions

Ordered roughly by leverage. These are proposals to discuss, not a committed plan.

### S1 — Replace the renderer, keep the plumbing
Rebuild `AutoGameBoard.vue` + `AutoElement.vue`; **reuse `useActionController`, `useBoardInteraction`, `GameShell` slot/context, and the animation composables unchanged.** This preserves the parity guarantee and is where ~all the value is. Do not touch the action state machine.

### S2 — Adopt a percentage-relative, recursively-composed layout engine
Port Boardzilla's *declarative vocabulary* (`area`/`margin`/`rows`/`columns`/`gap`/`scaling`/`alignment`/`offset*`/`limit`/`maxOverlap`/`aspectRatio`) onto our element tree, driven by `$layout` + `$direction`/`$gap`/`$overlap`/`$fan` (which we already have). **Implement the solver as discrete testable passes**, not one mega-function. Default behavior: divide space equally into the squarest fitting grid, scaled to the container — so zero config never produces a blank screen or an arbitrary 8×8.

### S3 — Per-topology default layouts with closed-form math
- **Square grid** → CSS Grid `repeat(N, 1fr)` + index↔pixel math (we have `useGameGrid`).
- **Hex** → Red Blob closed-form axial/cube→pixel (we have `useHexGrid`). Strongest zero-config case.
- **Hand** → fan via distant `transform-origin`, spread ÷ count (self-scaling).
- **Stack/deck** → constant offset + `maxOverlap` + count badge.
- **Graph/adjacency board** (*if* we add the adjacency primitive) → d3-force / Cytoscape CoSE for "good enough untuned," deterministic breadthfirst/grid where reproducibility matters.

### S4 — Ranked-tester renderer dispatch (internal to the auto-UI)
Replace AutoElement's `elementType` `if/else` cascade with a registry of element renderers, each with a tester `(element) => priority`. Built-ins (card/hand/deck/die/grid/hex/piece) register at low priority; a game can register a higher-priority renderer for one element type to *upgrade the auto-UI in place*. **Scope note (per P1):** this is for extending the auto-UI, not for building a custom UI. A custom UI is a separate peer component (S12), not a stack of renderer overrides — we deliberately do *not* offer Boardzilla's "override your way to a custom UI" path.

### S2b — Responsive layout, viewport-measured (per P2)
The layout solver reads the real container size from a `ResizeObserver`, not a declared board size; it relayouts on resize (animated via the existing FLIP diff). Provide **container-query / breakpoint primitives** so a layout rule can say "below width X, lay this hand out as a row instead of a fan" declaratively — never author `if (isDesktop)` branches. `aspectRatio` is a per-element constraint, not a global board dimension.

### S5 — Fix the two pit-of-failure points immediately
- **Card rendering**: drive entirely off `$images`/attributes, never a playing-card name regex. Standard 52-card decks become just a default sprite sheet, not a hardcoded assumption.
- **Piece rendering**: support `$image`/`$label`/`$thumbnail` so a token isn't forced to be a text box. Also eliminate the load-bearing "row/col must be the first two numeric attributes" fragility by always using declared `$rowCoord`/`$colCoord`.

### S6 — Make the action surface board-centric, not footer-centric
Use `boardRef`/`boardRefs` to render choices *on the board* (highlight the actual cell/card/sector) as the default, falling back to the panel only when there's no board anchor. Auto-anchor the prompt near the relevant element (Boardzilla's `updateControls`). This is the difference between "click a generic button list" and "click the thing."

### S7 — Two new generic renderers the games keep hand-rolling
- A **phase/prompt surface** that switches control sets off a declared phase (Cribbage, MERC).
- A **structured scoring/summary overlay** renderer keyed off a `{category, points, cardIds, description}` convention (Cribbage `roundSummary`).

### S8 — Extend the `$`-annotation vocabulary
Add `$zone`, `$owner`, `$image`/`$label`/`$thumbnail`, `$stats`, and the phase/summary hints (Section 4). Keep extending the existing `$`-property convention — do **not** invent a parallel UI-schema system; the "no guessing / no game-specific className checks" policy in AutoElement is the right one.

### S9 — Mechanical override layer
Ship all auto-UI CSS in a CSS `@layer` so author styles win without `!important`. Let authors override one element renderer (S4) or one layout rule (specificity cascade) without leaving the framework's data flow — the re-enterable escape hatch.

### S10 — Auto-generate-then-eject
Offer a "dump this game's generated UI as editable Vue components" command (react-admin guessers). Because UIs are peers (P1), the ejected component lands as a new registry entry (S12) — a real, owned custom UI you can switch to — so the auto-UI launches the custom UI instead of being thrown away. *(Repositioning the scaffold away from the split-screen comparison now lives in S12.)*

### S11 — Consider two model-level additions (bigger, discuss separately)
These unlock whole game categories the auto-UI otherwise can't touch:
- **A spatial adjacency / connection-graph primitive** (edges between spaces) — for routes, maps, area-control.
- **Optional per-element position offsets** to make `free-form` real.
Both are precedented in Boardzilla. They're engine changes, not UI changes, so they're a separate decision with broader implications.

### S12 — Multi-UI registry: dev-time switcher, single-UI production export (per P3)
This replaces the split-screen scaffold and the "auto-UI is a debug panel" framing with a first-class capability: a game has *several* UIs and you pick which to view.

**Why it's clean now (grounded in the current wiring):**
- Today there is **no UI registration layer at all** — a game's UI is simply whatever `App.vue` statically imports, and the scaffold *hard-imports* `AutoUI` into a two-column `App.vue` (`project-scaffold.ts:263-348`). That static import is the only reason AutoUI can't be tree-shaken out of a production build.
- The build (`build.ts`) runs two Vite builds; the **UI build (`build.ts:87-96`) is a plain SPA build with no `rollupOptions.input`/`lib`** — its entry is implicitly `index.html → src/main.ts → App.vue`. There's no UI selection and no exclusion.
- `boardsmith.json` is already the declared single source of truth that **both** `dev` and `build`/`manifest` read — the natural home for a UI declaration. (`paths.ui`/`paths.rules` exist but are read only by `dev`.)

**Proposed mechanics:**
1. **Declare UIs** in a registry — by symmetry with the existing `gameDefinition` export, either a sibling `uiDefinition` the game exports or (preferred) a `ui` map in `boardsmith.json`:
   ```
   "ui": {
     "default": "classic-2d",
     "uis": {
       "auto":       { "builtin": true },              // framework-provided; selectable as the shipped UI
       "classic-2d": { "entry": "src/ui/Classic2D.vue" },
       "webgl-3d":   { "entry": "src/ui/Chess3D.vue" }
     }
   }
   ```
   Each non-auto UI is a peer component (P1) that fills `#game-board` and talks to the controllers — **not** an override of the auto-UI. `auto` is one option among peers, never the substrate.
2. **Dev switcher** — add a host-chrome control modeled on the existing **follow-active-seat** toggle (`DevHost.vue:175-177, 283-291` + `multiplayer-host.ts:233-260`). Difference: follow is pure host state, but switching UI must change *which UI module the iframe renders*. Two viable hooks, both already precedented:
   - change the iframe `src`/query param (e.g. `/__boardsmith/play?ui=webgl-3d`) and let the game entry pick the UI from the registry — same "reload the iframe" pattern as `handleSwitchPlayer` (`GameShell.vue:1070-1081`); or
   - postMessage a `use-ui` instruction over the existing `shufflewick`/`shufflewick-game` bridge that the game entry honors without a reload.
   Either way you flip auto ↔ classic-2d ↔ webgl-3d (or v1 ↔ v2) against the **same** running session — no split screen.
3. **Single-UI production build** — make `build.ts` select the entry from the registry instead of relying on `index.html`'s static `main.ts`: generate an entry (or set `rollupOptions.input`) that imports only the selected UI's component (`--ui <name>` overriding the registry `default`). Because UIs are independent peers behind dynamic boundaries, the *unselected* ones drop out of the entry graph. The selected UI may be the auto-UI (a fine choice for simple games) or a custom peer; either way only one ships. Record the chosen UI in `dist/manifest.json`.

**Scaffold change:** stop generating the two-column `App.vue` comparison. Generate a game that opens in its chosen UI with the registry pre-seeded (`auto` + a stub `classic-2d`), so a new game is playable in the auto-UI immediately and the custom UI is an empty peer ready to fill — reinforcing "build rules first, swap in UI later." (This subsumes S10b.)

**Payoff:** your motivating cases fall straight out — chess as `auto` / top-down HTML / WebGL-3D is three registry entries; a v1-vs-v2 redesign is two entries you toggle against identical state; and production ships exactly one (whichever the game selects — auto-UI included).

---

## 6. Suggested phasing (for discussion)

1. **Multi-UI foundation (P3)**: S12 — the registry + dev switcher + single-UI build + reframed scaffold. Worth doing early: it removes the split-screen framing, makes the auto-UI a selectable peer (shippable or swappable), and gives a clean home for everything else. Can land before the renderer rebuild since it's mostly CLI/build/host wiring.
2. **Quick wins, no architecture change**: S5 (card/piece rendering), S8 partial (`$image`/`$label` on pieces). Immediately makes Hex/Checkers/Go Fish look like games.
3. **The renderer rebuild**: S1 + S4 (ranked dispatch, internal to auto-UI) + S2/S2b/S3 (responsive layout engine). The bulk of the work; turns the tree-dump into a real board.
4. **Board-centric interaction + missing renderers**: S6, S7, rest of S8.
5. **Polish & escape ramp**: S9, S10a (auto-generate-then-eject).
6. **Model extensions (separate track)**: S11.
7. **Migration & cleanup (mandatory final phase, S13)** — migrate *every* existing game to the new auto-UI/registry and delete the old paths. Per the project's "No Backward Compatibility" rule, the old AutoUI and the split-screen scaffold are removed, not deprecated. Nothing ships half-broken.

### S13 — Migrate all existing games; leave nothing broken (mandatory exit criterion)
This is not optional polish — it is the definition of "done." Because games live in **separate repos** that vendor BoardSmith (`~/BoardSmithGames/*`, `~/Dropbox/MERC/BoardSmith/MERC`), any change to the UI module, the `$`-annotation contract, the `gameView`/action protocol, or the scaffold is a **cross-repo migration**, exactly like the prior audit campaigns (re-vendor BoardSmith into each game, fix, verify). The migration scope:

- **Adopt the registry (S12) in every game** — replace each game's hand-written split-screen `App.vue` with a `ui` declaration + the chosen UI. Re-vendor the updated BoardSmith into each game repo.
- **Re-verify each game on the new auto-UI** — Hex, Go Fish, Checkers, Cribbage, and any others under `~/BoardSmithGames` must each be *playable* (not just renderable) on the rebuilt auto-UI, since that is the whole point. This doubles as the acceptance test for the renderer (phase 3) and for any new annotations (S8) — each game adds only the annotations it needs.
- **MERC** — has a fully custom UI and uses zero AutoUI, so it should be a *low-risk* migration: it becomes a single registry entry (`custom`) and must keep full action parity. But it is the canary for any breaking change to the shared plumbing (`useActionController`/`useBoardInteraction`/`gameView`) or GameShell chrome — if a "non-breaking" plumbing change breaks MERC, the peer-not-layer claim (P1) was violated.
- **Delete the old paths** — remove the legacy AutoUI renderer, the split-screen scaffold template (`project-scaffold.ts:263-348`), and any now-dead `AutoUI` re-exports, once all games are migrated. No deprecation cycle.
- **Docs** — update `custom-ui-guide.md`, `ui-components.md`, `component-showcase.md`, and the scaffold-generated READMEs to describe the registry + new auto-UI, and remove references to the split-screen pattern.
- **Exit criterion:** all example games green on the new auto-UI, MERC green on the new plumbing, the scaffold produces a playable game out of the box, the old AutoUI is gone, and `npm run audit` (dead-code + duplication) is clean. *Verify by actually playing each game in the browser, per the project testing rules — not just by passing unit tests.*

**Planning implication:** every earlier phase that touches the shared contract must treat "does this break the vendored games?" as a gating question, and the effort estimate must include the per-game migration cost (N game repos × re-vendor + fix + browser-verify), not just the BoardSmith-side work. This is the single most underestimated cost in the whole plan and the red team should scrutinize it.

---

## Appendix — Key files

**Replace (the renderer):**
- `src/ui/components/auto-ui/AutoElement.vue` — per-element renderer dispatch (`:108-138`), card sprite (`:252-291`), grid 8×8 fallback (`:608-657`)
- `src/ui/components/auto-ui/AutoGameBoard.vue` — layout heuristic (`:117-134`), FLIP/fly animation (`:254-406`)

**Reuse unchanged (the plumbing):**
- `src/ui/composables/useActionController.ts` — action state machine
- `src/ui/composables/useBoardInteraction.ts` — board↔panel bridge (ref match id→notation→name, `:207-217`)
- `src/ui/components/GameShell.vue` — host, context, `#game-board` slot (`:1256`), always-mounted ActionPanel (`:1281`)
- `src/ui/composables/useGameViewHelpers.ts`, `useGameGrid.ts`, `useHexGrid.ts`; animation composables; `Die3D`

**Engine metadata contract:**
- `src/engine/element/{card,hand,deck,die,grid,hex-grid,piece,space}.ts` — `$type`/`$layout` defaults
- `src/engine/action/action-builder.ts` — selection primitives
- `src/engine/element/game.ts` — `toJSONForPlayer` (`:2195`), `getSelectionChoices`, `getAvailableActions`
- `src/session/utils.ts` — `buildActionMetadata`; `src/types/protocol.ts` — `PickMetadata`/`ChoiceWithRefs`/`ValidElement`

**Reference implementation (Boardzilla):**
- Source of truth: `~/old/board_game_service/boardzilla-core/src` (games consume the compiled package under `~/old/boardzilla/*`)
- `ui/render.ts` — `applyLayouts` (`:64`), `calcLayouts` (`:263`), FLIP diff `applyDiff` (`:118`)
- `board/element.ts` — `layout()` (`:1105`), `appearance()` (`:1267`), `LayoutAttributes` docs (`:93-226`)
- `ui/lib.ts` — `updateSelections` (`:45`), `updateBoardSelections` (`:376`), `updateControls` (`:261`)

**Boilerplate the library should absorb (proven by MERC):**
- `~/Dropbox/MERC/BoardSmith/MERC/src/ui/composables/useGameViewHelpers.ts` (generic tree-walker)
- `…/useActionState.ts:253-387` (the `is*Hiring` flag wall — a templatable action-pick loop)
