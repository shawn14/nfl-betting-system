import type { Metadata } from 'next';
import { buildEvBoard, type BoardRow } from '@/lib/ev-board';
import { EV_RULE_VERSION, MIN_EV, MAX_EDGE, MODEL_WEIGHT } from '@/lib/ev-model';
import { RESULT_SIGMA, fairAmerican } from '@/lib/fair-value';
import { loadBoard, loadLedger, ledgerClv, type Board as ShopBoard, type Ledger } from '@/lib/odds-board';
import { MIN_SHOP_EV, LINE_SHOP_VERSION, type SideShop } from '@/lib/line-shop';
import shopProof from '@/data/line-shop-proof.json';
import ledger from '@/data/ev-ledger.json';
import marketLab from '@/data/market-lab.json';

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

type LabSport = {
  games: number; from: string; to: string; devig: string;
  sigma: { margin: number; total: number; homeCoverRate: number; overRate: number };
  sharpness: { open: number; close: number; n: number } | null;
  beatClose: { tested: number; passed: string[] };
  predictsMove: { tested: number; passed: string[] };
  bestAtOpen: { name: string; n: number; clv: number; se: number; roi: number; stable: boolean; edge: boolean } | null;
};
const LAB = marketLab as unknown as { generated: string; gateZ: number; sports: Record<string, LabSport> };

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

const BOOK: Record<string, string> = {
  pinnacle: 'Pinnacle', draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', williamhill_us: 'Caesars', betrivers: 'BetRivers',
  fanatics: 'Fanatics', bovada: 'Bovada', betonlineag: 'BetOnline', lowvig: 'LowVig',
};
const P = shopProof as { events: number; graded: number; clv: number; clvSe: number; pctPositive: number; claimedEv: number; tiers: { lo: number; n: number; clv: number; se: number }[] };
const tierOf = (ev: number) => (ev >= 0.03 ? P.tiers[1] : P.tiers[0]);

function LineShop({ board, ledger }: { board: ShopBoard | null; ledger: Ledger | null }) {
  const now = Date.now();
  const rows = Object.values(board?.sports ?? {}).flatMap(s => s.events)
    .filter(e => Date.parse(e.commence) > now)
    .flatMap(e => e.markets.flatMap(m => m.flags.map((f: SideShop) => ({ e, m, f }))))
    .sort((a, b) => b.f.ev - a.f.ev);
  const arbs = Object.values(board?.sports ?? {}).flatMap(s => s.events).filter(e => Date.parse(e.commence) > now)
    .flatMap(e => e.markets.filter(m => m.arb != null && m.arb > 0.002).map(m => ({ e, m })));
  const games = Object.values(board?.sports ?? {}).reduce((n, s) => n + s.events.filter(e => Date.parse(e.commence) > now).length, 0);
  const track = ledgerClv(ledger, now);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Best prices vs the sharp line{rows.length ? ` · ${rows.length} +EV` : ''}</h2>
          <p className="text-xs text-gray-500 max-w-4xl">
            Up to ten sportsbooks per game. Fair value is Pinnacle&apos;s price with its margin removed, or the median of the other books at the same line when Pinnacle has none.
            A price is flagged when it beats that fair value by {pct(MIN_SHOP_EV)} or more. No model involved: this is the method with the longest record of beating closing lines.
          </p>
        </div>
        <div className="text-xs text-gray-500 text-right">
          {board ? <>Updated {new Date(board.updated).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' })} · {games} games</> : 'Waiting for the first odds run'}
          <div>Rule {LINE_SHOP_VERSION}</div>
        </div>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left px-2 py-2">Game</th><th className="text-left px-2 py-2">Bet</th><th className="text-left px-2 py-2">Book</th>
                <th className="text-right px-2 py-2">Price</th><th className="text-right px-2 py-2">Fair</th><th className="text-right px-2 py-2">EV now</th>
                <th className="text-right px-2 py-2">Held at close</th><th className="text-right px-2 py-2">Stake</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map(({ e, m, f }) => (
                <tr key={`${m.id}|${f.label}|${f.book}`} className="border-t border-gray-100">
                  <td className="px-2 py-2 text-gray-700 whitespace-nowrap"><span className="text-[10px] uppercase text-gray-400 mr-1">{e.sport}</span>{e.away} @ {e.home}<div className="text-xs text-gray-400">{when(e.commence)}</div></td>
                  <td className="px-2 py-2 font-medium text-gray-900 whitespace-nowrap">{f.label}</td>
                  <td className="px-2 py-2 text-gray-700">{BOOK[f.book] ?? f.book}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-900">{am(f.price)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{am(fairAmerican(f.fairProb))}<div className="text-[10px] text-gray-400">{m.fairSource === 'pinnacle' ? 'Pinnacle' : `${m.books - 1} books`}</div></td>
                  <td className={`px-2 py-2 text-right tabular-nums ${f.ev >= 0.03 ? 'text-green-700 font-semibold' : 'text-gray-900'}`}>{spct(f.ev)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{spct(tierOf(f.ev).clv, 2)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{pct(f.stake)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500">{board ? 'No price beats the sharp line right now. Books are in agreement; check back closer to game time, when prices move fastest.' : 'The multi-book odds feed has not run yet. It refreshes every 30 minutes before games and every 2 hours otherwise.'}</p>
      )}
      {arbs.length > 0 && (
        <p className="text-sm text-gray-700">
          Arbitrage: {arbs.map(({ e, m }) => `${e.away} @ ${e.home} ${m.market}${m.line != null ? ` ${m.line}` : ''} (${BOOK[m.bestA!.book] ?? m.bestA!.book} ${am(m.bestA!.price)} / ${BOOK[m.bestB!.book] ?? m.bestB!.book} ${am(m.bestB!.price)}, ${spct(m.arb!, 2)})`).join(' · ')}
        </p>
      )}
      <p className="text-xs text-gray-500 max-w-4xl">
        <span className="font-medium text-gray-700">What a flag has been worth.</span>{' '}
        &quot;EV now&quot; overstates it: prices partly converge before kickoff. Replayed on {P.events} NFL games of stored multi-book prices, {P.graded} flags beat the closing line
        by {spct(P.clv, 2)} ± {pct(P.clvSe, 2)} on average ({pct(P.pctPositive, 0)} of them positive) against a claimed {spct(P.claimedEv)}: {spct(P.tiers[0].clv, 2)} for flags at
        {' '}{pct(P.tiers[0].lo)}–3% and {spct(P.tiers[1].clv, 2)} at 3% and up. That is the &quot;Held at close&quot; column.
        {track.graded > 0
          ? <> Live record since launch: {track.graded} flags graded at the close, CLV {spct(track.clv, 2)} ± {pct(track.se, 2)}, {pct(track.pctPositive, 0)} positive.</>
          : <> Live record: {track.flagged} flags logged; each is graded against the closing line once its game starts.</>}
      </p>
    </section>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  'ml.elo': 'Elo, moneyline', 'ml.ewmaRating': 'rolling rating, moneyline', 'ml.restDiff': 'rest, moneyline',
  'spread.elo': 'Elo, spread', 'spread.ewmaRating': 'rolling rating, spread', 'spread.restDiff': 'rest, spread',
  'spread.backToBack': 'back-to-back, spread', 'total.ewmaPace': 'scoring pace, total', 'total.fatigue': 'fatigue, total',
};

function MarketLab() {
  const sports = Object.entries(LAB.sports);
  const total = sports.reduce((s, [, v]) => s + v.games, 0);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">What beats the closing line? ({total.toLocaleString()} games)</h2>
        <p className="text-xs text-gray-500 max-w-4xl">
          Every priced game ESPN keeps, all five sports, since 2023. Each ingredient our models are built from (Elo, rolling team ratings, rest and back-to-backs,
          scoring pace, line movement, home dogs, big lines) is tested against the de-vigged closing price on the first 60% of games and confirmed on the last 40%
          (z &ge; {LAB.gateZ} on train, same sign and lower log loss on test). Then the harder question: measured against the <em>opening</em> line, does it predict
          where the line goes, and is that move big enough to beat the vig if you bet early?
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <tr>
              <th className="text-left px-2 py-2">Sport</th><th className="text-right px-2 py-2">Games</th>
              <th className="text-right px-2 py-2">Noise (margin / total)</th><th className="text-right px-2 py-2">Open → close log loss</th>
              <th className="text-right px-2 py-2">Beat the close</th><th className="text-right px-2 py-2">Predict the move</th>
              <th className="text-left px-2 py-2">Best bet-at-open (held out)</th>
            </tr>
          </thead>
          <tbody>
            {sports.map(([sport, v]) => (
              <tr key={sport} className="border-t border-gray-100">
                <td className="px-2 py-2 font-medium text-gray-900">{sport.toUpperCase()}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-500">{v.games.toLocaleString()}</td>
                <td className="px-2 py-2 text-right tabular-nums">{RESULT_SIGMA[sport]?.margin ?? v.sigma.margin} / {v.sigma.total}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-500">{v.sharpness ? `${v.sharpness.open.toFixed(3)} → ${v.sharpness.close.toFixed(3)}` : '—'}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${v.beatClose.passed.length ? 'text-green-700 font-semibold' : 'text-gray-400'}`}>{v.beatClose.passed.length} of {v.beatClose.tested}</td>
                <td className="px-2 py-2 text-right tabular-nums">{v.predictsMove.passed.length} of {v.predictsMove.tested}</td>
                <td className="px-2 py-2 text-gray-700">
                  {v.bestAtOpen
                    ? <>{FEATURE_LABEL[v.bestAtOpen.name] ?? v.bestAtOpen.name}: CLV <span className={v.bestAtOpen.edge ? 'text-green-700 font-semibold' : ''}>{spct(v.bestAtOpen.clv)}</span> ± {pct(v.bestAtOpen.se)} on {v.bestAtOpen.n} bets{v.bestAtOpen.edge ? ' · edge' : v.bestAtOpen.clv > 2 * v.bestAtOpen.se ? ' · one book-season only' : ''}</>
                    : <span className="text-gray-400">too few bets</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 max-w-4xl">
        Reading it: no ingredient adds information to the closing price in any sport. Most of them <em>do</em> predict where the line moves from the open, so the market prices
        this public information late, but the move is smaller than the sportsbook&apos;s margin at the open. NHL totals by scoring pace earned real CLV at DraftKings in
        2025-26 and nowhere else (Bet365 2023-24 and ESPN BET 2024-25 were negative), so it is a watch item, not a rule. The noise column is what the board uses to turn a
        predicted spread or total into a probability.
      </p>
    </section>
  );
}

export default async function EvPage() {
  const [{ rows, builtAt }, shopBoard, shopLedger] = await Promise.all([buildEvBoard(), loadBoard(), loadLedger()]);
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
      <LineShop board={shopBoard} ledger={shopLedger} />
      <Board rows={rows} />
      <Scoreboard />
      <Gate />
      <MarketLab />
      <p className="text-xs text-gray-400 max-w-4xl">
        Market fair = the sportsbook&apos;s two prices with the margin removed (power method on moneylines, proportional on spreads and totals). Model spread and total probabilities assume the result lands
        around our number with each sport&apos;s measured noise (NFL: {RESULT_SIGMA.nfl.margin} pts margin, {RESULT_SIGMA.nfl.total} pts total, from the closing lines of {LAB.sports.nfl?.games ?? 0} games). Blend = model shrunk toward the market by the live weight.
        Historical prices are DraftKings / ESPN BET open and close from ESPN. Rows before each sport&apos;s live date were backfilled, not predicted in real time. Nothing here is advice; the NFL totals weight is on probation and is re-tested every week against new games.
      </p>
    </div>
  );
}
