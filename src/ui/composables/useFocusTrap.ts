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
  // Saved reference to the body-level host node whose siblings receive inert.
  // Using a plain variable (not dialogRef) means cleanup works even after the
  // Vue template ref is cleared at unmount (CR-02 guard).
  let _inertRoot: HTMLElement | null = null;

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
  // Inert helpers — apply/remove at body-child scope (CR-01)
  //
  // Walk up from the dialog to the direct child of <body> (the "scoping root"),
  // then apply `inert` to all of its siblings. This ensures Tab cannot escape
  // to any other top-level DOM subtree regardless of how deeply the dialog is
  // nested inside its parent components.
  // --------------------------------------------------------------------------

  function getScopingRoot(): HTMLElement | null {
    let node: HTMLElement | null = dialogRef.value;
    while (node && node.parentElement && node.parentElement !== document.body) {
      node = node.parentElement;
    }
    return node;
  }

  function applySiblingInert() {
    const target = getScopingRoot();
    const parent = target?.parentElement;
    if (!target || !parent) return;
    for (const child of Array.from(parent.children)) {
      if (child !== target) {
        (child as HTMLElement).setAttribute('inert', '');
      }
    }
    _inertRoot = target;
  }

  function removeSiblingInert() {
    const parent = _inertRoot?.parentElement;
    if (!parent) return;
    for (const child of Array.from(parent.children)) {
      if (child !== _inertRoot) {
        (child as HTMLElement).removeAttribute('inert');
      }
    }
    _inertRoot = null;
  }

  return { open, close, handleKeydown };
}
