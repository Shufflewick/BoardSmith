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

/* Primary variant - cyan/green gradient */
.btn--primary {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
}

.btn--primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4);
}

/* Secondary variant - subtle outline */
.btn--secondary {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
}

.btn--secondary:hover:not(:disabled) {
  border-color: #00d9ff;
  background: rgba(0, 217, 255, 0.2);
}

/* Danger variant - amber/orange for destructive actions */
.btn--danger {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  border: 1px solid #b45309;
  color: #1a1a2e;
}

.btn--danger:hover:not(:disabled) {
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
}

/* Ghost variant - transparent with hover */
.btn--ghost {
  background: transparent;
  border: none;
  color: #888;
  padding: 4px 8px;
}

.btn--ghost:hover:not(:disabled) {
  color: #fff;
}

/* Icon variant - compact icon buttons */
.btn--icon {
  width: 32px;
  height: 32px;
  padding: 0;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #888;
}

.btn--icon:hover:not(:disabled) {
  background: rgba(0, 217, 255, 0.2);
  border-color: rgba(0, 217, 255, 0.3);
  color: #00d9ff;
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
