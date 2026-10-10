/**
 * Closes a dev-bar menu the way a menu is expected to close (#610).
 *
 * `open` is the menu's open flag and `container` the element that holds both
 * its toggle button and its list. The menu closes on Escape, on a click outside
 * `container`, and when this window loses focus. That last one is what a click
 * inside the game or world iframe looks like from the outer page: the click is
 * delivered to the frame's own document, so the only thing this page sees is
 * its window blurring. Choosing an item is the caller's to close, since only
 * the caller knows which clicks are choices.
 *
 * Call it from a component's `setup`; the listeners live as long as the
 * component does.
 */
import { onMounted, onUnmounted, type Ref } from 'vue';

export function useMenuDismiss(open: Ref<boolean>, container: Ref<HTMLElement | null>): void {
  function close(): void {
    open.value = false;
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
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
}
