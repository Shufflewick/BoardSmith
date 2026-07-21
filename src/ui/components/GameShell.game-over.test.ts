// @vitest-environment jsdom
/**
 * GameShell game-over suppression + parity tests — Phase 157, Plan 01 [TDD] (D10/ENDGAME-01)
 *
 * Mounting the full GameShell (client wiring, WS connection, platform postMessage
 * bridge) is impractical for a unit test — this file follows the established
 * harness pattern (see GameShell.ia.test.ts Suite 5, WinnerCaptureHarness):
 * an isolated component that mirrors GameShell.vue's exact mount-guard template
 * logic for the `#game-over` slot / `providesOwnGameOverUI` prop, using the REAL
 * GameOverCard component so labeling/dismiss behavior is exercised for real.
 *
 * The harness template below mirrors CURRENT (pre-fix) GameShell.vue:2088-2094 —
 * unconditional default GameOverCard, no `#game-over` slot, no
 * `providesOwnGameOverUI` prop. It must be updated to mirror the post-fix
 * template in the GREEN commit, in lockstep with the real GameShell.vue change
 * (same discipline as the other GameShell.*.test.ts harnesses in this file).
 *
 * Behaviors under test (CONTEXT.md ENDGAME-01 / UI-SPEC §3):
 *   (a) Default card renders when neither slot nor flag is present.
 *   (b) A filled `#game-over` slot suppresses the default card entirely (DOM
 *       removal, not display:none) and renders the slot content instead.
 *   (c) `providesOwnGameOverUI=true` suppresses BOTH the default card and any
 *       slot content.
 *   (b)/(c) are asserted under both the default board and a custom `#game-board`
 *   slot, to prove UI parity (CLAUDE.md hard rule).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, type PropType } from 'vue';
import GameOverCard, { type Player } from './GameOverCard.vue';

const PLAYERS: Player[] = [
  { seat: 0, name: 'Alice', color: '#e74c3c' },
  { seat: 1, name: 'Bob', color: '#3498db' },
];

// ---------------------------------------------------------------------------
// GameOverHarness — mirrors GameShell.vue's game-over mount guard.
//
// CURRENT (pre-fix) state: unconditional default card, no slot, no flag.
// ---------------------------------------------------------------------------
const GameOverHarness = defineComponent({
  name: 'GameOverHarness',
  components: { GameOverCard },
  props: {
    complete: { type: Boolean, default: true },
    winnerSeats: { type: Array as PropType<number[]>, default: () => [] },
    players: { type: Array as PropType<Player[]>, default: () => PLAYERS },
    useCustomBoard: { type: Boolean, default: false },
  },
  emits: ['new-game', 'rematch'],
  template: `
    <div class="boardregion">
      <div v-if="useCustomBoard" class="custom-board">Custom board UI</div>
      <div v-else class="empty-game-area">Add your game board in the #game-board slot</div>

      <GameOverCard
        v-if="complete"
        class="game-over-card-harness-marker"
        :winner-seats="winnerSeats"
        :players="players"
        @new-game="$emit('new-game')"
        @rematch="$emit('rematch')"
      />
    </div>
  `,
});

function mountHarness(props: Record<string, unknown>, slots: Record<string, string> = {}) {
  return mount(GameOverHarness, { props, slots });
}

describe('GameShell game-over — default card (no slot / no flag)', () => {
  it('renders the default card when the game is complete and no slot/flag is supplied', () => {
    const wrapper = mountHarness({ complete: true });
    expect(wrapper.find('.game-over-card').exists()).toBe(true);
  });

  it('does not render the default card when the game is not complete', () => {
    const wrapper = mountHarness({ complete: false });
    expect(wrapper.find('.game-over-card').exists()).toBe(false);
  });
});

describe.each([
  ['default board', false],
  ['custom #game-board UI', true],
] as const)('GameShell game-over — #game-over slot suppression (%s)', (_label, useCustomBoard) => {
  it('removes the default card from the DOM and renders slot content when #game-over is filled', () => {
    const wrapper = mountHarness(
      { complete: true, useCustomBoard },
      { 'game-over': '<div class="custom-game-over">Custom result UI</div>' },
    );

    // Pre-fix: the harness template has no <slot name="game-over"> at all, so
    // this markup is silently dropped and the default card still renders.
    expect(wrapper.find('.custom-game-over').exists()).toBe(true);
    expect(wrapper.find('.game-over-card').exists()).toBe(false);
  });
});

describe.each([
  ['default board', false],
  ['custom #game-board UI', true],
] as const)('GameShell game-over — providesOwnGameOverUI suppression (%s)', (_label, useCustomBoard) => {
  it('suppresses BOTH the default card and slot content when providesOwnGameOverUI=true', () => {
    const wrapper = mountHarness(
      { complete: true, useCustomBoard, providesOwnGameOverUI: true },
      { 'game-over': '<div class="custom-game-over">Custom result UI</div>' },
    );

    expect(wrapper.find('.game-over-card').exists()).toBe(false);
    expect(wrapper.find('.custom-game-over').exists()).toBe(false);
  });
});
