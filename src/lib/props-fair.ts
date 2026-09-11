// Sportsbook lines -> fair probability on Kalshi rungs -> fee-adjusted edge.
// TypeScript port of kalshi-mm-v14/tools/props_watch/{matching,edge}.py (same rules, same fixtures).
// Rules: two-sided mains de-vigged per book; one-sided alternate ladders divided by that book's own
// main-line vig for the player (else the book's stat median, else skipped); anytime TD = raw implied
// minus a 4c haircut (approximation); EXACT rung matching only (book point == Kalshi floor_strike);
// exact normalized names, no fuzzy; fair needs >= 3 books. Taker fee = ceil(7% x p(1-p) x 100) cents.

export const SERIES_MARKETS: Record<string, { main: string; alt: string | null }> = {
  KXNFLRSHYDS: { main: 'player_rush_yds', alt: 'player_rush_yds_alternate' },
  KXNFLRECYDS: { main: 'player_reception_yds', alt: 'player_reception_yds_alternate' },
  KXNFLREC: { main: 'player_receptions', alt: 'player_receptions_alternate' },
  KXNFLPASSYDS: { main: 'player_pass_yds', alt: 'player_pass_yds_alternate' },
  KXNFLPASSTDS: { main: 'player_pass_tds', alt: null },
  KXNFLRSHATT: { main: 'player_rush_attempts', alt: null },
  KXNFLPASSATT: { main: 'player_pass_attempts', alt: null },
  KXNFLPASSCOMP: { main: 'player_pass_completions', alt: null },
  KXNFLPASSINT: { main: 'player_pass_interceptions', alt: null },
  KXNFLTD: { main: 'player_anytime_td', alt: null },
};
export const SERIES_LABEL: Record<string, string> = {
  KXNFLRSHYDS: 'Rushing yards', KXNFLRECYDS: 'Receiving yards', KXNFLREC: 'Receptions', KXNFLPASSYDS: 'Passing yards',
  KXNFLPASSTDS: 'Passing TDs', KXNFLRSHATT: 'Rush attempts', KXNFLPASSATT: 'Pass attempts', KXNFLPASSCOMP: 'Completions',
  KXNFLPASSINT: 'Interceptions', KXNFLTD: 'Touchdowns',
};
export const RULE = { minBooks: 3, haircut: 0.02, tdHaircut: 0.04, minNetEdgeC: 4, investigateGapC: 15 } as const;

export function normName(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/'/g, '').replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').split(/\s+/).filter(Boolean).join(' ');
}
export function americanToProb(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}
export function devigPair(over: number, under: number): number {
  const t = over + under; return t > 0 ? over / t : NaN;
}

export interface BookLine { book: string; point: number; pOver: number; rawOver: number; kind: 'main' | 'alternate' | 'anytime_td'; vigSource: string }
export interface FairRung { market: string; player: string; threshold: number; pFair: number; nBooks: number; spread: number }
export interface KalshiRow {
  ticker: string; event: string; series: string; subtitle: string; strike: number | null;
  yes_bid: number | null; yes_ask: number | null; yes_bid_size: number | null; yes_ask_size: number | null;
  last: number | null; volume: number | null; open_interest: number | null; close_time: string; status: string;
}
export interface RungEdge {
  ticker: string; event: string; series: string; player: string; threshold: number; pFair: number; nBooks: number; spread: number;
  yesBid: number | null; yesAsk: number | null; askSize: number | null; bidSize: number | null; volume: number | null;
  edgeYesC: number | null; edgeNoC: number | null; mid: number | null; gapC: number | null; side: 'YES' | 'NO' | ''; bestEdgeC: number | null;
}

type OddsPayload = { data?: { bookmakers?: Array<{ key: string; markets?: Array<{ key: string; last_update?: string; outcomes?: Array<{ name: string; description?: string; price: number; point?: number }> }> }> } };

export function extractLines(payload: OddsPayload): Map<string, BookLine[]> {
  const data = payload.data || (payload as unknown as OddsPayload['data']) || {};
  const mains = new Map<string, { over?: number; under?: number }>();
  const alts = new Map<string, number>();
  const tds = new Map<string, number>();
  for (const b of data.bookmakers || []) {
    for (const m of b.markets || []) {
      for (const o of m.outcomes || []) {
        const player = normName(o.description || '');
        if (!player) continue;
        if (m.key === 'player_anytime_td') { if (o.name === 'Yes') tds.set(`${b.key}|${player}`, americanToProb(o.price)); continue; }
        if (o.point === undefined || o.point === null) continue;
        const point = Number(o.point);
        if (m.key.endsWith('_alternate')) { if (o.name === 'Over') alts.set(`${b.key}|${m.key}|${player}|${point}`, americanToProb(o.price)); }
        else {
          const k = `${b.key}|${m.key}|${player}|${point}`; const d = mains.get(k) || {};
          if (o.name === 'Over') d.over = americanToProb(o.price); else if (o.name === 'Under') d.under = americanToProb(o.price);
          mains.set(k, d);
        }
      }
    }
  }
  const out = new Map<string, BookLine[]>();
  const push = (key: string, l: BookLine) => { const a = out.get(key) || []; a.push(l); out.set(key, a); };
  const vigByBookPlayer = new Map<string, number>(); const vigByBookStat = new Map<string, number[]>();
  for (const [k, d] of mains) {
    if (d.over === undefined || d.under === undefined) continue;
    const [book, market, player, pointS] = k.split('|'); const point = Number(pointS);
    const p = devigPair(d.over, d.under); const vig = p > 0 ? d.over / p : NaN;
    if (Number.isFinite(vig)) { vigByBookPlayer.set(`${book}|${market}|${player}`, vig); const arr = vigByBookStat.get(`${book}|${market}`) || []; arr.push(vig); vigByBookStat.set(`${book}|${market}`, arr); }
    push(`${market}|${player}|${point}`, { book, point, pOver: p, rawOver: d.over, kind: 'main', vigSource: 'two_sided' });
  }
  for (const [k, raw] of alts) {
    const [book, altKey, player, pointS] = k.split('|'); const point = Number(pointS); const base = altKey.replace(/_alternate$/, '');
    let vig = vigByBookPlayer.get(`${book}|${base}|${player}`); let src = 'own_main';
    if (vig === undefined) { const vals = vigByBookStat.get(`${book}|${base}`); if (!vals || !vals.length) continue; vig = median(vals); src = 'book_median'; }
    push(`${base}|${player}|${point}`, { book, point, pOver: Math.min(0.999, raw / vig), rawOver: raw, kind: 'alternate', vigSource: src });
  }
  for (const [k, raw] of tds) { const [book, player] = k.split('|'); push(`player_anytime_td|${player}|0.5`, { book, point: 0.5, pOver: Math.max(0.001, raw - RULE.tdHaircut), rawOver: raw, kind: 'anytime_td', vigSource: 'haircut' }); }
  return out;
}

export function median(v: number[]): number { const s = [...v].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }

export function fairRungs(lines: Map<string, BookLine[]>, minBooks = RULE.minBooks): FairRung[] {
  const out: FairRung[] = [];
  for (const [key, bl] of lines) {
    const [market, player, pointS] = key.split('|');
    const best = new Map<string, BookLine>();
    for (const l of [...bl].sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1))) if (!best.has(l.book)) best.set(l.book, l);
    const vals = [...best.values()].map(l => l.pOver);
    if (vals.length < minBooks) continue;
    out.push({ market, player, threshold: Number(pointS), pFair: median(vals), nBooks: vals.length, spread: Math.max(...vals) - Math.min(...vals) });
  }
  return out;
}

export function rowsFromSnapshot(snapshot: { cols: string[]; rows: unknown[][] }): KalshiRow[] {
  const cols = snapshot.cols;
  return snapshot.rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])) as unknown as KalshiRow);
}

export function kalshiPlayerAndThreshold(row: KalshiRow): { player: string | null; threshold: number | null } {
  const sub = row.subtitle || ''; if (!sub.includes(':')) return { player: null, threshold: null };
  return { player: normName(sub.split(':')[0]), threshold: row.strike === null || row.strike === undefined ? null : Number(row.strike) };
}

export function takerFeeCents(priceDollars: number): number { const p = Math.max(0, Math.min(1, priceDollars)); return Math.ceil(0.07 * p * (1 - p) * 100); }
export function takerEdgeCents(pWin: number, priceDollars: number, haircut = RULE.haircut): number {
  return (pWin - haircut) * 100 - priceDollars * 100 - takerFeeCents(priceDollars);
}

export function computeEdges(rows: KalshiRow[], rungs: FairRung[]): RungEdge[] {
  const idx = new Map<string, FairRung>(); for (const r of rungs) idx.set(`${r.market}|${r.player}|${r.threshold}`, r);
  const out: RungEdge[] = [];
  for (const row of rows) {
    const sm = SERIES_MARKETS[row.series]; if (!sm) continue;
    const { player, threshold } = kalshiPlayerAndThreshold(row); if (player === null || threshold === null) continue;
    const rung = idx.get(`${sm.main}|${player}|${threshold}`); if (!rung) continue;
    const yb = row.yes_bid, ya = row.yes_ask;
    const eYes = ya !== null && ya > 0 ? takerEdgeCents(rung.pFair, ya) : null;
    const eNo = yb !== null && yb > 0 && yb < 1 ? takerEdgeCents(1 - rung.pFair, 1 - yb) : null;
    const mid = yb !== null && ya !== null ? (yb + ya) / 2 : null;
    const cands: Array<['YES' | 'NO', number]> = []; if (eYes !== null) cands.push(['YES', eYes]); if (eNo !== null) cands.push(['NO', eNo]);
    const best = cands.length ? cands.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    out.push({ ticker: row.ticker, event: row.event, series: row.series, player: rung.player, threshold, pFair: rung.pFair, nBooks: rung.nBooks, spread: rung.spread,
      yesBid: yb, yesAsk: ya, askSize: row.yes_ask_size, bidSize: row.yes_bid_size, volume: row.volume, edgeYesC: eYes, edgeNoC: eNo, mid,
      gapC: mid !== null ? (rung.pFair - mid) * 100 : null, side: best ? best[0] : '', bestEdgeC: best ? best[1] : null });
  }
  return out;
}
