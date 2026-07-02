// @vitest-environment jsdom
/**
 * DOM-leak test utility for hidden info (VIS-03).
 *
 * Renders a game's AutoUI headlessly as a given seat and fails when a hidden
 * element's identity (rank/suit/face-image, or any custom attribute) leaks
 * into the rendered markup.
 *
 * Forbidden markers are derived by diffing each element's FULL unfiltered
 * `el.toJSON()` identity against what actually SURVIVES into seat N's FINAL
 * per-seat tree (`game.toJSONForPlayer(seat)`, post-`playerView`,
 * game.ts:2671-2819) — never from a hardcoded field list ('rank'/'suit'/...)
 * and never by trusting the engine's own redaction allowlist
 * (`redactHiddenElementAttrs`'s `SAFE_LAYOUT_KEYS`) as ground truth. This
 * closes two blind spots:
 *   1. Unknown/custom per-game attribute names are covered (not just a fixed
 *      identity-field list).
 *   2. Content a game's `static playerView` hook strips AFTER the engine's
 *      own visibility filter is still treated as forbidden — the matcher
 *      never trusts `isVisibleTo` alone (see `visibility.ts`, VIS-01).
 *
 * @module
 */

import { mount, type VueWrapper } from '@vue/test-utils';
import type { default as AutoUIComponent } from '../ui/components/auto-ui/AutoUI.vue';
import type { GameElement as UIGameElement } from '../ui/components/auto-ui/index.js';
import { GameElement, type ElementJSON, type Game } from '../engine/index.js';
import type { TestGame } from './test-game.js';

/**
 * The shape `renderAsSeat`/`assertNoHiddenInfoLeak`'s `gameViewOverride` (and
 * the AutoUI `gameView` prop) accept — structurally identical to
 * `ElementJSON` (id/className/attributes/children/childCount/name, plus the
 * UI's own `__hidden` convenience flag). Exported so callers constructing a
 * deliberately-leaky override (e.g. `game.toJSON()`, or a mutated
 * `getPlayerView(seat).state`) have a name for the cast instead of reaching
 * for `any`.
 */
export type HiddenInfoGameView = UIGameElement;

// ---------------------------------------------------------------------------
// jsdom does not implement `window.matchMedia`. `useElementAnimation.ts` reads
// it at MODULE LOAD time (`prefersReducedMotion` top-level ref), and it is
// pulled in transitively by AutoRenderer's `useFlyingElements()` call — so
// mounting `AutoUI` for real (no stubs; we need the actual renderers to
// exercise the real leak surface) throws before this utility can render
// anything. This supplies the browser API jsdom omits (matching what a real
// browser provides) — it does not stub/alter any BoardSmith behavior.
//
// The polyfill MUST run before `AutoUI.vue`'s module graph is evaluated. A
// static `import AutoUI from '...'` at the top of this file would be hoisted
// and evaluated before ANY of this file's own code runs (ESM import
// ordering), which is too late. So `AutoUI` is loaded via a runtime dynamic
// `import()` (see `loadAutoUI`), deferring its module graph evaluation until
// after the polyfill is installed. (Rule 3: auto-fixed blocking issue.)
// ---------------------------------------------------------------------------
function ensureMatchMediaPolyfill(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia === 'function') return;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

let autoUIComponentPromise: Promise<typeof AutoUIComponent> | undefined;

/** Install the matchMedia polyfill, then dynamically import AutoUI (cached). */
function loadAutoUI(): Promise<typeof AutoUIComponent> {
  if (!autoUIComponentPromise) {
    ensureMatchMediaPolyfill();
    autoUIComponentPromise = import('../ui/components/auto-ui/AutoUI.vue').then(
      (mod) => mod.default,
    );
  }
  return autoUIComponentPromise;
}

/**
 * Mount AutoUI headlessly as `seat`, using the real per-seat wire view
 * (`testGame.getPlayerView(seat).state`) unless `gameViewOverride` is given.
 *
 * `gameViewOverride` exists ONLY so `assertNoHiddenInfoLeak`'s own tests can
 * prove the matcher fails on a deliberately-injected leak (a leak-detector
 * with no failing case is unproven) — real callers should never pass it,
 * since it renders something other than what a real client would receive.
 *
 * @param testGame - The TestGame wrapper
 * @param seat - The seat to render as
 * @param gameViewOverride - TESTING-ONLY: render this view instead of the real per-seat view
 */
export async function renderAsSeat<G extends Game>(
  testGame: TestGame<G>,
  seat: number,
  gameViewOverride?: UIGameElement | null,
): Promise<VueWrapper<InstanceType<typeof AutoUIComponent>>> {
  const AutoUI = await loadAutoUI();

  const gameView =
    gameViewOverride !== undefined
      ? gameViewOverride
      : ((testGame.getPlayerView(seat).state as unknown) as UIGameElement);

  return mount(AutoUI, {
    props: {
      gameView,
      playerSeat: seat,
    },
  });
}

/**
 * A predicate allowlist: returns `true` for a marker that is a known,
 * legitimate false positive (e.g. a visible turn counter that happens to
 * equal a hidden card's rank) and should NOT fail the assertion.
 *
 * A narrow predicate (scoped to specific marker values/attributes) cannot
 * silently mask a real leak the way a broad allowlist could — the allowlist
 * test in dom-leak.test.ts proves a real leak still fails when a legitimate
 * overlapping value is exempted.
 */
export type HiddenInfoLeakAllowPredicate = (
  marker: string,
  context: { attribute?: string; elementId: number; elementLabel: string },
) => boolean;

export interface AssertNoHiddenInfoLeakOptions {
  /** Caller-supplied allowlist predicate — see {@link HiddenInfoLeakAllowPredicate}. */
  allow?: HiddenInfoLeakAllowPredicate;
  /**
   * TESTING-ONLY: render this view instead of `testGame.getPlayerView(seat).state`.
   * See {@link renderAsSeat}. Real callers should never set this.
   */
  gameViewOverride?: UIGameElement | null;
}

interface ForbiddenMarker {
  value: string;
  attribute?: string;
  elementId: number;
  elementLabel: string;
}

/** Depth-first index of an ElementJSON tree by node id (real ids AND synthetic negative ids). */
function indexNodesById(node: ElementJSON, into: Map<number, ElementJSON>): void {
  into.set(node.id, node);
  if (node.children) {
    for (const child of node.children) {
      indexNodesById(child, into);
    }
  }
}

/**
 * Coerce a primitive attribute value to its string identity form (rank/suit/etc.).
 *
 * Booleans are deliberately excluded: `true`/`false` are near-universal
 * substrings (e.g. `data-animatable="true"`, `aria-pressed="true"` appear on
 * essentially every interactive element), so treating a boolean attribute
 * (like `Card.faceUp`) as an identity candidate would false-positive on
 * almost any rendered page — the same class of problem as the short-numeric
 * collision risk this utility already scopes its DOM scan to avoid
 * (RESEARCH Pitfall 3), just guaranteed rather than merely likely.
 */
function stringifyScalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Coerce a `$image`/`$images.<side>` value (string URL or sprite descriptor) to an identity string. */
function stringifyImageValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'sprite' in (value as Record<string, unknown>)) {
    const sprite = (value as { sprite?: unknown }).sprite;
    return typeof sprite === 'string' ? sprite : undefined;
  }
  return undefined;
}

/**
 * Extract identity candidate values from an element's FULL unfiltered
 * `toJSON()` output: `name` plus every non-`$`-prefixed attribute (game data
 * like rank/suit/etc.), plus `$image`/`$images.face` specifically (the
 * identity-bearing image refs). Other `$`-prefixed keys ($type, $layout,
 * $direction, ...) are structural/layout metadata shared by every element of
 * that shape, never per-element secret identity, so they are not candidates
 * (this is an independent judgment call, NOT a reliance on
 * `redactHiddenElementAttrs`'s allowlist as ground truth for what is caught).
 *
 * `$images.back` is deliberately excluded too: by design (and by every
 * renderer's own T-93-04 behavior) a card's back image is shown for EVERY
 * hidden card of that type regardless of identity — it is intentionally
 * NOT identity-bearing (the whole point of a card back is that it looks the
 * same face-down). Treating it as forbidden would false-positive on every
 * correctly-redacted hidden card whose anonymized placeholder legitimately
 * renders that same back image (see `redactHiddenElementAttrs`, which keeps
 * `$images.back` for exactly this reason).
 */
function extractIdentityCandidates(
  json: ElementJSON,
): Array<{ attribute?: string; value: string }> {
  const candidates: Array<{ attribute?: string; value: string }> = [];

  if (json.name) {
    candidates.push({ attribute: 'name', value: json.name });
  }

  for (const [key, value] of Object.entries(json.attributes ?? {})) {
    if (key === '$image') {
      const s = stringifyImageValue(value);
      if (s) candidates.push({ attribute: '$image', value: s });
      continue;
    }
    if (key === '$images') {
      const images = value as Record<string, unknown> | undefined;
      if (images && typeof images === 'object') {
        for (const [side, imgVal] of Object.entries(images)) {
          if (side === 'back') continue; // not identity-bearing — see doc comment above
          const s = stringifyImageValue(imgVal);
          if (s) candidates.push({ attribute: `$images.${side}`, value: s });
        }
      }
      continue;
    }
    if (key.startsWith('$')) continue; // structural/layout system metadata — not identity
    const s = stringifyScalar(value);
    if (s !== undefined) candidates.push({ attribute: key, value: s });
  }

  return candidates;
}

/** Every attribute value (+ name) that survives on a FINAL tree node (excluding `__hidden`). */
function collectSurvivingValues(node: ElementJSON): Set<string> {
  const values = new Set<string>();
  if (node.name) values.add(node.name);

  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (key === '__hidden') continue;
    if (key === '$images' && value && typeof value === 'object') {
      for (const imgVal of Object.values(value as Record<string, unknown>)) {
        const s = stringifyImageValue(imgVal);
        if (s) values.add(s);
      }
      continue;
    }
    if (key === '$image') {
      const s = stringifyImageValue(value);
      if (s) values.add(s);
      continue;
    }
    const s = stringifyScalar(value);
    if (s !== undefined) values.add(s);
  }

  return values;
}

/**
 * Derive the forbidden-marker set for `seat`: for every live element, compare
 * its FULL unfiltered identity against what survives into seat N's FINAL
 * per-seat tree (`game.toJSONForPlayer(seat)`, post-`playerView`).
 */
function deriveForbiddenMarkers(game: Game, seat: number): ForbiddenMarker[] {
  const finalTree = game.toJSONForPlayer(seat) as ElementJSON;
  const nodesById = new Map<number, ElementJSON>();
  indexNodesById(finalTree, nodesById);

  const markers: ForbiddenMarker[] = [];

  for (const element of game.all(GameElement)) {
    const unfiltered = element.toJSON();
    const candidates = extractIdentityCandidates(unfiltered);
    if (candidates.length === 0) continue;

    const elementLabel = `${element.constructor.name}#${element.id}`;
    const node = nodesById.get(element.id);
    const elementHidden = !node || node.attributes?.__hidden === true;

    if (elementHidden) {
      // Absent from the final tree, or present only as a `__hidden` placeholder:
      // every identity candidate is forbidden.
      for (const c of candidates) {
        markers.push({ value: c.value, attribute: c.attribute, elementId: element.id, elementLabel });
      }
    } else {
      // Element is visible in the final tree — only candidates the final tree
      // did NOT preserve (stripped by redaction OR a `static playerView` hook)
      // are forbidden.
      const surviving = collectSurvivingValues(node);
      for (const c of candidates) {
        if (!surviving.has(c.value)) {
          markers.push({ value: c.value, attribute: c.attribute, elementId: element.id, elementLabel });
        }
      }
    }
  }

  // Never treat an empty string as a marker — every value would trivially match.
  return markers.filter((m) => m.value.length > 0);
}

/**
 * Text-bearing accessibility/metadata attributes scanned in addition to
 * `data-*`. BoardSmith's own `AutoUI` renderers actively write
 * element-derived identity (e.g. a card's `name`/notation) into exactly
 * these attributes — `CardRenderer.vue`'s `ariaLabel`/`displayLabel`
 * (aria-label/alt), `GridBoardRenderer.vue`'s cell `title`, and similar
 * `aria-label` bindings across `PieceRenderer.vue`/`DieRenderer.vue`/
 * `SpaceRenderer.vue`/`DeckRenderer.vue`/`HexBoardRenderer.vue`. A hidden
 * element's identity leaking through any of these would otherwise go
 * completely undetected (CR-01).
 */
const IDENTITY_BEARING_ATTRS = ['aria-label', 'alt', 'title', 'aria-description', 'aria-roledescription'];

/**
 * Scan ONLY the surfaces a hidden identity value could realistically leak
 * through: `data-*` attribute values, `img[src]`, inline
 * `style="background-image: url(...)"` fragments (sprite-sheet rendering),
 * and the text-bearing accessibility/metadata attributes in
 * {@link IDENTITY_BEARING_ATTRS} (aria-label/alt/title/etc. — CR-01).
 *
 * Deliberately NOT a blind `wrapper.text()` substring search — a bare text
 * scan false-positives on short numeric ranks/suits colliding with visible
 * turn counters, scores, or player names (RESEARCH Pitfall 3).
 */
function collectScopedSurfaceStrings(wrapper: VueWrapper<unknown>): string[] {
  const root = wrapper.element as HTMLElement;
  const surfaces: string[] = [];

  const visit = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) {
        surfaces.push(attr.value);
      }
    }
    for (const attrName of IDENTITY_BEARING_ATTRS) {
      const value = el.getAttribute(attrName);
      if (value) surfaces.push(value);
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src');
      if (src) surfaces.push(src);
    }
    const style = el.getAttribute('style');
    if (style && style.includes('background-image')) {
      surfaces.push(style);
    }
  };

  visit(root);
  root.querySelectorAll('*').forEach(visit);

  return surfaces;
}

/**
 * Render `testGame` as `seat` (headlessly, via `renderAsSeat`) and throw if
 * any hidden element's identity leaks into the rendered markup.
 *
 * Forbidden markers are auto-derived from the difference between each
 * element's FULL unfiltered `toJSON()` identity and what survives into
 * seat N's FINAL per-seat tree — see {@link deriveForbiddenMarkers}. This
 * honors a game's `static playerView` hook (content the hook strips is
 * forbidden too) and never relies on a hardcoded identity-field list.
 *
 * KNOWN LIMITATION (WR-01): boolean-valued attributes are NEVER treated as
 * identity candidates (see {@link stringifyScalar}) — `true`/`false` collide
 * with near-universal DOM substrings (`data-animatable="true"`,
 * `aria-pressed="true"`, etc.), so including them would false-positive on
 * almost any rendered page. This is safe for boolean *state* flags like
 * `Card.faceUp`, but if your game's HIDDEN information is itself a boolean
 * (e.g. a secret "isSpy" role flag, a hidden coin-flip result), this
 * assertion will NEVER catch it leaking. Supplement with `assertHidden`/
 * `isElementVisible` checks (see `visibility.ts`) for boolean secrets.
 *
 * @param testGame - The TestGame wrapper
 * @param seat - The seat to check for leaks
 * @param options - Allowlist predicate + (test-only) render override
 * @throws If a forbidden marker appears in a scoped DOM surface (data-*
 *   attribute value, img[src], inline background-image style, or a
 *   text-bearing accessibility/metadata attribute — aria-label, alt, title,
 *   aria-description, aria-roledescription), naming the leaked marker, the
 *   owning element, the seat, and the DOM surface.
 */
export async function assertNoHiddenInfoLeak<G extends Game>(
  testGame: TestGame<G>,
  seat: number,
  options: AssertNoHiddenInfoLeakOptions = {},
): Promise<void> {
  const markers = deriveForbiddenMarkers(testGame.game, seat);
  const { allow } = options;
  const activeMarkers = allow
    ? markers.filter(
        (m) =>
          !allow(m.value, {
            attribute: m.attribute,
            elementId: m.elementId,
            elementLabel: m.elementLabel,
          }),
      )
    : markers;

  if (activeMarkers.length === 0) return;

  const wrapper = await renderAsSeat(testGame, seat, options.gameViewOverride);
  try {
    const surfaces = collectScopedSurfaceStrings(wrapper);

    for (const marker of activeMarkers) {
      for (const surface of surfaces) {
        if (surface.includes(marker.value)) {
          throw new Error(
            `Hidden-info leak: "${marker.value}"` +
              `${marker.attribute ? ` (attribute "${marker.attribute}")` : ''} ` +
              `from ${marker.elementLabel} is visible in the DOM rendered for seat ${seat}. ` +
              `Leaked via surface: ${surface.slice(0, 200)}`,
          );
        }
      }
    }
  } finally {
    wrapper.unmount();
  }
}
