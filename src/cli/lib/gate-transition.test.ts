import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGateTransition, renderGateTransition, type GateTransition } from './gate-transition.js';
import { GATE_TRANSITION_MD, designPath } from './project-paths.js';

describe('the gate transition record', () => {
  it('reads back a code path with a space in it whole (#1116)', async () => {
    const project = await fs.mkdtemp(join(tmpdir(), 'gate-transition-'));
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
    await fs.rm(project, { recursive: true });
  });
});
