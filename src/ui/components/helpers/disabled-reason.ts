/**
 * The one way a BoardSmith button is disabled: by saying why.
 *
 * A `DisabledReason` is a player-facing sentence or `false`. There is no
 * boolean "just disable it" — a greyed-out button with no explanation is the
 * confusing state this module exists to make unrepresentable. The same
 * `string | false` contract already governs selection-level disabling
 * (`chooseFrom({ disabled })`) and action-level disabling (`.disabled()`), so
 * a reason flows from the engine to the DOM without ever being reduced to a
 * boolean on the way.
 *
 * ## Why `aria-disabled`, not the `disabled` attribute
 *
 * A natively-`disabled` button is removed from the tab order and, in several
 * engines, stops hit-testing entirely — so the reason can be reached by
 * neither keyboard nor hover. That defeats the entire point. These helpers
 * mark the control `aria-disabled="true"` instead: it stays focusable and
 * hoverable (so the reason is readable), screen readers still announce it as
 * dimmed, and activation is blocked in JS via {@link runIfEnabled}.
 *
 * Components rendering these attributes must style the dimmed state on
 * `[aria-disabled='true']`, not only `:disabled`.
 */

/**
 * Why a control is disabled, or `false`/`undefined` when it is not.
 *
 * `null` is accepted because engine-side reason lookups routinely produce it;
 * it means the same thing as `false`.
 */
export type DisabledReason = string | false | null | undefined;

/**
 * Attributes that mark a control disabled-with-a-reason, spread onto the
 * element with `v-bind`.
 *
 * `title` gives the pointer tooltip; `aria-describedby` is deliberately NOT
 * used here because the reason has no other DOM node to point at — `title` is
 * what both the tooltip and the accessible description come from.
 */
export interface DisabledAttrs {
  'aria-disabled'?: 'true';
  title?: string;
  /** Test/automation hook: the reason as data, not as a rendered tooltip. */
  'data-bs-disabled-reason'?: string;
}

/**
 * True when the reason marks the control disabled.
 *
 * Note that an EMPTY string is not a reason and therefore does not disable —
 * that keeps `disabled: ''` from silently producing a dead button with a blank
 * tooltip, the exact failure this module prevents.
 */
export function isDisabled(reason: DisabledReason): reason is string {
  return typeof reason === 'string' && reason.length > 0;
}

/**
 * Build the DOM attributes for a control that may be disabled.
 *
 * Returns an empty object when the control is enabled, so
 * `v-bind="disabledAttrs(reason)"` adds nothing in the common case.
 *
 * @example
 * ```vue
 * <button v-bind="disabledAttrs(reason)" @click="runIfEnabled(reason, submit)">
 * ```
 */
export function disabledAttrs(reason: DisabledReason): DisabledAttrs {
  if (!isDisabled(reason)) return {};
  return {
    'aria-disabled': 'true',
    title: reason,
    'data-bs-disabled-reason': reason,
  };
}

/**
 * Run `fn` only when the control is enabled.
 *
 * `aria-disabled` is advisory to the browser — the click still arrives — so
 * every handler on a reason-disabled control must pass through here. Pairing
 * it with {@link disabledAttrs} on the same reason keeps the visual state and
 * the behavior derived from ONE value that cannot drift apart.
 */
export function runIfEnabled<T>(reason: DisabledReason, fn: () => T): T | undefined {
  if (isDisabled(reason)) return undefined;
  return fn();
}
