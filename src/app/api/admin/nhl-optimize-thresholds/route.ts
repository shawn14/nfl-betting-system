import { NextResponse } from 'next/server';
import { head } from '@vercel/blob';

const NHL_BLOB_NAME = 'nhl-prediction-data.json';

interface BacktestResult {
  gameId: string;
  gameTime: string;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  predictedSpread: number;
  predictedTotal: number;
  vegasSpread: number;
  vegasTotal: number;
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  homeWinProb: number;
  atsResult: 'win' | 'loss' | 'push';
  mlResult: 'win' | 'loss';
  ouResult: 'win' | 'loss' | 'push';
  eloGap: number;
  isHighConviction?: boolean;
}

interface FilterConfig {
  name: string;
  description: string;
  filter: (r: BacktestResult) => boolean;
}

export async function GET() {
  try {
    // Fetch blob data
    const blobInfo = await head(NHL_BLOB_NAME);
    if (!blobInfo?.url) {
      return NextResponse.json({ error: 'NHL blob not found' }, { status: 404 });
    }

    const blobRes = await fetch(blobInfo.url, { cache: 'no-store' });
    if (!blobRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch blob' }, { status: 500 });
    }

    const blobData = await blobRes.json();
    const results: BacktestResult[] = blobData.backtest?.results || [];

    if (results.length === 0) {
      return NextResponse.json({ error: 'No backtest results found' }, { status: 400 });
    }

    // Calculate baseline (all games)
    const baseline = calculateStats(results, 'All Games');

    // Define filter configurations to test
    const filters: FilterConfig[] = [
      // Picking favorites (our spread < Vegas spread)
      {
        name: 'Pick Favorites Only',
        description: 'Only bet when we pick the Vegas favorite to cover',
        filter: (r) => r.predictedSpread < r.vegasSpread && r.vegasSpread < 0,
      },
      {
        name: 'Pick Underdogs Only',
        description: 'Only bet when we pick the underdog to cover',
        filter: (r) => r.predictedSpread > r.vegasSpread || r.vegasSpread > 0,
      },
      // Elo gap filters
      {
        name: 'Elo Gap >= 50',
        description: 'Games where Elo difference is at least 50',
        filter: (r) => r.eloGap >= 50,
      },
      {
        name: 'Elo Gap >= 75',
        description: 'Games where Elo difference is at least 75',
        filter: (r) => r.eloGap >= 75,
      },
      {
        name: 'Elo Gap >= 100',
        description: 'Games where Elo difference is at least 100',
        filter: (r) => r.eloGap >= 100,
      },
      {
        name: 'Elo Gap >= 125',
        description: 'Games where Elo difference is at least 125',
        filter: (r) => r.eloGap >= 125,
      },
      // Spread edge filters
      {
        name: 'Spread Edge >= 0.5',
        description: 'At least 0.5 goal edge vs Vegas',
        filter: (r) => Math.abs(r.predictedSpread - r.vegasSpread) >= 0.5,
      },
      {
        name: 'Spread Edge >= 1.0',
        description: 'At least 1.0 goal edge vs Vegas',
        filter: (r) => Math.abs(r.predictedSpread - r.vegasSpread) >= 1.0,
      },
      {
        name: 'Spread Edge >= 1.5',
        description: 'At least 1.5 goal edge vs Vegas',
        filter: (r) => Math.abs(r.predictedSpread - r.vegasSpread) >= 1.5,
      },
      // Win probability filters
      {
        name: 'Strong Favorite (>60%)',
        description: 'Pick with over 60% win probability',
        filter: (r) => Math.max(r.homeWinProb, 100 - r.homeWinProb) > 60,
      },
      {
        name: 'Very Strong Favorite (>65%)',
        description: 'Pick with over 65% win probability',
        filter: (r) => Math.max(r.homeWinProb, 100 - r.homeWinProb) > 65,
      },
      // Combo filters
      {
        name: 'Pick Fav + Elo Gap >= 50',
        description: 'Pick favorite AND Elo gap at least 50',
        filter: (r) => (r.predictedSpread < r.vegasSpread && r.vegasSpread < 0) && r.eloGap >= 50,
      },
      {
        name: 'Pick Fav + Elo Gap >= 75',
        description: 'Pick favorite AND Elo gap at least 75',
        filter: (r) => (r.predictedSpread < r.vegasSpread && r.vegasSpread < 0) && r.eloGap >= 75,
      },
      {
        name: 'Pick Fav + Elo Gap >= 100',
        description: 'Pick favorite AND Elo gap at least 100',
        filter: (r) => (r.predictedSpread < r.vegasSpread && r.vegasSpread < 0) && r.eloGap >= 100,
      },
      {
        name: 'Elo Aligned with Vegas',
        description: 'Our Elo favorite matches Vegas favorite',
        filter: (r) => {
          const ourFavorite = r.homeElo > r.awayElo ? 'home' : 'away';
          const vegasFavorite = r.vegasSpread < 0 ? 'home' : 'away';
          return ourFavorite === vegasFavorite;
        },
      },
      {
        name: 'Elo Aligned + Gap >= 50',
        description: 'Elo aligned with Vegas AND gap at least 50',
        filter: (r) => {
          const ourFavorite = r.homeElo > r.awayElo ? 'home' : 'away';
          const vegasFavorite = r.vegasSpread < 0 ? 'home' : 'away';
          return ourFavorite === vegasFavorite && r.eloGap >= 50;
        },
      },
      {
        name: 'Elo Aligned + Gap >= 75',
        description: 'Elo aligned with Vegas AND gap at least 75',
        filter: (r) => {
          const ourFavorite = r.homeElo > r.awayElo ? 'home' : 'away';
          const vegasFavorite = r.vegasSpread < 0 ? 'home' : 'away';
          return ourFavorite === vegasFavorite && r.eloGap >= 75;
        },
      },
      // Small spreads (close games)
      {
        name: 'Vegas Spread <= 1.5',
        description: 'Close games only (spread 1.5 or less)',
        filter: (r) => Math.abs(r.vegasSpread) <= 1.5,
      },
      {
        name: 'Vegas Spread > 1.5',
        description: 'Larger spreads only (spread over 1.5)',
        filter: (r) => Math.abs(r.vegasSpread) > 1.5,
      },
      // O/U edge filters
      {
        name: 'O/U Edge >= 1.0',
        description: 'At least 1 goal edge on total',
        filter: (r) => Math.abs(r.predictedTotal - r.vegasTotal) >= 1.0,
      },
      {
        name: 'O/U Edge >= 1.5',
        description: 'At least 1.5 goal edge on total',
        filter: (r) => Math.abs(r.predictedTotal - r.vegasTotal) >= 1.5,
      },
      {
        name: 'O/U Edge >= 2.0',
        description: 'At least 2 goal edge on total',
        filter: (r) => Math.abs(r.predictedTotal - r.vegasTotal) >= 2.0,
      },
    ];

    // Test each filter
    const filterResults = filters.map(f => {
      const filtered = results.filter(f.filter);
      return {
        ...calculateStats(filtered, f.name),
        description: f.description,
      };
    });

    // Sort by Puck Line win %
    const byPuckLine = [...filterResults]
      .filter(r => r.games >= 20) // Minimum sample size
      .sort((a, b) => b.spread.winPct - a.spread.winPct);

    // Sort by O/U win %
    const byOU = [...filterResults]
      .filter(r => r.games >= 20)
      .sort((a, b) => b.overUnder.winPct - a.overUnder.winPct);

    // Find team-specific patterns
    const teamStats = analyzeTeams(results);

    return NextResponse.json({
      baseline,
      totalGames: results.length,
      filters: {
        byPuckLine: byPuckLine.slice(0, 10),
        byOU: byOU.slice(0, 10),
        all: filterResults,
      },
      teamAnalysis: teamStats,
      recommendations: generateRecommendations(byPuckLine, byOU, baseline),
    });

  } catch (error) {
    console.error('NHL optimize error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function calculateStats(results: BacktestResult[], name: string) {
  const atsWins = results.filter(r => r.atsResult === 'win').length;
  const atsLosses = results.filter(r => r.atsResult === 'loss').length;
  const atsPushes = results.filter(r => r.atsResult === 'push').length;
  const mlWins = results.filter(r => r.mlResult === 'win').length;
  const mlLosses = results.filter(r => r.mlResult === 'loss').length;
  const ouWins = results.filter(r => r.ouResult === 'win').length;
  const ouLosses = results.filter(r => r.ouResult === 'loss').length;
  const ouPushes = results.filter(r => r.ouResult === 'push').length;

  return {
    name,
    games: results.length,
    spread: {
      wins: atsWins,
      losses: atsLosses,
      pushes: atsPushes,
      winPct: atsWins + atsLosses > 0 ? Math.round((atsWins / (atsWins + atsLosses)) * 1000) / 10 : 0,
      record: `${atsWins}-${atsLosses}-${atsPushes}`,
    },
    moneyline: {
      wins: mlWins,
      losses: mlLosses,
      winPct: mlWins + mlLosses > 0 ? Math.round((mlWins / (mlWins + mlLosses)) * 1000) / 10 : 0,
      record: `${mlWins}-${mlLosses}`,
    },
    overUnder: {
      wins: ouWins,
      losses: ouLosses,
      pushes: ouPushes,
      winPct: ouWins + ouLosses > 0 ? Math.round((ouWins / (ouWins + ouLosses)) * 1000) / 10 : 0,
      record: `${ouWins}-${ouLosses}-${ouPushes}`,
    },
  };
}

function analyzeTeams(results: BacktestResult[]) {
  const homeTeamStats: Record<string, { wins: number; losses: number }> = {};
  const awayTeamStats: Record<string, { wins: number; losses: number }> = {};

  for (const r of results) {
    // Track home team performance when we pick them
    if (r.predictedSpread < r.vegasSpread) { // We picked home
      if (!homeTeamStats[r.homeTeam]) homeTeamStats[r.homeTeam] = { wins: 0, losses: 0 };
      if (r.atsResult === 'win') homeTeamStats[r.homeTeam].wins++;
      else if (r.atsResult === 'loss') homeTeamStats[r.homeTeam].losses++;
    }

    // Track away team performance when we pick them
    if (r.predictedSpread > r.vegasSpread) { // We picked away
      if (!awayTeamStats[r.awayTeam]) awayTeamStats[r.awayTeam] = { wins: 0, losses: 0 };
      if (r.atsResult === 'win') awayTeamStats[r.awayTeam].wins++;
      else if (r.atsResult === 'loss') awayTeamStats[r.awayTeam].losses++;
    }
  }

  const formatTeamStats = (stats: Record<string, { wins: number; losses: number }>) => {
    return Object.entries(stats)
      .map(([team, s]) => ({
        team,
        wins: s.wins,
        losses: s.losses,
        winPct: s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 1000) / 10 : 0,
        games: s.wins + s.losses,
      }))
      .filter(t => t.games >= 5)
      .sort((a, b) => b.winPct - a.winPct);
  };

  return {
    bestHomeTeams: formatTeamStats(homeTeamStats).slice(0, 10),
    worstHomeTeams: formatTeamStats(homeTeamStats).slice(-10).reverse(),
    bestAwayTeams: formatTeamStats(awayTeamStats).slice(0, 10),
    worstAwayTeams: formatTeamStats(awayTeamStats).slice(-10).reverse(),
  };
}

function generateRecommendations(
  byPuckLine: any[],
  byOU: any[],
  baseline: any
) {
  const recommendations: string[] = [];

  if (byPuckLine.length > 0 && byPuckLine[0].spread.winPct > baseline.spread.winPct + 5) {
    recommendations.push(
      `Best Puck Line filter: "${byPuckLine[0].name}" at ${byPuckLine[0].spread.winPct}% (${byPuckLine[0].spread.record}) vs baseline ${baseline.spread.winPct}%`
    );
  }

  if (byOU.length > 0 && byOU[0].overUnder.winPct > baseline.overUnder.winPct + 5) {
    recommendations.push(
      `Best O/U filter: "${byOU[0].name}" at ${byOU[0].overUnder.winPct}% (${byOU[0].overUnder.record}) vs baseline ${baseline.overUnder.winPct}%`
    );
  }

  // Check for high-volume high-performance filters
  const highVolumeFilters = byPuckLine.filter(f => f.games >= 50 && f.spread.winPct >= 65);
  if (highVolumeFilters.length > 0) {
    recommendations.push(
      `High-volume winner: "${highVolumeFilters[0].name}" with ${highVolumeFilters[0].games} games at ${highVolumeFilters[0].spread.winPct}%`
    );
  }

  return recommendations;
}
