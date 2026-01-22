/**
 * useActionAnimations - Declarative animations for action execution
 *
 * This composable enables smooth animations during action execution by:
 * 1. Capturing element positions BEFORE the action executes (via onBeforeAutoExecute hook)
 * 2. Watching for DOM updates after the action completes
 * 3. Animating elements from their old position to their new position
 *
 * ## Problem This Solves
 *
 * When using the action panel dropdown, actions auto-execute immediately when the last
 * selection is filled. By the time the action completes, the DOM has already updated
 * and the original element position is lost. This composable captures positions before
 * execution so animations can work correctly.
 *
 * ## Flip-in-Place Animations
 *
 * When `elementSelector` and `destinationSelector` are identical strings, this is
 * automatically detected as a "flip-in-place" animation (e.g., flipping a card face-up
 * to face-down without moving it). The composable automatically:
 * - Hides the element during animation to prevent "double card" effect
 * - Uses instant reveal (no crossfade) to avoid visual artifacts
 * - Enables flip animation by default
 *
 * You don't need to set `hideDestination`, `flip`, or `crossfadeDuration` manually
 * for flip-in-place animations - they are configured automatically.
 *
 * ## Usage with GameShell (Recommended)
 *
 * When using GameShell, the action controller is created internally. Use the
 * `registerBeforeAutoExecute` method to register the hook after creation:
 *
 * ```vue
 * <script setup lang="ts">
 * import { ref, toRef, watchEffect } from 'vue';
 * import { useActionAnimations, FlyingCardsOverlay } from '@boardsmith/ui';
 *
 * // Create a ref that we'll sync with gameView from slot props
 * const gameViewRef = ref(null);
 *
 * const actionAnimations = useActionAnimations({
 *   gameView: gameViewRef,
 *   animations: [
 *     // Movement animation (element moves to a different destination)
 *     {
 *       action: 'assignToSquad',
 *       elementSelection: 'combatantName',
 *       elementSelector: '[data-combatant="{combatantName}"]',
 *       destinationSelector: '[data-squad="{targetSquad}"]',
 *       duration: 500,
 *       elementSize: { width: 40, height: 60 },
 *     },
 *     // Flip-in-place animation (auto-detected: same selector for source and destination)
 *     {
 *       action: 'flipCard',
 *       elementSelection: 'card',
 *       elementSelector: '[data-card-id="{card}"]',
 *       destinationSelector: '[data-card-id="{card}"]', // Same as source = flip-in-place
 *       duration: 400,
 *     },
 *   ],
 * });
 *
 * // Call this once when you get actionController from slot props
 * function setupAnimations(actionController, gameView) {
 *   gameViewRef.value = gameView;
 *   actionController.registerBeforeAutoExecute(actionAnimations.onBeforeAutoExecute);
 * }
 * </script>
 *
 * <template>
 *   <GameShell game-type="my-game">
 *     <template #game-board="{ actionController, gameView }">
 *       <MyGameBoard
 *         :game-view="gameView"
 *         :action-controller="actionController"
 *         @vue:mounted="setupAnimations(actionController, gameView)"
 *       />
 *       <FlyingCardsOverlay :flying-cards="actionAnimations.flyingElements" />
 *     </template>
 *   </GameShell>
 * </template>
 * ```
 *
 * ## Usage with Custom useActionController
 *
 * When creating your own action controller, pass the hook directly:
 *
 * ```typescript
 * const { flyingElements, onBeforeAutoExecute } = useActionAnimations({
 *   gameView,
 *   animations: [...],
 * });
 *
 * const actionController = useActionController({
 *   sendAction,
 *   availableActions,
 *   actionMetadata,
 *   isMyTurn,
 *   gameView,
 *   playerSeat,
 *   onBeforeAutoExecute,  // Pass directly at creation
 * });
 * ```
 */

import { watch, type Ref, type ComputedRef } from 'vue';
import { useFlyingCards, type FlyingCardData, type FlyingCard } from './useFlyingCards.js';
import type { GameElement } from '../types.js';

/**
 * Data extracted from an element for rendering during animation.
 * Extend FlyingCardData for compatibility with FlyingCardsOverlay.
 */
export interface AnimationElementData extends FlyingCardData {
  /** HTML content of the element (for custom rendering) */
  innerHTML?: string;
  /** CSS class names from the element */
  className?: string;
}

/**
 * Configuration for an action animation.
 */
export interface ActionAnimationConfig {
  /**
   * The action name that triggers this animation.
   * Must exactly match the action name from actionController.
   */
  action: string;

  /**
   * The selection name whose value identifies the element to animate.
   * The value of this selection will be interpolated into the elementSelector.
   *
   * @example
   * // If elementSelection is 'combatantName' and the user selects 'merc-001',
   * // then {combatantName} in elementSelector will be replaced with 'merc-001'.
   */
  elementSelection: string;

  /**
   * CSS selector to find the element to animate.
   * Use {selectionName} placeholders for dynamic values from action args.
   *
   * @example
   * // Static selector
   * elementSelector: '[data-card-id="42"]'
   *
   * // Dynamic selector using selection value
   * elementSelector: '[data-combatant="{combatantName}"]'
   *
   * // Multiple placeholders
   * elementSelector: '[data-player="{player}"][data-piece="{piece}"]'
   */
  elementSelector: string;

  /**
   * Selector or function to find the destination element.
   * Called after the DOM updates to find where the element moved to.
   *
   * **Flip-in-place detection:** If this is a string identical to `elementSelector`,
   * the animation is automatically treated as a flip-in-place animation with
   * appropriate settings (hideDestination, instant reveal, flip enabled).
   *
   * As a string: CSS selector with {selectionName} placeholders (like elementSelector)
   * As a function: Custom logic to find the destination element
   *
   * @example
   * // CSS selector with placeholder
   * destinationSelector: '[data-squad="{targetSquad}"]'
   *
   * // Flip-in-place (same as elementSelector)
   * destinationSelector: '[data-card-id="{card}"]'
   *
   * // Custom function for complex logic
   * destinationSelector: (args) => {
   *   const zone = args.targetZone as string;
   *   return document.querySelector(`.zone-${zone} .drop-target`);
   * }
   */
  destinationSelector: string | ((args: Record<string, unknown>) => Element | null);

  /**
   * Extract data from the source element for rendering during animation.
   * This data is passed to FlyingCardsOverlay and can be used in custom templates.
   *
   * @param el The source element being animated
   * @param args The action arguments
   * @returns Data for rendering the flying element
   *
   * @example
   * getElementData: (el) => ({
   *   innerHTML: el.innerHTML,
   *   className: el.className,
   * })
   */
  getElementData?: (el: Element, args: Record<string, unknown>) => AnimationElementData;

  /**
   * Animation duration in milliseconds.
   * @default 400
   */
  duration?: number;

  /**
   * Size of the flying element during animation.
   * Should match the visual size of the element being animated.
   * @default { width: 60, height: 84 }
   */
  elementSize?: { width: number; height: number };

  /**
   * Whether to flip the element during animation (like a card flip).
   *
   * **Auto-detected for flip-in-place:** When elementSelector === destinationSelector,
   * this defaults to `true`. Set explicitly to `false` to disable.
   *
   * @default false (or true for flip-in-place animations)
   */
  flip?: boolean;

  /**
   * Z-index for the flying element.
   * @default 1000
   */
  zIndex?: number;

  /**
   * Whether to hide the destination element during the animation.
   *
   * **Auto-detected for flip-in-place:** When elementSelector === destinationSelector,
   * this is automatically set to `true` to prevent the "double card" effect.
   *
   * @default false (or true for flip-in-place animations)
   */
  hideDestination?: boolean;

  /**
   * Duration in ms for crossfade transition when hideDestination is true.
   *
   * **Note:** For flip animations (3D transforms), crossfade is disabled because
   * opacity < 1 breaks CSS backface-visibility. The destination appears instantly.
   *
   * @default 150 (ignored for flip animations)
   */
  crossfadeDuration?: number;
}

/**
 * Captured state from before an action executes.
 * Used to animate from the original position after the DOM updates.
 */
interface CapturedAnimationState {
  /** The animation config that matched */
  config: ActionAnimationConfig;
  /** Bounding rect of the source element */
  startRect: DOMRect;
  /** Data extracted from the element for rendering */
  elementData: AnimationElementData;
  /** Action args (for interpolating destination selector) */
  args: Record<string, unknown>;
  /** Unique ID for this animation */
  animationId: string;
  /** MutationObserver watching for the destination element (cleanup needed) */
  mutationObserver?: MutationObserver;
  /** Whether this is a flip-in-place animation (auto-detected) */
  isFlipInPlace: boolean;
}

/**
 * Options for useActionAnimations.
 */
export interface UseActionAnimationsOptions {
  /**
   * Reactive gameView that triggers animation when it changes.
   * The animation is triggered when gameView updates after action execution.
   */
  gameView: Ref<GameElement | null | undefined>;

  /**
   * Animation configurations for different actions.
   */
  animations: ActionAnimationConfig[];
}

/**
 * Return value from useActionAnimations.
 */
export interface UseActionAnimationsReturn {
  /**
   * Reactive array of currently flying elements.
   * Pass this to FlyingCardsOverlay for rendering.
   */
  flyingElements: ComputedRef<readonly FlyingCard[]>;

  /**
   * Hook to pass to useActionController's onBeforeAutoExecute option.
   * Captures element positions before the action executes.
   */
  onBeforeAutoExecute: (actionName: string, args: Record<string, unknown>) => Promise<void>;

  /**
   * Cancel all active animations.
   */
  cancelAll: () => void;
}

/**
 * Interpolate placeholders in a selector string with values from args.
 *
 * @example
 * interpolateSelector('[data-id="{id}"]', { id: 42 }) // '[data-id="42"]'
 */
function interpolateSelector(selector: string, args: Record<string, unknown>): string {
  return selector.replace(/\{(\w+)\}/g, (match, key) => {
    const value = args[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Default element data extractor.
 * Captures innerHTML and className for basic rendering.
 */
function defaultGetElementData(el: Element): AnimationElementData {
  return {
    innerHTML: el.innerHTML,
    className: el.className,
  };
}

/**
 * Detect if this is a flip-in-place animation.
 * Returns true when elementSelector and destinationSelector are identical strings.
 */
function isFlipInPlaceAnimation(config: ActionAnimationConfig): boolean {
  return (
    typeof config.destinationSelector === 'string' &&
    config.elementSelector === config.destinationSelector
  );
}

let animationCounter = 0;

/**
 * Create a composable for action-triggered animations.
 *
 * @param options Configuration for the animation system
 * @returns Composable with flyingElements, onBeforeAutoExecute hook, and cancelAll
 */
export function useActionAnimations(options: UseActionAnimationsOptions): UseActionAnimationsReturn {
  const { gameView, animations } = options;

  // Use the existing flying cards system for rendering
  const { flyingCards, flyCard, cancelAll } = useFlyingCards();

  // State captured before action execution
  let pendingAnimation: CapturedAnimationState | null = null;

  /**
   * Hook called before auto-execute.
   * Captures element position if this action has an animation config.
   */
  async function onBeforeAutoExecute(
    actionName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    // Clear any previous pending animation
    pendingAnimation = null;

    // Find matching animation config
    const config = animations.find((a) => a.action === actionName);
    if (!config) {
      return;
    }

    // Detect flip-in-place animation (same source and destination selector)
    const isFlipInPlace = isFlipInPlaceAnimation(config);

    // For flip-in-place, auto-enable hideDestination unless explicitly set to false
    const shouldHideDestination = config.hideDestination ?? isFlipInPlace;

    // Interpolate the element selector with arg values
    const selector = interpolateSelector(config.elementSelector, args);

    // Find the source element
    const sourceElement = document.querySelector(selector);
    if (!sourceElement) {
      console.warn(
        `[useActionAnimations] Could not find element for selector "${selector}". ` +
          `Action: ${actionName}, Args: ${JSON.stringify(args)}`
      );
      return;
    }

    // Capture the element's position and data
    const startRect = sourceElement.getBoundingClientRect();
    const getElementData = config.getElementData ?? defaultGetElementData;
    const elementData = getElementData(sourceElement, args);

    // Hide the source element BEFORE the action executes if needed
    // Use opacity: 0 with !important (visibility can be overridden by other CSS)
    // Disable transitions to make hiding instant
    const htmlElement = sourceElement as HTMLElement;
    if (shouldHideDestination) {
      htmlElement.setAttribute('data-action-animating', 'true');
      htmlElement.style.setProperty('transition', 'none', 'important');
      htmlElement.style.setProperty('opacity', '0', 'important');
      htmlElement.style.pointerEvents = 'none';
    }

    // Set up MutationObserver to keep the element hidden during Vue's update cycle.
    // Vue may re-render the element multiple times, potentially resetting our styles.
    // The observer watches for mutations and re-applies hiding if needed.
    let mutationObserver: MutationObserver | undefined;
    if (shouldHideDestination) {
      const destSelector = typeof config.destinationSelector === 'string'
        ? interpolateSelector(config.destinationSelector, args)
        : null;

      if (destSelector) {
        mutationObserver = new MutationObserver(() => {
          const destEl = document.querySelector(destSelector) as HTMLElement;
          if (!destEl) return;

          // Re-apply hiding if Vue reset the opacity
          const currentOpacity = getComputedStyle(destEl).opacity;
          if (currentOpacity !== '0') {
            destEl.setAttribute('data-action-animating', 'true');
            destEl.style.setProperty('transition', 'none', 'important');
            destEl.style.setProperty('opacity', '0', 'important');
            destEl.style.pointerEvents = 'none';
          }
        });

        mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-card-id', 'data-element-id', 'class'],
        });
      }
    }

    // Store for use after gameView updates
    pendingAnimation = {
      config,
      startRect,
      elementData,
      args: { ...args },
      animationId: `action-anim-${++animationCounter}`,
      mutationObserver,
      isFlipInPlace,
    };
  }

  // Watch gameView for changes - this indicates the DOM has updated after action execution
  watch(
    gameView,
    async () => {
      if (!pendingAnimation) {
        return;
      }

      // Capture pending animation and clear it immediately to prevent re-triggering
      const { config, startRect, elementData, args, animationId, mutationObserver, isFlipInPlace } = pendingAnimation;
      pendingAnimation = null;

      // Disconnect the MutationObserver
      mutationObserver?.disconnect();

      // Find the destination element
      let destinationElement: Element | null = null;

      if (typeof config.destinationSelector === 'function') {
        destinationElement = config.destinationSelector(args);
      } else {
        const destSelector = interpolateSelector(config.destinationSelector, args);
        destinationElement = document.querySelector(destSelector);
      }

      if (!destinationElement) {
        const selectorDesc =
          typeof config.destinationSelector === 'function'
            ? '(custom function)'
            : config.destinationSelector;
        console.warn(
          `[useActionAnimations] Could not find destination element. ` +
            `Selector: ${selectorDesc}, Args: ${JSON.stringify(args)}`
        );
        return;
      }

      // Resolve effective settings (with flip-in-place auto-detection)
      const shouldHideDestination = config.hideDestination ?? isFlipInPlace;
      const shouldFlip = config.flip ?? isFlipInPlace;
      const crossfadeDuration = shouldHideDestination ? (config.crossfadeDuration ?? 150) : 0;

      // Ensure the destination element is hidden
      const destHtmlElement = destinationElement as HTMLElement;
      if (shouldHideDestination) {
        destHtmlElement.setAttribute('data-action-animating', 'true');
        destHtmlElement.style.setProperty('transition', 'none', 'important');
        destHtmlElement.style.setProperty('opacity', '0', 'important');
        destHtmlElement.style.pointerEvents = 'none';
      }

      try {
        // Trigger the flying animation
        await flyCard({
          id: animationId,
          startRect,
          endRect: () => destinationElement!.getBoundingClientRect(),
          cardData: elementData,
          duration: config.duration ?? 400,
          cardSize: config.elementSize,
          flip: shouldFlip,
          zIndex: config.zIndex ?? 1000,
          holdDuration: crossfadeDuration,
          // For flip animations, skip fade-out because opacity < 1 breaks backface-visibility
          // (3D CSS transforms rely on backface-visibility: hidden, which breaks when parent has opacity < 1)
          skipFadeOut: shouldFlip,
          onPositionComplete: shouldHideDestination ? () => {
            if (shouldFlip) {
              // For flip animations: instant reveal (no fade) since flying card disappears instantly
              // This prevents the "flash" artifact from mismatched opacity timing
              destHtmlElement.style.setProperty('transition', 'none', 'important');
              destHtmlElement.style.setProperty('opacity', '1', 'important');
              destHtmlElement.removeAttribute('data-action-animating');
            } else {
              // For non-flip: crossfade (flying card fades out while destination fades in)
              destHtmlElement.style.setProperty('transition', `opacity ${crossfadeDuration}ms ease-out`, 'important');
              destHtmlElement.removeAttribute('data-action-animating');
              void destHtmlElement.offsetHeight; // Force reflow before starting transition
              destHtmlElement.style.setProperty('opacity', '1', 'important');
            }
          } : undefined,
        });
      } finally {
        // Clean up inline styles after animation completes
        if (shouldHideDestination) {
          // Wait for any CSS transition to complete
          const waitTime = shouldFlip ? 50 : crossfadeDuration + 50;
          await new Promise((resolve) => setTimeout(resolve, waitTime));

          // Clear inline styles and data attribute
          destHtmlElement.removeAttribute('data-action-animating');
          destHtmlElement.style.removeProperty('opacity');
          destHtmlElement.style.removeProperty('transition');
          destHtmlElement.style.pointerEvents = '';
        }
      }
    },
    { deep: false, flush: 'post' }  // flush: 'post' runs after Vue's DOM updates
  );

  return {
    flyingElements: flyingCards,
    onBeforeAutoExecute,
    cancelAll,
  };
}
