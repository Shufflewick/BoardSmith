// @vitest-environment jsdom
/**
 * What the smoke walk reads off the page in one look (#461, #462, #464). The walk runs these in
 * Chromium over a locator's matches; here they run over the same markup in jsdom.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { clickReached, guardClicks, numberToEnter, pageControls, pageDialogs } from './browser-smoke-page.js';

// jsdom lays nothing out, so it has no `checkVisibility` and no `innerText`: here every element
// is visible, and its text as laid out is its text.
beforeAll(() => {
  Element.prototype.checkVisibility = () => true;
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent;
    },
  });
});

function page(html: string): Element[] {
  document.body.innerHTML = html;
  return [...document.querySelectorAll('button, [role="button"], [aria-modal], dialog')];
}

const buttons = (elements: Element[]) => elements.filter((e) => e.matches('button, [role="button"]'));
// jsdom cannot match `dialog:modal`, so these pages hold `aria-modal` dialogs only.
const dialogs = (elements: Element[]) => elements.filter((e) => e.matches('[aria-modal="true"]'));

describe('pageControls', () => {
  it('reads each control by its label, its game element when it has one, and whether it can be pressed', () => {
    const elements = page(`
      <div data-testid="bs-board">
        <button aria-label="Draw from the deck" data-bs-el-id="12">Deck</button>
        <button title="Shuffle">S</button>
        <div role="button" aria-disabled="true">  Pass
          now </div>
        <button disabled>Wait</button>
      </div>`);
    expect(pageControls(buttons(elements))).toEqual([
      { index: 0, label: 'Draw from the deck', key: 'element:12', enabled: true, keyboardOnly: false, candidate: false, onBoard: true, marked: false },
      { index: 1, label: 'Shuffle', key: 'label:Shuffle', enabled: true, keyboardOnly: false, candidate: false, onBoard: true, marked: false },
      { index: 2, label: 'Pass now', key: 'label:Pass now', enabled: false, keyboardOnly: false, candidate: false, onBoard: true, marked: false },
      { index: 3, label: 'Wait', key: 'label:Wait', enabled: false, keyboardOnly: false, candidate: false, onBoard: true, marked: false },
    ]);
  });

  it("knows a pick's candidate by the choice it stands for when it has no game element", () => {
    const elements = page(`<button data-bs-candidate="north">North row</button><button data-bs-candidate="x" data-bs-el-id="7">Card</button>`);
    expect(pageControls(buttons(elements)).map((c) => [c.key, c.candidate])).toEqual([
      ['candidate:north', true],
      ['element:7', true],
    ]);
  });

  it('#457: marks a control that takes no pointer and cannot be seen as one pressed from the keyboard', () => {
    const elements = page(`<button style="pointer-events: none">Keys</button><button style="pointer-events: none">Shown</button>`);
    Element.prototype.checkVisibility = function (this: Element) {
      return this.textContent !== 'Keys';
    };
    try {
      expect(pageControls(buttons(elements)).map((c) => c.keyboardOnly)).toEqual([true, false]);
    } finally {
      Element.prototype.checkVisibility = () => true;
    }
  });

  it("#462: leaves out the game-over card's own controls, so its Close never hides the game ending", () => {
    const elements = page(`
      <div data-testid="bs-board">
        <button>Plan</button>
        <div class="game-over-scrim"><div class="game-over-card" role="dialog" aria-modal="true">
          <button aria-label="Close">x</button><button>Rematch</button>
        </div></div>
      </div>`);
    expect(pageControls(buttons(elements)).map((c) => c.label)).toEqual(['Plan']);
  });

  it('#461: leaves out a control in an inert subtree, which nobody can reach, keeping each one its place', () => {
    const elements = page(`
      <div inert><button>Behind</button></div>
      <button>Front</button>`);
    expect(pageControls(buttons(elements))).toEqual([
      { index: 1, label: 'Front', key: 'label:Front', enabled: true, keyboardOnly: false, candidate: false, onBoard: false, marked: false },
    ]);
  });
});

describe('pageControls marking the control to press (#464 review)', () => {
  it('marks the control with the key it was found by, wherever it now is, and says which it marked', () => {
    const elements = page(`<button>East</button><button>North</button><button>South</button>`);
    const found = pageControls(buttons(elements), { key: 'label:North', index: 0, mark: '7' });
    expect(found.filter((c) => c.marked).map((c) => c.label)).toEqual(['North']);
    expect(document.querySelector('[data-bs-smoke-press="7"]')?.textContent).toBe('North');
  });

  it('prefers the one at the same place when two share a key, and marks none when the key is gone', () => {
    const elements = page(`<button>Close</button><button>Close</button>`);
    expect(pageControls(buttons(elements), { key: 'label:Close', index: 1, mark: '8' }).map((c) => c.marked)).toEqual([false, true]);
    expect(pageControls(buttons(elements), { key: 'label:Open', index: 0, mark: '9' }).some((c) => c.marked)).toBe(false);
    expect(document.querySelector('[data-bs-smoke-press="9"]')).toBeNull();
  });
});

describe('pageDialogs', () => {
  it('#461: finds each open modal dialog by its name, the one on top last', () => {
    const elements = page(`
      <div role="dialog" aria-modal="true" aria-label="Red discards"><button>Close</button></div>
      <div role="dialog" aria-modal="true" aria-labelledby="rules-title"><h2 id="rules-title">The rules</h2></div>
      <div role="dialog" aria-modal="true"><h3>Settings</h3></div>`);
    expect(pageDialogs(dialogs(elements))).toEqual([
      { index: 0, name: 'Red discards' },
      { index: 1, name: 'The rules' },
      { index: 2, name: 'Settings' },
    ]);
  });

  it('#462: does not count the game-over card, which the walk reads as the game ending', () => {
    const elements = page(`<div class="game-over-card" role="dialog" aria-modal="true" aria-label="Game Over"></div>`);
    expect(pageDialogs(dialogs(elements))).toEqual([]);
  });
});

describe('numberToEnter (#465)', () => {
  function field(attributes: string): HTMLInputElement {
    document.body.innerHTML = `<input type="number" ${attributes}>`;
    return document.querySelector('input')!;
  }

  it("enters the field's own least value, which its rules accept", () => {
    expect(numberToEnter(field('min="3" max="9" step="1"'), 0)).toBe('3');
    expect(numberToEnter(field('min="-2" step="any"'), 0)).toBe('-2');
  });

  it('enters 1 when the field sets no least value, or its most when that is below 1', () => {
    expect(numberToEnter(field('step="1"'), 0)).toBe('1');
    expect(numberToEnter(field('max="0" step="1"'), 0)).toBe('0');
  });

  it('enters a whole number for a field that takes whole numbers', () => {
    expect(numberToEnter(field('min="0.5" max="4" step="1"'), 0)).toBe('1');
    expect(numberToEnter(field('min="0.5" max="4" step="any"'), 0)).toBe('0.5');
  });

  it('#466: enters the next value up for each value the game refused, never past its most', () => {
    expect(numberToEnter(field('min="1" max="40" step="1"'), 1)).toBe('2');
    expect(numberToEnter(field('min="1" max="40" step="1"'), 2)).toBe('3');
    expect(numberToEnter(field('min="1" max="2" step="1"'), 5)).toBe('2');
  });
});

describe('guardClicks and clickReached: what a pointed click reached (#468)', () => {
  const CLICK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

  function dispatchClick(on: Element): void {
    for (const type of CLICK_EVENTS) on.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }

  it('says the click reached the control when its events land on it or inside it', () => {
    document.body.innerHTML = `<button id="card"><span id="rank">7</span></button>`;
    guardClicks(document.getElementById('card')!);
    dispatchClick(document.getElementById('rank')!);
    expect(clickReached()).toBe('it');
  });

  it('stops a click on anything else before the page sees it, and says the click reached something else', () => {
    document.body.innerHTML = `<button id="card">7</button><button id="other">Pass</button>`;
    const other = document.getElementById('other')!;
    let pressed = 0;
    other.addEventListener('click', () => pressed++);
    guardClicks(document.getElementById('card')!);
    dispatchClick(other);
    expect(pressed).toBe(0);
    expect(clickReached()).toBe('other');
    // The guard is gone with its answer: the page sees its clicks again.
    dispatchClick(other);
    expect(pressed).toBe(1);
  });

  it('says the click reached nothing when no event reached the frame, as when the page around the game covers the control', () => {
    document.body.innerHTML = `<button id="card">7</button>`;
    guardClicks(document.getElementById('card')!);
    expect(clickReached()).toBe('nothing');
  });

  it('says when the page was replaced before the click could be read, since the new page has no guard', () => {
    expect(() => clickReached()).toThrow('the game\'s page was replaced before the walk could read what the click reached');
  });
});
