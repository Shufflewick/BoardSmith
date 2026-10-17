/**
 * Escape a value for use inside a double-quoted CSS string, such as an
 * attribute selector value: `[data-id="${escapeCssString(id)}"]`.
 * Quotes, backslashes and line breaks become hex escapes; everything else is left as is.
 */
export function escapeCssString(value: string): string {
  return value.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}
