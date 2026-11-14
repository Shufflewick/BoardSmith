import { describe, it, expect, afterEach, vi } from 'vitest';
import { useToast } from './useToast.js';

const toast = useToast();
const shown = () => toast.toasts.value.map((t) => [t.type, t.message]);

afterEach(() => {
  for (const t of [...toast.toasts.value]) toast.remove(t.id);
  vi.useRealTimers();
});

describe('useToast collapses a toast already on screen (#1649)', () => {
  it('leaves one toast for two identical errors', () => {
    toast.error('The table did not answer in time. Try again.');
    toast.error('The table did not answer in time. Try again.');
    expect(shown()).toEqual([['error', 'The table did not answer in time. Try again.']]);
  });

  it('restarts the shown toast\'s timer instead of adding another', () => {
    vi.useFakeTimers();
    const first = toast.error('Not sent.', 4000);
    vi.advanceTimersByTime(3000);
    expect(toast.error('Not sent.', 4000)).toBe(first);
    vi.advanceTimersByTime(3000);
    expect(toast.toasts.value.map((t) => t.id)).toEqual([first]);
    vi.advanceTimersByTime(1000);
    expect(shown()).toEqual([]);
  });

  it('keeps different messages, and the same words of a different type, apart', () => {
    toast.error('Not sent.');
    toast.error('Undo failed.');
    toast.info('Not sent.');
    expect(shown()).toEqual([['error', 'Not sent.'], ['error', 'Undo failed.'], ['info', 'Not sent.']]);
  });
});
