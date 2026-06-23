<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { toasts, remove } = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <!-- role=alert for errors (assertive); role=status for all other types (polite).
             Body-click dismissal is intentionally removed — only the dismiss button
             should dismiss, giving keyboard and AT users a predictable interaction. -->
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="toast.type"
          :role="toast.type === 'error' ? 'alert' : 'status'"
        >
          {{ toast.message }}
          <button
            class="toast-dismiss"
            aria-label="Dismiss"
            @click.stop="remove(toast.id)"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.9rem;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}

.toast-dismiss {
  /* Keyboard-accessible dismiss target — minimum 44px touch/click surface */
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.8;
  margin-left: auto;
  border-radius: 4px;
  padding: 0;
  font-size: 1rem;
  line-height: 1;
}

.toast-dismiss:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
}

.toast.success {
  background: rgba(46, 204, 113, 0.95);
  color: #fff;
}

.toast.error {
  background: rgba(231, 76, 60, 0.95);
  color: #fff;
}

.toast.info {
  background: rgba(0, 217, 255, 0.95);
  color: #1a1a2e;
}

.toast.warning {
  background: rgba(243, 156, 18, 0.95);
  color: #1a1a2e;
}

/* Transition animations */
.toast-enter-active {
  transition: all 0.3s ease-out;
}

.toast-leave-active {
  transition: all 0.2s ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.toast-move {
  transition: transform 0.3s ease;
}
</style>
