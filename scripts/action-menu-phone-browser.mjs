#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A MENU LEVEL IN THE ACTION BAR ON A PHONE (#1627).
 *
 * Example Legacy offers three actions with sentence-long prompts. At 390x844
 * only the first showed: the bar was capped at two rows and the other two sat
 * below a scroll inside it with nothing showing they were there, and at 844x390
 * the same happened on a second row. A menu level now lays its buttons out in
 * three columns at phone width and may take four rows there (two on a short
 * landscape screen), so a whole level is in view, and the board's scroll room
 * covers the taller bar. jsdom lays nothing out, so only a real browser can see
 * which buttons are on screen. A sentence-long label takes four or five lines
 * at 360px, so a level's rows are taller than a control row there (#1627
 * review F5), and a landscape phone narrower than 640px lays a level out as the
 * short-landscape tier does, not as the upright phone's grid (review F3).
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/action-menu-phone-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import {
  assert,
  barGeometry,
  check,
  onEachPhone,
  onFreshPage,
  runBrowserRegression,
  summarise,
  surfaceOf,
  waitForAction,
} from './browser-harness.mjs';

/** Example Legacy's three verbs at the top, Example MUD's four in a group, a level of seven and one of five short ones. */
const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Camp extends Space<Caravan> {}

export class Caravan extends Game<Caravan, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Camp]);
  }
}

const FIELD = 'field';

const verb = (name: string, prompt: string, ...group: string[]) => {
  const action = worldAction<Caravan>(name).prompt(prompt);
  return (group.length > 0 ? action.group(...group) : action)
    .needs(() => [FIELD])
    .execute((_args, ctx) => ctx.world.emit(FIELD, { done: name }, prompt));
};

export const gameDefinition: GameDefinition = {
  gameClass: Caravan,
  gameType: 'action-menu-phone-caravan',
  displayName: 'Action Menu Phone Caravan',
  world: {
    maxPlayers: 2,
    genesis: (game) => ({ [FIELD]: (game as Caravan).create(Camp, 'camp') as GameElement }),
    view: () => [FIELD],
    actions: [
      verb('haul', 'Put your shoulder to the wagon and move it on'),
      verb('forage', 'Work the reed beds for stores the caravan can eat'),
      verb('mend', 'Take wear off the wagon before it stops moving at all'),
      verb('look', 'Look around the room you are standing in', 'Wander'),
      verb('walk', 'Walk into another room', 'Wander'),
      verb('say', 'Say something to whoever is in the room with you', 'Wander'),
      verb('note', 'Leave a note for another wanderer', 'Wander'),
      verb('sing', 'Sing by the fire', 'Camp'),
      verb('rest', 'Rest the oxen', 'Camp'),
      verb('cook', 'Cook the evening meal', 'Camp'),
      verb('fish', 'Fish the river', 'Camp'),
      verb('pray', 'Pray for fair weather', 'Camp'),
      verb('sleep', 'Sleep until dawn', 'Camp'),
      verb('scout', 'Scout the next ford', 'Camp'),
      ...['Buy salt', 'Sell hides', 'Barter', 'Haggle', 'Give a gift'].map((prompt, i) => verb('trade' + i, prompt, 'Trade')),
    ],
  },
};
`;

/** A board taller than any phone, with a mark at its foot that must scroll clear of the bar. */
const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'CaravanBoard',
  props: { gameView: { type: Object, default: null } },
  setup: () => () => h('div', { class: 'caravan-board', style: 'height: 1600px; width: 300px; position: relative' }, [
    h('div', { class: 'board-foot', style: 'position: absolute; bottom: 0; height: 20px; width: 100%' }, 'The road ends'),
  ]),
});
`;

const TOP = ['haul', 'forage', 'mend'].map((name) => `[data-bs-action="${name}"]`)
  .concat(['Wander', 'Camp', 'Trade'].map((group) => `[data-bs-action-group="${group}"]`));
const WANDER = ['[data-bs-menu-back]', ...['look', 'walk', 'say', 'note'].map((name) => `[data-bs-action="${name}"]`)];
const CAMP = ['[data-bs-menu-back]', ...['sing', 'rest', 'cook', 'fish', 'pray', 'sleep', 'scout'].map((name) => `[data-bs-action="${name}"]`)];
const TRADE = ['[data-bs-menu-back]', ...[0, 1, 2, 3, 4].map((i) => `[data-bs-action="trade${i}"]`)];
const LEVELS = {
  top: ['the top level', TOP],
  wander: ['the Wander level', WANDER, 'Wander'],
  camp: ['the seven-action Camp level', CAMP, 'Camp'],
  trade: ['the five-action Trade level', TRADE, 'Trade'],
};

await runBrowserRegression(
  {
    script: 'action-menu-phone-browser.mjs',
    engines: ['chromium', 'webkit'],
    fixture: {
      slug: 'action-menu-phone',
      displayName: 'Action Menu Phone',
      gameClass: 'Caravan',
      rules: RULES,
      boardFile: 'CaravanBoard',
      board: BOARD,
    },
  },
  driveThrough,
);

async function driveThrough({ launch, hostUrl }) {
  const browser = await launch();
  try {
    const ready = (page) => waitForAction(page, 'haul');
    const all = Object.values(LEVELS);
    const player = await onEachPhone(browser, hostUrl, ready, (page, size) => everyLevelInView(surfaceOf(page), size, all));
    // An upright phone narrower than 390px, and a landscape one narrower than the grid's 640px (iPhone SE).
    for (const [viewport, levels] of [[{ width: 360, height: 740 }, all], [{ width: 568, height: 320 }, [LEVELS.trade]]]) {
      const phone = { viewport, hasTouch: true, isMobile: true, reducedMotion: 'reduce', storageState: player };
      await onFreshPage(browser, hostUrl, phone, ready, (page) => everyLevelInView(surfaceOf(page), `${viewport.width}x${viewport.height}`, levels));
    }
    await onFreshPage(browser, hostUrl, { viewport: { width: 1440, height: 900 } }, ready, async (_page, surface) => {
      await check('1440x900: the top level stays inside the two-row strip', async () => {
        const bar = await barGeometry(surface, TOP);
        assert(bar.outside.length === 0, `not in view inside the bar: ${bar.outside.join(', ')}`);
        assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}`);
      });
    });
  } finally {
    await browser.close();
  }
  return summarise('for a menu level in the Action Panel on a phone');
}

async function everyLevelInView(surface, size, levels) {
  for (const [name, selectors, group] of levels) {
    await check(`${size}: every button of ${name} is in view without scrolling, its labels whole`, async () => {
      if (group) await surface.locator(`[data-bs-action-group="${group}"]`).click();
      try {
        for (const selector of selectors) await surface.locator(selector).waitFor({ timeout: 15_000 });
        const bar = await barGeometry(surface, selectors);
        assert(bar.outside.length === 0, `not in view inside the bar (${bar.height}px tall, top at ${bar.top}): ${bar.outside.join(', ')}`);
        assert(!bar.scrolls, `the bar scrolls (${bar.height}px tall), so part of the level sits below its edge`);
        const cut = await surface.locator('[data-testid="bs-actionbar"]').evaluate((root, wanted) =>
          wanted.filter((selector) => {
            const el = root.querySelector(selector);
            return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
          }), selectors);
        assert(cut.length === 0, `labels cut short: ${cut.join(', ')}`);
      } finally {
        if (group) await surface.locator('[data-bs-menu-back]').click();
      }
    });
  }

  await check(`${size}: the foot of the board scrolls clear of the bar the top level grew`, async () => {
    const gap = await surface.locator('.boardregion').evaluate((region) => {
      region.scrollTop = region.scrollHeight;
      const foot = region.querySelector('.board-foot').getBoundingClientRect();
      const bar = document.querySelector('[data-testid="bs-actionbar"]').getBoundingClientRect();
      return { foot: Math.round(foot.bottom), bar: Math.round(bar.top) };
    });
    assert(gap.foot <= gap.bar + 1, `the board's foot ends at ${gap.foot}, under the bar's top at ${gap.bar}`);
  });
}
