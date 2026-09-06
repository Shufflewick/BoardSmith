// @vitest-environment jsdom
/**
 * #167: THE SHELL'S OWN SURFACE, for a world project that ships no
 * `world.html`.
 *
 * `example-rts` and `example-mud` are both that shape, so this is the board an
 * author of a world prototype actually looks at. What it must do is draw the
 * verbs the world declared, ask for the arguments they declared, and emit what
 * `WorldShell` expects -- because it is handed exactly what a game's own board
 * is handed and is expected to answer in exactly the same way.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import WorldDevBoard from './WorldDevBoard.vue';
import type { WorldCommandOffer } from '../../ui/world/worldProtocol.js';

const COMMANDS: WorldCommandOffer[] = [
  { name: 'look', prompt: 'Look around', args: [] },
  {
    name: 'move',
    prompt: 'Walk into another room',
    args: [
      {
        name: 'to',
        prompt: 'Where to?',
        kind: 'choice',
        choices: [
          { value: 'hall', label: 'The Dusk Hall' },
          { value: 'cellar', label: 'The Cellar' },
        ],
      },
    ],
  },
  {
    name: 'kindle',
    prompt: 'Bank logs on a slow burn',
    args: [{ name: 'logs', prompt: 'How many logs?', kind: 'number', min: 1, integer: true }],
  },
  {
    name: 'say',
    prompt: 'Say something',
    args: [{ name: 'text', prompt: 'What do you say?', kind: 'text' }],
  },
];

function board(overrides: Record<string, unknown> = {}) {
  return mount(WorldDevBoard, {
    props: {
      view: { room: 'hall' },
      seat: 2,
      commands: COMMANDS,
      acting: false,
      worldName: 'The Dusk Hall',
      presence: [1, 2],
      events: [],
      ...overrides,
    },
  });
}

describe('#167: it draws the verbs the world declared', () => {
  it('offers one form per command, with its prompt', () => {
    const wrapper = board();
    expect(wrapper.findAll('.dev-board__command')).toHaveLength(4);
    expect(wrapper.text()).toContain('Walk into another room');
  });

  it('says so plainly when a world declares no command a player may issue', () => {
    // A blank panel and a world with no verbs look identical, which is the
    // confusion this whole surface exists to end.
    expect(board({ commands: [] }).text()).toContain('declares no command a player may issue');
  });

  it('asks for each argument in the shape the bundle declared it', () => {
    const wrapper = board();
    expect(wrapper.find('select').findAll('option')).toHaveLength(2);
    expect(wrapper.findAll('input[type="number"]')).toHaveLength(1);
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1);
  });
});

describe('#167: it emits what WorldShell expects', () => {
  it('emits act with the command name and no arguments for a bare verb', async () => {
    const wrapper = board();
    await wrapper.findAll('.dev-board__command')[0]!.find('button').trigger('submit');
    expect(wrapper.emitted('act')).toEqual([['look', {}]]);
  });

  it('sends a choice as the declared VALUE, not the label a person read', async () => {
    const wrapper = board();
    const move = wrapper.findAll('.dev-board__command')[1]!;
    await move.find('select').setValue('cellar');
    await move.find('button').trigger('submit');
    expect(wrapper.emitted('act')).toEqual([['move', { to: 'cellar' }]]);
  });

  it('sends a NUMBER argument as a number', async () => {
    // The bundle declared it a number, so a handler is entitled to one.
    // Handing it the string an input gives back is the shape of bug this
    // surface exists to keep out of an author's way.
    const wrapper = board();
    const kindle = wrapper.findAll('.dev-board__command')[2]!;
    await kindle.find('input[type="number"]').setValue('3');
    await kindle.find('button').trigger('submit');
    expect(wrapper.emitted('act')).toEqual([['kindle', { logs: 3 }]]);
  });

  it('keeps one draft per command, so filling one does not clear another', async () => {
    const wrapper = board();
    await wrapper.findAll('.dev-board__command')[3]!.find('input[type="text"]').setValue('hello');
    await wrapper.findAll('.dev-board__command')[2]!.find('input[type="number"]').setValue('2');
    await wrapper.findAll('.dev-board__command')[3]!.find('button').trigger('submit');
    expect(wrapper.emitted('act')).toEqual([['say', { text: 'hello' }]]);
  });

  it('will not send a second command while one is unanswered', async () => {
    expect(board({ acting: true }).find('.dev-board__command button').attributes('disabled')).toBeDefined();
  });
});

describe('#167: it reports what the world said and what the seat can see', () => {
  it('names the seat and who else is present', () => {
    expect(board().text()).toContain('You are seat 2');
    expect(board().text()).toContain('Present: 1, 2');
  });

  it('renders narration as the scope it was addressed to and the payload', () => {
    const wrapper = board({
      events: [{ scope: 'room:hall', payload: { said: 'hello', by: 1 } }],
    });
    expect(wrapper.text()).toContain('room:hall');
    expect(wrapper.text()).toContain('"said":"hello"');
  });

  it('shows every byte the seat was sent, because only the game knows what it means', () => {
    // Rendering the projection as JSON is the honest answer, not a shortcut:
    // anything else would be an invented reading of the game's own data.
    expect(board().find('pre').text()).toContain('"room": "hall"');
  });

  it('says why it is on screen at all', () => {
    expect(board().text()).toContain('ships no');
    expect(board().text()).toContain('world.html');
  });
});
