import { promises as fs } from 'node:fs';
import { GATE_TRANSITION_MD, designPath } from './project-paths.js';

/**
 * `design/GATE-TRANSITION.md` (#397): the one-time record of the chunks a project had verified
 * before the sign-off gate (#291) and the claim-quote gate (#289) existed. Written only by
 * `boardsmith chunk-gate-transition`; read by `checkSignoff` (a `transition` sign-off counts only
 * for a chunk named here) and by `claim-quote-check` (a claim recorded here without a quote is
 * accepted while its text is unchanged).
 */

/** A chunk given a `transition` sign-off: the verified Status it keeps, and why it had no valid one. */
export interface TransitionedSignoff {
  slug: string;
  status: string;
  reason: string;
}

/** A sign-off in the old whole-file form whose code still matched, rewritten file by file. */
export interface KeptSignoff {
  slug: string;
  basis: string;
}

export interface GateTransition {
  /** When the designer recorded the transition. Every `transition` sign-off carries this time. */
  recorded: string;
  by: string;
  signoffs: TransitionedSignoff[];
  kept: KeptSignoff[];
  /** Per chunk: each claim that had no quote, by number, with the hash of its text then. */
  claims: Record<string, Record<number, string>>;
}

const TITLE = '# Gate Transition';
const SIGNOFFS = '## Transitioned Sign-offs';
const KEPT = '## Kept Sign-offs';
const CLAIMS = '## Claims Without Quotes';

const HEADER = `${TITLE}

<!-- MACHINE-OWNED. Written once by \`boardsmith chunk-gate-transition\` and by nothing else. The
     designer named below recorded that the chunks listed here were verified before BoardSmith
     required a recorded sign-off (#291) and a quoted source under every claim (#289).
     \`boardsmith chunk-check\` accepts a \`transition\` sign-off only for a chunk under
     "${SIGNOFFS}", and \`boardsmith claim-quote-check\` accepts a claim under "${CLAIMS}" without a
     quote only while its text is unchanged. A claim added or changed since needs its quote. -->
`;

function field(body: string, label: string): string {
  return new RegExp(`^- ${label}:[ \\t]*(.*)$`, 'm').exec(body)?.[1].trim() ?? '';
}

/** The `### <slug>` entries under one `## ` section, each with its body. */
function entries(text: string, heading: string): Array<{ slug: string; body: string }> {
  const start = text.indexOf(`\n${heading}\n`);
  if (start === -1) return [];
  const rest = text.slice(start + heading.length + 2);
  const next = /^## /m.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  const parts = section.split(/^### (\S+)[ \t]*$/m);
  const found: Array<{ slug: string; body: string }> = [];
  for (let i = 1; i < parts.length; i += 2) found.push({ slug: parts[i], body: parts[i + 1] ?? '' });
  return found;
}

function parseClaims(body: string): Record<number, string> {
  const claims: Record<number, string> = {};
  for (const m of body.matchAll(/^- Claim (\d+):[ \t]*([0-9a-f]{64})[ \t]*$/gm)) claims[Number(m[1])] = m[2];
  return claims;
}

function parseGateTransition(text: string): GateTransition {
  const recorded = field(text.split(/^## /m)[0], 'Recorded');
  const by = field(text.split(/^## /m)[0], 'By');
  if (!recorded || !by) {
    throw new Error(
      `design/${GATE_TRANSITION_MD} has no "- Recorded:" and "- By:" lines, so the transition it ` +
        `records cannot be read. Restore it from git; it is written only by ` +
        `\`boardsmith chunk-gate-transition\`.`,
    );
  }
  return {
    recorded,
    by,
    signoffs: entries(text, SIGNOFFS).map((e) => ({
      slug: e.slug,
      status: field(e.body, 'Status'),
      reason: field(e.body, 'Reason'),
    })),
    kept: entries(text, KEPT).map((e) => ({ slug: e.slug, basis: field(e.body, 'Basis') })),
    claims: Object.fromEntries(entries(text, CLAIMS).map((e) => [e.slug, parseClaims(e.body)])),
  };
}

/** The project's transition record, or `undefined` when it has never run. */
export async function readGateTransition(projectDir: string): Promise<GateTransition | undefined> {
  const text = await fs.readFile(designPath(projectDir, GATE_TRANSITION_MD), 'utf-8').catch(() => undefined);
  return text === undefined ? undefined : parseGateTransition(text);
}

export function renderGateTransition(t: GateTransition): string {
  const section = (heading: string, items: string[]) => (items.length ? [`${heading}\n`, ...items] : []);
  return [
    HEADER,
    `- Recorded: ${t.recorded}`,
    `- By: ${t.by}`,
    '',
    ...section(
      SIGNOFFS,
      t.signoffs.map((s) => `### ${s.slug}\n- Status: ${s.status}\n- Reason: ${s.reason}\n`),
    ),
    ...section(KEPT, t.kept.map((k) => `### ${k.slug}\n- Basis: ${k.basis}\n`)),
    ...section(
      CLAIMS,
      Object.entries(t.claims).map(
        ([slug, claims]) =>
          `### ${slug}\n${Object.entries(claims)
            .map(([n, hash]) => `- Claim ${n}: ${hash}`)
            .join('\n')}\n`,
      ),
    ),
  ].join('\n');
}
