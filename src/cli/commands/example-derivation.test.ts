import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WORKED_EXAMPLE_KINDS,
  workedExampleId,
  createWorkedExampleSpec,
  collectWorkedExampleSpecs,
  buildExampleExtractionPayload,
  collectGameApiSurface,
  buildExampleTranslationPayload,
  EXAMPLE_EXTRACTION_TOKEN,
  EXAMPLE_TRANSLATION_TOKEN,
  type WorkedExampleSpec,
  type GameApiSurface,
} from './example-derivation.js';
import { DERIVE_CHECK_LEDGER_BEGIN } from './verify-derive-check.js';
import { readFile } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `example-derivation.ts` is the ONE shared module both TEST-01 (build-side) and CHECK-06
 * (verify-side) call to derive a runnable test from a worked example (SC-3). This suite proves
 * its three load-bearing behaviors:
 *
 *   1. Caller-assigned identity + fail-closed collision (Task 1) — the direct inheritance of
 *      177.1's CR-01/CR-02 fix.
 *   2. The extraction payload's positive allow-list carries BOTH `Example (p.N):` content AND
 *      `Visual (p.N):` lines — the inverse of `quoteLinesOnly` (WR-07 Option B) — against REAL
 *      verbatim text copied from the three reference games (Task 2).
 *   3. The translation payload's kind-branched dispatch, backed by a mechanically-collected real
 *      project API surface that never reads under `testDir` (Task 3).
 */

// -------------------------------------------------------------------------------------------
// Real reference-game fixtures, copied verbatim (178-CONTEXT.md decision 13's discipline: never
// invented prose). Line numbers noted in each comment refer to the ORIGINAL file; the fixture
// text itself is numbered fresh from 1 by buildExampleExtractionPayload, which is expected and
// asserted below (fixtures are excerpts, not full files).
// -------------------------------------------------------------------------------------------

/** Copied verbatim from `seven/rulebook/01-definitions-and-components.md` lines 1-14. */
const SEVEN_FIXTURE = [
  '# Definitions and Distribution of Cards',
  '',
  'p.1, Definitions:',
  '"Hand: The cards each player holds. Each starts with 3 and ends the game with 10."',
  '"Set: 2+ cards with matching numbers."',
  '"example: 5, 5, 5"',
  '',
  'Visual (p.1): The Set example is illustrated by three card images side by side: a green 5, a red 5, and a purple 5.',
  '',
  'p.1, Definitions:',
  '"Run: 3+ cards in numeric order."',
  '"example: 5, 6, 7"',
  '',
  'Visual (p.1): The Run example is illustrated by three card images side by side: a red 1, a blue 2, and a red 3 (the printed example text reads 5, 6, 7 while the accompanying card images show 1, 2, 3).',
].join('\n');

/** Copied verbatim from `one-two-punch/rulebook/02-action-cards-and-resolution.md` lines 84-94. */
const ONE_TWO_PUNCH_FIXTURE = [
  '## Punch Examples',
  '',
  'p.2, Punch Examples (italic):',
  '"If you are punched and have one ready and two exhausted Guards, you would lose one exhausted Guard."',
  '',
  'Visual (p.2): Diagram: three Guard cards shown before the punch, each a boxer-portrait card labeled beneath "READY", "EXHAUSTED", "EXHAUSTED". An arrow points right to the after-state: two Guard cards labeled "READY" and "EXHAUSTED" (one exhausted Guard has been removed).',
  '',
  'p.2, Punch Examples (italic):',
  '"If instead, you have three ready and no exhausted Guards, you would simply exhaust one card, leaving you with one exhausted and two ready."',
  '',
  'Visual (p.2): Diagram: three Guard cards before the punch, all labeled "READY". An arrow points right to the after-state: three Guard cards labeled "READY", "READY", "EXHAUSTED".',
].join('\n');

/** Copied verbatim from `doom-machine/rulebook/01-destroying-a-machine-part.md` lines 1-13. */
const DOOM_MACHINE_PART1_FIXTURE = [
  '# Destroying a Machine Part',
  '',
  'p.1 (panel -7-), DESTROYING A MACHINE PART:',
  '"If you successfully destroy a machine part by reducing its HP die to zero, remove the card from play and add that part\'s die to your permanent dice pool (set it aside with your other spent dice until the start of the next turn)."',
  '"Note: you can never have more than 10 dice (5 black and 5 yellow) in your permanent pool."',
  '"Then, shift any remaining machine part cards in play to close the gap."',
  '',
  'p.1 (panel -7-), DESTROYED CARD EFFECTS:',
  '"Some machine part cards have a yellow X icon and effect on them. These effects are triggered and resolved immediately when that part is destroyed."',
  '',
  'Diagram description (p.1, panel -7-): a yellow banner with a circled-X icon reading "DEAL 1 DMG TO ALL PARTS IN PLAY", with an arrow pointing to a sample teal machine part card that shows the same yellow destroy-effect banner across its lower area. The sample card also shows its title bar, a cycle track column of icons down the left, and yellow roll-condition tiles on its right side.',
  '',
  'Worked example content (p.1, panel -7-, verbatim from card art):',
  '"DEAL 1 DMG TO ALL PARTS IN PLAY"',
].join('\n');

/** Copied verbatim from `doom-machine/rulebook/02-machine-phase.md` lines 6-11. */
const DOOM_MACHINE_PART2_FIXTURE = [
  'p.2 (panel -8-), PHASE II: THE MACHINE PHASE:',
  '"At the start of the machine phase, go from left to right down the row of machine parts in play, cycling each card\'s track and resolving its abilities as follows:"',
  '"1) Move a machine part card\'s yellow die 1 space down its cycle track. If that dice lands on an icon, immediately trigger that icon\'s corresponding ability."',
  '',
  'p.2 (panel -8-), EXAMPLE:',
  '"The HP die for Soul Harvester will cycle one space down the track, triggering its [damage icon] ability, which will deal 5 damage to the player. If they don\'t have enough shields to prevent some or all of that damage. Unblocked damage carries over and reduces HP directly."',
  '',
  'p.2 (panel -8-), Note:',
  '"Note: If moving the die places it on a dead space (darkened square), then move that die back to the starting position on the track."',
  '',
  'Diagram description (p.2, panel -8-, the EXAMPLE image): a teal machine part card titled "SOUL HARVESTER" with a skull-and-gears illustration. Down its left side runs a vertical cycle track of square spaces; a yellow die sits on one space with a white downward arrow showing it moving one space to the next space, which bears a green/teal damage icon. To the right of the track are yellow roll-condition tiles: a "? - ? - ?" style three-die condition row, and below it two labeled yellow strips reading "DEAL 5 DMG" and "TAKE 1 DMG" (the card\'s icon effects). The card\'s HP/health value and additional small icons appear along the bottom edge.',
].join('\n');

// -------------------------------------------------------------------------------------------
// Task 1 — WorkedExample spec, caller-assigned identity, fail-closed collision
// -------------------------------------------------------------------------------------------

describe('WORKED_EXAMPLE_KINDS', () => {
  it('is frozen and contains exactly transition and predicate', () => {
    expect(WORKED_EXAMPLE_KINDS).toEqual(['transition', 'predicate']);
    expect(Object.isFrozen(WORKED_EXAMPLE_KINDS)).toBe(true);
  });
});

describe('workedExampleId', () => {
  it('composes deterministically from slicePath + lineNumber only', () => {
    const id = workedExampleId({ slicePath: 'rulebook/02-action-cards.md', lineNumber: 86 });
    expect(id).toBe(workedExampleId({ slicePath: 'rulebook/02-action-cards.md', lineNumber: 86 }));
    expect(id).not.toBe(workedExampleId({ slicePath: 'rulebook/02-action-cards.md', lineNumber: 91 }));
  });
});

describe('createWorkedExampleSpec (Task 1 — the choke point)', () => {
  const oneTwoPunchSliceText = ONE_TWO_PUNCH_FIXTURE;

  function baseTransitionReturned() {
    return {
      slicePath: 'rulebook/02-action-cards-and-resolution.md',
      lineNumber: 4,
      pageCitation: 'p.2',
      kind: 'transition',
      sourceText:
        'If you are punched and have one ready and two exhausted Guards, you would lose one exhausted Guard.',
      setup: 'Punching player has one ready and two exhausted Guards.',
      action: 'The punched player is punched.',
      expected: 'The punched player has one exhausted Guard removed, leaving one ready and one exhausted.',
      supportingQuoteLines: [oneTwoPunchSliceText.split('\n')[3]],
    };
  }

  it('constructs a valid transition spec', () => {
    const spec = createWorkedExampleSpec({
      id: workedExampleId({ slicePath: 'rulebook/02-action-cards-and-resolution.md', lineNumber: 4 }),
      sliceText: oneTwoPunchSliceText,
      returned: baseTransitionReturned(),
    });
    expect(spec.kind).toBe('transition');
    expect(spec.action).toBe('The punched player is punched.');
    expect(Object.isFrozen(spec)).toBe(true);
  });

  it('constructs a valid predicate spec with no action', () => {
    const spec = createWorkedExampleSpec({
      id: workedExampleId({ slicePath: 'rulebook/01-definitions-and-components.md', lineNumber: 12 }),
      sliceText: SEVEN_FIXTURE,
      returned: {
        slicePath: 'rulebook/01-definitions-and-components.md',
        lineNumber: 12,
        pageCitation: 'p.1',
        kind: 'predicate',
        sourceText: '"example: 5, 6, 7"',
        setup: 'The three cards 5, 6, 7.',
        expected: 'isRun([5, 6, 7]) is true.',
      },
    });
    expect(spec.kind).toBe('predicate');
    expect(spec.action).toBeUndefined();
  });

  it('rejects a kind outside WORKED_EXAMPLE_KINDS', () => {
    expect(() =>
      createWorkedExampleSpec({
        id: 'x',
        sliceText: oneTwoPunchSliceText,
        returned: { ...baseTransitionReturned(), kind: 'observation' },
      }),
    ).toThrow(/Invalid kind "observation"/);
  });

  it('rejects an empty free-prose field', () => {
    expect(() =>
      createWorkedExampleSpec({
        id: 'x',
        sliceText: oneTwoPunchSliceText,
        returned: { ...baseTransitionReturned(), setup: '   ' },
      }),
    ).toThrow(/empty "setup" field/);
  });

  it('rejects a field carrying the ledger fence marker', () => {
    expect(() =>
      createWorkedExampleSpec({
        id: 'x',
        sliceText: oneTwoPunchSliceText,
        returned: { ...baseTransitionReturned(), expected: `hi ${DERIVE_CHECK_LEDGER_BEGIN} bye` },
      }),
    ).toThrow(/ledger fence marker/);
  });

  it('rejects a sourceText that is not a verbatim substring of the supplied sliceText, quoting the offending text', () => {
    expect(() =>
      createWorkedExampleSpec({
        id: 'x',
        sliceText: oneTwoPunchSliceText,
        returned: { ...baseTransitionReturned(), sourceText: 'this sentence does not appear anywhere' },
      }),
    ).toThrow(/this sentence does not appear anywhere/);
  });

  it('rejects kind:"transition" with no action', () => {
    const { action: _action, ...withoutAction } = baseTransitionReturned();
    expect(() =>
      createWorkedExampleSpec({
        id: 'x',
        sliceText: oneTwoPunchSliceText,
        returned: withoutAction,
      }),
    ).toThrow(/kind "transition" but no "action"/);
  });

  it('rejects kind:"predicate" that supplies an action', () => {
    expect(() =>
      createWorkedExampleSpec({
        id: 'x',
        sliceText: oneTwoPunchSliceText,
        returned: { ...baseTransitionReturned(), kind: 'predicate' },
      }),
    ).toThrow(/kind "predicate" but supplies an "action"/);
  });
});

describe('collectWorkedExampleSpecs — fail-closed collision (Task 1)', () => {
  function specWith(overrides: Partial<{ slicePath: string; lineNumber: number; sourceText: string }>) {
    const slicePath = overrides.slicePath ?? 'rulebook/02-action-cards-and-resolution.md';
    const lineNumber = overrides.lineNumber ?? 4;
    const sourceText =
      overrides.sourceText ??
      'If you are punched and have one ready and two exhausted Guards, you would lose one exhausted Guard.';
    const sliceText = `p.2, Punch Examples (italic):\n"${sourceText}"\n`;
    return createWorkedExampleSpec({
      id: workedExampleId({ slicePath, lineNumber }),
      sliceText,
      returned: {
        slicePath,
        lineNumber,
        pageCitation: 'p.2',
        kind: 'predicate',
        sourceText: `"${sourceText}"`,
        setup: 'setup',
        expected: 'expected',
      },
    });
  }

  it('a collision — two specs resolving to the SAME id (identical slicePath+lineNumber) — throws rather than silently overwriting', () => {
    const a = specWith({});
    const b = specWith({}); // byte-identical sourceText AND identical slicePath/lineNumber
    expect(() => collectWorkedExampleSpecs([a, b])).toThrow(/collided on id/);
  });

  it('two specs with byte-identical sourceText but DIFFERENT lineNumber both survive as distinct map entries', () => {
    const a = specWith({ lineNumber: 4 });
    const b = specWith({ lineNumber: 91 }); // same sourceText, different line -> different id
    const map = collectWorkedExampleSpecs([a, b]);
    expect(map.size).toBe(2);
    expect(map.get(a.id)?.sourceText).toBe(map.get(b.id)?.sourceText);
    expect(a.id).not.toBe(b.id);
  });
});

// -------------------------------------------------------------------------------------------
// Task 2 — buildExampleExtractionPayload (extraction)
// -------------------------------------------------------------------------------------------

describe('buildExampleExtractionPayload — extraction (Task 2)', () => {
  it('seven: the payload carries the Visual line recording the printed-text-vs-card-art contradiction', () => {
    const { payload } = buildExampleExtractionPayload({
      path: 'rulebook/01-definitions-and-components.md',
      text: SEVEN_FIXTURE,
    });
    expect(payload).toContain('the accompanying card images show 1, 2, 3');
    expect(payload).toContain('"example: 5, 6, 7"');
    expect(payload).toContain(EXAMPLE_EXTRACTION_TOKEN);
  });

  it('one-two-punch: the payload carries both Punch Examples citation headers, both quoted sentences, and both Visual lines', () => {
    const { payload } = buildExampleExtractionPayload({
      path: 'rulebook/02-action-cards-and-resolution.md',
      text: ONE_TWO_PUNCH_FIXTURE,
    });
    expect(payload).toContain('one ready and two exhausted Guards');
    expect(payload).toContain('three ready and no exhausted Guards');
    const citationHeaderCount = payload.split('p.2, Punch Examples (italic):').length - 1;
    expect(citationHeaderCount).toBe(2);
    const visualCount = payload.split('Visual (p.2):').length - 1;
    expect(visualCount).toBe(2);
  });

  it('doom-machine part 1: the payload carries the "Worked example content (" header and its quoted card-art text', () => {
    const { payload } = buildExampleExtractionPayload({
      path: 'rulebook/01-destroying-a-machine-part.md',
      text: DOOM_MACHINE_PART1_FIXTURE,
    });
    expect(payload).toContain('Worked example content (p.1, panel -7-, verbatim from card art):');
    expect(payload).toContain('"DEAL 1 DMG TO ALL PARTS IN PLAY"');
    expect(payload).toContain(
      'Diagram description (p.1, panel -7-): a yellow banner with a circled-X icon',
    );
  });

  it('doom-machine part 2: the SOUL HARVESTER example is carried ONLY via its "Diagram description (" header, exactly as it exists in the real slice', () => {
    const { payload } = buildExampleExtractionPayload({
      path: 'rulebook/02-machine-phase.md',
      text: DOOM_MACHINE_PART2_FIXTURE,
    });
    expect(payload).toContain('Diagram description (p.2, panel -8-, the EXAMPLE image):');
    expect(payload).toContain('SOUL HARVESTER');
    expect(payload).toContain('p.2 (panel -8-), EXAMPLE:');
  });

  it('a Derived (p.N): reference embedded inside otherwise-retained content is a construction-site backstop THROW, not a filter that silently drops', () => {
    // The allow-list's line-start-only inclusion tests cannot, by construction, ever admit a line
    // whose body literally STARTS with "Derived (p." (every allow-list predicate requires a
    // different literal prefix) — so a genuine backstop test must exploit a Derived reference
    // embedded MID-LINE, inside content an allow rule legitimately retains for other reasons
    // (here: a quoted sentence that itself references an annotation).
    const text = [
      'p.1, Definitions:',
      '"Set: 2+ cards with matching numbers. See Derived (p.1): the count is computed from this."',
    ].join('\n');
    expect(() =>
      buildExampleExtractionPayload({ path: 'rulebook/01-definitions.md', text }),
    ).toThrow(/line 2/);
    expect(() =>
      buildExampleExtractionPayload({ path: 'rulebook/01-definitions.md', text }),
    ).toThrow(/Derived \(p\.N\)/);
  });

  it('every returned line carries a lineNumber matching the 1-based position in the input text', () => {
    const { lines } = buildExampleExtractionPayload({
      path: 'rulebook/01-definitions-and-components.md',
      text: SEVEN_FIXTURE,
    });
    const bySourceLine = new Map(lines.map((l) => [l.lineNumber, l.text]));
    // Line 3 (1-based) of SEVEN_FIXTURE is 'p.1, Definitions:'
    expect(bySourceLine.get(3)).toBe('p.1, Definitions:');
    // Line 6 is '"example: 5, 5, 5"'
    expect(bySourceLine.get(6)).toBe('"example: 5, 5, 5"');
    // Line 14 is the Run example's Visual line
    expect(bySourceLine.get(14)).toContain('the accompanying card images show 1, 2, 3');
  });
});

// -------------------------------------------------------------------------------------------
// Task 3 — collectGameApiSurface + buildExampleTranslationPayload (translation)
// -------------------------------------------------------------------------------------------

/**
 * A self-contained generated-game project, written to a temp dir. Reproduces the exact re-export
 * shapes this function has to handle — a direct declaration in `index.ts`, a `export *` re-export,
 * a NAMED re-export, and a module that `index.ts` never re-exports at all — plus a `tests/` tree
 * holding a symbol that must never appear in the surface.
 *
 * Built here rather than read from `~/BoardSmithGames/<game>`: this repo does not own those
 * projects, so a test asserting on their exported symbols measures whether a sibling repo has been
 * refactored today, not whether this parser works. The shapes below were modeled on real generated
 * games, which is the part worth keeping.
 */
async function writeFixtureProject(root: string): Promise<string> {
  const rules = join(root, 'src', 'rules');
  await fs.mkdir(rules, { recursive: true });
  await fs.mkdir(join(root, 'tests'), { recursive: true });

  await fs.writeFile(
    join(rules, 'index.ts'),
    [
      "export * from './guards.js';",
      "export { numberCardsOf, RANKS } from './cards.js';",
      // `punch.ts` is deliberately NOT re-exported — the one-level limit's negative case.
      'export function legalScoringPatterns(): string[] {',
      '  return [];',
      '}',
      '',
    ].join('\n'),
  );

  await fs.writeFile(
    join(rules, 'guards.ts'),
    [
      'export function readyGuards(): boolean {',
      '  return true;',
      '}',
      'export function computeResolutionOrder(): number[] {',
      '  return [];',
      '}',
      '',
    ].join('\n'),
  );

  await fs.writeFile(
    join(rules, 'cards.ts'),
    [
      'export function numberCardsOf(): number[] {',
      '  return [];',
      '}',
      "export const RANKS = ['a', 'b'];",
      'export function neverReExported(): void {}',
      '',
    ].join('\n'),
  );

  await fs.writeFile(
    join(rules, 'punch.ts'),
    [
      'export function resolvePunch(): void {}',
      'export function exhaustCorneredPuncher(): void {}',
      '',
    ].join('\n'),
  );

  await fs.writeFile(
    join(root, 'tests', 'game.test.ts'),
    'export function aSymbolDefinedOnlyInTests(): void {}\n',
  );

  return root;
}

describe('collectGameApiSurface — translation (Task 3)', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await writeFixtureProject(
      await fs.mkdtemp(join(tmpdir(), 'bs-example-derivation-api-')),
    );
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('returns a surface naming both directly-declared and re-exported symbols, with their kinds', async () => {
    const surface = await collectGameApiSurface(projectDir);
    const names = surface.exportedSymbols.map((s) => s.name);

    expect(names).toContain('legalScoringPatterns'); // declared in index.ts
    expect(names).toContain('numberCardsOf'); // named re-export
    expect(names).toContain('readyGuards'); // export * re-export

    expect(surface.exportedSymbols.find((s) => s.name === 'legalScoringPatterns')?.kind).toBe(
      'function',
    );
    expect(surface.exportedSymbols.find((s) => s.name === 'RANKS')?.kind).toBe('const');
  });

  it('never reads a path under testDir — every returned symbol module resolves under src/', async () => {
    const surface = await collectGameApiSurface(projectDir);

    expect(surface.testDir).toBe(join(projectDir, 'tests'));
    expect(surface.exportedSymbols.length).toBeGreaterThan(0);
    for (const symbol of surface.exportedSymbols) {
      expect(symbol.module.startsWith('src/')).toBe(true);
    }
    // The decisive negative: a symbol that exists ONLY under tests/ is never surfaced.
    expect(surface.exportedSymbols.map((s) => s.name)).not.toContain(
      'aSymbolDefinedOnlyInTests',
    );
  });

  it('one-level-only re-export limit: a module index.ts never re-exports contributes no symbols', async () => {
    const surface = await collectGameApiSurface(projectDir);
    const names = surface.exportedSymbols.map((s) => s.name);

    // punch.ts is reachable on disk but absent from index.ts's re-export chain.
    expect(names).not.toContain('resolvePunch');
    expect(names).not.toContain('exhaustCorneredPuncher');
    // A NAMED re-export pulls only the names it lists, not the module's other exports.
    expect(names).not.toContain('neverReExported');
  });

  it('throws a descriptive error when the project has no src/rules/index.ts', async () => {
    await expect(collectGameApiSurface('/nonexistent-project-dir-xyz')).rejects.toThrow(
      /No src\/rules\/index\.ts/,
    );
  });
});

/**
 * An inert stand-in project root for the surface literals below. These tests supply their own
 * `exportedSymbols`, so the path is never read — it only has to be a path. Deliberately not a
 * `~/BoardSmithGames/<game>` location: nothing in this repo's tests should name a project this
 * repo does not own.
 */
const SYNTHETIC_PROJECT_DIR = join('/tmp', 'bs-synthetic-project');

describe('buildExampleTranslationPayload — translation (Task 3)', () => {
  const predicateSpec: WorkedExampleSpec = createWorkedExampleSpec({
    id: workedExampleId({ slicePath: 'rulebook/01-definitions-and-components.md', lineNumber: 12 }),
    sliceText: SEVEN_FIXTURE,
    returned: {
      slicePath: 'rulebook/01-definitions-and-components.md',
      lineNumber: 12,
      pageCitation: 'p.1',
      kind: 'predicate',
      sourceText: '"example: 5, 6, 7"',
      setup: 'The three cards 5, 6, 7.',
      expected: 'isRun([5, 6, 7]) is true.',
    },
  });

  const transitionSpec: WorkedExampleSpec = createWorkedExampleSpec({
    id: workedExampleId({ slicePath: 'rulebook/02-action-cards-and-resolution.md', lineNumber: 4 }),
    sliceText: ONE_TWO_PUNCH_FIXTURE,
    returned: {
      slicePath: 'rulebook/02-action-cards-and-resolution.md',
      lineNumber: 4,
      pageCitation: 'p.2',
      kind: 'transition',
      sourceText:
        'If you are punched and have one ready and two exhausted Guards, you would lose one exhausted Guard.',
      setup: 'Punching player has one ready and two exhausted Guards.',
      action: 'The punched player is punched.',
      expected: 'One exhausted Guard is removed, leaving one ready and one exhausted.',
    },
  });

  it('the predicate payload contains "predicate" and at least one symbol name from the supplied surface', () => {
    const api: GameApiSurface = {
      projectDir: SYNTHETIC_PROJECT_DIR,
      testDir: join(SYNTHETIC_PROJECT_DIR, 'tests'),
      exportedSymbols: [{ name: 'legalScoringPatterns', kind: 'function', module: 'src/rules/scoring.ts' }],
    };
    const payload = buildExampleTranslationPayload(predicateSpec, api);
    expect(payload).toContain('predicate');
    expect(payload).toContain('legalScoringPatterns');
    expect(payload).toContain(EXAMPLE_TRANSLATION_TOKEN);
  });

  it('the transition payload names the action-execution target shape', () => {
    const api: GameApiSurface = {
      projectDir: SYNTHETIC_PROJECT_DIR,
      testDir: join(SYNTHETIC_PROJECT_DIR, 'tests'),
      exportedSymbols: [{ name: 'readyGuards', kind: 'function', module: 'src/rules/guards.ts' }],
    };
    const payload = buildExampleTranslationPayload(transitionSpec, api);
    expect(payload).toContain('doAction');
    expect(payload).toContain('TRANSITION');
  });

  it('the payload contains ZERO substrings read from the project testDir — implemented structurally: every symbol module resolves under src/, never testDir', async () => {
    // Uses a real collected surface (not a hand-written literal), so the assertion is about what
    // `collectGameApiSurface` actually produces — built from this file's own fixture project.
    const fixtureDir = await writeFixtureProject(
      await fs.mkdtemp(join(tmpdir(), 'bs-example-derivation-payload-')),
    );
    const api = await collectGameApiSurface(fixtureDir);
    const payload = buildExampleTranslationPayload(predicateSpec, api);
    for (const symbol of api.exportedSymbols) {
      expect(symbol.module.startsWith('src/')).toBe(true);
    }
    expect(payload).not.toContain('tests/');
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it('states the generated file\'s two-directory depth so a translator can compute a correct relative import prefix (178-11 finding)', () => {
    // Live proof finding (178-11): a translator dispatch guessed the shallower "../src/..."
    // prefix a hand-written tests/*.test.ts file would use, but the generated file always lives
    // one level deeper (tests/examples/*.examples.test.ts) — so the emitted import failed to
    // resolve at all when actually executed. This asserts the payload now states that depth
    // explicitly, with a worked example of the correct two-level prefix.
    const api: GameApiSurface = {
      projectDir: SYNTHETIC_PROJECT_DIR,
      testDir: join(SYNTHETIC_PROJECT_DIR, 'tests'),
      exportedSymbols: [{ name: 'readyGuards', kind: 'function', module: 'src/rules/guards.ts' }],
    };
    const payload = buildExampleTranslationPayload(transitionSpec, api);
    expect(payload).toContain('two nested directories below the project root');
    expect(payload).toContain('../../src/rules/game.js');
    expect(payload).not.toContain('tests/');
  });

  it('dispatches even when the supplied surface has no viable target — unexecutable is the model\'s verdict, never a payload-builder shortcut', () => {
    const emptyApi: GameApiSurface = {
      projectDir: SYNTHETIC_PROJECT_DIR,
      testDir: join(SYNTHETIC_PROJECT_DIR, 'tests'),
      exportedSymbols: [],
    };
    const payload = buildExampleTranslationPayload(predicateSpec, emptyApi);
    expect(payload).toContain('unexecutable');
    expect(payload.length).toBeGreaterThan(0);
  });
});

describe('module header comment — Task 3 acceptance criterion', () => {
  it('names the three pattern constants and SevenCard[], and states it was verified against a real shipped scoring.ts', async () => {
    const modulePath = fileURLToPath(new URL('./example-derivation.ts', import.meta.url));
    const source = await readFile(modulePath, 'utf-8');
    expect(source).toContain('RUN_OF_SEVEN_PATTERN');
    expect(source).toContain('COMBO_SETS_AND_RUNS_PATTERN');
    expect(source).toContain('SET_5_PLUS_SET_2_PATTERN');
    expect(source).toContain('SevenCard[]');
    expect(source).toContain("src/rules/scoring.ts");
    // Deliberately does NOT assert a `~/BoardSmithGames/...` path: nothing in this repo should
    // name, or depend on the layout of, a project this repo does not own.
    expect(source).not.toContain('BoardSmithGames');
  });
});

/**
 * SC-3 — both pipeline sides derive from one module. Completes, rather than duplicates, plan
 * 05's `CHECK-06 — one derivation implementation (SC-3)` block: that block proved the two skill
 * files cite the same CONTRACT files; this test proves, by source inspection alone (never by
 * dispatching a model), that every COMMAND those skills cite is registered, reaches
 * `example-derivation.ts` in one hop, and that neither command module keeps its own second copy
 * of the payload-builder logic — a static, structural code-graph fact 178-11's live proof
 * measured against (178-PROOF.md), never re-proven by that proof itself.
 *
 * Each assertion below states, in its own `it` name/body, the concrete edit that would make it
 * fail — an assertion that cannot fail is not evidence (178-CONTEXT.md decision 14's standard,
 * applied to code-structure checks, not just acceptance criteria).
 */
describe('SC-3 — both pipeline sides derive from one module', () => {
  const CLI_PATH = fileURLToPath(new URL('../cli.ts', import.meta.url));
  const BUILD_TEST_MD_PATH = fileURLToPath(
    new URL('../slash-command/bs/build/test.md', import.meta.url),
  );
  const VERIFY_GAME_MD_PATH = fileURLToPath(new URL('../slash-command/bs/verify-game.md', import.meta.url));
  const REPLAY_PATH = fileURLToPath(new URL('./verify-example-replay.ts', import.meta.url));
  const EMIT_PATH = fileURLToPath(new URL('./example-test-emit.ts', import.meta.url));
  const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url)); // src/

  // Every `.command('...')` registration in cli.ts, mapped to the source file its `.action(...)`
  // handler is imported from (by import specifier, resolved manually below — cli.ts imports every
  // command handler by explicit `.js` path, so this mapping is exact, not inferred).
  const COMMAND_TO_HANDLER_MODULE: Record<string, string> = {
    'verify-example-replay': './commands/verify-example-replay.js',
    'verify-example-record': './commands/verify-example-replay.js',
    'verify-example-translate': './commands/verify-example-replay.js',
    'verify-example-emit': './commands/example-test-emit.js',
  };

  async function readAll(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  it(
    '(a) every verify-example-* command cited by build/test.md and verify-game.md is registered ' +
      "in cli.ts, and each registration's handler module transitively imports example-derivation.ts " +
      '— fails the moment a skill cites a command that is never registered, or whose handler module ' +
      'stops importing example-derivation.ts',
    async () => {
      const [buildTestMd, verifyGameMd, cliSource, replaySource, emitSource] = await Promise.all([
        readAll(BUILD_TEST_MD_PATH),
        readAll(VERIFY_GAME_MD_PATH),
        readAll(CLI_PATH),
        readAll(REPLAY_PATH),
        readAll(EMIT_PATH),
      ]);

      const citedCommands = new Set(
        [...buildTestMd.matchAll(/verify-example-[a-z]+/g), ...verifyGameMd.matchAll(/verify-example-[a-z]+/g)].map(
          (m) => m[0],
        ),
      );
      // Both skills together must cite all four commands this milestone shipped — a citation
      // going stale (e.g. a skill rewrite silently dropping one) fails here first.
      expect([...citedCommands].sort()).toEqual(
        ['verify-example-emit', 'verify-example-record', 'verify-example-replay', 'verify-example-translate'].sort(),
      );

      const moduleSourceByPath: Record<string, string> = {
        './commands/verify-example-replay.js': replaySource,
        './commands/example-test-emit.js': emitSource,
      };

      for (const command of citedCommands) {
        // Registered: cli.ts contains `.command('<command>')`.
        expect(cliSource, `${command} must be registered via .command('${command}') in cli.ts`).toContain(
          `.command('${command}')`,
        );
        // Handler module resolves (mapping above is exact — derived from cli.ts's own imports).
        const handlerModule = COMMAND_TO_HANDLER_MODULE[command];
        expect(handlerModule, `no known handler module mapping for ${command}`).toBeDefined();
        // That handler module transitively imports example-derivation.ts in ONE hop.
        const handlerSource = moduleSourceByPath[handlerModule];
        expect(
          handlerSource,
          `${command}'s handler module (${handlerModule}) must import from './example-derivation.js'`,
        ).toContain("from './example-derivation.js'");
      }
    },
  );

  it(
    "(b) verify-example-replay.ts imports buildExampleExtractionPayload, buildExampleTranslationPayload, " +
      'AND collectGameApiSurface from example-derivation.js — the extraction half and the ' +
      'translation half, in one module — fails if either import is removed or re-pointed at a ' +
      'different module',
    async () => {
      const replaySource = await readAll(REPLAY_PATH);
      const importBlockMatch = replaySource.match(/from '\.\/example-derivation\.js';/);
      expect(importBlockMatch, 'verify-example-replay.ts must import from example-derivation.js').not.toBeNull();
      for (const symbol of [
        'buildExampleExtractionPayload',
        'buildExampleTranslationPayload',
        'collectGameApiSurface',
      ]) {
        expect(
          replaySource,
          `verify-example-replay.ts must import ${symbol} from example-derivation.js`,
        ).toMatch(new RegExp(`\\b${symbol}\\b[\\s\\S]{0,400}from '\\./example-derivation\\.js'`));
      }
    },
  );

  it(
    '(c) neither verify-example-replay.ts nor example-test-emit.ts declares its own build.*Payload ' +
      'or collect.*ApiSurface function — fails the moment either command module grows a second, ' +
      'locally-declared payload builder instead of importing the shared one',
    async () => {
      const [replaySource, emitSource] = await Promise.all([readAll(REPLAY_PATH), readAll(EMIT_PATH)]);
      const localDeclarationRe = /(?:export\s+)?(?:async\s+)?function\s+(build\w*Payload|collect\w*ApiSurface)\s*\(/;
      expect(replaySource.match(localDeclarationRe)).toBeNull();
      expect(emitSource.match(localDeclarationRe)).toBeNull();
    },
  );

  it(
    '(d) each of buildExampleExtractionPayload, buildExampleTranslationPayload, and ' +
      'collectGameApiSurface has exactly ONE `export function` declaration site under src/, and it ' +
      'is example-derivation.ts — fails the instant anyone copies the derivation logic into a ' +
      'second module, even if that second module also imports the original (duplication, not ' +
      'reuse, is what this assertion catches)',
    async () => {
      const { readdir } = await import('node:fs/promises');
      const { join: pathJoin } = await import('node:path');

      async function walk(dir: string): Promise<string[]> {
        const entries = await readdir(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const full = pathJoin(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...(await walk(full)));
          } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            files.push(full);
          }
        }
        return files;
      }

      const allSrcFiles = await walk(SRC_DIR);
      const symbols = [
        'buildExampleExtractionPayload',
        'buildExampleTranslationPayload',
        'collectGameApiSurface',
      ];

      for (const symbol of symbols) {
        const declRe = new RegExp(`export (?:async )?function ${symbol}\\s*\\(`);
        const sitesFound: string[] = [];
        for (const file of allSrcFiles) {
          const source = await readFile(file, 'utf-8');
          if (declRe.test(source)) sitesFound.push(file);
        }
        expect(sitesFound, `${symbol} must have exactly one export-function declaration site`).toHaveLength(1);
        expect(sitesFound[0]).toContain('example-derivation.ts');
      }
    },
  );
});
