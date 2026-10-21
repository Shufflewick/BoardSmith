#!/usr/bin/env node
/**
 * WHERE THE HINT AND TUTORIAL BUBBLE LANDS ON SCREEN (#1318).
 *
 * `AnnotationLayer.vue` keeps a bubble 8px inside its layer with a CSS clamp
 * of the bubble's own width (`--bsg-bubble-shift`), and its caret undoes that
 * shift to keep pointing at the target (#907, #1180, #1300). jsdom has no
 * layout, so `HintOverlay.test.ts` can only compare the CSS strings; this
 * measures where the bubble and caret really land.
 *
 * Served from `boardsmith init`'s table sample with a tutorial whose one step
 * points at three targets the board pins to the left edge, the right edge and
 * the bottom of the screen. Seat 1 starts the tutorial from the controls menu,
 * at 1440px and 390px. Each bubble must also be the topmost thing at its
 * corners and middle, so the action bar cannot draw over it (#1341).
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/annotation-bubble-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, playTableSampleToTheEnd, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const EDGE_MARGIN = 8;

/** Long enough that the bubble is far wider than the room beside an edge target. */
const TEXT = 'This bubble is long enough to need shifting back inside the screen, so its caret must move to keep pointing here.';

const TARGETS = [
  { name: 'edge-left', side: 'the left edge', caret: 'top' },
  { name: 'edge-right', side: 'the right edge', caret: 'top' },
  { name: 'edge-bottom', side: 'the bottom', caret: 'bottom' },
];

/** Not on the board until the regression opens a game modal holding it (#1346). */
const MODAL_ANNOTATION = { text: 'Inside the modal.', target: { kind: 'element', ref: { name: 'in-modal' } } };

const RULES = `export { TableFixtureGame, TableFixturePlayer } from './game.js';
export * from './elements.js';
export * from './actions.js';
export { createGameFlow } from './flow.js';

import { TableFixtureGame } from './game.js';

export const gameDefinition = {
  gameClass: TableFixtureGame,
  gameType: 'table-fixture',
  displayName: 'Table Fixture',
  minPlayers: 2,
  maxPlayers: 4,
  tutorial: {
    learnerSeat: 1,
    steps: [{
      id: 'edges',
      // Every move passes, and the step never advances, so the game can be played to its end under it (#1346).
      gate: { anyMove: () => true },
      content: ${JSON.stringify([...TARGETS.map(({ name }) => ({ text: TEXT, target: { kind: 'element', ref: { name } } })), MODAL_ANNOTATION])},
    }],
  },
};
`;

/** Teleported to the body so no zoom or transform on the board moves them off the screen's edges. */
const EDGES_BOARD = `<template>
  <Teleport to="body">
    <div class="edge" data-bs-el-name="edge-left" style="left: 0; top: 15%"></div>
    <div class="edge" data-bs-el-name="edge-right" style="right: 0; top: 40%"></div>
    <div class="edge" data-bs-el-name="edge-bottom" style="left: calc(50% - 24px); bottom: 0"></div>
  </Teleport>
</template>

<style>
.edge { position: fixed; width: 48px; height: 32px; background: rebeccapurple; }
</style>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Edges from './components/Edges.vue';

export default defineGameUIs({ Edges: defaultUI(Edges) });
`;

/** Each target's box, its bubble's box, its caret's box and side, and the layer's inner size. */
function measure(frame) {
  return frame.locator('body').evaluate((body, names) => {
    const doc = body.ownerDocument;
    const layer = doc.querySelector('.bsg-annotation-layer');
    if (!layer) return null;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, centre: r.left + r.width / 2 };
    };
    const bubbles = [...layer.querySelectorAll('.bsg-board-message__content--annotation')];
    return {
      frameWidth: doc.defaultView.innerWidth,
      layer: { ...box(layer), width: layer.clientWidth },
      shown: names.map((name, i) => {
        const caret = bubbles[i]?.querySelector('.bsg-board-message__caret');
        const target = doc.querySelector(`[data-bs-el-name="${name}"]`);
        const r = bubbles[i]?.getBoundingClientRect();
        // 6px in from each corner, past the rounded border, plus the middle.
        const points = r ? [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6], [r.left + r.width / 2, r.top + r.height / 2]] : [];
        const cover = points.map(([x, y]) => doc.elementFromPoint(x, y)).find((el) => el && !bubbles[i].contains(el));
        return {
          coveredBy: cover ? `${cover.tagName}.${cover.className}` : null,
          target: target ? box(target) : null,
          bubble: bubbles[i] ? box(bubbles[i]) : null,
          caret: caret ? { ...box(caret), side: caret.className.match(/caret--(\w+)/)?.[1] } : null,
        };
      }),
    };
  }, TARGETS.map(({ name }) => name));
}

/** Every way a target's bubble misses: off the layer's 8px margin, or a caret that does not point at it. */
function misses(seen, i) {
  const { target, bubble, caret } = seen.shown[i];
  if (!target) return [`the board shows no target named ${TARGETS[i].name}`];
  if (!bubble || !caret) return ['no bubble with a caret is shown'];
  const minLeft = seen.layer.left + EDGE_MARGIN;
  const maxRight = seen.layer.left + seen.layer.width - EDGE_MARGIN;
  const want = TARGETS[i].caret;
  const tipClear = want === 'top' ? caret.top >= target.bottom - 0.5 : caret.bottom <= target.top + 0.5;
  return [
    [bubble.left >= minLeft - 0.5, `its left edge is at ${bubble.left.toFixed(1)}px, inside the ${minLeft}px margin`],
    [bubble.right <= maxRight + 0.5, `its right edge is at ${bubble.right.toFixed(1)}px, past the ${maxRight}px margin`],
    [Math.abs(caret.centre - target.centre) <= 1, `its caret is at x=${caret.centre.toFixed(1)}px, the target's centre at x=${target.centre.toFixed(1)}px`],
    [caret.side === want, `its caret is on its ${caret.side} side, not its ${want} side`],
    [tipClear, want === 'top'
      ? `its caret's tip (y=${caret.top.toFixed(1)}) is not below the target (bottom y=${target.bottom.toFixed(1)})`
      : `its caret's tip (y=${caret.bottom.toFixed(1)}) is not above the target (top y=${target.top.toFixed(1)})`],
  ].filter(([ok]) => !ok).map(([, why]) => why);
}

/**
 * What is drawn on top at the middle of the modal annotation's bubble, of a bubble
 * about the board (the right edge's), and of the action bar; at the upper half of
 * the bar's edge toggle, which overhangs the board; and how many rings show.
 */
function topmost(frame) {
  return frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    // The game-over card makes the page behind it inert, and hit testing skips inert elements, so lift it while asking what is drawn on top.
    const inert = [...doc.querySelectorAll('[inert]')];
    for (const el of inert) el.removeAttribute('inert');
    const onTop = (el, down = 0.5) => {
      if (!el) return 'nothing (it is not shown)';
      const r = el.getBoundingClientRect();
      const top = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height * down);
      return top && el.contains(top) ? 'itself' : `${top?.tagName}.${top?.className}`;
    };
    const bubbles = doc.querySelectorAll('.bsg-annotation-layer .bsg-board-message__content--annotation');
    const seen = {
      bubble: onTop(bubbles[3]),
      board: onTop(bubbles[1]),
      bar: onTop(doc.querySelector('[data-testid="bs-actionbar"]')),
      toggle: onTop(doc.querySelector('.bar-edge'), 0.25),
      rings: doc.querySelectorAll('.bsg-tutorial-ring').length,
    };
    for (const el of inert) el.setAttribute('inert', '');
    return seen;
  });
}

/** Re-place the bubbles, as the board region scrolling would. */
function remeasure(frame) {
  return frame.locator('[data-testid="bs-board"]').evaluate((region) => region.dispatchEvent(new Event('scroll')));
}

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

await runBrowserRegression(
  {
    script: 'annotation-bubble-browser.mjs',
    table: { files: { 'src/rules/index.ts': RULES, 'src/ui/uis.ts': UIS, 'src/ui/components/Edges.vue': EDGES_BOARD } },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      // One page throughout: the dev host gives seat 1 to the first browser only.
      const page = await browser.newPage({ viewport: VIEWPORTS[0] });
      await page.goto(hostUrl);
      await page.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
      const frame = page.frameLocator('.dev-host__frame');
      await frame.locator('[data-bs-el-name="edge-left"]').waitFor({ timeout: 60_000 });
      await frame.locator('button[aria-label="Game controls"]').click();
      await frame.getByRole('menuitem', { name: 'Start tutorial' }).click();

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        // Coverage is waited for too: after a resize the closed debug drawer slides to its phone position over the bubbles.
        const seen = await waitUntil(
          () => measure(frame),
          (now) => now !== null && now.frameWidth <= viewport.width
            && TARGETS.every((_, i) => misses(now, i).length === 0 && now.shown[i].coveredBy === null),
        );
        for (const [i, { side }] of TARGETS.entries()) {
          await check(`the bubble for a target at ${side} stays 8px inside the layer and points at it at ${viewport.width}px`, async () => {
            assert(seen !== null, 'the tutorial never showed its annotation layer');
            const found = misses(seen, i);
            assert(found.length === 0, found.join('; '));
          });
          await check(`the bubble for a target at ${side} is drawn above the action bar and the rest of the shell at ${viewport.width}px (#1341)`, async () => {
            assert(seen !== null, 'the tutorial never showed its annotation layer');
            const { coveredBy } = seen.shown[i];
            assert(coveredBy === null, `part of the bubble is covered by ${coveredBy}`);
          });
        }
      }

      // A game modal and the game-over scrim cover bubbles about the board, but never the action bar (#1346).
      await page.setViewportSize(VIEWPORTS[0]);
      await frame.locator('#bs-game-modal').evaluate((host) => {
        const modal = host.ownerDocument.createElement('div');
        modal.className = 'test-modal';
        modal.style.cssText = 'position: absolute; inset: 0; background: teal';
        host.append(modal);
      });
      const underModal = await waitUntil(() => topmost(frame), (now) => now.bubble === 'DIV.test-modal');
      await check('a bubble about the board is drawn under an open game modal (#1346)', async () => {
        assert(underModal.bubble === 'DIV.test-modal', `the middle of the bubble shows ${underModal.bubble}, not the modal`);
      });
      await check('the action bar and its edge toggle are drawn above an open game modal (#1346)', async () => {
        assert(underModal.bar === 'itself', `the middle of the action bar shows ${underModal.bar}`);
        assert(underModal.toggle === 'itself', `the upper half of the bar's edge toggle shows ${underModal.toggle}`);
      });

      await frame.locator('.test-modal').evaluate((modal) => {
        modal.innerHTML = '<div data-bs-el-name="in-modal" style="position: absolute; left: 40%; top: 30%; width: 60px; height: 40px; background: gold"></div>';
      });
      await remeasure(frame);
      const inModal = await waitUntil(() => topmost(frame), (now) => now.bubble === 'itself' && now.rings === 4);
      await check('a target inside an open game modal gets its ring and a bubble drawn above the modal (#1346)', async () => {
        assert(inModal.rings === 4, `${inModal.rings} rings show, not one for each of the 4 targets`);
        assert(inModal.bubble === 'itself', `the middle of the bubble shows ${inModal.bubble}`);
      });
      await check('a bubble about the board stays under the modal while another target is inside it (#1346)', async () => {
        assert(inModal.board === 'DIV.test-modal', `the middle of the right edge's bubble shows ${inModal.board}, not the modal`);
      });

      await frame.locator('.test-modal').evaluate((modal) => modal.remove());
      await remeasure(frame);
      const ended = await playTableSampleToTheEnd(frame);
      const underScrim = await waitUntil(() => topmost(frame), (now) => now.bubble.startsWith('DIV.game-over'));
      await check('the game-over scrim covers a bubble about the board, and the action bar stays above it (#1346)', async () => {
        assert(ended, 'the game-over card never appeared');
        assert(underScrim.bubble.startsWith('DIV.game-over'), `the middle of the bubble shows ${underScrim.bubble}, not the game-over scrim`);
        assert(underScrim.bar === 'itself', `the middle of the action bar shows ${underScrim.bar}`);
        assert(underScrim.toggle === 'itself', `the upper half of the bar's edge toggle shows ${underScrim.toggle}`);
      });
    } finally {
      await browser.close();
    }
    return summarise('for where the annotation bubble lands');
  },
);
