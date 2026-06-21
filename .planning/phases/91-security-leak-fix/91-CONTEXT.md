# Phase 91: Security Leak Fix - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Source:** Synthesized from milestone research (`docs/auto-ui-redesign-research.md` §0 C7 + `.planning/research/SUMMARY.md`), with the root cause re-verified against current code this session.

<domain>
## Phase Boundary

Close the information leak where a hidden element's `$`-prefixed presentation data — specifically `$images.face` — is serialized to players who are not allowed to see that element. Covers SEC-01 (filter image refs by visibility) and SEC-02 (audit the `$`-whitelist so only genuine layout descriptors pass to unauthorized viewers).

**In scope:** the per-player serialization filter in `toJSONForPlayer` and the `$`-attribute whitelist it applies to hidden / count-only / owner-only elements and children.

**Out of scope:** the broader auto-UI renderer rebuild, the presentation-overlay design, and removing `$image`/`$images` from engine elements entirely (that is the later presentation-overlay work — Phase 94 PRESENT). This phase is a *surgical security fix*, not the architectural move.
</domain>

<decisions>
## Implementation Decisions (locked)

### The leak (root cause — verified this session)
- `toJSONForPlayer` (`src/engine/element/game.ts:2195`) filters the element tree per viewer. Three branches preserve **all** `$`-prefixed attributes on elements the viewer cannot fully see:
  - count-only element not visible to viewer — `game.ts:2205-2218`
  - zone `hidden`/`count-only` children (e.g. a `contentsHidden()` deck) — `game.ts:2244-2258`
  - owner-only zone, non-owner viewer (e.g. an opponent's `contentsVisibleToOwner()` hand) — `game.ts:2265-2287`
- In all three, `$images` (which carries `{ face, back, ... }`) is copied verbatim. So a face-down card in a hidden deck, or a card in an opponent's hand, ships its `$images.face` URL to a player who must not know the card's identity. If face filenames encode identity (e.g. `cards/ace-spades.png`), the card is leaked.
- The fully-hidden placeholder branch (`game.ts:2222-2228`) is already safe — it emits only `{ __hidden: true }`. Do not regress it.
- `$image`/`$images` are declared on the base `GameElement` (`src/engine/element/game-element.ts:69,76`), typed `ImageRef`. The blind serializer `GameElement.toJSON()` (`game-element.ts:699`) copies them; the per-player filter is the correct and only place to redact them.

### SEC-01 — filter image refs by visibility
- For an element the viewer cannot fully see, its serialized `$images` must not include image sides that would reveal identity the viewer isn't entitled to. A face-down card must still be renderable as a *back* (keep the `back` side / the back image) but must not ship `face` (or any non-visible side).
- The safe default for a hidden/anonymized element: drop `$images.face` (and any side beyond what a hidden element legitimately shows); a single-sided `$image` on a hidden element is also identity-revealing and must be dropped unless it is the element's "hidden" appearance.
- The exact "which sides are safe to keep" rule is Claude's discretion, but the invariant is: **a viewer who cannot see an element learns nothing about its identity from its serialized image refs.**

### SEC-02 — audit the `$`-whitelist
- The current whitelist treats *every* `$`-prefixed key as "safe to broadcast." That assumption is only valid for genuine abstract-layout descriptors (`$type`, `$layout`, `$direction`, `$gap`, `$overlap`, `$fan`, `$align`, coordinate descriptors, etc.).
- Value-bearing / identity-bearing `$`-keys (`$images`, `$image`) must NOT pass the whitelist unredacted on hidden elements.
- Replace the blanket `key.startsWith('$')` pass with an explicit allowlist (or explicit redaction) so a future value-bearing `$`-key cannot silently leak by inheriting the `$` prefix. Fail safe: unknown `$`-keys on hidden elements should be treated as potentially sensitive, not auto-passed.

### Constraints
- Engine must stay UI-agnostic; this is purely a serialization-filter change. No UI changes.
- Pit of Success / secure-by-default: the fix must make the *default* serialization safe, not require games to opt in.
- All existing tests must continue to pass; add tests proving the redaction (see Success Criteria).
- No backward-compatibility shims.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The fix site
- `src/engine/element/game.ts:2195-2320` — `toJSONForPlayer` and its three `$`-whitelist branches (the only place to redact).
- `src/engine/element/game-element.ts:64-76,699-733` — where `$image`/`$images` live and how `toJSON()` copies them.
- `src/engine/element/types.ts` — `ImageRef` type and `ElementJSON` shape.

### Visibility model (to honor — do not re-implement)
- `src/engine/element/game-element.ts:647` — `isVisibleTo(player)`.
- `src/engine/element/space.ts` — zone visibility (`contentsHidden`/`contentsVisibleToOwner`/`getZoneVisibility`).
- `src/engine/element/card.ts` — `faceUp`/`$images` usage for cards (the canonical face-down case).

### Decision source
- `docs/auto-ui-redesign-research.md` — §0 correction **C7** (security blocker) and the "independent security bug" note.
- `.planning/research/SUMMARY.md` — "Independent security bug (in scope this milestone)".
</canonical_refs>

<specifics>
## Specific Ideas

- The cleanest test fixture is **Go Fish**: opponent hands are `contentsVisibleToOwner()` and the pond/deck is `contentsHidden()` — assert a player's serialized view contains no `face` image ref for cards they can't see.
- A focused unit test directly on `toJSONForPlayer` with a `contentsHidden()` deck of cards carrying `$images: { face, back }` is the most direct proof.
- Consider a regression guard: a test that scans a hidden element's serialized attributes and asserts no known identity-bearing `$`-key (`$images.face`, identity `$image`) survives.
</specifics>

<deferred>
## Deferred Ideas

- Removing `$image`/`$images` from engine elements in favor of the per-UI presentation overlay — deferred to Phase 94 (PRESENT). This phase does not relocate the data; it only stops leaking it.
</deferred>

---

*Phase: 91-security-leak-fix*
*Context synthesized: 2026-06-20 (root cause verified against current code)*
