import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { GATE_TRANSITION_MD, designPath } from './project-paths.js';
import { readGateTransition, renderGateTransition, type GateTransition } from './gate-transition.js';

describe('readGateTransition', () => {
  it('reads a project that has no record yet as having none', async () => {
    expect(await readGateTransition(tempTree('bs-gate-transition-'))).toBeUndefined();
  });

  it('refuses a record it cannot read rather than reading it as absent', async () => {
    const dir = tempTree('bs-gate-transition-');
    await fs.mkdir(designPath(dir, GATE_TRANSITION_MD), { recursive: true });
    await expect(readGateTransition(dir)).rejects.toThrow(`Could not read ${designPath(dir, GATE_TRANSITION_MD)} (EISDIR)`);
  });

  it('reads back a code path with a space in it whole (#1116)', async () => {
    const project = tempTree('bs-gate-transition-');
    const transition: GateTransition = {
      recorded: '2026-09-23T12:00:00.000Z',
      by: 'Jane Designer',
      signoffs: [{ slug: 'deal', status: 'verified', reason: 'played', code: { 'my file.ts': 'a'.repeat(64) } }],
      kept: [],
      claims: {},
    };
    await fs.mkdir(designPath(project), { recursive: true });
    await fs.writeFile(designPath(project, GATE_TRANSITION_MD), renderGateTransition(transition));
    expect((await readGateTransition(project))?.signoffs[0]?.code).toEqual({ 'my file.ts': 'a'.repeat(64) });
  });
});
