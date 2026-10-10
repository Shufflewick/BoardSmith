/**
 * `test-step-sfc.ts` — the code inside a source file, for `boardsmith test-step-check` (#425).
 *
 * A TypeScript file is code from end to end. A Vue single-file component is not: its code is the
 * `<script>` and `<script setup>` blocks, plus the expressions in its template. The check reads
 * each of those as its own region, parsed with the same TypeScript parser as any other file, and
 * maps what it finds back to offsets and lines in the component. Without this a chunk's component
 * logic was never mutated, so a test that pinned only that logic was blamed for asserting nothing.
 */
import { parse as parseSfc } from 'vue/compiler-sfc';

/** A stretch of a file that parses on its own as TypeScript. */
interface CodeRegion {
  /** The text to parse. */
  text: string;
  /** Add to an offset in `text` to get the offset in the file. */
  offset: number;
  /** The file line of `text`'s first line. */
  firstLine: number;
}

// The template node kinds this reads (Vue's NodeTypes, which `vue/compiler-sfc` does not export).
const ELEMENT = 1;
const INTERPOLATION = 5;
const DIRECTIVE = 7;

/**
 * Directives whose value is a plain expression the component computes: a bound prop or attribute,
 * a condition, text. Event handlers, loops, slots and v-model are statements, loop headers,
 * patterns or assignment targets, not values a mutant can flip.
 */
const VALUE_DIRECTIVES = new Set(['bind', 'if', 'else-if', 'show', 'text', 'html']);

interface ExpressionLike {
  content?: unknown;
  loc: { start: { offset: number }; end: { offset: number } };
}

/** The part of a template node this reads. */
interface TemplateNode {
  type: number;
  props?: ReadonlyArray<{ type: number; name: string; exp?: ExpressionLike }>;
  // Unknown because a compound expression's children include plain strings and symbols.
  children?: readonly unknown[];
  content?: unknown;
}

function isTemplateNode(value: unknown): value is TemplateNode {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'number';
}

const isComponent = (file: string) => file.endsWith('.vue');

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function region(source: string, text: string, offset: number): CodeRegion {
  return { text, offset, firstLine: lineAt(source, offset) };
}

function describeComponent(file: string, source: string) {
  const { descriptor, errors } = parseSfc(source, { filename: file });
  if (errors.length > 0) {
    throw new Error(
      `Could not read ${file} as a Vue component: ${errors[0].message}\n` +
        'Fix the component (run `boardsmith typecheck`) and run this check again.',
    );
  }
  return descriptor;
}

/** The script code of a file: all of it, or a component's `<script>` and `<script setup>` blocks. */
export function scriptRegions(file: string, source: string): CodeRegion[] {
  if (!isComponent(file)) return [{ text: source, offset: 0, firstLine: 1 }];
  const descriptor = describeComponent(file, source);
  return [descriptor.script, descriptor.scriptSetup]
    .filter((block) => block !== null)
    .sort((a, b) => a.loc.start.offset - b.loc.start.offset)
    .map((block) => region(source, block.content, block.loc.start.offset));
}

/** A simple expression's text and where it starts in the file. */
function expressionAt(file: string, source: string, exp: ExpressionLike): { text: string; start: number } | undefined {
  if (typeof exp.content !== 'string' || exp.content.trim() === '') return undefined;
  // A directive's location includes its quotes; the expression is the content inside them.
  const within = source.slice(exp.loc.start.offset, exp.loc.end.offset).indexOf(exp.content);
  if (within < 0) {
    throw new Error(
      `Vue placed the template expression "${exp.content}" at a part of ${file} that does not hold it, so this ` +
        'check cannot mutate it. This is a BoardSmith bug: file an issue with the component attached.',
    );
  }
  return { text: exp.content, start: exp.loc.start.offset + within };
}

/**
 * The expressions of a component's template bindings, conditions and interpolations, each as
 * `(expression)` so it parses as a statement. The offset puts the added `(` one character before
 * the expression, so offsets inside the expression land where it is in the file.
 */
function templateRegions(file: string, source: string): CodeRegion[] {
  const template = describeComponent(file, source).template;
  if (!template?.ast) return [];
  const regions: CodeRegion[] = [];
  const add = (exp: ExpressionLike | undefined) => {
    const found = exp && expressionAt(file, source, exp);
    if (found) regions.push({ text: `(${found.text})`, offset: found.start - 1, firstLine: lineAt(source, found.start) });
  };
  const visit = (node: TemplateNode) => {
    if (node.type === ELEMENT) {
      for (const prop of node.props ?? []) {
        if (prop.type === DIRECTIVE && VALUE_DIRECTIVES.has(prop.name)) add(prop.exp);
      }
    }
    if (node.type === INTERPOLATION && isExpression(node.content)) add(node.content);
    (node.children ?? []).filter(isTemplateNode).forEach(visit);
  };
  visit(template.ast);
  return regions;
}

function isExpression(value: unknown): value is ExpressionLike {
  return typeof value === 'object' && value !== null && 'loc' in value && 'content' in value;
}

/** Every region of a file a mutant may change: its script code, and a component's template expressions. */
export function codeRegions(file: string, source: string): CodeRegion[] {
  return isComponent(file) ? [...scriptRegions(file, source), ...templateRegions(file, source)] : scriptRegions(file, source);
}
