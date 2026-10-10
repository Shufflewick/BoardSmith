// boardsmith runs its pinned tools (eslint, fallow, jscpd) in the author's own Node, so
// every Node that package.json's `engines.node` admits must be one each pinned tool
// supports too. eslint 10 dropped Node 23 and anything below 22.13 (#612); without this
// check, `engines.node` kept admitting Node versions eslint no longer runs on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

const PINNED_TOOLS = ['eslint', 'fallow', 'jscpd'];

/**
 * Whether `version` ([major, minor]) satisfies an engines range made of `||`-joined
 * `^a.b.c` and `>=a[.b[.c]]` terms, the only forms these packages use. Any other form
 * throws, so a tool that adopts one fails here loudly rather than being misread.
 */
function satisfies([major, minor], range) {
  return range.split('||').some((raw) => {
    const term = raw.trim();
    const match = /^(\^|>=)(\d+)(?:\.(\d+))?(?:\.\d+)?$/.exec(term);
    if (!match) throw new Error(`node-floor.test.mjs cannot read the engines term "${term}"; teach satisfies() its form.`);
    const [, op, maj, min = '0'] = match;
    const floorMajor = Number(maj);
    const floorMinor = Number(min);
    if (op === '^') return major === floorMajor && minor >= floorMinor;
    return major > floorMajor || (major === floorMajor && minor >= floorMinor);
  });
}

const candidates = [];
for (let major = 16; major <= 30; major++) {
  for (let minor = 0; minor <= 40; minor++) candidates.push([major, minor]);
}

describe("boardsmith's engines.node", () => {
  const ours = readJson('package.json').engines.node;

  for (const tool of PINNED_TOOLS) {
    it(`admits only Node versions the pinned ${tool} supports`, () => {
      const theirs = readJson(`node_modules/${tool}/package.json`).engines.node;
      const unsupported = candidates
        .filter((v) => satisfies(v, ours) && !satisfies(v, theirs))
        .map(([major, minor]) => `${major}.${minor}`);
      expect(unsupported, `engines.node "${ours}" admits Node versions ${tool} (engines "${theirs}") does not support`).toEqual([]);
    });
  }
});
