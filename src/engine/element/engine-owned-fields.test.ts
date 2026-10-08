/**
 * #346: a Game subclass must not declare a field the engine owns.
 *
 * `Game.pile` is the engine's container for removed elements and is never
 * serialized; the engine re-creates it in its own constructor. A game that
 * named one of its zones `pile` type-checked, worked in a fresh game, and was
 * silently pointed back at a discarded copy after every restore (session op,
 * undo, bot search), so the game played on two boards at once. These tests
 * hold that the engine now refuses such a game when it is constructed, by
 * name, and that the list the refusal (and the lint rule) reads is the engine's
 * real field set rather than a hand-kept guess.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game, GAME_ROOT_FIELD_AUDIENCE, constructGame, type GameOptions } from './game.js';
import type { TutorialProgress } from '../tutorial/types.js';
import { Space } from './space.js';
import { ENGINE_OWNED_GAME_FIELDS, describeEngineFieldShadow } from './engine-owned-fields.js';
import { TestGame } from '../../testing/test-game.js';
import { Action } from '../action/index.js';
import { defineFlow, actionStep } from '../flow/index.js';

class Zone extends Space {}

class ShadowsPileGame extends Game<ShadowsPileGame> {
  // The shape from the issue: a game zone that happens to be called `pile`.
  // `declare` is what TypeScript's own redeclaration error (TS2612) tells an
  // author to write, and it compiles to nothing, so only the assignment below
  // replaces the engine's value.
  declare pile: Zone;
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Zone]);
    this.pile = this.create(Zone, 'pile');
  }
}

class InitializesTutorialProgressGame extends Game<InitializesTutorialProgressGame> {
  // A field initializer: TypeScript accepts an overwrite that has one.
  tutorialProgress: Map<number, TutorialProgress> = new Map();
}

class ReplacesSettingsGame extends Game<ReplacesSettingsGame> {
  constructor(options: GameOptions) {
    super(options);
    this.settings = { variant: 'short' };
  }
}

/** A game that uses every engine API a constructor normally calls. */
class WellBehavedGame extends Game<WellBehavedGame> {
  discardPile!: Zone;
  scores = this.persistentMap<string, number>('scores');
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Zone]);
    this.discardPile = this.create(Zone, 'discardPile');
    this.message('Setting up');
    this.settings.variant = 'standard';
    this.registerActions(Action.create('pass').execute(() => {}));
    this.setFlow(defineFlow({ root: actionStep({ actions: ['pass'] }) }));
  }
}

describe('ENGINE_OWNED_GAME_FIELDS (#346)', () => {
  it('names exactly the engine fields a bare Game carries, less the layout fields a game may set', () => {
    const bare = new Game({ playerCount: 2 });
    const authorSettable = Object.keys(GAME_ROOT_FIELD_AUDIENCE).filter(
      (key) => GAME_ROOT_FIELD_AUDIENCE[key] === 'public',
    );
    const engineKeys = Object.keys(bare).filter((key) => !authorSettable.includes(key));
    expect(Object.keys(ENGINE_OWNED_GAME_FIELDS).sort()).toEqual(engineKeys.sort());
  });

  it('includes every field Game declares unserializable', () => {
    for (const name of Game.unserializableAttributes) {
      expect(Object.keys(ENGINE_OWNED_GAME_FIELDS), name).toContain(name);
    }
  });
});

describe('constructGame refuses a subclass that shadows an engine field (#346)', () => {
  it('refuses a zone named `pile`, naming the class and the field and suggesting a rename', () => {
    expect(() => constructGame(ShadowsPileGame, { playerCount: 2 })).toThrow(
      describeEngineFieldShadow('ShadowsPileGame', 'pile'),
    );
  });

  it('says what goes wrong and how to fix it', () => {
    const message = describeEngineFieldShadow('ShadowsPileGame', 'pile');
    expect(message).toContain('ShadowsPileGame');
    expect(message).toContain('"pile"');
    expect(message).toContain('restore');
    expect(message).toMatch(/Rename/);
    expect(message).toContain('"myPile"');
  });

  it('refuses a field initializer for `tutorialProgress`', () => {
    expect(() => constructGame(InitializesTutorialProgressGame, { playerCount: 2 })).toThrow('"tutorialProgress"');
  });

  it('refuses an assignment to `settings`', () => {
    expect(() => constructGame(ReplacesSettingsGame, { playerCount: 2 })).toThrow('"settings"');
  });

  it('constructs a game that only uses the engine APIs a constructor calls', () => {
    const game = constructGame(WellBehavedGame, { playerCount: 2 });
    expect(game).toBeInstanceOf(WellBehavedGame);
    expect(game.discardPile.name).toBe('discardPile');
  });
});

describe('every hosted path refuses the shadow (#346)', () => {
  it('TestGame (and so GameRunner) refuses it before the game can be played', () => {
    expect(() => TestGame.create(ShadowsPileGame, { playerCount: 2 })).toThrow('"pile"');
  });
});

describe('the engine builds every game through constructGame (#346)', () => {
  // The refusal runs after the subclass constructor returns, so it only exists
  // where the engine constructs a game. A new construction site written as a
  // bare `new GameClass(...)` would build a shadowing game in silence again.
  it('has exactly one `new ...GameClass(...)`, the one inside constructGame', () => {
    const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') visit(full);
          continue;
        }
        if (!/\.(ts|vue)$/.test(entry.name) || /\.test(-helper)?\.ts$/.test(entry.name)) continue;
        readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line)) return;
          // Not preceded by a backtick: an error message may quote the call.
          if (/(?<!`)\bnew\s+[\w.]*\b[Gg]ameClass\s*\(/.test(line)) {
            offenders.push(`${relative(srcRoot, full)}:${i + 1}`);
          }
        });
      }
    };
    visit(srcRoot);
    // The one allowed site is constructGame's own body.
    expect(offenders.map((site) => site.replace(/:\d+$/, ''))).toEqual(['engine/element/game.ts']);
  });
});
