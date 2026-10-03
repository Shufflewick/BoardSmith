/**
 * `test-step-guard.ts`: whether a guard test runs the game's code (#443). `boardsmith
 * test-step-check` reports a guard the chunk wrote or changed that does.
 *
 * A guard (a file under `tests/guards/`) reads source as text, such as the a11y floor's
 * colour-literal and asset scans, so it is never mutation-tested. A guard that mounts a component
 * or dispatches an action would be a behaviour test hidden from the mutation check, so it is a
 * finding. Reading a component as text (`readFileSync`, or an import ending `.vue?raw`) is a scan.
 */
import { findDispatches, parseSource, walk, type AstNode } from './test-step-ast.js';

/** Modules a scan never needs: they mount components or run a game. */
const CODE_RUNNING_MODULES = new Set(['@vue/test-utils', 'boardsmith/testing']);

/** The shell stub that mounts a board as a seat. */
const MOUNTING_HELPERS = new Set(['renderAsSeat']);

export interface CodeRunInGuard {
  line: number;
  /** What the line does, in words for the finding, e.g. `imports ../src/ui/Bid.vue`. */
  what: string;
}

function importedModule(node: AstNode): string | undefined {
  if (node.type !== 'ImportDeclaration' && node.type !== 'ImportExpression') return undefined;
  const source = node.source as AstNode;
  return source.type === 'Literal' && typeof source.value === 'string' ? source.value : undefined;
}

/**
 * The first line of a guard that runs the game's code: an import of a `.vue` component, of
 * `@vue/test-utils` or `boardsmith/testing`, a use of `renderAsSeat`, or an action dispatched
 * through the engine (`wrappers` are the project's own dispatch helpers). Undefined for a scan.
 */
export function findCodeRunInGuard(
  source: string,
  file: string,
  wrappers: ReadonlyMap<string, number>,
): CodeRunInGuard | undefined {
  const found: CodeRunInGuard[] = [];
  walk(parseSource(source, file).ast, (node) => {
    const module = importedModule(node);
    if (module !== undefined && (module.endsWith('.vue') || CODE_RUNNING_MODULES.has(module))) {
      found.push({ line: node.loc.start.line, what: `imports ${module}` });
    }
    if (node.type === 'Identifier' && MOUNTING_HELPERS.has(node.name as string)) {
      found.push({ line: node.loc.start.line, what: `uses ${node.name as string}` });
    }
  });
  for (const { verb, line } of findDispatches(source, file, wrappers)) {
    found.push({ line, what: `dispatches the action "${verb}"` });
  }
  return found.sort((a, b) => a.line - b.line)[0];
}
