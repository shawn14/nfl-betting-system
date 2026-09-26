import { fetchBlobData } from '@/lib/blob-data';
import { parseEspnPrices, espnOddsUrl } from '@/lib/espn-prices';
import { evaluateGame, type GameEv, type PredictionLike } from '@/lib/ev-model';

/**
 * Live EV board: every upcoming game with a price, evaluated by the EV rule.
 *
 * Request budget: one ESPN core-odds call per upcoming game (games inside the next 8 days only),
 * each cached for 10 minutes by the Next data cache, so a busy page costs the same as an idle
 * one. Predictions come from the sport blobs the crons already write (single writer, many readers).
 */
const SPORTS: { sport: string; blob: string; label: string }[] = [
  { sport: 'nfl', blob: 'prediction-matrix-data.json', label: 'NFL' },
  { sport: 'wnba', blob: 'wnba-prediction-data.json', label: 'WNBA' },
  { sport: 'nba', blob: 'nba-prediction-data.json', label: 'NBA' },
  { sport: 'nhl', blob: 'nhl-prediction-data.json', label: 'NHL' },
  { sport: 'cbb', blob: 'cbb-prediction-data.json', label: 'CBB' },
];
const HORIZON_MS = 8 * 24 * 3600 * 1000;

interface BlobGame {
  game: { id: string; gameTime: string; status?: string; homeTeam: { abbreviation: string }; awayTeam: { abbreviation: string } };
  prediction: PredictionLike & { predictedHomeScore?: number; predictedAwayScore?: number };
}

export interface BoardRow {
  sport: string;
  label: string;
  id: string;
  home: string;
  away: string;
  gameTime: string;
  provider: string | null;
  ev: GameEv | null;
}

async function pricesFor(sport: string, id: string) {
  try {
    const res = await fetch(espnOddsUrl(sport, id), { next: { revalidate: 600 } });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    const json = await res.json();
    return parseEspnPrices(json.items?.[0]);
  } catch {
    return null;
  }
}

export async function buildEvBoard(): Promise<{ rows: BoardRow[]; builtAt: string }> {
  const now = Date.now();
  const perSport = await Promise.all(SPORTS.map(async ({ sport, blob, label }) => {
    const data = await fetchBlobData<{ games?: BlobGame[] }>(blob);
    const upcoming = (data?.games || []).filter(g => {
      const t = new Date(g.game.gameTime).getTime();
      return g.game.status !== 'final' && t > now && t - now < HORIZON_MS;
    });
    return Promise.all(upcoming.map(async ({ game, prediction }): Promise<BoardRow> => {
      const px = await pricesFor(sport, game.id);
      const home = game.homeTeam.abbreviation, away = game.awayTeam.abbreviation;
      return {
        sport, label, id: game.id, home, away, gameTime: game.gameTime,
        provider: px?.provider ?? null,
        ev: px ? evaluateGame(sport, home, away, prediction, px.current) : null,
      };
    }));
  }));
  const rows = perSport.flat().sort((a, b) => a.gameTime.localeCompare(b.gameTime));
  return { rows, builtAt: new Date().toISOString() };
}
