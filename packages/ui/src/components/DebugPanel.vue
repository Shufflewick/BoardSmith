<script lang="ts">
import { defineComponent, h } from 'vue';

// Recursive TreeNode component for unlimited depth state tree
export const TreeNode = defineComponent({
  name: 'TreeNode',
  props: {
    nodeKey: { type: String, required: true },
    value: { type: null, required: true },
    path: { type: String, required: true },
    depth: { type: Number, default: 0 },
    expandedPaths: { type: Set, required: true },
    searchQuery: { type: String, default: '' },
  },
  emits: ['toggle', 'copy'],
  setup(props, { emit }) {
    const isExpandable = (val: unknown): boolean => val !== null && typeof val === 'object';

    const getTypeColor = (val: unknown): string => {
      if (val === null) return '#e74c3c';
      if (val === undefined) return '#95a5a6';
      if (typeof val === 'string') return '#2ecc71';
      if (typeof val === 'number') return '#3498db';
      if (typeof val === 'boolean') return '#e67e22';
      if (Array.isArray(val)) return '#9b59b6';
      if (typeof val === 'object') return '#00d9ff';
      return '#fff';
    };

    const formatValue = (val: unknown): string => {
      if (val === null) return 'null';
      if (val === undefined) return 'undefined';
      if (typeof val === 'string') return `"${val}"`;
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      if (Array.isArray(val)) return `Array(${val.length})`;
      if (typeof val === 'object') {
        const keys = Object.keys(val as object);
        return `{${keys.length} keys}`;
      }
      return String(val);
    };

    const isExpanded = () => props.expandedPaths.has(props.path);
    const expandable = () => isExpandable(props.value);

    const handleToggle = () => {
      if (expandable()) {
        emit('toggle', props.path);
      }
    };

    const handleCopy = (e: Event) => {
      e.stopPropagation();
      emit('copy', props.value);
    };

    // Inline styles for render function (scoped CSS doesn't apply)
    const styles = {
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 4px',
        borderRadius: '3px',
        cursor: 'default',
      },
      rowExpandable: {
        cursor: 'pointer',
      },
      arrow: {
        color: '#666',
        fontSize: '10px',
        width: '12px',
        textAlign: 'center' as const,
      },
      arrowPlaceholder: {
        width: '12px',
      },
      key: {
        color: '#00d9ff',
        fontWeight: '500' as const,
      },
      separator: {
        color: '#666',
      },
      value: {
        marginLeft: '4px',
      },
      copyBtn: {
        opacity: '0',
        marginLeft: 'auto',
        padding: '2px 6px',
        fontSize: '10px',
        background: 'rgba(255, 255, 255, 0.1)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '3px',
        color: '#888',
        cursor: 'pointer',
      },
      children: {
        marginLeft: '16px',
        borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
        paddingLeft: '8px',
      },
    };

    return () => {
      const children: any[] = [];

      // Row
      const rowStyle = expandable()
        ? { ...styles.row, ...styles.rowExpandable }
        : styles.row;

      const rowChildren = [
        // Arrow
        expandable()
          ? h('span', { style: styles.arrow }, isExpanded() ? '▼' : '▶')
          : h('span', { style: styles.arrowPlaceholder }),
        // Key
        h('span', { style: styles.key }, props.nodeKey),
        h('span', { style: styles.separator }, ':'),
        // Value
        h('span', { style: { ...styles.value, color: getTypeColor(props.value) } }, formatValue(props.value)),
        // Copy button
        h('button', {
          class: 'tree-copy-btn',
          style: styles.copyBtn,
          onClick: handleCopy,
          title: 'Copy JSON',
        }, '⎘'),
      ];

      children.push(
        h('div', {
          class: 'tree-row',
          style: rowStyle,
          onClick: handleToggle,
          onMouseenter: (e: MouseEvent) => {
            const btn = (e.currentTarget as HTMLElement).querySelector('.tree-copy-btn') as HTMLElement;
            if (btn) btn.style.opacity = '1';
          },
          onMouseleave: (e: MouseEvent) => {
            const btn = (e.currentTarget as HTMLElement).querySelector('.tree-copy-btn') as HTMLElement;
            if (btn) btn.style.opacity = '0';
          },
        }, rowChildren)
      );

      // Children if expanded
      if (expandable() && isExpanded() && props.value) {
        const childNodes = Object.entries(props.value as Record<string, unknown>).map(([childKey, childValue]) =>
          h(TreeNode, {
            key: childKey,
            nodeKey: childKey,
            value: childValue,
            path: `${props.path}.${childKey}`,
            depth: props.depth + 1,
            expandedPaths: props.expandedPaths,
            searchQuery: props.searchQuery,
            onToggle: (p: string) => emit('toggle', p),
            onCopy: (v: unknown) => emit('copy', v),
          })
        );
        children.push(h('div', { style: styles.children }, childNodes));
      }

      return h('div', {}, children);
    };
  },
});
</script>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

interface SerializedAction {
  name: string;
  player: number;
  args: Record<string, unknown>;
  timestamp?: number;
}

interface ElementDiff {
  added: number[];
  removed: number[];
  changed: number[];
  fromIndex: number;
  toIndex: number;
}

interface ActionTrace {
  actionName: string;
  available: boolean;
  conditionResult?: boolean;
  conditionError?: string;
  conditionDetails?: Array<{
    label: string;
    value: unknown;
    passed: boolean;
    children?: unknown[];
  }>;
  selections: Array<{
    name: string;
    type: string;
    choiceCount: number;
    skipped?: boolean;
    optional?: boolean;
    filterApplied?: boolean;
    dependentOn?: string;
  }>;
}

interface DebugPanelProps {
  /** Current game state (raw) */
  state: any;
  /** Current player position */
  playerPosition: number;
  /** Total number of players */
  playerCount: number;
  /** Game ID */
  gameId: string | null;
  /** API base URL */
  apiUrl?: string;
  /** Whether panel is expanded */
  expanded?: boolean;
}

const props = withDefaults(defineProps<DebugPanelProps>(), {
  apiUrl: 'http://localhost:8787',
  expanded: false,
});

const emit = defineEmits<{
  'switch-player': [position: number];
  'restart-game': [];
  'update:expanded': [value: boolean];
  'time-travel': [state: any | null, actionIndex: number | null, diff: ElementDiff | null];
  'highlight-element': [elementId: number | null];
}>();

// Local state
const panelExpanded = ref(props.expanded);
const activeTab = ref<'state' | 'history' | 'elements' | 'decks' | 'actions' | 'controls'>('state');
const showRawState = ref(false);
const stateSearchQuery = ref('');
const expandedPaths = ref<Set<string>>(new Set(['root']));

// Copy toast state
const copyToastVisible = ref(false);
const copyToastTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

// Action traces state
const actionTraces = ref<ActionTrace[]>([]);
const tracesLoading = ref(false);
const tracesError = ref<string | null>(null);
const tracesLastFetched = ref<number>(0);

// Element inspector state
const selectedElementId = ref<number | null>(null);
const elementSearchQuery = ref('');
const expandedElementGroups = ref<Set<string>>(new Set());

// Deck inspector state
const deckSearchQuery = ref('');
const expandedDecks = ref<Set<number>>(new Set());
const selectedDeckCard = ref<{ deckId: number; cardId: number } | null>(null);
const deckManipulationLoading = ref(false);
const deckManipulationError = ref<string | null>(null);

// History state
const actionHistory = ref<SerializedAction[]>([]);
const historyLoading = ref(false);
const historyError = ref<string | null>(null);
const historyLastFetched = ref<number>(0);

// Time travel state
const selectedActionIndex = ref<number | null>(null);
const historicalState = ref<any>(null);
const historicalStateLoading = ref(false);
const historicalStateError = ref<string | null>(null);

// Diff state
const stateDiff = ref<ElementDiff | null>(null);

// Sync expanded state
watch(() => props.expanded, (val) => {
  panelExpanded.value = val;
});

function togglePanel() {
  panelExpanded.value = !panelExpanded.value;
  emit('update:expanded', panelExpanded.value);
}

// Keyboard shortcut handler
function handleKeyDown(e: KeyboardEvent) {
  // Don't trigger if typing in an input
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  // 'D' key toggles debug panel
  if (e.key === 'd' || e.key === 'D') {
    togglePanel();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

// Format state for display
const formattedState = computed(() => {
  if (!props.state) return 'No state available';
  try {
    return JSON.stringify(props.state, null, 2);
  } catch {
    return 'Error formatting state';
  }
});

// Tree node expansion
function toggleExpand(path: string) {
  if (expandedPaths.value.has(path)) {
    expandedPaths.value.delete(path);
  } else {
    expandedPaths.value.add(path);
  }
  // Force reactivity
  expandedPaths.value = new Set(expandedPaths.value);
}

function isNodeExpanded(path: string): boolean {
  return expandedPaths.value.has(path);
}

// Copy any node value to clipboard as JSON
async function copyNodeToClipboard(value: unknown) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    // Show toast
    if (copyToastTimeout.value) {
      clearTimeout(copyToastTimeout.value);
    }
    copyToastVisible.value = true;
    copyToastTimeout.value = setTimeout(() => {
      copyToastVisible.value = false;
    }, 1500);
  } catch (e) {
    console.error('Failed to copy to clipboard:', e);
  }
}

function expandAll() {
  const paths = new Set<string>(['root']);
  function traverse(obj: any, path: string) {
    if (obj && typeof obj === 'object') {
      paths.add(path);
      for (const key in obj) {
        traverse(obj[key], `${path}.${key}`);
      }
    }
  }
  traverse(props.state, 'root');
  expandedPaths.value = paths;
}

function collapseAll() {
  expandedPaths.value = new Set(['root']);
}

// Get type color for value
function getTypeColor(value: any): string {
  if (value === null) return '#e74c3c';
  if (value === undefined) return '#95a5a6';
  if (typeof value === 'string') return '#2ecc71';
  if (typeof value === 'number') return '#3498db';
  if (typeof value === 'boolean') return '#e67e22';
  if (Array.isArray(value)) return '#9b59b6';
  if (typeof value === 'object') return '#00d9ff';
  return '#fff';
}

// Format value for display
function formatValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return `{${keys.length} keys}`;
  }
  return String(value);
}

// Check if value is expandable
function isExpandable(value: any): boolean {
  return value !== null && typeof value === 'object';
}

// Filter state based on search query
function matchesSearch(key: string, value: any, query: string): boolean {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  if (key.toLowerCase().includes(lowerQuery)) return true;
  if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) return true;
  if (typeof value === 'number' && String(value).includes(query)) return true;
  return false;
}

// Player switching
function switchToPlayer(position: number) {
  emit('switch-player', position);
}

// Restart game
async function restartGame() {
  if (confirm('Are you sure you want to restart the game? All progress will be lost.')) {
    emit('restart-game');
  }
}

// Copy state to clipboard
function copyState() {
  navigator.clipboard.writeText(formattedState.value);
}

// Download state as JSON
function downloadState() {
  const blob = new Blob([formattedState.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game-state-${props.gameId || 'unknown'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Fetch action traces from server
async function fetchActionTraces() {
  if (!props.gameId || tracesLoading.value) return;

  tracesLoading.value = true;
  tracesError.value = null;

  try {
    const response = await fetch(`${props.apiUrl}/games/${props.gameId}/action-traces?player=${props.playerPosition}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch action traces');
    }

    actionTraces.value = data.traces || [];
    tracesLastFetched.value = Date.now();
  } catch (e) {
    tracesError.value = e instanceof Error ? e.message : 'Unknown error';
  } finally {
    tracesLoading.value = false;
  }
}

// Copy available actions to clipboard
async function copyAvailableActions() {
  const available = actionTraces.value.filter(t => t.available);
  await copyNodeToClipboard(available);
}

// Copy unavailable actions to clipboard
async function copyUnavailableActions() {
  const unavailable = actionTraces.value.filter(t => !t.available);
  await copyNodeToClipboard(unavailable);
}

// Group elements by class name from the view tree
interface GroupedElement {
  id: number;
  className: string;
  name?: string;
  notation?: string;
  attributes: Record<string, unknown>;
  fullObject: Record<string, unknown>; // Store full object for detail view
}

const groupedElements = computed(() => {
  const groups: Record<string, GroupedElement[]> = {};

  function traverse(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (typeof obj.id === 'number') {
      const className = (obj.className as string) || 'Unknown';
      if (!groups[className]) {
        groups[className] = [];
      }

      // Create a copy of the object without children for the detail view
      const { children, ...objectWithoutChildren } = obj;

      groups[className].push({
        id: obj.id,
        className,
        name: obj.name as string | undefined,
        notation: obj.notation as string | undefined,
        attributes: (obj.attributes as Record<string, unknown>) || {},
        fullObject: objectWithoutChildren,
      });
    }

    // Traverse children
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) {
        traverse(child);
      }
    }
  }

  if (displayedState.value?.state?.view) {
    traverse(displayedState.value.state.view);
  }

  return groups;
});

// Get the currently selected element
const selectedElement = computed<GroupedElement | null>(() => {
  if (selectedElementId.value === null) return null;
  for (const elements of Object.values(groupedElements.value)) {
    const found = elements.find(el => el.id === selectedElementId.value);
    if (found) return found;
  }
  return null;
});

// Copy element JSON to clipboard
async function copyElementToClipboard(element: GroupedElement) {
  await copyNodeToClipboard(element.fullObject);
}

// Filter elements by search query
const filteredElementGroups = computed(() => {
  if (!elementSearchQuery.value) return groupedElements.value;

  const query = elementSearchQuery.value.toLowerCase();
  const filtered: Record<string, GroupedElement[]> = {};

  for (const [className, elements] of Object.entries(groupedElements.value)) {
    const matchingElements = elements.filter(el =>
      className.toLowerCase().includes(query) ||
      el.name?.toLowerCase().includes(query) ||
      el.notation?.toLowerCase().includes(query) ||
      String(el.id).includes(query)
    );

    if (matchingElements.length > 0) {
      filtered[className] = matchingElements;
    }
  }

  return filtered;
});

// Toggle element group expansion
function toggleElementGroup(className: string) {
  if (expandedElementGroups.value.has(className)) {
    expandedElementGroups.value.delete(className);
  } else {
    expandedElementGroups.value.add(className);
  }
  expandedElementGroups.value = new Set(expandedElementGroups.value);
}

// Select an element and highlight it on the board
function selectElement(element: GroupedElement) {
  if (selectedElementId.value === element.id) {
    // Deselect
    selectedElementId.value = null;
    emit('highlight-element', null);
  } else {
    selectedElementId.value = element.id;
    emit('highlight-element', element.id);
  }
}

// Get display name for an element
function getElementDisplayName(element: GroupedElement): string {
  if (element.notation) return element.notation;
  if (element.name) return element.name;
  return `#${element.id}`;
}

// Get custom debug data from state
const customDebugData = computed(() => {
  return displayedState.value?.state?.customDebug ?? null;
});

// Discover deck elements from view tree
interface DeckInfo {
  id: number;
  name: string;
  className: string;
  cards: Array<{
    id: number;
    name?: string;
    notation?: string;
    className: string;
    fullObject: Record<string, unknown>;
  }>;
  fullObject: Record<string, unknown>;
}

const discoveredDecks = computed<DeckInfo[]>(() => {
  const decks: DeckInfo[] = [];

  function traverse(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    // Check if this is a deck element (has $type: 'deck' or className contains 'Deck')
    const isDeck = obj.$type === 'deck' ||
                   (typeof obj.className === 'string' && obj.className.toLowerCase().includes('deck'));

    if (isDeck && typeof obj.id === 'number') {
      const cards: DeckInfo['cards'] = [];

      // Traverse children to find cards
      if (Array.isArray(obj.children)) {
        for (const child of obj.children) {
          if (child && typeof child === 'object') {
            const cardObj = child as Record<string, unknown>;
            if (typeof cardObj.id === 'number') {
              const { children: cardChildren, ...cardWithoutChildren } = cardObj;
              cards.push({
                id: cardObj.id,
                name: cardObj.name as string | undefined,
                notation: cardObj.notation as string | undefined,
                className: (cardObj.className as string) || 'Unknown',
                fullObject: cardWithoutChildren,
              });
            }
          }
        }
      }

      const { children, ...deckWithoutChildren } = obj;
      decks.push({
        id: obj.id,
        name: (obj.name as string) || `Deck #${obj.id}`,
        className: (obj.className as string) || 'Deck',
        cards,
        fullObject: deckWithoutChildren,
      });
    }

    // Continue traversing children
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) {
        traverse(child);
      }
    }
  }

  if (displayedState.value?.state?.view) {
    traverse(displayedState.value.state.view);
  }

  return decks;
});

/**
 * Card container info - any element that can hold cards (decks, hands, discard piles, etc.)
 */
interface CardContainerInfo {
  id: number;
  name: string;
  className: string;
  cardCount: number;
}

/**
 * Discover all card containers in the game state.
 * This includes decks, hands, discard piles, and any other element with children.
 */
const discoveredCardContainers = computed<CardContainerInfo[]>(() => {
  const containers: CardContainerInfo[] = [];
  const seenIds = new Set<number>();

  function traverse(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    // Check if this element has children (making it a potential card container)
    if (typeof obj.id === 'number' && Array.isArray(obj.children) && obj.children.length > 0) {
      // Check if children look like cards (have id property)
      const hasCardLikeChildren = obj.children.some(
        (child: unknown) => child && typeof child === 'object' && typeof (child as Record<string, unknown>).id === 'number'
      );

      if (hasCardLikeChildren && !seenIds.has(obj.id)) {
        seenIds.add(obj.id);
        containers.push({
          id: obj.id,
          name: (obj.name as string) || (obj.className as string) || `Container #${obj.id}`,
          className: (obj.className as string) || 'Unknown',
          cardCount: obj.children.filter(
            (child: unknown) => child && typeof child === 'object' && typeof (child as Record<string, unknown>).id === 'number'
          ).length,
        });
      }
    }

    // Continue traversing children
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) {
        traverse(child);
      }
    }
  }

  if (displayedState.value?.state?.view) {
    traverse(displayedState.value.state.view);
  }

  return containers;
});

// Check if a card matches the search query
function cardMatchesSearch(card: DeckInfo['cards'][0], query: string): boolean {
  if (!query) return false;
  const lowerQuery = query.toLowerCase();
  return !!(
    (card.name && card.name.toLowerCase().includes(lowerQuery)) ||
    (card.notation && card.notation.toLowerCase().includes(lowerQuery)) ||
    card.className.toLowerCase().includes(lowerQuery) ||
    String(card.id).includes(lowerQuery)
  );
}

// Filter decks by search query (shows decks that match OR have cards that match)
const filteredDecks = computed(() => {
  if (!deckSearchQuery.value) return discoveredDecks.value;

  const query = deckSearchQuery.value.toLowerCase();
  return discoveredDecks.value.filter(deck => {
    // Check if deck itself matches
    const deckMatches =
      deck.name.toLowerCase().includes(query) ||
      deck.className.toLowerCase().includes(query) ||
      String(deck.id).includes(query);

    if (deckMatches) return true;

    // Check if any card in the deck matches
    return deck.cards.some(card => cardMatchesSearch(card, query));
  });
});

// Get decks that should be auto-expanded due to card-level search matches
const searchExpandedDecks = computed(() => {
  const expanded = new Set<number>();
  if (!deckSearchQuery.value) return expanded;

  const query = deckSearchQuery.value.toLowerCase();
  for (const deck of filteredDecks.value) {
    // Auto-expand if any card matches the search
    if (deck.cards.some(card => cardMatchesSearch(card, query))) {
      expanded.add(deck.id);
    }
  }
  return expanded;
});

// Check if a deck should be shown as expanded (user expanded OR search auto-expanded)
function isDeckExpanded(deckId: number): boolean {
  return expandedDecks.value.has(deckId) || searchExpandedDecks.value.has(deckId);
}

// Toggle deck expansion
function toggleDeck(deckId: number) {
  if (expandedDecks.value.has(deckId)) {
    expandedDecks.value.delete(deckId);
  } else {
    expandedDecks.value.add(deckId);
  }
  expandedDecks.value = new Set(expandedDecks.value);
}

// Get display name for a card
function getCardDisplayName(card: DeckInfo['cards'][0]): string {
  if (card.notation) return card.notation;
  if (card.name) return card.name;
  return `#${card.id}`;
}

// Select a card in a deck for detail view
function selectDeckCard(deckId: number, cardId: number) {
  if (selectedDeckCard.value?.deckId === deckId && selectedDeckCard.value?.cardId === cardId) {
    selectedDeckCard.value = null;
  } else {
    selectedDeckCard.value = { deckId, cardId };
  }
}

// Get the currently selected card object
const selectedCard = computed(() => {
  if (!selectedDeckCard.value) return null;
  const deck = discoveredDecks.value.find(d => d.id === selectedDeckCard.value!.deckId);
  if (!deck) return null;
  return deck.cards.find(c => c.id === selectedDeckCard.value!.cardId) || null;
});

// Copy deck contents to clipboard
async function copyDeckToClipboard(deck: DeckInfo) {
  await copyNodeToClipboard({
    ...deck.fullObject,
    cards: deck.cards.map(c => c.fullObject),
  });
}

// Deck manipulation API calls
async function moveCardToTop(cardId: number) {
  if (!props.gameId) {
    deckManipulationError.value = 'No game ID available';
    return;
  }

  deckManipulationLoading.value = true;
  deckManipulationError.value = null;

  try {
    const response = await fetch(`${props.apiUrl}/games/${props.gameId}/debug/move-to-top`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId }),
    });

    const data = await response.json();
    if (!data.success) {
      deckManipulationError.value = data.error || 'Failed to move card';
    }
    // State will be updated via WebSocket broadcast
  } catch (err) {
    deckManipulationError.value = err instanceof Error ? err.message : 'Network error';
  } finally {
    deckManipulationLoading.value = false;
  }
}

async function reorderCard(cardId: number, targetIndex: number) {
  if (!props.gameId) {
    deckManipulationError.value = 'No game ID available';
    return;
  }

  deckManipulationLoading.value = true;
  deckManipulationError.value = null;

  try {
    const response = await fetch(`${props.apiUrl}/games/${props.gameId}/debug/reorder-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId, targetIndex }),
    });

    const data = await response.json();
    if (!data.success) {
      deckManipulationError.value = data.error || 'Failed to reorder card';
    }
  } catch (err) {
    deckManipulationError.value = err instanceof Error ? err.message : 'Network error';
  } finally {
    deckManipulationLoading.value = false;
  }
}

async function transferCard(cardId: number, targetDeckId: number, position: 'first' | 'last' = 'first') {
  if (!props.gameId) {
    deckManipulationError.value = 'No game ID available';
    return;
  }

  deckManipulationLoading.value = true;
  deckManipulationError.value = null;

  try {
    const response = await fetch(`${props.apiUrl}/games/${props.gameId}/debug/transfer-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId, targetDeckId, position }),
    });

    const data = await response.json();
    if (!data.success) {
      deckManipulationError.value = data.error || 'Failed to transfer card';
    }
  } catch (err) {
    deckManipulationError.value = err instanceof Error ? err.message : 'Network error';
  } finally {
    deckManipulationLoading.value = false;
  }
}

async function shuffleDeck(deckId: number) {
  if (!props.gameId) {
    deckManipulationError.value = 'No game ID available';
    return;
  }

  deckManipulationLoading.value = true;
  deckManipulationError.value = null;

  try {
    const response = await fetch(`${props.apiUrl}/games/${props.gameId}/debug/shuffle-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId }),
    });

    const data = await response.json();
    if (!data.success) {
      deckManipulationError.value = data.error || 'Failed to shuffle deck';
    }
  } catch (err) {
    deckManipulationError.value = err instanceof Error ? err.message : 'Network error';
  } finally {
    deckManipulationLoading.value = false;
  }
}

// Move card up one position in the deck
function moveCardUp(deck: DeckInfo, cardId: number) {
  const currentIndex = deck.cards.findIndex(c => c.id === cardId);
  if (currentIndex > 0) {
    reorderCard(cardId, currentIndex - 1);
  }
}

// Move card down one position in the deck
function moveCardDown(deck: DeckInfo, cardId: number) {
  const currentIndex = deck.cards.findIndex(c => c.id === cardId);
  if (currentIndex < deck.cards.length - 1) {
    reorderCard(cardId, currentIndex + 1);
  }
}

// Transfer dialog state
const transferDialogOpen = ref(false);
const transferDialogCardId = ref<number | null>(null);
const transferDialogSourceDeckId = ref<number | null>(null);
const transferDialogTargetDeckId = ref<number | null>(null);
const transferDialogPosition = ref<'first' | 'last'>('first');

function openTransferDialog(cardId: number, sourceDeckId: number) {
  transferDialogCardId.value = cardId;
  transferDialogSourceDeckId.value = sourceDeckId;
  transferDialogTargetDeckId.value = null;
  transferDialogPosition.value = 'first';
  transferDialogOpen.value = true;
}

function closeTransferDialog() {
  transferDialogOpen.value = false;
  transferDialogCardId.value = null;
  transferDialogSourceDeckId.value = null;
}

async function confirmTransfer() {
  if (transferDialogCardId.value !== null && transferDialogTargetDeckId.value !== null) {
    await transferCard(transferDialogCardId.value, transferDialogTargetDeckId.value, transferDialogPosition.value);
    closeTransferDialog();
  }
}

// Get available target containers (excluding the source container)
// Uses discoveredCardContainers to include hands, discard piles, etc.
const availableTargetContainers = computed(() => {
  if (transferDialogSourceDeckId.value === null) return [];
  return discoveredCardContainers.value.filter(c => c.id !== transferDialogSourceDeckId.value);
});

// Format a condition value for display
function formatConditionValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return value.toString();
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Refresh action traces when switching to actions tab or when state changes
watch(activeTab, (tab) => {
  if (tab === 'actions' && props.gameId) {
    // Refresh traces when switching to actions tab
    if (Date.now() - tracesLastFetched.value > 2000) {
      fetchActionTraces();
    }
  }
});

// Refresh traces when state changes
watch(() => props.state, () => {
  if (activeTab.value === 'actions') {
    fetchActionTraces();
  }
}, { deep: false });

// Fetch action history from server
async function fetchHistory() {
  if (!props.gameId || historyLoading.value) return;

  historyLoading.value = true;
  historyError.value = null;

  try {
    const response = await fetch(`${props.apiUrl}/games/${props.gameId}/history`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch history');
    }

    actionHistory.value = data.actionHistory || [];
    historyLastFetched.value = Date.now();
  } catch (e) {
    historyError.value = e instanceof Error ? e.message : 'Unknown error';
  } finally {
    historyLoading.value = false;
  }
}

// Refresh history when switching to history tab
watch(activeTab, (tab) => {
  if (tab === 'history' && props.gameId) {
    // Refresh if not fetched recently (within 2 seconds)
    if (Date.now() - historyLastFetched.value > 2000) {
      fetchHistory();
    }
  }
});

// Refresh history when state changes (new action occurred)
watch(() => props.state, () => {
  if (activeTab.value === 'history') {
    fetchHistory();
  }
}, { deep: false });

// Format action for display
function formatActionName(name: string): string {
  // Convert camelCase to Title Case with spaces
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, s => s.toUpperCase());
}

// Format action arguments for display
function formatActionArgs(args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) {
      // Handle element references
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (obj.__elementRef) {
          parts.push(`${key}: ${obj.__elementRef}`);
        } else if (obj.__elementId) {
          parts.push(`${key}: #${obj.__elementId}`);
        } else {
          parts.push(`${key}: ${JSON.stringify(value)}`);
        }
      } else {
        parts.push(`${key}: ${value}`);
      }
    }
  }
  return parts.join(', ');
}

// Format timestamp
function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

// Select an action to view its state
async function selectAction(index: number) {
  // If clicking the last action (current state) or toggling off, go to live mode
  if (index === actionHistory.value.length || selectedActionIndex.value === index) {
    clearHistoricalState();
    return;
  }

  selectedActionIndex.value = index;
  await fetchStateAtAction(index);
}

// Fetch state at a specific action
async function fetchStateAtAction(actionIndex: number) {
  if (!props.gameId) return;

  historicalStateLoading.value = true;
  historicalStateError.value = null;

  try {
    // Fetch state and diff in parallel
    const [stateResponse, diffResponse] = await Promise.all([
      fetch(`${props.apiUrl}/games/${props.gameId}/state-at/${actionIndex}?player=${props.playerPosition}`),
      // Diff from previous action to this action (what changed to get here)
      actionIndex > 0
        ? fetch(`${props.apiUrl}/games/${props.gameId}/state-diff/${actionIndex - 1}/${actionIndex}?player=${props.playerPosition}`)
        : Promise.resolve(null),
    ]);

    const stateData = await stateResponse.json();
    const diffData = diffResponse ? await diffResponse.json() : null;

    if (!stateData.success) {
      throw new Error(stateData.error || 'Failed to fetch state');
    }

    historicalState.value = stateData.state;
    stateDiff.value = diffData?.success ? diffData.diff : null;

    // Emit to parent so main game UI can show historical state with diff
    emit('time-travel', stateData.state, actionIndex, stateDiff.value);
  } catch (e) {
    historicalStateError.value = e instanceof Error ? e.message : 'Unknown error';
    historicalState.value = null;
    stateDiff.value = null;
    emit('time-travel', null, null, null);
  } finally {
    historicalStateLoading.value = false;
  }
}

// Clear historical state when going back to live view
function clearHistoricalState() {
  selectedActionIndex.value = null;
  historicalState.value = null;
  historicalStateError.value = null;
  stateDiff.value = null;
  // Emit to parent to return to live state
  emit('time-travel', null, null, null);
}

// Rewind game to a specific action index (debug only)
// This permanently rewinds the game - all subsequent actions are discarded
const rewindLoading = ref(false);
const rewindError = ref<string | null>(null);

async function rewindToAction(actionIndex: number) {
  const actionsToDiscard = actionHistory.value.length - actionIndex;
  const confirmed = window.confirm(
    `Rewind to action ${actionIndex}?\n\nThis will permanently discard ${actionsToDiscard} action(s) and cannot be undone.`
  );

  if (!confirmed) return;

  rewindLoading.value = true;
  rewindError.value = null;

  try {
    const response = await fetch(`${props.apiUrl}/games/${props.gameId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionIndex }),
    });

    const result = await response.json();

    if (result.success) {
      // Clear time travel state - we're now at the live (rewound) state
      clearHistoricalState();
      // Refresh history to show the updated action list
      await fetchHistory();
    } else {
      rewindError.value = result.error || 'Rewind failed';
    }
  } catch (err) {
    rewindError.value = err instanceof Error ? err.message : 'Rewind failed';
  } finally {
    rewindLoading.value = false;
  }
}

// Computed: is viewing historical state?
const isViewingHistory = computed(() => selectedActionIndex.value !== null);

// Computed: the state to display in the State tab
// Note: props.state has structure { state: PlayerGameState, flowState: FlowState }
// historicalState is directly a PlayerGameState
// We wrap historical state to match the structure
const displayedState = computed(() => {
  if (isViewingHistory.value && historicalState.value) {
    return { state: historicalState.value, flowState: null };
  }
  return props.state;
});
</script>

<template>
  <div class="debug-panel" :class="{ expanded: panelExpanded }">
    <!-- Toggle tab (always visible on right edge) -->
    <div class="debug-toggle" @click="togglePanel">
      <span class="toggle-icon">{{ panelExpanded ? '›' : '‹' }}</span>
      <span class="toggle-label">Debug</span>
    </div>

    <!-- Drawer content -->
    <div class="debug-drawer" :class="{ open: panelExpanded }">
      <div class="debug-header">
        <span class="debug-title">Debug Panel</span>
        <span class="debug-hint">(Press D to toggle)</span>
        <button class="close-btn" @click="togglePanel">✕</button>
      </div>

      <!-- Expanded content -->
      <div class="debug-content">
        <!-- Tabs -->
        <div class="debug-tabs">
          <button
            :class="{ active: activeTab === 'state' }"
            @click="activeTab = 'state'"
          >
            State
          </button>
          <button
            :class="{ active: activeTab === 'elements' }"
            @click="activeTab = 'elements'"
          >
            Elements
          </button>
          <button
            :class="{ active: activeTab === 'decks' }"
            @click="activeTab = 'decks'"
          >
            Decks
            <span v-if="discoveredDecks.length > 0" class="tab-badge">{{ discoveredDecks.length }}</span>
          </button>
          <button
            :class="{ active: activeTab === 'actions' }"
            @click="activeTab = 'actions'"
          >
            Actions
          </button>
          <button
            :class="{ active: activeTab === 'history' }"
            @click="activeTab = 'history'"
          >
            History
          </button>
          <button
            :class="{ active: activeTab === 'controls' }"
            @click="activeTab = 'controls'"
          >
            Controls
          </button>
        </div>

        <!-- State Tab -->
        <div v-if="activeTab === 'state'" class="tab-content state-tab">
          <!-- Historical state banner -->
          <div v-if="isViewingHistory" class="historical-banner">
            <span class="historical-icon">&#9200;</span>
            <span>Viewing state after action {{ selectedActionIndex }}</span>
            <button class="debug-btn small" @click="clearHistoricalState">Back to Live</button>
          </div>

          <div class="state-actions">
            <button @click="copyState" class="debug-btn small">Copy</button>
            <button @click="downloadState" class="debug-btn small">Download</button>
            <button @click="expandAll" class="debug-btn small">Expand</button>
            <button @click="collapseAll" class="debug-btn small">Collapse</button>
            <label class="toggle-raw">
              <input type="checkbox" v-model="showRawState" />
              Raw
            </label>
          </div>

          <!-- Search box -->
          <div class="state-search">
            <input
              type="text"
              v-model="stateSearchQuery"
              placeholder="Search state..."
              class="search-input"
            />
          </div>

          <div class="state-display" :class="{ historical: isViewingHistory }">
            <pre v-if="showRawState">{{ formattedState }}</pre>

            <!-- Tree View -->
            <div v-else class="state-tree">
              <!-- Recursive tree component inline -->
              <template v-if="displayedState">
                <div class="tree-root">
                  <!-- Game info summary -->
                  <div class="tree-summary" :class="{ historical: isViewingHistory }">
                    <span class="summary-item">
                      <span class="summary-label">ID:</span>
                      <span class="summary-value">{{ gameId || 'N/A' }}</span>
                    </span>
                    <span class="summary-item">
                      <span class="summary-label">Phase:</span>
                      <span class="summary-value">{{ displayedState?.state?.phase || 'N/A' }}</span>
                    </span>
                    <span class="summary-item">
                      <span class="summary-label">Turn:</span>
                      <span class="summary-value">P{{ (displayedState?.state?.currentPlayer ?? 0) + 1 }}</span>
                    </span>
                  </div>

                  <!-- State tree (recursive component) -->
                  <TreeNode
                    v-for="(value, key) in displayedState"
                    :key="key"
                    :node-key="String(key)"
                    :value="value"
                    :path="`root.${key}`"
                    :depth="0"
                    :expanded-paths="expandedPaths"
                    :search-query="stateSearchQuery"
                    @toggle="toggleExpand"
                    @copy="copyNodeToClipboard"
                  />
                </div>
              </template>
              <div v-else class="no-state">No state available</div>
            </div>
          </div>
        </div>

        <!-- Elements Tab -->
        <div v-if="activeTab === 'elements'" class="tab-content elements-tab">
          <!-- Search -->
          <div class="element-search">
            <input
              type="text"
              v-model="elementSearchQuery"
              placeholder="Search elements..."
              class="search-input"
            />
          </div>

          <!-- Split View: List + Details -->
          <div class="elements-split-view" :class="{ 'has-selection': selectedElement }">
            <!-- Element List -->
            <div class="elements-list-panel">
              <div v-if="Object.keys(filteredElementGroups).length === 0" class="no-elements">
                No elements found
              </div>

              <div v-else class="element-groups">
                <div
                  v-for="(elements, className) in filteredElementGroups"
                  :key="className"
                  class="element-group"
                >
                  <div
                    class="element-group-header"
                    @click="toggleElementGroup(className)"
                  >
                    <span class="group-arrow">
                      {{ expandedElementGroups.has(className) ? '▼' : '▶' }}
                    </span>
                    <span class="group-name">{{ className }}</span>
                    <span class="group-count">[{{ elements.length }}]</span>
                  </div>

                  <div v-if="expandedElementGroups.has(className)" class="element-list">
                    <div
                      v-for="element in elements"
                      :key="element.id"
                      class="element-item"
                      :class="{ selected: selectedElementId === element.id }"
                      @click="selectElement(element)"
                    >
                      <span class="element-name">{{ getElementDisplayName(element) }}</span>
                      <span class="element-id">#{{ element.id }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Element Detail Panel -->
            <div v-if="selectedElement" class="element-detail-panel">
              <div class="element-detail-header">
                <span class="element-detail-title">
                  {{ selectedElement.className }} #{{ selectedElement.id }}
                </span>
                <div class="element-detail-actions">
                  <button
                    @click="copyElementToClipboard(selectedElement)"
                    class="debug-btn small"
                    title="Copy JSON"
                  >
                    Copy
                  </button>
                  <button
                    @click="selectedElementId = null; emit('highlight-element', null)"
                    class="debug-btn small"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div class="element-detail-content">
                <pre class="element-json">{{ JSON.stringify(selectedElement.fullObject, null, 2) }}</pre>
              </div>
            </div>
          </div>

          <!-- Custom Debug Section -->
          <div v-if="customDebugData" class="custom-debug-section">
            <h4 class="section-title">Custom Debug</h4>
            <div class="custom-debug-content">
              <div
                v-for="(value, key) in customDebugData"
                :key="key"
                class="custom-debug-item"
              >
                <div class="custom-debug-key">
                  <span>{{ key }}</span>
                  <button
                    class="debug-btn small custom-debug-copy"
                    @click="copyNodeToClipboard(value)"
                    title="Copy JSON"
                  >
                    Copy
                  </button>
                </div>
                <pre class="custom-debug-value">{{ JSON.stringify(value, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Decks Tab -->
        <div v-if="activeTab === 'decks'" class="tab-content decks-tab">
          <!-- Search -->
          <div class="deck-search">
            <input
              type="text"
              v-model="deckSearchQuery"
              placeholder="Search decks or cards..."
              class="search-input"
            />
          </div>

          <!-- Error message -->
          <div v-if="deckManipulationError" class="deck-error">
            {{ deckManipulationError }}
            <button class="debug-btn small" @click="deckManipulationError = null">Dismiss</button>
          </div>

          <!-- No decks found -->
          <div v-if="filteredDecks.length === 0" class="no-decks">
            <template v-if="discoveredDecks.length === 0">
              No deck elements found in game state.
              <div class="deck-hint">
                Decks are elements with <code>$type: 'deck'</code> or className containing "Deck".
              </div>
            </template>
            <template v-else>
              No decks match your search.
            </template>
          </div>

          <!-- Decks list with split view -->
          <div v-else class="decks-split-view" :class="{ 'has-selection': selectedCard }">
            <!-- Deck List Panel -->
            <div class="decks-list-panel">
              <div
                v-for="deck in filteredDecks"
                :key="deck.id"
                class="deck-item"
              >
                <div
                  class="deck-header"
                  @click="toggleDeck(deck.id)"
                >
                  <span class="deck-arrow">
                    {{ isDeckExpanded(deck.id) ? '▼' : '▶' }}
                  </span>
                  <span class="deck-name">{{ deck.name }}</span>
                  <span class="deck-count">[{{ deck.cards.length }} cards]</span>
                  <div class="deck-actions" @click.stop>
                    <button
                      class="debug-btn small deck-action-btn"
                      @click="shuffleDeck(deck.id)"
                      :disabled="deckManipulationLoading"
                      title="Shuffle deck"
                    >
                      🔀
                    </button>
                    <button
                      class="debug-btn small deck-action-btn"
                      @click="copyDeckToClipboard(deck)"
                      title="Copy deck JSON"
                    >
                      📋
                    </button>
                  </div>
                </div>

                <!-- Expanded card list -->
                <div v-if="isDeckExpanded(deck.id)" class="deck-cards">
                  <div v-if="deck.cards.length === 0" class="deck-empty">
                    Deck is empty
                  </div>
                  <div
                    v-for="(card, index) in deck.cards"
                    :key="card.id"
                    class="card-item"
                    :class="{
                      selected: selectedDeckCard?.deckId === deck.id && selectedDeckCard?.cardId === card.id,
                      'search-match': deckSearchQuery && cardMatchesSearch(card, deckSearchQuery)
                    }"
                    @click="selectDeckCard(deck.id, card.id)"
                  >
                    <span class="card-position">{{ index }}</span>
                    <span class="card-name">{{ getCardDisplayName(card) }}</span>
                    <span class="card-class">{{ card.className }}</span>
                    <span class="card-id">#{{ card.id }}</span>
                    <div class="card-actions" @click.stop>
                      <button
                        class="card-action-btn"
                        @click="moveCardToTop(card.id)"
                        :disabled="index === 0 || deckManipulationLoading"
                        title="Move to top"
                      >
                        ⬆️
                      </button>
                      <button
                        class="card-action-btn"
                        @click="moveCardUp(deck, card.id)"
                        :disabled="index === 0 || deckManipulationLoading"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        class="card-action-btn"
                        @click="moveCardDown(deck, card.id)"
                        :disabled="index === deck.cards.length - 1 || deckManipulationLoading"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        class="card-action-btn"
                        @click="openTransferDialog(card.id, deck.id)"
                        :disabled="discoveredCardContainers.length < 2 || deckManipulationLoading"
                        title="Transfer to another container"
                      >
                        ➡️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Card Detail Panel -->
            <div v-if="selectedCard" class="card-detail-panel">
              <div class="card-detail-header">
                <span class="card-detail-title">
                  {{ selectedCard.className }} #{{ selectedCard.id }}
                </span>
                <div class="card-detail-actions">
                  <button
                    @click="copyNodeToClipboard(selectedCard.fullObject)"
                    class="debug-btn small"
                    title="Copy JSON"
                  >
                    Copy
                  </button>
                  <button
                    @click="selectedDeckCard = null"
                    class="debug-btn small"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div class="card-detail-content">
                <pre class="card-json">{{ JSON.stringify(selectedCard.fullObject, null, 2) }}</pre>
              </div>
            </div>
          </div>

          <!-- Transfer Dialog -->
          <div v-if="transferDialogOpen" class="transfer-dialog-overlay" @click.self="closeTransferDialog">
            <div class="transfer-dialog">
              <div class="transfer-dialog-header">
                <span>Transfer Card</span>
                <button class="close-btn" @click="closeTransferDialog">×</button>
              </div>
              <div class="transfer-dialog-body">
                <div class="form-group">
                  <label>Target Container:</label>
                  <select v-model="transferDialogTargetDeckId">
                    <option :value="null" disabled>Select a container...</option>
                    <option v-for="container in availableTargetContainers" :key="container.id" :value="container.id">
                      {{ container.name }} ({{ container.className }}, {{ container.cardCount }} cards)
                    </option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Position:</label>
                  <div class="radio-group">
                    <label>
                      <input type="radio" v-model="transferDialogPosition" value="first" />
                      Top (first)
                    </label>
                    <label>
                      <input type="radio" v-model="transferDialogPosition" value="last" />
                      Bottom (last)
                    </label>
                  </div>
                </div>
              </div>
              <div class="transfer-dialog-footer">
                <button class="debug-btn" @click="closeTransferDialog">Cancel</button>
                <button
                  class="debug-btn primary"
                  @click="confirmTransfer"
                  :disabled="transferDialogTargetDeckId === null || deckManipulationLoading"
                >
                  {{ deckManipulationLoading ? 'Transferring...' : 'Transfer' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Loading indicator -->
          <div v-if="deckManipulationLoading" class="deck-loading">
            Processing...
          </div>
        </div>

        <!-- Actions Tab -->
        <div v-if="activeTab === 'actions'" class="tab-content actions-tab">
          <div class="actions-header">
            <span class="actions-count">{{ actionTraces.length }} actions</span>
            <button @click="fetchActionTraces" class="debug-btn small" :disabled="tracesLoading">
              {{ tracesLoading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>

          <div v-if="tracesError" class="traces-error">
            {{ tracesError }}
          </div>

          <div v-else-if="actionTraces.length === 0" class="no-traces">
            No action traces available
          </div>

          <div v-else class="traces-list">
            <!-- Available Actions -->
            <div class="trace-group">
              <div class="trace-group-header available">
                <span class="trace-icon">✓</span>
                <span class="trace-group-label">Available ({{ actionTraces.filter(t => t.available).length }})</span>
                <button
                  class="debug-btn small trace-copy-btn"
                  @click="copyAvailableActions"
                  title="Copy available actions"
                >
                  Copy
                </button>
              </div>
              <div class="trace-items">
                <div
                  v-for="trace in actionTraces.filter(t => t.available)"
                  :key="trace.actionName"
                  class="trace-item available"
                >
                  <span class="trace-name">{{ trace.actionName }}</span>
                  <span v-if="trace.selections.length > 0" class="trace-selections">
                    ({{ trace.selections.map(s => `${s.name}: ${s.choiceCount}`).join(', ') }})
                  </span>
                </div>
              </div>
            </div>

            <!-- Unavailable Actions -->
            <div class="trace-group">
              <div class="trace-group-header unavailable">
                <span class="trace-icon">✗</span>
                <span class="trace-group-label">Unavailable ({{ actionTraces.filter(t => !t.available).length }})</span>
                <button
                  class="debug-btn small trace-copy-btn"
                  @click="copyUnavailableActions"
                  title="Copy unavailable actions"
                >
                  Copy
                </button>
              </div>
              <div class="trace-items">
                <div
                  v-for="trace in actionTraces.filter(t => !t.available)"
                  :key="trace.actionName"
                  class="trace-item-detailed unavailable"
                >
                  <div class="trace-item-header">
                    <span class="trace-name">{{ trace.actionName }}</span>
                    <span class="trace-reason">
                      <template v-if="trace.conditionError">
                        error: {{ trace.conditionError }}
                      </template>
                      <template v-else-if="trace.conditionResult === false">
                        condition failed
                      </template>
                      <template v-else-if="trace.selections.some(s => s.choiceCount === 0)">
                        no choices for: {{ trace.selections.filter(s => s.choiceCount === 0).map(s => s.name).join(', ') }}
                      </template>
                      <template v-else>
                        unknown
                      </template>
                    </span>
                  </div>
                  <!-- Show condition details if available -->
                  <div v-if="trace.conditionDetails && trace.conditionDetails.length > 0" class="condition-details">
                    <div
                      v-for="(detail, idx) in trace.conditionDetails"
                      :key="idx"
                      class="condition-detail"
                      :class="{ passed: detail.passed, failed: !detail.passed }"
                    >
                      <span class="condition-icon">{{ detail.passed ? '✓' : '✗' }}</span>
                      <span class="condition-label">{{ detail.label }}</span>
                      <span class="condition-value">= {{ formatConditionValue(detail.value) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- History Tab -->
        <div v-if="activeTab === 'history'" class="tab-content history-tab">
          <div class="history-header">
            <span class="history-count">{{ actionHistory.length }} actions</span>
            <button @click="fetchHistory" class="debug-btn small" :disabled="historyLoading">
              {{ historyLoading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>

          <div v-if="historyError" class="history-error">
            {{ historyError }}
          </div>

          <div v-else-if="historyLoading && actionHistory.length === 0" class="history-loading">
            Loading history...
          </div>

          <div v-else-if="actionHistory.length === 0" class="history-empty">
            No actions yet
          </div>

          <!-- Timeline slider -->
          <div v-if="actionHistory.length > 0" class="timeline-controls">
            <button
              class="debug-btn small"
              :disabled="selectedActionIndex === null || selectedActionIndex <= 0"
              @click="selectAction((selectedActionIndex ?? actionHistory.length) - 1)"
            >
              &lt;
            </button>
            <input
              type="range"
              :min="0"
              :max="actionHistory.length"
              :value="selectedActionIndex ?? actionHistory.length"
              @input="selectAction(parseInt(($event.target as HTMLInputElement).value))"
              class="timeline-slider"
            />
            <button
              class="debug-btn small"
              :disabled="selectedActionIndex === null || selectedActionIndex >= actionHistory.length"
              @click="selectAction((selectedActionIndex ?? actionHistory.length - 1) + 1)"
            >
              &gt;
            </button>
            <span class="timeline-position">
              {{ selectedActionIndex ?? actionHistory.length }} / {{ actionHistory.length }}
            </span>
            <button
              v-if="isViewingHistory"
              class="debug-btn small live-btn"
              @click="clearHistoricalState"
            >
              Live
            </button>
            <button
              v-if="isViewingHistory && selectedActionIndex !== null && selectedActionIndex < actionHistory.length"
              class="debug-btn small rewind-btn"
              :disabled="rewindLoading"
              @click="rewindToAction(selectedActionIndex)"
              title="Permanently rewind game to this action"
            >
              {{ rewindLoading ? 'Rewinding...' : 'Rewind Here' }}
            </button>
          </div>
          <div v-if="rewindError" class="rewind-error">
            {{ rewindError }}
          </div>

          <!-- Action list -->
          <div v-if="actionHistory.length > 0" class="history-list">
            <div
              v-for="(action, index) in actionHistory"
              :key="index"
              class="history-item"
              :class="{
                current: index === actionHistory.length - 1 && !isViewingHistory,
                selected: selectedActionIndex === index + 1
              }"
              @click="selectAction(index + 1)"
            >
              <div class="history-item-header">
                <span class="history-index">{{ index + 1 }}</span>
                <span class="history-player" :class="`player-${action.player}`">
                  P{{ action.player + 1 }}
                </span>
                <span class="history-action-name">{{ formatActionName(action.name) }}</span>
                <span v-if="action.timestamp" class="history-time">
                  {{ formatTimestamp(action.timestamp) }}
                </span>
              </div>
              <div v-if="formatActionArgs(action.args)" class="history-item-args">
                {{ formatActionArgs(action.args) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Controls Tab -->
        <div v-if="activeTab === 'controls'" class="tab-content controls-tab">
          <!-- Player Perspective -->
          <div class="action-group">
            <h4>Player Perspective</h4>
            <div class="player-buttons">
              <button
                v-for="i in playerCount"
                :key="i - 1"
                @click="switchToPlayer(i - 1)"
                :class="{ active: playerPosition === i - 1 }"
                class="debug-btn"
              >
                Player {{ i }}
              </button>
            </div>
            <p class="hint">Switch to view the game as a different player</p>
          </div>

          <!-- Game Controls -->
          <div class="action-group">
            <h4>Game Controls</h4>
            <button @click="restartGame" class="debug-btn danger">
              Restart Game
            </button>
            <p class="hint">Start a new game (current progress will be lost)</p>
          </div>

          <!-- Settings -->
          <div class="action-group">
            <h4>Settings</h4>
            <label class="setting-item">
              <input type="checkbox" v-model="showRawState" />
              Show raw JSON by default
            </label>
          </div>

          <!-- Connection Info -->
          <div class="action-group">
            <h4>Connection</h4>
            <div class="state-item">
              <span class="label">API URL:</span>
              <span class="value monospace">{{ apiUrl }}</span>
            </div>
            <div class="state-item">
              <span class="label">Game ID:</span>
              <span class="value monospace">{{ gameId || 'N/A' }}</span>
            </div>
            <div class="shortcut-hint">
              <kbd>D</kbd> Toggle debug panel
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Copy toast notification -->
    <Transition name="toast">
      <div v-if="copyToastVisible" class="copy-toast">
        Copied to clipboard
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.debug-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  pointer-events: none;
}

/* Toggle tab on right edge */
.debug-toggle {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  cursor: pointer;
  background: rgba(0, 217, 255, 0.9);
  border-radius: 8px 0 0 8px;
  transition: all 0.2s;
  pointer-events: auto;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

.debug-toggle:hover {
  background: rgba(0, 217, 255, 1);
  padding-right: 10px;
}

.toggle-icon {
  font-size: 12px;
  color: #1a1a2e;
  font-weight: bold;
}

.toggle-label {
  font-weight: 600;
  color: #1a1a2e;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Drawer panel */
.debug-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 90vw;
  background: #1a1a2e;
  border-left: 2px solid #00d9ff;
  transform: translateX(100%);
  transition: transform 0.3s ease-in-out;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.debug-drawer.open {
  transform: translateX(0);
}

.debug-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(0, 217, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.debug-title {
  font-weight: 600;
  color: #fff;
}

.debug-hint {
  color: #666;
  font-size: 11px;
}

.close-btn {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
}

.close-btn:hover {
  color: #fff;
}

.debug-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.debug-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px 16px 0;
  background: rgba(0, 0, 0, 0.3);
}

.debug-tabs button {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: none;
  border-radius: 6px 6px 0 0;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.debug-tabs button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.debug-tabs button.active {
  background: rgba(0, 217, 255, 0.2);
  color: #00d9ff;
}

.tab-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

/* State Tab */
.state-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.toggle-raw {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #aaa;
  font-size: 12px;
  cursor: pointer;
}

.toggle-raw input {
  cursor: pointer;
}

.state-search {
  margin-bottom: 10px;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: #00d9ff;
}

.search-input::placeholder {
  color: #666;
}

.state-display {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  overflow: hidden;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
}

.state-display pre {
  padding: 12px;
  margin: 0;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 11px;
  color: #00ff88;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Tree View */
.state-tree {
  padding: 8px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 11px;
}

.tree-summary {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: rgba(0, 217, 255, 0.1);
  border-radius: 6px;
  margin-bottom: 12px;
}

.summary-item {
  display: flex;
  gap: 4px;
}

.summary-label {
  color: #888;
}

.summary-value {
  color: #00d9ff;
  font-weight: 500;
}

.tree-node {
  margin-left: 0;
}

.tree-children {
  margin-left: 16px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  padding-left: 8px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
  border-radius: 3px;
  cursor: default;
}

.tree-row.expandable {
  cursor: pointer;
}

.tree-row.expandable:hover {
  background: rgba(255, 255, 255, 0.05);
}

.tree-row.hidden {
  display: none;
}

.tree-arrow {
  color: #666;
  font-size: 10px;
  width: 12px;
  text-align: center;
}

.tree-arrow-placeholder {
  width: 12px;
}

.tree-key {
  color: #e0e0e0;
}

.tree-separator {
  color: #666;
}

.tree-value {
  margin-left: 4px;
}

.tree-copy-btn {
  opacity: 0;
  margin-left: auto;
  padding: 2px 6px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  color: #888;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}

.tree-row:hover .tree-copy-btn {
  opacity: 1;
}

.tree-copy-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.tree-json {
  margin-top: 4px;
}

.tree-json pre {
  margin: 0;
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  color: #00ff88;
  font-size: 10px;
  overflow-x: auto;
}

.no-state {
  color: #666;
  text-align: center;
  padding: 20px;
}

/* Actions Tab */
.action-group {
  margin-bottom: 20px;
}

.action-group h4 {
  color: #fff;
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

.action-group .hint {
  color: #666;
  font-size: 11px;
  margin-top: 8px;
}

.action-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-btn {
  min-width: 100px;
}

.action-prompt {
  color: #888;
  font-size: 11px;
}

.no-actions {
  color: #666;
  font-style: italic;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.player-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Settings Tab */
.setting-group {
  margin-bottom: 20px;
}

.setting-group h4 {
  color: #fff;
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #aaa;
  cursor: pointer;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #aaa;
}

.shortcut-item kbd,
.shortcut-hint kbd {
  display: inline-block;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: #00d9ff;
}

.shortcut-hint {
  margin-top: 8px;
  font-size: 11px;
  color: #888;
}

.state-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.state-item:last-child {
  border-bottom: none;
}

.state-item .label {
  color: #888;
}

.state-item .value {
  color: #00d9ff;
  font-weight: 500;
}

.state-item .value.monospace {
  font-family: monospace;
  font-size: 11px;
}

/* Buttons */
.debug-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.debug-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: #00d9ff;
}

.debug-btn.active {
  background: rgba(0, 217, 255, 0.2);
  border-color: #00d9ff;
  color: #00d9ff;
}

.debug-btn.small {
  padding: 4px 10px;
  font-size: 11px;
}

.debug-btn.danger {
  border-color: #e74c3c;
  color: #e74c3c;
}

.debug-btn.danger:hover {
  background: rgba(231, 76, 60, 0.2);
}

/* History Tab */
.history-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-count {
  color: #888;
  font-size: 12px;
}

.actions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.actions-count {
  color: #888;
  font-size: 12px;
}

.history-error {
  color: #e74c3c;
  padding: 12px;
  background: rgba(231, 76, 60, 0.1);
  border-radius: 6px;
  font-size: 12px;
}

.history-loading,
.history-empty {
  color: #666;
  font-style: italic;
  padding: 20px;
  text-align: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
}

.history-item {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  border-left: 3px solid transparent;
  transition: all 0.2s;
}

.history-item:hover {
  background: rgba(0, 0, 0, 0.3);
}

.history-item.current {
  border-left-color: #00d9ff;
  background: rgba(0, 217, 255, 0.1);
}

.history-item.selected {
  border-left-color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
}

.history-item {
  cursor: pointer;
}

.history-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-index {
  min-width: 24px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  font-size: 10px;
  color: #888;
}

.history-player {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.history-player.player-0 {
  background: rgba(59, 130, 246, 0.3);
  color: #60a5fa;
}

.history-player.player-1 {
  background: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.history-player.player-2 {
  background: rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

.history-player.player-3 {
  background: rgba(168, 85, 247, 0.3);
  color: #c084fc;
}

.history-action-name {
  color: #fff;
  font-weight: 500;
  flex: 1;
}

.history-time {
  color: #666;
  font-size: 10px;
}

.history-item-args {
  margin-top: 4px;
  padding-left: 32px;
  font-size: 11px;
  color: #888;
  font-family: 'Monaco', 'Menlo', monospace;
}

/* Timeline Controls */
.timeline-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 8px;
}

.timeline-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  cursor: pointer;
}

.timeline-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: #00d9ff;
  border-radius: 50%;
  cursor: pointer;
}

.timeline-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: #00d9ff;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.timeline-position {
  font-size: 11px;
  color: #888;
  min-width: 50px;
  text-align: center;
}

.live-btn {
  background: rgba(34, 197, 94, 0.2) !important;
  border-color: #22c55e !important;
  color: #22c55e !important;
}

.rewind-btn {
  background: rgba(245, 158, 11, 0.2) !important;
  border-color: #f59e0b !important;
  color: #f59e0b !important;
}

.rewind-btn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.4) !important;
}

.rewind-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rewind-error {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid #ef4444;
  color: #ef4444;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 12px;
}

/* Historical State Banner */
.historical-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 6px;
  margin-bottom: 12px;
  color: #f59e0b;
  font-size: 12px;
}

.historical-icon {
  font-size: 16px;
}

.historical-banner button {
  margin-left: auto;
}

/* Historical state indicator */
.state-display.historical {
  border: 2px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
}

.tree-summary.historical {
  background: rgba(245, 158, 11, 0.15);
}

/* Elements Tab */
.elements-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.element-search {
  margin-bottom: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

/* Actions Section */
.actions-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 16px;
}

.traces-error {
  color: #e74c3c;
  padding: 8px;
  background: rgba(231, 76, 60, 0.1);
  border-radius: 6px;
  font-size: 11px;
}

.no-traces {
  color: #666;
  font-style: italic;
  font-size: 11px;
}

.traces-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trace-group {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  overflow: hidden;
}

.trace-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.trace-group-header.available {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.trace-group-header.unavailable {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.trace-group-label {
  flex: 1;
}

.trace-copy-btn {
  opacity: 0.6;
  font-size: 9px !important;
  padding: 2px 6px !important;
  text-transform: none;
}

.trace-copy-btn:hover {
  opacity: 1;
}

.trace-icon {
  font-size: 12px;
}

.trace-items {
  padding: 4px 8px;
}

.trace-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 4px;
}

.trace-item.available .trace-name {
  color: #4ade80;
}

.trace-item.unavailable .trace-name {
  color: #f87171;
}

.trace-selections {
  color: #888;
  font-size: 10px;
}

.trace-reason {
  color: #888;
  font-size: 10px;
  font-style: italic;
}

/* Detailed trace item for unavailable actions */
.trace-item-detailed {
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  margin-bottom: 4px;
}

.trace-item-detailed.unavailable {
  border-left: 3px solid #f87171;
}

.trace-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.trace-item-detailed .trace-name {
  color: #f87171;
  font-weight: 500;
}

/* Condition details */
.condition-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.condition-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 10px;
  font-family: monospace;
}

.condition-detail.passed {
  color: #4ade80;
}

.condition-detail.failed {
  color: #f87171;
}

.condition-icon {
  font-size: 9px;
  width: 12px;
  text-align: center;
}

.condition-label {
  color: #aaa;
}

.condition-value {
  color: #888;
  font-size: 9px;
}

/* Elements Section */
.elements-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 16px;
}

.no-elements {
  color: #666;
  font-style: italic;
  font-size: 11px;
}

/* Elements split view layout */
.elements-split-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.elements-split-view.has-selection {
  flex-direction: row;
  gap: 12px;
}

.elements-list-panel {
  flex: 1;
  min-width: 0;
  max-height: 400px;
  overflow-y: auto;
}

.elements-split-view.has-selection .elements-list-panel {
  flex: 0 0 40%;
  max-height: 400px;
}

.element-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  overflow: hidden;
  max-height: 400px;
}

.element-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.element-detail-title {
  font-weight: 600;
  color: #3498db;
  font-size: 13px;
}

.element-detail-actions {
  display: flex;
  gap: 4px;
}

.element-detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.element-json {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  color: #ccc;
}

.element-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: none;
  overflow-y: visible;
}

.element-group {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  overflow: hidden;
}

.element-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.element-group-header:hover {
  background: rgba(255, 255, 255, 0.05);
}

.group-arrow {
  color: #666;
  font-size: 10px;
  width: 12px;
}

.group-name {
  color: #00d9ff;
  font-weight: 500;
  font-size: 12px;
}

.group-count {
  color: #888;
  font-size: 11px;
}

.element-list {
  padding: 4px 8px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.element-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.element-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.element-item.selected {
  background: rgba(0, 217, 255, 0.2);
  border: 1px solid rgba(0, 217, 255, 0.4);
}

.element-name {
  color: #e0e0e0;
  font-size: 11px;
}

.element-id {
  color: #666;
  font-size: 10px;
  font-family: 'Monaco', 'Menlo', monospace;
}

/* Custom Debug Section */
.custom-debug-section {
  padding-bottom: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.custom-debug-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.custom-debug-item {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  overflow: hidden;
}

.custom-debug-key {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(0, 217, 255, 0.1);
  color: #00d9ff;
  font-weight: 500;
  font-size: 11px;
}

.custom-debug-copy {
  opacity: 0.6;
  font-size: 9px !important;
  padding: 2px 6px !important;
}

.custom-debug-copy:hover {
  opacity: 1;
}

.custom-debug-value {
  margin: 0;
  padding: 8px 12px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 10px;
  color: #00ff88;
  overflow: auto;
  max-height: 200px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Copy toast */
.copy-toast {
  position: absolute;
  bottom: 60px;
  right: 20px;
  padding: 8px 16px;
  background: rgba(0, 217, 255, 0.9);
  color: #000;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  z-index: 1000;
  pointer-events: none;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* Tab badge */
.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  margin-left: 4px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(0, 217, 255, 0.3);
  color: #00d9ff;
  border-radius: 8px;
}

/* Decks Tab */
.decks-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.deck-search {
  margin-bottom: 4px;
}

.deck-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: #f87171;
  font-size: 12px;
}

.no-decks {
  color: #888;
  font-style: italic;
  padding: 20px;
  text-align: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.deck-hint {
  margin-top: 8px;
  font-size: 11px;
  color: #666;
}

.deck-hint code {
  background: rgba(0, 217, 255, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
  color: #00d9ff;
  font-size: 10px;
}

/* Decks split view */
.decks-split-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.decks-split-view.has-selection {
  flex-direction: row;
  gap: 12px;
}

.decks-list-panel {
  flex: 1;
  min-width: 0;
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.decks-split-view.has-selection .decks-list-panel {
  flex: 0 0 50%;
  max-height: 400px;
}

/* Deck item */
.deck-item {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  overflow: hidden;
}

.deck-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.deck-header:hover {
  background: rgba(255, 255, 255, 0.05);
}

.deck-arrow {
  color: #666;
  font-size: 10px;
  width: 12px;
}

.deck-name {
  color: #9b59b6;
  font-weight: 500;
  font-size: 12px;
  flex: 1;
}

.deck-count {
  color: #888;
  font-size: 11px;
}

.deck-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.deck-action-btn {
  opacity: 0.6;
  font-size: 12px !important;
  padding: 2px 6px !important;
  line-height: 1;
}

.deck-action-btn:hover:not(:disabled) {
  opacity: 1;
}

.deck-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Deck cards list */
.deck-cards {
  padding: 4px 8px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  max-height: 300px;
  overflow-y: auto;
}

.deck-empty {
  color: #666;
  font-style: italic;
  padding: 8px;
  text-align: center;
  font-size: 11px;
}

.card-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 11px;
}

.card-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.card-item.selected {
  background: rgba(155, 89, 182, 0.2);
  border: 1px solid rgba(155, 89, 182, 0.4);
}

.card-item.search-match {
  background: rgba(241, 196, 15, 0.2);
  border: 1px solid rgba(241, 196, 15, 0.5);
}

.card-item.search-match .card-name {
  color: #f1c40f;
  font-weight: bold;
}

.card-position {
  min-width: 20px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  font-size: 9px;
  color: #888;
}

.card-name {
  color: #e0e0e0;
  flex: 1;
}

.card-class {
  color: #666;
  font-size: 10px;
}

.card-id {
  color: #555;
  font-size: 10px;
  font-family: 'Monaco', 'Menlo', monospace;
}

/* Card action buttons */
.card-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.2s;
}

.card-item:hover .card-actions {
  opacity: 1;
}

.card-action-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  color: #aaa;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.card-action-btn:hover:not(:disabled) {
  background: rgba(0, 217, 255, 0.2);
  border-color: rgba(0, 217, 255, 0.3);
  color: #00d9ff;
}

.card-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Transfer dialog */
.transfer-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.transfer-dialog {
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  width: 300px;
  max-width: 90vw;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.transfer-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-weight: 600;
  color: #fff;
}

.transfer-dialog-header .close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.transfer-dialog-header .close-btn:hover {
  color: #fff;
}

.transfer-dialog-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.transfer-dialog-body .form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.transfer-dialog-body label {
  color: #aaa;
  font-size: 12px;
}

.transfer-dialog-body select {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 8px 12px;
  color: #fff;
  font-size: 13px;
}

.transfer-dialog-body select:focus {
  outline: none;
  border-color: #00d9ff;
}

.transfer-dialog-body .radio-group {
  display: flex;
  gap: 16px;
}

.transfer-dialog-body .radio-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #ccc;
}

.transfer-dialog-body .radio-group input[type="radio"] {
  accent-color: #00d9ff;
}

.transfer-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.debug-btn.primary {
  background: rgba(0, 217, 255, 0.2);
  border-color: rgba(0, 217, 255, 0.4);
  color: #00d9ff;
}

.debug-btn.primary:hover:not(:disabled) {
  background: rgba(0, 217, 255, 0.3);
}

.debug-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Deck loading indicator */
.deck-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.8);
  padding: 12px 20px;
  border-radius: 6px;
  color: #00d9ff;
  font-size: 12px;
  z-index: 100;
}

/* Card detail panel */
.card-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  overflow: hidden;
  max-height: 400px;
}

.card-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.card-detail-title {
  font-weight: 600;
  color: #9b59b6;
  font-size: 13px;
}

.card-detail-actions {
  display: flex;
  gap: 4px;
}

.card-detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.card-json {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  color: #ccc;
}

/* Deck tab positioning */
.decks-tab {
  position: relative;
}
</style>
