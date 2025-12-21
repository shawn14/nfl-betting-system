import { Team, Game, Prediction, EloConfig, WeatherData } from '@/types';
import { getWeatherImpact } from './weather';

const DEFAULT_CONFIG: EloConfig = {
  kFactor: 20,
  homeAdvantage: 48, // ~2.8 points in NFL
  restBonus: 25, // Extra rest (like bye weeks)
  weatherPenalty: 15, // Per impact point
  initialRating: 1500,
};

export function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function calculateNewElo(
  currentRating: number,
  expectedScore: number,
  actualScore: number,
  kFactor: number = DEFAULT_CONFIG.kFactor
): number {
  return Math.round(currentRating + kFactor * (actualScore - expectedScore));
}

export function getMarginMultiplier(margin: number): number {
  // Logarithmic multiplier for margin of victory
  // Prevents blowouts from having outsized impact
  if (margin === 0) return 1;
  return Math.log(Math.abs(margin) + 1) * 0.7 + 0.8;
}

interface EloAdjustments {
  homeAdvantage: number;
  restBonus: number;
  weatherImpact: number;
}

export function calculateAdjustments(
  homeTeam: Team,
  awayTeam: Team,
  weather: WeatherData | null,
  homeDaysRest?: number,
  awayDaysRest?: number,
  config: EloConfig = DEFAULT_CONFIG
): EloAdjustments {
  let homeAdvantage = config.homeAdvantage;

  // Rest advantage (if one team has significantly more rest)
  let restBonus = 0;
  if (homeDaysRest !== undefined && awayDaysRest !== undefined) {
    const restDiff = homeDaysRest - awayDaysRest;
    if (restDiff >= 3) restBonus = config.restBonus;
    else if (restDiff <= -3) restBonus = -config.restBonus;
  }

  // Weather impact (generally lowers scoring, affects certain teams more)
  const weatherImpact = getWeatherImpact(weather) * config.weatherPenalty;

  return {
    homeAdvantage,
    restBonus,
    weatherImpact,
  };
}

export function predictGame(
  homeTeam: Team,
  awayTeam: Team,
  weather: WeatherData | null = null,
  homeDaysRest?: number,
  awayDaysRest?: number,
  config: EloConfig = DEFAULT_CONFIG
): Partial<Prediction> {
  const adjustments = calculateAdjustments(homeTeam, awayTeam, weather, homeDaysRest, awayDaysRest, config);

  // Use default Elo if not set
  const homeElo = homeTeam.eloRating || config.initialRating;
  const awayElo = awayTeam.eloRating || config.initialRating;

  // Adjusted Elo ratings
  const adjustedHomeElo = homeElo + adjustments.homeAdvantage + adjustments.restBonus;
  const adjustedAwayElo = awayElo;

  // Win probability
  const homeWinProbability = calculateExpectedScore(adjustedHomeElo, adjustedAwayElo);

  // Elo difference to points conversion
  // In NFL, approximately 25 Elo points = 1 point spread
  const eloDiff = adjustedHomeElo - adjustedAwayElo;
  const predictedSpread = -eloDiff / 25; // Negative because spread is from away perspective

  // Predict total based on team strengths and weather
  // Base total around 44 points (NFL average), adjust based on team offenses
  const avgElo = (homeElo + awayElo) / 2;
  const eloAboveAverage = (avgElo - 1500) / 100;
  let predictedTotal = 44 + eloAboveAverage * 2;

  // Weather reduces scoring
  predictedTotal -= adjustments.weatherImpact * 1.5;

  // Calculate predicted scores
  const totalWithSpread = predictedTotal;
  const predictedHomeScore = (totalWithSpread - predictedSpread) / 2;
  const predictedAwayScore = (totalWithSpread + predictedSpread) / 2;

  // Confidence based on Elo gap (larger gap = more confident)
  const eloGap = Math.abs(eloDiff);
  const confidence = Math.min(0.95, 0.5 + eloGap / 400);

  return {
    predictedHomeScore: Math.round(predictedHomeScore * 10) / 10,
    predictedAwayScore: Math.round(predictedAwayScore * 10) / 10,
    predictedSpread: Math.round(predictedSpread * 2) / 2, // Round to 0.5
    predictedTotal: Math.round(predictedTotal * 2) / 2,
    homeWinProbability: Math.round(homeWinProbability * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
  };
}

export function updateEloAfterGame(
  homeTeam: Team,
  awayTeam: Team,
  homeScore: number,
  awayScore: number,
  config: EloConfig = DEFAULT_CONFIG
): { homeNewElo: number; awayNewElo: number } {
  const homeElo = homeTeam.eloRating || config.initialRating;
  const awayElo = awayTeam.eloRating || config.initialRating;

  const adjustedHomeElo = homeElo + config.homeAdvantage;

  const homeExpected = calculateExpectedScore(adjustedHomeElo, awayElo);
  const awayExpected = 1 - homeExpected;

  // Actual outcome (1 = win, 0.5 = tie, 0 = loss)
  let homeActual: number;
  let awayActual: number;
  if (homeScore > awayScore) {
    homeActual = 1;
    awayActual = 0;
  } else if (homeScore < awayScore) {
    homeActual = 0;
    awayActual = 1;
  } else {
    homeActual = 0.5;
    awayActual = 0.5;
  }

  // Margin multiplier
  const margin = Math.abs(homeScore - awayScore);
  const marginMultiplier = getMarginMultiplier(margin);
  const adjustedK = config.kFactor * marginMultiplier;

  const homeNewElo = calculateNewElo(homeElo, homeExpected, homeActual, adjustedK);
  const awayNewElo = calculateNewElo(awayElo, awayExpected, awayActual, adjustedK);

  return { homeNewElo, awayNewElo };
}

export function calculateEdge(
  prediction: Partial<Prediction>,
  vegasSpread: number,
  vegasTotal: number
): { edgeSpread: number; edgeTotal: number } {
  // Edge = our prediction - Vegas line
  // Positive edge on spread means we think home team will cover
  // Positive edge on total means we think it will go over
  const edgeSpread = vegasSpread - (prediction.predictedSpread || 0);
  const edgeTotal = (prediction.predictedTotal || 0) - vegasTotal;

  return {
    edgeSpread: Math.round(edgeSpread * 10) / 10,
    edgeTotal: Math.round(edgeTotal * 10) / 10,
  };
}

export function getEdgeStrength(edge: number): 'weak' | 'moderate' | 'strong' {
  const absEdge = Math.abs(edge);
  if (absEdge < 1.5) return 'weak';
  if (absEdge < 3) return 'moderate';
  return 'strong';
}

export function getBetRecommendation(
  edgeSpread: number,
  edgeTotal: number,
  homeWinProbability: number
): string | null {
  const strongThreshold = 2.5;
  const probThreshold = 0.6;

  // Check spread edge
  if (Math.abs(edgeSpread) >= strongThreshold) {
    if (edgeSpread > 0) return 'spread_home';
    return 'spread_away';
  }

  // Check total edge
  if (Math.abs(edgeTotal) >= strongThreshold) {
    if (edgeTotal > 0) return 'over';
    return 'under';
  }

  // Check moneyline for high probability games
  if (homeWinProbability >= probThreshold) return 'moneyline_home';
  if (homeWinProbability <= 1 - probThreshold) return 'moneyline_away';

  return null;
}

// League average PPG for regression
const LEAGUE_AVG_PPG = 22;

// Calibrated values from historical game analysis (227 games)
const ELO_TO_POINTS = 0.0593;     // 100 Elo = 5.93 points spread
const HOME_FIELD_ADVANTAGE = 2.28; // Home team advantage in points

// Optimized spread betting parameters (from backtesting 227 games)
// Before: 48% win rate, -$2050 profit
// After: 62.1% win rate, +$4640 profit
const SPREAD_REGRESSION = 0.55;   // Shrink spread predictions 55% toward 0
const ELO_CAP = 4;                // Max Elo adjustment in points (±4)

// Predict game using team scoring stats + Elo adjustment
export function predictGameWithStats(
  homeTeam: Team,
  awayTeam: Team,
  weather: WeatherData | null = null,
  config: EloConfig = DEFAULT_CONFIG
): Partial<Prediction> {
  const homeElo = homeTeam.eloRating || config.initialRating;
  const awayElo = awayTeam.eloRating || config.initialRating;

  // Get PPG stats with fallback to league average
  const homePPG = homeTeam.ppg || LEAGUE_AVG_PPG;
  const homePPGAllowed = homeTeam.ppgAllowed || LEAGUE_AVG_PPG;
  const awayPPG = awayTeam.ppg || LEAGUE_AVG_PPG;
  const awayPPGAllowed = awayTeam.ppgAllowed || LEAGUE_AVG_PPG;

  // Games played for confidence calculation
  const homeGamesPlayed = homeTeam.gamesPlayed || 0;
  const awayGamesPlayed = awayTeam.gamesPlayed || 0;
  const minGamesPlayed = Math.min(homeGamesPlayed, awayGamesPlayed);

  // Regress stats toward league average (30% regression)
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;

  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  // Base scores from stats matchup
  // Home score = avg of home offense vs away defense
  // Away score = avg of away offense vs home defense
  let baseHomeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  let baseAwayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  // Elo adjustment (calibrated: 100 Elo = 5.93 points)
  const eloDiff = homeElo - awayElo;
  let eloAdjustment = eloDiff * ELO_TO_POINTS / 2; // Split between teams

  // Apply Elo cap to prevent overconfidence on big mismatches
  if (ELO_CAP > 0) {
    eloAdjustment = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdjustment));
  }

  baseHomeScore += eloAdjustment;
  baseAwayScore -= eloAdjustment;

  // Home field advantage (calibrated: 2.28 points total)
  baseHomeScore += HOME_FIELD_ADVANTAGE / 2;
  baseAwayScore -= HOME_FIELD_ADVANTAGE / 2;

  // Weather impact (reduces both scores)
  const weatherImpact = getWeatherImpact(weather);
  baseHomeScore -= weatherImpact * 0.75;
  baseAwayScore -= weatherImpact * 0.75;

  // Final scores (round to 1 decimal)
  const predictedHomeScore = Math.round(Math.max(0, baseHomeScore) * 10) / 10;
  const predictedAwayScore = Math.round(Math.max(0, baseAwayScore) * 10) / 10;

  // Calculate spread and total
  // Apply spread regression to reduce overconfidence (shrink toward 0)
  const rawSpread = predictedAwayScore - predictedHomeScore;
  const predictedSpread = Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
  const predictedTotal = Math.round((predictedHomeScore + predictedAwayScore) * 2) / 2;

  // Win probability from adjusted Elo
  const adjustedHomeElo = homeElo + config.homeAdvantage;
  const homeWinProbability = calculateExpectedScore(adjustedHomeElo, awayElo);

  // Confidence calculation:
  // - Sample confidence: based on games played (need at least 8 games for full confidence)
  // - Elo confidence: based on Elo gap
  const sampleConfidence = Math.min(1, minGamesPlayed / 8);
  const eloConfidence = Math.min(0.95, 0.5 + Math.abs(eloDiff) / 400);
  const confidence = sampleConfidence * 0.3 + eloConfidence * 0.7;

  return {
    predictedHomeScore,
    predictedAwayScore,
    predictedSpread,
    predictedTotal,
    homeWinProbability: Math.round(homeWinProbability * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// Process a batch of completed games for Elo calculation
export interface ProcessedEloResult {
  teamElos: Map<string, number>;
  processedGameIds: string[];
}

export function processGamesForElo(
  games: Game[],
  initialTeamElos: Map<string, number>,
  config: EloConfig = DEFAULT_CONFIG
): ProcessedEloResult {
  // Copy the initial Elos so we don't mutate the input
  const teamElos = new Map(initialTeamElos);
  const processedGameIds: string[] = [];

  // Process each game in order (assumes games are sorted chronologically)
  for (const game of games) {
    if (game.homeScore === undefined || game.awayScore === undefined) {
      continue; // Skip games without scores
    }

    const homeElo = teamElos.get(game.homeTeamId) || config.initialRating;
    const awayElo = teamElos.get(game.awayTeamId) || config.initialRating;

    // Create temporary team objects for the calculation
    const homeTeam: Team = { id: game.homeTeamId, eloRating: homeElo } as Team;
    const awayTeam: Team = { id: game.awayTeamId, eloRating: awayElo } as Team;

    // Calculate new Elos
    const { homeNewElo, awayNewElo } = updateEloAfterGame(
      homeTeam,
      awayTeam,
      game.homeScore,
      game.awayScore,
      config
    );

    // Update the running totals
    teamElos.set(game.homeTeamId, homeNewElo);
    teamElos.set(game.awayTeamId, awayNewElo);
    processedGameIds.push(game.id);
  }

  return { teamElos, processedGameIds };
}
