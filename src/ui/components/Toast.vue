<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { toasts, remove } = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="toast.type"
          @click="remove(toast.id)"
        >
          {{ toast.message }}
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
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 0.9rem;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: var(--bsg-shadow-sm);
  white-space: nowrap;
}

.toast.success {
  background: var(--bsg-ok);
  color: var(--bsg-accent-ink);
}

.toast.error {
  background: var(--bsg-danger);
  color: var(--bsg-accent-ink);
}

.toast.info {
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
}

.toast.warning {
  background: var(--bsg-warn);
  color: var(--bsg-accent-ink);
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
