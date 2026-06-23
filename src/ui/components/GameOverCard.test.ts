// @vitest-environment jsdom
/**
 * GameOverCard unit tests — Phase 100, Plan 06 [TDD]
 *
 * Behaviors under test:
 *   1. With winnerSeats=[1] and players=[{seat:0},{seat:1}], the card names
 *      the winner from seat 1.
 *   2. With winnerSeats=[] (dev-mode degrade), the card renders "Game Over"
 *      with no winner names but still shows the action buttons.
 *   3. Clicking "Rematch" emits 'rematch'; clicking "New Game" emits 'new-game'.
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GameOverCard from './GameOverCard.vue';

const PLAYERS = [
  { seat: 0, name: 'Alice', color: '#e74c3c' },
  { seat: 1, name: 'Bob', color: '#3498db' },
];

describe('GameOverCard — winner naming', () => {
  it('displays the winner name when winnerSeats is non-empty', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [1], players: PLAYERS },
    });

    expect(wrapper.text()).toContain('Bob');
  });

  it('shows singular "wins" for a single winner', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [0], players: PLAYERS },
    });

    expect(wrapper.find('#game-over-title').text()).toContain('wins');
  });

  it('lists both winners for a tie / multiple winners', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [0, 1], players: PLAYERS },
    });

    const titleText = wrapper.find('#game-over-title').text();
    expect(titleText).toContain('Alice');
    expect(titleText).toContain('Bob');
  });
});

describe('GameOverCard — dev-mode graceful degrade (winnerSeats=[])', () => {
  it('renders "Game Over" as title when winnerSeats is empty', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [], players: PLAYERS },
    });

    expect(wrapper.find('#game-over-title').text()).toBe('Game Over');
  });

  it('does not show any player names when winnerSeats is empty', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [], players: PLAYERS },
    });

    expect(wrapper.find('.winners').exists()).toBe(false);
  });

  it('still shows New Game and Rematch buttons when winnerSeats is empty', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [], players: PLAYERS },
    });

    const buttons = wrapper.findAll('button');
    const labels = buttons.map(b => b.text());
    expect(labels).toEqual(expect.arrayContaining(['New Game', 'Rematch']));
  });
});

describe('GameOverCard — emits on button clicks', () => {
  it('emits "rematch" when Rematch is clicked', async () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [0], players: PLAYERS },
    });

    const rematchBtn = wrapper.findAll('button').find(b => b.text() === 'Rematch');
    expect(rematchBtn).toBeDefined();
    await rematchBtn!.trigger('click');

    expect(wrapper.emitted('rematch')).toHaveLength(1);
  });

  it('emits "new-game" when New Game is clicked', async () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [1], players: PLAYERS },
    });

    const newGameBtn = wrapper.findAll('button').find(b => b.text() === 'New Game');
    expect(newGameBtn).toBeDefined();
    await newGameBtn!.trigger('click');

    expect(wrapper.emitted('new-game')).toHaveLength(1);
  });
});

describe('GameOverCard — structure', () => {
  it('renders the scrim overlay element', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [], players: PLAYERS },
    });

    expect(wrapper.find('.game-over-scrim').exists()).toBe(true);
  });

  it('has role="dialog" on the card', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [], players: PLAYERS },
    });

    const card = wrapper.find('.game-over-card');
    expect(card.exists()).toBe(true);
    expect(card.attributes('role')).toBe('dialog');
  });

  it('has aria-labelledby pointing at the title element', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [], players: PLAYERS },
    });

    const card = wrapper.find('.game-over-card');
    expect(card.attributes('aria-labelledby')).toBe('game-over-title');
  });
});
