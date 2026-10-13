/**
 * The variants `boardsmith simulate --compare` plays side by side (#556).
 *
 * `--compare <dimension>=v1,v2,...` varies one thing: `policy` (each value is one more `--policy`
 * flag), a declared game option, or a data file the rules import (each value is a file played in
 * its place). Repeating it gives every combination. The first value of each dimension is the base,
 * so the first variant is the run every other one is measured against.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameOptionDefinition } from '../../types/protocol.js';

/** More variants than this make a report nobody can read; split the question instead. */
const MAX_VARIANTS = 12;

/** One `--compare` flag: what it varies, and its values, base first. */
export interface CompareDimension {
  dimension: string;
  values: string[];
}

/** One side of a comparison: the run's own flags with one value of each dimension. */
export interface Variant {
  /** `dimension=value` for each dimension, space-separated; empty for a run without `--compare`. */
  label: string;
  /** The `--policy` flags its seats play by. */
  policyFlags: string[];
  /** The `--game-option` flags it is played with. */
  gameOptionFlags: string[];
  /** Project-relative data file -> the project-relative file played in its place. */
  data: Record<string, string>;
}

/**
 * Read `--compare` flags, refusing a malformed flag, a dimension or value given twice, and more
 * than {@link MAX_VARIANTS} combinations.
 */
export function parseCompare(flags: readonly string[] | undefined): CompareDimension[] {
  const dimensions = (flags ?? []).map((flag) => {
    const eq = flag.indexOf('=');
    const values = flag.slice(eq + 1).split(',');
    if (eq < 1 || values.some((value) => value === '')) {
      throw new Error(`--compare takes <dimension>=<value>,<value>,... (e.g. --compare policy=random,greedy), got "${flag}".`);
    }
    const repeated = values.find((value, i) => values.indexOf(value) !== i);
    if (repeated !== undefined) throw new Error(`--compare ${flag} names ${repeated} more than once.`);
    return { dimension: flag.slice(0, eq), values };
  });
  const repeated = dimensions.find((d, i) => dimensions.findIndex((other) => other.dimension === d.dimension) !== i);
  if (repeated !== undefined) {
    throw new Error(`--compare names ${repeated.dimension} more than once. Give all its values in one flag.`);
  }
  const count = dimensions.reduce((product, d) => product * d.values.length, 1);
  if (count > MAX_VARIANTS) {
    throw new Error(
      `--compare gives ${count} variants (every combination of its values), and a run compares at most ${MAX_VARIANTS}. ` +
        'Compare fewer values, or split the question into several runs.',
    );
  }
  return dimensions;
}

/** How one dimension changes a variant, by what it names. */
function dimensionKind(
  dimension: string,
  declaredOptions: Record<string, GameOptionDefinition> | undefined,
  gameOptionFlags: readonly string[],
): 'policy' | 'option' | 'data' {
  if (dimension === 'policy') return 'policy';
  if (declaredOptions !== undefined && Object.hasOwn(declaredOptions, dimension)) {
    if (gameOptionFlags.some((flag) => flag.startsWith(`${dimension}=`))) {
      throw new Error(`--game-option ${dimension} and --compare ${dimension} both set "${dimension}". Give its values in --compare only.`);
    }
    return 'option';
  }
  if (dimension.includes('/')) return 'data';
  const declared = Object.keys(declaredOptions ?? {});
  throw new Error(
    `--compare ${dimension}: "${dimension}" is not policy, a game option this game declares ` +
      `(${declared.length > 0 ? declared.join(', ') : 'it declares none'}), or a data file path such as src/rules/data/cards.csv.`,
  );
}

/**
 * Every combination of the dimensions' values, first dimension slowest, applied over the run's own
 * `--policy` and `--game-option` flags. Without dimensions, the one variant is the run itself.
 * Data file values are checked to exist, relative to `cwd`.
 */
export function buildVariants(
  dimensions: readonly CompareDimension[],
  run: { cwd: string; policyFlags: readonly string[]; gameOptionFlags: readonly string[] },
  declaredOptions: Record<string, GameOptionDefinition> | undefined,
): Variant[] {
  let variants: Variant[] = [{ label: '', policyFlags: [...run.policyFlags], gameOptionFlags: [...run.gameOptionFlags], data: {} }];
  for (const { dimension, values } of dimensions) {
    const kind = dimensionKind(dimension, declaredOptions, run.gameOptionFlags);
    if (kind === 'data') {
      const missing = values.find((value) => !existsSync(resolve(run.cwd, value)));
      if (missing !== undefined) throw new Error(`--compare ${dimension}: ${missing} does not exist.`);
    }
    variants = variants.flatMap((variant) =>
      values.map((value) => ({
        label: [variant.label, `${dimension}=${value}`].filter(Boolean).join(' '),
        policyFlags: kind === 'policy' ? [...variant.policyFlags, value] : variant.policyFlags,
        gameOptionFlags: kind === 'option' ? [...variant.gameOptionFlags, `${dimension}=${value}`] : variant.gameOptionFlags,
        // Playing a file in its own place changes nothing, so it is no swap.
        data: kind === 'data' && resolve(run.cwd, value) !== resolve(run.cwd, dimension) ? { ...variant.data, [dimension]: value } : variant.data,
      })),
    );
  }
  return variants;
}
