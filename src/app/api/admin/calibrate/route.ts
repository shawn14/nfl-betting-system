import { NextResponse } from 'next/server';
import { getAllTeams, getAllGames } from '@/services/database';
import { updateEloAfterGame } from '@/services/elo';
import { Game, Team } from '@/types';

interface GameDataPoint {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  eloDiff: number;        // Home Elo - Away Elo (before game)
  actualDiff: number;     // Home Score - Away Score
  homeElo: number;
  awayElo: number;
  homeScore: number;
  awayScore: number;
}

interface CalibrationResult {
  eloToPoints: number;      // How many points per 100 Elo difference
  homeFieldAdvantage: number; // Points advantage for home team
  rSquared: number;         // How well the model fits (0-1)
  sampleSize: number;
  dataPoints: GameDataPoint[];
}

// Simple linear regression: y = mx + b
// We're fitting: actualDiff = (eloToPoints * eloDiff) + homeFieldAdvantage
function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number; rSquared: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0, rSquared: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared calculation
  const meanY = sumY / n;
  let ssTotal = 0, ssResidual = 0;
  for (const p of points) {
    const predicted = slope * p.x + intercept;
    ssTotal += (p.y - meanY) ** 2;
    ssResidual += (p.y - predicted) ** 2;
  }
  const rSquared = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);

  return { slope, intercept, rSquared };
}

export async function GET(request: Request) {
  // Verify admin secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all teams and games
    const allTeams = await getAllTeams('nfl');
    const allGames = await getAllGames('nfl');

    // Filter to completed games with scores, sorted chronologically
    const completedGames = allGames
      .filter((g): g is Game =>
        g.status === 'final' &&
        g.homeScore !== undefined &&
        g.awayScore !== undefined
      )
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    if (completedGames.length === 0) {
      return NextResponse.json({ error: 'No completed games found' }, { status: 404 });
    }

    // Track running Elo for each team (start at 1500)
    const teamElos = new Map<string, number>();
    for (const team of allTeams) {
      teamElos.set(team.id, 1500);
    }

    // Collect data points
    const dataPoints: GameDataPoint[] = [];

    for (const game of completedGames) {
      const homeElo = teamElos.get(game.homeTeamId) || 1500;
      const awayElo = teamElos.get(game.awayTeamId) || 1500;
      const eloDiff = homeElo - awayElo;
      const actualDiff = game.homeScore! - game.awayScore!;

      const homeTeam = allTeams.find(t => t.id === game.homeTeamId);
      const awayTeam = allTeams.find(t => t.id === game.awayTeamId);

      dataPoints.push({
        gameId: game.id,
        homeTeam: homeTeam?.abbreviation || game.homeTeamId,
        awayTeam: awayTeam?.abbreviation || game.awayTeamId,
        eloDiff,
        actualDiff,
        homeElo,
        awayElo,
        homeScore: game.homeScore!,
        awayScore: game.awayScore!,
      });

      // Update Elos after this game (for next game's calculation)
      const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
      const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        homeTeamObj,
        awayTeamObj,
        game.homeScore!,
        game.awayScore!
      );
      teamElos.set(game.homeTeamId, homeNewElo);
      teamElos.set(game.awayTeamId, awayNewElo);
    }

    // Run linear regression: actualDiff = slope * eloDiff + intercept
    // slope = points per 1 Elo difference
    // intercept = home field advantage
    const regressionPoints = dataPoints.map(d => ({ x: d.eloDiff, y: d.actualDiff }));
    const { slope, intercept, rSquared } = linearRegression(regressionPoints);

    // Convert slope to "points per 100 Elo"
    const eloToPoints = slope * 100;

    const result: CalibrationResult = {
      eloToPoints: Math.round(eloToPoints * 100) / 100,
      homeFieldAdvantage: Math.round(intercept * 100) / 100,
      rSquared: Math.round(rSquared * 1000) / 1000,
      sampleSize: dataPoints.length,
      dataPoints: dataPoints.slice(-20), // Last 20 games for reference
    };

    // Also calculate some summary stats
    const avgEloDiff = dataPoints.reduce((s, d) => s + Math.abs(d.eloDiff), 0) / dataPoints.length;
    const avgActualDiff = dataPoints.reduce((s, d) => s + d.actualDiff, 0) / dataPoints.length;
    const homeWins = dataPoints.filter(d => d.actualDiff > 0).length;
    const homeWinPct = homeWins / dataPoints.length;

    return NextResponse.json({
      calibration: result,
      summary: {
        totalGames: dataPoints.length,
        avgEloDiff: Math.round(avgEloDiff),
        avgPointDiff: Math.round(avgActualDiff * 10) / 10,
        homeWinPct: Math.round(homeWinPct * 1000) / 10 + '%',
        interpretation: {
          eloToPoints: `A team with +100 Elo advantage scores ~${Math.round(eloToPoints * 10) / 10} more points`,
          homeField: `Home teams score ~${Math.round(intercept * 10) / 10} more points on average`,
        }
      },
      recommendation: {
        updateEloService: `Change eloDiff / 100 to eloDiff * ${Math.round(slope * 1000) / 1000}`,
        updateHomeAdvantage: `Change home field from 2.5 to ${Math.round(intercept * 10) / 10}`,
      }
    });
  } catch (error) {
    console.error('Calibration error:', error);
    return NextResponse.json({
      error: 'Calibration failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
