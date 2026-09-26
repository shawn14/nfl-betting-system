#!/usr/bin/env node
/**
 * Render the latest docs/reports/<date>-market-lab.json into a standalone HTML report next to it.
 *   npm run market-lab-report   (then: render-html-graphic <html> for the PNG)
 * Styles are shared with the EV ledger report (docs/reports/2026-09-26-ev-ledger.html).
 */
import fs from 'node:fs';

const file = fs.readdirSync('docs/reports').filter(f => f.endsWith('-market-lab.json')).sort().at(-1);
const R = JSON.parse(fs.readFileSync(`docs/reports/${file}`, 'utf8'));
const ledgerHtml = fs.readFileSync('docs/reports/2026-09-26-ev-ledger.html', 'utf8');
const style = ledgerHtml.slice(ledgerHtml.indexOf('<style>'), ledgerHtml.indexOf('</style>') + 8);

const S = Object.entries(R.sports);
const games = S.reduce((s, [, v]) => s + v.usable, 0);
const closeTests = S.flatMap(([, v]) => Object.values(v.tests).flatMap(f => Object.values(f).filter(t => t.train)));
const pct = (x, d = 1) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const LABEL = { elo: 'Elo', ewmaRating: 'rolling rating', restDiff: 'rest', backToBack: 'back-to-back', ewmaPace: 'scoring pace',
  fatigue: 'fatigue', lineMove: 'line move', homeDog: 'home dog', bigLine: 'big line', lineLevel: 'line level' };
const lab = n => { const [m, f] = n.split('.'); return `${LABEL[f] ?? f} · ${m}`; };

// ---- dot plot: held-out bet-at-open CLV ± 2 SE per sport x feature (>= 30 bets)
const pts = S.flatMap(([s, v]) => Object.entries(v.moves).flatMap(([m, f]) => Object.entries(f)
  .filter(([, t]) => t.betAtOpen?.n >= 30).map(([k, t]) => ({ s, name: `${m}.${k}`, clv: t.betAtOpen.avgClv, se: t.betAtOpen.clvSe, n: t.betAtOpen.n }))));
const W = 760, rowH = 18, top = 26, left = 230, H = top + pts.length * rowH + 30;
const lo = -0.06, hi = 0.04, X = v => left + ((v - lo) / (hi - lo)) * (W - left - 20);
const ticks = [-0.06, -0.04, -0.02, 0, 0.02, 0.04];
const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Bet-at-open closing line value by sport and feature" style="max-width:${W}px;font:12px 'Source Sans 3',sans-serif">
${ticks.map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 6}" y2="${H - 24}" stroke="var(--line)" ${t === 0 ? 'stroke-width="1.5" stroke="var(--muted)"' : ''}/><text x="${X(t)}" y="${H - 8}" text-anchor="middle" fill="var(--faint)">${pct(t, 0)}</text>`).join('')}
<text x="${X(0) + 4}" y="${top - 12}" fill="var(--muted)">CLV ≥ 0 means the bet beat the close</text>
${pts.map((p, i) => { const y = top + i * rowH + 6; const good = p.clv - 2 * p.se > 0; const c = good ? 'var(--good)' : p.clv + 2 * p.se < 0 ? 'var(--bad)' : 'var(--muted)';
  return `<text x="${left - 8}" y="${y + 4}" text-anchor="end" fill="var(--ink)">${p.s.toUpperCase()} · ${esc(lab(p.name))} <tspan fill="var(--faint)">(${p.n})</tspan></text>
<line x1="${X(Math.max(lo, p.clv - 2 * p.se))}" x2="${X(Math.min(hi, p.clv + 2 * p.se))}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="2"/><circle cx="${X(p.clv)}" cy="${y}" r="4" fill="${c}"/>`; }).join('\n')}
</svg>`;

const sportRows = S.map(([s, v]) => {
  const ct = Object.values(v.tests).flatMap(f => Object.values(f).filter(t => t.train));
  const mv = Object.values(v.moves).flatMap(f => Object.values(f).filter(t => t.train));
  return `<tr><td><b>${s.toUpperCase()}</b></td><td>${v.usable.toLocaleString()}</td><td>${v.from} → ${v.to}</td>
<td>${v.sigma.margin} / ${v.sigma.total}</td><td>${(v.sigma.homeCoverRate * 100).toFixed(1)}% / ${(v.sigma.overRate * 100).toFixed(1)}%</td>
<td>${v.sharpness ? `${v.sharpness.openLogLoss} → ${v.sharpness.closeLogLoss}` : '—'}</td><td>${v.devig.best}</td>
<td class="${ct.some(t => t.passes) ? 'good' : 'muted'}">${ct.filter(t => t.passes).length} of ${ct.length}</td><td>${mv.filter(t => t.passes).length} of ${mv.length}</td></tr>`;
}).join('\n');

const calRows = S.map(([s, v]) => `<tr><td><b>${s.toUpperCase()}</b></td>${v.calibration.map(b => `<td>${(b.fair * 100).toFixed(0)}% → ${(b.actual * 100).toFixed(0)}% <span class="muted">(${b.n})</span></td>`).join('')}</tr>`).join('\n');

const html = `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Prediction Matrix Market Lab</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@87.5,600;87.5,700&family=Source+Sans+3:wght@400;600&display=swap">
${style}</head><body>
<h1>What beats the closing line?</h1>
<p class="sub">${games.toLocaleString()} final games with sportsbook open and close prices, every priced game ESPN keeps across NFL, NBA, NHL, college basketball and WNBA.
Each ingredient our models use is tested against the de-vigged close on the first 60% of games and confirmed on the last 40%. Generated ${R.generated.slice(0, 16).replace('T', ' ')} UTC by <code>npm run market-lab</code>.</p>
<div class="find">
<div><b>0 of ${closeTests.length}</b><span>feature × market tests add information to the closing price (gate: train z ≥ ${R.gateZ}, same sign held out, lower held-out log loss)</span></div>
<div><b>Close &gt; open</b><span>in every sport the close is sharper than the open (NBA log loss ${R.sports.nba?.sharpness?.openLogLoss} → ${R.sports.nba?.sharpness?.closeLogLoss}): the market learns late</span></div>
<div><b>Moves, not edges</b><span>public features predict where the line goes, but the move is smaller than the vig at the open: bet-at-open CLV is negative almost everywhere</span></div>
<div><b>One watch item</b><span>NHL totals by scoring pace: +${(R.sports.nhl?.moves.total.ewmaPace.betAtOpen.avgClv * 100).toFixed(1)}% CLV held out, all from DraftKings 2025-26; negative at Bet365 2023-24 and ESPN BET 2024-25</span></div>
</div>
<h2>By sport</h2>
<p class="sub">Noise is the SD of (result − closing line), the number the EV board uses to turn a predicted spread or total into a probability. NHL margin noise is measured against the ±1.5 puck line.</p>
<div class="wrap"><table><thead><tr><th>Sport</th><th>Games</th><th>Span</th><th>Noise margin / total</th><th>Home covers / over</th><th>Open → close log loss</th><th>Best de-vig</th><th>Beat the close</th><th>Predict the move</th></tr></thead>
<tbody>${sportRows}</tbody></table></div>
<h2>Betting at the open: closing line value, held-out games</h2>
<p class="sub">For each feature, measured against the opening line: bet the side it points to when it is in the top quartile of disagreement, at the opening price. CLV = the close's fair probability (moved to the opening line with the empirical score distribution) minus the price paid. Bars are ±2 standard errors; green clears zero, red is clearly below.</p>
<div class="wrap">${svg}</div>
<h2>Is the closing moneyline calibrated?</h2>
<p class="sub">De-vigged close probability bucket → how often that side actually won (count of sides). Buckets: under 20%, 20–35, 35–50, 50–65, 65–80, 80%+.</p>
<div class="wrap"><table><tbody>${calRows}</tbody></table></div>
<p class="muted" style="margin-top:28px;max-width:90ch">Data filters: Bet365 2023-24 NHL moneylines (60-minute three-way prices, 1,325 rows) and markets with overround outside 0.995–1.12 are dropped; totals outside 0.6–1.4× the sport median are another market; an open identical to the close counts as no open. Source: ESPN core odds API (DraftKings, ESPN BET, Bet365, Betfair, Caesars by season). Not advice.</p>
</body></html>`;
const out = `docs/reports/${file.replace('.json', '.html')}`;
fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
