<script setup lang="ts">
/**
 * THE DEBUG PANEL'S BUTTON (#157).
 *
 * Thirty call sites used to write `class="debug-btn small danger"` by hand
 * against rules that lived in DebugPanel.vue's 1810-line scoped stylesheet. That
 * is what made splitting the panel into per-tab components a bad trade: every
 * tab that owned a button would have had to carry a copy of those rules, or the
 * panel would have had to drop `scoped` and leak debug styling into every game
 * that mounts it.
 *
 * The rules travel with the button now, so a tab can move house without them.
 *
 * It keeps the `debug-btn` class name on purpose. The panel still carries a
 * handful of genuinely panel-specific rules that target it (`.debug-btn.live-btn`,
 * `.debug-btn.rewind-btn`), scoped CSS reaches a child component's root element,
 * and the panel's tests address buttons by that name.
 */
withDefaults(defineProps<{
  /** `small` is the dense variant used inside tab toolbars. */
  size?: 'default' | 'small';
  /** `primary` affirms, `danger` destroys. Default is neither. */
  tone?: 'default' | 'primary' | 'danger';
  /** Renders the pressed/selected state (an ARIA-independent visual). */
  active?: boolean;
  disabled?: boolean;
}>(), {
  size: 'default',
  tone: 'default',
  active: false,
  disabled: false,
});
</script>

<template>
  <button
    type="button"
    class="debug-btn"
    :class="[
      size === 'small' && 'small',
      tone !== 'default' && tone,
      active && 'active',
    ]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.debug-btn {
  padding: 8px 16px;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: 6px;
  color: var(--bsg-ink);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.debug-btn:hover {
  background: var(--bsg-surface-3);
  border-color: var(--bsg-accent-2);
}

.debug-btn.active {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border-color: var(--bsg-accent-2);
  color: var(--bsg-accent-2);
}

.debug-btn.small {
  padding: 4px 10px;
  font-size: 11px;
}

.debug-btn.danger {
  border-color: var(--bsg-danger);
  color: var(--bsg-danger);
}

.debug-btn.danger:hover {
  background: color-mix(in srgb, var(--bsg-danger) 20%, transparent);
}

.debug-btn.primary {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border-color: color-mix(in srgb, var(--bsg-accent-2) 40%, transparent);
  color: var(--bsg-accent-2);
}

.debug-btn.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
}

.debug-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
