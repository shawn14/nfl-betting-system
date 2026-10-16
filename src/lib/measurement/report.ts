import { clustered, digest, SPORTS, validCapture, type ModelCapture, type Settlement, type Market } from './core.ts';
import { shopReport, type ShopCapture, type ShopClose } from './shop.ts';
import { MeasurementStore } from './store.ts';
import { forecastCohort } from '../forecast-provenance.ts';
import { registrationId, researchReport, type Registration } from './research.ts';

export function modelCohortReport(captures:ModelCapture[],settlements:Settlement[]) {
  const valid=captures.filter(validCapture);
  const byId=new Map(valid.map(c=>[c.id,{capture:c,hash:digest(c)}]));
  const buckets=new Map<string,{sport:ModelCapture['sport'];market:Market;cohort:ReturnType<typeof forecastCohort>;
    captured:number;rows:{g:Settlement['grades'][number];game:string}[]}>();
  const bucketKey=(sport:string,market:string,key:string)=>JSON.stringify([sport,market,key]);
  for(const c of valid){
    const cohort=forecastCohort(c.entry);
    for(const m of c.markets){
      const key=bucketKey(c.sport,m.market,cohort.key);
      const bucket=buckets.get(key)??{sport:c.sport,market:m.market,cohort,captured:0,rows:[]};
      bucket.captured++;buckets.set(key,bucket);
    }
  }
  for(const s of settlements){
    const saved=byId.get(s.captureId);
    if(!saved || s.captureHash!==saved.hash || !s.committedAt || !(Date.parse(s.committedAt)>=Date.parse(s.event.commence))
      || s.status!=='final' || s.sport!==saved.capture.sport || s.gameId!==saved.capture.gameId)continue;
    const cohort=forecastCohort(saved.capture.entry);
    for(const g of s.grades)buckets.get(bucketKey(s.sport,g.market,cohort.key))?.rows.push({g,game:`${s.sport}:${s.gameId}`});
  }
  const model=[...buckets.values()].map(({rows,...group})=>{
    const bets=rows.filter(x=>x.g.result!=='no-pick');
    const probabilities=rows.filter(x=>x.g.modelLogLoss!==undefined);
    const roi=clustered(bets.map(x=>({game:x.game,value:x.g.units})));
    const logLossDifference=clustered(probabilities.map(x=>({game:x.game,value:x.g.modelLogLoss!-x.g.marketLogLoss!})));
    return {...group,wins:bets.filter(x=>x.g.result==='win').length,losses:bets.filter(x=>x.g.result==='loss').length,
      pushes:bets.filter(x=>x.g.result==='push').length,noPick:rows.filter(x=>x.g.result==='no-pick').length,
      units:bets.reduce((n,x)=>n+x.g.units,0),roi,logLossDifference};
  }).sort((a,b)=>SPORTS.indexOf(a.sport)-SPORTS.indexOf(b.sport)||a.market.localeCompare(b.market)||a.cohort.key.localeCompare(b.cohort.key));
  return {valid,model};
}

export async function measurementReport(store:MeasurementStore,now=Date.now(), includeEvidence=false) {
  const [captures,settlements,shopCaptures,closes,registrations]=await Promise.all([
    store.list<ModelCapture>('model'),store.list<Settlement>('settlement'),
    store.list<ShopCapture>('shop'),store.list<ShopClose>('shop-close',12000),
    store.list<Registration>('research-registration',100),
  ]);
  const {valid,model}=modelCohortReport(captures,settlements);
  const health=await store.health();
  const research=researchReport(registrations.find(r=>r.id===registrationId())??null,captures,settlements,now);
  return {health,missed:(health?.observations??[]).filter((x:{status:string})=>x.status==='missed').length,updated:new Date(now).toISOString(),model,captures:valid.length,invalidCaptures:captures.length-valid.length,
    unattributed:valid.filter(c=>!forecastCohort(c.entry).attributed).length,
    pending:valid.filter(c=>!settlements.some(s=>s.captureId===c.id)).length,
    voided:settlements.filter(s=>s.status==='void').length,
    games:shopReport(shopCaptures.filter(c=>c.market!=='prop'),closes,now),
    props:shopReport(shopCaptures.filter(c=>c.market==='prop'),closes,now),research,
    priorResearchRegistrations:registrations.filter(r=>r.id!==registrationId()).map(r=>({id:r.id,sourceSha:r.sourceSha,committedAt:r.committedAt,codeHash:r.codeHash})),
    // Export only evidence from this new namespace; never joins legacy 'results'.
    ...(includeEvidence ? {evidence:{captures,settlements,shopCaptures,closes,registrations}} : {})};
}
