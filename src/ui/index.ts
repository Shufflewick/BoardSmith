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
  FlyingCardsOverlay,
  GameOverlay,
  ZoomPreviewOverlay,
  Button,
  type ButtonVariant,
  type ButtonSize,
} from './components/helpers/index.js';

// 3D Dice components (Three.js with chamfered geometry)
export { Die3D } from './components/dice/index.js';
export {
  DIE_ANIMATION_CONTEXT_KEY,
  createDieAnimationContext,
  type DieAnimationContext,
} from './components/dice/die3d-state.js';

// Auto-UI components (automatic game UI generation)
export {
  AutoUI,
  AutoGameBoard,
  AutoElement,
  ActionPanel,
  type GameElement,
  type Pick,
  type ActionMetadata,
  type Player,
} from './components/auto-ui/index.js';

// Composables
export {
  useToast,
  type Toast as ToastMessage,
} from './composables/useToast.js';

export {
  useBoardInteraction,
  createBoardInteraction,
  provideBoardInteraction,
  type BoardInteraction,
  type BoardInteractionState,
  type BoardInteractionActions,
  type ElementRef,
  type HighlightableChoice,
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
  type UseAnimationEventsOptions,
  type UseAnimationEventsReturn,
} from './composables/useAnimationEvents.js';

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

// Hover highlight composable (for custom UI element highlighting)
export {
  useHoverHighlight,
  type HoverableItem,
  type UseHoverHighlightOptions,
  type UseHoverHighlightReturn,
} from './composables/useHoverHighlight.js';

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
  getTheme,
  themeCSS,
  type ThemeConfig,
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
export type { AnimationEvent, EmitAnimationEventOptions } from '../engine/index.js';
