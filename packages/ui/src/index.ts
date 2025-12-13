// Core components
export { default as GameShell } from './components/GameShell.vue';
export { default as DebugPanel } from './components/DebugPanel.vue';
export { default as GameHeader } from './components/GameHeader.vue';
export { default as GameHistory } from './components/GameHistory.vue';
export { default as GameLobby } from './components/GameLobby.vue';
export { default as HamburgerMenu } from './components/HamburgerMenu.vue';
export { default as PlayersPanel } from './components/PlayersPanel.vue';
export { default as WaitingRoom } from './components/WaitingRoom.vue';

// Helper components
export {
  Draggable,
  DiceRoller,
  CardFan,
  DeckPile,
  FlyingCardsOverlay,
  ZoomPreviewOverlay,
} from './components/helpers/index.js';

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
  useCardFlip,
  useCardReveal,
  type CardFlipOptions,
  type CardFlipReturn,
} from './composables/useCardFlip.js';

export {
  useFlyingCards,
  type FlyingCard,
  type FlyingCardData,
  type FlyCardOptions,
  type FlyingCardsReturn,
} from './composables/useFlyingCards.js';

export {
  useFlyOnAppear,
  type FlyOnAppearOptions,
  type FlyOnAppearReturn,
} from './composables/useFlyOnAppear.js';

export {
  useZoomPreview,
  type CardPreviewData,
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
  findElement,
  findElements,
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
