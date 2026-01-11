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
  ZoomPreviewOverlay,
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
  type Selection,
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

// Animation composables
export {
  useElementAnimation,
  prefersReducedMotion,
  type AnimationOptions,
} from './composables/useElementAnimation.js';

export {
  useFlyingCards,
  type FlyingCard,
  type FlyingCardData,
  type FlyCardOptions,
  type FlyingCardsReturn,
} from './composables/useFlyingCards.js';

// Auto-flying elements (cards, pieces, tokens) between containers
export {
  useAutoFlyingElements,
  type ElementContainerConfig,
  type CountBasedRoute,
  type AutoFlyingElementsOptions,
  type AutoFlyingElementsReturn,
} from './composables/useAutoFlyingElements.js';

// Automatic FLIP animations within containers
export {
  useAutoFLIP,
  type AutoFLIPContainer,
  type AutoFLIPOptions,
  type AutoFLIPReturn,
} from './composables/useAutoFLIP.js';

// Automatic flying to player stats (book formation, captures, scoring)
export {
  useAutoFlyToStat,
  type StatConfig,
  type AutoFlyToStatOptions,
  type AutoFlyToStatReturn,
} from './composables/useAutoFlyToStat.js';

// Unified automatic animation system (combines all auto-animation features)
export {
  useAutoAnimations,
  type ContainerConfig as AnimationContainerConfig,
  type FlyToStatConfig,
  type AutoAnimationsOptions,
  type AutoAnimationsReturn,
} from './composables/useAutoAnimations.js';

export {
  useFlyOnAppear,
  type FlyOnAppearOptions,
  type FlyOnAppearReturn,
} from './composables/useFlyOnAppear.js';

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

// FLIP animation utilities
export {
  useFLIPAnimation,
  createFLIPSnapshot,
  type FLIPAnimationOptions,
  type FLIPAnimationReturn,
} from './composables/useFLIPAnimation.js';

// Action controller (unified action handling for ActionPanel and custom UIs)
export {
  useActionController,
  injectActionController,
  ACTION_CONTROLLER_KEY,
  // Advanced feature injection helpers
  injectSelectionStepFn,
  injectBoardInteraction,
  // Types
  type SelectionMetadata,
  type ActionMetadata as ControllerActionMetadata,
  type ActionResult as ControllerActionResult,
  type FollowUpAction,
  type ValidationResult,
  type SelectionStepResult,
  type SelectionChoicesResult,
  type RepeatingState,
  type ActionStateSnapshot,
  type UseActionControllerOptions,
  type UseActionControllerReturn,
  type SelectionStepFn,
  // Selection-related types
  type ChoiceWithRefs,
  type ValidElement,
  type ElementRef as SelectionElementRef,
} from './composables/useActionController.js';

// Action controller helpers (for custom UI developers)
export {
  actionNeedsWizardMode,
  type WizardModeCheck,
} from './composables/actionControllerHelpers.js';

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
  DEFAULT_PLAYER_COLORS,
  type ColorChoice,
} from '@boardsmith/session';
