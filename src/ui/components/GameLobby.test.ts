// @vitest-environment jsdom
/**
 * GameLobby is the first screen a player sees: create a game, join one by code,
 * or resume a saved one. It talks to the dev/host server on mount, so the
 * offline path (fetch fails) has to stay usable rather than blanking the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import GameLobby from './GameLobby.vue';

const DEFINITION = {
  gameType: 'go-fish',
  displayName: 'Go Fish',
  minPlayers: 2,
  maxPlayers: 4,
};

/** Stubs the two endpoints the lobby fetches on mount. */
function stubServer(options: { definitions?: unknown[]; games?: string[]; fail?: boolean } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (options.fail) throw new Error('offline');
    if (url.endsWith('/games/definitions')) {
      return { json: async () => ({ success: true, definitions: options.definitions ?? [DEFINITION] }) };
    }
    return { json: async () => ({ success: true, games: options.games ?? [] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const mountLobby = (props: Record<string, unknown> = {}) =>
  mount(GameLobby, {
    props: { displayName: 'Go Fish', joinGameId: '', apiUrl: 'http://host', ...props },
  });

beforeEach(() => {
  stubServer();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // Cleared here, not at the end of the test that sets it: a failure or a throw
  // mid-test would otherwise leave the injected URL on `window` for every test
  // that follows in this worker.
  delete (window as unknown as Record<string, unknown>).__BOARDSMITH_API_URL__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GameLobby', () => {
  it('shows the game name', async () => {
    const wrapper = mountLobby();
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Go Fish');
  });

  it('offers both create and join', async () => {
    const wrapper = mountLobby();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('Create New Game');
    expect(text).toContain('Join Existing Game');
  });

  it('asks the server for the definition and the saved games', async () => {
    const fetchMock = stubServer();
    mountLobby();
    await flushPromises();
    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual(['http://host/games/definitions', 'http://host/games/list']);
  });

  it('emits create with the definition minimum player count', async () => {
    const wrapper = mountLobby();
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === 'Create Game')!.trigger('click');
    const [config] = wrapper.emitted('create')![0] as [Record<string, unknown>];
    expect(config.playerCount).toBe(2);
    expect(config.playerConfigs).toHaveLength(2);
  });

  it('names the default players and leaves them human', async () => {
    const wrapper = mountLobby();
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === 'Create Game')!.trigger('click');
    const [config] = wrapper.emitted('create')![0] as [{ playerConfigs: Array<Record<string, unknown>> }];
    expect(config.playerConfigs.map((p) => p.name)).toEqual(['Player 1', 'Player 2']);
    expect(config.playerConfigs.every((p) => p.isAI === false)).toBe(true);
  });

  it('marks the requested seats as AI', async () => {
    const wrapper = mountLobby({ defaultAIPlayers: [1] });
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === 'Create Game')!.trigger('click');
    const [config] = wrapper.emitted('create')![0] as [{ playerConfigs: Array<Record<string, unknown>> }];
    expect(config.playerConfigs.map((p) => p.isAI)).toEqual([false, true]);
    expect(config.playerConfigs[1].name).toBe('Bot');
    expect(config.playerConfigs[1].aiLevel).toBe('medium');
  });

  it('falls back to two players when the server never answered', async () => {
    stubServer({ fail: true });
    const wrapper = mountLobby();
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === 'Create Game')!.trigger('click');
    const [config] = wrapper.emitted('create')![0] as [{ playerCount: number }];
    expect(config.playerCount).toBe(2);
  });

  it('stays usable when the server is unreachable', async () => {
    stubServer({ fail: true });
    const wrapper = mountLobby();
    await flushPromises();
    expect(wrapper.text()).toContain('Create New Game');
    expect(wrapper.text()).toContain('Join Existing Game');
  });

  it('emits join when the join button is pressed', async () => {
    const wrapper = mountLobby({ joinGameId: 'abcd1234' });
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === 'Join Game')!.trigger('click');
    expect(wrapper.emitted('join')).toHaveLength(1);
  });

  it('binds the game-code field to its model', async () => {
    const wrapper = mountLobby();
    await flushPromises();
    await wrapper.find('input.game-code-input').setValue('xyz789');
    expect(wrapper.emitted('update:joinGameId')!.at(-1)).toEqual(['xyz789']);
  });

  it('shows the code the model already holds', async () => {
    const wrapper = mountLobby({ joinGameId: 'seeded' });
    await flushPromises();
    expect((wrapper.find('input.game-code-input').element as HTMLInputElement).value)
      .toBe('seeded');
  });

  it('hides the resume section when there is nothing saved', async () => {
    const wrapper = mountLobby();
    await flushPromises();
    expect(wrapper.text()).not.toContain('Resume Saved Game');
  });

  it('lists every saved game when there are some', async () => {
    stubServer({ games: ['game-one', 'game-two'] });
    const wrapper = mountLobby();
    await flushPromises();
    expect(wrapper.text()).toContain('Resume Saved Game');
    const resumeButtons = wrapper.findAll('button.resume');
    expect(resumeButtons.map((b) => b.text())).toEqual(['game-one', 'game-two']);
  });

  it('emits resume with the id of the saved game that was picked', async () => {
    stubServer({ games: ['game-one', 'game-two'] });
    const wrapper = mountLobby();
    await flushPromises();
    await wrapper.findAll('button.resume')[1].trigger('click');
    expect(wrapper.emitted('resume')![0]).toEqual(['game-two']);
  });

  it('renders slot content', async () => {
    const wrapper = mount(GameLobby, {
      props: { displayName: 'Go Fish', joinGameId: '', apiUrl: 'http://host' },
      slots: { default: '<p class="extra">House rules</p>' },
    });
    await flushPromises();
    expect(wrapper.find('.extra').text()).toBe('House rules');
  });

  it('uses the injected dev-server API URL when no apiUrl prop is given', async () => {
    const fetchMock = stubServer();
    (window as unknown as Record<string, unknown>).__BOARDSMITH_API_URL__ = 'http://injected:9999';
    mount(GameLobby, { props: { displayName: 'Go Fish', joinGameId: '' } });
    await flushPromises();
    expect(fetchMock.mock.calls[0][0]).toBe('http://injected:9999/games/definitions');
  });

  it('emits nothing on mount — the player has not chosen anything yet', async () => {
    const wrapper = mountLobby();
    await flushPromises();
    expect(wrapper.emitted('create')).toBeUndefined();
    expect(wrapper.emitted('join')).toBeUndefined();
    expect(wrapper.emitted('resume')).toBeUndefined();
  });
});
