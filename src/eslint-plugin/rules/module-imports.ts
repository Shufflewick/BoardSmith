import type { Rule } from 'eslint';

/**
 * Visitors that hand every module a file loads by a fixed name (`import x from`,
 * `export … from 'x'`, `import x = require('x')`, `import('x')`, `require('x')`)
 * to `check`, without the `node:` prefix.
 * `onComputed` gets an `import()` whose module name is computed at run time.
 */
export function moduleImportVisitors(
  check: (name: string, node: Rule.Node) => void,
  onComputed?: (node: Rule.Node) => void,
): Rule.RuleListener {
  const checkName = (name: string, node: Rule.Node) => check(name.replace(/^node:/, ''), node);
  return {
    ImportDeclaration(node) {
      if (typeof node.source.value === 'string') checkName(node.source.value, node);
    },

    ExportNamedDeclaration(node) {
      if (typeof node.source?.value === 'string') checkName(node.source.value, node);
    },

    ExportAllDeclaration(node) {
      if (typeof node.source.value === 'string') checkName(node.source.value, node);
    },

    // TypeScript's `import x = require('x')`; ESLint's own types do not list TS nodes.
    TSExternalModuleReference(node: Rule.Node & { expression: { type: string; value?: unknown } }) {
      if (node.expression.type === 'Literal' && typeof node.expression.value === 'string') {
        checkName(node.expression.value, node);
      }
    },

    CallExpression(node) {
      const [first] = node.arguments;
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        first?.type === 'Literal' &&
        typeof first.value === 'string'
      ) {
        checkName(first.value, node);
      }
    },

    ImportExpression(node) {
      const source = node.source;
      if (source.type === 'Literal' && typeof source.value === 'string') {
        checkName(source.value, node);
      } else if (source.type === 'TemplateLiteral' && source.expressions.length === 0) {
        checkName(source.quasis[0].value.cooked!, node);
      } else {
        onComputed?.(node);
      }
    },
  };
}
