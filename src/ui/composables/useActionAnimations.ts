/**
 * useActionAnimations - Declarative animations for action execution
 *
 * This composable enables smooth animations during action execution by:
 * 1. Capturing element positions BEFORE the action executes (via onBeforeAutoExecute hook)
 * 2. Waiting for the server to accept the action and its state to render
 *    (a refused or cancelled action puts the element back as it was)
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
 * `onBeforeAutoExecute` method to add the hook after creation:
 *
 * ```vue
 * <script setup lang="ts">
 * import { ref, toRef, watchEffect } from 'vue';
 * import { useActionAnimations, FlyingCardsOverlay } from 'boardsmith/ui';
 *
 * // Create a ref that we'll sync with the gameView prop
 * const gameViewRef = ref(null);
 *
 * // GameShell passes `actionController` and `gameView` to the board component
 * // as props; register the hook once, here in the board's own setup.
 * const props = defineProps<{ actionController: any; gameView: any }>();
 *
 * const actionAnimations = useActionAnimations({
 *   gameView: gameViewRef,
 *   actionController: props.actionController,
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
 * watchEffect(() => { gameViewRef.value = props.gameView; });
 * props.actionController.onBeforeAutoExecute(actionAnimations.onBeforeAutoExecute);
 * </script>
 *
 * <template>
 *   <div>
 *     <!-- the board's own markup -->
 *     <FlyingCardsOverlay :flying-cards="actionAnimations.flyingElements" />
 *   </div>
 * </template>
 * ```
 *
 * ## Usage with Custom useActionController
 *
 * Create the controller first, since the composable listens to it:
 *
 * ```typescript
 * const actionController = useActionController({
 *   sendAction,
 *   availableActions,
 *   actionMetadata,
 *   isMyTurn,
 *   gameView,
 *   playerSeat,
 * });
 *
 * const { flyingElements, onBeforeAutoExecute } = useActionAnimations({
 *   gameView,
 *   actionController,
 *   animations: [...],
 * });
 * actionController.onBeforeAutoExecute(onBeforeAutoExecute);
 * ```
 */

import { watch, onScopeDispose, type Ref, type ComputedRef } from 'vue';
import { useFlyingElements, type FlyingCardData, type FlyingCard } from './useFlyingElements.js';
import { isAnimationTestModeEnabled, recordTrace } from './useAnimationTestMode.js';
import { prefersReducedMotion } from './reducedMotion.js';
import { isDevThrowEnabled } from '../../utils/dev.js';
import { escapeCssString } from '../utils/css-string.js';
import type { GameViewElement } from '../types.js';
import type { UseActionControllerReturn } from './useActionControllerTypes.js';

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
   * Use {selectionName} placeholders for dynamic values from action args, only
   * inside double-quoted attribute values (anything else is refused at setup).
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
  /** Each element hidden for this action, with how it looked before */
  hidden: Map<HTMLElement, HiddenLook>;
  /** The state changed since the action was sent */
  stateChanged: boolean;
  /** The server accepted the action */
  accepted: boolean;
  /** The auto-execution this was captured for; only its outcome settles it (#1026) */
  run: number;
}

/** An element's own hiding-related attribute and inline styles, as they were before hiding. */
interface HiddenLook {
  attribute: string | null;
  styles: Array<{ property: string; value: string; priority: string }>;
}

const HIDING_STYLES = ['transition', 'opacity', 'pointer-events'];

/** Hide an element instantly, first noting how it looked if `saved` does not have it yet. */
function hideElement(el: HTMLElement, saved?: Map<HTMLElement, HiddenLook>): void {
  if (saved && !saved.has(el)) {
    saved.set(el, {
      attribute: el.getAttribute('data-action-animating'),
      styles: HIDING_STYLES.map((property) => ({
        property,
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property),
      })),
    });
  }
  // opacity with !important (visibility can be overridden by other CSS); no transition so it is instant
  el.setAttribute('data-action-animating', 'true');
  el.style.setProperty('transition', 'none', 'important');
  el.style.setProperty('opacity', '0', 'important');
  el.style.pointerEvents = 'none';
}

/** Put every hidden element back exactly as it was. */
function restoreHidden(saved: Map<HTMLElement, HiddenLook>): void {
  for (const [el, look] of saved) {
    if (look.attribute === null) el.removeAttribute('data-action-animating');
    else el.setAttribute('data-action-animating', look.attribute);
    for (const { property, value, priority } of look.styles) {
      if (value) el.style.setProperty(property, value, priority);
      else el.style.removeProperty(property);
    }
  }
}

/**
 * Options for useActionAnimations.
 */
export interface UseActionAnimationsOptions {
  /**
   * Reactive gameView that triggers animation when it changes.
   * The animation is triggered when gameView updates after action execution.
   */
  gameView: Ref<GameViewElement | null | undefined>;

  /**
   * Animation configurations for different actions.
   */
  animations: ActionAnimationConfig[];

  /**
   * The action controller whose actions are animated. The composable listens to
   * it for how each action ended, so a refused or cancelled action puts its
   * element back and plays no flight. Registering `onBeforeAutoExecute` on it
   * is still the caller's job (a game may wrap the hook).
   */
  actionController: Pick<UseActionControllerReturn, 'onAfterAutoExecute'>;
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
  onBeforeAutoExecute: (actionName: string, args: Record<string, unknown>, run: number) => Promise<void>;

  /**
   * Cancel all active animations.
   */
  cancelAll: () => void;
}

/**
 * Interpolate placeholders in a selector string with values from args.
 * Values are escaped for a double-quoted attribute value, where placeholders belong.
 *
 * @example
 * interpolateSelector('[data-id="{id}"]', { id: 42 }) // '[data-id="42"]'
 */
function interpolateSelector(selector: string, args: Record<string, unknown>): string {
  return selector.replace(/\{(\w+)\}/g, (match, key) => {
    const value = args[key];
    return value !== undefined ? escapeCssString(String(value)) : match;
  });
}

/**
 * Refuse a selector template whose {placeholder} sits outside a double-quoted
 * attribute value: interpolateSelector escapes for that context only.
 */
function assertPlaceholdersQuoted(action: string, field: string, selector: string): void {
  // One left-to-right scan: single-quoted strings are kept (their placeholders are refused), double-quoted values are blanked.
  const outsideQuotedValues = selector.replace(
    /'(?:[^'\\]|\\.)*'|=\s*"(?:[^"\\]|\\.)*"/g,
    (quoted) => (quoted.startsWith("'") ? quoted : '=""'),
  );
  const stray = /\{(\w+)\}/.exec(outsideQuotedValues);
  if (!stray) return;
  throw new Error(
    `[useActionAnimations] The "${action}" animation's ${field} '${selector}' puts ${stray[0]} ` +
    `outside a double-quoted attribute value, where its value cannot be escaped safely. ` +
    `Mark the element with a data attribute and select it as [data-attribute="${stray[0]}"].`
  );
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
  const { gameView, animations, actionController } = options;
  for (const config of animations) {
    assertPlaceholdersQuoted(config.action, 'elementSelector', config.elementSelector);
    if (typeof config.destinationSelector === 'string') {
      assertPlaceholdersQuoted(config.action, 'destinationSelector', config.destinationSelector);
    }
  }

  // Use the flying elements system for rendering
  const { flyingElements, fly, cancelAll } = useFlyingElements();

  // State captured before action execution
  let pendingAnimation: CapturedAnimationState | null = null;

  /** Drop the pending animation and undo everything it did to the page. */
  function abandonPending(): void {
    if (!pendingAnimation) return;
    pendingAnimation.mutationObserver?.disconnect();
    restoreHidden(pendingAnimation.hidden);
    pendingAnimation = null;
  }

  /**
   * Hook called before auto-execute.
   * Captures element position if this action has an animation config.
   */
  async function onBeforeAutoExecute(
    actionName: string,
    args: Record<string, unknown>,
    run: number,
  ): Promise<void> {
    abandonPending();

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
      const msg =
        `[useActionAnimations] Could not find element for selector "${selector}". ` +
        `Action: ${actionName}, Args: ${JSON.stringify(args)}`;
      if (isDevThrowEnabled()) {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
      return;
    }

    // Capture the element's position and data
    const startRect = sourceElement.getBoundingClientRect();
    const getElementData = config.getElementData ?? defaultGetElementData;
    const elementData = getElementData(sourceElement, args);

    // Hide the source element BEFORE the action executes if needed
    const hidden = new Map<HTMLElement, HiddenLook>();
    if (shouldHideDestination) {
      hideElement(sourceElement as HTMLElement, hidden);
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
          if (getComputedStyle(destEl).opacity !== '0') {
            hideElement(destEl, hidden);
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

    // Played once the action is accepted AND the state it produced has rendered
    pendingAnimation = {
      config,
      startRect,
      elementData,
      args: { ...args },
      animationId: `action-anim-${++animationCounter}`,
      mutationObserver,
      isFlipInPlace,
      hidden,
      stateChanged: false,
      accepted: false,
      run,
    };
  }

  // Each auto-executed action ends here once, right after its own before-hooks ran
  actionController.onAfterAutoExecute((result, run) => {
    const captured = pendingAnimation;
    if (!captured || captured.run !== run || captured.accepted) return;
    if (!result.success) {
      abandonPending();
      return;
    }
    captured.accepted = true;
    // The host sends an action's state before its result, so the DOM may already show it
    if (captured.stateChanged) return play(captured);
  });

  onScopeDispose(abandonPending);

  // A state change before the result may be another seat's move, so it only marks
  // the DOM as changed; once the action is accepted, a change means its state rendered.
  watch(
    gameView,
    () => {
      if (!pendingAnimation) return;
      if (pendingAnimation.accepted) return play(pendingAnimation);
      pendingAnimation.stateChanged = true;
    },
    { deep: false, flush: 'post' }  // flush: 'post' runs after Vue's DOM updates
  );

  /** Fly the pending animation from where its element was to where it is now. */
  async function play(animation: CapturedAnimationState): Promise<void> {
    // Clear it immediately to prevent re-triggering
    const { config, startRect, elementData, args, animationId, mutationObserver, isFlipInPlace } = animation;
    pendingAnimation = null;

    // Disconnect the MutationObserver
    mutationObserver?.disconnect();

    // Find the destination element
    let destinationElement: Element | null = null;
    let destSelectorStr: string | undefined;

    if (typeof config.destinationSelector === 'function') {
      destinationElement = config.destinationSelector(args);
    } else {
      destSelectorStr = interpolateSelector(config.destinationSelector, args);
      destinationElement = document.querySelector(destSelectorStr);
    }

    // Fail-loud destination check MUST run before the test-mode branch
    // below: a typo'd/misconfigured destinationSelector is the canonical
    // authoring bug ANIM-03 exists to catch, and a game's animation test
    // suite (precisely where enableAnimationTestMode() is used) must not
    // let it pass silently as a "successful" trace. Checking test mode
    // first would record {kind:'action', to: <bad selector>} and return
    // before this check ever ran — defeating the fail-loud guarantee for
    // the exact scenario it targets.
    if (!destinationElement) {
      restoreHidden(animation.hidden);
      const selectorDesc =
        typeof config.destinationSelector === 'function'
          ? '(custom function)'
          : config.destinationSelector;
      const msg =
        `[useActionAnimations] Could not find destination element. ` +
        `Selector: ${selectorDesc}, Args: ${JSON.stringify(args)}`;
      if (isDevThrowEnabled()) {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
      return;
    }

    // Test mode: record one {kind:'action'} trace using our OWN
    // interpolated from/to selector strings and return WITHOUT delegating
    // to fly() - useFlyingElements has its own independent 'fly' trace
    // branch (used only for direct manual/autoWatch fly() calls), so
    // delegating here would double-record the same animation.
    if (isAnimationTestModeEnabled()) {
      const elementSelectorStr = interpolateSelector(config.elementSelector, args);
      const elementValue = args[config.elementSelection];
      recordTrace({
        kind: 'action',
        element: elementValue !== undefined ? String(elementValue) : null,
        from: elementSelectorStr,
        to: destSelectorStr,
        meta: { action: config.action, args },
      });
      return;
    }

    // Resolve effective settings (with flip-in-place auto-detection)
    const shouldHideDestination = config.hideDestination ?? isFlipInPlace;
    const shouldFlip = config.flip ?? isFlipInPlace;
    const crossfadeDuration = shouldHideDestination ? (config.crossfadeDuration ?? 150) : 0;

    // Ensure the destination element is hidden
    const destHtmlElement = destinationElement as HTMLElement;
    if (shouldHideDestination) {
      hideElement(destHtmlElement);
    }

    try {
      // Trigger the flying animation
      await fly({
        id: animationId,
        startRect,
        endRect: () => destinationElement!.getBoundingClientRect(),
        elementData,
        duration: config.duration ?? 400,
        elementSize: config.elementSize,
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
        // Wait for any CSS transition to complete; with motion reduced there is none to wait for
        if (!prefersReducedMotion.value) {
          const waitTime = shouldFlip ? 50 : crossfadeDuration + 50;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        // Clear inline styles and data attribute
        destHtmlElement.removeAttribute('data-action-animating');
        destHtmlElement.style.removeProperty('opacity');
        destHtmlElement.style.removeProperty('transition');
        destHtmlElement.style.pointerEvents = '';
      }
    }
  }

  return {
    flyingElements,
    onBeforeAutoExecute,
    cancelAll,
  };
}
