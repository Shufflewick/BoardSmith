import { describe, it, expect } from 'vitest';
import { Action } from './action-builder.js';
import { subjectType } from './subject-type.js';

const THINGS = subjectType<string>({ name: 'Things', onBoard: false, key: (thing) => thing, label: (thing) => thing });

const finishedMessage = (method: string) =>
  method === 'execute'
    ? `The "act" action was already finished with .execute(), and an action has only one .execute(). ` +
      `Remove the second .execute() call.`
    : `The "act" action was already finished with .execute(), so .${method}() cannot add to it. ` +
      `Move the .${method}() call before .execute().`;

const calls: Record<string, (action: Action) => unknown> = {
  followUpArgs: (a) => a.followUpArgs<{ round: number }>(),
  prompt: (a) => a.prompt('Act'),
  help: (a) => a.help('Acts'),
  condition: (a) => a.condition({ ok: () => true }),
  disabled: (a) => a.disabled(() => false),
  validate: (a) => a.validate(() => true),
  notUndoable: (a) => a.notUndoable(),
  seatUndoable: (a) => a.seatUndoable(),
  manual: (a) => a.manual(),
  about: (a) => a.about(THINGS, () => []),
  destructive: (a) => a.destructive(),
  group: (a) => a.group('Menu'),
  order: (a) => a.order(1),
  chooseFrom: (a) => a.chooseFrom('x', { choices: ['a'] }),
  chooseElement: (a) => a.chooseElement('e', { elements: () => [] }),
  chooseElements: (a) => a.chooseElements('es', { elements: () => [] }),
  enterText: (a) => a.enterText('t'),
  enterNumber: (a) => a.enterNumber('n'),
  execute: (a) => a.execute(() => {}),
};

describe('an Action builder after .execute() (#1814)', () => {
  it.each(Object.keys(calls))('refuses .%s() at the call that makes the mistake', (method) => {
    const action = Action.create('act');
    action.execute(() => {});
    expect(() => calls[method]!(action)).toThrow(finishedMessage(method));
  });

  it('leaves the definition .execute() returned as it was when a pick comes late', () => {
    const action = Action.create('act').chooseFrom('x', { choices: ['a'] });
    const definition = action.execute(() => {});
    expect(() => action.chooseFrom('y', { choices: ['b'] })).toThrow(finishedMessage('chooseFrom'));
    expect(definition.selections.map((selection) => selection.name)).toEqual(['x']);
  });
});
