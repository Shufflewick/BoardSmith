// @vitest-environment jsdom
/**
 * `assertNoHiddenInfoLeak` SCANS WHAT A PLAYER SEES WITH AN ACTION OPEN (#405).
 *
 * The scan mounted a board and read it at once, so it only ever saw the board
 * with nothing chosen. A board draws its targets while an action is open, and a
 * target can be labelled with the very thing it hides: a blind pick of the
 * other seat's card, named by its rank. That leak was out of the scan's reach,
 * and since #390 a table's targets come from the seat's own controller, so they
 * cannot be pre-loaded either.
 *
 * `startAction` opens an action on the seat's controller before the scan, as a
 * player would, so the targets and their labels are the game's own. The scan
 * also forwards every render option to the mount, `provide` among them, which it
 * used to drop.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, inject, type InjectionKey, type PropType } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { Card } from '../engine/index.js';
import type { UseActionControllerReturn } from '../ui/composables/useActionControllerTypes.js';
import { useBoardInteraction } from '../ui/composables/useBoardInteraction.js';
import { makeSecretHandGame, TargetBoard, type ViewNode } from './dom-leak.test-helper.js';
import { assertNoHiddenInfoLeak, preloadSeatRenderer, renderAsSeat } from './dom-leak.js';

await preloadSeatRenderer();

const makeGame = () => makeSecretHandGame('open-action');

/** The same board, labelling each target by its position instead of its choice text. */
const PositionalTargetBoard = defineComponent({
  name: 'PositionalTargetBoard',
  props: { gameView: { type: Object as PropType<ViewNode | null>, default: null } },
  setup() {
    const interaction = useBoardInteraction();
    return () =>
      h(
        'div',
        { class: 'board' },
        interaction.validElements.map((target, index) =>
          h('button', { class: 'target', 'data-element-id': String(target.id), 'aria-label': `card ${index + 1}` }),
        ),
      );
  },
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('assertNoHiddenInfoLeak with an action open (#405)', () => {
  it('passes the board as it stands, where no target is drawn', async () => {
    await expect(assertNoHiddenInfoLeak(makeGame(), 1, { component: TargetBoard })).resolves.toBeUndefined();
  });

  it("catches a target labelled with the face it hides, once the action is open", async () => {
    await expect(
      assertNoHiddenInfoLeak(makeGame(), 1, { component: TargetBoard, startAction: { name: 'peek' } }),
    ).rejects.toThrow(/Hidden-info leak: "King" \(attribute "rank"\)/);
  });

  it('passes the same open action on a board that does not name its targets by their faces', async () => {
    await expect(
      assertNoHiddenInfoLeak(makeGame(), 1, { component: PositionalTargetBoard, startAction: { name: 'peek' } }),
    ).resolves.toBeUndefined();
  });

  it('refuses an action the seat cannot take, saying which and why', async () => {
    await expect(
      assertNoHiddenInfoLeak(makeGame(), 2, { component: TargetBoard, startAction: { name: 'peek' } }),
    ).rejects.toThrow(/could not open "peek" for seat 2/);
  });

  it('refuses an action with nothing to choose, which completes rather than staying open', async () => {
    await expect(
      assertNoHiddenInfoLeak(makeGame(), 1, { component: TargetBoard, startAction: { name: 'pass' } }),
    ).rejects.toThrow(/"pass" did not stay open for seat 1/);
  });
});

describe('renderAsSeat with an action open (#405)', () => {
  it("hands back the board with the action open and the game's own targets drawn", async () => {
    const game = makeGame();
    const wrapper = await renderAsSeat(game, 1, { component: TargetBoard, startAction: { name: 'peek' } });
    mounted.push(wrapper as unknown as VueWrapper);

    const secondSeatCard = game.game.all(Card).find((card) => card.name === '2-secret-card');
    expect(wrapper.findAll('.target').map((target) => target.attributes('data-element-id'))).toEqual([
      String(secondSeatCard?.id),
    ]);
  });
});

const TABLE_SKIN: InjectionKey<string> = Symbol('table-skin');

/** A board that needs a value its own app provides, and says so when it is missing. */
const SkinnedBoard = defineComponent({
  name: 'SkinnedBoard',
  props: {
    gameView: { type: Object as PropType<ViewNode | null>, default: null },
    actionController: { type: Object as PropType<UseActionControllerReturn>, required: true },
  },
  setup() {
    const skin = inject(TABLE_SKIN, undefined);
    if (skin === undefined) throw new Error('SkinnedBoard was mounted without a table skin');
    return () => h('div', { class: 'board', 'data-skin': skin });
  },
});

describe('assertNoHiddenInfoLeak forwards provide (#405)', () => {
  it('mounts a board with what the caller provides', async () => {
    await expect(
      assertNoHiddenInfoLeak(makeGame(), 1, { component: SkinnedBoard, provide: { [TABLE_SKIN]: 'felt' } }),
    ).resolves.toBeUndefined();
  });
});
