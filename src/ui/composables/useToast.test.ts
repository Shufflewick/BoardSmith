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

  it('replaces the shown toast with a fresh one, so the repeat is announced and its timer starts again', () => {
    vi.useFakeTimers();
    const first = toast.error('Not sent.', 4000);
    vi.advanceTimersByTime(3000);
    const repeat = toast.error('Not sent.', 4000);
    expect(repeat).not.toBe(first);
    expect(toast.toasts.value.map((t) => t.id)).toEqual([repeat]);
    vi.advanceTimersByTime(3000);
    expect(toast.toasts.value.map((t) => t.id)).toEqual([repeat]);
    vi.advanceTimersByTime(1000);
    expect(shown()).toEqual([]);
  });

  it('never collapses a toast that stays until its owner removes it', () => {
    const first = toast.show('Thinking about the best move…', { type: 'info', duration: 0 });
    const second = toast.show('Thinking about the best move…', { type: 'info', duration: 0 });
    toast.info('Thinking about the best move…');
    toast.remove(first);
    expect(toast.toasts.value.map((t) => t.id)).toContain(second);
  });

  it('keeps different messages, and the same words of a different type, apart', () => {
    toast.error('Not sent.');
    toast.error('Undo failed.');
    toast.info('Not sent.');
    expect(shown()).toEqual([['error', 'Not sent.'], ['error', 'Undo failed.'], ['info', 'Not sent.']]);
  });
});
