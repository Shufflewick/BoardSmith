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

// Theming
export {
  applyTheme,
  getTheme,
  themeCSS,
  type ThemeConfig,
} from './theme.js';
