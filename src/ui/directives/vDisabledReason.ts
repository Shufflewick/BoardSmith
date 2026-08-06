/**
 * `v-disabled-reason` — the one way to disable a control in BoardSmith.
 *
 * Bind a reason string to dim a control, or `false`/`undefined` to leave it
 * alone. The reason is not optional and there is no boolean form: a greyed-out
 * button that will not explain itself reads to a player as a broken game, and
 * this directive makes that state unrepresentable.
 *
 * ```vue
 * <script setup lang="ts">
 * import { vDisabledReason } from 'boardsmith/ui';
 * </script>
 *
 * <template>
 *   <button v-disabled-reason="choice.disabled" @click="pick(choice)">
 *     {{ choice.display }}
 *   </button>
 * </template>
 * ```
 *
 * A disabled control gets, from this one binding:
 *
 *  - `aria-disabled="true"` — NOT the native `disabled` attribute, which drops
 *    the control out of the tab order, so a keyboard or screen-reader user
 *    could never reach the reason at all.
 *  - the shared tooltip on hover, on focus, and on tap. Tap matters: the native
 *    `title` this replaces does nothing whatsoever on touch, so on a phone the
 *    reason simply did not exist.
 *  - an inert activation. The click and the Enter/Space keydown are swallowed in
 *    the CAPTURE phase, which at the event target runs ahead of the handlers
 *    Vue attached — so the control's own `@click` never fires and callers do not
 *    have to remember a guard.
 *
 * `data-bs-disabled-reason` carries the reason as data for tests and tooling.
 */

import type { Directive, DirectiveBinding } from 'vue';
import {
  showDisabledReason,
  hideDisabledReason,
  DISABLED_TOOLTIP_ID,
} from '../composables/useDisabledReasonTooltip.js';

/** Why a control is disabled, or `false`/`null`/`undefined` when it is not. */
export type DisabledReason = string | false | null | undefined;

/**
 * True when the reason marks the control disabled.
 *
 * An EMPTY string is not a reason and does not disable — that stops a
 * `disabled: ''` slipping through as a dead button with a blank tooltip, which
 * is the exact failure this directive exists to prevent.
 */
export function isDisabled(reason: DisabledReason): reason is string {
  return typeof reason === 'string' && reason.length > 0;
}

/** Per-element listener bundle, so `unmounted` can detach exactly what it attached. */
interface Attached {
  reason: string;
  show: () => void;
  hide: () => void;
  blockPointer: (e: Event) => void;
  revealOnPointer: () => void;
  blockKey: (e: KeyboardEvent) => void;
}

const attached = new WeakMap<HTMLElement, Attached>();

function detach(el: HTMLElement): void {
  const a = attached.get(el);
  if (!a) return;
  el.removeEventListener('mouseenter', a.show);
  el.removeEventListener('focus', a.show);
  el.removeEventListener('mouseleave', a.hide);
  el.removeEventListener('blur', a.hide);
  el.removeEventListener('pointerdown', a.revealOnPointer);
  el.removeEventListener('click', a.blockPointer, true);
  el.removeEventListener('keydown', a.blockKey, true);
  attached.delete(el);
  hideDisabledReason(el);
  el.removeAttribute('aria-disabled');
  el.removeAttribute('aria-describedby');
  el.removeAttribute('data-bs-disabled-reason');
}

function attach(el: HTMLElement, reason: string): void {
  const existing = attached.get(el);
  if (existing) {
    // Same element, new wording (a reason can be recomputed every render):
    // update in place rather than churning listeners.
    if (existing.reason === reason) return;
    existing.reason = reason;
    el.setAttribute('data-bs-disabled-reason', reason);
    return;
  }

  const bundle: Attached = {
    reason,
    show: () => showDisabledReason(el, attached.get(el)?.reason ?? reason),
    hide: () => hideDisabledReason(el),
    // Touch fires no mouseenter, and Playwright/real browsers differ on whether
    // a tap synthesizes a click at all — pointerdown is the one signal every
    // input type sends, so the reveal hangs off it rather than off the tap's
    // downstream click.
    revealOnPointer: () => showDisabledReason(el, attached.get(el)?.reason ?? reason),
    blockPointer: (e: Event) => {
      // Capture phase: at the target this runs BEFORE the listeners Vue
      // registered on the element, so stopImmediatePropagation genuinely
      // prevents the control's own @click.
      e.preventDefault();
      e.stopImmediatePropagation();
      // The blocked tap IS the reveal — the player learns why instead of
      // feeling ignored. (pointerdown above usually got there first; this
      // covers a click with no preceding pointer event, e.g. `el.click()`.)
      showDisabledReason(el, attached.get(el)?.reason ?? reason);
    },
    blockKey: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showDisabledReason(el, attached.get(el)?.reason ?? reason);
    },
  };

  el.addEventListener('mouseenter', bundle.show);
  el.addEventListener('focus', bundle.show);
  el.addEventListener('mouseleave', bundle.hide);
  el.addEventListener('blur', bundle.hide);
  el.addEventListener('pointerdown', bundle.revealOnPointer);
  el.addEventListener('click', bundle.blockPointer, true);
  el.addEventListener('keydown', bundle.blockKey, true);
  attached.set(el, bundle);

  el.setAttribute('aria-disabled', 'true');
  el.setAttribute('aria-describedby', DISABLED_TOOLTIP_ID);
  el.setAttribute('data-bs-disabled-reason', reason);
}

function apply(el: HTMLElement, binding: DirectiveBinding<DisabledReason>): void {
  const reason = binding.value;
  if (isDisabled(reason)) {
    attach(el, reason);
    return;
  }
  detach(el);
}

/**
 * The directive. In `<script setup>`, importing it as `vDisabledReason` is
 * enough to use `v-disabled-reason` in the template; elsewhere register it with
 * `app.directive('disabled-reason', vDisabledReason)`.
 */
export const vDisabledReason: Directive<HTMLElement, DisabledReason> = {
  mounted: apply,
  updated: apply,
  unmounted: detach,
};
