/**
 * The games the merge gate leaves out of `boardsmith catalogue`, read from the
 * gate's own `.agent-policy.json` (#1092). Each is named once, with the issue
 * that brings it back. Importing the file also makes it this test's dependency,
 * so a change that only adds or removes a skip has a related test to run.
 */
import { describe, it, expect } from 'vitest';
import policy from '../../../.agent-policy.json';
import { parseSkips } from './catalogue.js';

const catalogue = policy.verify.find((check) => check.name === 'catalogue');
const run = catalogue?.run ?? '';
const entries = [...run.matchAll(/--skip '([^']*)'/g)].map((match) => match[1]);

describe("the merge gate's catalogue skips (#1092)", () => {
  it('has a catalogue check whose every --skip is one quoted <game>=<reason>', () => {
    expect(catalogue, 'the verify list has no check named catalogue').toBeDefined();
    expect(entries.length).toBe(run.split('--skip').length - 1);
  });

  it('names each skipped game once', () => {
    const games = entries.map((entry) => entry.slice(0, entry.indexOf('=')));
    expect(games).toEqual([...new Set(games)]);
  });

  it('gives every skip a reason that names the issue tracking it', () => {
    const unnamed = Object.entries(parseSkips(entries)).filter(([, reason]) => !/[\w.-]+\/[\w.-]+#\d+/.test(reason));
    expect(unnamed).toEqual([]);
  });
});
