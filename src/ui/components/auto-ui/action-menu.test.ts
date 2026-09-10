/**
 * THE MENU IS DERIVED, AND IT IS NOT A GAME COMMAND (#228).
 *
 * A hierarchy of start buttons is arrangement, not rules. Everything in this
 * file is a pure function over the action metadata the panel was already
 * handed: nothing here can reach a controller, a socket or a game, which is
 * why "opening a menu cannot submit an order" is a fact about the types rather
 * than a behaviour somebody watched once.
 *
 * The two shapes that carry that guarantee:
 *
 *  - A GROUP NODE HAS NO ACTION NAME. `ActionMenuGroup` carries a label, a path
 *    and children; there is no field on it a `startAction(name)` call could be
 *    fed. Only `ActionMenuLeaf` carries the metadata, so the panel's group
 *    handler is incapable of naming an action even by mistake.
 *  - THE OPEN PATH IS RESOLVED, NEVER TRUSTED. `resolveMenuPath` answers with
 *    the longest prefix of a requested path that still exists, so a group that
 *    empties while somebody is standing in it lands them on its surviving
 *    parent rather than in a level that is no longer there.
 */
import { describe, it, expect } from 'vitest';
import {
  buildActionMenu,
  resolveMenuPath,
  menuLevelAt,
  type ActionMenuGroup,
  type ActionMenuNode,
  type MenuAction,
} from './action-menu.js';

/** The subset of action metadata the menu model reads. */
function action(name: string, placement?: { group?: string[]; order?: number }): MenuAction {
  return { name, ...placement };
}

/** A level, read as text: a group in brackets, an action by its name. */
const labels = (nodes: readonly ActionMenuNode<MenuAction>[]): string[] =>
  nodes.map((node) => (node.kind === 'group' ? `[${node.label}]` : node.action.name));

describe('buildActionMenu', () => {
  it('leaves an ungrouped list flat and in the order it was given', () => {
    const menu = buildActionMenu([action('build'), action('upgrade'), action('rename')]);
    expect(labels(menu)).toEqual(['build', 'upgrade', 'rename']);
    expect(menu.every((node) => node.kind === 'action')).toBe(true);
  });

  it('collapses every member of a group into ONE node at the parent level', () => {
    const menu = buildActionMenu([
      action('build'),
      action('dumpOre', { group: ['Dump'] }),
      action('dumpWater', { group: ['Dump'] }),
      action('dumpFood', { group: ['Dump'] }),
    ]);

    expect(labels(menu)).toEqual(['build', '[Dump]']);
    const dump = menu[1] as ActionMenuGroup<MenuAction>;
    expect(labels(dump.children)).toEqual(['dumpOre', 'dumpWater', 'dumpFood']);
    expect(dump.path).toEqual(['Dump']);
  });

  it('creates the intermediate groups a nested path names', () => {
    const menu = buildActionMenu([
      action('renamePlanet', { group: ['More', 'Empire settings'] }),
      action('describeEmpire', { group: ['More', 'Empire settings'] }),
      action('skipMission', { group: ['More'] }),
    ]);

    expect(labels(menu)).toEqual(['[More]']);
    const more = menu[0] as ActionMenuGroup<MenuAction>;
    // `Empire settings` first because `renamePlanet` named it before
    // `skipMission` arrived: with no declared order, arrival decides.
    expect(labels(more.children)).toEqual(['[Empire settings]', 'skipMission']);
    const settings = more.children[0] as ActionMenuGroup<MenuAction>;
    expect(settings.path).toEqual(['More', 'Empire settings']);
    expect(labels(settings.children)).toEqual(['renamePlanet', 'describeEmpire']);
  });

  it('has no way to name an action on a group node', () => {
    const menu = buildActionMenu([action('dumpOre', { group: ['Dump'] })]);
    const group = menu[0] as ActionMenuGroup<MenuAction>;
    expect(Object.keys(group).sort()).toEqual(['children', 'kind', 'label', 'path']);
  });

  it('sorts by declared order, and an undeclared order sorts as zero and keeps its place', () => {
    const menu = buildActionMenu([
      action('late', { order: 10 }),
      action('undeclaredA'),
      action('early', { order: -5 }),
      action('undeclaredB'),
    ]);
    expect(labels(menu)).toEqual(['early', 'undeclaredA', 'undeclaredB', 'late']);
  });

  it('sorts a group where its most important member sits', () => {
    const menu = buildActionMenu([
      action('rename', { group: ['More'], order: 50 }),
      action('build', { order: 10 }),
      action('dumpOre', { group: ['Dump'], order: 20 }),
      action('upgrade', { order: 30 }),
    ]);
    expect(labels(menu)).toEqual(['build', '[Dump]', 'upgrade', '[More]']);
  });

  it('sorts inside a group by its members own order', () => {
    const menu = buildActionMenu([
      action('dumpWater', { group: ['Dump'], order: 2 }),
      action('dumpOre', { group: ['Dump'], order: 1 }),
    ]);
    const dump = menu[0] as ActionMenuGroup<MenuAction>;
    expect(labels(menu)).toEqual(['[Dump]']);
    expect(labels(dump.children)).toEqual(['dumpOre', 'dumpWater']);
  });

  it('cannot produce an empty group, because only the actions it was given build one', () => {
    // The panel hands this function the AVAILABLE actions only, so a group
    // whose every member went away is a group nothing names -- it is absent by
    // construction rather than pruned by a rule that could be forgotten.
    const menu = buildActionMenu([action('build')]);
    expect(labels(menu)).toEqual(['build']);
    expect(menu.some((node) => node.kind === 'group')).toBe(false);
  });

  it('keeps the hierarchy when no ungrouped action is available at all', () => {
    const menu = buildActionMenu([
      action('dumpOre', { group: ['Dump'] }),
      action('rename', { group: ['More', 'Empire settings'] }),
    ]);
    expect(labels(menu)).toEqual(['[Dump]', '[More]']);
  });
});

describe('resolveMenuPath', () => {
  const menu = buildActionMenu([
    action('build'),
    action('dumpOre', { group: ['Dump'] }),
    action('rename', { group: ['More', 'Empire settings'] }),
  ]);

  it('answers the root for an empty request', () => {
    expect(resolveMenuPath(menu, [])).toEqual([]);
  });

  it('answers a path that exists verbatim', () => {
    expect(resolveMenuPath(menu, ['More', 'Empire settings'])).toEqual(['More', 'Empire settings']);
  });

  it('truncates to the deepest surviving ancestor when a level has gone', () => {
    const emptied = buildActionMenu([action('skipMission', { group: ['More'] })]);
    expect(resolveMenuPath(emptied, ['More', 'Empire settings'])).toEqual(['More']);
  });

  it('lands on the root when the whole branch has gone', () => {
    expect(resolveMenuPath(buildActionMenu([action('build')]), ['More', 'Empire settings'])).toEqual([]);
  });

  it('refuses to treat a leaf as a level', () => {
    expect(resolveMenuPath(menu, ['build'])).toEqual([]);
  });
});

describe('menuLevelAt', () => {
  const menu = buildActionMenu([
    action('build'),
    action('dumpOre', { group: ['Dump'] }),
    action('rename', { group: ['More', 'Empire settings'] }),
  ]);

  it('answers the root level with no group', () => {
    const level = menuLevelAt(menu, []);
    expect(level.group).toBeNull();
    expect(labels(level.nodes)).toEqual(['build', '[Dump]', '[More]']);
  });

  it('answers a nested level with the group it belongs to', () => {
    const level = menuLevelAt(menu, ['More', 'Empire settings']);
    expect(level.group?.label).toBe('Empire settings');
    expect(labels(level.nodes)).toEqual(['rename']);
  });

  it('answers the root for a path that no longer exists', () => {
    const level = menuLevelAt(menu, ['Nowhere']);
    expect(level.group).toBeNull();
    expect(labels(level.nodes)).toEqual(['build', '[Dump]', '[More]']);
  });
});
