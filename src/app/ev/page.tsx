import Link from 'next/link';
import { buildEvBoard } from '@/lib/ev-board';
import { loadBoard, loadPropFlags } from '@/lib/odds-board';
import { EV_RULE_VERSION } from '@/lib/ev-model';
import { LINE_SHOP_VERSION } from '@/lib/line-shop';
import { fairAmerican } from '@/lib/fair-value';
export const revalidate=300;
export const metadata={title:'Prediction Matrix — current price comparisons',description:'Experimental model prices and independent sportsbook price shopping. Prospective results are measured separately.'};
const am=(n:number)=>Number.isFinite(n)?`${n>0?'+':''}${Math.round(n)}`:'—';
const pct=(n:number)=>Number.isFinite(n)?`${(n*100).toFixed(1)}%`:'—';
export default async function EvPage() {
  const [model,board,props]=await Promise.all([buildEvBoard(),loadBoard(),loadPropFlags()]);
  const now=Date.now();
  const flags=Object.values(board?.sports??{}).flatMap(s=>Date.parse(s.fetchedAt)<now-40*60e3?[]:s.events)
    .filter(e=>Date.parse(e.commence)>now).flatMap(e=>e.markets.flatMap(m=>m.flags.map(f=>({e,m,f}))));
  return <div className="w-full space-y-7">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Current price comparisons</h1>
      <p className="text-sm text-gray-600">Experimental estimates. No edge or executable profit has been demonstrated.</p>
      <Link href="/results" className="inline-block text-blue-700 underline">Review saved forecasts and measured results</Link>
    </header>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Price shopping · game lines</h2>
      <p className="text-sm text-gray-600">Current book prices against Pinnacle or the other books at the same line. No model involved. Rule {LINE_SHOP_VERSION}.</p>
      {!flags.length?<p>No fresh upcoming flags available.</p>:<div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-sm"><thead><tr className="border-b text-left">{['Game','Side / line','Book','Price','Estimated fair','Estimated EV'].map(x=><th className="px-2 py-2" key={x}>{x}</th>)}</tr></thead><tbody>{flags.sort((a,b)=>b.f.ev-a.f.ev).slice(0,60).map(({e,m,f})=><tr className="border-b" key={`${m.id}-${f.label}-${f.book}`}><td className="px-2 py-2">{e.sport.toUpperCase()} · {e.away} @ {e.home}</td><td className="px-2">{f.label}</td><td className="px-2">{f.book}</td><td className="px-2">{am(f.price)}</td><td className="px-2">{am(fairAmerican(f.fairProb))}</td><td className="px-2">{pct(f.ev)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Price shopping · player props</h2>
      <p className="text-sm text-gray-600">Separate from game-line and model performance. Historical replay statistics are excluded from prospective evidence.</p>
      {!props.flags.length?<p>No upcoming props recorded.</p>:<div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-sm"><thead><tr className="border-b text-left">{['Game','Prop / line','Book','Price','Estimated EV','Observed'].map(x=><th className="px-2 py-2" key={x}>{x}</th>)}</tr></thead><tbody>{props.flags.filter(x=>Date.parse(x.snapshotTs)>now-40*60e3).slice(0,40).map(({eventId,matchup,flag:f,snapshotTs})=><tr className="border-b" key={`${eventId}-${f.label}-${f.book}`}><td className="px-2 py-2">{matchup}</td><td className="px-2">{f.label}</td><td className="px-2">{f.book}</td><td className="px-2">{am(f.price)}</td><td className="px-2">{pct(f.ev)}</td><td className="px-2">{snapshotTs}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Model price estimates</h2>
      <p className="text-sm text-gray-600">Frozen experimental blend ({EV_RULE_VERSION}). The earlier historical fit does not prove predictive value; forward measurement is required.</p>
      {!model.rows.length?<p>No upcoming priced forecasts.</p>:<div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-sm"><thead><tr className="border-b text-left">{['Game','Side / line','Book','Price','Market probability','Model probability','Blend EV'].map(x=><th className="px-2 py-2" key={x}>{x}</th>)}</tr></thead><tbody>{model.rows.flatMap(r=>(r.ev?.markets??[]).flatMap(m=>m.sides.map(s=><tr className="border-b" key={`${r.id}-${m.market}-${s.label}`}><td className="px-2 py-2">{r.sport.toUpperCase()} · {r.away} @ {r.home}</td><td className="px-2">{s.label}</td><td className="px-2">{r.provider}</td><td className="px-2">{am(s.price)}</td><td className="px-2">{pct(s.fairProb)}</td><td className="px-2">{pct(s.modelProb)}</td><td className="px-2">{pct(s.ev)}</td></tr>)))}</tbody></table></div>}
    </section>
  </div>;
}
