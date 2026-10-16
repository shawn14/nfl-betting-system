/** Recurring, preregistered paper screens. Never writes a prediction, tunes a weight or places a bet. */
import { digest, makeCapture, settle, validCapture, SPORTS, type FrozenMarket, type ModelCapture, type Settlement, type Sport, type Market } from './core.ts';
import { forecastCohort } from '../forecast-provenance.ts';
import { americanToDecimal, invNormCdf } from '../fair-value.ts';
import { evaluateGame, MIN_EV } from '../ev-model.ts';
import type { MeasurementStore, Stored } from './store.ts';
import { RESEARCH_HASH, RESEARCH_FILES } from './research-identity.ts';

export const RESEARCH_POLICY = {
  version:'2026-10-16-paper-v1',
  rules:['published-direction','raw-model-value','frozen-ev-rule'] as const,
  minExpectedReturn:MIN_EV, costStressPerUnit:0.01,
  // Fixed horizon, not an invitation to stop when an interim interval turns positive.
  horizonDays:56, minSettledGames:100, minGameDates:14,
  familywiseAlpha:0.05, autoPromotion:false,
  claims:'Paper screening only; recorded prices do not prove available stakes, fills or profit.',
};
type Rule = typeof RESEARCH_POLICY.rules[number];
export interface Registration extends Stored {
  kind:'research-registration'; policyHash:string; codeHash:string;
  policy:typeof RESEARCH_POLICY; sourceSha:string; registeredAt:string;
}
const policyHash = () => digest({policy:RESEARCH_POLICY,codeHash:RESEARCH_HASH});
const canonical=(x:unknown):unknown=>x&&typeof x==='object'?(Array.isArray(x)?x.map(canonical):
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical((x as Record<string,unknown>)[k])]))):x;
const same=(a:unknown,b:unknown)=>digest(canonical(a))===digest(canonical(b));
export const registrationId = () => `research-${policyHash()}`;
export async function registerResearch(store:MeasurementStore):Promise<Registration> {
  const sourceSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Research registration needs deployed source identity');
  const registration = await store.get<Registration>(registrationId()) ?? await store.create<Registration>({id:registrationId(),kind:'research-registration',
    policyHash:policyHash(),codeHash:RESEARCH_HASH,files:RESEARCH_FILES,policy:RESEARCH_POLICY,
    sourceSha,registeredAt:new Date().toISOString()});
  if (!validRegistration(registration)) throw new Error('Research registration differs from the installed policy');
  return registration;
}
export function validRegistration(r:Registration|null):r is Registration {
  return !!r && r.kind==='research-registration' && r.id===registrationId() && r.policyHash===policyHash()
    && r.codeHash===RESEARCH_HASH && same(r.policy,RESEARCH_POLICY) && same(r.files,RESEARCH_FILES) && /^[a-f0-9]{40}$/.test(r.sourceSha)
    && Number.isFinite(Date.parse(r.committedAt??'')) && Date.parse(r.registeredAt)<=Date.parse(r.committedAt!);
}

/** Rebuild the original admission contract from retained evidence; derived fields cannot certify themselves. */
export function consistentResearchCapture(c:ModelCapture):boolean {
  if(!validCapture(c)||!SPORTS.includes(c.sport)||!/^[a-f0-9]{40}$/.test(c.collectorSha)||!/^[a-f0-9]{64}$/.test(c.sourceHash))return false;
  try {
    const rebuilt=makeCapture({sport:c.sport,entry:c.entry,publishedAt:c.publishedAt,sourceUrl:c.sourceUrl,
      sourceHash:c.sourceHash,rawPrices:c.rawPrices,event:c.status,observedAt:c.priceObservedAt,
      now:Date.parse(c.capturedAt),collectorSha:c.collectorSha});
    const {committedAt:_serverTime,...body}=c;
    return rebuilt!==null&&same(rebuilt,body);
  }catch{return false;}
}

/** Exact same input capture for all screens; no outcome, clock, training data or network is available here. */
export function researchDecision(c:ModelCapture,m:FrozenMarket,rule:Rule) {
  let probabilityA=m.modelA, side:'a'|'b'|null=m.side;
  if (rule==='raw-model-value') {
    const a=m.modelA*americanToDecimal(m.priceA)-1, b=(1-m.modelA)*americanToDecimal(m.priceB)-1;
    side=Math.max(a,b)>=RESEARCH_POLICY.minExpectedReturn ? (a>=b?'a':'b') : null;
  } else if(rule==='frozen-ev-rule') {
    const ev=evaluateGame(c.sport,'home','away',c.entry.prediction,c.prices).markets.find(x=>x.market===m.market);
    if (!ev?.best) return null;
    side=ev.best===ev.sides[0]?'a':'b'; probabilityA=ev.sides[0].prob;
  }
  if (!side) return null;
  return {side,probabilityA,price:side==='a'?m.priceA:m.priceB};
}
const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const interval=(values:number[],z:number)=>{
  const n=values.length,mu=mean(values);
  const se=n>1?Math.sqrt(values.reduce((s,x)=>s+(x-mu!)**2,0)/(n-1)/n):null;
  return {n,mean:mu,lo:se===null?null:mu!-z*se,hi:se===null?null:mu!+z*se};
};
const loss=(p:number,y:number)=>-(y*Math.log(Math.max(1e-12,p))+(1-y)*Math.log(Math.max(1e-12,1-p)));
type Observation={game:string;date:string;units:number;lossDifference:number|null};
type Bucket={sport:Sport;market:Market;rule:Rule;cohort:ReturnType<typeof forecastCohort>;observed:number;selected:number;pending:number;voided:number;rows:Observation[]};

export function researchReport(registration:Registration|null,captures:ModelCapture[],settlements:Settlement[],now=Date.now()) {
  const registered=validRegistration(registration)&&Date.parse(registration.committedAt!)<=now, start=registered?Date.parse(registration.committedAt!):null;
  const end=start===null?null:start+RESEARCH_POLICY.horizonDays*864e5;
  const exclusions:Record<string,number>={},exclude=(reason:string)=>{exclusions[reason]=(exclusions[reason]??0)+1;};
  const buckets=new Map<string,Bucket>();
  const byCapture=new Map<string,Settlement[]>();
  for(const s of settlements)byCapture.set(s.captureId,[...(byCapture.get(s.captureId)??[]),s]);
  const cohorts=new Set<string>(),seen=new Set<string>();
  for(const c of [...captures].sort((a,b)=>a.id.localeCompare(b.id))){
    if(seen.has(c.id)){exclude('duplicate_capture');continue;}seen.add(c.id);
    const cohort=forecastCohort(c.entry);
    if(!consistentResearchCapture(c)||Date.parse(c.committedAt!)>now||!cohort.attributed||c.modelVersion!==cohort.modelVersion||c.modelSourceSha!==cohort.sourceSha){exclude('invalid_or_unknown_producer');continue;}
    if(start===null||Date.parse(c.committedAt!)<=start||Date.parse(c.capturedAt)<start){exclude('before_registration');continue;}
    if(Date.parse(c.commence)>=end!){exclude('outside_fixed_horizon');continue;}
    cohorts.add(cohort.key);
    const matching=byCapture.get(c.id)??[];
    let settlement: Settlement|null=null;
    if(matching.length>1)exclude('duplicate_settlement');
    else if(matching.length===1){
      const s=matching[0],t=Date.parse(s.settledAt),commit=Date.parse(s.committedAt??'');
      const recomputed=settle(c,s.event,s.sourceUrl,t);
      if(s.captureHash===digest(c)&&s.sport===c.sport&&s.gameId===c.gameId&&commit>=t&&commit<=now
        &&recomputed&&s.status===recomputed.status&&same(s.grades,recomputed.grades))settlement=s;
      else exclude('invalid_settlement');
    }
    for(const m of c.markets){
      for(const rule of RESEARCH_POLICY.rules){
        const key=JSON.stringify([c.sport,m.market,rule,cohort.key]);
        const b=buckets.get(key)??{sport:c.sport,market:m.market,rule,cohort,observed:0,selected:0,pending:0,voided:0,rows:[]};
        buckets.set(key,b);b.observed++;
        const d=researchDecision(c,m,rule);if(!d)continue;b.selected++;
        if(!settlement){b.pending++;continue;}if(settlement.status==='void'){b.voided++;continue;}
        const h=settlement.event.homeScore!,a=settlement.event.awayScore!;
        const delta=m.market==='ml'?h-a:m.market==='spread'?h-a+m.line!:h+a-m.line!;
        const y=delta>0?1:0,won=(d.side==='a')===(y===1);
        b.rows.push({game:`${c.sport}:${c.gameId}`,date:c.commence.slice(0,10),
          units:(delta===0?0:won?americanToDecimal(d.price)-1:-1)-RESEARCH_POLICY.costStressPerUnit,
          lossDifference:delta===0?null:loss(d.probabilityA,y)-loss(m.marketA,y)});
      }
    }
  }
  // Include every declared sport/market/rule for each producer cohort, even unobserved combinations.
  // Three endpoints per comparison: return and predictive loss, plus the early/late stability check below.
  const comparisons=Math.max(1,cohorts.size)*SPORTS.length*3*RESEARCH_POLICY.rules.length*3;
  const z=invNormCdf(1-RESEARCH_POLICY.familywiseAlpha/(2*comparisons));
  const candidates=[...buckets.entries()].map(([id,b])=>{
    const rows=b.rows.sort((a,b)=>a.date.localeCompare(b.date)||a.game.localeCompare(b.game));
    const unique=new Set(rows.map(r=>r.game));
    if(unique.size!==rows.length)throw new Error('Research candidate contains repeated independent games');
    const roi=interval(rows.map(r=>r.units),z),logLossDifference=interval(rows.flatMap(r=>r.lossDifference===null?[]:[r.lossDifference]),z);
    const dates=new Set(rows.map(r=>r.date)).size,half=Math.floor(rows.length/2);
    const early=mean(rows.slice(0,half).map(r=>r.units)),late=mean(rows.slice(half).map(r=>r.units));
    const ended=end!==null&&now>=end,complete=b.pending===0;
    let status='collecting';
    if(ended&&!complete)status='awaiting-outcomes';
    else if(ended&&complete){
      if(rows.length<RESEARCH_POLICY.minSettledGames||dates<RESEARCH_POLICY.minGameDates||logLossDifference.n<RESEARCH_POLICY.minSettledGames)status='insufficient-evidence';
      else if(roi.hi!==null&&roi.hi<0)status='rejected';
      else if(roi.lo!==null&&roi.lo>0&&logLossDifference.hi!==null&&logLossDifference.hi<0&&early!==null&&early>0&&late!==null&&late>0)status='review-required';
      else status='no-demonstrated-edge';
    }
    return {id,sport:b.sport,market:b.market,rule:b.rule,cohort:b.cohort,observed:b.observed,selected:b.selected,
      pending:b.pending,voided:b.voided,games:unique.size,dates,roi,logLossDifference,early,late,status};
  }).sort((a,b)=>a.sport.localeCompare(b.sport)||a.market.localeCompare(b.market)||a.rule.localeCompare(b.rule)||a.cohort.key.localeCompare(b.cohort.key));
  return {state:registered?'registered':'unregistered',policyHash:policyHash(),registration,
    policy:RESEARCH_POLICY,checkedAt:new Date(now).toISOString(),endsAt:end===null?null:new Date(end).toISOString(),
    intervalMethod:'Approximate normal game-level intervals with Bonferroni adjustment; fixed-horizon screening, not profit certification',
    comparisons,z,autoPromotion:false,exclusions,candidates,
    coverage:SPORTS.map(sport=>({sport,captured:captures.filter(c=>c.sport===sport&&validCapture(c)).length,
      candidateGroups:candidates.filter(c=>c.sport===sport).length,selected:candidates.filter(c=>c.sport===sport).reduce((n,c)=>n+c.selected,0)})),
    nextAction:!registered?'Register the frozen paper screens before the first eligible capture.':
      candidates.some(c=>c.status==='review-required')?'Independent review and a new untouched confirmation cohort required; no automatic promotion.':
      end!==null&&now>=end?'Fixed horizon ended. Review coverage and failures before registering another experiment.':
      'Continue scheduled captures and final-outcome grading. Interim rankings do not approve a strategy.'};
}
