/**
 * useFocusTrap — A11Y-07 shared focus-trap composable
 *
 * Single source of truth for focus management in all three dialogs:
 *   HamburgerMenu drawer, ControlsMenu popover, GameOverCard overlay.
 *
 * Capabilities:
 *   - open(): saves document.activeElement, then on nextTick focuses first
 *     focusable element inside the dialog; applies inert to sibling DOM nodes.
 *   - close(): restores focus to the previously-focused element; removes inert.
 *   - handleKeydown(e): traps Tab within the focusable set (cycle on boundaries);
 *     closes via onClose on Escape ONLY when escapeToClose is true.
 *
 * Pitfall 3 guard: `aria-modal="true"` is an AT hint, not DOM enforcement.
 * `inert` on background siblings is the only mechanism that prevents Tab from
 * escaping the dialog for keyboard-only users.
 *
 * GameOverCard usage:
 *   useFocusTrap(dialogRef, { escapeToClose: false, onClose: () => {} })
 *   → Tab stays trapped; Escape does nothing; user must click Rematch/New Game.
 */
import { nextTick, type Ref } from 'vue';

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
  // Inert helpers — apply/remove on all siblings of the dialog within its parent
  // --------------------------------------------------------------------------

  function applySiblingInert() {
    const parent = dialogRef.value?.parentElement;
    if (!parent) return;
    for (const child of Array.from(parent.children)) {
      if (child !== dialogRef.value) {
        (child as HTMLElement).setAttribute('inert', '');
      }
    }
  }

  function removeSiblingInert() {
    const parent = dialogRef.value?.parentElement;
    if (!parent) return;
    for (const child of Array.from(parent.children)) {
      if (child !== dialogRef.value) {
        (child as HTMLElement).removeAttribute('inert');
      }
    }
  }

  return { open, close, handleKeydown };
}
