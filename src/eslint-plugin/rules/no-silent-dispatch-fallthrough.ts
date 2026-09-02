import type { Rule } from 'eslint';

/**
 * Disallows a per-item dispatch written as a chain of `if (...) { ...; continue; }`
 * with nothing after it.
 *
 * Rationale (issue #161): an item whose type matches no branch reaches the end
 * of the loop body having produced NOTHING -- no outcome, no refusal, no
 * record. In a game that reads as "the card was played and simply had no
 * effect", and no test fails, because nothing asserts that every item produces
 * an outcome. It is the same class of defect as a refusal that names no error:
 * a code path whose failure mode is silence.
 *
 * The fix is a `switch` over the discriminant returning an outcome, which
 * TypeScript can then prove exhaustive, or an `else` that records one.
 *
 * SYNTACTIC-ONLY HEURISTIC (no type information available -- this repo's
 * eslint.config.mjs sets `parserOptions.project: false`), matching the
 * convention of the other rules in this plugin. A loop is flagged when ALL of:
 *
 *   (a) Its body is a block whose LAST statement is an `if` with no `else`
 *       whose consequent ends in `continue` -- so an item matching no branch
 *       falls off the end of the body having run nothing.
 *   (b) The trailing run of such `if` statements is at least
 *       MIN_DISPATCH_BRANCHES long. One trailing `if (...) continue` is a
 *       filter (`if (card.spent) continue`), not a dispatch; two or more in a
 *       row, with no unconditional work after them, is a dispatch chain.
 *
 * ACCEPTED BOUNDS (documented, not bugs):
 *   - False negatives: a dispatch chain that ends with an unconditional
 *     statement which is itself a no-op, or one written over `return` inside
 *     a per-item callback rather than `continue` inside a loop, is not
 *     flagged. Both need intent or type information a syntactic rule lacks.
 *   - False positives: a chain of two or more genuine filters at the END of a
 *     loop body, with no work after them, is flagged. That shape is already
 *     redundant (the trailing `continue`s do nothing), so rewriting it is an
 *     improvement rather than a workaround.
 *
 * Not auto-fixable: what an unmatched item should DO is the decision the
 * missing branch was supposed to make.
 */

/**
 * How many trailing `if (...) { ...; continue; }` statements make a chain a
 * dispatch rather than a filter. One is `if (card.spent) continue`.
 */
const MIN_DISPATCH_BRANCHES = 2;

interface AstNode {
  type: string;
  [key: string]: unknown;
}

/** Does this statement definitely end the current loop iteration via `continue`? */
function endsInContinue(statement: AstNode | undefined | null): boolean {
  if (!statement) return false;
  if (statement.type === 'ContinueStatement') return true;
  if (statement.type === 'BlockStatement') {
    const body = (statement.body as AstNode[] | undefined) ?? [];
    return endsInContinue(body[body.length - 1]);
  }
  return false;
}

/**
 * An `if` with no `else` whose consequent ends the iteration -- one link of a
 * dispatch chain.
 */
function isDispatchBranch(statement: AstNode | undefined): boolean {
  if (!statement || statement.type !== 'IfStatement') return false;
  if (statement.alternate) return false;
  return endsInContinue(statement.consequent as AstNode);
}

function checkLoop(context: Rule.RuleContext, loop: AstNode): void {
  const body = loop.body as AstNode | undefined;
  if (!body || body.type !== 'BlockStatement') return;

  const statements = (body.body as AstNode[] | undefined) ?? [];
  let index = statements.length - 1;
  let branches = 0;
  while (index >= 0 && isDispatchBranch(statements[index])) {
    branches += 1;
    index -= 1;
  }

  if (branches < MIN_DISPATCH_BRANCHES) return;

  context.report({
    node: statements[statements.length - branches] as unknown as Rule.Node,
    messageId: 'silentFallthrough',
    data: { branches: String(branches) },
  });
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a per-item dispatch written as a chain of `if (...) { ...; continue; }` with nothing after it. An item matching no branch produces no outcome at all -- no refusal, no error, no record -- and no test fails. Use a switch returning an outcome (which TypeScript can prove exhaustive) or add an else that records one.',
      recommended: true,
    },
    messages: {
      silentFallthrough:
        'This dispatch has {{branches}} `if (...) continue` branches and nothing after them, so an item matching none of them produces no outcome at all -- it is announced and then silently does nothing. Make it a `switch` returning an outcome (TypeScript then proves it exhaustive), or add a final `else` that records what happened.',
    },
    schema: [],
  },

  create(context) {
    const check = (node: Rule.Node): void => checkLoop(context, node as unknown as AstNode);
    return {
      ForStatement: check,
      ForOfStatement: check,
      ForInStatement: check,
      WhileStatement: check,
      DoWhileStatement: check,
    };
  },
};

export default rule;
