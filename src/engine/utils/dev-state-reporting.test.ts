/**
 * The reporting half of the dev-state (HMR) surface: `formatValidationErrors`.
 * `dev-state.test.ts` covers capture/restore; this is what a rules reload
 * prints when a snapshot cannot be transferred.
 */
import { describe, it, expect } from 'vitest';
import { formatValidationErrors, type ValidationResult } from './dev-state.js';

const clean: ValidationResult = { valid: true, errors: [], warnings: [] };

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
      warnings: [{ type: 'type-change', message: 'value changed type', path: ['board'] }],
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
      warnings: [{ type: 'type-change', message: 'value changed type', path: [] }],
    });
    expect(output).toContain('ERROR 1');
    expect(output).toContain('Warnings:');
  });
});
