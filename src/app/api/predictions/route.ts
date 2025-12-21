import { NextResponse } from 'next/server';
import { getUpcomingGames, getAllTeams, getPredictionForGame, savePrediction, getOddsForGame } from '@/services/database';
import { predictGameWithStats, calculateEdge, getEdgeStrength, getBetRecommendation } from '@/services/elo';
import { fetchWeatherForVenue } from '@/services/weather';
import { getConsensusOdds } from '@/services/odds';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get('gameId');

  if (!gameId) {
    return NextResponse.json({ error: 'gameId required' }, { status: 400 });
  }

  try {
    const prediction = await getPredictionForGame(gameId);

    if (!prediction) {
      return NextResponse.json({ error: 'No prediction found' }, { status: 404 });
    }

    return NextResponse.json({ prediction });
  } catch (error) {
    console.error('Error fetching prediction:', error);
    return NextResponse.json({ error: 'Failed to fetch prediction' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get('gameId');

  try {
    const games = gameId
      ? [await import('@/services/database').then(m => m.getGame(gameId))].filter(Boolean)
      : await getUpcomingGames('nfl');

    const teams = await getAllTeams('nfl');
    const teamsMap = new Map(teams.map(t => [t.id, t]));

    const predictions = [];

    for (const game of games) {
      if (!game) continue;

      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);

      if (!homeTeam || !awayTeam) continue;

      // Fetch weather for outdoor games
      let weather = null;
      if (game.venue) {
        weather = await fetchWeatherForVenue(game.venue, game.gameTime);
      }

      // Generate prediction using stats + Elo
      const prediction = predictGameWithStats(homeTeam, awayTeam, weather);

      // Get odds and calculate edge
      const odds = await getOddsForGame(game.id);
      const consensus = getConsensusOdds(odds);

      let edgeData = {};
      if (consensus && consensus.homeSpread !== undefined && consensus.total !== undefined) {
        const edge = calculateEdge(prediction, consensus.homeSpread, consensus.total);
        const recommendation = getBetRecommendation(
          edge.edgeSpread,
          edge.edgeTotal,
          prediction.homeWinProbability || 0.5
        );

        edgeData = {
          edgeSpread: edge.edgeSpread,
          edgeTotal: edge.edgeTotal,
          edgeSpreadStrength: getEdgeStrength(edge.edgeSpread),
          edgeTotalStrength: getEdgeStrength(edge.edgeTotal),
          recommendedBet: recommendation,
          vegasSpread: consensus.homeSpread,
          vegasTotal: consensus.total,
        };
      }

      const fullPrediction = {
        ...prediction,
        ...edgeData,
        gameId: game.id,
      };

      await savePrediction(fullPrediction);
      predictions.push({
        game: {
          ...game,
          homeTeam,
          awayTeam,
        },
        prediction: fullPrediction,
      });
    }

    return NextResponse.json({
      message: `Generated ${predictions.length} predictions`,
      predictions
    });
  } catch (error) {
    console.error('Error generating predictions:', error);
    return NextResponse.json({ error: 'Failed to generate predictions' }, { status: 500 });
  }
}
