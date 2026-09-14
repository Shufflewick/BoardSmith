// @vitest-environment jsdom
/**
 * A reason bubble opened inside the GameShell iframe must close when the player
 * goes somewhere else in the page AROUND the iframe (#266).
 *
 * The shell runs in an iframe in both platform and dev-host mode, so "the
 * document" a control lives in is the frame's, not the top one. #261 made the
 * dismiss listener follow the element into that frame deliberately. The gesture
 * that breaks is the one that crosses the boundary: the player tabs onto a
 * dimmed control inside the frame, then clicks the page outside it. That
 * pointerdown is dispatched in the PARENT document and never reaches the
 * frame's listener, and the focused control inside the frame is not blurred by
 * it either, so nothing closed the bubble and it stayed painted at full opacity
 * while the player worked elsewhere.
 *
 * The one event that does cross is `blur` on the frame's own window, which
 * fires when focus leaves the frame. In production the parent may be a
 * different origin, so a listener there is not available at all; the frame's
 * own window is.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { vDisabledReason } from '../directives/vDisabledReason.js';
import { useDisabledReasonTooltip, hideDisabledReason } from './useDisabledReasonTooltip.js';

const tooltip = useDisabledReasonTooltip();

let frame: HTMLIFrameElement;
let frameDoc: Document;

/** A GameShell-shaped arrangement: the control lives in the frame's document. */
function mountInFrame(reason: string) {
  return mount(
    defineComponent({
      directives: { disabledReason: vDisabledReason },
      props: { reason: { type: String, required: true } },
      template: `<button v-disabled-reason="reason">march</button>`,
    }),
    { props: { reason }, attachTo: frameDoc.body }
  );
}

/** Tab onto `el` the way a keyboard player inside the frame gets there. */
function tabTo(el: HTMLElement): void {
  frameDoc.dispatchEvent(new (frameDoc.defaultView as Window & typeof globalThis).KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  el.dispatchEvent(new FocusEvent('focus'));
}

describe('disabled-reason tooltip across the GameShell iframe boundary', () => {
  beforeEach(() => {
    hideDisabledReason();
    frame = document.createElement('iframe');
    document.body.appendChild(frame);
    frameDoc = frame.contentDocument as Document;
  });

  afterEach(() => {
    hideDisabledReason();
    frame.remove();
  });

  it('closes when the player clicks the page outside the frame', () => {
    const wrapper = mountInFrame('A ravine blocks your way.');
    const btn = wrapper.find('button').element as HTMLElement;

    tabTo(btn);
    expect(tooltip.text.value).toBe('A ravine blocks your way.');

    // The player presses something in the surrounding page. The event is in the
    // parent document; the frame's window loses focus, which is the browser's
    // own event, not one the shell synthesises.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    (frame.contentWindow as Window).dispatchEvent(new FocusEvent('blur'));

    expect(tooltip.text.value).toBe(null);
    wrapper.unmount();
  });

  it('leaves the bubble up while the player is still inside the frame', () => {
    const wrapper = mountInFrame('The sea blocks your way.');
    const btn = wrapper.find('button').element as HTMLElement;

    tabTo(btn);
    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(tooltip.text.value).toBe('The sea blocks your way.');
    wrapper.unmount();
  });

  it('stops listening to a frame it no longer describes a control in', () => {
    const wrapper = mountInFrame('Blocked.');
    const btn = wrapper.find('button').element as HTMLElement;

    tabTo(btn);
    hideDisabledReason();
    expect(tooltip.text.value).toBe(null);

    // A later show in the TOP document must not be closed by the old frame's
    // blur: a stale listener would dismiss bubbles that have nothing to do
    // with it.
    const top = document.createElement('button');
    document.body.appendChild(top);
    const topWrapper = mount(
      defineComponent({
        directives: { disabledReason: vDisabledReason },
        template: `<button v-disabled-reason="'Still blocked.'">rest</button>`,
      }),
      { attachTo: document.body }
    );
    (topWrapper.find('button').element as HTMLElement).dispatchEvent(
      new Event('mouseenter', { bubbles: true })
    );
    expect(tooltip.text.value).toBe('Still blocked.');

    (frame.contentWindow as Window).dispatchEvent(new FocusEvent('blur'));

    expect(tooltip.text.value).toBe('Still blocked.');
    top.remove();
    topWrapper.unmount();
    wrapper.unmount();
  });
});
