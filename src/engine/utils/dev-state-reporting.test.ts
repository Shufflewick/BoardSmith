/**
 * The reporting/recovery half of the dev-state (HMR) surface:
 * `formatValidationErrors`, `validateFlowPosition` and `formatFlowRecovery`.
 * `dev-state.test.ts` covers capture/restore; these three are what the dev
 * server actually prints and how it decides where to resume a flow.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  formatValidationErrors,
  validateFlowPosition,
  formatFlowRecovery,
  type ValidationResult,
  type DevSnapshot,
} from './dev-state.js';
import type { FlowPosition } from '../flow/types.js';

const clean: ValidationResult = { valid: true, errors: [], warnings: [] };

const snapshotWith = (flowPosition: FlowPosition | undefined): DevSnapshot =>
  ({ flowPosition }) as DevSnapshot;

const position = (overrides: Partial<FlowPosition> = {}): FlowPosition => ({
  path: [0, 1, 2],
  iterations: {},
  variables: {},
  ...overrides,
});

/** A stand-in flow engine whose tryRestore answer the test controls. */
const engineThatAccepts = () => ({ tryRestore: vi.fn().mockReturnValue({ success: true as const }) });
const engineThatRejects = (validPath: number[], error = 'node 2 no longer exists') => ({
  tryRestore: vi.fn().mockReturnValue({ success: false as const, error, validPath }),
});

describe('formatValidationErrors', () => {
  it('says nothing at all when the result is clean', () => {
    expect(formatValidationErrors(clean)).toBe('');
  });

  it('leads with the blocked-transfer headline when validation failed', () => {
    const output = formatValidationErrors({
      valid: false,
      errors: [{ type: 'missing-class', message: 'Unknown class Card', path: [], suggestion: 'Register Card' }],
      warnings: [],
    });
    expect(output).toContain('[HMR] State transfer blocked');
  });

  it('numbers each error and prints its actionable fix', () => {
    const output = formatValidationErrors({
      valid: false,
      errors: [
        { type: 'missing-class', message: 'Unknown class Card', path: [], suggestion: 'Register Card' },
        { type: 'missing-class', message: 'Unknown class Die', path: [], suggestion: 'Register Die' },
      ],
      warnings: [],
    });
    expect(output).toContain('ERROR 1: Unknown class Card');
    expect(output).toContain('Fix: Register Card');
    expect(output).toContain('ERROR 2: Unknown class Die');
    expect(output).toContain('Fix: Register Die');
  });

  it('prints the element path when the error has one', () => {
    const output = formatValidationErrors({
      valid: false,
      errors: [{ type: 'missing-class', message: 'bad', path: ['game', 'board', 'cell'], suggestion: 'fix it' }],
      warnings: [],
    });
    expect(output).toContain('Path: game > board > cell');
  });

  it('omits the path line for a tree-level error', () => {
    const output = formatValidationErrors({
      valid: false,
      errors: [{ type: 'missing-class', message: 'bad', path: [], suggestion: 'fix it' }],
      warnings: [],
    });
    expect(output).not.toContain('Path:');
  });

  it('reports warnings on their own even when validation passed', () => {
    const output = formatValidationErrors({
      valid: true,
      errors: [],
      warnings: [{ type: 'property-mismatch', message: 'value changed type', path: ['board'] }],
    });
    expect(output).toContain('Warnings:');
    expect(output).toContain('value changed type');
    expect(output).toContain('Path: board');
    expect(output).not.toContain('blocked');
  });

  it('reports errors and warnings together', () => {
    const output = formatValidationErrors({
      valid: false,
      errors: [{ type: 'missing-class', message: 'Unknown class Card', path: [], suggestion: 'Register Card' }],
      warnings: [{ type: 'property-mismatch', message: 'value changed type', path: [] }],
    });
    expect(output).toContain('ERROR 1');
    expect(output).toContain('Warnings:');
  });
});

describe('validateFlowPosition', () => {
  it('passes a snapshot that carries no flow position', () => {
    const engine = engineThatAccepts();
    expect(validateFlowPosition(snapshotWith(undefined), engine)).toEqual({ valid: true });
    expect(engine.tryRestore).not.toHaveBeenCalled();
  });

  it('passes an empty path without consulting the flow engine', () => {
    const engine = engineThatAccepts();
    expect(validateFlowPosition(snapshotWith(position({ path: [] })), engine)).toEqual({ valid: true });
    expect(engine.tryRestore).not.toHaveBeenCalled();
  });

  it('passes when the engine can restore the position', () => {
    const engine = engineThatAccepts();
    const pos = position();
    expect(validateFlowPosition(snapshotWith(pos), engine)).toEqual({ valid: true });
    expect(engine.tryRestore).toHaveBeenCalledWith(pos);
  });

  it('reports the engine reason when the position is stale', () => {
    const result = validateFlowPosition(snapshotWith(position()), engineThatRejects([0]));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('node 2 no longer exists');
  });

  it('recovers to the deepest still-valid prefix', () => {
    const result = validateFlowPosition(snapshotWith(position()), engineThatRejects([0, 1]));
    expect(result.recoveryPosition?.path).toEqual([0, 1]);
  });

  it('offers no recovery when nothing of the path survives', () => {
    const result = validateFlowPosition(snapshotWith(position()), engineThatRejects([]));
    expect(result.valid).toBe(false);
    expect(result.recoveryPosition).toBeUndefined();
  });

  it('carries the flow variables into the recovery position', () => {
    const pos = position({ variables: { round: 3, dealer: 1 } });
    const result = validateFlowPosition(snapshotWith(pos), engineThatRejects([0]));
    expect(result.recoveryPosition?.variables).toEqual({ round: 3, dealer: 1 });
  });

  it('copies the variables rather than aliasing the stale position', () => {
    const pos = position({ variables: { round: 3 } });
    const result = validateFlowPosition(snapshotWith(pos), engineThatRejects([0]));
    (result.recoveryPosition!.variables as Record<string, unknown>).round = 99;
    expect(pos.variables.round).toBe(3);
  });

  it('keeps only the loop iteration counts that lie inside the surviving prefix', () => {
    const pos = position({ iterations: { __iter_0: 4, __iter_1: 2, __iter_2: 7 } });
    const result = validateFlowPosition(snapshotWith(pos), engineThatRejects([0, 1]));
    expect(result.recoveryPosition?.iterations).toEqual({ __iter_0: 4, __iter_1: 2 });
  });

  it('drops the player index, which may name a seat the truncated flow never reaches', () => {
    const pos = position({ playerIndex: 2 });
    const result = validateFlowPosition(snapshotWith(pos), engineThatRejects([0]));
    expect(result.recoveryPosition?.playerIndex).toBeUndefined();
  });
});

describe('formatFlowRecovery', () => {
  const original = position({ path: [0, 1, 2] });
  const recovery = position({ path: [0] });
  const output = formatFlowRecovery(original, recovery, 'node 2 no longer exists');

  it('labels itself as an HMR flow recovery', () => {
    expect(output).toContain('[HMR] Flow position recovery:');
  });

  it('shows where the flow was and where it is resuming', () => {
    expect(output).toContain('Original position: [0, 1, 2]');
    expect(output).toContain('Recovering to: [0]');
  });

  it('includes the reason the original position was rejected', () => {
    expect(output).toContain('node 2 no longer exists');
  });

  it('warns that the game may need a manual nudge', () => {
    expect(output).toContain('manual action to resume');
  });

  it('renders an empty recovery path without collapsing the line', () => {
    expect(formatFlowRecovery(original, position({ path: [] }), 'gone'))
      .toContain('Recovering to: []');
  });
});
