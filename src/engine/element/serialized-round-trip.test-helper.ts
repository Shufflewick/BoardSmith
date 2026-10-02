import { constructGame, type Game, type GameOptions } from './game.js';

/**
 * Round-trip a game through its serialized state into a fresh instance: the
 * restore every snapshot, undo checkpoint and `boardsmith dev` rules reload
 * makes. What survives this survives all of them.
 */
export async function serializedRoundTrip<G extends Game>(
  original: G,
  GameClass: new (options: GameOptions) => G,
): Promise<G> {
  const restored = constructGame(GameClass, {
    playerCount: original.players.length,
    playerNames: original.players.map((p) => p.name),
    // Ids are keyed by the seed (#447); every real restore carries it.
    seed: original.getConstructorOptions().seed as string,
  });
  for (const [name, cls] of original._ctx.classRegistry) restored._ctx.classRegistry.set(name, cls);
  restored.loadSerializedState(original.toJSON());
  // Let the restored game's post-construction microtask (volatile-state scan) run.
  await Promise.resolve();
  return restored;
}
