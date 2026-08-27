<script setup lang="ts">
/**
 * THE DEBUG PANEL'S MODAL (#157).
 *
 * Two dialogs -- rewind confirmation and card transfer -- each hand-built the
 * same overlay, header, close button, body and footer against rules in the
 * panel's shared stylesheet. They live in different tabs, so the split would
 * have had to copy ~110 lines of CSS into both.
 *
 * The dialogs are in-panel rather than native browser ones on purpose: a native
 * confirmation inside an iframe is refused or suppressed by the host (sandboxed
 * iframes, Chrome's suppress-dialogs box), which turns a guarded destructive
 * action into a silent no-op.
 *
 * Class names are preserved: the panel's own tests address `.debug-dialog` and
 * its parts.
 */
defineProps<{
  /** Accessible title, rendered in the header. */
  title: string;
  /** Set when the dialog is a confirmation, so AT announces it as modal. */
  modal?: boolean;
  /** What the close button and the backdrop mean. */
  closeLabel?: string;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="debug-dialog-overlay" @click.self="emit('close')">
    <div
      class="debug-dialog"
      :role="modal ? 'dialog' : undefined"
      :aria-modal="modal ? 'true' : undefined"
      :aria-label="modal ? title : undefined"
    >
      <div class="debug-dialog-header">
        <span>{{ title }}</span>
        <button class="close-btn" :aria-label="closeLabel ?? 'Close dialog'" @click="emit('close')">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div class="debug-dialog-body">
        <slot />
      </div>
      <div class="debug-dialog-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: color-mix(in srgb, black 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.debug-dialog {
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: 8px;
  width: 300px;
  max-width: 90vw;
  box-shadow: var(--bsg-shadow);
}

.debug-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bsg-line);
  font-weight: 600;
  color: var(--bsg-ink);
}

.debug-dialog-header .close-btn {
  background: none;
  border: none;
  color: var(--bsg-ink-2);
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.debug-dialog-header .close-btn:hover {
  color: var(--bsg-ink);
}

.debug-dialog-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Confirmation copy (the rewind dialog): the body's own gap does the spacing. */
.debug-dialog-body :deep(p) {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--bsg-ink);
}

.debug-dialog-body :deep(.form-group) {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.debug-dialog-body :deep(label) {
  color: var(--bsg-ink-2);
  font-size: 12px;
}

.debug-dialog-body :deep(select) {
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line);
  border-radius: 4px;
  padding: 8px 12px;
  color: var(--bsg-ink);
  font-size: 13px;
}

.debug-dialog-body :deep(select:focus) {
  outline: none;
  border-color: var(--bsg-accent-2);
}

.debug-dialog-body :deep(.radio-group) {
  display: flex;
  gap: 16px;
}

.debug-dialog-body :deep(.radio-group label) {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--bsg-ink-2);
}

.debug-dialog-body :deep(.radio-group input[type="radio"]) {
  accent-color: var(--bsg-accent-2);
}

.debug-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--bsg-line);
}
</style>
