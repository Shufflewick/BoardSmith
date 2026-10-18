import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { GATE_TRANSITION_MD, designPath } from './project-paths.js';
import { readGateTransition } from './gate-transition.js';

describe('readGateTransition', () => {
  it('reads a project that has no record yet as having none', async () => {
    expect(await readGateTransition(tempTree('bs-gate-transition-'))).toBeUndefined();
  });

  it('refuses a record it cannot read rather than reading it as absent', async () => {
    const dir = tempTree('bs-gate-transition-');
    await fs.mkdir(designPath(dir, GATE_TRANSITION_MD), { recursive: true });
    await expect(readGateTransition(dir)).rejects.toThrow(`Could not read ${designPath(dir, GATE_TRANSITION_MD)} (EISDIR)`);
  });
});
