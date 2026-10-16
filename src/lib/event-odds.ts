/** Exact-event observed totals. No guessed prices, fuzzy joins or averaged American odds. */
import { gameMarkets, validQuote, type OddsApiEvent } from './line-shop.ts';

export const ODDS_SPORT_KEYS = {
  nfl: 'americanfootball_nfl', nba: 'basketball_nba', nhl: 'icehockey_nhl',
  cbb: 'basketball_ncaab', wnba: 'basketball_wnba',
} as const;
export type OddsSport = keyof typeof ODDS_SPORT_KEYS;
export type GameIdentity = { sport: OddsSport; home: string; away: string; commence: string };
export interface ObservedTotal {
  key: string; name: string; total: number; overOdds: number; underOdds: number;
  updatedAt: string; clockBasis: 'market' | 'bookmaker';
}
export interface EventLiveOdds {
  schemaVersion: 'event-totals-v1'; provider: 'the-odds-api'; eventId: string;
  sportKey: string; homeTeam: string; awayTeam: string; commenceTime: string;
  observedAt: string; lastUpdated: string; bookmakers: ObservedTotal[];
  // Backward-compatible display field: a unique modal OFFERED line, never an average.
  // No consensusOverOdds/consensusUnderOdds: an average price is not an executable quote.
  consensusTotal?: number;
}
export type EventOddsMap = Map<string, EventLiveOdds>;
type Json = Record<string, any>;
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
// Whitespace/case normalization only. Different names/roles are not aliases by guesswork.
export const teamName = (v: string) => v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function oddsInstant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return NaN;
  const canonical = value.replace(/T(\d{2}:\d{2})Z$/, 'T$1:00Z');
  const result = Date.parse(canonical);
  return Number.isFinite(result) && new Date(result).toISOString().slice(0,19) === canonical.slice(0,19) ? result : NaN;
}
export function modalTotal(quotes: { total?: number; key?: string }[]): number | undefined {
  const counts = new Map<number,number>();
  for (const q of quotes) if (number(q.total) && q.total > 0) counts.set(q.total, (counts.get(q.total) ?? 0) + 1);
  const ranked = [...counts].sort((a,b) => b[1] - a[1]);
  return ranked[0]?.[1] >= 2 && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : undefined;
}
function withQuotes(base: Omit<EventLiveOdds,'bookmakers'|'lastUpdated'|'consensusTotal'>, quotes: ObservedTotal[]): EventLiveOdds | undefined {
  if (!quotes.length) return undefined;
  const mode = modalTotal(quotes);
  return {...base, bookmakers:quotes, lastUpdated:quotes.map(q=>q.updatedAt).sort()[0], ...(mode === undefined ? {} : {consensusTotal:mode})};
}
/** Production parser also used verbatim by the archived-real-response proof. */
export function parseEventOdds(raw: unknown, sport: OddsSport, observedAt: string): EventOddsMap {
  const observed = oddsInstant(observedAt), result: EventOddsMap = new Map();
  if (!Array.isArray(raw) || !Number.isFinite(observed)) return result;
  const events = raw.filter(object), idCounts = new Map<string,number>(), identityCounts = new Map<string,number>();
  const identityKey = (e:Json) => JSON.stringify([e.sport_key,teamName(e.home_team),teamName(e.away_team),oddsInstant(e.commence_time)]);
  for (const e of events) {
    if (text(e.id)) idCounts.set(e.id,(idCounts.get(e.id)??0)+1);
    if(text(e.home_team)&&text(e.away_team)&&Number.isFinite(oddsInstant(e.commence_time))) {
      const key=identityKey(e);identityCounts.set(key,(identityCounts.get(key)??0)+1);
    }
  }
  for (const e of events) {
    if (!text(e.id) || idCounts.get(e.id) !== 1 || e.sport_key !== ODDS_SPORT_KEYS[sport]
      || !text(e.home_team) || !text(e.away_team) || teamName(e.home_team) === teamName(e.away_team)
      || !Number.isFinite(oddsInstant(e.commence_time)) || !Array.isArray(e.bookmakers) || identityCounts.get(identityKey(e))!==1) continue;
    const books = e.bookmakers.filter(object), bookCounts = new Map<string,number>();
    for (const b of books) if (text(b.key)) bookCounts.set(b.key,(bookCounts.get(b.key)??0)+1);
    const quotes: ObservedTotal[] = [];
    for (const b of books) {
      if (!text(b.key) || !text(b.title) || bookCounts.get(b.key) !== 1 || !Array.isArray(b.markets)) continue;
      const totals = b.markets.filter((m:unknown) => object(m) && m.key === 'totals');
      if (totals.length !== 1) continue;
      const m = totals[0];
      if (!Array.isArray(m.outcomes) || m.outcomes.length !== 2 || !m.outcomes.every(object)) continue;
      const over=m.outcomes.find((o:Json)=>o.name==='Over'),under=m.outcomes.find((o:Json)=>o.name==='Under');
      if (!over || !under || !number(over.point) || over.point <= 0 || over.point !== under.point) continue;
      const updatedAt=m.last_update ?? b.last_update, updated=oddsInstant(updatedAt);
      if (!Number.isFinite(updated) || updated > observed) continue;
      // Reuse the existing exact-line adapter and margin/price validity gate.
      const cleanEvent: OddsApiEvent = {id:e.id,home_team:e.home_team,away_team:e.away_team,commence_time:e.commence_time,
        bookmakers:[{key:b.key,last_update:b.last_update,markets:[m]}]};
      const q=gameMarkets(cleanEvent).find(t=>t.market==='total')?.quotes[0];
      if (!q || !validQuote(q)) continue;
      quotes.push({key:b.key,name:b.title,total:over.point,overOdds:q.a,underOdds:q.b,updatedAt,
        clockBasis:m.last_update == null ? 'bookmaker' : 'market'});
    }
    const entry=withQuotes({schemaVersion:'event-totals-v1',provider:'the-odds-api',eventId:e.id,sportKey:e.sport_key,
      homeTeam:e.home_team,awayTeam:e.away_team,commenceTime:e.commence_time,observedAt},quotes);
    if(entry)result.set(e.id,entry);
  }
  return result;
}
/** Reader guard: old blobs and wrong/stale identities cannot become prices during a rollout. */
export function verifiedLiveOdds(raw: unknown, game: GameIdentity, now=Date.now()): EventLiveOdds | undefined {
  if (!object(raw) || raw.schemaVersion !== 'event-totals-v1' || raw.provider !== 'the-odds-api'
    || !text(raw.eventId) || raw.sportKey !== ODDS_SPORT_KEYS[game.sport]
    || !text(game.home) || !text(game.away) || !text(raw.homeTeam) || !text(raw.awayTeam)
    || teamName(raw.homeTeam)!==teamName(game.home) || teamName(raw.awayTeam)!==teamName(game.away)
    || !Number.isFinite(oddsInstant(game.commence)) || oddsInstant(raw.commenceTime)!==oddsInstant(game.commence)
    || !Number.isFinite(oddsInstant(raw.observedAt)) || oddsInstant(raw.observedAt)>now || !Array.isArray(raw.bookmakers)) return undefined;
  const maxAge=oddsInstant(game.commence)-now>6*36e5?150*60e3:45*60e3;
  if(now-oddsInstant(raw.observedAt)>maxAge)return undefined;
  const counts=new Map<string,number>();
  for(const q of raw.bookmakers)if(object(q)&&text(q.key))counts.set(q.key,(counts.get(q.key)??0)+1);
  const quotes:ObservedTotal[]=raw.bookmakers.filter((q:unknown):q is ObservedTotal=>{
    if(!object(q)||!text(q.key)||!text(q.name)||counts.get(q.key)!==1||!number(q.total)||q.total<=0
      ||!['market','bookmaker'].includes(q.clockBasis)||!validQuote({book:q.key,a:q.overOdds,b:q.underOdds}))return false;
    const at=oddsInstant(q.updatedAt);
    return Number.isFinite(at)&&at<=oddsInstant(raw.observedAt)&&now-at<=maxAge;
  });
  return withQuotes({schemaVersion:'event-totals-v1',provider:'the-odds-api',eventId:raw.eventId,sportKey:raw.sportKey,
    homeTeam:raw.homeTeam,awayTeam:raw.awayTeam,commenceTime:raw.commenceTime,observedAt:raw.observedAt},quotes);
}
export function matchGameOdds(events: EventOddsMap | null, input: Omit<GameIdentity, 'commence'> & { commence: string | Date | undefined }, now=Date.now()): EventLiveOdds | undefined {
  // ESPN's NFL schedule uses Date objects; the other schedules and stored JSON use ISO strings.
  const commence = input.commence instanceof Date
    ? Number.isFinite(input.commence.getTime()) ? input.commence.toISOString() : ''
    : typeof input.commence === 'string' ? input.commence : '';
  const game: GameIdentity = {...input, commence};
  if(!text(game.home)||!text(game.away)||!Number.isFinite(oddsInstant(game.commence)))return undefined;
  const matches=[...(events?.values()??[])].filter(e=>e.sportKey===ODDS_SPORT_KEYS[game.sport]
    &&teamName(e.homeTeam)===teamName(game.home)&&teamName(e.awayTeam)===teamName(game.away)
    &&oddsInstant(e.commenceTime)===oddsInstant(game.commence));
  return matches.length===1?verifiedLiveOdds(matches[0],game,now):undefined;
}
