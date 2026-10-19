#!/usr/bin/env node
/**
 * THE PHONE LOG DRAWER OPENS ON ITS NEWEST LINE (#1122).
 *
 * At a phone width the log lives in a drawer that is `display: none` until the
 * player opens it. Lines that arrive while it is shut are drawn into a box with
 * no layout, so the log's scroll-to-newest does nothing, and the drawer opened
 * on the oldest line. Only real layout shows that, so it is measured here.
 *
 * A world whose one verb narrates many lines, played with the drawer shut. Then
 * the drawer is opened at 390px, light and dark, and the newest line must be
 * inside the log's box, the drawer's box and the viewport. At 1440px, where the
 * log is always shown, the same must hold, and the log's screen-reader status
 * line (the shared `sr-only.css`, #1183) must take no space.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/log-drawer-scroll-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, onFreshPage, runBrowserRegression, summarise, waitForAction, waitUntil } from './browser-harness.mjs';

/** Enough lines to overflow the log and the drawer several times over. */
const LINES = 40;

const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Room extends Space<Tavern> {}

export class Tavern extends Game<Tavern, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

const ROOM = 'room';

const chatter = worldAction<Tavern>('chatter')
  .prompt('Chatter')
  .needs(() => [ROOM])
  .execute((_args, ctx) => {
    for (let i = 1; i <= ${LINES}; i++) ctx.world.emit(ROOM, { line: i }, \`Line \${i} of the chatter.\`);
  });

export const gameDefinition: GameDefinition = {
  gameClass: Tavern,
  gameType: 'log-drawer-tavern',
  displayName: 'Log Drawer Tavern',
  world: {
    maxPlayers: 2,
    genesis: (game) => ({ [ROOM]: (game as Tavern).create(Room, 'room') as GameElement }),
    view: () => [ROOM],
    actions: [chatter],
  },
};
`;

const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'TavernBoard',
  setup() {
    return () => h('div', { class: 'tavern-board' }, 'the tavern');
  },
});
`;

/** Where the newest log line sits against the log, the drawer around it and the viewport. */
function newestLine(surface) {
  return surface.locator('[data-testid="bs-log"] .messages-container').evaluate((log) => {
    const lines = log.querySelectorAll('[data-testid="bs-log-line"]');
    const last = lines[lines.length - 1];
    if (!last) return { lines: 0, text: null, hidden: [] };
    const line = last.getBoundingClientRect();
    const inside = (box) => line.top >= box.top - 1 && line.bottom <= box.bottom + 1;
    const hidden = [];
    if (!inside(log.getBoundingClientRect())) hidden.push('the log');
    if (!inside(log.closest('.side-scroll').getBoundingClientRect())) hidden.push('the drawer');
    if (!inside({ top: 0, bottom: window.innerHeight })) hidden.push('the viewport');
    return { lines: lines.length, text: last.textContent, hidden };
  });
}

/** The phone is short enough that the players panel and the log overflow the drawer, which must scroll too. */
const SCENES = [
  { width: 390, height: 600, colorScheme: 'light' },
  { width: 390, height: 600, colorScheme: 'dark' },
  { width: 1440, height: 900, colorScheme: 'light' },
];

await runBrowserRegression(
  {
    script: 'log-drawer-scroll-browser.mjs',
    fixture: {
      slug: 'log-drawer-tavern',
      displayName: 'Log Drawer Tavern',
      gameClass: 'Tavern',
      rules: RULES,
      boardFile: 'TavernBoard',
      board: BOARD,
    },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      for (const { width, height, colorScheme } of SCENES) {
        const viewport = { width, height };
        await onFreshPage(browser, hostUrl, { viewport, colorScheme }, (page) => waitForAction(page, 'chatter'), async (page, surface) => {
          const before = await surface.locator('[data-testid="bs-log-line"]').count();
          await surface.locator('[data-bs-action="chatter"]').click();
          await waitUntil(() => surface.locator('[data-testid="bs-log-line"]').count(), (n) => n >= before + LINES);
          const phone = width < 640;
          if (phone) await surface.locator('.mobile-strip__toggle').click();
          const seen = await newestLine(surface);
          await check(`the newest log line is in view ${phone ? 'after opening the drawer' : 'in the sidebar'} at ${width}px ${colorScheme}`, async () => {
            assert(seen.text?.includes(`Line ${LINES} of the chatter.`), `the last log line read ${JSON.stringify(seen.text)}`);
            assert(seen.hidden.length === 0, `the newest line is outside ${seen.hidden.join(' and ')}`);
          });
          if (!phone) {
            await check(`the log's screen-reader status is in the page but takes no space at ${width}px`, async () => {
              const status = surface.locator('[data-testid="bs-log"] .sr-only[role="status"]');
              // Copying gives the status words to announce; an empty span would take no space anyway.
              await surface.locator('[data-testid="bs-log"] .history-copy').click();
              // Text and box in one read, so the status's 2-second reset cannot fall between them.
              const { text, box } = await waitUntil(
                () => status.evaluate((el) => {
                  const { width, height } = el.getBoundingClientRect();
                  return { text: el.textContent.trim(), box: { width, height } };
                }),
                (seen) => seen.text !== '',
              );
              assert(text !== '', 'copying the log never set its screen-reader status, so there was nothing to measure; check that the copy button still announces through the sr-only status');
              assert(box.width <= 1 && box.height <= 1, `the log's screen-reader status "${text}" took ${JSON.stringify(box)}`);
            });
          }
        });
      }
    } finally {
      await browser.close();
    }
    return summarise('in the log drawer in a real browser');
  },
);
