export type SportKey = 'nfl' | 'nba' | 'nhl' | 'cbb';

export interface SportState {
  lastSyncAt?: string;
  lastBlobWriteAt?: string;
  lastBlobUrl?: string;
  lastBlobSizeKb?: number;
  season?: number;
  currentWeek?: number;
  processedGameIds?: string[];
  backtestSummary?: {
    totalGames: number;
    spread: { wins: number; losses: number; pushes: number; winPct: number };
    moneyline: { wins: number; losses: number; winPct: number };
    overUnder: { wins: number; losses: number; pushes: number; winPct: number };
  };
}
