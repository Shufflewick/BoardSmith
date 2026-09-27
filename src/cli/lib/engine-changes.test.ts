import { describe, it, expect } from 'vitest';
import { engineChangeHint } from './engine-changes.js';
import { ENGINE_CONTRACT, type EngineContractRevision } from '../../contract/index.js';

/**
 * #423: a game written against an older engine revision fails its type check
 * when BoardSmith changes an API it calls, and the compiler's own words
 * ("Expected 4 arguments, but got 3") do not say what changed or what to write
 * instead. The contract history does, so validate names the revision.
 */

const revision = (n: number, summary: string): EngineContractRevision => ({
  revision: n,
  date: `2026-09-${String(n).padStart(2, '0')}`,
  bundleProtocol: 2,
  surfaceHash: 'x',
  payloadHash: 'y',
  summary,
});

const HISTORY = [
  revision(1, 'createWorld reads the bundle world block.'),
  revision(2, 'walkDeclaration takes a fourth reader and returns WorldWalkAnswers.'),
  revision(3, 'Bots skip illegal moves.'),
];

/** The #423 errors, and the lines of the game's test file they point at. */
const DIAGNOSTICS = [
  'tests/world.test.ts(129,11): error TS2554: Expected 4 arguments, but got 3.',
  'tests/world.test.ts(166,36): error TS2554: Expected 4 arguments, but got 3.',
  "tests/world.test.ts(191,7): error TS2740: Type 'WorldWalkAnswers' is missing the following properties from type 'readonly DeclaredSeatActivityStamp[]': length, concat, join, slice, and 20 more.",
];
const LINES: Record<number, string> = {
  129: '    await walkDeclaration(',
  166: '    const declaredActivity = await walkDeclaration(',
  191: '      declaredActivity,',
};
const sourceLine = (file: string, line: number) => (file === 'tests/world.test.ts' ? LINES[line] : undefined);

describe('engineChangeHint (#423)', () => {
  it('names the revision since the last build that changed what the errors use, where, and what it says', () => {
    expect(engineChangeHint({ diagnostics: DIAGNOSTICS, sourceLine, builtRevision: 1, history: HISTORY })).toEqual([
      'BoardSmith changed something this code uses after this game was last built (engine revision 1; this BoardSmith is revision 3). ' +
        'Change the code the way the revision below says, then run `boardsmith validate` again.',
      'Engine revision 2 (2026-09-02) changed walkDeclaration, WorldWalkAnswers, used at tests/world.test.ts:129, 166, 191: ' +
        'walkDeclaration takes a fourth reader and returns WorldWalkAnswers.',
    ]);
  });

  it('says nothing about a revision the game was already built against', () => {
    expect(engineChangeHint({ diagnostics: DIAGNOSTICS, sourceLine, builtRevision: 2, history: HISTORY })).toBeNull();
  });

  it('says nothing when no change since the build names what the errors use', () => {
    const own = ["src/rules/game.ts(3,1): error TS2304: Cannot find name 'scoreHand'."];
    expect(engineChangeHint({ diagnostics: own, sourceLine: () => 'scoreHand(x);', builtRevision: 1, history: HISTORY })).toBeNull();
  });

  it('finds the real #423 change in the shipped contract history', () => {
    const hint = engineChangeHint({
      diagnostics: DIAGNOSTICS,
      sourceLine,
      builtRevision: 107,
      history: ENGINE_CONTRACT.history,
    });
    const named = /Engine revision 112 \(2026-09-26\) changed (.*?), used at tests\/world\.test\.ts:129, 166, 191:/.exec(hint?.join('\n') ?? '');
    expect(named?.[1].split(', ').sort()).toEqual(['WorldWalkAnswers', 'declaredActivity', 'walkDeclaration']);
    expect(hint?.join('\n')).toContain('walkDeclaration takes a fourth reader and returns that object');
  });
});
