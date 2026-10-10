import type { FlowDefinition } from './types.js';

/** Every key a flow definition takes; typed so a new FlowDefinition key must be added here. */
const FLOW_DEFINITION_KEYS = {
  root: true,
  setup: true,
  onEnterPhase: true,
  onExitPhase: true,
} satisfies Record<keyof FlowDefinition, true>;

/** Keys #503 moved from the flow definition to Game. */
const MOVED_TO_GAME = new Set(['isComplete', 'getWinners']);

/**
 * Throw on any key a flow definition does not take. Called by `Game.setFlow()`,
 * so a definition that skipped the typecheck (a test run strips types) fails
 * here instead of having the key silently ignored.
 */
export function refuseUnknownFlowKeys(definition: object): void {
  for (const key of Object.keys(definition)) {
    if (Object.hasOwn(FLOW_DEFINITION_KEYS, key)) continue;
    if (MOVED_TO_GAME.has(key)) {
      throw new Error(
        `This flow definition has \`${key}\`, which flow definitions no longer take (#503).\n` +
        `  Fix: remove \`${key}\` from setFlow({...}) and declare the end on your Game: ` +
        `override isFinished() and getWinners(), or call finish(winners).`,
      );
    }
    throw new Error(
      `This flow definition has \`${key}\`, which is not a flow definition key.\n` +
      `  A flow definition takes only: ${Object.keys(FLOW_DEFINITION_KEYS).join(', ')}.\n` +
      `  Fix: remove \`${key}\` from setFlow({...}) or correct its name.`,
    );
  }
}
