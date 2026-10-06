/**
 * `text` with every regular-expression metacharacter escaped, so it can be
 * embedded literally in a pattern assembled from strings (a heading, a field
 * name, a family name). The one copy in the CLI (#531).
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
