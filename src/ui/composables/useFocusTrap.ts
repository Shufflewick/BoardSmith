/**
 * useFocusTrap — A11Y-07 shared focus-trap composable
 *
 * Single source of truth for focus management in all three dialogs:
 *   ControlsMenu popover, GameOverCard overlay.
 *
 * Capabilities:
 *   - open(): saves document.activeElement, then on nextTick focuses first
 *     focusable element inside the dialog; applies inert to the siblings of the
 *     dialog and of each of its ancestors up to <body>.
 *   - close(): restores focus to the previously-focused element; removes the
 *     inert that open() added.
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
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
].join(', ');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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
  // The elements open() made inert. Kept apart from dialogRef so cleanup works
  // even after the Vue template ref is cleared at unmount (CR-02 guard).
  let _inerted: HTMLElement[] | null = null;

  // --------------------------------------------------------------------------
  // open() — save context, apply inert, focus first element
  // --------------------------------------------------------------------------

  function open() {
    previouslyFocused = document.activeElement as HTMLElement | null;
    applySiblingInert();
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
    removeSiblingInert();
    previouslyFocused?.focus();
  }

  // An owner that unmounts while open (ControlsMenu, #862) must not leave the app inert.
  onScopeDispose(() => {
    if (_inerted) close();
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

  // --------------------------------------------------------------------------
  // Inert helpers (CR-01, #863)
  //
  // Walk up from the dialog to <body> and apply `inert` to the siblings at
  // every level, so a dialog nested inside the app (GameOverCard, anything
  // teleported to #bs-game-modal) leaves the board and Action Panel
  // unreachable, not just the other children of <body>. Only the elements
  // this trap made inert are recorded, so close() never clears an `inert`
  // someone else set, and a trap opened over another restores it on close.
  // --------------------------------------------------------------------------

  function applySiblingInert() {
    const added: HTMLElement[] = [];
    let node: HTMLElement | null = dialogRef.value;
    while (node && node !== document.body && node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children) as HTMLElement[]) {
        if (sibling !== node && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          added.push(sibling);
        }
      }
      node = node.parentElement;
    }
    _inerted = added;
  }

  function removeSiblingInert() {
    for (const el of _inerted ?? []) el.removeAttribute('inert');
    _inerted = null;
  }

  return { open, close, handleKeydown };
}
