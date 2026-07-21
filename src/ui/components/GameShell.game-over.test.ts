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
 * GREEN: the harness template now mirrors the post-fix GameShell.vue mount
 * guard — `#game-over` slot (auto-suppresses the default card when filled)
 * and `providesOwnGameOverUI` (suppresses both), kept in lockstep with the
 * real GameShell.vue change (same discipline as the other GameShell.*.test.ts
 * harnesses in this file).
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
import { defineComponent, nextTick, type PropType } from 'vue';
import GameOverCard, { type Player } from './GameOverCard.vue';

const PLAYERS: Player[] = [
  { seat: 0, name: 'Alice', color: '#e74c3c' },
  { seat: 1, name: 'Bob', color: '#3498db' },
];

// ---------------------------------------------------------------------------
// GameOverHarness — mirrors GameShell.vue's game-over mount guard (post-fix,
// GameShell.vue's `<template v-if="state?.flowState?.complete &&
// !providesOwnGameOverUI && !gameOverDismissed">` block).
// ---------------------------------------------------------------------------
const GameOverHarness = defineComponent({
  name: 'GameOverHarness',
  components: { GameOverCard },
  props: {
    complete: { type: Boolean, default: true },
    winnerSeats: { type: Array as PropType<number[]>, default: () => [] },
    players: { type: Array as PropType<Player[]>, default: () => PLAYERS },
    isDraw: { type: Boolean, default: false },
    providesOwnGameOverUI: { type: Boolean, default: false },
    useCustomBoard: { type: Boolean, default: false },
  },
  emits: ['new-game', 'rematch', 'dismiss'],
  data() {
    return { dismissed: false };
  },
  methods: {
    // Mirrors GameShell.vue's dismissGameOver(): hide the card/slot, return
    // focus to .boardregion, and emit 'dismiss' for the parent to observe —
    // does NOT touch rematch/new-game.
    onDismiss() {
      this.dismissed = true;
      this.$emit('dismiss');
      (this.$refs.boardregion as HTMLElement | undefined)?.focus();
    },
  },
  template: `
    <div class="boardregion" ref="boardregion" tabindex="-1">
      <div v-if="useCustomBoard" class="custom-board">Custom board UI</div>
      <div v-else class="empty-game-area">Add your game board in the #game-board slot</div>

      <template v-if="complete && !providesOwnGameOverUI && !dismissed">
        <slot
          v-if="$slots['game-over']"
          name="game-over"
          :winners="winnerSeats.map(s => players.find(p => p.seat === s)).filter(Boolean)"
          :players="players"
          :is-draw="isDraw"
          :rematch="() => $emit('rematch')"
          :new-game="() => $emit('new-game')"
          :dismiss="onDismiss"
        />
        <GameOverCard
          v-else
          :winner-seats="winnerSeats"
          :players="players"
          :is-draw="isDraw"
          @new-game="$emit('new-game')"
          @rematch="$emit('rematch')"
          @dismiss="onDismiss"
        />
      </template>
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

// ---------------------------------------------------------------------------
// Task 3 — adversarial + parity (D10/ENDGAME-01):
//   - Suppression is REAL DOM removal (not display:none/v-show) under both
//     paths, parity-checked under both board modes.
//   - The dev-WS degrade never fabricates "Draw" from a bare [] (GameOverCard
//     side — see GameOverCard.test.ts for the labeling adversarial case).
//   - Dismiss never fires rematch/new-game/restart and leaves the board
//     reachable/focusable; the mounted game state (winnerSeats/players props)
//     is untouched.
// ---------------------------------------------------------------------------
describe.each([
  ['default board', false],
  ['custom #game-board UI', true],
] as const)('GameShell game-over — adversarial: suppression is real DOM removal (%s)', (_label, useCustomBoard) => {
  it('the default card markup is entirely absent from wrapper.html() when #game-over slot is filled', () => {
    const wrapper = mountHarness(
      { complete: true, useCustomBoard },
      { 'game-over': '<div class="custom-game-over">Custom result UI</div>' },
    );

    // Query the rendered HTML directly (not just .find().exists()) to rule out
    // a display:none/v-show suppression masquerading as removal.
    expect(wrapper.html()).not.toContain('game-over-card');
    expect(wrapper.html()).not.toContain('game-over-title');
  });

  it('the default card markup is entirely absent from wrapper.html() when providesOwnGameOverUI=true', () => {
    const wrapper = mountHarness({ complete: true, useCustomBoard, providesOwnGameOverUI: true });

    expect(wrapper.html()).not.toContain('game-over-card');
    expect(wrapper.html()).not.toContain('game-over-title');
  });

  it('neither the card nor the slot render when providesOwnGameOverUI=true even with a slot supplied', () => {
    const wrapper = mountHarness(
      { complete: true, useCustomBoard, providesOwnGameOverUI: true },
      { 'game-over': '<div class="custom-game-over">Custom result UI</div>' },
    );

    expect(wrapper.html()).not.toContain('custom-game-over');
  });
});

describe('GameShell game-over — adversarial: dismiss has no restart/leave side effect', () => {
  it('clicking the close control emits ONLY "dismiss" — never "rematch" or "new-game"', async () => {
    const wrapper = mountHarness({ complete: true, winnerSeats: [0] });

    await wrapper.find('[aria-label="Close"]').trigger('click');

    expect(wrapper.emitted('dismiss')).toHaveLength(1);
    expect(wrapper.emitted('rematch')).toBeUndefined();
    expect(wrapper.emitted('new-game')).toBeUndefined();
  });

  it('pressing Escape emits ONLY "dismiss" — never "rematch" or "new-game"', async () => {
    const wrapper = mountHarness({ complete: true, winnerSeats: [0] });

    await wrapper.find('.game-over-card').trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('dismiss')).toHaveLength(1);
    expect(wrapper.emitted('rematch')).toBeUndefined();
    expect(wrapper.emitted('new-game')).toBeUndefined();
  });

  it('after dismiss, the card is removed and the board region is present and focusable', async () => {
    const wrapper = mountHarness({ complete: true, winnerSeats: [0] });

    expect(wrapper.find('.game-over-card').exists()).toBe(true);

    await wrapper.find('[aria-label="Close"]').trigger('click');
    await nextTick();

    expect(wrapper.find('.game-over-card').exists()).toBe(false);
    const boardregion = wrapper.find('.boardregion');
    expect(boardregion.exists()).toBe(true);
    expect(boardregion.attributes('tabindex')).toBe('-1');
  });

  it('dismiss does not mutate the mounted game-state props (winnerSeats/players untouched)', async () => {
    const winnerSeats = [0];
    const wrapper = mountHarness({ complete: true, winnerSeats });

    await wrapper.find('[aria-label="Close"]').trigger('click');

    // The props passed in are the same reference/values post-dismiss — dismiss
    // is presentation-only, it never touches game state (no restart/leave op).
    expect(wrapper.props('winnerSeats')).toEqual(winnerSeats);
  });
});
