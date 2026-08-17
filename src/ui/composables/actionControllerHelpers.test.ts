/**
 * `actionNeedsWizardMode` is the "which method should I call" helper a custom
 * UI uses to choose between `execute()` (all args known) and `start()` (the
 * player must pick something). Getting it wrong means either a dead-end wizard
 * or an execute() that can never be satisfied.
 */
import { describe, it, expect } from 'vitest';
import { actionNeedsWizardMode } from './actionControllerHelpers.js';
import type { ActionMetadata, PickMetadata } from './useActionControllerTypes.js';

const selection = (overrides: Partial<PickMetadata>): PickMetadata => ({
  name: 'pick',
  type: 'choice',
  ...overrides,
} as PickMetadata);

const meta = (...selections: PickMetadata[]): ActionMetadata =>
  ({ name: 'act', selections } as ActionMetadata);

describe('actionNeedsWizardMode', () => {
  it('says no for an action with no selections', () => {
    expect(actionNeedsWizardMode(meta(), {})).toEqual({ needed: false });
  });

  it('says no when there is no metadata to analyse', () => {
    expect(actionNeedsWizardMode(undefined, {})).toEqual({ needed: false });
  });

  it('says no for a plain choice with static choices', () => {
    expect(actionNeedsWizardMode(meta(selection({ name: 'value', choices: [1, 2] })), {}))
      .toEqual({ needed: false });
  });

  it('says yes for an element selection, naming the selection and why', () => {
    const check = actionNeedsWizardMode(meta(selection({ name: 'target', type: 'element' })), {});
    expect(check.needed).toBe(true);
    expect(check.selectionName).toBe('target');
    expect(check.reason).toContain('target');
    expect(check.reason).toContain('game board');
  });

  it('says yes for a multi-element selection', () => {
    expect(actionNeedsWizardMode(meta(selection({ name: 'targets', type: 'elements' })), {}).needed)
      .toBe(true);
  });

  it('says no once the element value is already provided', () => {
    expect(actionNeedsWizardMode(
      meta(selection({ name: 'target', type: 'element' })),
      { target: 42 },
    )).toEqual({ needed: false });
  });

  it('treats an explicitly provided falsy value as provided', () => {
    expect(actionNeedsWizardMode(
      meta(selection({ name: 'target', type: 'element' })),
      { target: 0 },
    ).needed).toBe(false);
  });

  it('ignores an optional selection — the player can skip it', () => {
    expect(actionNeedsWizardMode(
      meta(selection({ name: 'target', type: 'element', optional: true })),
      {},
    )).toEqual({ needed: false });
  });

  it('says yes for a selection whose dependency has not been chosen', () => {
    const check = actionNeedsWizardMode(
      meta(selection({ name: 'unit', choices: [1] }), selection({ name: 'move', dependsOn: 'unit' })),
      {},
    );
    expect(check.needed).toBe(true);
    expect(check.selectionName).toBe('move');
    expect(check.reason).toContain('depends on "unit"');
  });

  it('says no once the dependency is supplied', () => {
    expect(actionNeedsWizardMode(
      meta(selection({ name: 'move', dependsOn: 'unit', choices: [1] })),
      { unit: 3 },
    )).toEqual({ needed: false });
  });

  it('says yes for choices that only exist per dependent value', () => {
    const check = actionNeedsWizardMode(
      meta(selection({ name: 'move', choicesByDependentValue: { '1': [1, 2] } })),
      {},
    );
    expect(check.needed).toBe(true);
    expect(check.reason).toContain('dynamic choices');
  });

  it('says yes for elements that only exist per dependent value', () => {
    expect(actionNeedsWizardMode(
      meta(selection({ name: 'move', elementsByDependentValue: { '1': [1] } })),
      {},
    ).needed).toBe(true);
  });

  it('says no when static choices are present alongside the dependent map', () => {
    expect(actionNeedsWizardMode(
      meta(selection({ name: 'move', choices: [1, 2], choicesByDependentValue: { '1': [1] } })),
      {},
    )).toEqual({ needed: false });
  });

  it('reports the first selection that forces wizard mode', () => {
    const check = actionNeedsWizardMode(
      meta(
        selection({ name: 'first', type: 'element' }),
        selection({ name: 'second', type: 'element' }),
      ),
      {},
    );
    expect(check.selectionName).toBe('first');
  });

  it('says no once every blocking selection is provided', () => {
    expect(actionNeedsWizardMode(
      meta(
        selection({ name: 'first', type: 'element' }),
        selection({ name: 'second', type: 'element' }),
      ),
      { first: 1, second: 2 },
    )).toEqual({ needed: false });
  });

  it('says no for text and number selections, which execute() can supply', () => {
    expect(actionNeedsWizardMode(
      meta(selection({ name: 'label', type: 'text' }), selection({ name: 'amount', type: 'number' })),
      {},
    )).toEqual({ needed: false });
  });

  it('carries no reason or selection name when wizard mode is not needed', () => {
    const check = actionNeedsWizardMode(meta(selection({ name: 'value', choices: [1] })), {});
    expect(check.reason).toBeUndefined();
    expect(check.selectionName).toBeUndefined();
  });

  it('does not mutate the metadata or the provided args', () => {
    const metadata = meta(selection({ name: 'target', type: 'element' }));
    const args = { other: 1 };
    actionNeedsWizardMode(metadata, args);
    expect(metadata.selections).toHaveLength(1);
    expect(args).toEqual({ other: 1 });
  });
});
