/**
 * useFocusTrap — A11Y-07 shared focus-trap composable
 *
 * Single source of truth for focus management in all three dialogs:
 *   ControlsMenu popover, GameOverCard overlay.
 *
 * Capabilities:
 *   - open(): saves document.activeElement, then on nextTick focuses first
 *     focusable element inside the dialog; makes the page behind it inert.
 *     Opening an open trap does nothing.
 *   - close(): restores focus to the previously-focused element; hands inert
 *     back to the trap below, if any. Closing a closed trap does nothing.
 *   - handleKeydown(e): traps Tab within the focusable set (cycle on boundaries);
 *     closes via onClose on Escape ONLY when escapeToClose is true. The caller
 *     wires it to the dialog's keydown.
 *   - A focused item that turns disabled or is removed while the trap is the
 *     top one hands focus to the next item (or the one before, or the dialog),
 *     so the dialog's keydown keeps hearing every key. Give the dialog
 *     tabindex="-1" so focus has somewhere to go when no item is left.
 *
 * Pitfall 3 guard: `aria-modal="true"` is an AT hint, not DOM enforcement.
 * `inert` on background siblings is the only mechanism that prevents Tab from
 * escaping the dialog for keyboard-only users.
 *
 * The trap closes itself when its owning scope (the component) is disposed,
 * so callers need no unmount cleanup.
 *
 * GameOverCard usage (D10):
 *   useFocusTrap(dialogRef, { escapeToClose: true, onClose: () => emit('dismiss') })
 *   → Tab stays trapped; Escape dismisses the card (same as the close button).
 */
import { nextTick, onScopeDispose, type Ref } from 'vue';

export interface FocusTrapOptions {
  /** Whether pressing Escape calls onClose. Defaults to true. */
  escapeToClose?: boolean;
  /** Called when the trap decides the dialog should close (Escape key, when enabled). */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Internal helper: collect all keyboard-focusable elements within a container
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
].join(', ');

// A hidden or inert match cannot take focus, so the Tab wrap must not stop on it (#1024).
function canTakeFocus(el: HTMLElement): boolean {
  if (el.closest('[inert]')) return false;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return false;
  }
  return getComputedStyle(el).visibility === 'visible';
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(canTakeFocus);
}

// ---------------------------------------------------------------------------
// Inert (CR-01, #863)
//
// Only the newest open trap is modal: the siblings of its dialog and of each
// of the dialog's ancestors up to <body> are inert, so a dialog nested inside
// the app (GameOverCard, anything teleported to #bs-game-modal) leaves the
// board and Action Panel unreachable. Every open or close recomputes this from
// the stack of open traps, so traps can close in any order, and a dialog that
// opens inside an older trap's background (the game ends while ControlsMenu is
// open) is reachable until it closes. Only `inert` this module added is ever
// removed; `inert` the page set itself is left alone, even on the dialog's path.
// An element marked `data-bs-outside-modal` (the dev-only Debug panel, #1106)
// is not part of the page a dialog covers, so it is never made inert. Neither is
// a `hidden` one: it takes no focus, and not every browser reads an inert
// aria-describedby target, such as v-disabled-reason's reason text (#1028).
// ---------------------------------------------------------------------------

const openTraps: Array<Ref<HTMLElement | null>> = [];
let inertAdded: HTMLElement[] = [];

function inertSiblingsOf(node: HTMLElement, parent: HTMLElement) {
  for (const sibling of Array.from(parent.children) as HTMLElement[]) {
    if (sibling === node || sibling.hidden || sibling.hasAttribute('inert') || sibling.hasAttribute('data-bs-outside-modal')) continue;
    sibling.setAttribute('inert', '');
    inertAdded.push(sibling);
  }
}

const topTrap = () => openTraps.filter((r) => r.value).at(-1);

function syncInert() {
  for (const el of inertAdded) el.removeAttribute('inert');
  inertAdded = [];
  let node = topTrap()?.value ?? null;
  while (node && node !== document.body && node.parentElement) {
    inertSiblingsOf(node, node.parentElement);
    node = node.parentElement;
  }
}

// ---------------------------------------------------------------------------
// useFocusTrap
// ---------------------------------------------------------------------------

export function useFocusTrap(
  dialogRef: Ref<HTMLElement | null>,
  options?: FocusTrapOptions,
) {
  const escapeToClose = options?.escapeToClose ?? true;
  let previouslyFocused: HTMLElement | null = null;

  // A browser drops focus from a disabled or removed item to <body>, out of reach of the dialog's keydown (#1453, #1457).
  function refocusLostItem(e: FocusEvent) {
    const dialog = dialogRef.value;
    const lost = e.target as HTMLElement;
    if (e.relatedTarget || !dialog?.contains(lost)) return;
    // A removed item is still attached when its focusout fires, so look once the change is done.
    queueMicrotask(() => {
      if (topTrap() !== dialogRef || document.activeElement !== document.body) return;
      if (lost.isConnected && !lost.matches(':disabled') && canTakeFocus(lost)) return;
      const focusable = getFocusable(dialog);
      const next = focusable.find((el) => lost.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      (next ?? focusable.at(-1) ?? dialog).focus();
    });
  }

  // --------------------------------------------------------------------------
  // open() — save context, apply inert, focus first element
  // --------------------------------------------------------------------------

  function open() {
    if (openTraps.includes(dialogRef)) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    openTraps.push(dialogRef);
    syncInert();
    document.addEventListener('focusout', refocusLostItem);
    nextTick(() => {
      if (!dialogRef.value) return;
      const focusable = getFocusable(dialogRef.value);
      focusable[0]?.focus();
    });
  }

  // --------------------------------------------------------------------------
  // close() — restore context, remove inert
  // --------------------------------------------------------------------------

  function close() {
    const index = openTraps.indexOf(dialogRef);
    if (index === -1) return;
    openTraps.splice(index, 1);
    syncInert();
    document.removeEventListener('focusout', refocusLostItem);
    previouslyFocused?.focus();
  }

  // An owner that unmounts while open (ControlsMenu, #862) must not leave the app inert.
  onScopeDispose(() => {
    close();
  });

  // --------------------------------------------------------------------------
  // handleKeydown() — Tab trap + Escape gate
  // --------------------------------------------------------------------------

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (escapeToClose) {
        options?.onClose?.();
      }
      return;
    }

    if (e.key !== 'Tab' || !dialogRef.value) return;

    const focusable = getFocusable(dialogRef.value);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift+Tab from first → wrap to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab from last → wrap to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return { open, close, handleKeydown };
}
