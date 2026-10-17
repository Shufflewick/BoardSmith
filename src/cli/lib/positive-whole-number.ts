/** A flag's value as a positive whole number, or an error naming the flag and what it was given. */
export function parsePositiveWholeNumber(flag: string, raw: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`--${flag} takes a positive whole number, got "${raw}".`);
  return Number(raw);
}
