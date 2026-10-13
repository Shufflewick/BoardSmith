/** The benchmark's arguments (#556): `--games <n>` per player count, 3,000 by default, and `--out <file>`. */
import { resolve } from 'node:path';

export function parseArgs(args) {
  const valueOf = (flag) => {
    const at = args.indexOf(flag);
    if (at === -1) return undefined;
    if (args[at + 1] === undefined) throw new Error(`${flag} needs a value.`);
    return args[at + 1];
  };
  const known = new Set(['--games', '--out']);
  const unknown = args.filter((arg, at) => arg.startsWith('--') && !known.has(arg) && !known.has(args[at - 1]));
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown[0]}. Use --games <n> and --out <file>.`);
  const games = Number(valueOf('--games') ?? 3000);
  if (!Number.isInteger(games) || games < 1) throw new Error('--games must be a whole number of games, 1 or more.');
  const out = valueOf('--out');
  return { games, out: out === undefined ? undefined : resolve(out) };
}
