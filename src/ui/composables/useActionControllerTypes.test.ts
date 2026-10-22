/**
 * Pins the public member list of the action controller (#514), and keeps the
 * Controller Methods and Controller State tables of docs/ui-components.md in
 * step with it (#1408).
 *
 * Adding or removing a member of `UseActionControllerReturn` fails this file's
 * type check, so a change to what a game author sees is a deliberate, reviewed
 * change to the list below. The check is enforced by `boardsmith typecheck`.
 */
import { describe, it, expect } from 'vitest';
import type { UseActionControllerReturn } from './useActionControllerTypes.js';
import docs from '../../../docs/ui-components.md';

type Table = 'Controller Methods' | 'Controller State';

// The type checker requires every member, refuses any other name, and checks each member's table.
const MEMBERS: {
  [K in keyof UseActionControllerReturn]-?: UseActionControllerReturn[K] extends (...args: never[]) => unknown
    ? 'Controller Methods'
    : 'Controller State';
} = {
  currentAction: 'Controller State',
  currentArgs: 'Controller State',
  currentPick: 'Controller State',
  validElements: 'Controller State',
  currentChoices: 'Controller State',
  startCandidates: 'Controller State',
  isReady: 'Controller State',
  isExecuting: 'Controller State',
  lastError: 'Controller State',
  errorTick: 'Controller State',
  isLoadingChoices: 'Controller State',
  repeatingState: 'Controller State',
  pendingFollowUp: 'Controller State',
  pendingOnServer: 'Controller State',
  stepOutstanding: 'Controller State',
  heldFollowUp: 'Controller State',
  resumeFollowUp: 'Controller Methods',
  actionCompletedTick: 'Controller State',
  actionStartTick: 'Controller State',
  lastActionResult: 'Controller State',
  execute: 'Controller Methods',
  start: 'Controller Methods',
  fill: 'Controller Methods',
  skip: 'Controller Methods',
  clear: 'Controller Methods',
  canClear: 'Controller Methods',
  cancel: 'Controller Methods',
  multiSelectDraft: 'Controller State',
  currentPickDraft: 'Controller State',
  setPickDraft: 'Controller Methods',
  actionQuote: 'Controller State',
  quotePending: 'Controller State',
  quoteError: 'Controller State',
  awaitingConfirmation: 'Controller State',
  confirmDisabledReason: 'Controller State',
  confirm: 'Controller Methods',
  actionMenuPath: 'Controller State',
  toggleMultiSelect: 'Controller Methods',
  confirmMultiSelect: 'Controller Methods',
  isMultiSelectSelected: 'Controller Methods',
  appendListEntry: 'Controller Methods',
  removeListEntry: 'Controller Methods',
  getChoices: 'Controller Methods',
  getValidElements: 'Controller Methods',
  getActionMetadata: 'Controller Methods',
  actionSnapshot: 'Controller State',
  getCollectedPick: 'Controller Methods',
  onBeforeAutoExecute: 'Controller Methods',
  onAfterAutoExecute: 'Controller Methods',
  animationsPending: 'Controller State',
  showActionPanel: 'Controller State',
};

/** The backticked names in the first column of the first table under `### <table>`. */
function rowNames(table: Table): string[] {
  const lines = docs.split('\n');
  const heading = lines.indexOf(`### ${table}`);
  if (heading === -1) throw new Error(`docs/ui-components.md has no "### ${table}" heading; the test reads the controller table under it.`);
  const start = lines.findIndex((line, i) => i > heading && line.startsWith('|'));
  const end = lines.findIndex((line, i) => i > start && !line.startsWith('|'));
  return lines.slice(start + 2, end).map((row) => /^\|\s*`([^`]+)`/.exec(row)?.[1] ?? `unreadable row: ${row}`);
}

describe('UseActionControllerReturn', () => {
  for (const table of ['Controller Methods', 'Controller State'] as const) {
    it(`docs/ui-components.md's ${table} table lists exactly the controller's ${table === 'Controller Methods' ? 'methods' : 'state'}`, () => {
      const documented = rowNames(table);
      const expected = Object.entries(MEMBERS).filter(([, t]) => t === table).map(([name]) => name);
      expect({
        missing: expected.filter((name) => !documented.includes(name)),
        stale: documented.filter((name) => !expected.includes(name)),
      }, `${table} table`).toEqual({ missing: [], stale: [] });
    });
  }
});
