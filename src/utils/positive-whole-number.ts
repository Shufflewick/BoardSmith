/** `raw` as a positive whole number, or an error naming the setting (`--games`, a spec field) and what it was given. */
export function parsePositiveWholeNumber(name: string, raw: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${name} takes a positive whole number, got "${raw}".`);
  return Number(raw);
}
