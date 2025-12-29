import { NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';
import { saveDocsBatch, getDocsMap, setSportState, getSportState } from '@/services/firestore-admin-store';
import { SportKey } from '@/services/firestore-types';
import { updateEloAfterGame } from '@/services/elo';
import { Team } from '@/types';

const NHL_BLOB_NAME = 'nhl-prediction-data.json';
const sport: SportKey = 'nhl';

// NHL Constants
const LEAGUE_AVG_GPG = 3.1;
const ELO_TO_POINTS = 0.018;
const HOME_ICE_ADVANTAGE = 0.25;
const ELO_HOME_ADVANTAGE = 48;
const SPREAD_REGRESSION = 0.4;
const ELO_CAP = 3;

interface HistoricalOdds {
  vegasSpread: number;
  vegasTotal: number;
  openingSpread?: number;
  openingTotal?: number;
  capturedAt: string;
  backfilled?: boolean;
}

async function fetchESPNOdds(gameId: string): Promise<{ spread: number; total: number } | null> {
  try {
    const url = `https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/${gameId}/competitions/${gameId}/odds`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;

    const data = await res.json();
    const odds = data.items?.[0];

    if (odds?.spread !== undefined && odds?.overUnder !== undefined) {
      return { spread: odds.spread, total: odds.overUnder };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchNHLScoreboard(dateStr: string): Promise<any[]> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateStr}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];

    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}

function predictScore(
  homeElo: number,
  awayElo: number,
  homeGPG: number,
  homeGPGAllowed: number,
  awayGPG: number,
  awayGPGAllowed: number
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_GPG * 0.3;

  const regHomeGPG = regress(homeGPG);
  const regHomeGPGAllowed = regress(homeGPGAllowed);
  const regAwayGPG = regress(awayGPG);
  const regAwayGPGAllowed = regress(awayGPGAllowed);

  const baseHomeScore = (regHomeGPG + regAwayGPGAllowed) / 2;
  const baseAwayScore = (regAwayGPG + regHomeGPGAllowed) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  const homeScore = baseHomeScore + eloAdj + HOME_ICE_ADVANTAGE / 2;
  const awayScore = baseAwayScore - eloAdj + HOME_ICE_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const daysBack = parseInt(searchParams.get('days') || '90');
  const batchSize = parseInt(searchParams.get('batch') || '30');
  const offset = parseInt(searchParams.get('offset') || '0');
  const dryRun = searchParams.get('dryRun') === 'true';

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log(`NHL Season Backfill - days=${daysBack}, batch=${batchSize}, offset=${offset}`);

    // Calculate date range (current season: Oct 2025 - now, since it's Dec 2025)
    const endDate = new Date();
    // Season started October 1, 2025
    const seasonStart = new Date(2025, 9, 1); // October 1, 2025

    // Start from season start + offset
    const startDate = new Date(seasonStart);
    startDate.setDate(startDate.getDate() + offset);

    const batchEndDate = new Date(startDate);
    batchEndDate.setDate(batchEndDate.getDate() + batchSize);
    if (batchEndDate > endDate) {
      batchEndDate.setTime(endDate.getTime());
    }

    log(`Fetching games from ${startDate.toISOString().split('T')[0]} to ${batchEndDate.toISOString().split('T')[0]}`);

    // Fetch existing data
    const historicalOdds = await getDocsMap<HistoricalOdds>(sport, 'oddsLocks');
    log(`Loaded ${Object.keys(historicalOdds).length} existing odds records`);

    // Fetch blob for team data
    let blobData: any = null;
    try {
      const blobInfo = await head(NHL_BLOB_NAME);
      if (blobInfo?.url) {
        const blobRes = await fetch(blobInfo.url, { cache: 'no-store' });
        if (blobRes.ok) {
          blobData = await blobRes.json();
        }
      }
    } catch {
      log('No existing blob found, will create new one');
    }

    // Build team map with starting Elo
    const teamsMap = new Map<string, { id: string; abbreviation: string; eloRating: number; ppg: number; ppgAllowed: number }>();
    if (blobData?.teams) {
      for (const team of blobData.teams) {
        teamsMap.set(team.id, { ...team, eloRating: 1500 }); // Reset to 1500 for backfill
      }
    }

    // If no teams, fetch from ESPN
    if (teamsMap.size === 0) {
      log('Fetching teams from ESPN...');
      const teamsRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams?limit=50');
      const teamsData = await teamsRes.json();
      for (const t of teamsData.sports?.[0]?.leagues?.[0]?.teams || []) {
        const team = t.team;
        teamsMap.set(team.id, {
          id: team.id,
          abbreviation: team.abbreviation,
          eloRating: 1500,
          ppg: LEAGUE_AVG_GPG,
          ppgAllowed: LEAGUE_AVG_GPG,
        });
      }
      log(`Loaded ${teamsMap.size} teams`);
    }

    // Collect all games in date range
    const allGames: any[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= batchEndDate) {
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '');
      const events = await fetchNHLScoreboard(dateStr);

      for (const event of events) {
        if (event.status?.type?.state !== 'post') continue; // Only completed games

        const competition = event.competitions?.[0];
        const homeTeam = competition?.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = competition?.competitors?.find((c: any) => c.homeAway === 'away');

        if (!homeTeam || !awayTeam) continue;

        allGames.push({
          id: event.id,
          gameTime: event.date,
          homeTeamId: homeTeam.team?.id,
          awayTeamId: awayTeam.team?.id,
          homeScore: parseInt(homeTeam.score || '0'),
          awayScore: parseInt(awayTeam.score || '0'),
          homeAbbr: homeTeam.team?.abbreviation,
          awayAbbr: awayTeam.team?.abbreviation,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
      await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
    }

    log(`Found ${allGames.length} completed games in date range`);

    // Sort games chronologically
    allGames.sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    // Process games - fetch odds and calculate results
    let oddsFound = 0;
    let oddsMissing = 0;
    const backtestResults: any[] = [];
    const newOdds: { id: string; data: HistoricalOdds }[] = [];

    for (const game of allGames) {
      // Skip if we already have odds for this game
      if (historicalOdds[game.id]) {
        oddsFound++;
        continue;
      }

      // Fetch odds from ESPN
      const odds = await fetchESPNOdds(game.id);

      if (!odds) {
        oddsMissing++;
        continue;
      }

      oddsFound++;

      // Store odds
      const oddsData: HistoricalOdds = {
        vegasSpread: odds.spread,
        vegasTotal: odds.total,
        openingSpread: odds.spread,
        openingTotal: odds.total,
        capturedAt: new Date().toISOString(),
        backfilled: true,
      };
      historicalOdds[game.id] = oddsData;
      newOdds.push({ id: game.id, data: oddsData });

      // Get team Elos at game time
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);

      if (!homeTeam || !awayTeam) continue;

      const homeElo = homeTeam.eloRating;
      const awayElo = awayTeam.eloRating;

      // Calculate prediction
      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeElo, awayElo,
        homeTeam.ppg, homeTeam.ppgAllowed,
        awayTeam.ppg, awayTeam.ppgAllowed
      );

      const predictedSpread = calculateSpread(predHome, predAway);
      const predictedTotal = predHome + predAway;
      const adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayElo - adjustedHomeElo) / 400));

      const actualSpread = game.awayScore - game.homeScore;
      const actualTotal = game.homeScore + game.awayScore;
      const homeWon = game.homeScore > game.awayScore;

      // Calculate ATS result
      const pickHome = predictedSpread < odds.spread;
      let atsResult: 'win' | 'loss' | 'push';
      if (pickHome) {
        atsResult = actualSpread < odds.spread ? 'win' : actualSpread > odds.spread ? 'loss' : 'push';
      } else {
        atsResult = actualSpread > odds.spread ? 'win' : actualSpread < odds.spread ? 'loss' : 'push';
      }

      // Calculate ML result
      const mlPick = homeWinProb > 0.5 ? 'home' : 'away';
      const mlResult = (mlPick === 'home' && homeWon) || (mlPick === 'away' && !homeWon) ? 'win' : 'loss';

      // Calculate O/U result
      const pickOver = predictedTotal > odds.total;
      let ouResult: 'win' | 'loss' | 'push';
      if (pickOver) {
        ouResult = actualTotal > odds.total ? 'win' : actualTotal < odds.total ? 'loss' : 'push';
      } else {
        ouResult = actualTotal < odds.total ? 'win' : actualTotal > odds.total ? 'loss' : 'push';
      }

      // High conviction: Elo gap >= 75
      const eloGap = Math.abs(homeElo - awayElo);
      const isHighConviction = eloGap >= 75;

      backtestResults.push({
        gameId: game.id,
        gameTime: game.gameTime,
        homeTeam: game.homeAbbr,
        awayTeam: game.awayAbbr,
        homeElo,
        awayElo,
        predictedSpread,
        predictedTotal,
        vegasSpread: odds.spread,
        vegasTotal: odds.total,
        actualHomeScore: game.homeScore,
        actualAwayScore: game.awayScore,
        actualSpread,
        actualTotal,
        homeWinProb: Math.round(homeWinProb * 1000) / 10,
        atsResult,
        mlResult,
        ouResult,
        isHighConviction,
        eloGap,
      });

      // Update Elo for next game
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        { id: game.homeTeamId, eloRating: homeElo } as Team,
        { id: game.awayTeamId, eloRating: awayElo } as Team,
        game.homeScore, game.awayScore
      );
      homeTeam.eloRating = homeNewElo;
      awayTeam.eloRating = awayNewElo;

      await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
    }

    log(`Processed ${backtestResults.length} games with odds (${oddsMissing} missing odds)`);

    // Calculate backtest summary
    const atsWins = backtestResults.filter(r => r.atsResult === 'win').length;
    const atsLosses = backtestResults.filter(r => r.atsResult === 'loss').length;
    const atsPushes = backtestResults.filter(r => r.atsResult === 'push').length;
    const mlWins = backtestResults.filter(r => r.mlResult === 'win').length;
    const mlLosses = backtestResults.filter(r => r.mlResult === 'loss').length;
    const ouWins = backtestResults.filter(r => r.ouResult === 'win').length;
    const ouLosses = backtestResults.filter(r => r.ouResult === 'loss').length;
    const ouPushes = backtestResults.filter(r => r.ouResult === 'push').length;

    const hcResults = backtestResults.filter(r => r.isHighConviction);
    const hcAtsWins = hcResults.filter(r => r.atsResult === 'win').length;
    const hcAtsLosses = hcResults.filter(r => r.atsResult === 'loss').length;
    const hcAtsPushes = hcResults.filter(r => r.atsResult === 'push').length;
    const hcMlWins = hcResults.filter(r => r.mlResult === 'win').length;
    const hcMlLosses = hcResults.filter(r => r.mlResult === 'loss').length;
    const hcOuWins = hcResults.filter(r => r.ouResult === 'win').length;
    const hcOuLosses = hcResults.filter(r => r.ouResult === 'loss').length;
    const hcOuPushes = hcResults.filter(r => r.ouResult === 'push').length;

    const summary = {
      totalGames: backtestResults.length,
      spread: {
        wins: atsWins,
        losses: atsLosses,
        pushes: atsPushes,
        winPct: atsWins + atsLosses > 0 ? Math.round((atsWins / (atsWins + atsLosses)) * 1000) / 10 : 0,
      },
      moneyline: {
        wins: mlWins,
        losses: mlLosses,
        winPct: mlWins + mlLosses > 0 ? Math.round((mlWins / (mlWins + mlLosses)) * 1000) / 10 : 0,
      },
      overUnder: {
        wins: ouWins,
        losses: ouLosses,
        pushes: ouPushes,
        winPct: ouWins + ouLosses > 0 ? Math.round((ouWins / (ouWins + ouLosses)) * 1000) / 10 : 0,
      },
    };

    const highConvictionSummary = {
      spread: {
        wins: hcAtsWins,
        losses: hcAtsLosses,
        pushes: hcAtsPushes,
        winPct: hcAtsWins + hcAtsLosses > 0 ? Math.round((hcAtsWins / (hcAtsWins + hcAtsLosses)) * 1000) / 10 : 0,
      },
      moneyline: {
        wins: hcMlWins,
        losses: hcMlLosses,
        winPct: hcMlWins + hcMlLosses > 0 ? Math.round((hcMlWins / (hcMlWins + hcMlLosses)) * 1000) / 10 : 0,
      },
      overUnder: {
        wins: hcOuWins,
        losses: hcOuLosses,
        pushes: hcOuPushes,
        winPct: hcOuWins + hcOuLosses > 0 ? Math.round((hcOuWins / (hcOuWins + hcOuLosses)) * 1000) / 10 : 0,
      },
    };

    log(`Backtest: PL ${summary.spread.winPct}% (${atsWins}-${atsLosses}-${atsPushes})`);
    log(`High Conv: PL ${highConvictionSummary.spread.winPct}% (${hcAtsWins}-${hcAtsLosses}-${hcAtsPushes})`);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        logs,
        gamesFound: allGames.length,
        gamesWithOdds: backtestResults.length,
        oddsMissing,
        summary,
        highConvictionSummary,
        sampleResults: backtestResults.slice(0, 5),
      });
    }

    // Save odds to Firestore
    if (newOdds.length > 0) {
      log(`Saving ${newOdds.length} new odds records to Firestore...`);
      const oddsDocs = newOdds.map(o => ({ id: o.id, data: o.data as unknown as Record<string, unknown> }));
      await saveDocsBatch(sport, 'oddsLocks', oddsDocs);
    }

    // Save results to Firestore
    if (backtestResults.length > 0) {
      const resultDocs = backtestResults.map(r => ({ id: r.gameId, data: r as unknown as Record<string, unknown> }));
      await saveDocsBatch(sport, 'results', resultDocs);
    }

    // Update blob with results
    const sortedTeams = Array.from(teamsMap.values()).sort((a, b) => b.eloRating - a.eloRating);

    const newBlobData = {
      generated: new Date().toISOString(),
      teams: sortedTeams,
      processedGameIds: backtestResults.map(r => r.gameId),
      historicalOdds,
      games: blobData?.games || [],
      recentGames: backtestResults.slice(-10).reverse(),
      backtest: {
        summary,
        highConvictionSummary,
        results: backtestResults,
      },
    };

    await put(NHL_BLOB_NAME, JSON.stringify(newBlobData), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Update Firestore state (season 2026 = 2025-2026 season)
    await setSportState(sport, {
      season: 2026,
      processedGameIds: backtestResults.map(r => r.gameId),
      backtestSummary: summary,
      lastSyncAt: new Date().toISOString(),
    });

    log('Done!');

    return NextResponse.json({
      success: true,
      logs,
      gamesFound: allGames.length,
      gamesWithOdds: backtestResults.length,
      newOddsAdded: newOdds.length,
      summary,
      highConvictionSummary,
      nextOffset: offset + batchSize,
      hasMore: batchEndDate < endDate,
    });

  } catch (error) {
    console.error('NHL backfill error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}
