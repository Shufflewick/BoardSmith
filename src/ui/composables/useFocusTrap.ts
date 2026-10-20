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
 *     closes via onClose on Escape ONLY when escapeToClose is true.
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
// An element marked `data-bs-outside-modal` (the dev-only Debug panel, #1106,
// and v-disabled-reason's hidden reason nodes, #1028) is not part of the page a
// dialog covers, so it is never made inert.
// ---------------------------------------------------------------------------

const openTraps: Array<Ref<HTMLElement | null>> = [];
let inertAdded: HTMLElement[] = [];

function inertSiblingsOf(node: HTMLElement, parent: HTMLElement) {
  for (const sibling of Array.from(parent.children) as HTMLElement[]) {
    if (sibling === node || sibling.hasAttribute('inert') || sibling.hasAttribute('data-bs-outside-modal')) continue;
    sibling.setAttribute('inert', '');
    inertAdded.push(sibling);
  }
}

function syncInert() {
  for (const el of inertAdded) el.removeAttribute('inert');
  inertAdded = [];
  let node = openTraps.filter((r) => r.value).at(-1)?.value ?? null;
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

  // --------------------------------------------------------------------------
  // open() — save context, apply inert, focus first element
  // --------------------------------------------------------------------------

  function open() {
    if (openTraps.includes(dialogRef)) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    openTraps.push(dialogRef);
    syncInert();
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
