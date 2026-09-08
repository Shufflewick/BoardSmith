// @vitest-environment jsdom
/**
 * A WORLD'S HALF OF THE SHARED SHELL (#170).
 *
 * The shared unit between the two backends is not a component: it is the game
 * context plus `useActionController`, both already dependency-injected. This is
 * what a world supplies to them, and every assertion here is about the four
 * places a world's answer differs from a table's without the controller ever
 * finding out.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, shallowRef } from 'vue';
import { useWorldPlay } from './useWorldPlay.js';
import type { WorldHost } from './useWorldHost.js';
import type { WorldActionOffer, WorldNarration, WorldPlayer, WorldPhase } from './worldProtocol.js';

function fakeHost(over: Partial<Record<string, unknown>> = {}) {
  const host = {
    phase: ref<WorldPhase>('watching'),
    view: shallowRef<unknown>({ player: 4, phase: 'watching', state: { className: 'Game', children: [] } }),
    seat: ref<number | null>(4),
    actions: ref<readonly WorldActionOffer[]>([]),
    notice: ref<string | null>(null),
    worldName: ref<string | null>('Gloamhall'),
    presence: ref<readonly number[] | null>([2, 4]),
    players: ref<readonly WorldPlayer[]>([]),
    events: ref<readonly WorldNarration[]>([]),
    heardFromHost: ref(true),
    hostSilent: ref(false),
    acting: ref(false),
    act: vi.fn(async () => ({ ok: true })),
    resolvePick: vi.fn(async () => ({ ok: true })),
    start: vi.fn(),
    stop: vi.fn(),
    handleMessage: vi.fn(),
    ...over,
  } as unknown as WorldHost;
  return host;
}

const TEND: WorldActionOffer = {
  name: 'tend',
  prompt: 'Tend which holding?',
  selections: [
    {
      name: 'holding',
      type: 'element',
      prompt: 'Which holding?',
      validElements: [
        { id: 11, display: 'North Field', refs: [{ ref: { name: 'h11' }, role: 'highlight' }] },
        { id: 12, display: 'South Field', refs: [{ ref: { name: 'h12' }, role: 'highlight' }] },
      ],
    },
  ],
};

describe('what the controller is handed', () => {
  it('offers the seat every action the world enumerated', () => {
    const host = fakeHost();
    host.actions.value = [TEND, { name: 'look', selections: [] }];
    const play = useWorldPlay(host);
    expect(play.availableActions.value).toEqual(['tend', 'look']);
    expect(play.actionMetadata.value.tend).toEqual(TEND);
  });

  it('carries a predictable refusal as a disabled reason, not a hidden button', () => {
    const host = fakeHost();
    host.actions.value = [{ ...TEND, disabled: 'your holding is bare' }];
    const play = useWorldPlay(host);
    expect(play.availableActions.value).toContain('tend');
    expect(play.disabledActions.value).toEqual({ tend: 'your holding is bare' });
  });

  it('says the viewer may act whenever they are attached and seated', () => {
    const host = fakeHost();
    expect(play(host).mayAct.value).toBe(true);
  });

  it('says a spectator may not act', () => {
    const host = fakeHost({ seat: ref<number | null>(null) });
    expect(play(host).mayAct.value).toBe(false);
  });

  it('says a lost or refused viewer may not act', () => {
    for (const phase of ['attaching', 'lost', 'refused'] as const) {
      expect(play(fakeHost({ phase: ref(phase) })).mayAct.value).toBe(false);
    }
  });
});

function play(host: WorldHost) { return useWorldPlay(host); }

describe('the local fetchPickChoices (#170 §2.1)', () => {
  it('resolves a pick from the offer the shell already holds, off the wire', async () => {
    const host = fakeHost();
    host.actions.value = [TEND];
    const result = await play(host).fetchPickChoices('tend', 'holding', 4, {});
    expect(result.success).toBe(true);
    expect(result.validElements).toEqual(TEND.selections[0]!.validElements);
    expect(host.act).not.toHaveBeenCalled();
  });

  it('resolves a choice pick the same way', async () => {
    const host = fakeHost();
    host.actions.value = [{
      name: 'say',
      selections: [{ name: 'mood', type: 'choice', choices: [{ value: 'glad', display: 'Glad' }] }],
    }];
    const result = await play(host).fetchPickChoices('say', 'mood', 4, {});
    expect(result.choices).toEqual([{ value: 'glad', display: 'Glad' }]);
  });

  it('fails loudly for an action the seat was never offered', async () => {
    const result = await play(fakeHost()).fetchPickChoices('tend', 'holding', 4, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tend/);
  });

  it('fails loudly for a selection the offer does not name', async () => {
    const host = fakeHost();
    host.actions.value = [TEND];
    const result = await play(host).fetchPickChoices('tend', 'weather', 4, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/weather/);
  });
});

describe('re-asking one pick once something is bound (ShufflewickPub #378)', () => {
  /** A ship, then a crew whose size the ship decides. The offer's own copy is
   *  what the world could say before any ship existed. */
  const DEPLOY: WorldActionOffer = {
    name: 'deploy',
    selections: [
      { name: 'ship', type: 'choice', choices: [{ value: 'dory', display: 'Dory' }] },
      {
        name: 'crew',
        type: 'choice',
        choices: [{ value: 'ash', display: 'Ash' }],
        multiSelect: { min: 1 },
      },
    ],
  };

  it('asks the world again, with the args bound so far', async () => {
    const resolvePick = vi.fn(async () => ({
      ok: true,
      selection: {
        name: 'crew',
        type: 'choice' as const,
        choices: [{ value: 'ash', display: 'Ash' }, { value: 'vale', display: 'Vale' }],
        multiSelect: { min: 1, max: 2 },
      },
    }));
    const host = fakeHost({ resolvePick });
    host.actions.value = [DEPLOY];

    const result = await play(host).fetchPickChoices('deploy', 'crew', 4, { ship: 'dory' });

    expect(resolvePick).toHaveBeenCalledWith('deploy', 'crew', { ship: 'dory' });
    // THE CAP THE GAME MEANT, which the one-shot offer could not have known.
    expect(result.multiSelect).toEqual({ min: 1, max: 2 });
    expect(result.choices).toHaveLength(2);
  });

  it('costs NO round trip while nothing is bound, which is most picks', async () => {
    const host = fakeHost();
    host.actions.value = [DEPLOY];

    const result = await play(host).fetchPickChoices('deploy', 'ship', 4, {});

    expect(host.resolvePick).not.toHaveBeenCalled();
    expect(result.choices).toEqual(DEPLOY.selections[0]!.choices);
  });

  it('reports the world\'s own refusal rather than a stale offer', async () => {
    // Falling back to the offer here would show the player a cap the world has
    // just said is wrong, which is the divergence the round trip exists to end.
    const host = fakeHost({
      resolvePick: vi.fn(async () => ({ ok: false, message: 'That ship has already sailed.' })),
    });
    host.actions.value = [DEPLOY];

    const result = await play(host).fetchPickChoices('deploy', 'crew', 4, { ship: 'dory' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('That ship has already sailed.');
  });
});

describe('sending an action', () => {
  it('submits every selection at once, single-shot', async () => {
    const host = fakeHost();
    const result = await play(host).sendAction('tend', { holding: 11 });
    expect(host.act).toHaveBeenCalledWith('tend', { holding: 11 });
    expect(result.success).toBe(true);
  });

  it('turns a refusal into a failed result rather than throwing', async () => {
    const host = fakeHost({ act: vi.fn(async () => ({ ok: false, message: 'your holding is bare' })) });
    const result = await play(host).sendAction('tend', {});
    expect(result).toEqual({ success: false, error: 'your holding is bare' });
  });
});

describe('who the seats are', () => {
  it('uses the names the host composed', () => {
    const host = fakeHost();
    (host as any).players.value = [{ seat: 4, name: 'Ivy', color: '#0f0' }, { seat: 2, name: 'Rook' }];
    expect(play(host).players.value).toEqual([
      { seat: 4, name: 'Ivy', color: '#0f0' },
      { seat: 2, name: 'Rook' },
    ]);
  });

  it('falls back to seat numbers when the host sent no names, and invents nothing else', () => {
    const host = fakeHost();
    host.presence.value = [2, 4];
    const players = play(host).players.value;
    expect(players.map(p => p.seat).sort()).toEqual([2, 4]);
    expect(players.every(p => /^Seat \d+$/.test(p.name))).toBe(true);
  });

  it('still shows the viewer their own row when nobody else is known', () => {
    const host = fakeHost();
    host.presence.value = null;
    expect(play(host).players.value).toEqual([{ seat: 4, name: 'Seat 4' }]);
  });

  it('has no rows at all for a spectator of a world that named nobody', () => {
    const host = fakeHost({ seat: ref<number | null>(null), presence: ref(null) });
    expect(play(host).players.value).toEqual([]);
  });
});

describe('the log (#170 §2.4)', () => {
  it('renders only the events the game wrote a sentence for', () => {
    const host = fakeHost();
    host.events.value = [
      { scope: 'room:cellar', payload: { kind: 'fire' } },
      { scope: 'room:cellar', payload: { kind: 'fire' }, text: 'The fire gutters.', type: 'ambient' },
    ];
    expect(play(host).messages.value).toEqual([{ text: 'The fire gutters.', type: 'ambient' }]);
  });

  it('is empty, never invented, when nothing carried a sentence', () => {
    const host = fakeHost();
    host.events.value = [{ scope: 'room:cellar', payload: { kind: 'fire' } }];
    expect(play(host).messages.value).toEqual([]);
  });
});

describe('the board', () => {
  it('hands the board the same serialized element tree a table sends', () => {
    const host = fakeHost();
    const tree = { className: 'Game', children: [{ className: 'Holding' }] };
    host.view.value = { player: 4, phase: 'watching', state: tree };
    expect(play(host).gameView.value).toBe(tree);
  });

  it('has no board before the world has answered', () => {
    const host = fakeHost();
    host.view.value = null;
    expect(play(host).gameView.value).toBeNull();
  });
});
