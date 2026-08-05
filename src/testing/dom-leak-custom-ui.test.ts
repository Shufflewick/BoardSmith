// @vitest-environment jsdom
/**
 * `assertNoHiddenInfoLeak`'s custom-UI seam.
 *
 * The utility used to render AutoUI and nothing else, which made it blind for
 * exactly the games that need it most: a game with a custom board could paint
 * an opponent's hidden card face-up and still get a green result, because the
 * markup being scanned was never the markup the player looks at. Reported from
 * the field (BOARDSMITH-BUGS BUG 4, "Secondary limitation").
 *
 * These tests prove the seam is real in BOTH directions:
 *   (1) a custom board that leaks IS caught — and, critically, the same game
 *       passes when scanned via AutoUI, so the new option is load-bearing
 *       rather than decorative;
 *   (2) a custom board that correctly renders only the redacted view passes;
 *   (3) the standard scaffold contract props are supplied automatically, so a
 *       real game board mounts without any `componentProps`;
 *   (4) a caller cannot substitute the rendered view out from under the scan.
 *
 * Cross-layer boundary: testing -> engine (toJSONForPlayer) -> a game's own UI.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, type PropType } from 'vue';
import {
  Game,
  Player,
  Hand,
  Card,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { assertNoHiddenInfoLeak } from './dom-leak.js';

// ---------------------------------------------------------------------------
// Fixture: two seats, each with an owner-only Hand holding one secret card.
// ---------------------------------------------------------------------------

class SecretCard extends Card<CustomUILeakGame> {
  rank!: string;
}

class CustomUILeakGame extends Game<CustomUILeakGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([SecretCard]);

    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      // Hand defaults to owner-only content visibility.
      hand.create(SecretCard, `${player.seat}-secret-card`, {
        rank: player.seat === 1 ? 'Ace' : 'King',
      });
    }

    this.registerAction(
      Action.create<CustomUILeakGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => false,
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      }),
    );
  }
}

function makeGame(): TestGame<CustomUILeakGame> {
  return TestGame.create(CustomUILeakGame, { playerCount: 2, seed: 'custom-ui-leak' });
}

/** The full authoritative tree — what a careless custom board might reach for. */
function authoritativeView(tg: TestGame<CustomUILeakGame>): unknown {
  return tg.game.toJSON();
}

// ---------------------------------------------------------------------------
// Custom boards under test. Both walk whatever tree they are handed and stamp
// each card's identity into a real DOM surface, the way a game's own renderer
// does (`data-element-id` + an aria-label).
// ---------------------------------------------------------------------------

interface ViewNode {
  id?: number;
  name?: string;
  rank?: string;
  children?: ViewNode[];
}

function collectCards(node: ViewNode, into: ViewNode[] = []): ViewNode[] {
  if (node.rank !== undefined || (node.name?.includes('secret-card') ?? false)) into.push(node);
  for (const child of node.children ?? []) collectCards(child, into);
  return into;
}

/** A correct board: renders ONLY what the per-seat view actually carries. */
const RedactedBoard = defineComponent({
  name: 'RedactedBoard',
  props: {
    gameView: { type: Object as PropType<ViewNode | null>, default: null },
    playerSeat: { type: Number, default: 0 },
  },
  setup(props) {
    return () =>
      h(
        'div',
        { class: 'board' },
        collectCards(props.gameView ?? {}).map((card) =>
          h('div', {
            'data-element-id': String(card.id ?? ''),
            'aria-label': card.name ?? 'a face-down card',
          }),
        ),
      );
  },
});

/**
 * A leaking board: ignores its `gameView` prop and renders the authoritative
 * tree it was handed separately — the shape of a real bug (a board reading
 * from a store that was never redacted).
 */
const LeakyBoard = defineComponent({
  name: 'LeakyBoard',
  props: {
    gameView: { type: Object as PropType<ViewNode | null>, default: null },
    playerSeat: { type: Number, default: 0 },
    fullTree: { type: Object as PropType<ViewNode | null>, default: null },
  },
  setup(props) {
    return () =>
      h(
        'div',
        { class: 'board' },
        collectCards(props.fullTree ?? props.gameView ?? {}).map((card) =>
          h('div', {
            'data-element-id': String(card.id ?? ''),
            'aria-label': card.name ?? '',
          }),
        ),
      );
  },
});

/** A board declaring the full scaffold contract, asserting each prop arrives. */
const ContractBoard = defineComponent({
  name: 'ContractBoard',
  props: {
    gameView: { type: Object as PropType<ViewNode | null>, default: null },
    playerSeat: { type: Number, required: true },
    isMyTurn: { type: Boolean, required: true },
    availableActions: { type: Array as PropType<string[]>, required: true },
    actionController: { type: Object as PropType<Record<string, unknown>>, required: true },
  },
  setup(props) {
    return () =>
      h('div', {
        class: 'board',
        'data-seat': String(props.playerSeat),
        'data-my-turn': String(props.isMyTurn),
        'data-actions': props.availableActions.join(','),
        // Reads through the inert controller exactly as a real template would.
        'data-controller-actions': String(
          (props.actionController.availableActions as { value: string[] }).value.length,
        ),
      });
  },
});

// ---------------------------------------------------------------------------

describe('assertNoHiddenInfoLeak — custom UI component', () => {
  it('catches a leak in a game\'s OWN board that AutoUI would never surface', async () => {
    const tg = makeGame();

    // The load-bearing comparison: scanning via AutoUI passes...
    await expect(assertNoHiddenInfoLeak(tg, 1)).resolves.not.toThrow();

    // ...while the very same game, scanned through the board its players
    // actually see, fails — naming seat 2's secret card.
    await expect(
      assertNoHiddenInfoLeak(tg, 1, {
        component: LeakyBoard,
        componentProps: { fullTree: authoritativeView(tg) },
      }),
    ).rejects.toThrow(/2-secret-card/);
  });

  it('passes for a custom board that renders only the redacted per-seat view', async () => {
    const tg = makeGame();

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: RedactedBoard }),
    ).resolves.not.toThrow();
    await expect(
      assertNoHiddenInfoLeak(tg, 2, { component: RedactedBoard }),
    ).resolves.not.toThrow();
  });

  it('supplies the standard scaffold contract props, so a real board needs no componentProps', async () => {
    const tg = makeGame();

    // Vue would warn-and-fail on a missing required prop; a clean pass here is
    // the proof that playerSeat/isMyTurn/availableActions/actionController all
    // arrived without the caller naming any of them.
    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: ContractBoard }),
    ).resolves.not.toThrow();
  });

  it('ignores a componentProps-supplied gameView — the scan always renders the real per-seat view', async () => {
    const tg = makeGame();

    // A caller trying to hand the board the authoritative tree via
    // componentProps must NOT be able to change what gets scanned; if the
    // override won, this board would render seat 2's card and the assertion
    // would be measuring a view no client receives.
    await expect(
      assertNoHiddenInfoLeak(tg, 1, {
        component: RedactedBoard,
        componentProps: { gameView: authoritativeView(tg) },
      }),
    ).resolves.not.toThrow();
  });
});
