export const TERMINAL_SPORTS=['nfl','nba','nhl','cbb','wnba'] as const;
export type Sport=typeof TERMINAL_SPORTS[number];
export type Json=Record<string,any>;
export interface Source {sport:string;url:string;hash:string;fetchedAt:string;data:Json|null;error?:string}
export interface TerminalGame {
 id:string;gameId:string;sport:Sport;commence:string;venue:string;home:string;away:string;homeAbbr:string;awayAbbr:string;
 publishedAt:string;sourceUrl:string;sourceHash:string;forecast:{homeProbability:number;homeScore:number;awayScore:number;spread:number;total:number};
 calc:Record<string,number>;weather:Json|null;injuries:Json|null;rest:Json|null;movement:Json|null;
 totals:never[];totalsAt:null;markets:Json[];marketAt:string|null;marketEventId:string|null;marketSourceUrl:string;marketSourceHash:string;
 signalDisagreement:boolean;notes:string[];
}
export interface TerminalData {builtAt:string;games:TerminalGame[];sources:{sport:string;publishedAt:string|null;rows:number;omitted:number;error:string|null}[];counts:{started:number;invalid:number;outsideHorizon:number;duplicates:number;capped:number}}
export const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export const validPrice=(x:unknown):x is number=>finite(x)&&Math.abs(x)>=100;
export function instant(value:unknown):number {return typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)?Date.parse(value):NaN;}
export function isFresh(at:string|null,commence:string,now:number,forecast=false) {
 const time=instant(at),kick=instant(commence);
 const max=forecast?3*36e5:kick-now>6*36e5?150*60e3:45*60e3;
 return Number.isFinite(time)&&time<=now&&now-time<=max&&kick>now;
}
const record=(x:unknown):x is Json=>!!x&&typeof x==='object'&&!Array.isArray(x);
const name=(s:unknown)=>typeof s==='string'?s.trim().toLowerCase().replace(/[^a-z0-9]/g,''):'';
const validProbability=(x:unknown)=>finite(x)&&x>=0&&x<=1;
export function normalizeTerminal(sources:Source[],board:Source,now=Date.now()):TerminalData {
 const games:TerminalGame[]=[],counts={started:0,invalid:0,outsideHorizon:0,duplicates:0,capped:0};
 const coverage:TerminalData['sources']=[];
 for(const sport of TERMINAL_SPORTS){
  const source=sources.find(x=>x.sport===sport),data=source?.data;
  const inputEntries=Array.isArray(data?.games)?data!.games:[];
  const entries=inputEntries.filter(record);
  const pub=instant(data?.generated);let omitted=inputEntries.length-entries.length,kept=0;counts.invalid+=omitted;
  const seen=new Set<string>();
  const duplicates=new Set(entries.map((e:Json)=>String(e.game?.id)).filter((id:string)=>seen.has(id)?true:(seen.add(id),false)));
  for(const entry of [...entries].sort((a:Json,b:Json)=>instant(a.game?.gameTime)-instant(b.game?.gameTime))){
   const g=entry.game,p=entry.prediction,kick=instant(g?.gameTime);
   if(duplicates.has(String(g?.id))){counts.duplicates++;omitted++;continue;}
   if(!g||!p||!/^\d+$/.test(String(g.id))||String(p.gameId)!==String(g.id)||!Number.isFinite(kick)||!name(g.homeTeam?.name)||!name(g.awayTeam?.name)
    ||!Number.isFinite(pub)||pub>now||![p.predictedHomeScore,p.predictedAwayScore,p.predictedSpread,p.predictedTotal].every(finite)
    ||p.predictedHomeScore<0||p.predictedAwayScore<0||p.predictedTotal<=0||!validProbability(p.homeWinProbability)) {counts.invalid++;omitted++;continue;}
   if(g.status!=='scheduled'||kick<=now){counts.started++;omitted++;continue;}
   if(kick-now>8*864e5){counts.outsideHorizon++;omitted++;continue;}
   if(kept>=64){counts.capped++;omitted++;continue;}
   const bookSport=board.data?.sports?.[sport];
   const sameNames=(Array.isArray(bookSport?.events)?bookSport.events:[]).filter(record).filter((e:Json)=>name(e.home)===name(g.homeTeam.name)&&name(e.away)===name(g.awayTeam.name));
   const matches=sameNames.filter((e:Json)=>instant(e.commence)===kick);
   const matched=matches.length===1?matches[0]:null;
   const markets=(Array.isArray(matched?.markets)?matched.markets:[]).filter(record).filter((m:Json)=>['ml','spread','total'].includes(m.market)&&(m.market==='ml'||finite(m.line)))
    .map((m:Json)=>({id:m.id,market:m.market,line:m.line??null,books:m.books,fairA:validProbability(m.fairA)?m.fairA:null,fairSource:m.fairSource??null,
     bestA:m.bestA&&typeof m.bestA.label==='string'&&typeof m.bestA.book==='string'&&validPrice(m.bestA.price)?{label:m.bestA.label,book:m.bestA.book,price:m.bestA.price,fairProb:validProbability(m.bestA.fairProb)?m.bestA.fairProb:null,ev:finite(m.bestA.ev)?m.bestA.ev:null}:null,
     bestB:m.bestB&&typeof m.bestB.label==='string'&&typeof m.bestB.book==='string'&&validPrice(m.bestB.price)?{label:m.bestB.label,book:m.bestB.book,price:m.bestB.price,fairProb:validProbability(m.bestB.fairProb)?m.bestB.fairProb:null,ev:finite(m.bestB.ev)?m.bestB.ev:null}:null}));
   const bt=instant(bookSport?.fetchedAt);
   const notes:string[]=[];
   if(sameNames.length&&!matched)notes.push('Bookmaker event time differs or match is ambiguous. Prices were not joined to this forecast.');
   if(!matched)notes.push('No exact team-and-start-time match on the game-price board.');
   if(!isFresh(data!.generated,g.gameTime,now,true))notes.push('Forecast publication is stale; excluded from probability ranking.');
   notes.push('Individual bookmaker totals are withheld: the forecast feed does not identify their source event. Exact-match board prices remain available when supplied.');
   const scoreSide=Math.sign(p.predictedHomeScore-p.predictedAwayScore),probSide=Math.sign(p.homeWinProbability-.5);
   const signalDisagreement=scoreSide!==0&&probSide!==0&&scoreSide!==probSide;
   if(signalDisagreement)notes.push('The score projection and win-probability model favor different teams. Inspect both signals.');
   games.push({id:`${sport}:${g.id}`,gameId:String(g.id),sport,commence:new Date(kick).toISOString(),venue:typeof g.venue==='string'?g.venue:'',home:g.homeTeam.name,away:g.awayTeam.name,
    homeAbbr:typeof g.homeTeam.abbreviation==='string'?g.homeTeam.abbreviation:g.homeTeam.name,awayAbbr:typeof g.awayTeam.abbreviation==='string'?g.awayTeam.abbreviation:g.awayTeam.name,publishedAt:data!.generated,sourceUrl:source!.url,sourceHash:source!.hash,
    forecast:{homeProbability:p.homeWinProbability,homeScore:p.predictedHomeScore,awayScore:p.predictedAwayScore,spread:p.predictedSpread,total:p.predictedTotal},
    calc:Object.fromEntries(Object.entries(p.calc??{}).filter(([,v])=>finite(v))) as Record<string,number>,weather:p.weather??null,injuries:p.injuries??null,rest:p.restDays??null,movement:p.lineMovement??null,
    totals:[],totalsAt:null,
    markets:Number.isFinite(bt)&&bt<=now?markets:[],marketAt:matched&&Number.isFinite(bt)&&bt<=now?bookSport.fetchedAt:null,marketEventId:matched?.id??null,marketSourceUrl:board.url,marketSourceHash:board.hash,signalDisagreement,notes});
   kept++;
  }
  coverage.push({sport,publishedAt:Number.isFinite(pub)?data!.generated:null,rows:kept,omitted,error:source?.error??(!data?'Source unavailable':!Array.isArray(data.games)?'Source games missing':null)});
 }
 return {builtAt:new Date(now).toISOString(),games:games.sort((a,b)=>a.commence.localeCompare(b.commence)),sources:coverage,counts};
}
export function marketGap(g:TerminalGame,now:number):number|null {
 const ml=g.markets.find(m=>m.market==='ml');
 return ml?.fairA!=null&&isFresh(g.marketAt,g.commence,now)&&isFresh(g.publishedAt,g.commence,now,true)?g.forecast.homeProbability-ml.fairA:null;
}
export function bestShoppingEv(g:TerminalGame,now:number):number|null {
 if(!isFresh(g.marketAt,g.commence,now))return null;
 const values=g.markets.flatMap(m=>[m.bestA?.ev,m.bestB?.ev]).filter(finite);
 return values.length?Math.max(...values):null;
}
