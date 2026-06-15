const fs = require('fs');
const SRC = '/Users/jtsmith/BoardSmith/.fallow/audit-raw.json';
const OUT = '/Users/jtsmith/BoardSmith/boardsmith-audit-report.html';

const GAME_SRC = '/Users/jtsmith/BoardSmith/.fallow/game-impact-raw.json';
const STATUS_SRC = '/Users/jtsmith/BoardSmith/.fallow/fix-status.json';
const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const dims = data.result.dimensions;
const gameData = JSON.parse(fs.readFileSync(GAME_SRC, 'utf8')).result.games;
const fixStatus = JSON.parse(fs.readFileSync(STATUS_SRC, 'utf8')); // {merged:{fid:{sha,desc}}, blocked:[], status:{fid:'merged'|'blocked'}}

// Build fid -> [{game,status,evidence,requiredChange,effort}] by parsing F-numbers from each impact's findingId.
const impactsByFid = {};
const gameNames = gameData.map(g => g.game);
for (const g of gameData) {
  for (const imp of g.impacts) {
    if (imp.status === 'unaffected') continue;
    const fids = (imp.findingId.match(/F\d+/g) || []);
    for (const fid of fids) {
      (impactsByFid[fid] = impactsByFid[fid] || []).push({
        game: g.game, status: imp.status, evidence: imp.evidence,
        requiredChange: imp.requiredChange, effort: imp.effort, group: imp.findingId,
      });
    }
  }
}

const sevRank = { critical: 4, high: 3, medium: 2, low: 1, invalid: 0 };
const easeRank = { easy: 1, moderate: 2, hard: 3 };
const catLabel = {
  architecture: 'Architecture',
  security: 'Security',
  performance: 'Performance',
  usability: 'Usability',
  dx: 'DX / Agent-XP',
};

// Flatten findings. Effective severity = verifier-adjusted when present & valid, else original.
// fid (F1..F29) is assigned in dimension order over CONFIRMED findings only — matching the game-vet checklist labels.
let findings = [];
let fidCounter = 0;
for (const d of dims) {
  for (const f of d.findings) {
    const verAdj = f.verifierSeverity && f.verifierSeverity !== 'invalid' ? f.verifierSeverity : null;
    const rejected = f.verified === false || f.verifierSeverity === 'invalid';
    const effective = rejected ? 'invalid' : (verAdj || f.severity);
    const fid = rejected ? null : 'F' + (++fidCounter);
    const fixState = fid ? (fixStatus.status[fid] || 'open') : 'open';
    findings.push({
      fid,
      fixState,                                   // 'merged' | 'blocked' | 'open'
      mergeInfo: fid ? (fixStatus.merged[fid] || null) : null,
      gameImpacts: fid ? (impactsByFid[fid] || []) : [],
      category: d.category,
      title: f.title,
      origSeverity: f.severity,
      verSeverity: f.verifierSeverity || null,
      effective,
      rejected,
      verified: f.verified,
      evidence: f.evidence || '',
      whyConcern: f.whyConcern || '',
      pitOfSuccessImpact: f.pitOfSuccessImpact || '',
      fixPaths: f.fixPaths || '',
      easeOfFix: f.easeOfFix || '',
      confidence: f.confidence || '',
      verifierReasoning: f.verifierReasoning || '',
    });
  }
}

// Severity sort comparator (worst first).
const confRank = { high: 3, medium: 2, low: 1 };
const bySeverity = (a, b) =>
  sevRank[b.effective] - sevRank[a.effective] ||
  sevRank[b.origSeverity] - sevRank[a.origSeverity] ||
  (confRank[b.confidence] || 0) - (confRank[a.confidence] || 0) ||
  (easeRank[a.easeOfFix] || 9) - (easeRank[b.easeOfFix] || 9);

const confirmed = findings.filter(f => !f.rejected);
const rejected = findings.filter(f => f.rejected);

// ACTIVE = still-relevant problems (open + blocked); COMPLETED = merged fixes (moved to bottom).
const active = confirmed.filter(f => f.fixState !== 'merged').sort(bySeverity);
const completed = confirmed.filter(f => f.fixState === 'merged').sort(bySeverity);
active.forEach((f, i) => (f.rank = i + 1));
completed.forEach((f) => (f.rank = null));

// Stats
const counts = { critical: 0, high: 0, medium: 0, low: 0 };
for (const f of active) if (counts[f.effective] !== undefined) counts[f.effective]++;
const statusCounts = {
  merged: confirmed.filter(f => f.fixState === 'merged').length,
  blocked: confirmed.filter(f => f.fixState === 'blocked').length,
  open: confirmed.filter(f => f.fixState === 'open').length,
};
const catCounts = {};
for (const f of confirmed) catCounts[f.category] = (catCounts[f.category] || 0) + 1;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Lightly format inline code-ish tokens (file:line, identifiers with .ts) into <code>.
function fmt(s) {
  let out = esc(s);
  // wrap file paths / file:line refs
  out = out.replace(/\b((?:src\/|\.\/)?[\w./-]+\.(?:ts|js|vue|mjs|cjs|css|md|json)(?::\d+(?:-\d+)?)?)/g, '<code>$1</code>');
  // wrap obvious code identifiers like foo() or Foo.bar
  out = out.replace(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\(\))/g, '<code>$1</code>');
  return out;
}

const sevMeta = {
  critical: { label: 'Critical', cls: 'critical' },
  high: { label: 'High', cls: 'high' },
  medium: { label: 'Medium', cls: 'medium' },
  low: { label: 'Low', cls: 'low' },
  invalid: { label: 'Rejected', cls: 'rejected' },
};

function sevBadge(s) {
  const m = sevMeta[s] || sevMeta.low;
  return `<span class="badge sev-${m.cls}">${m.label}</span>`;
}
function easeBadge(e) {
  if (!e) return '';
  return `<span class="badge ease-${e}">${e}</span>`;
}
function confBadge(c) {
  if (!c) return '';
  return `<span class="badge conf-${c}">conf: ${c}</span>`;
}
function statusBadge(s) {
  return `<span class="badge gi-${s}">${s}</span>`;
}
function fixStateBadge(f) {
  if (f.fixState === 'merged') {
    const sha = f.mergeInfo ? f.mergeInfo.sha : '';
    return `<span class="badge fx-merged" title="Merged to main${sha ? ' — ' + sha : ''}">✅ Fixed${sha ? ' · ' + sha : ''}</span>`;
  }
  if (f.fixState === 'blocked') return `<span class="badge fx-blocked" title="Needs a design decision before it can be fixed">⛔ Blocked — needs decision</span>`;
  return `<span class="badge fx-open">○ Open</span>`;
}

function gameImpactBlock(f) {
  const imps = f.gameImpacts || [];
  if (imps.length === 0) {
    return `<div class="field gi"><span class="flabel">Game impact</span><div class="ftext gi-none">No games affected — fixing this requires no changes to any current game (${gameNames.length} games checked).</div></div>`;
  }
  const order = { affected: 0, likely: 1 };
  const sorted = imps.slice().sort((a, b) => (order[a.status] - order[b.status]) || a.game.localeCompare(b.game));
  const affCount = imps.filter(i => i.status === 'affected').length;
  const likCount = imps.filter(i => i.status === 'likely').length;
  const rows = sorted.map(i => `
        <tr class="gi-row gi-row-${i.status}">
          <td class="gi-game">${esc(i.game)}</td>
          <td>${statusBadge(i.status)}</td>
          <td><span class="badge ease-wrap eff-${i.effort}">${i.effort}</span></td>
          <td class="gi-change">${fmt(i.requiredChange || '—')}<details class="gi-ev"><summary>evidence</summary><div class="mono">${fmt(i.evidence)}</div></details></td>
        </tr>`).join('');
  return `<div class="field gi"><span class="flabel">Game impact — ${affCount} affected, ${likCount} likely</span>
    <table class="gi-table">
      <thead><tr><th>Game</th><th>Status</th><th>Effort</th><th>What must change</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function row(f) {
  const downgraded = f.verSeverity && f.verSeverity !== f.origSeverity && f.verSeverity !== 'invalid';
  const sevNote = downgraded
    ? `<div class="sevnote">judge said <em>${f.origSeverity}</em>, verifier set <strong>${f.verSeverity}</strong></div>`
    : '';
  const giCount = (f.gameImpacts || []).length;
  const giBadge = giCount > 0
    ? `<span class="badge gi-count">${giCount} game${giCount > 1 ? 's' : ''} impacted</span>`
    : `<span class="badge gi-zero">0 games impacted</span>`;
  const rankCell = f.fixState === 'merged'
    ? `<span class="fid">${f.fid || ''}</span><span class="rank-done">✓</span>`
    : `${f.fid ? `<span class="fid">${f.fid}</span>` : ''}#${f.rank}`;
  const mergeNote = (f.fixState === 'merged' && f.mergeInfo)
    ? `<div class="merge-note">Merged to <code>main</code> as <code>${f.mergeInfo.sha}</code> — ${fmt(f.mergeInfo.desc)}</div>`
    : (f.fixState === 'blocked'
        ? `<div class="merge-note blocked-note">Blocked: a correct fix needs a design decision (see verifier note &amp; the auth-token gap), so it was intentionally not merged.</div>`
        : '');
  return `
  <article class="card fx-${f.fixState}" data-cat="${f.category}" data-sev="${f.effective}" data-ease="${f.easeOfFix}" data-gi="${giCount > 0 ? 'yes' : 'no'}" data-fix="${f.fixState}">
    <div class="card-head">
      <div class="rank">${rankCell}</div>
      <div class="head-main">
        <div class="badges">
          ${fixStateBadge(f)}
          ${sevBadge(f.effective)}
          <span class="badge cat cat-${f.category}">${catLabel[f.category]}</span>
          ${easeBadge(f.easeOfFix)}
          ${confBadge(f.confidence)}
          ${giBadge}
          <span class="badge verified">✓ verified vs source</span>
        </div>
        <h3>${esc(f.title)}</h3>
        ${sevNote}
        ${mergeNote}
      </div>
    </div>
    <div class="card-body">
      <div class="field"><span class="flabel">Why it's a concern</span><div class="ftext">${fmt(f.whyConcern)}</div></div>
      <div class="field pit"><span class="flabel">Pit-of-Success impact</span><div class="ftext">${fmt(f.pitOfSuccessImpact)}</div></div>
      <div class="field fix"><span class="flabel">Path(s) to fix &nbsp;<span class="ease-inline">(${f.easeOfFix})</span></span><div class="ftext">${fmt(f.fixPaths)}</div></div>
      ${gameImpactBlock(f)}
      <details class="evidence">
        <summary>Evidence (source-cited)</summary>
        <div class="ftext mono">${fmt(f.evidence)}</div>
      </details>
      <details class="verifier">
        <summary>Adversarial verifier's independent check</summary>
        <div class="ftext">${fmt(f.verifierReasoning)}</div>
      </details>
    </div>
  </article>`;
}

function rejRow(f) {
  return `
  <article class="card rejected-card" data-cat="${f.category}">
    <div class="card-head">
      <div class="head-main">
        <div class="badges">
          <span class="badge sev-rejected">Rejected by verifier</span>
          <span class="badge cat cat-${f.category}">${catLabel[f.category]}</span>
          <span class="badge">judge said: ${f.origSeverity}</span>
        </div>
        <h3>${esc(f.title)}</h3>
      </div>
    </div>
    <div class="card-body">
      <div class="field"><span class="flabel">Original claim</span><div class="ftext">${fmt(f.whyConcern)}</div></div>
      <div class="field"><span class="flabel">Why the verifier rejected / downgraded it</span><div class="ftext">${fmt(f.verifierReasoning)}</div></div>
    </div>
  </article>`;
}

const summaries = dims.map(d => `
  <div class="dim-summary">
    <h4><span class="badge cat cat-${d.category}">${catLabel[d.category]}</span> <span class="dim-count">${catCounts[d.category] || 0} confirmed</span></h4>
    <p>${fmt(d.summary)}</p>
  </div>`).join('');

// ---- Game Impact Matrix ----
// Findings that impact at least one game, ranked, as matrix rows; games as columns.
const giFindings = confirmed.filter(f => (f.gameImpacts || []).length > 0);
const cellFor = (f, game) => {
  const imp = (f.gameImpacts || []).find(i => i.game === game);
  if (!imp) return `<td class="mx-cell mx-none" title="not affected">·</td>`;
  return `<td class="mx-cell mx-${imp.status}" title="${esc(imp.requiredChange).replace(/"/g,'')}">${imp.status === 'affected' ? '●' : '○'}<span class="mx-eff">${imp.effort[0]}</span></td>`;
};
const matrixRows = giFindings.map(f => `
      <tr>
        <td class="mx-find"><span class="fid">${f.fid}</span> ${esc(f.title.length > 64 ? f.title.slice(0, 62) + '…' : f.title)} ${sevBadge(f.effective)}</td>
        ${gameNames.map(g => cellFor(f, g)).join('')}
      </tr>`).join('');
// Per-game tally for the footer row.
const tally = gameNames.map(g => {
  let aff = 0, lik = 0;
  for (const f of giFindings) {
    const imp = (f.gameImpacts || []).find(i => i.game === g);
    if (imp && imp.status === 'affected') aff++;
    else if (imp && imp.status === 'likely') lik++;
  }
  return { g, aff, lik };
});
const matrixTallyRow = `
      <tr class="mx-tally">
        <td class="mx-find">Total per game (affected / likely)</td>
        ${tally.map(t => `<td class="mx-cell"><strong>${t.aff}</strong><span class="mx-sep">/</span>${t.lik}</td>`).join('')}
      </tr>`;
const matrixHtml = `
  <div class="matrix-wrap">
    <table class="matrix">
      <thead>
        <tr><th class="mx-find">Finding ↓ &nbsp; Game →</th>${gameNames.map(g => `<th class="mx-gh"><span>${esc(g)}</span></th>`).join('')}</tr>
      </thead>
      <tbody>${matrixRows}${matrixTallyRow}</tbody>
    </table>
    <div class="mx-legend"><span class="mx-affected">●</span> affected (will break / must change) &nbsp;&nbsp; <span class="mx-likely">○</span> likely (confirm) &nbsp;&nbsp; · not affected &nbsp;&nbsp; letter = effort (t·rivial / s·mall / m·oderate / l·arge)</div>
  </div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BoardSmith — Adversarial Audit Report</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --panel2: #1c2230; --border: #2a3140;
    --text: #e6edf3; --muted: #9aa7b4; --accent: #6ea8fe;
    --critical: #ff5c66; --high: #ff944d; --medium: #ffd24d; --low: #6ee7a8; --rejected: #8b95a3;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 32px 20px 80px; }
  header.top { border-bottom: 1px solid var(--border); padding-bottom: 24px; margin-bottom: 28px; }
  h1 { font-size: 30px; margin: 0 0 6px; letter-spacing: -0.5px; }
  .sub { color: var(--muted); font-size: 15px; max-width: 760px; }
  .meta-line { color: var(--muted); font-size: 13px; margin-top: 12px; }
  .meta-line strong { color: var(--text); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: 12px; margin: 24px 0 8px; }
  .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .stat .n { font-size: 28px; font-weight: 700; line-height: 1; }
  .stat .l { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .5px; margin-top: 6px; }
  .stat.s-critical .n { color: var(--critical); } .stat.s-high .n { color: var(--high); }
  .stat.s-medium .n { color: var(--medium); } .stat.s-low .n { color: var(--low); }

  details.method { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; margin: 20px 0; }
  details.method summary { cursor: pointer; font-weight: 600; }
  details.method p, details.method li { color: var(--muted); }

  .dims { display: grid; gap: 14px; margin: 8px 0 28px; }
  .dim-summary { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; }
  .dim-summary h4 { margin: 0 0 8px; font-size: 15px; display: flex; align-items: center; gap: 10px; }
  .dim-summary p { margin: 0; color: var(--muted); font-size: 13.5px; }
  .dim-count { color: var(--muted); font-size: 12px; font-weight: 500; }

  .controls { position: sticky; top: 0; z-index: 5; background: var(--bg); padding: 14px 0; border-bottom: 1px solid var(--border);
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 18px; }
  .controls .grp { display: flex; gap: 6px; flex-wrap: wrap; }
  .controls .lbl { color: var(--muted); font-size: 12px; margin-right: 4px; align-self: center; }
  button.filter { background: var(--panel2); color: var(--text); border: 1px solid var(--border);
    border-radius: 999px; padding: 5px 13px; font-size: 13px; cursor: pointer; }
  button.filter.active { background: var(--accent); color: #06101f; border-color: var(--accent); font-weight: 600; }

  .card { background: var(--panel); border: 1px solid var(--border); border-left-width: 4px; border-radius: 12px;
    padding: 18px 20px; margin-bottom: 14px; }
  .card[data-sev="critical"] { border-left-color: var(--critical); }
  .card[data-sev="high"] { border-left-color: var(--high); }
  .card[data-sev="medium"] { border-left-color: var(--medium); }
  .card[data-sev="low"] { border-left-color: var(--low); }
  .card-head { display: flex; gap: 16px; align-items: flex-start; }
  .rank { font-size: 22px; font-weight: 800; color: var(--muted); min-width: 46px; }
  .head-main { flex: 1; }
  .card h3 { margin: 8px 0 0; font-size: 17px; line-height: 1.35; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--panel2); color: var(--muted); white-space: nowrap; }
  .badge.sev-critical { background: rgba(255,92,102,.16); color: var(--critical); border-color: transparent; font-weight: 700; }
  .badge.sev-high { background: rgba(255,148,77,.16); color: var(--high); border-color: transparent; font-weight: 700; }
  .badge.sev-medium { background: rgba(255,210,77,.16); color: var(--medium); border-color: transparent; font-weight: 700; }
  .badge.sev-low { background: rgba(110,231,168,.16); color: var(--low); border-color: transparent; font-weight: 700; }
  .badge.sev-rejected { background: rgba(139,149,163,.18); color: var(--rejected); border-color: transparent; }
  .badge.verified { color: var(--low); border-color: rgba(110,231,168,.35); }
  .badge.cat { color: var(--accent); border-color: rgba(110,168,254,.35); }
  .badge.ease-easy { color: var(--low); } .badge.ease-moderate { color: var(--medium); } .badge.ease-hard { color: var(--high); }
  .badge.gi-count { color: #ffc7d1; border-color: rgba(255,92,102,.4); background: rgba(255,92,102,.12); font-weight: 600; }
  .badge.gi-zero { color: var(--low); border-color: rgba(110,231,168,.35); }
  .badge.gi-affected { background: rgba(255,92,102,.18); color: #ff8b94; border-color: transparent; font-weight: 700; }
  .badge.gi-likely { background: rgba(255,210,77,.16); color: var(--medium); border-color: transparent; font-weight: 700; }
  .badge.eff-trivial, .badge.eff-none { color: var(--low); } .badge.eff-small { color: #bfe6cf; }
  .badge.eff-moderate { color: var(--medium); } .badge.eff-large { color: var(--high); font-weight: 700; }
  .fid { display: inline-block; font-size: 11px; font-weight: 700; color: var(--accent); margin-right: 4px; vertical-align: middle; }
  .sevnote { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .sevnote em { color: var(--rejected); } .sevnote strong { color: var(--text); }

  /* game impact block inside cards */
  .field.gi .gi-none { color: var(--low); }
  .gi-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 13px; }
  .gi-table th { text-align: left; color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase;
    letter-spacing: .5px; border-bottom: 1px solid var(--border); padding: 4px 8px; }
  .gi-table td { padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .gi-row-affected { background: rgba(255,92,102,.06); }
  .gi-game { font-weight: 600; white-space: nowrap; }
  .gi-change { color: var(--text); }
  details.gi-ev { margin-top: 4px; }
  details.gi-ev summary { font-size: 12px; }
  details.gi-ev .mono { font: 11.5px/1.45 ui-monospace, Menlo, monospace; color: var(--muted); margin-top: 4px; }

  /* matrix */
  .matrix-wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; margin: 6px 0 8px; }
  table.matrix { border-collapse: collapse; font-size: 12.5px; min-width: 760px; }
  table.matrix th, table.matrix td { border: 1px solid var(--border); padding: 6px 8px; }
  table.matrix th.mx-find, table.matrix td.mx-find { text-align: left; min-width: 320px; position: sticky; left: 0; background: var(--panel); z-index: 1; }
  table.matrix th.mx-gh { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; color: var(--accent); font-weight: 600; height: 92px; vertical-align: bottom; }
  .mx-cell { text-align: center; font-size: 14px; color: var(--rejected); }
  .mx-cell.mx-none { color: #3a4150; }
  .mx-cell.mx-affected { color: var(--critical); background: rgba(255,92,102,.1); }
  .mx-cell.mx-likely { color: var(--medium); background: rgba(255,210,77,.07); }
  .mx-eff { font-size: 9px; color: var(--muted); vertical-align: super; margin-left: 1px; }
  tr.mx-tally td { background: var(--panel2); font-size: 12px; }
  tr.mx-tally .mx-cell strong { color: var(--critical); } .mx-sep { color: var(--muted); margin: 0 2px; }
  .mx-legend { color: var(--muted); font-size: 12px; margin-top: 8px; }
  .mx-legend .mx-affected { color: var(--critical); } .mx-legend .mx-likely { color: var(--medium); }
  table.matrix .badge { font-size: 10px; padding: 1px 6px; }
  table.matrix .fid { font-size: 10px; }

  .card-body { margin-top: 14px; }
  .field { margin-top: 12px; }
  .flabel { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 3px; }
  .ease-inline { text-transform: none; letter-spacing: 0; color: var(--high); }
  .ftext { font-size: 14px; }
  .field.pit .ftext { color: #f0d8b8; }
  .field.fix .ftext { color: #c9e8d4; }
  code { background: var(--panel2); border: 1px solid var(--border); border-radius: 5px; padding: 1px 5px;
    font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #b9c7ff; }
  details.evidence, details.verifier { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }
  details summary { cursor: pointer; color: var(--accent); font-size: 13px; }
  details .mono code { font-size: 12px; }
  .ftext.mono { font-size: 13px; margin-top: 8px; }

  .section-title { font-size: 20px; margin: 40px 0 8px; padding-top: 10px; border-top: 1px solid var(--border); }
  .section-note { color: var(--muted); font-size: 13.5px; margin: 0 0 18px; }
  .rejected-card { border-left-color: var(--rejected); opacity: .92; }
  footer { color: var(--muted); font-size: 12.5px; margin-top: 50px; border-top: 1px solid var(--border); padding-top: 16px; }
  .hidden { display: none !important; }

  /* fix-state */
  .stat.s-fixed .n { color: var(--low); } .stat.s-blocked .n { color: var(--high); } .stat.s-open .n { color: var(--accent); }
  .badge.fx-merged { background: rgba(110,231,168,.16); color: var(--low); border-color: transparent; font-weight: 700; }
  .badge.fx-blocked { background: rgba(255,148,77,.16); color: var(--high); border-color: transparent; font-weight: 700; }
  .badge.fx-open { color: var(--accent); border-color: rgba(110,168,254,.35); }
  .card.fx-merged { opacity: .72; border-left-color: var(--low); }
  .card.fx-merged:hover { opacity: 1; }
  .card.fx-merged h3 { color: var(--muted); }
  .card.fx-blocked { border-left-color: var(--high); }
  .rank-done { color: var(--low); font-size: 20px; font-weight: 800; display: block; }
  .merge-note { font-size: 12.5px; color: var(--low); margin-top: 8px; }
  .merge-note.blocked-note { color: var(--high); }
  .completed-header { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  #completed .card { margin-bottom: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>BoardSmith — Adversarial Audit Report</h1>
    <p class="sub">Five specialist adversarial judges independently audited the codebase for architectural, security,
    performance, usability, and developer/agent-experience flaws. <strong>Every finding was then re-checked against the
    actual source by a separate skeptic</strong> defaulting to disbelief — only source-confirmed problems appear in the
    main ranking. Severity is the verifier's independent rating, ordered worst-first against BoardSmith's core promise:
    being a <em>pit of success</em> for game designers and the AI agents building games with them.</p>
    <p class="meta-line">Generated <strong>2026-06-14</strong> &middot; updated <strong>2026-06-15</strong> with fix status &middot;
    ${(data.result ? confirmed.length : 0)} confirmed findings + ${rejected.length} rejected &middot;
    <strong style="color:var(--low)">${statusCounts.merged} fixed</strong>, ${statusCounts.blocked} blocked, ${statusCounts.open} open</p>
  </header>

  <div class="stats">
    <div class="stat s-fixed"><div class="n">${statusCounts.merged}</div><div class="l">✅ Fixed &amp; merged</div></div>
    <div class="stat s-blocked"><div class="n">${statusCounts.blocked}</div><div class="l">⛔ Blocked</div></div>
    <div class="stat s-open"><div class="n">${statusCounts.open}</div><div class="l">○ Open</div></div>
    <div class="stat s-high"><div class="n">${counts.high}</div><div class="l">High (active)</div></div>
    <div class="stat s-medium"><div class="n">${counts.medium}</div><div class="l">Medium (active)</div></div>
    <div class="stat s-low"><div class="n">${counts.low}</div><div class="l">Low (active)</div></div>
  </div>

  <details class="method">
    <summary>Methodology &amp; how to read this</summary>
    <p>Each of the five dimensions was assigned a dedicated adversarial judge that read real source (Read/Grep/Bash),
    and was required to cite <code>file:line</code> evidence for every claim. Each finding then went to an independent
    <strong>skeptic verifier</strong> instructed to assume the finding is wrong until the code proves otherwise, open the
    cited files, and assign its own severity. Where the verifier disagreed with the judge, the badge shows the
    verifier's rating and a note records the original. The two findings the verifier rejected are listed separately at
    the bottom — kept for transparency, not counted in the ranking.</p>
    <ul>
      <li><strong>Severity</strong> = how badly it undermines the pit-of-success goal (trap, silent failure, footgun, data-loss, or security hazard).</li>
      <li><strong>Ease of fix</strong> = rough implementation cost (easy / moderate / hard).</li>
      <li><strong>Confidence</strong> = the judge's confidence the issue is real and impactful.</li>
    </ul>
  </details>

  <h2 class="section-title" style="border:none;margin-top:24px;">Per-dimension assessment</h2>
  <div class="dims">${summaries}</div>

  <h2 class="section-title">Game-impact matrix <span style="color:var(--muted);font-size:14px;font-weight:400;">(which current games must change per fix)</span></h2>
  <p class="section-note">Nine real BoardSmith games (8 in <code>~/BoardSmithGames</code> + <code>MERC</code>) were each scanned by a
  dedicated agent against the subset of fixes that touch game-facing API/behavior. Only findings that impact at least one
  game appear here; internal-only fixes (server auth, engine refactors, perf) require no game changes. Hover a cell for the
  required change.</p>
  ${matrixHtml}

  <h2 class="section-title">Active findings <span style="color:var(--muted);font-size:14px;font-weight:400;">(still relevant — worst first · ${active.length} of ${confirmed.length})</span></h2>
  <p class="section-note">The ${statusCounts.merged} fixed-and-merged findings have been moved to the
  <a href="#completed" style="color:var(--accent)">Completed</a> section at the bottom. What remains here are the
  ${statusCounts.blocked} blocked + ${statusCounts.open} open problems that still need attention.</p>
  <div class="controls">
    <span class="lbl">Severity:</span>
    <div class="grp" id="sevFilters">
      <button class="filter active" data-f="sev" data-v="all">All</button>
      <button class="filter" data-f="sev" data-v="critical">Critical</button>
      <button class="filter" data-f="sev" data-v="high">High</button>
      <button class="filter" data-f="sev" data-v="medium">Medium</button>
      <button class="filter" data-f="sev" data-v="low">Low</button>
    </div>
    <span class="lbl" style="margin-left:14px;">Status:</span>
    <div class="grp" id="fixFilters">
      <button class="filter active" data-f="fix" data-v="all">All</button>
      <button class="filter" data-f="fix" data-v="open">Open</button>
      <button class="filter" data-f="fix" data-v="blocked">Blocked</button>
    </div>
    <span class="lbl" style="margin-left:14px;">Area:</span>
    <div class="grp" id="catFilters">
      <button class="filter active" data-f="cat" data-v="all">All</button>
      <button class="filter" data-f="cat" data-v="architecture">Architecture</button>
      <button class="filter" data-f="cat" data-v="security">Security</button>
      <button class="filter" data-f="cat" data-v="performance">Performance</button>
      <button class="filter" data-f="cat" data-v="usability">Usability</button>
      <button class="filter" data-f="cat" data-v="dx">DX / Agent-XP</button>
    </div>
    <span class="lbl" style="margin-left:14px;">Game impact:</span>
    <div class="grp" id="giFilters">
      <button class="filter active" data-f="gi" data-v="all">All</button>
      <button class="filter" data-f="gi" data-v="yes">Impacts games</button>
      <button class="filter" data-f="gi" data-v="no">No game impact</button>
    </div>
  </div>

  <div id="findings">
    ${active.map(row).join('\n')}
  </div>

  <h2 class="section-title" id="completed"><span class="completed-header">✅ Completed &amp; merged
    <span style="color:var(--muted);font-size:14px;font-weight:400;">(${completed.length} fixed — no longer active, kept for the record)</span></span></h2>
  <p class="section-note">These were fixed in isolated worktrees (each self-verified, regression-tested, and re-checked for
  zero game impact) and merged to <code>main</code>, with affected docs updated in the same commit.</p>
  <div id="completed-list">
    ${completed.map(row).join('\n')}
  </div>

  <h2 class="section-title">Rejected by the verifier</h2>
  <p class="section-note">These claims did not survive independent source re-checking. Shown for transparency — they are
  <em>not</em> part of the ranking.</p>
  ${rejected.map(rejRow).join('\n')}

  <footer>
    Adversarial multi-agent audit of BoardSmith &middot; judges + per-finding skeptic verification &middot;
    severities reflect the verifier's independent rating. Treat findings as prioritized leads, not verdicts —
    confirm each against current <code>main</code> before acting.
  </footer>
</div>

<script>
  const state = { sev: 'all', cat: 'all', gi: 'all', fix: 'all' };
  function apply() {
    document.querySelectorAll('#findings .card').forEach(c => {
      const okSev = state.sev === 'all' || c.dataset.sev === state.sev;
      const okCat = state.cat === 'all' || c.dataset.cat === state.cat;
      const okGi = state.gi === 'all' || c.dataset.gi === state.gi;
      const okFix = state.fix === 'all' || c.dataset.fix === state.fix;
      c.classList.toggle('hidden', !(okSev && okCat && okGi && okFix));
    });
  }
  document.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.f;
      state[f] = btn.dataset.v;
      document.querySelectorAll('.filter[data-f="' + f + '"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      apply();
    });
  });
</script>
</body>
</html>`;

fs.writeFileSync(OUT, html);
console.log('Wrote ' + OUT + ' (' + (html.length/1024).toFixed(0) + ' KB)');
console.log('Confirmed: ' + confirmed.length + ' | Rejected: ' + rejected.length);
console.log('Severity:', JSON.stringify(counts));
