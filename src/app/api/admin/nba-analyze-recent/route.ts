import { NextResponse } from 'next/server';
import { head } from '@vercel/blob';

const NBA_BLOB_NAME = 'nba-prediction-data.json';

interface BacktestResult {
  gameId: string;
  gameTime: string;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb: number;
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  vegasSpread?: number;
  vegasTotal?: number;
  atsResult?: 'win' | 'loss' | 'push';
  mlResult?: 'win' | 'loss';
  ouVegasResult?: 'win' | 'loss' | 'push';
  conviction?: {
    level: 'elite' | 'high' | 'moderate' | 'low';
    isHighConviction?: boolean;
    expectedWinPct?: number;
    picksVegasFavorite?: boolean;
    eloAligned?: boolean;
    eloGap?: number;
    restFavorsPick?: boolean;
    filters?: {
      teamAvoidance?: boolean;
      avoidReason?: string;
      eloGap?: number;
      picksVegasFavorite?: boolean;
      eloAligned?: boolean;
      restFavorsPick?: boolean;
    };
  };
  restDays?: {
    home: number;
    away: number;
    homeIsB2B: boolean;
    awayIsB2B: boolean;
    advantage: 'home' | 'away' | 'even';
  };
}

interface TeamATSPerformance {
  team: string;
  atsWins: number;
  atsLosses: number;
  atsPushes: number;
  winPct: number;
  gamesInWindow: number;
  asHome: { wins: number; losses: number; winPct: number };
  asAway: { wins: number; losses: number; winPct: number };
  avgElo: number;
}

interface LossAnalysis {
  gameId: string;
  date: string;
  matchup: string;
  ourPick: string;
  homeTeam: string;
  awayTeam: string;
  predictedSpread: number;
  vegasSpread: number;
  actualMargin: number;
  missedBy: number;
  conviction?: string;
  convictionLevel?: string;
  eloGap: number;
  restSituation: string;
  avoidTeamIssue?: string;
}

interface PatternInsight {
  pattern: string;
  frequency: number;
  description: string;
  severity: 'critical' | 'moderate' | 'minor';
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const windowSize = parseInt(searchParams.get('window') || '15');

    // Fetch blob data
    const blobInfo = await head(NBA_BLOB_NAME);
    if (!blobInfo?.url) {
      return NextResponse.json({ error: 'NBA blob not found' }, { status: 404 });
    }

    const blobRes = await fetch(blobInfo.url, { cache: 'no-store' });
    const blobData = await blobRes.json();
    const allResults: BacktestResult[] = blobData.backtest?.results || [];

    // Filter to games with Vegas odds and sort by date descending
    const withOdds = allResults
      .filter(r => r.vegasSpread !== undefined && r.atsResult !== undefined)
      .sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime());

    // Get last N games
    const recentGames = withOdds.slice(0, windowSize);

    if (recentGames.length === 0) {
      return NextResponse.json({ error: 'No recent games with odds found' }, { status: 404 });
    }

    // Overall ATS stats for window
    const atsWins = recentGames.filter(g => g.atsResult === 'win').length;
    const atsLosses = recentGames.filter(g => g.atsResult === 'loss').length;
    const atsPushes = recentGames.filter(g => g.atsResult === 'push').length;
    const atsWinPct = atsWins + atsLosses > 0
      ? Math.round((atsWins / (atsWins + atsLosses)) * 1000) / 10
      : 0;

    // Historical baseline (all games)
    const historicalATS = {
      wins: withOdds.filter(g => g.atsResult === 'win').length,
      losses: withOdds.filter(g => g.atsResult === 'loss').length,
      winPct: 0,
    };
    const total = historicalATS.wins + historicalATS.losses;
    historicalATS.winPct = total > 0 ? Math.round((historicalATS.wins / total) * 1000) / 10 : 0;

    // Extract losses
    const losses = recentGames.filter(g => g.atsResult === 'loss');

    const lossDetails: LossAnalysis[] = losses.map(game => {
      const pickHome = game.predictedSpread < (game.vegasSpread || 0);
      const actualMargin = game.actualHomeScore - game.actualAwayScore;
      const vegasSpread = game.vegasSpread!;
      const missedBy = pickHome
        ? vegasSpread - actualMargin  // How much home underperformed
        : actualMargin - vegasSpread; // How much away underperformed

      let restSituation = 'Unknown';
      if (game.restDays) {
        const { homeIsB2B, awayIsB2B, advantage } = game.restDays;
        restSituation = homeIsB2B && awayIsB2B ? 'Both B2B' :
                        homeIsB2B ? 'Home B2B' :
                        awayIsB2B ? 'Away B2B' :
                        advantage === 'even' ? 'Even rest' :
                        `${advantage} advantage`;
      }

      return {
        gameId: game.gameId,
        date: new Date(game.gameTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        matchup: `${game.awayTeam} @ ${game.homeTeam}`,
        ourPick: pickHome ? game.homeTeam : game.awayTeam,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        predictedSpread: Math.round(game.predictedSpread * 2) / 2,
        vegasSpread: Math.round(vegasSpread * 2) / 2,
        actualMargin: Math.round(actualMargin * 2) / 2,
        missedBy: Math.round(missedBy * 2) / 2,
        conviction: game.conviction?.filters?.avoidReason || game.conviction?.level,
        convictionLevel: game.conviction?.level,
        eloGap: Math.abs(game.homeElo - game.awayElo),
        restSituation,
        avoidTeamIssue: game.conviction?.filters?.teamAvoidance ? game.conviction.filters.avoidReason : undefined,
      };
    });

    // Build team performance map for recent window
    const teamPerformance = new Map<string, {
      wins: number; losses: number; pushes: number;
      homeWins: number; homeLosses: number;
      awayWins: number; awayLosses: number;
      totalElo: number; games: number;
    }>();

    for (const game of recentGames) {
      // Initialize teams
      for (const team of [game.homeTeam, game.awayTeam]) {
        if (!teamPerformance.has(team)) {
          teamPerformance.set(team, {
            wins: 0, losses: 0, pushes: 0,
            homeWins: 0, homeLosses: 0,
            awayWins: 0, awayLosses: 0,
            totalElo: 0, games: 0,
          });
        }
      }

      const homeStats = teamPerformance.get(game.homeTeam)!;
      const awayStats = teamPerformance.get(game.awayTeam)!;

      homeStats.games++;
      awayStats.games++;
      homeStats.totalElo += game.homeElo;
      awayStats.totalElo += game.awayElo;

      // Track W/L for both teams (both participate in the same result)
      if (game.atsResult === 'win') {
        homeStats.wins++;
        awayStats.wins++;
      } else if (game.atsResult === 'loss') {
        homeStats.losses++;
        awayStats.losses++;
      } else {
        homeStats.pushes++;
        awayStats.pushes++;
      }

      // Track home/away splits
      const pickHome = game.predictedSpread < (game.vegasSpread || 0);
      if (pickHome) {
        if (game.atsResult === 'win') homeStats.homeWins++;
        if (game.atsResult === 'loss') homeStats.homeLosses++;
      } else {
        if (game.atsResult === 'win') awayStats.awayWins++;
        if (game.atsResult === 'loss') awayStats.awayLosses++;
      }
    }

    // Convert to sorted array
    const teamAnalysis: TeamATSPerformance[] = Array.from(teamPerformance.entries())
      .filter(([_, stats]) => stats.games >= 3) // Only teams with 3+ games in window
      .map(([team, stats]) => {
        const total = stats.wins + stats.losses;
        const homeTotal = stats.homeWins + stats.homeLosses;
        const awayTotal = stats.awayWins + stats.awayLosses;

        return {
          team,
          atsWins: stats.wins,
          atsLosses: stats.losses,
          atsPushes: stats.pushes,
          winPct: total > 0 ? Math.round((stats.wins / total) * 1000) / 10 : 0,
          gamesInWindow: stats.games,
          asHome: {
            wins: stats.homeWins,
            losses: stats.homeLosses,
            winPct: homeTotal > 0 ? Math.round((stats.homeWins / homeTotal) * 1000) / 10 : 0,
          },
          asAway: {
            wins: stats.awayWins,
            losses: stats.awayLosses,
            winPct: awayTotal > 0 ? Math.round((stats.awayWins / awayTotal) * 1000) / 10 : 0,
          },
          avgElo: Math.round(stats.totalElo / stats.games),
        };
      })
      .sort((a, b) => a.winPct - b.winPct); // Worst performers first

    const worstTeams = teamAnalysis.slice(0, 5);

    // Identify patterns in losses
    const patterns: PatternInsight[] = [];

    // Pattern 1: Home vs Away pick bias
    const homeLosses = lossDetails.filter(l => l.ourPick === l.homeTeam).length;
    const awayLosses = lossDetails.filter(l => l.ourPick === l.awayTeam).length;
    if (homeLosses > awayLosses * 1.5 && homeLosses >= 3) {
      patterns.push({
        pattern: 'Home Pick Bias',
        frequency: homeLosses,
        description: `${homeLosses}/${losses.length} losses came from picking home team`,
        severity: homeLosses >= 4 ? 'critical' : 'moderate',
      });
    }

    // Pattern 2: Avoid team filter violations
    const avoidTeamLosses = lossDetails.filter(l => l.avoidTeamIssue).length;
    if (avoidTeamLosses > 0) {
      patterns.push({
        pattern: 'Avoid Team Violations',
        frequency: avoidTeamLosses,
        description: `${avoidTeamLosses}/${losses.length} losses involved teams on avoid list`,
        severity: avoidTeamLosses >= 3 ? 'critical' : 'moderate',
      });
    }

    // Pattern 3: Low conviction picks
    const lowConvictionLosses = lossDetails.filter(l =>
      l.convictionLevel === 'low' || l.convictionLevel === 'moderate'
    ).length;
    if (lowConvictionLosses >= 3) {
      patterns.push({
        pattern: 'Low Conviction Dominance',
        frequency: lowConvictionLosses,
        description: `${lowConvictionLosses}/${losses.length} losses were low/moderate conviction`,
        severity: lowConvictionLosses >= losses.length * 0.7 ? 'critical' : 'moderate',
      });
    }

    // Pattern 4: B2B situations
    const b2bLosses = lossDetails.filter(l =>
      l.restSituation.includes('B2B')
    ).length;
    if (b2bLosses >= 2) {
      patterns.push({
        pattern: 'Back-to-Back Struggles',
        frequency: b2bLosses,
        description: `${b2bLosses}/${losses.length} losses involved B2B situations`,
        severity: b2bLosses >= 3 ? 'moderate' : 'minor',
      });
    }

    // Pattern 5: Small Elo gap (toss-up games)
    const smallEloGapLosses = lossDetails.filter(l => l.eloGap < 50).length;
    if (smallEloGapLosses >= 3) {
      patterns.push({
        pattern: 'Toss-Up Game Struggles',
        frequency: smallEloGapLosses,
        description: `${smallEloGapLosses}/${losses.length} losses had Elo gap < 50`,
        severity: 'moderate',
      });
    }

    // Pattern 6: Check if recent games were dominated by low conviction
    const lowConvictionTotal = recentGames.filter(g =>
      g.conviction?.level === 'low' || g.conviction?.level === 'moderate'
    ).length;
    if (lowConvictionTotal >= recentGames.length * 0.7) {
      patterns.push({
        pattern: 'Schedule Difficulty',
        frequency: lowConvictionTotal,
        description: `${lowConvictionTotal}/${recentGames.length} recent games were low/moderate conviction (difficult schedule)`,
        severity: 'critical',
      });
    }

    // Generate actionable recommendations
    const recommendations: string[] = [];

    if (worstTeams.length > 0) {
      const worst = worstTeams[0];
      if (worst.winPct < 40 && worst.gamesInWindow >= 3) {
        recommendations.push(
          `CRITICAL: ${worst.team} has ${worst.winPct}% ATS in last ${windowSize} games (${worst.atsWins}-${worst.atsLosses}). Consider adding to avoid list.`
        );
      }
    }

    if (homeLosses > awayLosses * 1.5 && homeLosses >= 3) {
      recommendations.push(
        `WARNING: Home picks underperforming (${homeLosses}/${losses.length} losses). Review home court advantage assumptions.`
      );
    }

    if (avoidTeamLosses > 0) {
      const avoidTeams = lossDetails
        .filter(l => l.avoidTeamIssue)
        .map(l => `${l.ourPick} (${l.avoidTeamIssue})`)
        .join(', ');
      recommendations.push(
        `FILTER BREACH: ${avoidTeamLosses} losses despite avoid filters. Teams: ${avoidTeams}`
      );
    }

    if (lowConvictionLosses >= losses.length * 0.6) {
      recommendations.push(
        `STRATEGY: ${lowConvictionLosses}/${losses.length} losses were low conviction. Consider stricter filters or reduced stakes on moderate picks.`
      );
    }

    // Compare to historical
    if (atsWinPct < historicalATS.winPct - 5) {
      recommendations.push(
        `REGRESSION: Recent ${atsWinPct}% is ${Math.round((historicalATS.winPct - atsWinPct) * 10) / 10}% below historical ${historicalATS.winPct}%. Variance expected, but monitor for systematic issues.`
      );
    }

    // Spread size analysis
    if (losses.length > 0) {
      const spreadSizes = lossDetails.map(l => Math.abs(l.vegasSpread));
      const avgSpread = spreadSizes.reduce((a, b) => a + b, 0) / spreadSizes.length;
      if (avgSpread < 4) {
        recommendations.push(
          `INSIGHT: Losses concentrated in small spreads (avg ${Math.round(avgSpread * 10) / 10} pts). Close games are harder to predict - consider minimum spread threshold.`
        );
      }
    }

    // Check conviction breakdown
    const convictionBreakdown = {
      elite: recentGames.filter(g => g.conviction?.level === 'elite').length,
      high: recentGames.filter(g => g.conviction?.level === 'high').length,
      moderate: recentGames.filter(g => g.conviction?.level === 'moderate').length,
      low: recentGames.filter(g => g.conviction?.level === 'low').length,
    };

    if (convictionBreakdown.elite + convictionBreakdown.high < 3) {
      recommendations.push(
        `SCHEDULE ISSUE: Only ${convictionBreakdown.elite + convictionBreakdown.high} high/elite conviction games in window. Recent schedule featured many difficult matchups.`
      );
    }

    return NextResponse.json({
      analysisWindow: {
        size: windowSize,
        startDate: recentGames[recentGames.length - 1].gameTime,
        endDate: recentGames[0].gameTime,
        totalGames: recentGames.length,
      },

      recentPerformance: {
        atsRecord: `${atsWins}-${atsLosses}${atsPushes > 0 ? `-${atsPushes}` : ''}`,
        atsWinPct,
        comparison: {
          historical: historicalATS.winPct,
          delta: Math.round((atsWinPct - historicalATS.winPct) * 10) / 10,
          status: atsWinPct > historicalATS.winPct ? 'outperforming' : 'underperforming',
        },
      },

      lossAnalysis: {
        totalLosses: losses.length,
        losses: lossDetails.sort((a, b) => b.missedBy - a.missedBy), // Biggest misses first
        byConviction: {
          elite: lossDetails.filter(l => l.convictionLevel === 'elite').length,
          high: lossDetails.filter(l => l.convictionLevel === 'high').length,
          moderate: lossDetails.filter(l => l.convictionLevel === 'moderate').length,
          low: lossDetails.filter(l => l.convictionLevel === 'low').length,
        },
        byPickType: {
          homePicks: homeLosses,
          awayPicks: awayLosses,
        },
      },

      convictionBreakdown: {
        recent: convictionBreakdown,
        note: 'Shows conviction distribution of all recent games, not just losses',
      },

      teamAnalysis: {
        worstPerformers: worstTeams,
        totalTeamsAnalyzed: teamAnalysis.length,
        note: 'Teams with 3+ games in window, sorted by ATS win %',
      },

      patterns: patterns.sort((a, b) => {
        const severityOrder = { critical: 0, moderate: 1, minor: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),

      recommendations,

      rawData: {
        recentGames: recentGames.map(g => ({
          date: g.gameTime,
          matchup: `${g.awayTeam} @ ${g.homeTeam}`,
          result: g.atsResult,
          conviction: g.conviction?.level,
        })),
      },
    });

  } catch (error) {
    console.error('Recent analysis error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
