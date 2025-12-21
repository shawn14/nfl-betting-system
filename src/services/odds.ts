import { Odds } from '@/types';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

interface OddsAPIOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsAPIMarket {
  key: string;
  outcomes: OddsAPIOutcome[];
}

interface OddsAPIBookmaker {
  key: string;
  title: string;
  markets: OddsAPIMarket[];
}

interface OddsAPIEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsAPIBookmaker[];
}

export async function fetchNFLOdds(): Promise<Map<string, Partial<Odds>[]>> {
  const apiKey = process.env.NEXT_PUBLIC_ODDS_API_KEY;
  if (!apiKey) throw new Error('Odds API key not configured');

  const url = `${ODDS_API_BASE}/sports/americanfootball_nfl/odds/?apiKey=${apiKey}&regions=us&markets=spreads,totals,h2h&oddsFormat=american`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Odds API error: ${response.statusText}`);
  }

  const data: OddsAPIEvent[] = await response.json();
  const oddsMap = new Map<string, Partial<Odds>[]>();

  for (const event of data) {
    const gameKey = `${event.home_team}_${event.away_team}_${event.commence_time}`;
    const oddsForGame: Partial<Odds>[] = [];

    for (const bookmaker of event.bookmakers) {
      const spreads = bookmaker.markets.find(m => m.key === 'spreads');
      const totals = bookmaker.markets.find(m => m.key === 'totals');
      const moneyline = bookmaker.markets.find(m => m.key === 'h2h');

      if (!spreads && !totals && !moneyline) continue;

      const homeSpreadOutcome = spreads?.outcomes.find(o => o.name === event.home_team);
      const awaySpreadOutcome = spreads?.outcomes.find(o => o.name === event.away_team);
      const overOutcome = totals?.outcomes.find(o => o.name === 'Over');
      const underOutcome = totals?.outcomes.find(o => o.name === 'Under');
      const homeMLOutcome = moneyline?.outcomes.find(o => o.name === event.home_team);
      const awayMLOutcome = moneyline?.outcomes.find(o => o.name === event.away_team);

      oddsForGame.push({
        bookmaker: bookmaker.title,
        homeSpread: homeSpreadOutcome?.point || 0,
        awaySpread: awaySpreadOutcome?.point || 0,
        homeSpreadOdds: homeSpreadOutcome?.price || -110,
        awaySpreadOdds: awaySpreadOutcome?.price || -110,
        total: overOutcome?.point || 0,
        overOdds: overOutcome?.price || -110,
        underOdds: underOutcome?.price || -110,
        homeMoneyline: homeMLOutcome?.price || 0,
        awayMoneyline: awayMLOutcome?.price || 0,
        timestamp: new Date(),
      });
    }

    if (oddsForGame.length > 0) {
      oddsMap.set(gameKey, oddsForGame);
    }
  }

  return oddsMap;
}

export async function fetchOddsForGame(homeTeam: string, awayTeam: string): Promise<Partial<Odds>[]> {
  const allOdds = await fetchNFLOdds();

  for (const [key, odds] of allOdds) {
    if (key.includes(homeTeam) && key.includes(awayTeam)) {
      return odds;
    }
  }

  return [];
}

export function getConsensusOdds(oddsArray: Partial<Odds>[]): Partial<Odds> | null {
  if (oddsArray.length === 0) return null;

  const avgHomeSpread = oddsArray.reduce((sum, o) => sum + (o.homeSpread || 0), 0) / oddsArray.length;
  const avgTotal = oddsArray.reduce((sum, o) => sum + (o.total || 0), 0) / oddsArray.length;
  const avgHomeML = oddsArray.reduce((sum, o) => sum + (o.homeMoneyline || 0), 0) / oddsArray.length;
  const avgAwayML = oddsArray.reduce((sum, o) => sum + (o.awayMoneyline || 0), 0) / oddsArray.length;

  return {
    bookmaker: 'consensus',
    homeSpread: Math.round(avgHomeSpread * 2) / 2, // Round to nearest 0.5
    awaySpread: -Math.round(avgHomeSpread * 2) / 2,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    total: Math.round(avgTotal * 2) / 2,
    overOdds: -110,
    underOdds: -110,
    homeMoneyline: Math.round(avgHomeML),
    awayMoneyline: Math.round(avgAwayML),
    timestamp: new Date(),
  };
}
