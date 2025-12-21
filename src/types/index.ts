export interface Team {
  id: string;
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl';
  name: string;
  abbreviation: string;
  eloRating: number;
  conference: string;
  division: string;
  // Scoring stats for predictions
  pointsFor?: number;
  pointsAgainst?: number;
  gamesPlayed?: number;
  ppg?: number;        // Points per game (calculated)
  ppgAllowed?: number; // Points allowed per game (calculated)
  createdAt: Date;
  updatedAt: Date;
}

export interface Game {
  id: string;
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl';
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: Team;
  awayTeam?: Team;
  gameTime: Date;
  status: 'scheduled' | 'in_progress' | 'final';
  homeScore?: number;
  awayScore?: number;
  weather?: WeatherData;
  venue?: string;
  week?: number;
  season: number;
  eloProcessed?: boolean; // Tracks if game was used for Elo calculation
  createdAt: Date;
  updatedAt: Date;
}

export interface Odds {
  id: string;
  gameId: string;
  bookmaker: string;
  homeSpread: number;
  awaySpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  total: number;
  overOdds: number;
  underOdds: number;
  homeMoneyline: number;
  awayMoneyline: number;
  timestamp: Date;
}

export interface Prediction {
  id: string;
  gameId: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProbability: number;
  edgeSpread?: number;
  edgeTotal?: number;
  confidence: number;
  createdAt: Date;
}

export interface WeatherData {
  temperature: number;
  windSpeed: number;
  windDirection: string;
  precipitation: number;
  humidity: number;
  conditions: string;
}

export interface EloConfig {
  kFactor: number;
  homeAdvantage: number;
  restBonus: number;
  weatherPenalty: number;
  initialRating: number;
}

export interface Edge {
  gameId: string;
  game: Game;
  prediction: Prediction;
  odds: Odds;
  spreadEdge: number;
  totalEdge: number;
  moneylineValue: number;
  recommendedBet?: 'spread_home' | 'spread_away' | 'over' | 'under' | 'moneyline_home' | 'moneyline_away';
  edgeStrength: 'weak' | 'moderate' | 'strong';
}
