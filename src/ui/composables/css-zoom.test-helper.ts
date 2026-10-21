/**
 * Make jsdom look like Firefox before 126, which has no CSS `zoom` property
 * (#1361). Returns a function that puts it back.
 */
export function withoutCssZoom(): () => void {
  let proto: object | null = document.documentElement.style;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'zoom')) proto = Object.getPrototypeOf(proto);
  if (!proto) throw new Error('jsdom has no style.zoom to remove; this helper needs updating for the installed jsdom.');
  const owner = proto;
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'zoom')!;
  delete (owner as Record<string, unknown>).zoom;
  return () => Object.defineProperty(owner, 'zoom', descriptor);
}
