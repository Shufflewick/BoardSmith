// @vitest-environment jsdom
/**
 * #563: OBJECT-VALUED CHOICES ARE DISTINCT ITEMS IN THE ACTION PANEL.
 *
 * The panel keyed every choice by `String(choice.value)`, so every object-valued
 * choice keyed as '[object Object]'. Vue then cannot tell them apart: when the
 * list changes it hands one choice's button to another, so the button the
 * player was on (focus included) silently starts meaning a different choice. A choice is keyed the way the engine identifies
 * it (`choiceValueKey` beside `valuesEqual` in `engine/action/choice-matching.ts`).
 *
 * The first case drives a live seat (#577): the panel is mounted over the same
 * table wiring GameShell uses, every press reaches the session host as
 * production sends it, and the assertion is what the game executed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { stubActionController, mountPanel } from './action-panel-controller.test-helper.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY } from '../../composables/useBoardInteraction.js';
import { mountLiveSeat, settle } from '../../composables/table-wiring.test-helper.js';
import { Game, Player, Action, actionStep, type GameOptions } from '../../../engine/index.js';

interface Leg { from: string; to: string }

const NORTH: Leg = { from: 'harbor', to: 'north' };
const SOUTH: Leg = { from: 'harbor', to: 'south' };
const display = (leg: Leg) => `Harbor to ${leg.to}`;

class TravelGame extends Game<TravelGame, Player> {
  /** The leg each `travel` executed with. */
  travelled: Leg[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<TravelGame>('travel')
        .chooseFrom('leg', { prompt: 'Choose a leg', choices: [NORTH, SOUTH], display })
        .execute((args, ctx) => {
          (ctx.game as TravelGame).travelled.push({ ...(args.leg as Leg) });
          return { success: true };
        }),
    );
    this.setFlow({
      root: actionStep({ actions: ['travel'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 10 }),
    });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function choiceLabels(panel: VueWrapper): string[] {
  return panel.findAll('.choice-btn:not(.skip-btn)').map((b) => b.text());
}

function buttonFor(panel: VueWrapper, label: string): HTMLElement {
  const button = panel.findAll('.choice-btn:not(.skip-btn)').find((b) => b.text() === label);
  expect(button, `the panel should offer "${label}"`).toBeTruthy();
  return button!.element as HTMLElement;
}

describe('object-valued choices in the Action Panel (#563)', () => {
  it('renders each object choice as its own item, and pressing each plays that choice', async () => {
    const { session, wiring, board, seatState } = await mountLiveSeat(TravelGame, 'bs563', mounted);
    const { controller } = wiring;
    const Host = defineComponent({
      setup: () => () =>
        h(ActionPanel, {
          availableActions: seatState.value.availableActions ?? [],
          actionMetadata: wiring.actionMetadata.value,
          playerSeat: 1,
          isMyTurn: true,
        }),
    });
    const panel = mount(Host, {
      global: {
        provide: {
          [GAME_CONTEXT_KEYS.actionController as symbol]: controller,
          [BOARD_INTERACTION_KEY as symbol]: board,
        },
      },
    });
    mounted.push(panel);
    await settle();

    for (const label of ['Harbor to north', 'Harbor to south']) {
      await controller.start('travel');
      await settle();
      expect(choiceLabels(panel)).toEqual(['Harbor to north', 'Harbor to south']);
      buttonFor(panel, label).click();
      await settle();
    }

    expect(controller.lastError.value).toBeNull();
    expect(session.readGame().travelled).toEqual([NORTH, SOUTH]);
  });

  // A stub controller, because no live path can hold this case yet: the only way
  // an OPEN pick's list changes at a live table is a repeating pick, and a
  // repeating pick's later lists come back without their labels (#598). Between
  // two picks the panel redraws the list from scratch, so a two-pick action
  // cannot show a button being handed to another choice. Move this to a live
  // seat once #598 is fixed.
  it('keeps each object choice on its own button when the list changes', async () => {
    const EAST = { value: { from: 'market', to: 'east' }, display: 'Market to east' };
    const north = { value: NORTH, display: 'Harbor to north' };
    const south = { value: SOUTH, display: 'Harbor to south' };
    const currentChoices = ref([north, south, EAST]);
    const fill = vi.fn(async () => ({ valid: true }));
    const controller = stubActionController({
      currentAction: ref('travel'),
      currentPick: ref({ name: 'leg', type: 'choice', prompt: 'Choose a leg' }),
      currentChoices,
      fill,
    });
    const panel = mountPanel(controller);
    mounted.push(panel);

    const southButton = buttonFor(panel, 'Harbor to south');
    const eastButton = buttonFor(panel, 'Market to east');

    // The game narrows its list: north is no longer on offer.
    currentChoices.value = [south, EAST];
    await nextTick();

    expect(buttonFor(panel, 'Harbor to south')).toBe(southButton);
    expect(buttonFor(panel, 'Market to east')).toBe(eastButton);

    southButton.click();
    await nextTick();
    expect(fill).toHaveBeenCalledWith('leg', SOUTH);
  });
});
