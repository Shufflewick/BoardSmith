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
import { ref, nextTick, effectScope } from 'vue';
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

// Traps are made inside a scope, as in a component; stopping it closes any left open.
let scope = effectScope();
function trap(...args: Parameters<typeof useFocusTrap>) {
  return scope.run(() => useFocusTrap(...args))!;
}

describe('useFocusTrap', () => {
  afterEach(() => {
    scope.stop();
    scope = effectScope();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // open() — focus move
  // -------------------------------------------------------------------------

  it('open() focuses first focusable element inside the dialog after nextTick', async () => {
    const dialog = appendDialog('<button id="b1">First</button><button id="b2">Second</button>');
    const dialogRef = ref(dialog);
    const { open } = trap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();

    expect(document.activeElement).toBe(dialog.querySelector('#b1'));
  });

  it('open() does not throw when dialog has no focusable elements', () => {
    const dialog = appendDialog('<p>No buttons here</p>');
    const dialogRef = ref(dialog);
    const { open } = trap(dialogRef, { onClose: vi.fn() });

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
    const { open, close } = trap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();
    close();

    expect(document.activeElement).toBe(trigger);
  });

  it('close() does not throw when no element was previously focused', () => {
    const dialog = appendDialog('<button id="b1">Inside</button>');
    const dialogRef = ref(dialog);
    const { open, close } = trap(dialogRef, { onClose: vi.fn() });

    // Do NOT call open() first — previouslyFocused is null
    expect(() => close()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Tab trapping — cycle forward / backward within dialog
  // -------------------------------------------------------------------------

  it('Tab from last focusable wraps to first', async () => {
    const dialog = appendDialog('<button id="b1">First</button><button id="b2">Last</button>');
    const dialogRef = ref(dialog);
    const { open, handleKeydown } = trap(dialogRef, { onClose: vi.fn() });

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
    const { open, handleKeydown } = trap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();

    // After open(), focus is on first button already
    handleKeydown(makeKeyEvent('Tab', /* shiftKey= */ true));

    expect(document.activeElement).toBe(dialog.querySelector('#b2'));
  });

  it('Tab in a single-element dialog wraps back to that element', async () => {
    const dialog = appendDialog('<button id="only">Only</button>');
    const dialogRef = ref(dialog);
    const { open, handleKeydown } = trap(dialogRef, { onClose: vi.fn() });

    open();
    await nextTick();

    handleKeydown(makeKeyEvent('Tab'));
    expect(document.activeElement).toBe(dialog.querySelector('#only'));
  });

  // Each case is an element that matches the focusable selector but cannot take focus (#1024).
  describe.each([
    ['hidden attribute', '<button hidden>X</button>'],
    ['display: none', '<button style="display: none">X</button>'],
    ['display: none on an ancestor', '<div style="display: none"><button>X</button></div>'],
    ['visibility: hidden on an ancestor', '<div style="visibility: hidden"><button>X</button></div>'],
    ['inert ancestor', '<div inert><button>X</button></div>'],
    ['disabled fieldset', '<fieldset disabled><input></fieldset>'],
  ])('skips an element that cannot take focus (%s)', (_label, unfocusable) => {
    it('Tab from the last focusable one wraps to the first', async () => {
      const dialog = appendDialog(`${unfocusable}<button id="b1">First</button><button id="b2">Last</button>${unfocusable}`);
      const { open, handleKeydown } = trap(ref(dialog), { onClose: vi.fn() });

      open();
      await nextTick();
      expect(document.activeElement).toBe(dialog.querySelector('#b1'));

      (dialog.querySelector('#b2') as HTMLButtonElement).focus();
      handleKeydown(makeKeyEvent('Tab'));
      expect(document.activeElement).toBe(dialog.querySelector('#b1'));

      handleKeydown(makeKeyEvent('Tab', /* shiftKey= */ true));
      expect(document.activeElement).toBe(dialog.querySelector('#b2'));
    });
  });

  // -------------------------------------------------------------------------
  // Escape key — escapeToClose option
  // -------------------------------------------------------------------------

  it('Escape calls onClose when escapeToClose is true (default)', () => {
    const onClose = vi.fn();
    const dialog = appendDialog('<button id="b1">OK</button>');
    const dialogRef = ref(dialog);
    const { handleKeydown } = trap(dialogRef, { escapeToClose: true, onClose });

    handleKeydown(makeKeyEvent('Escape'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onClose when escapeToClose is omitted (defaults to true)', () => {
    const onClose = vi.fn();
    const dialog = appendDialog('<button id="b1">OK</button>');
    const dialogRef = ref(dialog);
    // No escapeToClose specified — should default to true
    const { handleKeydown } = trap(dialogRef, { onClose });

    handleKeydown(makeKeyEvent('Escape'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape does NOT call onClose when escapeToClose is false (GameOverCard case)', () => {
    const onClose = vi.fn();
    const dialog = appendDialog('<button id="b1">Rematch</button>');
    const dialogRef = ref(dialog);
    const { handleKeydown } = trap(dialogRef, { escapeToClose: false, onClose });

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
    const { open } = trap(dialogRef, { onClose: vi.fn() });

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
    const { open, close } = trap(dialogRef, { onClose: vi.fn() });

    open();
    expect(sibling.hasAttribute('inert')).toBe(true);

    close();
    expect(sibling.hasAttribute('inert')).toBe(false);
  });

  it('open() applies inert to body-level siblings even when dialog is deeply nested (CR-01)', () => {
    // Simulate real DOM: body > hostRoot > wrapper > dialog
    const bodySibling = document.createElement('div');
    bodySibling.id = 'body-sibling';
    document.body.appendChild(bodySibling);

    const hostRoot = document.createElement('div');
    hostRoot.id = 'host-root';
    document.body.appendChild(hostRoot);

    const wrapper = document.createElement('div');
    hostRoot.appendChild(wrapper);

    const dialog = document.createElement('div');
    dialog.innerHTML = '<button id="b-nested">OK</button>';
    wrapper.appendChild(dialog);

    const dialogRef = ref(dialog);
    const { open } = trap(dialogRef, { onClose: vi.fn() });

    open();

    // bodySibling is a sibling of hostRoot at body level — must be inerted
    expect(bodySibling.hasAttribute('inert')).toBe(true);
    // hostRoot itself must NOT be inerted (it contains the dialog)
    expect(hostRoot.hasAttribute('inert')).toBe(false);
    // The immediate wrapper around the dialog must NOT be inerted
    expect(wrapper.hasAttribute('inert')).toBe(false);
    // The dialog itself must NOT be inerted
    expect(dialog.hasAttribute('inert')).toBe(false);
  });

  it('close() removes inert even after dialogRef is cleared (CR-02 guard)', () => {
    // Simulate onBeforeUnmount / onUnmounted scenario: ref may be null at cleanup
    const sibling = document.createElement('div');
    sibling.id = 'sibling-guard';
    document.body.appendChild(sibling);

    const dialog = appendDialog('<button id="b1">OK</button>');
    const dialogRef = ref<HTMLElement | null>(dialog);
    const { open, close } = trap(dialogRef, { onClose: vi.fn() });

    open();
    expect(sibling.hasAttribute('inert')).toBe(true);

    // Simulate Vue clearing the template ref before cleanup runs
    dialogRef.value = null;

    close();
    // Cleanup must use the recorded elements (not dialogRef) so inert is removed even with null ref
    expect(sibling.hasAttribute('inert')).toBe(false);
  });

  it('disposing the owning scope while open removes inert (#862)', () => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const dialog = appendDialog('<button>OK</button>');

    const scope = effectScope();
    const trap = scope.run(() => useFocusTrap(ref(dialog), { onClose: vi.fn() }))!;
    trap.open();
    expect(app.hasAttribute('inert')).toBe(true);

    scope.stop();
    expect(app.hasAttribute('inert')).toBe(false);
  });

  // body > [#app > [#board, #shell > [#action-panel, #bs-game-modal > dialog]], #other]
  function buildAppTree() {
    const el = (id: string, parent: HTMLElement) => {
      const node = document.createElement('div');
      node.id = id;
      parent.appendChild(node);
      return node;
    };
    const app = el('app', document.body);
    const board = el('board', app);
    const shell = el('shell', app);
    const actionPanel = el('action-panel', shell);
    const modalHost = el('bs-game-modal', shell);
    const other = el('other', document.body);
    const dialog = el('dialog', modalHost);
    dialog.innerHTML = '<button>OK</button>';
    return { app, board, shell, actionPanel, modalHost, other, dialog };
  }

  it('a dialog inside #app makes the siblings at every level inert, but not its ancestors (#863)', () => {
    const t = buildAppTree();
    const { open, close } = trap(ref(t.dialog), { onClose: vi.fn() });

    open();
    for (const el of [t.board, t.actionPanel, t.other]) expect(el.hasAttribute('inert'), el.id).toBe(true);
    for (const el of [t.app, t.shell, t.modalHost, t.dialog]) expect(el.hasAttribute('inert'), el.id).toBe(false);

    close();
    for (const el of [t.board, t.actionPanel, t.other]) expect(el.hasAttribute('inert'), el.id).toBe(false);
  });

  it('close() leaves elements that were already inert before open() inert (#863)', () => {
    const t = buildAppTree();
    t.actionPanel.setAttribute('inert', '');
    t.other.setAttribute('inert', '');
    const { open, close } = trap(ref(t.dialog), { onClose: vi.fn() });

    open();
    close();

    expect(t.actionPanel.hasAttribute('inert')).toBe(true);
    expect(t.other.hasAttribute('inert')).toBe(true);
    expect(t.board.hasAttribute('inert')).toBe(false);
  });

  it('a second trap opened over the first restores the first trap\'s state on close (#863)', () => {
    const t = buildAppTree();
    const popover = appendDialog('<button>Menu</button>');
    const a = trap(ref(t.dialog), { onClose: vi.fn() });
    const b = trap(ref(popover), { onClose: vi.fn() });

    a.open();
    b.open();
    expect(t.app.hasAttribute('inert')).toBe(true);

    b.close();
    expect(t.app.hasAttribute('inert')).toBe(false);
    for (const el of [t.board, t.actionPanel, t.other]) expect(el.hasAttribute('inert'), el.id).toBe(true);

    a.close();
    for (const el of [t.board, t.actionPanel, t.other]) expect(el.hasAttribute('inert'), el.id).toBe(false);
  });

  const inertIds = () => Array.from(document.querySelectorAll('[inert]'), (e) => e.id).sort();

  it('closing the first trap while a second is open keeps the second one\'s background inert', () => {
    const t = buildAppTree();
    const popover = appendDialog('<button>Menu</button>');
    popover.id = 'popover';
    const a = trap(ref(t.dialog), { onClose: vi.fn() });
    const b = trap(ref(popover), { onClose: vi.fn() });

    a.open();
    b.open();
    a.close();
    expect(inertIds()).toEqual(['app', 'other']);

    b.close();
    expect(inertIds()).toEqual([]);
  });

  it('open() twice then close() leaves nothing inert', () => {
    const t = buildAppTree();
    const { open, close } = trap(ref(t.dialog), { onClose: vi.fn() });

    open();
    open();
    close();

    expect(inertIds()).toEqual([]);
  });

  it('a trap opened inside the background of an open trap is reachable, and the first comes back on close', () => {
    // ControlsMenu (body-level popover) is open when the game ends and GameOverCard opens inside #app.
    const t = buildAppTree();
    const popover = appendDialog('<button>Menu</button>');
    popover.id = 'popover';
    const menu = trap(ref(popover), { onClose: vi.fn() });
    const card = trap(ref(t.dialog), { onClose: vi.fn() });

    menu.open();
    card.open();
    expect(t.dialog.closest('[inert]')).toBeNull();
    expect(inertIds()).toEqual(['action-panel', 'board', 'other', 'popover']);

    card.close();
    expect(inertIds()).toEqual(['app', 'other']);

    menu.close();
    expect(inertIds()).toEqual([]);
  });
});
