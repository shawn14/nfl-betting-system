import { NextResponse } from 'next/server';
import { getUpcomingGames, getAllTeams, getPredictionForGame, getOddsForGame } from '@/services/database';
import { getConsensusOdds } from '@/services/odds';
import { getEdgeStrength } from '@/services/elo';
import { Edge } from '@/types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minEdge = parseFloat(searchParams.get('minEdge') || '1.5');
  const sport = searchParams.get('sport') || 'nfl';

  try {
    const games = await getUpcomingGames(sport);
    const teams = await getAllTeams(sport);
    const teamsMap = new Map(teams.map(t => [t.id, t]));

    const edges: Edge[] = [];

    for (const game of games) {
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);

      if (!homeTeam || !awayTeam) continue;

      const prediction = await getPredictionForGame(game.id);
      if (!prediction) continue;

      const odds = await getOddsForGame(game.id);
      const consensus = getConsensusOdds(odds);
      if (!consensus) continue;

      const spreadEdge = prediction.edgeSpread || 0;
      const totalEdge = prediction.edgeTotal || 0;

      // Filter by minimum edge
      if (Math.abs(spreadEdge) < minEdge && Math.abs(totalEdge) < minEdge) {
        continue;
      }

      // Calculate moneyline value
      let moneylineValue = 0;
      if (consensus.homeMoneyline && prediction.homeWinProbability) {
        const impliedProb = consensus.homeMoneyline > 0
          ? 100 / (consensus.homeMoneyline + 100)
          : Math.abs(consensus.homeMoneyline) / (Math.abs(consensus.homeMoneyline) + 100);
        moneylineValue = prediction.homeWinProbability - impliedProb;
      }

      let recommendedBet: Edge['recommendedBet'];
      if (Math.abs(spreadEdge) >= Math.abs(totalEdge) && Math.abs(spreadEdge) >= minEdge) {
        recommendedBet = spreadEdge > 0 ? 'spread_home' : 'spread_away';
      } else if (Math.abs(totalEdge) >= minEdge) {
        recommendedBet = totalEdge > 0 ? 'over' : 'under';
      }

      edges.push({
        gameId: game.id,
        game: {
          ...game,
          homeTeam,
          awayTeam,
        },
        prediction,
        odds: {
          ...consensus,
          id: `consensus_${game.id}`,
          gameId: game.id,
          timestamp: new Date(),
        } as Edge['odds'],
        spreadEdge,
        totalEdge,
        moneylineValue: Math.round(moneylineValue * 100) / 100,
        recommendedBet,
        edgeStrength: getEdgeStrength(Math.max(Math.abs(spreadEdge), Math.abs(totalEdge))),
      });
    }

    // Sort by edge strength
    edges.sort((a, b) => {
      const aMaxEdge = Math.max(Math.abs(a.spreadEdge), Math.abs(a.totalEdge));
      const bMaxEdge = Math.max(Math.abs(b.spreadEdge), Math.abs(b.totalEdge));
      return bMaxEdge - aMaxEdge;
    });

    return NextResponse.json({
      edges,
      count: edges.length,
      filters: { minEdge, sport }
    });
  } catch (error) {
    console.error('Error fetching edges:', error);
    return NextResponse.json({ error: 'Failed to fetch edges' }, { status: 500 });
  }
}
