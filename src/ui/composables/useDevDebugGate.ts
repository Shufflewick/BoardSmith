/**
 * Whether the Debug panel may show inside a dev host's game page (#481).
 *
 * The dev host decides: debugging is on only while one person holds every
 * human seat, or when `boardsmith dev --debug` forces it. The host page
 * (`DevHost.vue`) tells the game with `dev-debug-available` messages, and this
 * gate follows them. It starts off, so a page that has not heard yet shows no
 * panel, and turning it off closes a panel that is open. The host refuses the
 * debug ops themselves either way; this only keeps the page from offering them.
 */
import { ref, type Ref } from 'vue';

export interface DevDebugGate {
  /** True while the host has debugging on. */
  available: Ref<boolean>;
  /**
   * Handle a message from the host page. Returns true when it was a debug
   * gate message (`dev-debug-available` or `dev-debug-toggle`), so the caller
   * stops looking at it.
   */
  handleMessage(data: { type?: unknown; available?: unknown }): boolean;
}

/** @param expanded - the Debug panel's open state, closed when debugging turns off. */
export function useDevDebugGate(expanded: Ref<boolean>): DevDebugGate {
  const available = ref(false);
  return {
    available,
    handleMessage(data) {
      if (data.type === 'dev-debug-available') {
        available.value = data.available === true;
        if (!available.value) expanded.value = false;
        return true;
      }
      if (data.type === 'dev-debug-toggle') {
        if (available.value) expanded.value = !expanded.value;
        return true;
      }
      return false;
    },
  };
}
