import { clean, clustered, digest, MEASUREMENT_VERSION, SAFETY_MS, type Json } from './core.ts';
import { fairFor, gameMarkets, propMarkets, shop, validQuote, LINE_SHOP_VERSION, type OddsApiEvent, type TwoWay } from '../line-shop.ts';
import { impliedProb } from '../fair-value.ts';
import type { MeasurementStore } from './store.ts';

export interface ShopCapture {
  id: string; kind:'shop'; version:string; ruleVersion:string; sport:string; eventId:string; commence:string;
  deadline:string; capturedAt:string; observedAt:string; matchup:string; marketId:string; market:string;
  line?:number; side:'a'|'b'; label:string; book:string; price:number; fairProb:number; fairSource:string;
  quotes:TwoWay['quotes']; method:TwoWay['method']; committedAt?:string;
}
export interface ShopClose {
  id:string; kind:'shop-close'; captureId:string; captureHash:string; observedAt:string; commence:string;
  fairProb:number; fairSource:string; quotes:TwoWay['quotes']; committedAt?:string;
}

/** Upstream timestamps remain distinct from request time. Unknown/stale quotes cannot certify CLV. */
export function freshMarkets(event: OddsApiEvent, observedAt: string, props: boolean): TwoWay[] {
  const now = Date.parse(observedAt);
  const filtered: OddsApiEvent = { ...event, bookmakers:event.bookmakers.map(b => ({...b,
    markets:b.markets.filter(m => {
      const ts = Date.parse(m.last_update ?? b.last_update ?? '');
      return Number.isFinite(ts) && ts <= now && now-ts <= 15*60e3;
    }) })) };
  return (props ? propMarkets(filtered) : gameMarkets(filtered)).map(m => ({...m,quotes:m.quotes.filter(validQuote)}));
}
export function newShopCaptures(event: OddsApiEvent, sport: string, observedAt: string, props=false, now=Date.now()): ShopCapture[] {
  const kick = Date.parse(event.commence_time), observed = Date.parse(observedAt);
  if (!Number.isFinite(kick) || observed > now || now-observed > SAFETY_MS || kick-now <= SAFETY_MS || kick-now > 72*36e5) return [];
  return freshMarkets(event, observedAt, props).flatMap(tw => shop(tw).flags.map(f => {
    const side = f.label === tw.labelA ? 'a' : 'b';
    const fair = fairFor(tw.quotes,tw.method,f.book)!;
    return clean({id:`shop-${digest([sport,tw.id,side,f.book])}`,kind:'shop',version:MEASUREMENT_VERSION,ruleVersion:LINE_SHOP_VERSION,
      sport,eventId:event.id,commence:event.commence_time,deadline:new Date(kick-SAFETY_MS).toISOString(),
      capturedAt:new Date(now).toISOString(),observedAt,matchup:`${event.away_team} @ ${event.home_team}`,
      marketId:tw.id,market:tw.market,line:tw.line,side,label:f.label,book:f.book,price:f.price,fairProb:f.fairProb,
      fairSource:fair.source,quotes:tw.quotes,method:tw.method } as ShopCapture);
  }));
}
export function makeClose(c:ShopCapture, event:OddsApiEvent, observedAt:string, props=false, now=Date.now()): ShopClose | null {
  const close = Date.parse(observedAt), kick=Date.parse(c.commence), start=Date.parse(c.observedAt);
  if (!c.committedAt || Date.parse(c.committedAt)>Date.parse(c.deadline) || event.id!==c.eventId
    || Date.parse(event.commence_time)!==kick || close<=start || close<=Date.parse(c.committedAt)
    || close>=kick || kick-close>60*60e3 || now>=kick || close>now || now-close>SAFETY_MS) return null;
  const tw=freshMarkets(event,observedAt,props).find(m=>m.id===c.marketId && m.market===c.market && m.line===c.line);
  if (!tw) return null;
  // Each closing reference must actually have updated after entry (same cached quote is not a close).
  const seen=new Set<string>();
  const qs=tw.quotes.filter(q=>q.updatedAt && Date.parse(q.updatedAt)>start)
    .filter(q=>seen.has(q.book)?false:(seen.add(q.book),true));
  const fair=fairFor(qs,tw.method,c.book); // Preserve leave-one-out; the flagged book never prices itself.
  if (!fair) return null;
  return clean({id:`close-${digest([c.id,observedAt])}`,kind:'shop-close',captureId:c.id,captureHash:digest(c),
    observedAt,commence:c.commence,fairProb:c.side==='a'?fair.p:1-fair.p,fairSource:fair.source,quotes:qs});
}
export async function recordShopEvent(store:MeasurementStore,event:OddsApiEvent,sport:string,observedAt:string,props=false) {
  const captures=await store.forEvent<ShopCapture>('shop',sport,event.id);
  const byId=new Map(captures.map(c=>[c.id,c]));
  for (const c of newShopCaptures(event,sport,observedAt,props)) {
    if (!byId.has(c.id)) byId.set(c.id,await store.create(c));
  }
  let closes=0;
  for (const c of byId.values()) {
    const close=makeClose(c,event,observedAt,props);
    if (close) { await store.create(close); closes++; }
  }
  return {captures:byId.size,closes};
}
export function shopReport(captures:ShopCapture[],closes:ShopClose[],now=Date.now()) {
  const rows:Json[]=[], excluded:Json[]=[];
  for (const c of captures) {
    if (Date.parse(c.commence)>now) continue;
    const eligible=closes.filter(x=>x.captureId===c.id && x.captureHash===digest(c) && x.committedAt
      && Date.parse(x.committedAt)<Date.parse(c.commence) && Date.parse(x.observedAt)>Date.parse(c.observedAt)
      && Date.parse(x.observedAt)>Date.parse(c.committedAt ?? '') && Date.parse(x.observedAt)<Date.parse(c.commence)
      && Date.parse(c.commence)-Date.parse(x.observedAt)<=60*60e3);
    const last=eligible.sort((a,b)=>b.observedAt.localeCompare(a.observedAt))[0];
    if (!last || !c.committedAt || Date.parse(c.committedAt)>Date.parse(c.deadline)) { excluded.push({id:c.id,reason:'No valid later close in final hour'}); continue; }
    rows.push({game:`${c.sport}:${c.eventId}`,value:last.fairProb-impliedProb(c.price),capture:c,close:last});
  }
  return {flagged:captures.length,started:captures.filter(c=>Date.parse(c.commence)<=now).length,
    ...clustered(rows as {game:string;value:number}[]),excluded,rows};
}
