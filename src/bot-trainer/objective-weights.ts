/**
 * Reading and writing the weights of a game's bot objectives in its bot.ts.
 *
 * One parser serves both directions (#523): `readObjectiveWeights` lists the
 * weights evolution starts from and `updateBotWeights` writes the evolved ones
 * back, so an objective one of them can see is always one the other can.
 *
 * An objective is a property whose value is an object literal with both a
 * `checker` and a `weight`, which is the shape `Record<string, Objective>`
 * takes in bot.ts. Its id is the property's name.
 */
import ts from 'typescript';
import type { ObjectiveWeight } from './types.js';

/** One objective's weight as written in the source, and where. */
interface WeightInSource extends ObjectiveWeight {
  /** Character range of the weight's value expression. */
  start: number;
  end: number;
}

/**
 * Every objective weight in `source`, in source order.
 *
 * Throws, naming the objective, when a weight is not written as a number
 * (`weight: 5`, `weight: -2.5`): there is nothing to tune in an expression,
 * and passing over it would leave the author believing it was tuned. Throws
 * too when two objectives share an id.
 */
export function readObjectiveWeights(source: string): ObjectiveWeight[] {
  return weightsInSource(source).map(({ id, weight }) => ({ id, weight }));
}

/** Options for {@link updateBotWeights}. */
export interface UpdateWeightsOptions {
  /** Add metadata comment about evolution */
  addMetadata?: boolean;
  /** Evolution statistics to include in metadata */
  evolutionStats?: {
    generations: number;
    population: number;
    initialWinRate: number;
    finalWinRate: number;
  };
}

/**
 * `source` with each objective's weight replaced by the one `weights` gives
 * its id, rounded to one decimal place. Everything else is left as written.
 *
 * Throws, naming them, when `weights` has an id that `source` has no
 * objective for.
 */
export function updateBotWeights(
  source: string,
  weights: ObjectiveWeight[],
  options: UpdateWeightsOptions = {},
): string {
  const found = weightsInSource(source);
  const known = new Set(found.map((w) => w.id));
  const missing = weights.filter((w) => !known.has(w.id)).map((w) => `'${w.id}'`);
  if (missing.length > 0) {
    throw new Error(
      `Cannot write the evolved weights back: bot.ts has no objective ${missing.join(', ')}. ` +
        'Was bot.ts edited while the evolution ran?',
    );
  }

  const weightById = new Map(weights.map((w) => [w.id, w.weight]));
  let result = source;
  // From the end, so each replacement leaves the earlier ranges where they were.
  for (const literal of [...found].reverse()) {
    const weight = weightById.get(literal.id);
    if (weight === undefined) continue;
    result = result.slice(0, literal.start) + String(Math.round(weight * 10) / 10) + result.slice(literal.end);
  }

  if (options.addMetadata && options.evolutionStats) {
    result = withEvolutionMetadata(result, options.evolutionStats);
  }
  return result;
}

function weightsInSource(source: string): WeightInSource[] {
  const file = ts.createSourceFile('bot.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: WeightInSource[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.initializer)) {
      const objective = objectiveIn(node, file);
      if (objective) found.push(objective);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  const ids = found.map((w) => w.id);
  const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (repeated.length > 0) {
    throw new Error(
      `bot.ts declares the objective ${repeated.map((id) => `'${id}'`).join(', ')} more than once, so there ` +
        'is no one weight to tune for it. Give each objective its own id.',
    );
  }
  return found;
}

/** The objective `property` declares, or undefined when it is not one. */
function objectiveIn(property: ts.PropertyAssignment, file: ts.SourceFile): WeightInSource | undefined {
  const members = (property.initializer as ts.ObjectLiteralExpression).properties;
  const named = (name: string) => members.find((m) => m.name !== undefined && propertyName(m.name) === name);
  const weight = named('weight');
  if (!named('checker') || !weight || !ts.isPropertyAssignment(weight)) return undefined;

  const id = propertyName(property.name);
  if (id === undefined) return undefined;

  const value = numberLiteral(weight.initializer);
  if (value === undefined) {
    throw new Error(
      `The weight of objective '${id}' in bot.ts is \`${weight.initializer.getText(file)}\`, not a number. ` +
        'evolve-bot-weights can only tune weights written as numbers, such as `weight: 5`.',
    );
  }
  return { id, weight: value, start: weight.initializer.getStart(file), end: weight.initializer.getEnd() };
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

function numberLiteral(expression: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return -Number(expression.operand.text);
  }
  return undefined;
}

/** `source` with its weight-evolution comment added before the imports, or replaced. */
function withEvolutionMetadata(source: string, stats: NonNullable<UpdateWeightsOptions['evolutionStats']>): string {
  const metadataComment = [
    `//`,
    `// Weight Evolution (${new Date().toISOString().split('T')[0]}):`,
    `//   Generations: ${stats.generations}`,
    `//   Population: ${stats.population}`,
    `//   Initial win rate: ${(stats.initialWinRate * 100).toFixed(1)}%`,
    `//   Final win rate: ${(stats.finalWinRate * 100).toFixed(1)}%`,
    `//   Improvement: ${((stats.finalWinRate - stats.initialWinRate) * 100).toFixed(1)}%`,
    `//`,
  ].join('\n');

  const importIndex = source.indexOf('import ');
  if (importIndex <= 0) return source;
  const beforeImport = source.slice(0, importIndex);
  const afterImport = source.slice(importIndex);
  if (beforeImport.includes('Weight Evolution')) {
    return beforeImport.replace(/\/\/\s*\n\/\/ Weight Evolution[^]*?\/\/\s*\n/, metadataComment + '\n') + afterImport;
  }
  return beforeImport + metadataComment + '\n' + afterImport;
}
