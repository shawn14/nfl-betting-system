import { clustered, digest, SPORTS, validCapture, type ModelCapture, type Settlement, type Market } from './core.ts';
import { shopReport, type ShopCapture, type ShopClose } from './shop.ts';
import { MeasurementStore } from './store.ts';

export async function measurementReport(store:MeasurementStore,now=Date.now(), includeEvidence=false) {
  const [captures,settlements,shopCaptures,closes]=await Promise.all([
    store.list<ModelCapture>('model'),store.list<Settlement>('settlement'),
    store.list<ShopCapture>('shop'),store.list<ShopClose>('shop-close',12000),
  ]);
  const valid=captures.filter(validCapture), ids=new Set(valid.map(c=>c.id));
  const scored=settlements.filter(s=>ids.has(s.captureId) && s.captureHash===digest(valid.find(c=>c.id===s.captureId)) && !!s.committedAt && Date.parse(s.committedAt)>=Date.parse(s.event.commence) && s.status==='final');
  const model=SPORTS.flatMap(sport=>(['ml','spread','total'] as Market[]).map(market=>{
    const rows=scored.filter(s=>s.sport===sport).flatMap(s=>s.grades.filter(g=>g.market===market).map(g=>({g,game:`${sport}:${s.gameId}`})));
    const bets=rows.filter(x=>x.g.result!=='no-pick');
    const probabilities=rows.filter(x=>x.g.modelLogLoss!==undefined);
    const roi=clustered(bets.map(x=>({game:x.game,value:x.g.units})));
    const logLossDifference=clustered(probabilities.map(x=>({game:x.game,value:x.g.modelLogLoss!-x.g.marketLogLoss!})));
    return {sport,market,captured:valid.filter(c=>c.sport===sport && c.markets.some(m=>m.market===market)).length,
      wins:bets.filter(x=>x.g.result==='win').length,losses:bets.filter(x=>x.g.result==='loss').length,pushes:bets.filter(x=>x.g.result==='push').length,
      noPick:rows.filter(x=>x.g.result==='no-pick').length,units:bets.reduce((n,x)=>n+x.g.units,0),roi,logLossDifference};
  }));
  const health=await store.health();
  return {health,missed:(health?.observations??[]).filter((x:{status:string})=>x.status==='missed').length,updated:new Date(now).toISOString(),model,captures:valid.length,invalidCaptures:captures.length-valid.length,
    pending:valid.filter(c=>!settlements.some(s=>s.captureId===c.id)).length,
    voided:settlements.filter(s=>s.status==='void').length,
    games:shopReport(shopCaptures.filter(c=>c.market!=='prop'),closes,now),
    props:shopReport(shopCaptures.filter(c=>c.market==='prop'),closes,now),
    // Export only evidence from this new namespace; never joins legacy 'results'.
    ...(includeEvidence ? {evidence:{captures,settlements,shopCaptures,closes}} : {})};
}
