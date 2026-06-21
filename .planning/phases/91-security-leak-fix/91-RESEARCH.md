# Phase 91: Security Leak Fix - Research

**Researched:** 2026-06-20
**Domain:** Engine serialization filter (`toJSONForPlayer`) — per-player visibility, `$`-key whitelist
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **The leak (root cause — verified this session):** `toJSONForPlayer` (`src/engine/element/game.ts:2195`) filters the element tree per viewer. Three branches preserve **all** `$`-prefixed attributes on elements the viewer cannot fully see: count-only mode (`:2205-2218`), hidden/count-only zone children (`:2244-2258`), owner-only zone non-owner viewer (`:2265-2287`). In all three, `$images` (carrying `{ face, back, ... }`) is copied verbatim. The fully-hidden placeholder branch (`:2222-2228`) is already safe — emits only `{ __hidden: true }`. Do not regress it.
- **SEC-01:** For an element the viewer cannot fully see, its serialized `$images` must not include image sides that reveal identity. A face-down card must still render a *back* but must not ship `face`. A single-sided `$image` on a hidden element is also identity-revealing and must be dropped.
- **SEC-02:** Replace the blanket `key.startsWith('$')` pass with an explicit allowlist (or explicit redaction) so unknown future `$`-keys cannot silently leak by inheriting the `$` prefix. Fail safe: unknown `$`-keys on hidden elements are treated as potentially sensitive, not auto-passed.
- **Engine stays UI-agnostic** — purely a serialization-filter change; no UI changes.
- **Secure-by-default** — the fix makes the *default* serialization safe without any opt-in from game authors.
- **No backward-compatibility shims.**
- **All existing tests must continue to pass.**

### Claude's Discretion

- The exact "which sides are safe to keep" rule — research determines the explicit redaction logic.
- Where the redaction helper should live in the file.

### Deferred Ideas (OUT OF SCOPE)

- Removing `$image`/`$images` from engine elements in favor of the per-UI presentation overlay — deferred to Phase 94 (PRESENT). This phase does not relocate the data; it only stops leaking it.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | A face-down / hidden card's face image refs (`$images.face`) are not sent to players who cannot see the card — `toJSONForPlayer` filters image refs by visibility. | Three branches in `toJSONForPlayer` must be updated to redact `$images.face` and drop `$image` entirely on hidden-to-viewer elements. Redaction rule: keep only `back` side from `$images`; drop `$image`. |
| SEC-02 | The `$`-attribute whitelist in `toJSONForPlayer` is audited and constrained to genuine layout descriptors, so no value-bearing data can ride the `$`-prefix to unauthorized players. | Full `$`-key catalog compiled below. Explicit allowlist of 18 safe layout keys identified. Two value-bearing keys (`$image`, `$images`) must be handled with special redaction, not pass-through. Unknown future `$`-keys fail safe (dropped on hidden elements). |
</phase_requirements>

---

## Summary

The root cause is verified: three branches in `toJSONForPlayer` use a blanket `key.startsWith('$')` guard to copy system attributes to anonymized/hidden child representations. This guard was designed when all `$`-keys were abstract layout descriptors (safe to broadcast). Today, `$image` and `$images` — declared on `GameElement` and used extensively in Go Fish and any game with card images — carry identity-bearing data. A face-down card in a hidden deck ships `$images.face: '/cards/ace-spades.png'` to every player. If filenames encode card identity (they do in Go Fish), this is a real information leak.

The fix is surgical: introduce one helper function, called from all three branches, that applies an explicit allowlist for pure layout `$`-keys, drops `$image` entirely on hidden elements, and partially redacts `$images` to only the `back` side. This gives the renderer just enough to draw a face-down card (a back image) without leaking the card's identity. The fully-hidden placeholder branch (`__hidden: true`, no children) is already correct and must not be touched.

No new packages are required. No UI changes are needed. The work is confined to `src/engine/element/game.ts` with new tests added to `src/engine/element/`.

**Primary recommendation:** Add a `redactHiddenElementAttrs(attrs)` helper above `toJSONForPlayer` in `game.ts`; call it from all three `$`-whitelist branches; add a focused test file proving no `$images.face` survives on any hidden-to-viewer element.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-player visibility filtering | Engine (`game.ts`) | — | `toJSONForPlayer` is the single authoritative filter; the UI never decides what to hide |
| Image ref redaction | Engine (`game.ts`) | — | Must happen before the state payload is constructed; the UI receives a pre-filtered tree |
| Rendering a back image on a face-down card | UI layer | — | UI reads the partially-redacted `$images: { back }` that the engine emits |
| Test verification of the fix | Engine test suite | — | Pure unit tests on `toJSONForPlayer` with known `$images` fixtures |

---

## Standard Stack

No new libraries. This phase modifies existing engine code only.

### Verification: No packages to install

The fix is a pure TypeScript change inside `src/engine/element/game.ts`. The test additions use the existing Vitest framework already present in the project.

---

## Package Legitimacy Audit

No packages to install for this phase. N/A.

---

## Architecture Patterns

### Complete $-Key Catalog (VERIFIED against current source)

All `$`-prefixed properties declared across `src/engine/element/` — verified by source inspection 2026-06-20:

**Safe to broadcast on hidden elements (pure layout/topology descriptors):** [VERIFIED: source grep]

| Key | Declared In | Type | Why Safe |
|-----|-------------|------|----------|
| `$type` | `Card`, `Deck`, `Die`, `Hand`, `DicePool`, `HexCell` | `string` literal | Names the element type (e.g. `'card'`), not the card's identity |
| `$layout` | `Grid`, `HexGrid` | `'grid' \| 'hex-grid'` | Names the layout algorithm, not element content |
| `$direction` | `Space` | `'horizontal' \| 'vertical'` | Layout direction |
| `$gap` | `Space` | `string` (CSS) | Visual spacing |
| `$overlap` | `Space` | `number` | Overlap ratio for stacked children |
| `$fan` | `Space` | `boolean` | Fan layout flag |
| `$fanAngle` | `Space` | `number` | Fan angle in degrees |
| `$align` | `Space` | `string` | Child alignment |
| `$rowLabels` | `Grid` | `string[]` | Grid row labels (e.g. `['8','7',...,'1']`) |
| `$columnLabels` | `Grid` | `string[]` | Grid column labels |
| `$rowCoord` | `Grid` | `string` | Name of the row-coord attribute on children |
| `$colCoord` | `Grid` | `string` | Name of the col-coord attribute on children |
| `$hexOrientation` | `HexGrid` | `'pointy' \| 'flat'` | Hex grid orientation |
| `$coordSystem` | `HexGrid` | `'axial' \| 'offset'` | Hex coordinate system |
| `$qCoord` | `HexGrid` | `string` | Attribute name for q-coord on cells |
| `$rCoord` | `HexGrid` | `string` | Attribute name for r-coord on cells |
| `$sCoord` | `HexGrid` | `string` | Attribute name for s-coord on cells |
| `$hexSize` | `HexGrid` | `number` | Visual hex cell size |

**Identity/value-bearing — must be redacted on hidden elements:** [VERIFIED: source grep]

| Key | Declared In | Type | Risk |
|-----|-------------|------|------|
| `$image` | `GameElement` (`:69`) | `ImageRef` | Single URL/sprite that identifies the element visually; reveals identity |
| `$images` | `GameElement` (`:76`) | `Record<string, ImageRef>` | Multi-side map; `face` key directly names the card face image; `face` URL encodes card identity in Go Fish (`/cards/AS.svg`) |

**Unknown future `$`-keys:** Treat as potentially sensitive on hidden elements — drop by default (fail safe).

### The Correct Redaction Rule for Hidden Elements

For a viewer who cannot see an element (any of the three hidden branches):

```
$image   → drop entirely (single-sided images always carry identity)
$images  → keep only the 'back' key if present; drop all other keys (face, any
           custom side names); if 'back' is absent, omit $images entirely
```

**Rationale for keeping `back`:** The renderer legitimately needs to draw a face-down card in a hidden deck. The `back` image is the neutral representation. Keeping it does not reveal which card it is — all cards in a hidden deck show the same back. Dropping `face` ensures the renderer cannot display (or even cache) the identity.

**Rationale for dropping `$image` entirely:** A `$image` on a hidden element has no safe "back" equivalent in the type — it is a single image that always identifies the element. Rendering a hidden single-sided element as a blank placeholder is correct behavior.

### System Architecture Diagram

```
toJSONForPlayer(player)
       │
       ▼
  filterElement(json, element)
       │
       ├──[element not visible to viewer]──► hidden placeholder { __hidden: true }  [SAFE — no change]
       │
       ├──[count-only, not visible]──────────► count-only stub  ──► redactHiddenElementAttrs(attrs)
       │                                                                    │
       ├──[zone hidden/count-only children]──► child loop       ──►  (same helper)
       │                                                                    │
       └──[owner-only zone, non-owner viewer]─► child loop      ──►  (same helper)
                                                                           │
                                                                    ┌──────▼──────────────────────┐
                                                                    │  redactHiddenElementAttrs   │
                                                                    │  • allowlist: $type,        │
                                                                    │    $layout, $direction,     │
                                                                    │    $gap, $overlap, $fan,    │
                                                                    │    $fanAngle, $align,       │
                                                                    │    $rowLabels/$columnLabels,│
                                                                    │    $rowCoord/$colCoord,     │
                                                                    │    $hexOrientation/Coord,   │
                                                                    │    $qCoord/$rCoord/$sCoord, │
                                                                    │    $hexSize                 │
                                                                    │  • $image → dropped         │
                                                                    │  • $images → { back } only  │
                                                                    │  • unknown $ → dropped      │
                                                                    └─────────────────────────────┘
```

### Recommended Project Structure (no new files for this phase)

The fix lives entirely in one existing file plus one new test file:

```
src/engine/element/
├── game.ts                   # Add redactHiddenElementAttrs() helper; update 3 branches
└── image-leak.test.ts        # New: focused SEC-01/SEC-02 unit tests (name TBD by planner)
```

### Pattern 1: redactHiddenElementAttrs helper

**What:** A pure function that filters a `Record<string, unknown>` of element attributes, preserving safe layout `$`-keys and redacting identity-bearing image refs.

**When to use:** Called from all three hidden-element branches in `toJSONForPlayer` before constructing the anonymized `systemAttrs` object.

**Placement:** Declare as a module-level (file-private) function directly above `toJSONForPlayer` in `game.ts`. This avoids polluting the class interface while making it naturally co-located with its only caller.

```typescript
// Source: verified against src/engine/element/game.ts:2195 + game-element.ts:69,76
// Allowlist covers all $ keys found in src/engine/element/ as of 2026-06-20.
const SAFE_LAYOUT_KEYS = new Set([
  '$type', '$layout',
  '$direction', '$gap', '$overlap', '$fan', '$fanAngle', '$align',
  '$rowLabels', '$columnLabels', '$rowCoord', '$colCoord',
  '$hexOrientation', '$coordSystem', '$qCoord', '$rCoord', '$sCoord',
  '$hexSize',
]);

function redactHiddenElementAttrs(
  attrs: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = { __hidden: true };

  for (const [key, value] of Object.entries(attrs)) {
    if (key === '__hidden') continue;            // already set above
    if (key === '$image') continue;             // identity-bearing — drop
    if (key === '$images') {
      // Keep only the 'back' side; other sides (face, custom) reveal identity
      const images = value as Record<string, unknown>;
      if (images?.back !== undefined) {
        safe.$images = { back: images.back };
      }
      continue;
    }
    if (SAFE_LAYOUT_KEYS.has(key)) {
      safe[key] = value;
    }
    // Unknown $-keys and all non-$, non-standard keys are dropped (fail safe)
  }

  return safe;
}
```

**Note on `__hidden`:** The three branches currently set `systemAttrs` to `{}` and then `systemAttrs['__hidden'] = true` — OR they initialize with `{ __hidden: true }`. The helper should set `__hidden: true` unconditionally (all callers need it) so the branches only need to call the helper and stop building `systemAttrs` manually.

### Pattern 2: Three call sites — before and after

**Branch 1 (count-only, lines ~2205-2218):**

Before:
```typescript
const systemAttrs: Record<string, unknown> = {};
for (const [key, value] of Object.entries(json.attributes ?? {})) {
  if (key.startsWith('$')) {
    systemAttrs[key] = value;
  }
}
return { className, id, name, attributes: systemAttrs, childCount };
```

After:
```typescript
return {
  className: json.className,
  id: json.id,
  name: json.name,
  attributes: redactHiddenElementAttrs(json.attributes ?? {}),
  childCount: element._t.children.length,
};
```

**Branch 2 (hidden/count-only zone children, lines ~2244-2258):**

Before:
```typescript
const systemAttrs: Record<string, unknown> = { __hidden: true };
for (const [key, value] of Object.entries(childJson.attributes ?? {})) {
  if (key.startsWith('$')) {
    systemAttrs[key] = value;
  }
}
hiddenChildren.push({ className: childJson.className, id: ..., attributes: systemAttrs });
```

After:
```typescript
hiddenChildren.push({
  className: childJson.className,
  id: -(element._t.id * 1000 + i),
  attributes: redactHiddenElementAttrs(childJson.attributes ?? {}),
});
```

**Branch 3 (owner-only zone, lines ~2265-2287):** Same pattern — replace the `key.startsWith('$')` loop with `redactHiddenElementAttrs(childJson.attributes ?? {})`.

### Anti-Patterns to Avoid

- **Redacting on `toJSON()`:** The blind serializer must not redact — it must serialize everything. `toJSONForPlayer` is the correct and only redaction site. [VERIFIED: CONTEXT.md, game-element.ts:699]
- **Calling `isVisibleTo()` again inside the helper:** The branches already know the element is hidden to the viewer. The helper should be a pure attribute transform with no visibility logic.
- **Adding a `back`-only check on the element itself:** Don't inspect `faceUp` or card state — the rule is purely about what the viewer is permitted to know. If the viewer cannot see the element at all, only the `back` image ref is safe regardless of the element's own face state.
- **Leaving the count-only branch (`:2205-2218`) unpatched:** It also copies `$images` verbatim today. All three branches must be updated.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Per-element visibility check | Custom traversal | Existing `element.isVisibleTo(visibilityPosition)` — already handles all visibility modes |
| Zone visibility lookup | Custom inspection | Existing `(element as any).getZoneVisibility?.()` — already used in `toJSONForPlayer` |
| Test setup for hidden deck | Manual test boilerplate | Existing `Deck`/`Hand` with `contentsHidden()`/`contentsVisibleToOwner()` from engine index |

**Key insight:** The entire visibility model is already implemented. This phase makes the filter use it correctly — not re-implement it.

---

## Common Pitfalls

### Pitfall 1: Patching only the card/face-down path, missing the count-only branch

**What goes wrong:** Developer focuses on "hidden deck cards" (branch 2), forgets the count-only branch (`:2205-2218`) which also copies `$images` verbatim.

**Why it happens:** The count-only branch is for the *container* (the deck element itself when shown count-only), not its children. A container could carry `$images: { face, back }` (Go Fish's pond does — but only sets `back`; a future game could set `face` there too).

**How to avoid:** The helper is called from all three branches, not just the one that handles card children.

**Warning signs:** A test that checks hidden *children* passes, but a `count-only` element still leaks `$images.face`.

### Pitfall 2: Dropping `back` from `$images`, breaking back-of-card rendering

**What goes wrong:** The fix drops ALL of `$images`, so hidden decks render as blank boxes with no back-of-card image, breaking the Go Fish pond UI.

**Why it happens:** It's tempting to simply delete `$images` entirely as the "safe" choice.

**How to avoid:** Keep the `back` key. The invariant is "viewer learns nothing about the element's *identity*" — not "viewer sees nothing." The back image is the same for every card in a deck; it reveals nothing about which card this is.

**Warning signs:** Go Fish pond shows blank rectangles instead of card backs after the fix.

### Pitfall 3: Trusting `$image` on a hidden element is "just the back"

**What goes wrong:** A developer sees a card with `$image: '/cards/card-back.png'` and reasons "this is clearly a back image, safe to pass through."

**Why it happens:** Game authors sometimes use `$image` for back-only representations (e.g. `this.pond.$images = { back: '...' }`). But the engine cannot know from the attribute name alone whether a `$image` is a face or a back — it is typed as a single `ImageRef` with no semantic label.

**How to avoid:** Drop `$image` entirely on hidden elements, without exception. If a game needs a hidden element to show a back, it should use `$images: { back: '...' }` not `$image`. The fix enforces this convention by construction.

**Warning signs:** A test passes because the test's `$image` happened to be a back image, masking the type-level ambiguity.

### Pitfall 4: Not testing the `owner` zone branch

**What goes wrong:** Tests only cover `contentsHidden()` (branch 2 / hidden/count-only children). The `contentsVisibleToOwner()` branch (3) leaks too but has no test coverage.

**How to avoid:** The test fixture must include both a `contentsHidden()` deck and a `contentsVisibleToOwner()` hand. Assert on both a player viewing the hidden deck AND a non-owner viewing the opponent's hand.

---

## Code Examples

### Test Fixture Pattern (Go Fish-style)

```typescript
// Source: go-fish/src/rules/game.ts:87-93 + deck-hand-visibility.test.ts structure
class TestCard extends Card<TestGame> {
  rank!: string;
  suit!: string;
}

// In test beforeEach:
const deck = game.create(Deck, 'draw-pile');
deck.contentsHidden();
deck.create(TestCard, 'AS', {
  rank: 'A',
  suit: 'S',
  $images: { face: '/cards/AS.svg', back: '/cards/back.svg' },
});

const hand = game.create(Hand, 'hand-p1');
hand.player = game.getPlayer(1)!;
hand.contentsVisibleToOwner();
hand.create(TestCard, 'KH', {
  rank: 'K',
  suit: 'H',
  $images: { face: '/cards/KH.svg', back: '/cards/back.svg' },
});
```

### Assertion Pattern (SEC-01)

```typescript
// Player 2 cannot see deck contents or player 1's hand
const view = game.toJSONForPlayer(2);

// Find hidden deck child
const deckJson = view.children!.find(c => c.name === 'draw-pile')!;
const hiddenCard = deckJson.children![0];

// Must have __hidden flag
expect(hiddenCard.attributes.__hidden).toBe(true);
// Must NOT leak face
expect((hiddenCard.attributes.$images as any)?.face).toBeUndefined();
// MUST still have back (for rendering)
expect((hiddenCard.attributes.$images as any)?.back).toBe('/cards/back.svg');
// Must still have $type (for renderer dispatch)
expect(hiddenCard.attributes.$type).toBe('card');
```

### Regression Guard (SEC-02)

```typescript
// Walk all attributes in the player-2 view and assert no $images.face exists anywhere
function collectAllHiddenAttrs(json: ElementJSON): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  if (json.attributes?.__hidden) result.push(json.attributes);
  for (const child of json.children ?? []) {
    result.push(...collectAllHiddenAttrs(child));
  }
  return result;
}

const hiddenAttrs = collectAllHiddenAttrs(game.toJSONForPlayer(2));
for (const attrs of hiddenAttrs) {
  const images = attrs.$images as Record<string, unknown> | undefined;
  expect(images?.face).toBeUndefined();
  expect(attrs.$image).toBeUndefined();
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Blanket `key.startsWith('$')` pass | Explicit allowlist + per-key redaction | Closes current leak; blocks future leaks from new value-bearing `$`-keys |

**Deprecated/outdated:**
- `key.startsWith('$')` as a safety predicate — was only ever correct while all `$`-keys were guaranteed to be abstract layout descriptors. Now that `$images` carries game data, this predicate is incorrect for hidden-element filtering.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The only identity-bearing `$`-keys in the current engine are `$image` and `$images`; all others are layout descriptors safe to broadcast | $-Key Catalog | If a game-authored subclass adds a value-bearing `$`-key unknown to the allowlist, SEC-02's fail-safe (drop unknown `$`-keys) covers it. Low risk. |
| A2 | Keeping `$images.back` on hidden elements does not reveal identity (all cards in a hidden deck share the same back image in practice) | Redaction Rule | If a game sets different back images per card, the back image could encode partial identity. The engine cannot enforce "all backs are identical" — but this is a game-author concern, not an engine defect. The fix is correct at the engine level. |

---

## Open Questions

1. **Should the allowlist be exported or remain file-private?**
   - What we know: The allowlist is currently only needed in `game.ts`; Phase 94 (PRESENT) may need to audit it again when removing `$image`/`$images` from engine elements.
   - What's unclear: Whether having it in an internal constant vs. an exported set is more useful for Phase 94.
   - Recommendation: Keep it file-private for now (it is an implementation detail of `toJSONForPlayer`). Phase 94 can promote it if needed.

2. **Does `count-only` on a non-card container element with `$image` need the same redaction?**
   - What we know: The count-only branch (`:2205-2218`) applies to the element itself (the container), not its children. Go Fish's pond has `$images: { back: ... }` on the Deck container, but no `face` key — so today no leak there. A future game could set `$image: 'board-tile.png'` on a count-only zone; that would currently be broadcast.
   - Recommendation: Apply `redactHiddenElementAttrs` uniformly to all three branches. Redacting a non-present `face` key is a no-op.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is a pure code/config change with no external dependencies beyond the existing Vitest test runner (already confirmed available and green).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/engine/element/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Hidden card's `$images.face` is absent in per-player serialization | unit | `npx vitest run src/engine/element/image-leak.test.ts` | ❌ Wave 0 |
| SEC-01 | Hidden card's `$images.back` IS present (renderer can draw back) | unit | same file | ❌ Wave 0 |
| SEC-01 | Owner-only zone: non-owner does not receive `$images.face` on any child | unit | same file | ❌ Wave 0 |
| SEC-02 | No unknown `$`-key leaks through the filter on a hidden element | unit | same file | ❌ Wave 0 |
| SEC-02 | `$image` is absent from all hidden-element attribute objects | unit | same file | ❌ Wave 0 |
| SEC-01 + SEC-02 | Existing F32 deck/hand visibility tests still pass | regression | `npx vitest run src/engine/element/deck-hand-visibility.test.ts` | ✅ |
| SEC-01 + SEC-02 | Existing per-player serialization tests still pass | regression | `npx vitest run src/engine/element/game-element.test.ts` | ✅ |
| SEC-01 + SEC-02 | Full engine suite stays green | regression | `npx vitest run` | ✅ |

### Sampling Rate

- **Per task commit:** `npx vitest run src/engine/element/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/engine/element/image-leak.test.ts` — covers SEC-01 and SEC-02; must be created before or alongside the fix

*(Existing test infrastructure for Vitest, Deck, Hand, Card, and `toJSONForPlayer` is in place — only the new test file is missing.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Engine `isVisibleTo()` + zone visibility model — already implemented, this phase uses it correctly |
| V5 Input Validation | no | — |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Image URL encodes card identity → viewer reconstructs face from filename | Information Disclosure | Redact `$images.face` in `toJSONForPlayer` before the state payload is sent |
| New value-bearing `$`-key silently inherits the `$`-prefix whitelist | Information Disclosure | Explicit allowlist + fail-safe drop for unknown `$`-keys |

---

## Sources

### Primary (HIGH confidence)

- `src/engine/element/game.ts:2195-2320` — `toJSONForPlayer` and the three `$`-whitelist branches: inspected directly this session
- `src/engine/element/game-element.ts:64-76,699-736` — `$image`, `$images` declarations and `toJSON()`: inspected directly this session
- `src/engine/element/card.ts` — `$type`, `faceUp` canonical face-down case: inspected directly this session
- `src/engine/element/space.ts:70-99` — all Space layout `$`-properties: inspected directly this session
- `src/engine/element/grid.ts`, `hex-grid.ts`, `deck.ts`, `hand.ts`, `die.ts`, `dice-pool.ts` — remaining `$`-property declarations: grep-verified this session
- `src/engine/element/deck-hand-visibility.test.ts` — existing F32 regression tests: inspected and confirmed green
- `src/engine/element/game-element.test.ts` — existing visibility + serialization tests: inspected and confirmed green
- `BoardSmithGames/go-fish/src/rules/game.ts:52,87-92` — confirmed `$images: { face, back }` pattern on real cards: inspected this session

### Secondary (MEDIUM confidence)

- `.planning/phases/91-security-leak-fix/91-CONTEXT.md` — root cause synthesis from earlier session, confirmed against current code
- `docs/auto-ui-redesign-research.md §0 C7` — security blocker identification

---

## Metadata

**Confidence breakdown:**
- $-key catalog: HIGH — enumerated by source grep; all files inspected
- Redaction rule (keep `back`, drop `face`/`$image`): HIGH — follows directly from the semantic of the keys and the visibility invariant stated in CONTEXT.md
- Three branches needing the fix: HIGH — verified by line-by-line reading of `toJSONForPlayer`
- Helper placement in `game.ts`: HIGH — single caller, co-location is idiomatic
- Test fixture (Go Fish-style deck + hand): HIGH — confirmed Go Fish uses `$images: { face, back }` on every card

**Research date:** 2026-06-20
**Valid until:** Stable — engine serialization changes slowly; valid until `toJSONForPlayer` is replaced or `$image`/`$images` are removed in Phase 94
