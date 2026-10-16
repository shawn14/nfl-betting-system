import Link from 'next/link';
import { readMeasurement } from '@/lib/measurement/read';
import type { Sport } from '@/lib/measurement/core';
const pct=(v:number|null)=>v===null?'—':`${(v*100).toFixed(2)}%`;
const interval=(s:{lo:number|null;hi:number|null})=>s.lo===null?'—':`${pct(s.lo)} to ${pct(s.hi)}`;
export default async function MeasurementResults({sport}:{sport?:Sport}) {
  const {state,report}=await readMeasurement();
  const rows=report?.model.filter(r=>!sport||r.sport===sport)??[];
  return <div className="w-full space-y-7">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">{sport?`${sport.toUpperCase()} `:''}Measured results</h1>
      <p className="text-sm text-gray-600">No demonstrated edge yet. Model predictions and price shopping are separate experiments.</p>
      <nav className="flex gap-4 overflow-x-auto text-sm"><Link className="text-blue-700 shrink-0" href="/ev">View current prices</Link><a className="text-blue-700 shrink-0" href="/api/measurement">Download saved evidence</a></nav>
    </header>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Model predictions · one saved forecast per game</h2>
      <p className="text-sm text-gray-600">The first eligible published forecast in the final 72 hours is saved with its exact bookmaker line and prices, at least two minutes before scheduled start. Results use that record only. Missing prices are excluded, never filled with assumed odds.</p>
      {state!=='available'?<p role="status">{state==='disabled'?'Prospective collection is not enabled. No verified record is available yet.':'Measurement data is unavailable. Results cannot be verified right now.'}</p>:<>
        <p role="status" className="text-sm">{report!.health?.ok === true && Date.now()-Date.parse(report!.health.updated)<45*60e3 ? `Collector checked ${report!.health.updated}` : 'Collector has no recent successful run; coverage may be incomplete.'}</p>
        <p className="text-sm">{report!.captures} saved games · {report!.pending} pending · {report!.voided} voided · {report!.invalidCaptures} invalid captures excluded · {report!.missed} missed games in the last run</p>
        <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap"><thead><tr className="border-b text-left">{['Sport / market','Saved','W–L–P','Units','Paper ROI','Approx. 95% interval','Model − market log loss'].map(x=><th className="px-2 py-2" key={x}>{x}</th>)}</tr></thead><tbody>
          {rows.map(r=><tr className="border-b" key={`${r.sport}-${r.market}`}><td className="px-2 py-2">{r.sport.toUpperCase()} / {r.market}</td><td className="px-2">{r.captured}</td><td className="px-2">{r.wins}–{r.losses}–{r.pushes}</td><td className="px-2">{r.roi.n?r.units.toFixed(2):'—'}</td><td className="px-2">{pct(r.roi.mean)}</td><td className="px-2">{interval(r.roi)}</td><td className="px-2">{r.logLossDifference.mean?.toFixed(4)??'—'} ({r.logLossDifference.n} games)</td></tr>)}
        </tbody></table></div>
      </>}
      <p className="text-xs text-gray-500">Paper returns risk one unit at the recorded price; no execution, stake limits or slippage are assumed. Ties/pushes return the stake; equal forecasts make no directional pick. Negative log-loss difference favors the model. ESPN provides an observation time, not a bookmaker update timestamp.</p>
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Price shopping · no model involved</h2>
      <p className="text-sm text-gray-600">Each book, side and exact line is recorded once. Closing value requires a separate, later quote in the final hour before start. The flagged book is excluded from consensus; uncertainty is grouped by game.</p>
      {report?<div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap"><thead><tr className="border-b text-left">{['Market','Flags / started','Valid closes / games','CLV','Approx. 95% interval','Excluded closes'].map(x=><th className="px-2 py-2" key={x}>{x}</th>)}</tr></thead><tbody>{(['games','props'] as const).map(k=>{const r=report[k];return <tr className="border-b" key={k}><td className="px-2 py-2">{k==='games'?'Game lines':'Player props'}</td><td className="px-2">{r.flagged} / {r.started}</td><td className="px-2">{r.n} / {r.games}</td><td className="px-2">{pct(r.mean)}</td><td className="px-2">{interval(r)}</td><td className="px-2">{r.excluded.length}</td></tr>})}</tbody></table></div>:<p>No verified closing-price sample yet.</p>}
      <p className="text-xs text-gray-500">CLV is a probability-point difference, not profit. Game lines and props are reported separately. Repeated books on one game do not create independent evidence. Small samples and multiple comparisons do not establish an edge.</p>
    </section>
    <p className="text-sm text-gray-600 border-t pt-4">Historical results were recalculated after games, so they cannot prove pregame performance. They are excluded from this record. Model parameters and shopping thresholds remain frozen.</p>
  </div>;
}
