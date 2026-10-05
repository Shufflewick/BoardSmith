// @vitest-environment jsdom
/**
 * A TABLE'S SHELL ANNOUNCES ITSELF TO ITS HOST (ShufflewickPub #486).
 *
 * `WorldShell` has always said hello on mount -- `useWorldHost.start()` posts
 * `world_ready` -- and that one message is the whole reason a world's host can
 * tell "the surface loaded and never started" from "the surface is running and
 * the player has not moved". A table's shell said nothing at boot, so its host
 * had no way to be honest about the same failure: a bundle whose script threw
 * and a bundle drawing a quiet board look identical from the other side of a
 * cross-origin frame, and a host that guessed from a timeout alone would
 * accuse every healthy table in the catalogue.
 *
 * So platform mode now posts `game_ready`, and it is the table twin of
 * `world_ready` in name, shape and timing. What the host does with it is the
 * host's business; what this file holds is that the shell sends it, exactly
 * once, and only when there is a host to send it to.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

function mountShell() {
  return mountPlatformShell();
}

afterEach(leaveIframe);

describe('GameShell platform boot announcement (#486)', () => {
  it('says hello to the host on mount, so a host can tell a dead surface from a quiet one', async () => {
    const posted = enterIframe();
    const wrapper = mountShell();
    await nextTick();

    expect(posted).toContainEqual({ source: 'shufflewick-game', type: 'game_ready' });
    wrapper.unmount();
  });

  it('says it exactly once, so a host counting arrivals is counting documents', async () => {
    const posted = enterIframe();
    const wrapper = mountShell();
    await nextTick();
    await nextTick();

    const hellos = posted.filter(
      (message) => (message as { type?: unknown }).type === 'game_ready',
    );
    expect(hellos).toHaveLength(1);
    wrapper.unmount();
  });

  it('says nothing when there is no host, because a top-level page is nobody\'s frame', async () => {
    const posted: unknown[] = [];
    const spy = vi.spyOn(window, 'postMessage').mockImplementation((m) => {
      posted.push(m);
    });
    // `window.parent === window` here: `enterIframe` was not called, so the
    // shell is not in platform mode at all.
    const wrapper = mountShell();
    await nextTick();

    expect(posted).toEqual([]);
    spy.mockRestore();
    wrapper.unmount();
  });
});
