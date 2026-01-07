'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface Team {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;       // Goals per game
  ppgAllowed?: number; // Goals allowed
  gamesPlayed?: number;
}

interface Game {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: Team;
  awayTeam?: Team;
  gameTime: string;
  status: string;
  venue?: string;
}

interface CalcBreakdown {
  homeGPG: number;
  homeGPGAllowed: number;
  awayGPG: number;
  awayGPGAllowed: number;
  regHomeGPG: number;
  regHomeGPGAllowed: number;
  regAwayGPG: number;
  regAwayGPGAllowed: number;
  baseHomeScore: number;
  baseAwayScore: number;
  homeElo: number;
  awayElo: number;
  eloDiff: number;
  eloAdj: number;
  homeIceAdv: number;
}

interface Prediction {
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProbability: number;
  confidence: number;
  vegasSpread?: number;
  vegasTotal?: number;
  edgeSpread?: number;
  edgeTotal?: number;
  calc?: CalcBreakdown;
  atsConfidence?: 'high' | 'medium' | 'low';
  ouConfidence?: 'high' | 'medium' | 'low';
  mlConfidence?: 'high' | 'medium' | 'low';
  isAtsBestBet?: boolean;
  isOuBestBet?: boolean;
  isMlBestBet?: boolean;
  mlEdge?: number;
  totalEdge?: number;
}

// Constants from NHL sync route
const LEAGUE_AVG_GPG = 3.1;
const ELO_TO_POINTS = 0.018;
const HOME_ICE_ADVANTAGE = 0.25;
const ELO_HOME_ADVANTAGE = 48;

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nhl/500-dark/${abbr.toLowerCase()}.png`;
};

export default function NHLGameDetailPage() {
  const params = useParams();
  const gameId = params.id as string;

  const [game, setGame] = useState<Game | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/nhl-prediction-data.json', { cache: 'no-cache' });
        const data = await res.json();
        const teamsArray: Team[] = data.teams || [];

        // Find game in upcoming games
        const found = (data.games || []).find((g: { game: Game; prediction: Prediction }) => g.game.id === gameId);
        if (found) {
          const homeTeamFull = teamsArray.find(t => t.id === found.game.homeTeamId);
          const awayTeamFull = teamsArray.find(t => t.id === found.game.awayTeamId);
          setGame({
            ...found.game,
            homeTeam: homeTeamFull || found.game.homeTeam,
            awayTeam: awayTeamFull || found.game.awayTeam,
          });
          setPrediction(found.prediction);
        } else {
          // Check backtest results for completed games
          const backtestResult = (data.backtest?.results || []).find((r: { gameId: string }) => r.gameId === gameId);
          if (backtestResult) {
            const homeTeam = teamsArray.find(t => t.abbreviation === backtestResult.homeTeam);
            const awayTeam = teamsArray.find(t => t.abbreviation === backtestResult.awayTeam);
            setGame({
              id: backtestResult.gameId,
              homeTeamId: homeTeam?.id || '',
              awayTeamId: awayTeam?.id || '',
              homeTeam: homeTeam || { id: '', name: backtestResult.homeTeam, abbreviation: backtestResult.homeTeam, eloRating: backtestResult.homeElo },
              awayTeam: awayTeam || { id: '', name: backtestResult.awayTeam, abbreviation: backtestResult.awayTeam, eloRating: backtestResult.awayElo },
              gameTime: backtestResult.gameTime,
              status: 'final',
            });
            setPrediction({
              predictedHomeScore: backtestResult.predictedHomeScore,
              predictedAwayScore: backtestResult.predictedAwayScore,
              predictedSpread: backtestResult.predictedSpread,
              predictedTotal: backtestResult.predictedTotal,
              homeWinProbability: backtestResult.homeWinProb,
              confidence: 0.5,
            });
          }
        }
      } catch (error) {
        console.error('Error fetching game:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [gameId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!game || !game.homeTeam || !game.awayTeam) {
    return (
      <div className="text-center py-12 text-gray-400">
        Game not found
      </div>
    );
  }

  const home = game.homeTeam;
  const away = game.awayTeam;

  // Use stored calc values if available, otherwise calculate locally
  const calc = prediction?.calc;

  // Team stats - prefer stored calc values, fallback to current team data
  // NHL uses ppg/ppgAllowed for goals per game
  const homeGPG = calc?.homeGPG ?? home.ppg ?? LEAGUE_AVG_GPG;
  const homeGPGAllowed = calc?.homeGPGAllowed ?? home.ppgAllowed ?? LEAGUE_AVG_GPG;
  const awayGPG = calc?.awayGPG ?? away.ppg ?? LEAGUE_AVG_GPG;
  const awayGPGAllowed = calc?.awayGPGAllowed ?? away.ppgAllowed ?? LEAGUE_AVG_GPG;
  const homeElo = calc?.homeElo ?? home.eloRating ?? 1500;
  const awayElo = calc?.awayElo ?? away.eloRating ?? 1500;

  // Regression toward mean (30%)
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_GPG * 0.3;
  const regHomeGPG = calc?.regHomeGPG ?? regress(homeGPG);
  const regHomeGPGAllowed = calc?.regHomeGPGAllowed ?? regress(homeGPGAllowed);
  const regAwayGPG = calc?.regAwayGPG ?? regress(awayGPG);
  const regAwayGPGAllowed = calc?.regAwayGPGAllowed ?? regress(awayGPGAllowed);

  // Base scores from matchup
  const baseHomeScore = calc?.baseHomeScore ?? (regHomeGPG + regAwayGPGAllowed) / 2;
  const baseAwayScore = calc?.baseAwayScore ?? (regAwayGPG + regHomeGPGAllowed) / 2;

  // Elo adjustment
  const eloDiff = calc?.eloDiff ?? homeElo - awayElo;
  const eloAdj = calc?.eloAdj ?? (eloDiff * ELO_TO_POINTS) / 2;

  // Final scores - use prediction values (they're the source of truth)
  const finalHomeScore = prediction?.predictedHomeScore ?? (baseHomeScore + eloAdj + HOME_ICE_ADVANTAGE / 2);
  const finalAwayScore = prediction?.predictedAwayScore ?? (baseAwayScore - eloAdj - HOME_ICE_ADVANTAGE / 2);
  const predictedTotal = prediction?.predictedTotal ?? (finalHomeScore + finalAwayScore);

  // Win probability
  const adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
  const homeWinProb = 1 / (1 + Math.pow(10, (awayElo - adjustedHomeElo) / 400));

  // Edge calculations - use prediction values
  const vegasSpread = prediction?.vegasSpread;
  const vegasTotal = prediction?.vegasTotal;
  const actualSpread = prediction?.predictedSpread ?? (finalAwayScore - finalHomeScore);
  const actualTotal = predictedTotal;
  const spreadEdge = vegasSpread !== undefined ? vegasSpread - actualSpread : 0;
  const totalEdge = vegasTotal !== undefined ? actualTotal - vegasTotal : 0;

  const formatNum = (n: number, decimals = 2) => n.toFixed(decimals);
  const formatSpread = (s: number) => (s > 0 ? `+${formatNum(s)}` : formatNum(s));

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header - Compact */}
      <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <img src={getLogoUrl(away.abbreviation)} alt={away.abbreviation} className="w-12 h-12 mx-auto mb-1" />
            <div className="font-bold text-lg text-gray-900">{away.abbreviation}</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-mono font-bold text-gray-900">
              {prediction ? `${formatNum(prediction.predictedAwayScore, 1)}-${formatNum(prediction.predictedHomeScore, 1)}` : '—'}
            </div>
            <div className="text-gray-500 text-sm">Predicted</div>
          </div>
          <div className="text-center">
            <img src={getLogoUrl(home.abbreviation)} alt={home.abbreviation} className="w-12 h-12 mx-auto mb-1" />
            <div className="font-bold text-lg text-gray-900">{home.abbreviation}</div>
          </div>
        </div>
        <div className="text-center text-gray-500 text-sm mt-2">
          {new Date(game.gameTime).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          {game.venue && ` • ${game.venue}`}
        </div>
      </div>

      {/* Betting Analysis - NOW AT TOP */}
      <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <h2 className="text-lg font-bold mb-3 text-gray-900">Betting Analysis</h2>
        <div className="grid grid-cols-3 gap-3">
          {/* Puck Line */}
          <div className="bg-gray-50 rounded p-3 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-gray-500 uppercase text-xs font-semibold">Puck Line</div>
              {prediction?.atsConfidence === 'high' && (
                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded">HIGH</span>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Our Line</span>
                <span className="font-mono text-gray-900">{home.abbreviation} {formatSpread(actualSpread)}</span>
              </div>
              {vegasSpread !== undefined && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Vegas</span>
                    <span className="font-mono text-gray-900">{home.abbreviation} {formatSpread(vegasSpread)}</span>
                  </div>
                  <div className={`mt-2 p-2 rounded text-center ${Math.abs(spreadEdge) >= 1.5 ? 'bg-green-100 border border-green-300' : 'bg-gray-100 border border-gray-200'}`}>
                    <div className="font-mono text-lg text-gray-900">{formatSpread(spreadEdge)}</div>
                    <div className="text-xs font-medium text-gray-700">
                      {spreadEdge > 0 ? `Pick ${home.abbreviation}` : `Pick ${away.abbreviation}`}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Moneyline */}
          <div className="bg-gray-50 rounded p-3 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-gray-500 uppercase text-xs font-semibold">Moneyline</div>
              {prediction?.mlConfidence === 'high' && (
                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded">HIGH</span>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{away.abbreviation}</span>
                <span className="font-mono text-gray-900">{formatNum((1 - homeWinProb) * 100, 0)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{home.abbreviation}</span>
                <span className="font-mono text-gray-900">{formatNum(homeWinProb * 100, 0)}%</span>
              </div>
              {(() => {
                const mlEdge = prediction?.mlEdge ?? Math.abs(homeWinProb - 0.5) * 100;
                const isHighConf = mlEdge >= 15;
                return (
                  <div className={`mt-2 p-2 rounded text-center ${isHighConf ? 'bg-green-100 border border-green-300' : 'bg-gray-100 border border-gray-200'}`}>
                    <div className="font-mono text-lg text-gray-900">{formatNum(mlEdge, 0)}% edge</div>
                    <div className="text-xs font-medium text-gray-700">
                      Pick {homeWinProb > 0.5 ? home.abbreviation : away.abbreviation}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Total */}
          <div className="bg-gray-50 rounded p-3 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-gray-500 uppercase text-xs font-semibold">Total</div>
              {prediction?.ouConfidence === 'high' && (
                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded">HIGH</span>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Our Total</span>
                <span className="font-mono text-gray-900">{formatNum(actualTotal)}</span>
              </div>
              {vegasTotal !== undefined && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Vegas</span>
                    <span className="font-mono text-gray-900">{vegasTotal}</span>
                  </div>
                  <div className={`mt-2 p-2 rounded text-center ${Math.abs(totalEdge) >= 0.5 ? 'bg-green-100 border border-green-300' : 'bg-gray-100 border border-gray-200'}`}>
                    <div className="font-mono text-lg text-gray-900">{formatSpread(totalEdge)}</div>
                    <div className="text-xs font-medium text-gray-700">
                      {totalEdge > 0 ? `Pick OVER ${vegasTotal}` : `Pick UNDER ${vegasTotal}`}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Team Stats - Compact inline */}
      <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <h2 className="text-lg font-bold mb-2 text-gray-900">Team Stats</h2>
        <div className="grid grid-cols-4 gap-2 text-sm">
          <div className="text-gray-500">Team</div>
          <div className="text-center text-gray-500">Elo</div>
          <div className="text-center text-gray-500">GPG</div>
          <div className="text-center text-gray-500">Allowed</div>

          <div className="font-semibold text-gray-900">{away.abbreviation}</div>
          <div className="text-center font-mono text-gray-900">{awayElo}</div>
          <div className="text-center font-mono text-gray-900">{formatNum(awayGPG)}</div>
          <div className="text-center font-mono text-gray-900">{formatNum(awayGPGAllowed)}</div>

          <div className="font-semibold text-gray-900">{home.abbreviation}</div>
          <div className="text-center font-mono text-gray-900">{homeElo}</div>
          <div className="text-center font-mono text-gray-900">{formatNum(homeGPG)}</div>
          <div className="text-center font-mono text-gray-900">{formatNum(homeGPGAllowed)}</div>
        </div>
      </div>

      {/* Score Calculation - Condensed */}
      <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <h2 className="text-lg font-bold mb-3 text-gray-900">Score Calculation</h2>
        <div className="space-y-2 text-sm">
          {/* Step 1: Regression */}
          <div className="bg-gray-50 rounded p-3 border border-gray-200">
            <div className="text-gray-700 font-semibold mb-1">1. Regress to League Average (30%)</div>
            <div className="grid grid-cols-2 gap-2 font-mono text-gray-600">
              <div>{away.abbreviation}: {formatNum(awayGPG)} → <span className="text-gray-900">{formatNum(regAwayGPG)}</span></div>
              <div>{home.abbreviation}: {formatNum(homeGPG)} → <span className="text-gray-900">{formatNum(regHomeGPG)}</span></div>
            </div>
          </div>

          {/* Step 2: Base Scores */}
          <div className="bg-gray-50 rounded p-3 border border-gray-200">
            <div className="text-gray-700 font-semibold mb-1">2. Base Scores (Offense vs Defense)</div>
            <div className="font-mono text-gray-600">
              {away.abbreviation}: <span className="text-gray-900">{formatNum(baseAwayScore)}</span> | {home.abbreviation}: <span className="text-gray-900">{formatNum(baseHomeScore)}</span>
            </div>
          </div>

          {/* Step 3: Elo Adjustment */}
          <div className="bg-gray-50 rounded p-3 border border-gray-200">
            <div className="text-gray-700 font-semibold mb-1">3. Elo Adjustment</div>
            <div className="font-mono text-gray-600">
              Diff: {eloDiff} → <span className="text-gray-900">{formatSpread(eloAdj)}</span> goals/team
            </div>
          </div>

          {/* Step 4: Home Ice */}
          <div className="bg-gray-50 rounded p-3 border border-gray-200">
            <div className="text-gray-700 font-semibold mb-1">4. Home Ice Advantage</div>
            <div className="font-mono text-gray-600">
              +{formatNum(HOME_ICE_ADVANTAGE / 2)} to {home.abbreviation}, -{formatNum(HOME_ICE_ADVANTAGE / 2)} to {away.abbreviation}
            </div>
          </div>

          {/* Final Scores */}
          <div className="bg-gray-100 border border-gray-300 rounded p-3">
            <div className="text-gray-700 font-semibold mb-1">Final Predicted Scores</div>
            <div className="font-mono text-gray-900 text-lg">
              {away.abbreviation}: <span className="font-bold">{formatNum(finalAwayScore)}</span> | {home.abbreviation}: <span className="font-bold">{formatNum(finalHomeScore)}</span> | Total: <span className="font-bold">{formatNum(predictedTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Back link */}
      <div className="text-center py-2">
        <a href="/nhl" className="text-gray-600 hover:text-gray-800">
          ← Back to NHL Picks
        </a>
      </div>
    </div>
  );
}
