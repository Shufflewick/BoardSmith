import { applyViewPatch, type ViewPatch } from '../../session/view-patch.js';
import type { GameStateFrame, HostOutbound } from './multiplayer-host.js';

/**
 * The whole view a page holds after each of `frames`, the `game_state` frames
 * one page was sent in order: the host pushes a page a patch against the view
 * it holds after the first frame (#1616), as `DevHost.vue` applies it.
 */
export function pageViews(frames: ReadonlyArray<Record<string, unknown>>): unknown[] {
  let held: unknown;
  return frames.map((frame) => {
    held = frame.patch === undefined ? frame.view : applyViewPatch(held, frame.patch as ViewPatch);
    if (held === undefined && frame.patch !== undefined) {
      throw new Error('The host sent a page a patch against a view it does not hold.');
    }
    return held;
  });
}

/** Each `game_state` the host sent `clientId`, with the whole view its page holds once it has applied it. */
export function pageFrames(sent: ReadonlyArray<{ clientId: string; msg: HostOutbound }>, clientId: string): GameStateFrame[] {
  const frames = sent.filter((e) => e.clientId === clientId && e.msg.type === 'game_state').map((e) => e.msg as Record<string, unknown>);
  const views = pageViews(frames);
  return frames.map(({ patch: _patch, ...fields }, i) => ({ ...fields, view: views[i] }) as GameStateFrame);
}
