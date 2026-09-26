import type { Metadata } from 'next';
import { buildEvBoard, type BoardRow } from '@/lib/ev-board';
import { EV_RULE_VERSION, MIN_EV, MAX_EDGE, MODEL_WEIGHT } from '@/lib/ev-model';
import ledger from '@/data/ev-ledger.json';

export const metadata: Metadata = {
  title: 'EV Board - fair odds and expected value at the real price',
  description: 'Every upcoming game priced three ways: the market\'s de-vigged fair odds, our model, and the blend we would actually bet. Plus our full pick history graded at real sportsbook prices, not a flat -110.',
};
export const revalidate = 600;

type Staking = { n: number; w: number; l: number; p: number; winPct: number; breakEven: number; units: number; roi: number; roiLo: number; roiHi: number };
type Clv = { n: number; avgClvProb: number; pctPositive: number; avgClvPts?: number } | null;
type Signal = { signal: number; signalSe: number; signalZ: number; testLogLoss: { market: number; signalOnly: number } };
type MarketLedger = {
  n: number; testN?: number; testFrom?: string; signalTest?: Signal; signalLiveOnly?: Signal | null;
  gate?: { passes: boolean; liveWeight: number }; evRuleTest?: Staking;
};
type SportLedger = {
  rows: number; pricedGames: number; provider: string[]; sigma: { margin: number; total: number };
  sitePicks: {
    ats: { close: Staking; pickAtOpen?: Staking; pickAtOpenClv?: Clv };
    ou: { close: Staking; pickAtOpen?: Staking; pickAtOpenClv?: Clv };
    ml: { close: Staking; atFlatMinus110: Staking; favorites: Staking; underdogs: Staking };
  };
  markets: Record<'ml' | 'spread' | 'total', MarketLedger>;
};
const L = ledger as unknown as { generated: string; minEv: number; sports: Record<string, SportLedger> };

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const spct = (x: number, d = 1) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const am = (x: number) => (x > 0 ? `+${x}` : `${x}`);
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const MARKET_LABEL = { ml: 'Moneyline', spread: 'Spread', total: 'Total' } as const;
const evTone = (ev: number) => (ev >= MIN_EV ? 'text-green-700 font-semibold' : ev > 0 ? 'text-gray-900' : 'text-gray-400');

function Board({ rows }: { rows: BoardRow[] }) {
  const priced = rows.filter(r => r.ev);
  const flags = priced.flatMap(r => r.ev!.markets.filter(m => m.best).map(m => ({ r, m })));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className="text-base font-semibold text-gray-900">{flags.length} +EV {flags.length === 1 ? 'bet' : 'bets'} on the board</h2>
        <span className="text-xs text-gray-500">{priced.length} of {rows.length} upcoming games priced · flag = blended EV ≥ {pct(MIN_EV, 0)} at the listed price, in a market that passed the gate</span>
      </div>
      {flags.length > 0 && (
        <ul className="divide-y divide-gray-100 border-t border-b border-gray-100">
          {flags.map(({ r, m }) => (
            <li key={`${r.id}-${m.market}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-sm">
              <span className="w-12 text-[10px] uppercase tracking-wider text-gray-400">{r.label}</span>
              <span className="w-28 text-gray-500 tabular-nums">{when(r.gameTime)}</span>
              <span className="w-24 text-gray-700">{r.away} @ {r.home}</span>
              <span className="font-semibold text-gray-900">{m.best!.label} {am(m.best!.price)}</span>
              <span className="text-green-700 font-semibold tabular-nums">EV {spct(m.best!.ev)}</span>
              <span className="text-gray-500 tabular-nums">our {pct(m.best!.prob)} vs market {pct(m.best!.fairProb)} · fair {am(m.best!.fairOdds)}</span>
              <span className="text-gray-500 tabular-nums">stake {pct(m.best!.kelly)} of bankroll</span>
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <tr>
              <th className="text-left px-2 py-2">Game</th><th className="text-left px-2 py-2">Market</th>
              <th className="text-left px-2 py-2">Side</th><th className="text-right px-2 py-2">Price</th>
              <th className="text-right px-2 py-2">Market fair</th><th className="text-right px-2 py-2">Model</th>
              <th className="text-right px-2 py-2">Blend</th><th className="text-right px-2 py-2">Fair odds</th>
              <th className="text-right px-2 py-2">EV</th><th className="text-right px-2 py-2">Vig</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              if (!r.ev || !r.ev.markets.length) {
                return (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 whitespace-nowrap"><span className="text-[10px] text-gray-400 mr-2">{r.label}</span>{r.away} @ {r.home}<div className="text-xs text-gray-400">{when(r.gameTime)}</div></td>
                    <td className="px-2 py-2 text-gray-400" colSpan={9}>No sportsbook price posted yet</td>
                  </tr>
                );
              }
              return r.ev.markets.flatMap((m, mi) => m.sides.map((s, si) => (
                <tr key={`${r.id}-${m.market}-${si}`} className={`${mi === 0 && si === 0 ? 'border-t border-gray-200' : si === 0 ? 'border-t border-gray-100' : ''} ${m.best === s ? 'bg-green-50' : ''}`}>
                  <td className="px-2 py-1 whitespace-nowrap align-top">
                    {mi === 0 && si === 0 && (<><span className="text-[10px] text-gray-400 mr-2">{r.label}</span><span className="font-medium text-gray-900">{r.away} @ {r.home}</span><div className="text-xs text-gray-400">{when(r.gameTime)} · {r.provider}</div></>)}
                  </td>
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{si === 0 ? <>{MARKET_LABEL[m.market]}{m.weight > 0 ? <span className="ml-1 text-[10px] text-green-700">model w {m.weight}</span> : null}</> : ''}</td>
                  <td className="px-2 py-1 whitespace-nowrap text-gray-900">{s.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{am(s.price)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600">{pct(s.fairProb)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-400">{pct(s.modelProb)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pct(s.prob)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600">{am(s.fairOdds)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${evTone(s.ev)}`}>{spct(s.ev)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-400">{si === 0 ? pct(m.vig) : ''}</td>
                </tr>
              )));
            })}
            {!rows.length && <tr><td className="px-2 py-3 text-gray-500" colSpan={10}>No upcoming games in the next eight days.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StakeCells({ s }: { s: Staking }) {
  const ok = s.roiLo > 0;
  return (
    <>
      <td className="px-2 py-2 text-right tabular-nums">{s.w}-{s.l}{s.p ? `-${s.p}` : ''}</td>
      <td className="px-2 py-2 text-right tabular-nums">{pct(s.winPct)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-gray-500">{pct(s.breakEven)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${ok ? 'text-green-700 font-semibold' : s.roi > 0 ? 'text-gray-900' : 'text-red-600'}`}>{spct(s.roi)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-gray-400">{spct(s.roiLo, 0)} to {spct(s.roiHi, 0)}</td>
    </>
  );
}

function Scoreboard() {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Our record at real prices</h2>
        <p className="text-xs text-gray-500">Every graded pick re-priced at the sportsbook&apos;s closing odds, including the juice. Win rate only counts when it beats the break-even of the prices actually taken. Ledger run {L.generated.slice(0, 10)}.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <tr><th className="text-left px-2 py-2">Sport</th><th className="text-left px-2 py-2">Bet</th><th className="text-right px-2 py-2">W-L</th><th className="text-right px-2 py-2">Win</th><th className="text-right px-2 py-2">Needed</th><th className="text-right px-2 py-2">ROI</th><th className="text-right px-2 py-2">95% range</th></tr>
          </thead>
          <tbody>
            {Object.entries(L.sports).flatMap(([sport, v]) => ([
              ['Spread (site pick)', v.sitePicks.ats.close],
              ['Total (site pick)', v.sitePicks.ou.close],
              ['Moneyline (site pick), real price', v.sitePicks.ml.close],
              ['Moneyline graded at a flat -110 (how it used to be scored)', v.sitePicks.ml.atFlatMinus110],
              ...(v.markets.total.evRuleTest && v.markets.total.gate?.passes ? [[`Total EV rule, held-out games from ${v.markets.total.testFrom}`, v.markets.total.evRuleTest]] : []),
            ] as [string, Staking][]).map(([label, s], i) => (
              <tr key={`${sport}-${label}`} className={i === 0 ? 'border-t border-gray-200' : 'border-t border-gray-100'}>
                <td className="px-2 py-2 font-medium text-gray-900">{i === 0 ? sport.toUpperCase() : ''}</td>
                <td className={`px-2 py-2 ${label.includes('flat -110') ? 'text-gray-400 line-through decoration-gray-300' : 'text-gray-700'}`}>{label}</td>
                <StakeCells s={s} />
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Gate() {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Does the model know anything the price doesn&apos;t?</h2>
        <p className="text-xs text-gray-500 max-w-4xl">
          For each market we fit outcome = market probability + a constant lean + the model&apos;s disagreement, on the first 60% of games, and score it on the last 40%.
          Signal is the weight on the disagreement; z above 1.5 on train <em>and</em> a lower held-out log loss than the market alone earns the model a say in live prices.
          Every other market defers to the market: its EV is just minus the vig, and it is never flagged.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <tr><th className="text-left px-2 py-2">Sport</th><th className="text-left px-2 py-2">Market</th><th className="text-right px-2 py-2">Games</th><th className="text-right px-2 py-2">Signal (z)</th><th className="text-right px-2 py-2">Live-only signal (z)</th><th className="text-right px-2 py-2">Held-out log loss: market → with model</th><th className="text-right px-2 py-2">Live weight</th></tr>
          </thead>
          <tbody>
            {Object.entries(L.sports).flatMap(([sport, v]) => (['ml', 'spread', 'total'] as const).map((mk, i) => {
              const x = v.markets[mk];
              const st = x.signalTest;
              const w = MODEL_WEIGHT[sport]?.[mk] ?? 0;
              return (
                <tr key={`${sport}-${mk}`} className={i === 0 ? 'border-t border-gray-200' : 'border-t border-gray-100'}>
                  <td className="px-2 py-2 font-medium text-gray-900">{i === 0 ? sport.toUpperCase() : ''}</td>
                  <td className="px-2 py-2 text-gray-700">{MARKET_LABEL[mk]}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{x.n}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{st ? `${st.signal.toFixed(2)} (${st.signalZ})` : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{x.signalLiveOnly ? `${x.signalLiveOnly.signal.toFixed(2)} (${x.signalLiveOnly.signalZ})` : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{st ? `${st.testLogLoss.market.toFixed(3)} → ${st.testLogLoss.signalOnly.toFixed(3)}` : '—'}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${w > 0 ? 'text-green-700 font-semibold' : 'text-gray-400'}`}>{w > 0 ? w : 'market'}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function EvPage() {
  const { rows, builtAt } = await buildEvBoard();
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">EV Board</h1>
          <p className="text-sm text-gray-500">The market&apos;s fair odds with the vig removed, our model, and the blend we would bet, at the price on offer. A pick is only worth taking when it beats the price.</p>
        </div>
        <div className="text-xs text-gray-500 text-right">
          <div>Prices: ESPN (DraftKings) · refreshed {new Date(builtAt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' })}</div>
          <div>Rule {EV_RULE_VERSION} · min EV {pct(MIN_EV, 0)} · max edge vs market {pct(MAX_EDGE, 0)} · stake = quarter Kelly, cap 2%</div>
        </div>
      </div>
      <Board rows={rows} />
      <Scoreboard />
      <Gate />
      <p className="text-xs text-gray-400 max-w-4xl">
        Market fair = the sportsbook&apos;s two prices with the margin removed (power method on moneylines, proportional on spreads and totals). Model spread and total probabilities assume the result lands
        around our number with each sport&apos;s measured noise (NFL: 12.5 pts margin, 13.4 pts total, from the closing lines of {L.sports.nfl?.pricedGames ?? 0} games). Blend = model shrunk toward the market by the live weight.
        Historical prices are DraftKings / ESPN BET open and close from ESPN. Rows before each sport&apos;s live date were backfilled, not predicted in real time. Nothing here is advice; the NFL totals weight is on probation and is re-tested every week against new games.
      </p>
    </div>
  );
}
