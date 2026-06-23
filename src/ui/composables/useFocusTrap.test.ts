// @vitest-environment jsdom
/**
 * useFocusTrap — A11Y-07 shared focus-trap composable
 *
 * Tests cover:
 *   - open(): moves focus to first focusable element inside dialog on nextTick
 *   - close(): restores focus to the element that was active before open()
 *   - Tab from last focusable wraps to first (cycle forward)
 *   - Shift+Tab from first focusable wraps to last (cycle backward)
 *   - Escape calls onClose when escapeToClose is true (default)
 *   - Escape does NOT call onClose when escapeToClose is false (GameOverCard case)
 *   - open() applies inert to sibling elements; close() removes it
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useFocusTrap } from './useFocusTrap.js';

function makeKeyEvent(key: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
}

// Helper: append a dialog element with given HTML to body, return element
function appendDialog(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('useFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // open() — focus move
  // -------------------------------------------------------------------------

  it('open() focuses first focusable element inside the dialog after nextTick', async () => {
    const dialog = appendDialog('<button id="b1">First</button><button id="b2">Second</button>');
    const dialogRef = ref(dialog);
    const { open } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();

    expect(document.activeElement).toBe(dialog.querySelector('#b1'));
  });

  it('open() does not throw when dialog has no focusable elements', () => {
    const dialog = appendDialog('<p>No buttons here</p>');
    const dialogRef = ref(dialog);
    const { open } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    expect(async () => {
      open();
      await nextTick();
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // close() — restore focus
  // -------------------------------------------------------------------------

  it('close() restores focus to the element that was focused before open()', async () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const dialog = appendDialog('<button id="b1">Inside</button>');
    const dialogRef = ref(dialog);
    const { open, close } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();
    close();

    expect(document.activeElement).toBe(trigger);
  });

  it('close() does not throw when no element was previously focused', () => {
    const dialog = appendDialog('<button id="b1">Inside</button>');
    const dialogRef = ref(dialog);
    const { open, close } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    // Do NOT call open() first — previouslyFocused is null
    expect(() => close()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Tab trapping — cycle forward / backward within dialog
  // -------------------------------------------------------------------------

  it('Tab from last focusable wraps to first', async () => {
    const dialog = appendDialog('<button id="b1">First</button><button id="b2">Last</button>');
    const dialogRef = ref(dialog);
    const { open, handleKeydown } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();

    // Move focus to last button
    const lastBtn = dialog.querySelector('#b2') as HTMLButtonElement;
    lastBtn.focus();

    handleKeydown(makeKeyEvent('Tab'));

    expect(document.activeElement).toBe(dialog.querySelector('#b1'));
  });

  it('Shift+Tab from first focusable wraps to last', async () => {
    const dialog = appendDialog('<button id="b1">First</button><button id="b2">Last</button>');
    const dialogRef = ref(dialog);
    const { open, handleKeydown } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();

    // After open(), focus is on first button already
    handleKeydown(makeKeyEvent('Tab', /* shiftKey= */ true));

    expect(document.activeElement).toBe(dialog.querySelector('#b2'));
  });

  it('Tab in a single-element dialog wraps back to that element', async () => {
    const dialog = appendDialog('<button id="only">Only</button>');
    const dialogRef = ref(dialog);
    const { open, handleKeydown } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();

    handleKeydown(makeKeyEvent('Tab'));
    expect(document.activeElement).toBe(dialog.querySelector('#only'));
  });

  // -------------------------------------------------------------------------
  // Escape key — escapeToClose option
  // -------------------------------------------------------------------------

  it('Escape calls onClose when escapeToClose is true (default)', () => {
    const onClose = vi.fn();
    const dialog = appendDialog('<button id="b1">OK</button>');
    const dialogRef = ref(dialog);
    const { handleKeydown } = useFocusTrap(dialogRef, { escapeToClose: true, onClose });

    handleKeydown(makeKeyEvent('Escape'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onClose when escapeToClose is omitted (defaults to true)', () => {
    const onClose = vi.fn();
    const dialog = appendDialog('<button id="b1">OK</button>');
    const dialogRef = ref(dialog);
    // No escapeToClose specified — should default to true
    const { handleKeydown } = useFocusTrap(dialogRef, { onClose });

    handleKeydown(makeKeyEvent('Escape'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape does NOT call onClose when escapeToClose is false (GameOverCard case)', () => {
    const onClose = vi.fn();
    const dialog = appendDialog('<button id="b1">Rematch</button>');
    const dialogRef = ref(dialog);
    const { handleKeydown } = useFocusTrap(dialogRef, { escapeToClose: false, onClose });

    handleKeydown(makeKeyEvent('Escape'));

    expect(onClose).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // inert siblings — applied on open, removed on close
  // -------------------------------------------------------------------------

  it('open() applies inert to body siblings of the dialog', () => {
    const sibling1 = document.createElement('div');
    sibling1.id = 'sibling1';
    const sibling2 = document.createElement('div');
    sibling2.id = 'sibling2';
    document.body.appendChild(sibling1);
    document.body.appendChild(sibling2);

    const dialog = appendDialog('<button id="b1">Focus me</button>');
    const dialogRef = ref(dialog);
    const { open } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    open();

    expect(sibling1.hasAttribute('inert')).toBe(true);
    expect(sibling2.hasAttribute('inert')).toBe(true);
    // Dialog itself must NOT get inert
    expect(dialog.hasAttribute('inert')).toBe(false);
  });

  it('close() removes inert from body siblings', () => {
    const sibling = document.createElement('div');
    sibling.id = 'sibling';
    document.body.appendChild(sibling);

    const dialog = appendDialog('<button id="b1">OK</button>');
    const dialogRef = ref(dialog);
    const { open, close } = useFocusTrap(dialogRef, { onClose: vi.fn() });

    open();
    expect(sibling.hasAttribute('inert')).toBe(true);

    close();
    expect(sibling.hasAttribute('inert')).toBe(false);
  });
});
