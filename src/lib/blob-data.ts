import { head } from '@vercel/blob';

/**
 * Fetch prediction data from Vercel Blob on the server side.
 * Used by Server Components to render content without client-side fetching.
 *
 * Blob names:
 * - 'prediction-matrix-data.json' (NFL)
 * - 'nba-prediction-data.json' (NBA)
 * - 'nhl-prediction-data.json' (NHL)
 * - 'cbb-prediction-data.json' (CBB)
 */
export async function fetchBlobData<T = Record<string, unknown>>(
  blobName: string
): Promise<T | null> {
  try {
    const blobMetadata = await head(blobName);
    const response = await fetch(blobMetadata.url, {
      next: { revalidate: 1800 }, // 30 minutes — matches cron cadence
    });
    if (!response.ok) return null;
    return response.json() as Promise<T>;
  } catch {
    return null;
  }
}

/** Fetch all sport data in parallel */
export async function fetchAllSportsData() {
  const [nfl, nba, nhl, cbb] = await Promise.all([
    fetchBlobData<NFLData>('prediction-matrix-data.json'),
    fetchBlobData<NBAData>('nba-prediction-data.json'),
    fetchBlobData<NHLData>('nhl-prediction-data.json'),
    fetchBlobData<CBBData>('cbb-prediction-data.json'),
  ]);
  return { nfl, nba, nhl, cbb };
}

// ── Shared types for prediction data ──────────────────────────────────

export interface BacktestResult {
  gameId: string;
  gameTime?: string;
  week?: number;
  homeTeam: string;
  awayTeam: string;
  homeElo?: number;
  awayElo?: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb: number;
  actualHomeScore?: number;
  actualAwayScore?: number;
  actualSpread?: number;
  actualTotal?: number;
  homeWon?: boolean;
  spreadPick?: 'home' | 'away';
  spreadResult?: 'win' | 'loss' | 'push';
  mlPick?: 'home' | 'away';
  mlResult?: 'win' | 'loss';
  ouPick?: 'over' | 'under';
  ouResult?: 'win' | 'loss' | 'push';
  vegasSpread?: number;
  vegasTotal?: number;
  atsResult?: 'win' | 'loss' | 'push';
  ouVegasResult?: 'win' | 'loss' | 'push';
  conviction?: { isHighConviction?: boolean };
  // NFL situation flags
  isDivisional?: boolean;
  isLateSeasonGame?: boolean;
  isLargeSpread?: boolean;
  isSmallSpread?: boolean;
  isMediumSpread?: boolean;
  isEloMismatch?: boolean;
}

export interface TeamData {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;
  ppgAllowed?: number;
}

export interface PredictionData {
  gameId: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProbability: number;
  confidence: number;
  vegasSpread?: number;
  vegasTotal?: number;
  oddsLockedAt?: string;
  spreadEdge?: number;
  totalEdge?: number;
  atsConfidence?: 'high' | 'medium' | 'low';
  ouConfidence?: 'high' | 'medium' | 'low';
  mlConfidence?: 'high' | 'medium' | 'low';
  isAtsBestBet?: boolean;
  isOuBestBet?: boolean;
  isMlBestBet?: boolean;
  mlEdge?: number;
  // NFL-specific
  weather?: { temperature: number; windSpeed: number; conditions: string; precipitation: number };
  weatherImpact?: number;
  injuries?: {
    homeInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
    awayInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
    impactLevel: 'none' | 'minor' | 'significant' | 'major';
  };
  isDivisional?: boolean;
  isLateSeasonGame?: boolean;
  isLargeSpread?: boolean;
  isSmallSpread?: boolean;
  isMediumSpread?: boolean;
  isEloMismatch?: boolean;
  sixtyPlusFactors?: number;
  eloDiff?: number;
  week?: number;
}

export interface GameData {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: TeamData;
  awayTeam?: TeamData;
  homeScore?: number;
  awayScore?: number;
  gameTime: string;
  status: string;
  week?: number;
}

export interface GameWithPrediction {
  game: GameData;
  prediction: PredictionData;
}

interface BaseSportData {
  generated: string | null;
  teams: TeamData[];
  games: GameWithPrediction[];
  recentGames?: GameData[];
  backtest: BacktestResult[] | { results?: BacktestResult[]; summary?: Record<string, unknown> };
}

export type NFLData = BaseSportData;
export type NBAData = BaseSportData;
export type NHLData = BaseSportData;
export type CBBData = BaseSportData;

/** Extract backtest results array from either format */
export function getBacktestResults(
  data: BaseSportData | null
): BacktestResult[] {
  if (!data?.backtest) return [];
  if (Array.isArray(data.backtest)) return data.backtest;
  return data.backtest.results || [];
}
