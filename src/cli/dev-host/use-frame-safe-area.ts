import { onUnmounted, watch, type Ref } from 'vue';

/**
 * SEND THE GAME FRAME ITS SAFE AREAS, AS A PRODUCTION HOST DOES (#1611).
 *
 * A frame cannot read its own: inside an iframe `env(safe-area-inset-*)` is 0
 * in Chrome and the parent's values in Safari. This page reads its own from a
 * probe padded by them, takes how far each reaches over the frame, and posts
 * `safe_area` when the frame says it is listening and again whenever the
 * frame's box changes them: a rotation, or the page's chrome moving the frame.
 * The message is `src/ui/safe-area.ts`'s.
 *
 * @param frame the game frame
 * @param post  sends a message to the frame, stamped by the caller's protocol
 * @returns what to call when the frame says it is ready; it always sends
 */
export function useFrameSafeArea(
  frame: Ref<HTMLIFrameElement | null>,
  post: (message: Record<string, unknown>) => void,
): () => void {
  const probe = document.createElement('div');
  probe.className = 'bsg-safe-area-probe';
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position: fixed; visibility: hidden; pointer-events: none; '
    + 'padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
  document.body.append(probe);

  let sent = '';
  function send(always: boolean): void {
    const el = frame.value;
    if (!el) return;
    const page = getComputedStyle(probe);
    const box = el.getBoundingClientRect();
    const over = (inset: string, gap: number) => Math.max(0, parseFloat(inset) - gap);
    const insets = {
      top: over(page.paddingTop, box.top),
      right: over(page.paddingRight, window.innerWidth - box.right),
      bottom: over(page.paddingBottom, window.innerHeight - box.bottom),
      left: over(page.paddingLeft, box.left),
    };
    const key = JSON.stringify(insets);
    if (!always && key === sent) return;
    sent = key;
    post({ type: 'safe_area', ...insets });
  }

  const observer = new ResizeObserver(() => send(false));
  watch(frame, (el, previous) => {
    if (previous) observer.unobserve(previous);
    if (el) observer.observe(el);
  }, { immediate: true });
  onUnmounted(() => {
    observer.disconnect();
    probe.remove();
  });
  return () => send(true);
}
