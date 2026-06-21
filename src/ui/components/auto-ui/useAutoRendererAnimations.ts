/**
 * useAutoRendererAnimations — Testable animation-event wiring composable (RENDER-05).
 *
 * Registers deal/flip/reveal handlers on the injected animation-events instance.
 * Extracted from AutoRenderer.vue so it can be unit-tested without component mounting.
 *
 * Contract:
 *   - If animationEvents is undefined (not provided by GameShell), returns immediately (no-op).
 *   - Handlers read event.data defensively: missing keys are silently skipped, never thrown.
 *   - Handlers check signal.aborted early for cooperative skip support.
 *
 * Actual game.animate() event types in the gate/demo games (A1-A2 finding, see SUMMARY):
 *   - demo-animation: game.animate('demo', {...}) only
 *   - hex, go-fish, checkers: no game.animate() calls (semantic animation not yet adopted)
 *   'deal'/'flip'/'reveal' handlers are future-ready — game authors adopt semantic events
 *   by calling game.animate('deal', {...}) in their own rules code.
 *
 * @param animationEvents - The UseAnimationEventsReturn instance (inject result; may be undefined).
 * @param flyApi          - The fly function from useFlyingElements() for flying-element animations.
 */

import type { UseAnimationEventsReturn } from '../../composables/useAnimationEvents.js';
import type { FlyConfig } from '../../composables/useFlyingElements.js';

/**
 * Minimal fly API shape required by this composable.
 * Using a structural interface keeps this testable with simple spy functions.
 */
export interface FlyApi {
  fly: (config: FlyConfig) => Promise<void>;
}

/**
 * Register deal/flip/reveal animation-event handlers.
 *
 * Called inside AutoRenderer.vue setup. Also called directly in tests that
 * instantiate an animation-events instance — no component mounting needed.
 */
export function useAutoRendererAnimations(
  animationEvents: UseAnimationEventsReturn | undefined,
  flyApi: FlyApi,
): void {
  // A3: If GameShell hasn't provided animation events, nothing to wire — return silently.
  if (!animationEvents) return;

  // -------------------------------------------------------------------
  // 'deal' handler — skip: 'drop'
  // Flies an element from source to destination when a card is dealt.
  // event.data shape (all optional, defensive access required — T-93-16):
  //   sourceRect:      DOMRect-like (source position)
  //   destinationRect: DOMRect-like (destination position)
  //   elementData:     FlyingCardData partial (rank, suit, faceUp, etc.)
  // -------------------------------------------------------------------
  animationEvents.registerHandler(
    'deal',
    async (event, { signal }) => {
      if (signal.aborted) return;

      const data = event.data;

      // Defensive access: tolerate missing or malformed rect data
      const sourceRect = data?.sourceRect as DOMRect | undefined;
      const destinationRect = data?.destinationRect as DOMRect | undefined;

      // Cannot animate without positional data — skip silently (T-93-16)
      if (!sourceRect || !destinationRect) return;

      if (signal.aborted) return;

      await flyApi.fly({
        id: `deal-${event.id}`,
        startRect: sourceRect,
        endRect: destinationRect,
        elementData: {
          ...(data?.elementData as Record<string, unknown> | undefined),
          faceUp: (data?.faceUp as boolean | undefined) ?? false,
        },
        flip: true,
        duration: 400,
      });
    },
    { skip: 'drop' },
  );

  // -------------------------------------------------------------------
  // 'flip' handler — skip: 'run'
  // Runs sync/cleanup even on skip so visual state stays consistent.
  // event.data shape (optional):
  //   elementId: number — the element to flip in the DOM (future: CSS flip-by-id)
  // -------------------------------------------------------------------
  animationEvents.registerHandler(
    'flip',
    async (_event, { signal }) => {
      if (signal.aborted) return;
      // Future: drive CSS flip animation targeting event.data.elementId.
      // For now: handler is registered (RENDER-05 proof) — no DOM available at this layer.
    },
    { skip: 'run' },
  );

  // -------------------------------------------------------------------
  // 'reveal' handler — skip: 'drop'
  // Combination of fly + flip when a hidden card is revealed to the player.
  // event.data shape: same as 'deal' plus optional faceUp field.
  // -------------------------------------------------------------------
  animationEvents.registerHandler(
    'reveal',
    async (event, { signal }) => {
      if (signal.aborted) return;

      const data = event.data;
      const sourceRect = data?.sourceRect as DOMRect | undefined;
      const destinationRect = data?.destinationRect as DOMRect | undefined;

      if (!sourceRect || !destinationRect) return;

      if (signal.aborted) return;

      await flyApi.fly({
        id: `reveal-${event.id}`,
        startRect: sourceRect,
        endRect: destinationRect,
        elementData: {
          ...(data?.elementData as Record<string, unknown> | undefined),
          faceUp: (data?.faceUp as boolean | undefined) ?? false,
        },
        flip: true,
        duration: 400,
      });
    },
    { skip: 'drop' },
  );
}
