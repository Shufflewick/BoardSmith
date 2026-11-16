import { computed, ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}

// Global toast state: every call, each with its own id and timer, so each caller's remove reaches its own.
const calls = ref<Toast[]>([]);
let nextId = 0;

const twins = (a: Toast, b: Toast) => a.duration > 0 && b.duration > 0 && a.message === b.message && a.type === b.type;

// A timed repeat shows in place of its twin, so repeats never stack and the fresh node is announced again (#1649).
const toasts = computed(() => calls.value.filter((t, at) => !calls.value.slice(at + 1).some((later) => twins(t, later))));

export function useToast() {
  function show(
    message: string,
    options: { type?: Toast['type']; duration?: number } = {}
  ) {
    const { type = 'info', duration = 2000 } = options;
    const id = nextId++;

    const toast: Toast = { id, message, type, duration };
    calls.value.push(toast);

    if (duration > 0) {
      setTimeout(() => {
        remove(id);
      }, duration);
    }

    return id;
  }

  function remove(id: number) {
    const index = calls.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      calls.value.splice(index, 1);
    }
  }

  /** The player closed toast `id`: take its words down for every call showing them. */
  function dismiss(id: number) {
    const shown = calls.value.find((t) => t.id === id);
    if (shown) calls.value = calls.value.filter((t) => t !== shown && !twins(t, shown));
  }

  function success(message: string, duration = 2000) {
    return show(message, { type: 'success', duration });
  }

  function error(message: string, duration = 4000) {
    return show(message, { type: 'error', duration });
  }

  function info(message: string, duration = 2000) {
    return show(message, { type: 'info', duration });
  }

  function warning(message: string, duration = 3000) {
    return show(message, { type: 'warning', duration });
  }

  return {
    toasts,
    show,
    remove,
    dismiss,
    success,
    error,
    info,
    warning,
  };
}
