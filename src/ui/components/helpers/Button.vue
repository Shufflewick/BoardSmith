<script setup lang="ts">
/**
 * Button - Consolidated button component for BoardSmith UIs
 *
 * Provides consistent button styling across the application with
 * multiple variants and sizes.
 *
 * Disabling requires a reason. There is no boolean `disabled` prop: the reason
 * IS the disabled state, so a player can never meet a dead button with no
 * explanation. The `v-disabled-reason` directive dims the button, shows the
 * reason on hover/focus/tap, and makes activation inert — see
 * `directives/vDisabledReason.ts`.
 *
 * @example
 * <Button variant="primary" @click="handleAction">Execute</Button>
 * <Button variant="secondary" size="small" @click="handleChoice">Pick</Button>
 * <Button
 *   variant="danger"
 *   :disabled-reason="canUndo ? false : 'Nothing to undo yet.'"
 *   @click="undo"
 * >Undo</Button>
 */

import { vDisabledReason, isDisabled, type DisabledReason } from '../../directives/vDisabledReason.js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'ghost'
  | 'icon';

export type ButtonSize = 'small' | 'default' | 'large';

const props = withDefaults(
  defineProps<{
    /** Button style variant */
    variant?: ButtonVariant;
    /** Button size */
    size?: ButtonSize;
    /**
     * Why this button is disabled, or `false` when it is not.
     *
     * The reason is shown on hover/focus and announced by screen readers.
     * Supplying one is the ONLY way to disable the button — there is no
     * boolean form, on purpose.
     */
    disabledReason?: DisabledReason;
    /** HTML button type */
    type?: 'button' | 'submit' | 'reset';
  }>(),
  {
    variant: 'primary',
    size: 'default',
    disabledReason: false,
    type: 'button',
  }
);

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

// The directive already swallows the click on a disabled button; this second
// check costs nothing and keeps the component correct on its own terms.
function handleClick(event: MouseEvent) {
  if (isDisabled(props.disabledReason)) return;
  emit('click', event);
}
</script>

<template>
  <button
    :class="['btn', `btn--${variant}`, `btn--${size}`]"
    v-disabled-reason="disabledReason"
    :type="type"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<style scoped>
/* Base button styles */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}

.btn[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Size variants */
.btn--small {
  padding: 4px 10px;
  font-size: 0.8rem;
  border-radius: 4px;
}

.btn--default {
  padding: 8px 16px;
  font-size: 0.9rem;
}

.btn--large {
  padding: 10px 20px;
  font-size: 0.95rem;
  border-radius: 8px;
}

/* Primary variant - Slate teal */
.btn--primary {
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
}

.btn--primary:hover:not([aria-disabled='true']) {
  transform: translateY(-2px);
  box-shadow: var(--bsg-shadow-sm);
}

/* Secondary variant - subtle outline */
.btn--secondary {
  background: var(--bsg-field);
  border: 1px solid var(--bsg-line-2);
  color: var(--bsg-ink);
}

.btn--secondary:hover:not([aria-disabled='true']) {
  border-color: var(--bsg-accent);
  background: var(--bsg-selectable);
}

/* Danger variant - destructive actions */
.btn--danger {
  background: var(--bsg-danger);
  border: 1px solid color-mix(in srgb, var(--bsg-danger) 60%, black);
  color: var(--bsg-bg);
}

.btn--danger:hover:not([aria-disabled='true']) {
  background: color-mix(in srgb, var(--bsg-danger) 85%, black);
  box-shadow: var(--bsg-shadow-sm);
}

/* Ghost variant - transparent with hover */
.btn--ghost {
  background: transparent;
  border: none;
  color: var(--bsg-ink-3);
  padding: 4px 8px;
}

.btn--ghost:hover:not([aria-disabled='true']) {
  color: var(--bsg-ink);
}

/* Icon variant - compact icon buttons */
.btn--icon {
  width: 32px;
  height: 32px;
  padding: 0;
  background: var(--bsg-field);
  border: 1px solid var(--bsg-line);
  color: var(--bsg-ink-3);
}

.btn--icon:hover:not([aria-disabled='true']) {
  background: var(--bsg-selectable);
  border-color: color-mix(in srgb, var(--bsg-accent) 30%, transparent);
  color: var(--bsg-accent-2);
}

.btn--icon.btn--small {
  width: 24px;
  height: 24px;
}

.btn--icon.btn--large {
  width: 40px;
  height: 40px;
}
</style>
