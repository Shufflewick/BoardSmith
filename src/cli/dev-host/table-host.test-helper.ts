/**
 * A TABLE PROJECT ON DISK, RUN BY THE `boardsmith dev` HOST.
 *
 * For tests that drive the real table road: the author's rules written to a
 * project, bundled by the same loader `boardsmith dev` uses
 * (`loadTableRuntime`), and run through `MultiplayerHost` with one seated
 * client, `dev`. Nothing here is a hand-built runtime.
 */
import { loadTableRuntime, type TableRuntime } from '../commands/dev-table-runtime.js';
import { MultiplayerHost, type HostOutbound, type MultiplayerHostOptions } from './multiplayer-host.js';
import { rulesProject } from './rules-project.test-helper.js';
import type { createDevHostClientMemory } from './test-client-memory.js';

/** A table project whose rules are `source`, and the one move an author makes to it: saving them. */
export function tableProject(prefix: string, source: string) {
  const { rulesPath, tempDir, save } = rulesProject(prefix, source);
  const load = (): Promise<TableRuntime> => loadTableRuntime(rulesPath, tempDir, 'monorepo');
  return { save, load };
}

type GameStateFrame = Extract<HostOutbound, { type: 'game_state' }>;
type OpResponse = { success: boolean; error?: string };

/**
 * A one-seat table running `runtime`, with the `dev` client seated.
 * `options` are passed to the host beside the seat range and the rules.
 */
export async function openTable(
  runtime: TableRuntime,
  clients: ReturnType<typeof createDevHostClientMemory>,
  options: Pick<MultiplayerHostOptions, 'makeSeed' | 'clock' | 'idleAction' | 'hostWork'>,
) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    ...options,
    playerCount: 1,
    minPlayers: 1,
    maxPlayers: 1,
    executeOp: runtime.rules.executeOp,
    send: (clientId, msg) => {
      sent.push({ clientId, msg });
      clients.remember(clientId, msg);
    },
  });
  await host.handleMessage('dev', { type: 'hello' });
  const frames = (): GameStateFrame[] =>
    sent.filter((e) => e.clientId === 'dev' && e.msg.type === 'game_state').map((e) => e.msg as GameStateFrame);
  const errors = () =>
    sent.filter((e) => e.msg.type === 'error').map((e) => ({ to: e.clientId, message: (e.msg as { message: string }).message }));
  let request = 0;
  /** Send `op` as `dev`, and return the host's answer to it (undefined when it sent none). */
  const ask = async (op: string, payload: Record<string, unknown>): Promise<OpResponse | undefined> => {
    const requestId = `${op}-${++request}`;
    await host.handleMessage('dev', { type: 'server_request', requestId, op, payload });
    const response = sent
      .filter((e) => e.msg.type === 'server_response')
      .map((e) => e.msg as Extract<HostOutbound, { type: 'server_response' }>)
      .find((m) => m.requestId === requestId);
    return response?.result as OpResponse | undefined;
  };
  /** Take `actionName` as `dev`, echoing the boundary key of the board it last rendered. */
  const act = (actionName: string) => ask('action', { actionName, args: {}, boundaryKey: clients.key('dev') });
  return { host, sent, frames, errors, ask, act };
}
