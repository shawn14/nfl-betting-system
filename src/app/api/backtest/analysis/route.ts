import { NextResponse } from 'next/server';
import { getAllTeams, getAllGames } from '@/services/database';
import { updateEloAfterGame } from '@/services/elo';
import { Game, Team } from '@/types';

const LEAGUE_AVG_PPG = 22;
const ELO_TO_POINTS = 0.0593;
const HOME_FIELD_ADVANTAGE = 2.28;
const ELO_HOME_ADVANTAGE = 48;

// Optimized spread betting parameters
const SPREAD_REGRESSION = 0.55;
const ELO_CAP = 4;

function predictScore(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;
  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  let homeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  let awayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;

  // Cap Elo adjustment
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  homeScore += eloAdj;
  awayScore -= eloAdj;

  homeScore += HOME_FIELD_ADVANTAGE / 2;
  awayScore -= HOME_FIELD_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
}

export async function GET() {
  try {
    const allTeams = await getAllTeams('nfl');
    const allGames = await getAllGames('nfl');

    const completedGames = allGames
      .filter((g): g is Game =>
        g.status === 'final' &&
        g.homeScore !== undefined &&
        g.awayScore !== undefined
      )
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    const teamStats = new Map<string, { ppg: number; ppgAllowed: number }>();
    for (const team of allTeams) {
      teamStats.set(team.id, {
        ppg: team.ppg || LEAGUE_AVG_PPG,
        ppgAllowed: team.ppgAllowed || LEAGUE_AVG_PPG,
      });
    }

    const teamElos = new Map<string, number>();
    for (const team of allTeams) {
      teamElos.set(team.id, 1500);
    }

    // Analysis buckets
    const analysis = {
      // Home vs Away picks
      homePicks: { wins: 0, losses: 0, pushes: 0 },
      awayPicks: { wins: 0, losses: 0, pushes: 0 },

      // Favorite vs Underdog (based on our prediction)
      favoritePicks: { wins: 0, losses: 0, pushes: 0 },
      underdogPicks: { wins: 0, losses: 0, pushes: 0 },

      // By spread size
      smallSpread: { wins: 0, losses: 0, pushes: 0, range: '0-3 pts' },
      mediumSpread: { wins: 0, losses: 0, pushes: 0, range: '3-7 pts' },
      largeSpread: { wins: 0, losses: 0, pushes: 0, range: '7+ pts' },

      // Spread accuracy
      spreadErrors: [] as number[],
      avgSpreadError: 0,
      medianSpreadError: 0,

      // Direction accuracy (did we predict the right team to win?)
      correctDirection: 0,
      wrongDirection: 0,

      // Margin analysis
      predictedMargins: [] as number[],
      actualMargins: [] as number[],

      // Games where we picked favorite vs underdog
      pickedFavoriteWon: 0,
      pickedFavoriteLost: 0,
      pickedUnderdogWon: 0,
      pickedUnderdogLost: 0,

      // Close games vs blowouts
      closeGames: { wins: 0, losses: 0, pushes: 0, range: 'Actual margin < 7' },
      blowouts: { wins: 0, losses: 0, pushes: 0, range: 'Actual margin 7+' },

      // By week
      weeklyPerformance: {} as Record<number, { wins: number; losses: number; pushes: number }>,

      // Detailed misses for inspection
      biggestMisses: [] as Array<{
        game: string;
        week: number;
        predictedSpread: number;
        actualSpread: number;
        error: number;
        ourPick: string;
        result: string;
      }>,
    };

    for (const game of completedGames) {
      const homeElo = teamElos.get(game.homeTeamId) || 1500;
      const awayElo = teamElos.get(game.awayTeamId) || 1500;

      const homeTeamData = allTeams.find(t => t.id === game.homeTeamId);
      const awayTeamData = allTeams.find(t => t.id === game.awayTeamId);

      const homeStats = teamStats.get(game.homeTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };
      const awayStats = teamStats.get(game.awayTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };

      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeElo, awayElo,
        homeStats.ppg, homeStats.ppgAllowed,
        awayStats.ppg, awayStats.ppgAllowed
      );

      const predictedSpread = calculateSpread(predHome, predAway); // With regression applied
      const actualHomeScore = game.homeScore!;
      const actualAwayScore = game.awayScore!;
      const actualSpread = actualAwayScore - actualHomeScore;

      const predictedMargin = Math.abs(predictedSpread);
      const actualMargin = Math.abs(actualSpread);

      // Our pick logic
      const spreadPick = predictedSpread < 0 ? 'home' : 'away';

      // Determine result
      let spreadResult: 'win' | 'loss' | 'push';
      if (spreadPick === 'home') {
        if (actualSpread < predictedSpread) spreadResult = 'win';
        else if (actualSpread > predictedSpread) spreadResult = 'loss';
        else spreadResult = 'push';
      } else {
        if (actualSpread > predictedSpread) spreadResult = 'win';
        else if (actualSpread < predictedSpread) spreadResult = 'loss';
        else spreadResult = 'push';
      }

      // Track spread errors
      const spreadError = Math.abs(predictedSpread - actualSpread);
      analysis.spreadErrors.push(spreadError);
      analysis.predictedMargins.push(predictedMargin);
      analysis.actualMargins.push(actualMargin);

      // Direction accuracy
      const predictedWinner = predictedSpread < 0 ? 'home' : 'away';
      const actualWinner = actualSpread < 0 ? 'home' : (actualSpread > 0 ? 'away' : 'tie');
      if (actualWinner !== 'tie') {
        if (predictedWinner === actualWinner) {
          analysis.correctDirection++;
        } else {
          analysis.wrongDirection++;
        }
      }

      // Home vs Away picks
      if (spreadPick === 'home') {
        if (spreadResult === 'win') analysis.homePicks.wins++;
        else if (spreadResult === 'loss') analysis.homePicks.losses++;
        else analysis.homePicks.pushes++;
      } else {
        if (spreadResult === 'win') analysis.awayPicks.wins++;
        else if (spreadResult === 'loss') analysis.awayPicks.losses++;
        else analysis.awayPicks.pushes++;
      }

      // Favorite vs Underdog (we always pick favorite since we pick whoever we think wins)
      // Actually - when we pick home with negative spread, we're picking the favorite
      // When we pick away with positive spread, we're picking the favorite too
      // We're ALWAYS picking the favorite by our logic!
      const wePredictFavorite = true; // Our logic always picks whoever we think will cover
      if (wePredictFavorite) {
        if (spreadResult === 'win') analysis.favoritePicks.wins++;
        else if (spreadResult === 'loss') analysis.favoritePicks.losses++;
        else analysis.favoritePicks.pushes++;
      }

      // By spread size (our predicted spread)
      if (predictedMargin < 3) {
        if (spreadResult === 'win') analysis.smallSpread.wins++;
        else if (spreadResult === 'loss') analysis.smallSpread.losses++;
        else analysis.smallSpread.pushes++;
      } else if (predictedMargin < 7) {
        if (spreadResult === 'win') analysis.mediumSpread.wins++;
        else if (spreadResult === 'loss') analysis.mediumSpread.losses++;
        else analysis.mediumSpread.pushes++;
      } else {
        if (spreadResult === 'win') analysis.largeSpread.wins++;
        else if (spreadResult === 'loss') analysis.largeSpread.losses++;
        else analysis.largeSpread.pushes++;
      }

      // Close games vs blowouts (actual margin)
      if (actualMargin < 7) {
        if (spreadResult === 'win') analysis.closeGames.wins++;
        else if (spreadResult === 'loss') analysis.closeGames.losses++;
        else analysis.closeGames.pushes++;
      } else {
        if (spreadResult === 'win') analysis.blowouts.wins++;
        else if (spreadResult === 'loss') analysis.blowouts.losses++;
        else analysis.blowouts.pushes++;
      }

      // Weekly performance
      const week = game.week || 0;
      if (!analysis.weeklyPerformance[week]) {
        analysis.weeklyPerformance[week] = { wins: 0, losses: 0, pushes: 0 };
      }
      if (spreadResult === 'win') analysis.weeklyPerformance[week].wins++;
      else if (spreadResult === 'loss') analysis.weeklyPerformance[week].losses++;
      else analysis.weeklyPerformance[week].pushes++;

      // Track big misses
      const homeAbbr = homeTeamData?.abbreviation || 'HOME';
      const awayAbbr = awayTeamData?.abbreviation || 'AWAY';
      analysis.biggestMisses.push({
        game: `${awayAbbr} @ ${homeAbbr}`,
        week,
        predictedSpread: Math.round(predictedSpread * 10) / 10,
        actualSpread,
        error: Math.round(spreadError * 10) / 10,
        ourPick: spreadPick === 'home' ? homeAbbr : awayAbbr,
        result: spreadResult,
      });

      // Update Elos
      const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
      const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        homeTeamObj, awayTeamObj,
        actualHomeScore, actualAwayScore
      );
      teamElos.set(game.homeTeamId, homeNewElo);
      teamElos.set(game.awayTeamId, awayNewElo);
    }

    // Calculate aggregate stats
    analysis.spreadErrors.sort((a, b) => a - b);
    analysis.avgSpreadError = analysis.spreadErrors.reduce((a, b) => a + b, 0) / analysis.spreadErrors.length;
    analysis.medianSpreadError = analysis.spreadErrors[Math.floor(analysis.spreadErrors.length / 2)];

    // Sort biggest misses by error
    analysis.biggestMisses.sort((a, b) => b.error - a.error);
    analysis.biggestMisses = analysis.biggestMisses.slice(0, 20); // Top 20

    // Calculate win percentages
    const calcWinPct = (bucket: { wins: number; losses: number; pushes: number }) => {
      const total = bucket.wins + bucket.losses;
      return total > 0 ? Math.round((bucket.wins / total) * 1000) / 10 : 0;
    };

    const avgPredictedMargin = analysis.predictedMargins.reduce((a, b) => a + b, 0) / analysis.predictedMargins.length;
    const avgActualMargin = analysis.actualMargins.reduce((a, b) => a + b, 0) / analysis.actualMargins.length;

    return NextResponse.json({
      summary: {
        totalGames: completedGames.length,
        avgSpreadError: Math.round(analysis.avgSpreadError * 10) / 10,
        medianSpreadError: Math.round(analysis.medianSpreadError * 10) / 10,
        avgPredictedMargin: Math.round(avgPredictedMargin * 10) / 10,
        avgActualMargin: Math.round(avgActualMargin * 10) / 10,
        directionAccuracy: Math.round((analysis.correctDirection / (analysis.correctDirection + analysis.wrongDirection)) * 1000) / 10,
      },
      byPickType: {
        home: { ...analysis.homePicks, winPct: calcWinPct(analysis.homePicks) },
        away: { ...analysis.awayPicks, winPct: calcWinPct(analysis.awayPicks) },
      },
      bySpreadSize: {
        small: { ...analysis.smallSpread, winPct: calcWinPct(analysis.smallSpread) },
        medium: { ...analysis.mediumSpread, winPct: calcWinPct(analysis.mediumSpread) },
        large: { ...analysis.largeSpread, winPct: calcWinPct(analysis.largeSpread) },
      },
      byActualMargin: {
        closeGames: { ...analysis.closeGames, winPct: calcWinPct(analysis.closeGames) },
        blowouts: { ...analysis.blowouts, winPct: calcWinPct(analysis.blowouts) },
      },
      weeklyPerformance: Object.entries(analysis.weeklyPerformance)
        .map(([week, data]) => ({
          week: parseInt(week),
          ...data,
          winPct: calcWinPct(data),
        }))
        .sort((a, b) => a.week - b.week),
      biggestMisses: analysis.biggestMisses,
      insights: generateInsights(analysis, calcWinPct),
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json({
      error: 'Analysis failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

function generateInsights(
  analysis: {
    homePicks: { wins: number; losses: number; pushes: number };
    awayPicks: { wins: number; losses: number; pushes: number };
    smallSpread: { wins: number; losses: number; pushes: number };
    mediumSpread: { wins: number; losses: number; pushes: number };
    largeSpread: { wins: number; losses: number; pushes: number };
    closeGames: { wins: number; losses: number; pushes: number };
    blowouts: { wins: number; losses: number; pushes: number };
    avgSpreadError: number;
  },
  calcWinPct: (bucket: { wins: number; losses: number; pushes: number }) => number
): string[] {
  const insights: string[] = [];

  const homeWinPct = calcWinPct(analysis.homePicks);
  const awayWinPct = calcWinPct(analysis.awayPicks);

  if (Math.abs(homeWinPct - awayWinPct) > 5) {
    if (homeWinPct > awayWinPct) {
      insights.push(`Home picks are outperforming away picks (${homeWinPct}% vs ${awayWinPct}%). Consider weighting home picks more.`);
    } else {
      insights.push(`Away picks are outperforming home picks (${awayWinPct}% vs ${homeWinPct}%). Home field advantage may be overvalued.`);
    }
  }

  const smallWinPct = calcWinPct(analysis.smallSpread);
  const mediumWinPct = calcWinPct(analysis.mediumSpread);
  const largeWinPct = calcWinPct(analysis.largeSpread);

  const bestSize = smallWinPct > mediumWinPct && smallWinPct > largeWinPct ? 'small' :
                   mediumWinPct > largeWinPct ? 'medium' : 'large';
  const worstSize = smallWinPct < mediumWinPct && smallWinPct < largeWinPct ? 'small' :
                    mediumWinPct < largeWinPct ? 'medium' : 'large';

  if (bestSize !== worstSize) {
    const bestPct = bestSize === 'small' ? smallWinPct : bestSize === 'medium' ? mediumWinPct : largeWinPct;
    const worstPct = worstSize === 'small' ? smallWinPct : worstSize === 'medium' ? mediumWinPct : largeWinPct;
    insights.push(`${bestSize.charAt(0).toUpperCase() + bestSize.slice(1)} spreads (${bestPct}%) outperform ${worstSize} spreads (${worstPct}%). Consider only betting ${bestSize} spreads.`);
  }

  const closeWinPct = calcWinPct(analysis.closeGames);
  const blowoutWinPct = calcWinPct(analysis.blowouts);

  if (Math.abs(closeWinPct - blowoutWinPct) > 5) {
    if (blowoutWinPct > closeWinPct) {
      insights.push(`We perform better in blowouts (${blowoutWinPct}%) than close games (${closeWinPct}%). Our model may struggle with tight matchups.`);
    } else {
      insights.push(`We perform better in close games (${closeWinPct}%) than blowouts (${blowoutWinPct}%). Consider being more aggressive with large spreads.`);
    }
  }

  if (analysis.avgSpreadError > 10) {
    insights.push(`Average spread error is ${analysis.avgSpreadError.toFixed(1)} points - consider regressing predictions toward 0.`);
  }

  return insights;
}

export const dynamic = 'force-dynamic';
