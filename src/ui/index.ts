/// <reference path="./global.d.ts" />

// Core components
export { default as GameShell } from './components/GameShell.vue';
export { default as DebugPanel } from './components/DebugPanel.vue';
export { default as GameHeader } from './components/GameHeader.vue';
export { default as GameHistory } from './components/GameHistory.vue';
export { default as GameLobby } from './components/GameLobby.vue';
export { default as HamburgerMenu } from './components/HamburgerMenu.vue';
export { default as PlayersPanel } from './components/PlayersPanel.vue';
export { default as WaitingRoom } from './components/WaitingRoom.vue';
export { default as Toast } from './components/Toast.vue';

// Helper components
export {
  BoardMessage,
  FlyingCardsOverlay,
  GameOverlay,
  ZoomPreviewOverlay,
  Button,
  type ButtonVariant,
  type ButtonSize,
} from './components/helpers/index.js';

// 3D dice are NOT re-exported here. Importing them is what opts a game into
// shipping three.js (~500 kB), so it must be an explicit, named request:
// `import { Die3D } from 'boardsmith/ui/dice'`. On this barrel, the reference
// stayed live in every game that imports GameShell — which is how all 14 example
// games ended up carrying the three.js chunk when only 2 roll dice. The
// animation-context helpers below are three-free and stay.
export {
  DIE_ANIMATION_CONTEXT_KEY,
  createDieAnimationContext,
  type DieAnimationContext,
} from './components/dice/die3d-state.js';

// ActionPanel is shell infrastructure: GameShell mounts it for every game, custom
// UI or not, so it belongs on the main barrel. Imported from its own module rather
// than through `./components/auto-ui/index.js` ON PURPOSE — that barrel re-exports
// AutoUI.vue and AutoRenderer.vue, and a Vue SFC's `<style>` block compiles to a
// SIDE-EFFECTFUL CSS import that survives JS tree-shaking. Routing through it put
// the whole auto-UI stylesheet into every custom-UI game's production bundle even
// though none of its JS shipped. Keep this a direct module path.
export { default as ActionPanel } from './components/auto-ui/ActionPanel.vue';

// Game UI registry (src/ui/uis.ts) — single source of truth for a game's UIs.
export { defineGameUIs, defaultUI, devUI } from './game-uis.js';
export type { GameUIEntry, DefaultGameUIEntry, GameUIRegistry } from './game-uis.js';
export type { GameElement, Pick, ActionMetadata, Player } from './types.js';

// AutoUI/AutoRenderer are deliberately NOT re-exported here — they live behind the
// `boardsmith/ui/auto-ui` subpath so a game only pays for them when it asks for
// them by name (SHIP-02). Auto-UI games: `import { AutoUI } from 'boardsmith/ui/auto-ui'`.

// Renderer registry (public extension API per D-03)
// Game authors register custom renderers at priority 100+ to upgrade auto-UI in place.
export { registerRenderer } from './components/auto-ui/renderer-registry.js';

// Presentation overlay (per-UI visual metadata, resolved after visibility filtering)
export {
  resolvePresentation,
  type PresentationEntry,
  type PresentationOverlay,
} from './components/auto-ui/presentation.js';

// Composables
export {
  useToast,
  type Toast as ToastMessage,
} from './composables/useToast.js';

export {
  useBoardInteraction,
  tryUseBoardInteraction,
  createBoardInteraction,
  provideBoardInteraction,
  anchorAttrs,
  type BoardInteraction,
  type BoardInteractionState,
  type BoardInteractionActions,
  type ElementRef,
  type HighlightableChoice,
  // The board's clickable-target shape. Distinct from `ValidElement` (the action
  // controller's offered choice) and named so the two can't be confused.
  type BoardTarget,
} from './composables/useBoardInteraction.js';

// Drag-and-drop composable for custom UIs
export {
  useDragDrop,
  type DragProps,
  type DropProps,
  type UseDragDropReturn,
  // Pit of Success types
  type DragOptions,
  type DragClasses,
  type DropClasses,
  type DragResult,
  type DropResult,
} from './composables/useDragDrop.js';

// Animation composables
export {
  useElementAnimation,
  prefersReducedMotion,
  type AnimationOptions,
} from './composables/useElementAnimation.js';

// Animation test-mode + trace recorder (ANIM-01) — Vue-free, also re-exported from boardsmith/testing
export {
  enableAnimationTestMode,
  disableAnimationTestMode,
  isAnimationTestModeEnabled,
  recordTrace,
  getAnimationTrace,
  clearAnimationTrace,
  type AnimationTrace,
} from './composables/useAnimationTestMode.js';

// Consolidated FLIP animation API
export {
  useFLIP,
  createFLIPSnapshot,
  type FLIPContainer,
  type UseFLIPOptions,
  type UseFLIPReturn,
} from './composables/useFLIP.js';

// Consolidated flying elements API (unified flying cards/elements animations)
export {
  useFlyingElements,
  type FlyConfig,
  type FlyOnAppearOptions,
  type FlyingCard,
  type FlyingCardData,
  type UseFlyingElementsOptions,
  type UseFlyingElementsReturn,
  // Auto-watch types (replaces useAutoAnimations, useAutoFlyingElements)
  type AutoWatchOptions,
  type AutoWatchContainer,
  type AutoWatchGameElement,
  type CountBasedRoute,
} from './composables/useFlyingElements.js';

// Action-triggered animations (for animating elements during action execution)
export {
  useActionAnimations,
  type ActionAnimationConfig,
  type AnimationElementData,
  type UseActionAnimationsOptions,
  type UseActionAnimationsReturn,
} from './composables/useActionAnimations.js';

// Animation event playback (sequential handler-based playback)
export {
  createAnimationEvents,
  provideAnimationEvents,
  useAnimationEvents,
  ANIMATION_EVENTS_KEY,
  type AnimationHandler,
  type AnimationHandlerContext,
  type AnimationHandlerOptions,
  type UseAnimationEventsOptions,
  type UseAnimationEventsReturn,
} from './composables/useAnimationEvents.js';

// Board sizing for content-flow custom boards (see docs/custom-ui-guide.md "Board Sizing")
export { useBoardSize } from './composables/useBoardSize.js';

// Screen-reader announcer (writes through GameShell's existing live regions)
export {
  useAnnouncer,
  provideAnnouncer,
  createAnnouncer,
  ANNOUNCER_KEY,
  type UseAnnouncerReturn,
} from './composables/useAnnouncer.js';

export {
  useZoomPreview,
  type CardPreviewData,
  type DiePreviewData,
  type PreviewState,
  type ZoomPreviewReturn,
} from './composables/useZoomPreview.js';

// Player stat animation utilities
export {
  usePlayerStatAnimation,
  getPlayerStatElement,
  flyToPlayerStat,
  type CardForAnimation,
  type FlyToStatOptions,
} from './composables/usePlayerStatAnimation.js';

// Game view helpers (for custom UIs)
export {
  useGameViewHelpers,
  findElementById,
  findElement,
  findElements,
  findChildByAttribute,
  findElementByAttribute,
  findAllByAttribute,
  getElementId,
  findPlayerHand,
  findPlayerElement,
  getPlayerAttribute,
  findAllHands,
  getElementCount,
  getCards,
  getFirstCard,
  getCardData,
  getElementOwner,
  isOwnedByPlayer,
  isMyElement,
  isOpponentElement,
  type GameElement as GameViewElement,
  type FindElementOptions,
} from './composables/useGameViewHelpers.js';

// Grid/board game utilities
export {
  useGameGrid,
  toAlgebraicNotation,
  fromAlgebraicNotation,
  type GameGridOptions,
  type GameGridReturn,
} from './composables/useGameGrid.js';

// Hex grid utilities
export {
  useHexGrid,
  hexToPixel,
  getHexPolygonPoints,
  calculateHexDistance,
  type HexOrientation,
  type HexGridOptions,
  type HexPosition,
  type HexBounds,
  type HexGridReturn,
} from './composables/useHexGrid.js';

// Card display utilities
export {
  useCardDisplay,
  getSuitSymbol,
  getSuitColor,
  getRankName,
  getCardPointValue,
  isRedSuit,
  isBlackSuit,
  type SuitAbbreviation,
  type RankAbbreviation,
} from './composables/useCardDisplay.js';

// Element change tracking utilities
export {
  useElementChangeTracker,
  useCountTracker,
  type ElementPositionData,
  type ElementChangeTrackerOptions,
  type ElementChangeTrackerReturn,
  type CountTrackerReturn,
} from './composables/useElementChangeTracker.js';

// Action controller (unified action handling for ActionPanel and custom UIs)
export {
  useActionController,
  injectActionController,
  ACTION_CONTROLLER_KEY,
  // Advanced feature injection helpers
  injectPickStepFn,
  injectBoardInteraction,
  // Types
  type PickMetadata,
  type PickStepResult,
  type PickChoicesResult,
  type PickSnapshot,
  type CollectedPick,
  type PickStepFn,
  // Other types
  type ActionMetadata as ControllerActionMetadata,
  type ActionResult as ControllerActionResult,
  type FollowUpAction,
  type ValidationResult,
  type RepeatingState,
  type ActionStateSnapshot,
  type UseActionControllerOptions,
  type UseActionControllerReturn,
  // Pick-related types
  type ChoiceWithRefs,
  type ValidElement,
} from './composables/useActionController.js';

// Action controller helpers (for custom UI developers)
export {
  actionNeedsWizardMode,
  type WizardModeCheck,
} from './composables/actionControllerHelpers.js';

// Image utilities (for custom card/element rendering)
export {
  parseImageInfo,
  isUrlImage,
  isSpriteImage,
  getImageSrc,
  getSpriteStyle,
  getBackgroundImageStyle,
  type ImageInfo,
  type SpriteData,
} from './utils/image.js';

// Theming
export {
  applyTheme,
  themeCSS,
  SEAT_PALETTE,
} from './theme.js';

// Shared types
export type {
  BaseElementAttributes,
  ElementMatchOptions,
  PlayerRef,
} from './types.js';

// Re-export color utilities from session package
export {
  STANDARD_PLAYER_COLORS,
  type ColorChoice,
} from '../session/index.js';

// Re-export animation event types from engine for convenience
export type { AnimationEvent } from '../engine/index.js';
