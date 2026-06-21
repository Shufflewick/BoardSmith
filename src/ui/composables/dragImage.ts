/**
 * dragImage - Shared drag-ghost helper for BoardSmith drag-and-drop.
 *
 * Native HTML drag uses the source element as the drag image. When the source
 * has a CSS transform (e.g. a translateY hover lift), the browser clips the
 * captured ghost. This helper detects that case and substitutes a
 * transform-stripped clone so the drag ghost matches the element's
 * untransformed bounds.
 *
 * Used by both `useDragDrop` (custom UIs) and the auto-UI element renderers so
 * the two interaction surfaces produce identical drag ghosts (visual parity).
 */

/**
 * Set a clean, transform-aware drag image for a native dragstart event.
 *
 * No-ops if the event has no `dataTransfer`. When the source element has a CSS
 * transform, a transform-stripped clone is used (and cleaned up next frame) so
 * the ghost is not clipped; otherwise the element itself is used directly.
 *
 * @param event - The `dragstart` DragEvent.
 * @param target - The element being dragged (the drag source).
 */
export function setTransformAwareDragImage(event: DragEvent, target: HTMLElement): void {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;

  const rect = target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  // Check if element has a CSS transform (e.g. translateY from hover state).
  // Transforms cause the drag ghost to be clipped, so use a transform-free clone.
  const transform = window.getComputedStyle(target).transform;
  if (!transform || transform === 'none') {
    // No transform - use the element directly.
    dataTransfer.setDragImage(target, x, y);
    return;
  }

  // Create a clone without the transform for a clean drag image.
  const clone = target.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  clone.style.position = 'absolute';
  clone.style.top = '-9999px';
  clone.style.left = '-9999px';
  document.body.appendChild(clone);

  // Use clone for drag image with correct cursor offset.
  dataTransfer.setDragImage(clone, x, y);

  // Clean up clone after the browser captures it.
  requestAnimationFrame(() => {
    document.body.removeChild(clone);
  });
}
