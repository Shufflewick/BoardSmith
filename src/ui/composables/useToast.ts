import { ref, readonly } from 'vue';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}

// Global toast state
const toasts = ref<Toast[]>([]);
let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function useToast() {
  function show(
    message: string,
    options: { type?: Toast['type']; duration?: number } = {}
  ) {
    const { type = 'info', duration = 2000 } = options;
    // An identical toast already on screen is kept, its timer restarted, so repeats never stack (#1649).
    const shown = toasts.value.find((t) => t.message === message && t.type === type);
    const id = shown?.id ?? nextId++;
    if (shown) {
      clearTimeout(timers.get(id));
      timers.delete(id);
      shown.duration = duration;
    } else {
      toasts.value.push({ id, message, type, duration });
    }

    if (duration > 0) {
      timers.set(id, setTimeout(() => remove(id), duration));
    }

    return id;
  }

  function remove(id: number) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const index = toasts.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      toasts.value.splice(index, 1);
    }
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
    toasts: readonly(toasts),
    show,
    remove,
    success,
    error,
    info,
    warning,
  };
}
