/**
 * The shared state behind the disabled-reason tooltip.
 *
 * ONE tooltip element exists for the whole shell, and every reason-disabled
 * control borrows it. The alternative — a popover per button — would mount a
 * teleported node for each of eight compass directions, every card in a hand,
 * every option in a list, all to show at most one at a time.
 *
 * Module-scoped rather than provide/inject on purpose: the directive that
 * drives this (`v-disabled-reason`) runs on plain DOM elements in games'
 * own components, where there is no guarantee of an injection context.
 * A GameShell renders `DisabledReasonTooltip` once and it reads from here.
 */

import { ref, readonly } from 'vue';

/** The DOM id of the singleton tooltip, for `aria-describedby`. */
export const DISABLED_TOOLTIP_ID = 'bs-disabled-reason-tip';

/** Max width of the tooltip box, in px. Shared with the placement maths. */
export const DISABLED_TOOLTIP_MAX_WIDTH = 260;

const text = ref<string | null>(null);
const anchor = ref<HTMLElement | null>(null);
/** Bumped on every show, so the overlay re-measures and re-places itself. */
const showCount = ref(0);

/**
 * The document the dismiss listener is currently attached to, or null.
 *
 * Tracked (rather than assumed to be `document`) because a GameShell runs
 * inside an iframe in platform and dev-host mode, so the relevant document is
 * the anchor's own.
 */
let dismissDoc: Document | null = null;

/**
 * Touch has no "moved away" — there is no mouseleave to close on. Without this,
 * a tapped tooltip would stay up until something else happened to open one.
 * Capture phase, so it settles before the newly-tapped control's own handler
 * opens its tooltip: the sequence is hide-old then show-new, never the reverse.
 */
function onDocumentPointerDown(event: Event): void {
  const target = event.target as Node | null;
  const el = anchor.value;
  if (el && target && el.contains(target)) return;
  hideDisabledReason();
}

function attachDismiss(doc: Document): void {
  if (dismissDoc === doc) return;
  detachDismiss();
  doc.addEventListener('pointerdown', onDocumentPointerDown, true);
  dismissDoc = doc;
}

function detachDismiss(): void {
  dismissDoc?.removeEventListener('pointerdown', onDocumentPointerDown, true);
  dismissDoc = null;
}

/**
 * Show the tooltip for `element`, describing it with `reason`.
 *
 * Calling this for a different element while one is open simply moves the
 * tooltip — there is no close-then-open flicker between neighbouring controls.
 */
export function showDisabledReason(element: HTMLElement, reason: string): void {
  text.value = reason;
  anchor.value = element;
  showCount.value++;
  attachDismiss(element.ownerDocument);
}

/**
 * Hide the tooltip, but only if `element` is the one currently described.
 *
 * The guard matters when the pointer moves straight from one disabled control
 * to the next: the new element's `show` lands before the old element's `hide`,
 * and an unguarded hide would immediately blank the tooltip that just opened.
 */
export function hideDisabledReason(element?: HTMLElement): void {
  if (element && anchor.value !== element) return;
  text.value = null;
  anchor.value = null;
  detachDismiss();
}

/** Reactive tooltip state, for the overlay component. */
export function useDisabledReasonTooltip() {
  return {
    text: readonly(text),
    anchor: readonly(anchor),
    showCount: readonly(showCount),
  };
}
