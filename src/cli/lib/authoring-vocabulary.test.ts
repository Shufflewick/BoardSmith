/**
 * WHAT THE ENGINE IS ALLOWED TO TELL AN AUTHOR TO WRITE.
 *
 * ## Why this file exists (#184)
 *
 * #171 deleted `world`, `bot` and `persistence` from `boardsmith.json` and moved
 * a world's seat count into the compiled `gameDefinition.world.maxPlayers`.
 * Nothing deleted the SENTENCES that told an author to edit those keys, so four
 * of them shipped for three weeks: a scaffolded world's own README pointed at
 * the deleted `world` block, a seat refusal told an author to raise a field
 * `capabilityContradictions` refuses by name, the schema made `roundDeadline`
 * depend on an authorable `bot: true`, and the scaffolded board told an author
 * to call `boardRef()`, which no composable has ever exported.
 *
 * Each one is a WRONG INSTRUCTION rather than a stale comment: an author who
 * follows it produces a bundle the build rejects, or a board that throws on the
 * first click. A test suite that gates prose was already the pattern here
 * (`docs/persistent-world-claims.test.ts`), and the four defects above are the
 * argument for extending it from one page to every author-facing string the
 * engine ships.
 *
 * ## The two checks that are DERIVED, and the one that is a list
 *
 * A curated list of forbidden phrases proves only that yesterday's mistakes are
 * gone. Two of the three checks below are tied to something that moves:
 *
 * - **A manifest key an author is told to write must exist in the schema.**
 *   `boardsmith.schema.json`'s `properties` IS the authorable key set --
 *   `config-schema.ts` derives `ALLOWED_TOP_LEVEL_KEYS` from exactly it -- so
 *   deleting a key from the schema turns every sentence still naming it red.
 * - **A helper the scaffold tells an author to call must exist on the
 *   composable it says to get it from.** The member list comes from
 *   `useBoardInteraction`'s own source, so renaming a member turns the scaffold
 *   red rather than shipping an undefined-is-not-a-function to a new project.
 *
 * The third is a list, because "`clockOnly`" names nothing that exists to
 * derive from any more. Each entry carries the sentence to write instead.
 *
 * ## WHAT THIS DOES NOT COVER, deliberately
 *
 * - **It reads string literals, not behaviour.** A refusal that names a real
 *   key while giving advice that does not fix anything passes here.
 * - **It cannot judge a sentence's grammar or its truth**, only the identifiers
 *   in it. "Delete `backend`" and "Declare `backend`" look the same to it.
 * - **A negated or historical mention is exempt** (see `HISTORICAL`), because a
 *   doc saying "there is no `world` block any more" must stay sayable. That
 *   exemption is a hole: a wrong instruction that happens to contain the word
 *   "removed" slips through it.
 * - **It scans the engine's own strings, plus `docs/`.** A game's own README in
 *   `~/BoardSmithGames` is out of scope; nothing here ships it.
 * - **Prose in comments is scanned only for the scaffold templates**, whose
 *   comments are shipped INTO an author's project and so are author-facing.
 *   An ordinary source comment is not gated, so `src/world/definition.ts`'s
 *   header prose is on the honour system.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { generateScaffoldFiles } from './project-scaffold.js';
import {
  generateWorldA11yTestTs,
  generateWorldBoardVue,
  generateWorldElementsTs,
  generateWorldGameTs,
  generateWorldReadme,
  generateWorldRulesIndexTs,
  generateWorldTestTs,
  generateWorldTs,
  generateWorldUisTs,
} from './world-scaffold.js';
import { WORLD_REFUSALS } from '../../world/refusals.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const readSrc = (...parts: string[]) => readFileSync(join(REPO_ROOT, ...parts), 'utf-8');

/** One author-facing string, and where a failure has to be fixed. */
interface Surface {
  where: string;
  text: string;
}

// ---------------------------------------------------------------------------
// THE SURFACES. Everything an author reads that this repository wrote.
// ---------------------------------------------------------------------------

/** Every file `boardsmith init` writes, for both backends, rendered exactly as
 *  a new project receives it -- comments included, because a scaffold's
 *  comments are the scaffold's teaching. */
function scaffoldSurfaces(): Surface[] {
  const table = generateScaffoldFiles(
    {
      backend: 'table',
      name: 'gate-table',
      displayName: 'Gate Table',
      description: 'A table project rendered by the vocabulary gate.',
      playerCount: { min: 2, max: 4 },
    },
    '/tmp/gate-table',
  );
  const worldConfig = {
    backend: 'world' as const,
    name: 'gate-world',
    displayName: 'Gate World',
    description: 'A world project rendered by the vocabulary gate.',
  };
  const world = generateScaffoldFiles(worldConfig, '/tmp/gate-world');

  return [
    ...table.map((file) => ({ where: `init (table): ${file.path}`, text: file.content })),
    ...world.map((file) => ({ where: `init --world: ${file.path}`, text: file.content })),
    // init.ts writes the world half from these directly, so they are not in
    // generateScaffoldFiles' list and would otherwise be the ungated half.
    { where: 'init --world: README.md', text: generateWorldReadme(worldConfig) },
    { where: 'init --world: src/rules/game.ts', text: generateWorldGameTs('GateWorld') },
    { where: 'init --world: src/rules/elements.ts', text: generateWorldElementsTs() },
    { where: 'init --world: src/rules/world.ts', text: generateWorldTs('GateWorld') },
    { where: 'init --world: src/rules/index.ts', text: generateWorldRulesIndexTs(worldConfig) },
    { where: 'init --world: tests/world.test.ts', text: generateWorldTestTs() },
    { where: 'init --world: tests/a11y.example.test.ts', text: generateWorldA11yTestTs() },
    { where: 'init --world: src/ui/uis.ts', text: generateWorldUisTs() },
    {
      where: 'init --world: src/ui/components/WorldBoard.vue',
      text: generateWorldBoardVue(),
    },
  ];
}

/** Every `description` in the config schema, at any depth. These are what
 *  `boardsmith validate` and an editor's JSON completion quote back. */
function schemaSurfaces(): Surface[] {
  const schema: unknown = JSON.parse(readSrc('src', 'cli', 'lib', 'boardsmith.schema.json'));
  const found: Surface[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'description' && typeof value === 'string') {
        found.push({ where: `boardsmith.schema.json ${path}.description`, text: value });
      } else {
        walk(value, `${path}.${key}`);
      }
    }
  };
  walk(schema, '');
  return found;
}

/** Every quoted string in a file, joined per file. Comments are left out on
 *  purpose: a refusal's WORDS are the contract, a neighbouring comment is
 *  commentary, and gating commentary makes an accurate history unwritable. */
function stringLiteralsOf(...parts: string[]): Surface {
  const source = readSrc(...parts);
  const literals = [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)].map(
    (match) => match[1] ?? match[2] ?? '',
  );
  return { where: parts.join('/'), text: literals.join('\n') };
}

/** The refusals a host relays to a player or an author verbatim. */
function refusalSurfaces(): Surface[] {
  return [
    {
      where: 'WORLD_REFUSALS',
      text: Object.entries(WORLD_REFUSALS)
        .map(([code, entry]) => `${code}: ${entry.why}`)
        .join('\n'),
    },
    stringLiteralsOf('src', 'world', 'definition.ts'),
    stringLiteralsOf('src', 'session', 'capabilities.ts'),
    stringLiteralsOf('src', 'cli', 'commands', 'validate.ts'),
    stringLiteralsOf('src', 'cli', 'commands', 'build.ts'),
    stringLiteralsOf('src', 'cli', 'commands', 'init.ts'),
    stringLiteralsOf('src', 'cli', 'commands', 'dev-world.ts'),
  ];
}

/** Every prose page the repository ships. `docs/persistent-world-claims.test.ts`
 *  gates what the world GUIDE claims; this gates the vocabulary of all of them,
 *  because getting-started.md sends an author to run `init --world` and then
 *  tells them what it wrote. */
function docSurfaces(): Surface[] {
  const dir = join(REPO_ROOT, 'docs');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ where: `docs/${name}`, text: readFileSync(join(dir, name), 'utf-8') }));
}

const surfaces: Surface[] = [
  ...scaffoldSurfaces(),
  ...schemaSurfaces(),
  ...refusalSurfaces(),
  ...docSurfaces(),
];

// ---------------------------------------------------------------------------
// THE EXEMPTION. A page must stay able to say a thing is gone.
// ---------------------------------------------------------------------------

/**
 * A mention inside a sentence that is ABOUT the deletion. `docs/` carries
 * several of these on purpose -- "there is no `world` block in
 * `boardsmith.json`" is the sentence that stops an author looking for one --
 * and a gate that forbade them would force the docs to go silent about the
 * change instead of explaining it.
 */
const HISTORICAL = /\b(no longer|not any ?more|any ?more|used to|gone|deleted|removed|obsolete|the old)\b/i;

/**
 * The tighter form check 1 uses: a key is exempt only when the words JUST
 * BEFORE it negate it. A whole sentence is too much room -- "That scaffolds the
 * `world` block ... (never hand-copied)" is a wrong instruction whose sentence
 * happens to contain "never", and reading the sentence let it through.
 */
const NEGATED_JUST_BEFORE = /\b(no|not|never|no longer|used to|gone|deleted|removed|neither)\s*$/i;

/**
 * The sentence a match sits in, so the exemption is judged on its context. A
 * boundary is a full stop FOLLOWED BY WHITESPACE: `boardsmith.json` and `ctx.`
 * are not the ends of sentences, and cutting at them hid the "there is no" that
 * makes a mention historical.
 */
function sentenceAround(text: string, index: number): string {
  const boundary = /[.!?](\s|$)/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(boundary)) {
    if (match.index < index) start = match.index + match[0].length;
    else {
      end = match.index + 1;
      break;
    }
  }
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------
// CHECK 1 (DERIVED): a manifest key an author is told to write must exist.
// ---------------------------------------------------------------------------

const AUTHORABLE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(
    (JSON.parse(readSrc('src', 'cli', 'lib', 'boardsmith.schema.json')) as {
      properties: Record<string, unknown>;
    }).properties,
  ),
);

/**
 * "the `world` block ... in `boardsmith.json`" and its mirror. A key is being
 * NAMED AS AUTHORABLE when it is called a block/key/field/flag within a short
 * reach of the manifest's own name. That is narrow on purpose: it fires on the
 * shape a wrong instruction actually takes, and stays quiet on prose that
 * merely mentions a word.
 */
const KEY_CLAIM_PATTERNS: readonly { pattern: RegExp; key: number; gap: number }[] = [
  {
    pattern: /`(\w+)`\s*\*{0,2}(?:block|key|field|flag)\b([^.]{0,140}?)(?:`?boardsmith\.json`?|manifest)/gi,
    key: 1,
    gap: 2,
  },
  {
    pattern: /(?:`?boardsmith\.json`?|manifest(?:'s)?)([^.]{0,140}?)`(\w+)`\s*\*{0,2}(?:block|key|field|flag)\b/gi,
    key: 2,
    gap: 1,
  },
];

describe('#184 check 1: no engine string tells an author to write a manifest key the schema does not have', () => {
  it('derives the authorable key set from the schema it thinks it is reading', () => {
    expect(AUTHORABLE_KEYS.has('backend')).toBe(true);
    expect(AUTHORABLE_KEYS.has('world')).toBe(false);
    expect(AUTHORABLE_KEYS.has('bot')).toBe(false);
    expect(AUTHORABLE_KEYS.has('persistence')).toBe(false);
  });

  it.each(surfaces.map((surface) => [surface.where, surface] as const))(
    '%s',
    (_where, surface) => {
      const offences: string[] = [];
      for (const { pattern, key: keyGroup, gap: gapGroup } of KEY_CLAIM_PATTERNS) {
        for (const match of surface.text.matchAll(pattern)) {
          const key = match[keyGroup]!;
          if (AUTHORABLE_KEYS.has(key)) continue;
          // `gameDefinition.world` is a REAL block, and a refusal that names
          // the manifest and the gameDefinition in one breath is talking about
          // two different things. If the compiled rules are named between the
          // manifest and the key, the key is not being claimed as authorable.
          if (/gameDefinition/.test(match[gapGroup] ?? '')) continue;
          const keyAt = surface.text.indexOf(`\`${key}\``, match.index);
          const before = surface.text.slice(Math.max(0, keyAt - 40), keyAt).replace(/\s+/g, ' ');
          if (NEGATED_JUST_BEFORE.test(before)) continue;
          const sentence = sentenceAround(surface.text, match.index);
          offences.push(`\`${key}\` is not a boardsmith.json key: "${sentence.trim()}"`);
        }
      }
      expect(
        offences,
        `${surface.where} tells an author to edit a key boardsmith.schema.json does not declare. ` +
          'A boardsmith.json carrying it is refused by `boardsmith validate` with a did-you-mean, ' +
          'so following this sentence produces a project that will not build.',
      ).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// CHECK 2 (DERIVED): a composable member the scaffold names must exist.
// ---------------------------------------------------------------------------

/** Every member `useBoardInteraction()` actually hands back, read from the
 *  interface that types its return. */
const BOARD_INTERACTION_MEMBERS: ReadonlySet<string> = (() => {
  const source = readSrc('src', 'ui', 'composables', 'useBoardInteraction.ts');
  const block = /export interface BoardInteractionActions \{([\s\S]*?)\n\}/.exec(source);
  if (!block) throw new Error('BoardInteractionActions is not declared where the gate looks for it');
  return new Set([...block[1]!.matchAll(/^\s{2}(\w+)\s*[:(]/gm)].map((match) => match[1]!));
})();

/**
 * Check 2 runs over the SCAFFOLD ONLY. A prose page discusses the composable's
 * neighbours -- `tryUseBoardInteraction`, `injectActionController` -- within a
 * paragraph of it, and a proximity rule cannot tell "here is a related helper"
 * from "call this on the composable". The scaffold has no such paragraphs: it
 * names exactly what a new project should call, so proximity is enough there
 * and this is the surface where a wrong name actually reaches a new project.
 */
const scaffoldOnly = scaffoldSurfaces();

describe('#184 check 2: the scaffold never names a useBoardInteraction helper that does not exist', () => {
  it('reads the composable it thinks it is reading', () => {
    expect(BOARD_INTERACTION_MEMBERS.has('triggerElementSelect')).toBe(true);
    expect(BOARD_INTERACTION_MEMBERS.has('isSelectableElement')).toBe(true);
    expect(BOARD_INTERACTION_MEMBERS.has('boardRef')).toBe(false);
  });

  it.each(scaffoldOnly.map((surface) => [surface.where, surface] as const))(
    '%s',
    (_where, surface) => {
      const offences: string[] = [];
      // A call named within reach of `useBoardInteraction` is being attributed
      // to it. Nothing else in a scaffold names a bare `foo(` next to it.
      for (const anchor of surface.text.matchAll(/useBoardInteraction\(\)/g)) {
        const window = surface.text.slice(Math.max(0, anchor.index - 400), anchor.index + 400);
        // Only a name the prose QUOTES as an API is being attributed to the
        // composable, and the scaffold quotes an API in backticks. Reading the
        // quoted spans rather than the whole window keeps ordinary code in the
        // same file from being read as an instruction.
        for (const quoted of window.matchAll(/`([^`\n]{1,120})`/g)) {
          for (const call of quoted[1]!.matchAll(/\b([a-z][A-Za-z0-9]*)\(/g)) {
            const name = call[1]!;
            if (name === 'useBoardInteraction') continue;
            if (BOARD_INTERACTION_MEMBERS.has(name)) continue;
            offences.push(name);
          }
        }
      }
      expect(
        [...new Set(offences)],
        `${surface.where} tells an author to call a helper useBoardInteraction() does not return. ` +
          `Its element-facing members are: ${[...BOARD_INTERACTION_MEMBERS].join(', ')}.`,
      ).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// CHECK 3 (LIST): vocabulary that #169/#171 deleted, with what to say instead.
// ---------------------------------------------------------------------------

interface Retired {
  pattern: RegExp;
  why: string;
}

const RETIRED: readonly Retired[] = [
  {
    pattern: /gameDefinition\.maxPlayers/,
    why:
      "#171 made `WorldDefinition.maxPlayers` a world's one seat count, and " +
      '`capabilityContradictions` (src/session/capabilities.ts) REFUSES a world whose ' +
      'gameDefinition carries minPlayers or maxPlayers. Say `gameDefinition.world.maxPlayers` ' +
      'when the subject is a world.',
  },
  {
    pattern: /`bot`\s*(?:is|:)\s*true|`bot: true`|\bbot: true\b/,
    why:
      '#171 deleted `bot` from boardsmith.json. Whether a bundle ships a bot is derived at build ' +
      'from the compiled `gameDefinition.bot` and reaches the platform as `capabilities.bots`, so ' +
      'an author cannot write `bot: true` and no sentence may ask them to.',
  },
  {
    pattern: /`persistence`\s*(?:block|key|field|flag)|"persistence":/,
    why:
      '#171 deleted `persistence` from boardsmith.json. It is derived from the compiled ' +
      '`gameDefinition.persistence` and reaches the platform as `capabilities.crossSessionState`.',
  },
  {
    pattern: /`?clockOnly`?\s*:?\s*(?:true)?/,
    why:
      "#169 replaced the `clockOnly` boolean with a TYPE: a clock's own verb is built with " +
      '`worldClockAction()`, which declares no selections and has no player. Name the builder.',
  },
  {
    pattern: /`?world\.commands`?|`?world\.ui`?/,
    why:
      '#169 deleted the flat command table (`world.commands`) in favour of `world.actions`, and ' +
      '#170 deleted the `world.ui` manifest flag -- `boardsmith build` always emits a world entry.',
  },
  {
    pattern: /WorldCommand(Handler|Context|Argument|Offer|Table|Choice)/,
    why:
      "#169 deleted these types. A world's verbs are `ActionDefinition`s built with " +
      '`worldAction()` / `worldClockAction()`, imported from `boardsmith/world`.',
  },
];

describe('#184 check 3: no engine string still uses vocabulary #169/#171 retired', () => {
  const cases = surfaces.flatMap((surface) =>
    RETIRED.map((retired) => [`${surface.where} :: ${retired.pattern}`, surface, retired] as const),
  );

  it.each(cases)('%s', (_name, surface, retired) => {
    const global = new RegExp(retired.pattern.source, `${retired.pattern.flags}g`);
    const offences = [...surface.text.matchAll(global)]
      .map((match) => sentenceAround(surface.text, match.index).trim())
      .filter((sentence) => !HISTORICAL.test(sentence));
    expect(offences, `${surface.where}: ${retired.why}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CHECK 4 (DERIVED): a boardsmith.json a doc shows is one validate accepts.
// ---------------------------------------------------------------------------

/**
 * The sample an author copies. `getting-started.md` shipped one with no
 * `backend` for as long as `backend` has been required (#171), so the page's
 * own "Understanding the Generated Code" section described a project
 * `boardsmith validate` refuses.
 *
 * A sample qualifies as a manifest by carrying `displayName`, which nothing
 * else in these docs is a whole JSON object about. Fragments -- a single key
 * shown for where to add it -- do not parse as objects and are skipped, which
 * is the one thing this check cannot see.
 */
const REQUIRED_KEYS: readonly string[] = (
  JSON.parse(readSrc('src', 'cli', 'lib', 'boardsmith.schema.json')) as { required: string[] }
).required;

describe('#184 check 4: every boardsmith.json a doc prints is one `boardsmith validate` accepts', () => {
  const samples = docSurfaces().flatMap((doc) =>
    [...doc.text.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((block, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(block[1]!);
      } catch {
        return [];
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      if (!('displayName' in parsed)) return [];
      return [[`${doc.where} sample ${index}`, parsed as Record<string, unknown>] as const];
    }),
  );

  it('found the samples it thinks it is checking', () => {
    expect(samples.length).toBeGreaterThan(0);
    expect(REQUIRED_KEYS).toContain('backend');
  });

  it.each(samples)('%s declares every required key and no unknown one', (_where, sample) => {
    const missing = REQUIRED_KEYS.filter((key) => !(key in sample));
    const unknown = Object.keys(sample).filter((key) => !AUTHORABLE_KEYS.has(key));
    expect(
      { missing, unknown },
      'A doc\'s manifest sample is copied verbatim into a new project. A missing required key ' +
        'or a key the schema does not declare is refused by `boardsmith validate`, so the page ' +
        'hands an author a project that will not build.',
    ).toEqual({ missing: [], unknown: [] });
  });
});
