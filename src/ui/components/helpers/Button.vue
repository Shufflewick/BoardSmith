<script setup lang="ts">
/**
 * Button - Consolidated button component for BoardSmith UIs
 *
 * Provides consistent button styling across the application with
 * multiple variants and sizes.
 *
 * @example
 * <Button variant="primary" @click="handleAction">Execute</Button>
 * <Button variant="secondary" size="small" @click="handleChoice">Pick</Button>
 * <Button variant="danger" :disabled="!canUndo" @click="undo">Undo</Button>
 */

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
    /** Whether the button is disabled */
    disabled?: boolean;
    /** HTML button type */
    type?: 'button' | 'submit' | 'reset';
  }>(),
  {
    variant: 'primary',
    size: 'default',
    disabled: false,
    type: 'button',
  }
);

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

function handleClick(event: MouseEvent) {
  if (!props.disabled) {
    emit('click', event);
  }
}
</script>

<template>
  <button
    :class="['btn', `btn--${variant}`, `btn--${size}`]"
    :disabled="disabled"
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

.btn:disabled {
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

.btn--primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--bsg-shadow-sm);
}

/* Secondary variant - subtle outline */
.btn--secondary {
  background: var(--bsg-field);
  border: 1px solid var(--bsg-line-2);
  color: var(--bsg-ink);
}

.btn--secondary:hover:not(:disabled) {
  border-color: var(--bsg-accent);
  background: var(--bsg-selectable);
}

/* Danger variant - destructive actions */
.btn--danger {
  background: var(--bsg-danger);
  border: 1px solid color-mix(in srgb, var(--bsg-danger) 60%, black);
  color: var(--bsg-bg);
}

.btn--danger:hover:not(:disabled) {
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

.btn--ghost:hover:not(:disabled) {
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

.btn--icon:hover:not(:disabled) {
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
