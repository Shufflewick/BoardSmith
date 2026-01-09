/**
 * useZoomPreview - Composable for showing enlarged card previews on Alt+hover
 *
 * Shows a larger preview of cards when the user holds Alt/Option and hovers over them.
 * Works automatically for ANY UI by cloning and scaling the actual card element.
 *
 * Card detection (in order of priority):
 * 1. Elements with `data-card-preview` attribute (explicit card data)
 * 2. Elements with `data-card-id` attribute (Auto-UI cards)
 * 3. Elements with `.card` class (custom UI convention)
 *
 * Usage in GameShell (automatic for all games):
 * ```typescript
 * const { previewState } = useZoomPreview();
 * // Add ZoomPreviewOverlay to template
 * ```
 */
import { ref, reactive, onMounted, onUnmounted, type Ref } from 'vue';

export interface CardPreviewData {
  /** Card rank (e.g., 'A', '5', 'K') */
  rank?: string;
  /** Card suit (e.g., 'H', 'S', 'C', 'D') */
  suit?: string;
  /** Face image - can be URL string or sprite object */
  faceImage?: unknown;
  /** Back image - can be URL string or sprite object */
  backImage?: unknown;
  /** Whether to show the back of the card */
  showBack?: boolean;
  /** Optional label to display */
  label?: string;
  /** Original card width in pixels (for non-standard shapes) */
  width?: number;
  /** Original card height in pixels (for non-standard shapes) */
  height?: number;
}

export interface DiePreviewData {
  /** Number of sides (4, 6, 8, 10, 12, or 20) */
  sides: 4 | 6 | 8 | 10 | 12 | 20;
  /** Current face value */
  value: number;
  /** Die color (CSS color string) */
  color?: string;
  /** Custom face labels (optional) */
  faceLabels?: string[];
  /** Custom face images (optional) */
  faceImages?: string[];
}

export interface PreviewState {
  /** Whether the preview is currently visible */
  visible: boolean;
  /** X position for the preview */
  x: number;
  /** Y position for the preview */
  y: number;
  /** The card data to display (if using data-card-preview) */
  cardData: CardPreviewData | null;
  /** The die data to display (if using data-die-preview) */
  dieData: DiePreviewData | null;
  /** The cloned element to display (if no card/die data) */
  clonedElement: HTMLElement | null;
  /** Scale factor for the preview */
  scale: number;
  /** Original element width (for sizing the wrapper in clone mode) */
  originalWidth: number;
  /** Original element height (for sizing the wrapper in clone mode) */
  originalHeight: number;
}

export interface ZoomPreviewOptions {
  /** Container element ref to attach event listeners to (defaults to document) */
  containerRef?: Ref<HTMLElement | null>;
  /** Scale factor for the preview (default: 2.5) */
  scale?: number;
}

export interface ZoomPreviewReturn {
  /** Whether the Alt/Option key is currently pressed */
  isAltPressed: Readonly<typeof isAltPressed>;
  /** The current preview state */
  previewState: PreviewState;
  /** Show the preview for a card (for manual triggering) */
  showPreview: (event: MouseEvent, cardData: CardPreviewData) => void;
  /** Hide the preview */
  hidePreview: () => void;
  /** Update preview position (call on mousemove) */
  updatePosition: (event: MouseEvent) => void;
}

// Global alt key state (shared across all instances)
const isAltPressed = ref(false);

// WeakMaps for storing cleanup functions without polluting DOM objects
const keyboardCleanupMap = new WeakMap<Window, () => void>();
const containerCleanupMap = new WeakMap<Element, () => void>();

// Track if global keyboard listeners are already attached
let keyboardListenersAttached = false;
let keyboardInstanceCount = 0;

function attachKeyboardListeners() {
  if (keyboardListenersAttached) return;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Alt') {
      isAltPressed.value = true;
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Alt') {
      isAltPressed.value = false;
    }
  };

  // Also hide on blur (user switches windows)
  const handleBlur = () => {
    isAltPressed.value = false;
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);

  keyboardListenersAttached = true;

  // Store cleanup function
  keyboardCleanupMap.set(window, () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
    keyboardListenersAttached = false;
  });
}

function detachKeyboardListeners() {
  const cleanup = keyboardCleanupMap.get(window);
  if (cleanup) {
    cleanup();
    keyboardCleanupMap.delete(window);
  }
}

export function useZoomPreview(options: ZoomPreviewOptions = {}): ZoomPreviewReturn {
  const scale = options.scale ?? 2.5;

  const previewState = reactive<PreviewState>({
    visible: false,
    x: 0,
    y: 0,
    cardData: null,
    dieData: null,
    clonedElement: null,
    scale,
    originalWidth: 0,
    originalHeight: 0,
  });

  // Track currently hovered card element (for Alt keydown while hovering)
  let currentHoveredElement: HTMLElement | null = null;
  let currentMouseEvent: MouseEvent | null = null;

  // Long press support for mobile
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchStartPos: { x: number; y: number } | null = null;
  const LONG_PRESS_DURATION = 400; // ms to trigger long press
  const TOUCH_MOVE_THRESHOLD = 10; // pixels - cancel if finger moves too far

  const PREVIEW_OFFSET = 20; // Pixels from cursor

  function showPreview(event: MouseEvent, cardData: CardPreviewData) {
    if (!isAltPressed.value) return;

    previewState.cardData = cardData;
    previewState.dieData = null;
    previewState.clonedElement = null;
    previewState.visible = true;
    updatePosition(event);
  }

  /**
   * Copy essential visual styles from computed styles to an element.
   * This is necessary because Vue scoped styles don't apply to cloned elements
   * that are moved outside their original component (via Teleport).
   */
  function copyVisualStyles(element: HTMLElement, original: HTMLElement) {
    const computed = window.getComputedStyle(original);

    // Copy essential visual properties using direct property access
    // (getPropertyValue doesn't work well for shorthand properties)
    element.style.backgroundColor = computed.backgroundColor;
    element.style.backgroundImage = computed.backgroundImage;
    element.style.backgroundPosition = computed.backgroundPosition;
    element.style.backgroundSize = computed.backgroundSize;
    element.style.backgroundRepeat = computed.backgroundRepeat;
    element.style.border = computed.border;
    element.style.borderRadius = computed.borderRadius;
    element.style.boxShadow = computed.boxShadow;
    element.style.color = computed.color;
    element.style.fontSize = computed.fontSize;
    element.style.fontWeight = computed.fontWeight;
    element.style.textAlign = computed.textAlign;
  }

  /**
   * Scale CSS sprite background properties on an element.
   * This fixes the issue where transform: scale() doesn't properly scale
   * background-position and background-size for CSS sprites.
   */
  function scaleSpriteBackground(element: HTMLElement, original: HTMLElement, scaleFactor: number) {
    const computed = window.getComputedStyle(original);
    const bgImage = computed.backgroundImage;
    const bgPosition = computed.backgroundPosition;
    const bgSize = computed.backgroundSize;

    // Only process elements with actual background images (not 'none')
    if (!bgImage || bgImage === 'none') return;

    // Check if this looks like a sprite (has specific background-position)
    if (bgPosition && bgPosition !== '0% 0%' && bgPosition !== '0px 0px') {
      // Parse background-position (e.g., "-238px -333px" or "10% 20%")
      const posMatch = bgPosition.match(/(-?\d+(?:\.\d+)?)(px|%)\s+(-?\d+(?:\.\d+)?)(px|%)/);
      if (posMatch) {
        const xVal = parseFloat(posMatch[1]);
        const xUnit = posMatch[2];
        const yVal = parseFloat(posMatch[3]);
        const yUnit = posMatch[4];

        // Scale pixel values, leave percentages as-is
        const newX = xUnit === 'px' ? xVal * scaleFactor : xVal;
        const newY = yUnit === 'px' ? yVal * scaleFactor : yVal;
        element.style.backgroundPosition = `${newX}${xUnit} ${newY}${yUnit}`;
      }
    }

    // Scale background-size if it's in pixels
    if (bgSize && bgSize !== 'auto' && bgSize !== 'cover' && bgSize !== 'contain') {
      const sizeMatch = bgSize.match(/(-?\d+(?:\.\d+)?)(px|%)\s+(-?\d+(?:\.\d+)?)(px|%)/);
      if (sizeMatch) {
        const wVal = parseFloat(sizeMatch[1]);
        const wUnit = sizeMatch[2];
        const hVal = parseFloat(sizeMatch[3]);
        const hUnit = sizeMatch[4];

        // Scale pixel values
        const newW = wUnit === 'px' ? wVal * scaleFactor : wVal;
        const newH = hUnit === 'px' ? hVal * scaleFactor : hVal;
        element.style.backgroundSize = `${newW}${wUnit} ${newH}${hUnit}`;
      }
    }
  }

  function showPreviewFromElement(element: HTMLElement, event: MouseEvent) {
    if (!isAltPressed.value) return;

    // First check for explicit die data (dice need special handling - can't clone WebGL canvas)
    const dieDataAttr = element.getAttribute('data-die-preview');
    if (dieDataAttr) {
      try {
        previewState.dieData = JSON.parse(dieDataAttr);
        previewState.cardData = null;
        previewState.clonedElement = null;
        previewState.visible = true;
        updatePosition(event);
        return;
      } catch {
        // Fall through to clone mode if parse fails
      }
    }

    // Check for explicit card data
    const cardDataAttr = element.getAttribute('data-card-preview');
    if (cardDataAttr) {
      try {
        previewState.cardData = JSON.parse(cardDataAttr);
        previewState.dieData = null;
        previewState.clonedElement = null;
      } catch {
        previewState.cardData = { label: cardDataAttr };
        previewState.dieData = null;
        previewState.clonedElement = null;
      }
    } else {
      // Clone the element for display
      const clone = element.cloneNode(true) as HTMLElement;
      const rect = element.getBoundingClientRect();

      // Store original dimensions for wrapper sizing
      previewState.originalWidth = rect.width;
      previewState.originalHeight = rect.height;

      // Remove any interactive classes/styles
      clone.classList.remove('selectable', 'selected', 'clickable', 'action-selectable');
      clone.style.cursor = 'default';
      clone.style.pointerEvents = 'none';
      clone.style.transform = 'none';
      clone.style.transition = 'none';
      clone.style.animation = 'none';
      clone.style.margin = '0';
      clone.style.position = 'relative';

      // Copy visual styles from the original element (needed because Vue scoped styles
      // don't apply to cloned elements moved outside their component via Teleport)
      copyVisualStyles(clone, element);

      // Scale CSS sprite backgrounds on the clone itself
      // (transform: scale() in the overlay handles element dimensions,
      // but doesn't scale background-position/size for CSS sprites)
      scaleSpriteBackground(clone, element, scale);

      // Get all child elements from both original and clone for sprite scaling
      const originalChildren = element.querySelectorAll('*');
      const cloneChildren = clone.querySelectorAll('*');

      // Process each child element
      cloneChildren.forEach((cloneChild, index) => {
        const el = cloneChild as HTMLElement;
        const originalChild = originalChildren[index] as HTMLElement;

        el.style.transform = 'none';
        el.style.transition = 'none';
        el.style.animation = 'none';

        // Copy visual styles and scale sprite backgrounds on child elements
        if (originalChild) {
          copyVisualStyles(el, originalChild);
          scaleSpriteBackground(el, originalChild, scale);
        }
      });

      previewState.cardData = null;
      previewState.dieData = null;
      previewState.clonedElement = clone;
    }

    previewState.visible = true;
    updatePosition(event);
  }

  function hidePreview() {
    previewState.visible = false;
    previewState.cardData = null;
    previewState.dieData = null;
    previewState.clonedElement = null;
  }

  function updatePosition(event: MouseEvent) {
    if (!previewState.visible) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Estimate preview dimensions based on typical card size scaled up
    const previewWidth = 80 * scale;
    const previewHeight = 120 * scale;

    // Calculate position - prefer right and below cursor
    let x = event.clientX + PREVIEW_OFFSET;
    let y = event.clientY + PREVIEW_OFFSET;

    // Flip to left if would overflow right edge
    if (x + previewWidth > viewportWidth - 10) {
      x = event.clientX - previewWidth - PREVIEW_OFFSET;
    }

    // Flip to above if would overflow bottom edge
    if (y + previewHeight > viewportHeight - 10) {
      y = event.clientY - previewHeight - PREVIEW_OFFSET;
    }

    // Ensure not off-screen
    x = Math.max(10, x);
    y = Math.max(10, y);

    previewState.x = x;
    previewState.y = y;
  }

  // Find zoomable element from event target
  // Detects cards by: data-card-preview, data-card-id, or various card classes
  // Detects dice by: data-die-preview, data-die-id, or dice classes
  function findCardElement(target: EventTarget | null): HTMLElement | null {
    let element = target as HTMLElement | null;
    while (element && element !== document.body) {
      // === CARD DETECTION ===
      // Check for explicit card preview data
      if (element.hasAttribute('data-card-preview')) {
        return element;
      }
      // Check for card ID (Auto-UI and custom UIs)
      if (element.hasAttribute('data-card-id')) {
        return element;
      }
      // Check for .card class (common convention)
      if (element.classList.contains('card')) {
        return element;
      }
      // Check for .card-back class (deck/crib backs in custom UIs)
      if (element.classList.contains('card-back')) {
        return element;
      }
      // Check for card-container (Auto-UI wrapper)
      if (element.classList.contains('card-container')) {
        return element;
      }
      // Check for deck-card (deck cards in Auto-UI)
      if (element.classList.contains('deck-card')) {
        return element;
      }
      // Check for hand-card (hand cards in Auto-UI)
      if (element.classList.contains('hand-card')) {
        return element;
      }

      // === DICE DETECTION ===
      // Check for explicit die preview data (must check this first - it has the data we need)
      if (element.hasAttribute('data-die-preview')) {
        return element;
      }
      // Check for die ID (Auto-UI)
      if (element.hasAttribute('data-die-id')) {
        return element;
      }
      // Check for .die-container class (Auto-UI wrapper - has data-die-preview)
      if (element.classList.contains('die-container')) {
        return element;
      }
      // Note: We intentionally don't detect .die-3d-container here because
      // it doesn't have the data-die-preview attribute. We need to keep
      // walking up to find .die-container which has the die data.

      element = element.parentElement;
    }
    return null;
  }

  // Event delegation handlers
  function handleMouseOver(event: MouseEvent) {
    const cardElement = findCardElement(event.target);

    if (cardElement) {
      currentHoveredElement = cardElement;
      currentMouseEvent = event;

      // If Alt is already pressed, show preview immediately
      if (isAltPressed.value) {
        showPreviewFromElement(cardElement, event);
      }
    }
  }

  function handleMouseOut(event: MouseEvent) {
    const cardElement = findCardElement(event.target);

    // Only hide if we're leaving the card element entirely
    const relatedCard = findCardElement(event.relatedTarget);
    if (cardElement && relatedCard !== cardElement) {
      if (currentHoveredElement === cardElement) {
        currentHoveredElement = null;
        currentMouseEvent = null;
        hidePreview();
      }
    }
  }

  function handleMouseMove(event: MouseEvent) {
    const cardElement = findCardElement(event.target);

    if (cardElement) {
      currentMouseEvent = event;
      if (previewState.visible) {
        updatePosition(event);
      }
    }
  }

  // Handle Alt key press while hovering
  function handleAltKeyDown() {
    if (currentHoveredElement && currentMouseEvent && isAltPressed.value) {
      showPreviewFromElement(currentHoveredElement, currentMouseEvent);
    }
  }

  // Handle Alt key release
  function handleAltKeyUp() {
    hidePreview();
  }

  // ============================================
  // Touch/Long Press Handlers for Mobile
  // ============================================

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    touchStartPos = null;
  }

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    const cardElement = findCardElement(event.target);

    if (cardElement) {
      touchStartPos = { x: touch.clientX, y: touch.clientY };

      // Start long press timer
      longPressTimer = setTimeout(() => {
        // Create a synthetic mouse event for positioning
        const syntheticEvent = {
          clientX: touch.clientX,
          clientY: touch.clientY,
        } as MouseEvent;

        // Temporarily set isAltPressed to allow preview
        const wasAltPressed = isAltPressed.value;
        isAltPressed.value = true;
        showPreviewFromElement(cardElement, syntheticEvent);
        isAltPressed.value = wasAltPressed;

        // Prevent context menu on long press
        event.preventDefault();
      }, LONG_PRESS_DURATION);
    }
  }

  function handleTouchMove(event: TouchEvent) {
    if (!touchStartPos || !longPressTimer) return;

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartPos.x);
    const deltaY = Math.abs(touch.clientY - touchStartPos.y);

    // Cancel long press if finger moves too far
    if (deltaX > TOUCH_MOVE_THRESHOLD || deltaY > TOUCH_MOVE_THRESHOLD) {
      cancelLongPress();
    }

    // Update preview position if visible
    if (previewState.visible) {
      const syntheticEvent = {
        clientX: touch.clientX,
        clientY: touch.clientY,
      } as MouseEvent;
      updatePosition(syntheticEvent);
    }
  }

  function handleTouchEnd() {
    cancelLongPress();
    hidePreview();
  }

  onMounted(() => {
    keyboardInstanceCount++;
    attachKeyboardListeners();

    // Get container (default to document.body)
    const container = options.containerRef?.value || document.body;

    // Attach mouse event delegation listeners
    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);
    container.addEventListener('mousemove', handleMouseMove);

    // Attach touch event listeners for mobile long press
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    // Watch Alt key state to trigger preview when pressed while hovering
    const checkAlt = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        if (e.type === 'keydown') {
          // Small delay to ensure isAltPressed ref is updated first
          requestAnimationFrame(() => {
            handleAltKeyDown();
          });
        } else {
          handleAltKeyUp();
        }
      }
    };

    window.addEventListener('keydown', checkAlt);
    window.addEventListener('keyup', checkAlt);

    // Store cleanup for this instance
    containerCleanupMap.set(container, () => {
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('mouseout', handleMouseOut);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('keydown', checkAlt);
      window.removeEventListener('keyup', checkAlt);
      cancelLongPress();
    });
  });

  onUnmounted(() => {
    keyboardInstanceCount--;
    if (keyboardInstanceCount === 0) {
      detachKeyboardListeners();
    }

    // Cleanup event delegation listeners
    const container = options.containerRef?.value || document.body;
    const containerCleanup = containerCleanupMap.get(container);
    if (containerCleanup) {
      containerCleanup();
      containerCleanupMap.delete(container);
    }

    // Hide preview when component unmounts
    previewState.visible = false;
    currentHoveredElement = null;
    currentMouseEvent = null;
  });

  return {
    isAltPressed,
    previewState,
    showPreview,
    hidePreview,
    updatePosition,
  };
}
