/** Fewer words than this match nearly any text, so a quote that short proves nothing (#819). */
const MIN_QUOTE_WORDS = 3;

/** Why a whitespace-normalized quote is too short to check, or `undefined` when it is long enough. */
export function shortQuoteProblem(quote: string): string | undefined {
  const words = quote === '' ? 0 : quote.split(' ').length;
  if (words >= MIN_QUOTE_WORDS) return undefined;
  return `has ${words} word${words === 1 ? '' : 's'}, and a quote needs at least ${MIN_QUOTE_WORDS} to be checked`;
}
