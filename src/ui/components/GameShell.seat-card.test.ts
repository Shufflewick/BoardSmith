// @vitest-environment jsdom
/**
 * GameShell → PlayersPanel boundary for the two seat-card levers (B13).
 *
 * `PlayersPanel.seat-card.test.ts` proves the slot and the prop work on the
 * panel. That is not enough on its own: a game never mounts PlayersPanel, it
 * fills a GameShell slot. If GameShell fails to forward either one, both those
 * tests stay green while the feature is unreachable from every real game — the
 * exact "closed on evidence from a path a user never takes" failure.
 *
 * Mounting the real GameShell needs client wiring, a WS connection, and the
 * platform postMessage bridge, so this file follows the established pattern in
 * GameShell.game-over.test.ts / GameShell.player-order.test.ts: assert the
 * forwarding on GameShell.vue's actual SOURCE (so a deleted `<template
 * #player-token-extra>` fails here), and exercise the same two-level slot
 * forwarding against the REAL PlayersPanel, so the pattern itself is proven to
 * carry a scoped slot through an intermediate component.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import PlayersPanel, { type Player } from './PlayersPanel.vue';

const HERE = dirname(fileURLToPath(import.meta.url));
const gameShellSource = readFileSync(join(HERE, 'GameShell.vue'), 'utf8');

const PLAYERS: Player[] = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
];

describe('GameShell forwards the seat-card levers to PlayersPanel', () => {
  it('binds :show-turn-status on the full-card PlayersPanel', () => {
    expect(
      gameShellSource,
      'GameShell must pass showTurnStatus through to PlayersPanel — without the binding ' +
        'the prop exists on GameShell but changes nothing.',
    ).toMatch(/:show-turn-status="props\.showTurnStatus"/);
  });

  it('declares showTurnStatus with an explicit `true` default', () => {
    // Vue CASTS an absent Boolean prop to false. Without the stated default,
    // every game that never mentions the prop silently loses the sentence.
    expect(
      gameShellSource,
      'showTurnStatus must default to true in withDefaults, or omitting it opts a game OUT.',
    ).toMatch(/showTurnStatus:\s*true/);
  });

  it('forwards the #player-token-extra slot down to PlayersPanel', () => {
    expect(
      gameShellSource,
      'GameShell must re-expose PlayersPanel\'s #player-token-extra slot, or no game can reach it.',
    ).toMatch(/<template #player-token-extra="\{ player \}">/);
    expect(gameShellSource).toMatch(/<slot\s+name="player-token-extra"/);
  });

  it('gives the forwarded slot the player it is for', () => {
    const block = gameShellSource.slice(
      gameShellSource.indexOf('<template #player-token-extra'),
      gameShellSource.indexOf('<template #player-stats'),
    );
    expect(block, 'the forwarded slot must bind :player, or content cannot differ per seat').toMatch(
      /:player="player"/,
    );
  });
});

describe('two-level slot forwarding reaches the real PlayersPanel', () => {
  // Mirrors GameShell's shape: an outer component that exposes its own slot and
  // re-emits it into PlayersPanel's slot of the same name.
  const ShellLike = defineComponent({
    name: 'ShellLike',
    components: { PlayersPanel },
    props: {
      players: { type: Array as () => Player[], default: () => PLAYERS },
      showTurnStatus: { type: Boolean, default: true },
    },
    template: `
      <PlayersPanel
        :players="players"
        :player-seat="0"
        :current-player-seat="0"
        :show-turn-status="showTurnStatus"
      >
        <template #player-token-extra="{ player }">
          <slot name="player-token-extra" :player="player"></slot>
        </template>
      </PlayersPanel>`,
  });

  it('lands game content in the token column, per seat', () => {
    const wrapper = mount(ShellLike, {
      slots: {
        'player-token-extra': '<template #default="{ player }"><i class="p">{{ player.name }}</i></template>',
      },
    });
    expect(wrapper.findAll('.player-token-wrap .p').map(n => n.text())).toEqual(['Alice', 'Bob']);
  });

  it('shows the turn-status sentence when the shell does not opt out', () => {
    expect(mount(ShellLike).find('.turn-status').text()).toBe('Your move');
  });

  it('suppresses the sentence when the shell passes showTurnStatus=false', () => {
    const wrapper = mount(ShellLike, { props: { showTurnStatus: false } });
    expect(wrapper.find('.turn-status').exists()).toBe(false);
    // ...without costing the seat its turn identity.
    expect(wrapper.find('.player-card.current').exists()).toBe(true);
    expect(wrapper.find('.turn-pulse').exists()).toBe(true);
  });
});
