/**
 * Closes a dev-bar menu the way a menu is expected to close (#610).
 *
 * `open` is the menu's open flag, `container` the element that holds both its
 * toggle button and its list, and `trigger` that toggle button. The menu closes
 * on Escape, on a click outside `container`, and when this window loses focus.
 * That last one is what a click inside the game or world iframe looks like from
 * the outer page: the click is delivered to the frame's own document, so the
 * only thing this page sees is its window blurring. Escape also puts focus back
 * on `trigger` (#667); the other two leave it where the user put it.
 *
 * Choosing an item is the caller's to report, since only the caller knows which
 * clicks are choices: it calls the returned `chosen`, which closes the menu and,
 * since the chosen item goes away with it, moves focus to `into` (what the choice
 * opened on this page) or else back to `trigger` (#668). Focus moves once that
 * element is on the page, which after a seat change is when the host has seated
 * this page again, and only if focus is on nothing by then: focus the user put
 * somewhere, such as in the game frame, stays there.
 *
 * Call it from a component's `setup`; the listeners live as long as the
 * component does.
 */
import { nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue';
import { handleEscape } from '../../ui/utils/escape.js';

export function useMenuDismiss(
  open: Ref<boolean>,
  container: Ref<HTMLElement | null>,
  trigger: Ref<HTMLElement | null>,
): (into?: Ref<HTMLElement | null>) => void {
  function close(): void {
    open.value = false;
  }
  let focusAfterChoice: Ref<HTMLElement | null> | null = null;
  function placeFocus(): void {
    const target = focusAfterChoice?.value;
    if (!target) return;
    focusAfterChoice = null;
    if (document.activeElement === null || document.activeElement === document.body) target.focus();
  }
  watch(trigger, placeFocus, { flush: 'post' });
  function onKeydown(event: KeyboardEvent): void {
    if (!open.value) return;
    handleEscape(event, () => {
      close();
      trigger.value?.focus();
    });
  }
  function onClick(event: MouseEvent): void {
    if (open.value && !container.value?.contains(event.target as Node)) close();
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onClick);
    window.addEventListener('blur', close);
  });
  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onClick);
    window.removeEventListener('blur', close);
  });

  return (into) => {
    close();
    focusAfterChoice = into ?? trigger;
    void nextTick(placeFocus);
  };
}
