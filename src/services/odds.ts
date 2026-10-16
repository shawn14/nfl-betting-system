import type { Odds } from '@/types';
import { ODDS_SPORT_KEYS, parseEventOdds, matchGameOdds, modalTotal, type OddsSport, type EventOddsMap } from '../lib/event-odds.ts';
export { matchGameOdds, type EventOddsMap } from '../lib/event-odds.ts';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Existing paid transport/cadence is unchanged. Never call these functions from a proof.
async function fetchSportOdds(sport: OddsSport): Promise<EventOddsMap> {
  const apiKey = process.env.NEXT_PUBLIC_ODDS_API_KEY;
  if (!apiKey) throw new Error('Odds API key not configured');
  const url = `${ODDS_API_BASE}/sports/${ODDS_SPORT_KEYS[sport]}/odds/?apiKey=${apiKey}&regions=us&markets=spreads,totals,h2h&oddsFormat=american&_t=${Date.now()}`;
  const response = await fetch(url, {cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if (!response.ok) throw new Error(`Odds API error: ${response.status}`);
  const data: unknown = await response.json();
  return parseEventOdds(data,sport,new Date().toISOString());
}
export const fetchNFLOdds = () => fetchSportOdds('nfl');
export const fetchNBAOdds = () => fetchSportOdds('nba');
export const fetchNHLOdds = () => fetchSportOdds('nhl');
export const fetchCollegeBasketballOdds = () => fetchSportOdds('cbb');
export const fetchWNBAOdds = () => fetchSportOdds('wnba');

// The kickoff is required for identity. Old two-argument callers fail closed before any paid call.
export async function fetchOddsForGame(homeTeam: string, awayTeam: string, commence?: string): Promise<Partial<Odds>[]> {
  if (!commence) return [];
  const event=matchGameOdds(await fetchNFLOdds(),{sport:'nfl',home:homeTeam,away:awayTeam,commence});
  return event?.bookmakers.map(q=>({bookmaker:q.name,total:q.total,overOdds:q.overOdds,underOdds:q.underOdds,timestamp:new Date(q.updatedAt)}))??[];
}
/** @deprecated Display-only modal offered total. Never manufacture averaged prices or missing -110s. */
export function getConsensusOdds(oddsArray: Partial<Odds>[]): Partial<Odds> | null {
  const distinct=new Map(oddsArray.filter(o=>o.bookmaker).map(o=>[o.bookmaker,o]));
  const total=modalTotal([...distinct.values()]);
  return total===undefined?null:{bookmaker:'modal offered total',total};
}
