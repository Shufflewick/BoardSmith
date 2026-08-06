// @vitest-environment jsdom
/**
 * The action bar's identity token, and the two different claims it can make (B14).
 *
 * D27 removed the token during a simultaneous step because a single glyph cannot
 * say "whose turn it is" when several seats are deciding independently — that
 * claim is about the TABLE, and it would have been false. Correct as far as it
 * went, but it also withheld the one identity that is never ambiguous: the
 * VIEWER's own. The bar is already viewer-scoped in that state, so it was
 * showing your actions with nothing saying who you are, and the same bar
 * carrying a token in one phase and not the next read as a defect — the shape
 * is otherwise a constant identity anchor.
 *
 * So the property under test is not "a token renders" but WHICH claim it makes:
 *   - turn-based  -> the active seat, 'active'
 *   - simultaneous -> the viewer's own seat, 'you' (visually distinct, so it
 *                     cannot be misread as "it is your turn")
 *
 * Mirrors GameShell.vue's `panelToken` computed in the harness style used by
 * GameShell.player-order.test.ts / GameShell.game-over.test.ts, since mounting
 * the real shell needs client wiring and a WS connection. The template wiring
 * that consumes it is asserted on GameShell.vue's source below, so a harness
 * that drifts from the real markup still fails.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, computed } from 'vue';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import PlayerToken from './PlayerToken.vue';

interface TestPlayer { seat: number; name: string; color?: string }

const PLAYERS: TestPlayer[] = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
  { seat: 2, name: 'Carol' },
];

const TokenHarness = defineComponent({
  name: 'TokenHarness',
  components: { PlayerToken },
  props: {
    players: { type: Array as () => TestPlayer[], default: () => PLAYERS },
    playerSeat: { type: Number, default: 1 },
    currentPlayer: { type: Number as unknown as () => number | undefined, default: undefined },
    awaitingPlayers: { type: Array as () => Array<{ playerIndex: number; completed: boolean }>, default: () => [] },
  },
  setup(props) {
    const isSimultaneous = computed(() => props.awaitingPlayers.length > 0);
    const myPlayer = computed(() => props.players.find(p => p.seat === props.playerSeat));
    const activePlayer = computed(() => {
      if (isSimultaneous.value) return null;
      if (props.currentPlayer === undefined) return null;
      const p = props.players.find(pl => pl.seat === props.currentPlayer);
      if (!p) return null;
      return { name: p.name, seat: p.seat, color: p.color };
    });
    const panelToken = computed(() => {
      if (isSimultaneous.value) {
        const me = myPlayer.value;
        if (!me || me.seat === undefined) return null;
        return { kind: 'you' as const, name: me.name, seat: me.seat, color: me.color };
      }
      const active = activePlayer.value;
      return active ? { kind: 'active' as const, ...active } : null;
    });
    return { panelToken };
  },
  template: `
    <PlayerToken
      v-if="panelToken"
      class="turn-token"
      :name="panelToken.name"
      :seat="panelToken.seat"
      :color="panelToken.color"
      :size="30"
    />`,
});

const shapeOf = (w: ReturnType<typeof mount>) =>
  w.find('.turn-token').classes().find(c => c.startsWith('sh-'));

describe('action bar identity token', () => {
  it('shows the ACTIVE seat during a turn-based step', () => {
    const wrapper = mount(TokenHarness, { props: { playerSeat: 1, currentPlayer: 2 } });
    expect(wrapper.find('.turn-token').exists()).toBe(true);
    // Seat 2's glyph, not the viewer's (seat 1) — this is a claim about the table.
    expect(shapeOf(wrapper)).toBe('sh-hexagon');
  });

  it('shows the VIEWER during a simultaneous step, instead of nothing', () => {
    const wrapper = mount(TokenHarness, {
      props: {
        playerSeat: 1,
        currentPlayer: 2, // stale/meaningless here — must NOT be what renders
        awaitingPlayers: [
          { playerIndex: 0, completed: false },
          { playerIndex: 1, completed: false },
        ],
      },
    });
    expect(wrapper.find('.turn-token').exists()).toBe(true);
    expect(shapeOf(wrapper)).toBe('sh-square'); // seat 1 — the viewer
  });

  it('draws the you-token identically to the whose-turn token', () => {
    // Same seat, once as the active player and once as the viewer mid-simultaneous:
    // the rendered markup must be indistinguishable. A decoration marking the
    // 'you' case reads as unexplained decoration on an identity glyph, and
    // competes with shape — the only identity channel a colourless game has.
    const asActive = mount(TokenHarness, { props: { playerSeat: 1, currentPlayer: 1 } });
    const asYou = mount(TokenHarness, {
      props: { playerSeat: 1, awaitingPlayers: [{ playerIndex: 1, completed: false }] },
    });
    expect(asYou.find('.turn-token').classes().sort())
      .toEqual(asActive.find('.turn-token').classes().sort());
    expect(asYou.find('.turn-token').html()).toBe(asActive.find('.turn-token').html());
  });

  it('never shows another seat as the viewer during a simultaneous step', () => {
    // The D27 failure mode in reverse: whatever `currentPlayer` holds while
    // several seats decide, it must not reach this token.
    for (const currentPlayer of [0, 2, undefined]) {
      const wrapper = mount(TokenHarness, {
        props: {
          playerSeat: 1,
          currentPlayer,
          awaitingPlayers: [{ playerIndex: 0, completed: false }, { playerIndex: 2, completed: false }],
        },
      });
      expect(shapeOf(wrapper)).toBe('sh-square');
    }
  });

  it('keeps showing the viewer after they commit, while others are still deciding', () => {
    // Identity does not depend on whether you have acted yet — the anchor must
    // not blink out mid-step.
    const wrapper = mount(TokenHarness, {
      props: {
        playerSeat: 1,
        awaitingPlayers: [{ playerIndex: 1, completed: true }, { playerIndex: 2, completed: false }],
      },
    });
    expect(wrapper.find('.turn-token').exists()).toBe(true);
    expect(shapeOf(wrapper)).toBe('sh-square');
  });

  it('renders no token for a spectator, who has no identity to show', () => {
    const wrapper = mount(TokenHarness, {
      props: { playerSeat: -1, awaitingPlayers: [{ playerIndex: 0, completed: false }] },
    });
    expect(wrapper.find('.turn-token').exists()).toBe(false);
  });

  it('gives a seat the same glyph in both claims (identity is stable across phases)', () => {
    // The whole reason the absence read as a bug: the shape is a constant.
    const asActive = mount(TokenHarness, { props: { playerSeat: 0, currentPlayer: 1 } });
    const asYou = mount(TokenHarness, {
      props: { playerSeat: 1, awaitingPlayers: [{ playerIndex: 1, completed: false }] },
    });
    expect(shapeOf(asYou)).toBe(shapeOf(asActive));
  });
});

describe('GameShell.vue wires the token to panelToken', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'),
    'utf8',
  );

  it('renders the action-bar token from panelToken, not activePlayer', () => {
    const block = source.slice(source.indexOf('<PlayerToken'), source.indexOf('<PlayerToken') + 400);
    expect(block).toMatch(/v-if="panelToken"/);
    expect(block).toMatch(/:seat="panelToken\.seat"/);
    expect(block, 'binding straight to activePlayer would restore the blank simultaneous bar')
      .not.toMatch(/activePlayer/);
  });

  it('draws the you-token exactly like the whose-turn token', () => {
    // B15: a ring/outline/opacity on the 'you' case was tried and removed. On an
    // identity glyph a decoration reads as unexplained decoration rather than as
    // meaning, and it competes with shape — the stable identity channel, and the
    // only one in a colourless game. `kind` selects WHICH seat, never how it looks.
    const block = source.slice(source.indexOf('<PlayerToken'), source.indexOf('<PlayerToken') + 400);
    expect(block, 'the token must carry no kind-dependent class').not.toMatch(/is-you/);
    expect(block, 'the token must carry no kind-dependent styling prop').not.toMatch(/emphasis/);

    // ...and nothing may style it back in from the stylesheet either.
    expect(source.match(/\.turn-token\.[a-z-]+\s*\{[^}]*\}/s)?.[0] ?? '').toBe('');
  });

  it('keeps activePlayer itself suppressed during a simultaneous step (D27)', () => {
    // panelToken must be the ONLY thing that reintroduces a token there —
    // activePlayer still means "whose turn", and that stays undefined.
    const block = source.slice(source.indexOf('const activePlayer = computed'));
    expect(block.slice(0, 200)).toMatch(/if \(isSimultaneous\.value\) return null;/);
  });
});
