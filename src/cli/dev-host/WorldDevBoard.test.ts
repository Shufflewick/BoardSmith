// @vitest-environment jsdom
/**
 * #167: THE SHELL'S OWN SURFACE, for a world project that ships no
 * `world.html`.
 *
 * `example-rts` and `example-mud` are both that shape, so this is the board an
 * author of a world prototype actually looks at. What it must do is draw the
 * actions the world offered THIS SEAT, ask for each selection's answer out of
 * the candidates that selection actually has, and emit what `WorldShell`
 * expects -- because it is handed exactly what a game's own board is handed and
 * is expected to answer in exactly the same way.
 *
 * WHAT #169 CHANGED HERE. The board used to be drawn from a static argument
 * DECLARATION: `move` wanted a room, and the only rooms a bundle could name
 * were all of them, because a bundle can state what a world CONTAINS and not
 * what is legal this instant. An offer is enumerated now, so the fixture below
 * is the table's own `ActionMetadata` with each selection's candidates already
 * resolved -- and the two shapes this board has to draw are a CHOICE (values
 * the game named) and an ELEMENT (ids off the board, which is what makes a
 * click on a room wire straight through with no mapping to write).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import WorldDevBoard from './WorldDevBoard.vue';
import type { WorldActionOffer } from '../../ui/world/worldProtocol.js';

const ACTIONS: WorldActionOffer[] = [
  { name: 'look', prompt: 'Look around', selections: [] },
  {
    name: 'move',
    prompt: 'Walk into another room',
    selections: [
      {
        name: 'to',
        type: 'choice',
        prompt: 'Where to?',
        choices: [
          { value: 'hall', display: 'The Dusk Hall' },
          { value: 'cellar', display: 'The Cellar' },
        ],
      },
    ],
  },
  {
    name: 'kindle',
    prompt: 'Bank logs on a slow burn',
    selections: [
      { name: 'logs', type: 'number', prompt: 'How many logs?', min: 1, integer: true },
    ],
  },
  {
    name: 'say',
    prompt: 'Say something',
    selections: [{ name: 'text', type: 'text', prompt: 'What do you say?' }],
  },
  {
    name: 'tend',
    prompt: "Put timber back on a neighbour's land",
    selections: [
      {
        name: 'neighbour',
        type: 'element',
        prompt: 'Whose land?',
        validElements: [
          { id: 41, display: "Bramble's holding" },
          { id: 42, display: "Cinder's holding", disabled: 'Already at full growth' },
        ],
      },
    ],
  },
];

function board(overrides: Record<string, unknown> = {}) {
  return mount(WorldDevBoard, {
    props: {
      view: { room: 'hall' },
      seat: 2,
      actions: ACTIONS,
      acting: false,
      worldName: 'The Dusk Hall',
      presence: [1, 2],
      events: [],
      ...overrides,
    },
  });
}

describe('#167: it draws the actions the world offered this seat', () => {
  it('offers one form per action, with its prompt', () => {
    const wrapper = board();
    expect(wrapper.findAll('.dev-board__command')).toHaveLength(5);
    expect(wrapper.text()).toContain('Walk into another room');
  });

  it('says so plainly when a world offers this seat nothing', () => {
    // A blank panel and a world with nothing to do in it look identical, which
    // is the confusion this whole surface exists to end.
    expect(board({ actions: [] }).text()).toContain('nothing it can do right now');
  });

  it('asks for each selection in the shape the offer declared it', () => {
    const wrapper = board();
    const selects = wrapper.findAll('select');
    // Two `<select>`s: the choice's two rooms, and the element's two holdings.
    expect(selects).toHaveLength(2);
    expect(selects[0]!.findAll('option')).toHaveLength(2);
    expect(selects[1]!.findAll('option')).toHaveLength(2);
    expect(wrapper.findAll('input[type="number"]')).toHaveLength(1);
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1);
  });

  it('greys the candidate the world said no to, WITH the reason', () => {
    // The whole point of the `disabled` channel (#169): a neighbour at full
    // growth is greyed with the sentence the game wrote, rather than the board
    // accepting the click and the world refusing it afterwards.
    const wrapper = board();
    const holdings = wrapper.findAll('select')[1]!.findAll('option');
    expect(holdings[1]!.attributes('disabled')).toBeDefined();
    expect(holdings[1]!.text()).toContain('Already at full growth');
    expect(holdings[0]!.attributes('disabled')).toBeUndefined();
  });

  it('greys a whole action out with its reason rather than hiding it', () => {
    // The same channel one level up. An action offered but not takeable right
    // now keeps its place on the panel and says why, because a button that
    // vanishes teaches a player nothing about how to get it back.
    const wrapper = board({
      actions: [{ name: 'tend', selections: [], disabled: 'You have no log to spend' }],
    });
    expect(wrapper.find('.dev-board__command button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('You have no log to spend');
  });
});

describe('#167: it emits what WorldShell expects', () => {
  it('emits act with the action name and no arguments for a bare verb', async () => {
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
    // The selection was declared as one, so the world is entitled to one.
    // Handing it the string an input gives back is the shape of bug this
    // surface exists to keep out of an author's way.
    const wrapper = board();
    const kindle = wrapper.findAll('.dev-board__command')[2]!;
    await kindle.find('input[type="number"]').setValue('3');
    await kindle.find('button').trigger('submit');
    expect(wrapper.emitted('act')).toEqual([['kindle', { logs: 3 }]]);
  });

  it('sends an element selection as the element ID', async () => {
    // The wire encoding `chooseElement` already has, which is the whole reason
    // the element form matters for a world: a custom board wires a click on the
    // holding straight to this value with nothing in between, and the engine
    // resolves the id back to the element on the way in.
    const wrapper = board();
    const tend = wrapper.findAll('.dev-board__command')[4]!;
    await tend.find('button').trigger('submit');
    expect(wrapper.emitted('act')).toEqual([['tend', { neighbour: 41 }]]);
  });

  it('keeps one draft per action, so filling one does not clear another', async () => {
    const wrapper = board();
    await wrapper.findAll('.dev-board__command')[3]!.find('input[type="text"]').setValue('hello');
    await wrapper.findAll('.dev-board__command')[2]!.find('input[type="number"]').setValue('2');
    await wrapper.findAll('.dev-board__command')[3]!.find('button').trigger('submit');
    expect(wrapper.emitted('act')).toEqual([['say', { text: 'hello' }]]);
  });

  it('will not send a second action while one is unanswered', async () => {
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
