import { describe, it, expect, vi } from 'vitest';
import { isSimFile, isTestFile } from './test-step-check.js';

// Swapped for patterns no real file name matches, so a private copy in test-step-check shows up as a disagreement (#1506).
vi.mock('../../vite-config/test-files.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../vite-config/test-files.js')>()),
  SIM_FILE: /\.sim\.drift$/,
  TEST_FILE: /\.drift$/,
}));

describe('test-step-check sorts test files by the shared rule in src/vite-config/test-files.js', () => {
  it('treats as a sim exactly what SIM_FILE accepts', () => {
    expect(isSimFile('src/a.sim.drift')).toBe(true);
    expect(isSimFile('src/a.sim.test.ts')).toBe(false);
  });

  it('treats as a test exactly what TEST_FILE accepts, less the sims', () => {
    expect(isTestFile('src/a.unit.drift')).toBe(true);
    expect(isTestFile('src/a.test.ts')).toBe(false);
    expect(isTestFile('src/a.sim.drift')).toBe(false);
  });
});
