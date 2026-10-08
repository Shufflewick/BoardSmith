/**
 * EVERY PUBLIC COMPONENT PROP WORKS HOWEVER A TEMPLATE WRITES IT (#433).
 *
 * Vue templates take props in camelCase or in kebab-case, and Vue finds the
 * prop by camelizing whatever the template wrote. A name whose kebab form does
 * not camelize back to itself cannot be written in kebab-case at all: GameShell's
 * `providesOwnGameOverUI` was written `provides-own-game-over-ui`, which
 * camelizes to `providesOwnGameOverUi`, matched no prop, fell through to the
 * shell's root element as a plain attribute, and nothing warned. A trailing run
 * of capitals (an acronym such as `UI` or `ID`) is the usual way in.
 *
 * So every prop of every component a game can import from `boardsmith/ui`,
 * `boardsmith/ui/auto-ui` or `boardsmith/ui/dice` must survive the round trip.
 */
import { describe, it, expect } from 'vitest';
import { camelize } from 'vue';
import * as ui from './index.js';
import * as autoUi from './components/auto-ui/index.js';
import * as dice from './components/dice/index.js';

/**
 * The kebab form of a camelCase name as a template author writes it: one
 * hyphen between words, an acronym kept whole (`providesOwnGameOverUI` is
 * written `provides-own-game-over-ui`).
 *
 * This is NOT Vue's own `hyphenate` (@vue/shared), which puts a hyphen before
 * every capital and so turns `UI` into `u-i`. That form does camelize back to
 * `UI`, which is why checking against it would pass the very prop #433 is
 * about: nobody writes `provides-own-game-over-u-i`.
 */
function authorKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

type ComponentLike = { props?: string[] | Record<string, unknown>; __asyncLoader?: () => Promise<unknown> };

function isComponent(value: unknown): value is ComponentLike {
  if (typeof value !== 'object' || value === null) return false;
  return 'setup' in value || 'render' in value || '__asyncLoader' in value;
}

/**
 * An async component (Die3D) declares its props on the component it loads, so
 * load it the way Vue does before reading them.
 */
async function resolved(component: ComponentLike): Promise<ComponentLike> {
  if (!component.__asyncLoader) return component;
  const loaded = (await component.__asyncLoader()) as ComponentLike | { default: ComponentLike };
  return 'default' in loaded ? loaded.default : loaded;
}

function propNames(component: ComponentLike): string[] {
  const { props } = component;
  if (!props) return [];
  return Array.isArray(props) ? props : Object.keys(props);
}

const entries: Record<string, Record<string, unknown>> = {
  'boardsmith/ui': ui,
  'boardsmith/ui/auto-ui': autoUi,
  'boardsmith/ui/dice': dice,
};

const publicComponents: Array<{ where: string; component: ComponentLike }> = [];
for (const [entry, exports] of Object.entries(entries)) {
  for (const [exportName, value] of Object.entries(exports)) {
    if (!isComponent(value)) continue;
    publicComponents.push({ where: `${exportName} from '${entry}'`, component: await resolved(value) });
  }
}

describe('public component prop names (#433)', () => {
  it('finds the components games import, so the check below is not vacuous', () => {
    const found = publicComponents.map(({ where }) => where);
    expect(found).toContain("GameShell from 'boardsmith/ui'");
    expect(found).toContain("AutoUI from 'boardsmith/ui/auto-ui'");
    expect(found).toContain("Die3D from 'boardsmith/ui/dice'");
    const gameShell = publicComponents.find(({ where }) => where === "GameShell from 'boardsmith/ui'");
    expect(propNames(gameShell!.component)).toContain('uis');
    const die3d = publicComponents.find(({ where }) => where === "Die3D from 'boardsmith/ui/dice'");
    expect(propNames(die3d!.component).length).toBeGreaterThan(0);
  });

  it('every prop camelizes back to itself from its kebab-case form', () => {
    const broken: string[] = [];
    for (const { where, component } of publicComponents) {
      for (const name of propNames(component)) {
        const kebab = authorKebab(name);
        const found = camelize(kebab);
        if (found !== name) {
          broken.push(
            `${where}: prop "${name}" written as "${kebab}" in a template reaches Vue as "${found}", ` +
              `which is not a prop. Rename it so its kebab form camelizes back (e.g. "${found}").`,
          );
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('writes a name the way a template author does, acronyms whole', () => {
    expect(authorKebab('gameType')).toBe('game-type');
    expect(authorKebab('providesOwnGameOverUI')).toBe('provides-own-game-over-ui');
    expect(authorKebab('parseURLValue')).toBe('parse-url-value');
    expect(authorKebab('player2Seat')).toBe('player2-seat');
  });
});
