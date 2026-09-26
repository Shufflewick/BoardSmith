/**
 * WHAT THE DEV LOG SAID WHILE SOMETHING RAN.
 *
 * A refusal the player reads in plain words keeps the engine's detail in the
 * dev log instead (#393), so a test that proves which value was refused reads
 * it there. The log is silenced while `run` runs and restored after.
 */
import { vi } from 'vitest';

export function withDevLog<T>(run: () => T): { result: T; log: string } {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = run();
    return { result, log: warn.mock.calls.map((call) => call.join(' ')).join('\n') };
  } finally {
    warn.mockRestore();
  }
}
