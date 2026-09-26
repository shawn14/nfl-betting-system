/**
 * Parse ESPN's core-API odds item into open/close PRICES (not just lines).
 *
 * Source: https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{id}/competitions/{id}/odds
 * `items[0]` is one sportsbook (DraftKings / ESPN BET). It keeps `open` and `close` blocks for
 * finished games, which is what lets the EV ledger grade history at the price actually on offer
 * instead of a flat -110. Shape verified against live responses 2026-09-25:
 *   item.open/close.{over,under}.american = "-110"       item.open/close.total.american = "46.5"
 *   item.homeTeamOdds.open/close.moneyLine.american      item.homeTeamOdds.open/close.spread.american (juice)
 *   item.homeTeamOdds.open/close.pointSpread.american = "-7.5"  (home line)
 * Every value arrives as a STRING; "EVEN" means +100; "OFF"/missing means not offered.
 */

export interface PriceSnapshot {
  mlHome?: number; mlAway?: number;
  spreadLine?: number; spreadHomePrice?: number; spreadAwayPrice?: number;  // home line
  totalLine?: number; overPrice?: number; underPrice?: number;
}

export interface GamePrices {
  provider: string;
  open: PriceSnapshot;
  close: PriceSnapshot;     // empty until the game closes
  current: PriceSnapshot;   // latest price (equals close once the game has started)
}

type EspnPrice = { american?: string | number } | undefined;
type EspnSide = { open?: Record<string, EspnPrice>; close?: Record<string, EspnPrice>; current?: Record<string, EspnPrice> } | undefined;
type EspnItem = {
  provider?: { name?: string };
  open?: Record<string, EspnPrice>;
  close?: Record<string, EspnPrice>;
  current?: Record<string, EspnPrice>;
  homeTeamOdds?: EspnSide;
  awayTeamOdds?: EspnSide;
};

function num(p: EspnPrice): number | undefined {
  const v = p?.american;
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = v.trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV') return 100;
  if (s === 'PK' || s === 'PICK') return 0;                 // pick'em spread
  const n = parseFloat(s.replace(/^[OU]/, ''));
  return Number.isFinite(n) ? n : undefined;
}

function snapshot(item: EspnItem, when: 'open' | 'close' | 'current'): PriceSnapshot {
  const home = item.homeTeamOdds?.[when];
  const away = item.awayTeamOdds?.[when];
  const tot = item[when];
  return {
    mlHome: num(home?.moneyLine), mlAway: num(away?.moneyLine),
    spreadLine: num(home?.pointSpread), spreadHomePrice: num(home?.spread), spreadAwayPrice: num(away?.spread),
    totalLine: num(tot?.total), overPrice: num(tot?.over), underPrice: num(tot?.under),
  };
}

export function parseEspnPrices(item: unknown): GamePrices | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as EspnItem;
  const open = snapshot(it, 'open');
  const close = snapshot(it, 'close');
  const current = snapshot(it, 'current');
  const empty = (x: PriceSnapshot) => x.mlHome === undefined && x.spreadLine === undefined && x.totalLine === undefined;
  if (empty(close) && empty(current)) return null;
  return { provider: it.provider?.name ?? 'unknown', open, close, current };
}

export const ESPN_LEAGUE_PATH: Record<string, string> = {
  nfl: 'football/leagues/nfl',
  nba: 'basketball/leagues/nba',
  wnba: 'basketball/leagues/wnba',
  cbb: 'basketball/leagues/mens-college-basketball',
  nhl: 'hockey/leagues/nhl',
};

export function espnOddsUrl(sport: string, eventId: string): string {
  return `https://sports.core.api.espn.com/v2/sports/${ESPN_LEAGUE_PATH[sport]}/events/${eventId}/competitions/${eventId}/odds`;
}
