import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useDevDebugGate } from './useDevDebugGate.js';

describe('useDevDebugGate (#481)', () => {
  it('starts unavailable, so no Debug panel shows before the host says debugging is on', () => {
    const gate = useDevDebugGate(ref(false));
    expect(gate.available.value).toBe(false);
  });

  it('follows the host, and closes an open panel when debugging turns off', () => {
    const expanded = ref(false);
    const gate = useDevDebugGate(expanded);

    expect(gate.handleMessage({ type: 'dev-debug-available', available: true })).toBe(true);
    expect(gate.available.value).toBe(true);
    expanded.value = true;

    gate.handleMessage({ type: 'dev-debug-available', available: false });
    expect(gate.available.value).toBe(false);
    expect(expanded.value).toBe(false);
  });

  it('treats anything but available: true as off', () => {
    const gate = useDevDebugGate(ref(false));
    gate.handleMessage({ type: 'dev-debug-available', available: true });
    gate.handleMessage({ type: 'dev-debug-available', available: 'yes' });
    expect(gate.available.value).toBe(false);
  });

  it('ignores the toggle while debugging is off, and toggles while it is on', () => {
    const expanded = ref(false);
    const gate = useDevDebugGate(expanded);
    expect(gate.handleMessage({ type: 'dev-debug-toggle' })).toBe(true);
    expect(expanded.value).toBe(false);

    gate.handleMessage({ type: 'dev-debug-available', available: true });
    gate.handleMessage({ type: 'dev-debug-toggle' });
    expect(expanded.value).toBe(true);
  });

  it('leaves other messages to the caller', () => {
    const gate = useDevDebugGate(ref(false));
    expect(gate.handleMessage({ type: 'game_state' })).toBe(false);
  });
});
