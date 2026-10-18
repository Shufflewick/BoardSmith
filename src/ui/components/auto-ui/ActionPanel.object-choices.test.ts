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
 * Both cases drive a live seat (#577): the panel is mounted over the same
 * table wiring GameShell uses, every press reaches the session host as
 * production sends it, and the assertion is what the game executed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY } from '../../composables/useBoardInteraction.js';
import { mountLiveSeat, settle } from '../../composables/table-wiring.test-helper.js';
import { Game, Player, Action, actionStep, type GameOptions } from '../../../engine/index.js';

interface Leg { from: string; to: string }

const NORTH: Leg = { from: 'harbor', to: 'north' };
const SOUTH: Leg = { from: 'harbor', to: 'south' };
const EAST: Leg = { from: 'market', to: 'east' };
const display = (leg: Leg) => `${leg.from === 'harbor' ? 'Harbor' : 'Market'} to ${leg.to}`;

class TravelGame extends Game<TravelGame, Player> {
  /** The leg each `travel` executed with. */
  travelled: Leg[] = [];
  /** The legs each `tour` executed with. */
  toured: Leg[][] = [];

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
    // A repeating pick whose list narrows as it goes: each leg toured leaves
    // the list, and the tour ends after two.
    this.registerAction(
      Action.create<TravelGame>('tour')
        .chooseFrom('legs', {
          prompt: 'Choose the next leg',
          choices: (ctx) => {
            const taken = (ctx.args.legs as Leg[] | undefined) ?? [];
            return [NORTH, SOUTH, EAST].filter((leg) => !taken.some((t) => t.to === leg.to));
          },
          display,
          repeat: { until: (ctx) => (ctx.args.legs as Leg[]).length === 2 },
        })
        .execute((args, ctx) => {
          (ctx.game as TravelGame).toured.push((args.legs as Leg[]).map((leg) => ({ ...leg })));
          return { success: true };
        }),
    );
    this.setFlow({
      root: actionStep({ actions: ['travel', 'tour'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 10 }),
    });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

/** Seat 1 of a live TravelGame table with the Action Panel mounted over it. */
async function travelTable(seed: string) {
  const { session, wiring, board, seatState } = await mountLiveSeat(TravelGame, seed, mounted, { withPickStep: true });
  const Host = defineComponent({
    setup: () => () =>
      h(ActionPanel, {
        availableActions: seatState.value.availableActions ?? [],
        actionMetadata: wiring.actionMetadata.value,
        isMyTurn: true,
      }),
  });
  const panel = mount(Host, {
    global: {
      provide: {
        [GAME_CONTEXT_KEYS.actionController as symbol]: wiring.controller,
        [BOARD_INTERACTION_KEY as symbol]: board,
      },
    },
  });
  mounted.push(panel);
  await settle();
  return { session, controller: wiring.controller, panel };
}

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
    const { session, controller, panel } = await travelTable('bs563');

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

  // A repeating pick is the live path on which an open pick's list changes:
  // after each pick the game sends the next list (#561).
  it('keeps each object choice on its own button when the list changes', async () => {
    const { session, controller, panel } = await travelTable('bs561');
    await controller.start('tour');
    await settle();
    expect(choiceLabels(panel)).toEqual(['Harbor to north', 'Harbor to south', 'Market to east']);
    const southButton = buttonFor(panel, 'Harbor to south');
    const eastButton = buttonFor(panel, 'Market to east');

    buttonFor(panel, 'Harbor to north').click();
    await settle();

    expect(controller.lastError.value).toBeNull();
    expect(choiceLabels(panel)).toEqual(['Harbor to south', 'Market to east']);
    expect(buttonFor(panel, 'Harbor to south')).toBe(southButton);
    expect(buttonFor(panel, 'Market to east')).toBe(eastButton);

    southButton.click();
    await settle();

    expect(controller.lastError.value).toBeNull();
    expect(session.readGame().toured).toEqual([[NORTH, SOUTH]]);
  });
});
