'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface Team {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;
  ppgAllowed?: number;
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
  homePPG: number;
  homePPGAllowed: number;
  awayPPG: number;
  awayPPGAllowed: number;
  regHomePPG: number;
  regHomePPGAllowed: number;
  regAwayPPG: number;
  regAwayPPGAllowed: number;
  baseHomeScore: number;
  baseAwayScore: number;
  homeElo: number;
  awayElo: number;
  eloDiff: number;
  eloAdj: number;
  homeCourtAdv: number;
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

// Constants from NBA sync route
const LEAGUE_AVG_PPG = 112;
const ELO_TO_POINTS = 0.06;
const HOME_COURT_ADVANTAGE = 2.0;
const ELO_HOME_ADVANTAGE = 48;

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;
};

export default function NBAGameDetailPage() {
  const params = useParams();
  const gameId = params.id as string;

  const [game, setGame] = useState<Game | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/nba-prediction-data.json', { cache: 'no-cache' });
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
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
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
  const homePPG = calc?.homePPG ?? home.ppg ?? LEAGUE_AVG_PPG;
  const homePPGAllowed = calc?.homePPGAllowed ?? home.ppgAllowed ?? LEAGUE_AVG_PPG;
  const awayPPG = calc?.awayPPG ?? away.ppg ?? LEAGUE_AVG_PPG;
  const awayPPGAllowed = calc?.awayPPGAllowed ?? away.ppgAllowed ?? LEAGUE_AVG_PPG;
  const homeElo = calc?.homeElo ?? home.eloRating ?? 1500;
  const awayElo = calc?.awayElo ?? away.eloRating ?? 1500;

  // Regression toward mean (30%)
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;
  const regHomePPG = calc?.regHomePPG ?? regress(homePPG);
  const regHomePPGAllowed = calc?.regHomePPGAllowed ?? regress(homePPGAllowed);
  const regAwayPPG = calc?.regAwayPPG ?? regress(awayPPG);
  const regAwayPPGAllowed = calc?.regAwayPPGAllowed ?? regress(awayPPGAllowed);

  // Base scores from matchup
  const baseHomeScore = calc?.baseHomeScore ?? (regHomePPG + regAwayPPGAllowed) / 2;
  const baseAwayScore = calc?.baseAwayScore ?? (regAwayPPG + regHomePPGAllowed) / 2;

  // Elo adjustment
  const eloDiff = calc?.eloDiff ?? homeElo - awayElo;
  const eloAdj = calc?.eloAdj ?? (eloDiff * ELO_TO_POINTS) / 2;

  // Final scores - use prediction values (they're the source of truth)
  const finalHomeScore = prediction?.predictedHomeScore ?? (baseHomeScore + eloAdj + HOME_COURT_ADVANTAGE / 2);
  const finalAwayScore = prediction?.predictedAwayScore ?? (baseAwayScore - eloAdj - HOME_COURT_ADVANTAGE / 2);
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

  const formatNum = (n: number, decimals = 1) => n.toFixed(decimals);
  const formatSpread = (s: number) => (s > 0 ? `+${formatNum(s)}` : formatNum(s));

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-lg p-8 border border-gray-200 shadow-sm">
        <div className="flex items-center justify-center gap-12 mb-6">
          <div className="text-center">
            <img src={getLogoUrl(away.abbreviation)} alt={away.abbreviation} className="w-20 h-20 mx-auto mb-3" />
            <div className="font-bold text-2xl text-gray-900">{away.abbreviation}</div>
            <div className="text-gray-500">{away.name}</div>
          </div>
          <div className="text-center">
            <div className="text-5xl font-mono font-bold text-gray-900">
              {prediction ? `${Math.round(prediction.predictedAwayScore)}-${Math.round(prediction.predictedHomeScore)}` : '—'}
            </div>
            <div className="text-gray-500 mt-2">Predicted Score</div>
          </div>
          <div className="text-center">
            <img src={getLogoUrl(home.abbreviation)} alt={home.abbreviation} className="w-20 h-20 mx-auto mb-3" />
            <div className="font-bold text-2xl text-gray-900">{home.abbreviation}</div>
            <div className="text-gray-500">{home.name}</div>
          </div>
        </div>
        <div className="text-center text-gray-500">
          {new Date(game.gameTime).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          {game.venue && ` • ${game.venue}`}
        </div>
      </div>

      {/* Team Stats */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
        <h2 className="text-xl font-bold mb-4 text-gray-900">Team Stats</h2>
        <table className="w-full">
          <thead className="text-gray-500 border-b border-gray-200">
            <tr>
              <th className="py-3 text-left text-base">Stat</th>
              <th className="py-3 text-center text-base">{away.abbreviation}</th>
              <th className="py-3 text-center text-base">{home.abbreviation}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-3 text-gray-600">Elo Rating</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{awayElo}</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{homeElo}</td>
            </tr>
            <tr>
              <td className="py-3 text-gray-600">Points Per Game</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{formatNum(awayPPG)}</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{formatNum(homePPG)}</td>
            </tr>
            <tr>
              <td className="py-3 text-gray-600">Points Allowed</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{formatNum(awayPPGAllowed)}</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{formatNum(homePPGAllowed)}</td>
            </tr>
            <tr>
              <td className="py-3 text-gray-600">Games Played</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{away.gamesPlayed || '—'}</td>
              <td className="py-3 text-center font-mono text-lg text-gray-900">{home.gamesPlayed || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Score Calculation */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
        <h2 className="text-xl font-bold mb-4 text-gray-900">Score Calculation</h2>

        <div className="space-y-4">
          {/* Step 1: Regression */}
          <div className="bg-gray-50 rounded p-4 border border-gray-200">
            <div className="text-blue-600 font-semibold text-lg mb-2">Step 1: Regress Stats to League Average (30%)</div>
            <div className="text-gray-600 mb-3">
              We regress each team's stats 30% toward league average ({LEAGUE_AVG_PPG} PPG) to account for small sample sizes.
            </div>
            <div className="grid grid-cols-2 gap-4 font-mono">
              <div className="space-y-1">
                <div className="text-gray-600">{away.abbreviation} PPG: {formatNum(awayPPG)} → <span className="text-gray-900 font-semibold">{formatNum(regAwayPPG)}</span></div>
                <div className="text-gray-600">{away.abbreviation} Allowed: {formatNum(awayPPGAllowed)} → <span className="text-gray-900 font-semibold">{formatNum(regAwayPPGAllowed)}</span></div>
              </div>
              <div className="space-y-1">
                <div className="text-gray-600">{home.abbreviation} PPG: {formatNum(homePPG)} → <span className="text-gray-900 font-semibold">{formatNum(regHomePPG)}</span></div>
                <div className="text-gray-600">{home.abbreviation} Allowed: {formatNum(homePPGAllowed)} → <span className="text-gray-900 font-semibold">{formatNum(regHomePPGAllowed)}</span></div>
              </div>
            </div>
          </div>

          {/* Step 2: Base Scores */}
          <div className="bg-gray-50 rounded p-4 border border-gray-200">
            <div className="text-blue-600 font-semibold text-lg mb-2">Step 2: Calculate Base Scores from Matchup</div>
            <div className="text-gray-600 mb-3">
              Each team's score = average of their offense vs opponent's defense.
            </div>
            <div className="font-mono space-y-2">
              <div className="text-gray-600">
                {home.abbreviation} Base = ({formatNum(regHomePPG)} + {formatNum(regAwayPPGAllowed)}) / 2 = <span className="text-gray-900 text-xl font-semibold">{formatNum(baseHomeScore)}</span>
              </div>
              <div className="text-gray-600">
                {away.abbreviation} Base = ({formatNum(regAwayPPG)} + {formatNum(regHomePPGAllowed)}) / 2 = <span className="text-gray-900 text-xl font-semibold">{formatNum(baseAwayScore)}</span>
              </div>
            </div>
          </div>

          {/* Step 3: Elo Adjustment */}
          <div className="bg-gray-50 rounded p-4 border border-gray-200">
            <div className="text-blue-600 font-semibold text-lg mb-2">Step 3: Elo Adjustment</div>
            <div className="text-gray-600 mb-3">
              Based on calibration: 100 Elo difference = {formatNum(ELO_TO_POINTS * 100)} points. Split between teams.
            </div>
            <div className="font-mono space-y-2">
              <div className="text-gray-600">
                Elo Diff = {homeElo} - {awayElo} = <span className="text-gray-900 text-xl font-semibold">{eloDiff}</span>
              </div>
              <div className="text-gray-600">
                Adjustment = {eloDiff} × {ELO_TO_POINTS} / 2 = <span className="text-gray-900 text-xl font-semibold">{formatSpread(eloAdj)}</span> per team
              </div>
            </div>
          </div>

          {/* Step 4: Home Court */}
          <div className="bg-gray-50 rounded p-4 border border-gray-200">
            <div className="text-blue-600 font-semibold text-lg mb-2">Step 4: Home Court Advantage</div>
            <div className="text-gray-600 mb-3">
              Based on calibration: home teams score {formatNum(HOME_COURT_ADVANTAGE)} more points on average.
            </div>
            <div className="font-mono">
              <div className="text-gray-600">
                Split: <span className="text-gray-900 font-semibold">+{formatNum(HOME_COURT_ADVANTAGE / 2)}</span> to home, <span className="text-gray-900 font-semibold">-{formatNum(HOME_COURT_ADVANTAGE / 2)}</span> to away
              </div>
            </div>
          </div>

          {/* Final Scores */}
          <div className="bg-blue-50 border border-blue-200 rounded p-4">
            <div className="text-blue-600 font-semibold text-lg mb-3">Final Predicted Scores</div>
            <div className="font-mono space-y-2">
              <div className="text-gray-600 text-lg">
                {home.abbreviation} = {formatNum(baseHomeScore)} + {formatSpread(eloAdj)} + {formatNum(HOME_COURT_ADVANTAGE / 2)} = <span className="text-gray-900 text-2xl font-bold">{formatNum(finalHomeScore)}</span>
              </div>
              <div className="text-gray-600 text-lg">
                {away.abbreviation} = {formatNum(baseAwayScore)} - {formatNum(Math.abs(eloAdj))} - {formatNum(HOME_COURT_ADVANTAGE / 2)} = <span className="text-gray-900 text-2xl font-bold">{formatNum(finalAwayScore)}</span>
              </div>
              <div className="text-gray-600 text-lg mt-2">
                Total = {formatNum(finalHomeScore)} + {formatNum(finalAwayScore)} = <span className="text-gray-900 font-bold">{formatNum(predictedTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Betting Analysis */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
        <h2 className="text-xl font-bold mb-4 text-gray-900">Betting Analysis</h2>

        <div className="grid grid-cols-3 gap-4">
          {/* Spread */}
          <div className="bg-gray-50 rounded p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="text-gray-500 uppercase font-semibold">Spread</div>
              {prediction?.atsConfidence === 'high' && (
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded">HIGH CONF</span>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-gray-500 text-sm">Our Line</div>
                <div className="font-mono text-xl text-gray-900">{home.abbreviation} {formatSpread(actualSpread)}</div>
              </div>
              {vegasSpread !== undefined && (
                <>
                  <div>
                    <div className="text-gray-500 text-sm">Vegas Line</div>
                    <div className="font-mono text-xl text-gray-900">{home.abbreviation} {formatSpread(vegasSpread)}</div>
                  </div>
                  <div className={`p-3 rounded ${Math.abs(spreadEdge) >= 2.5 ? 'bg-green-100 border border-green-300' : 'bg-gray-100 border border-gray-200'}`}>
                    <div className="text-gray-500 text-sm">Edge</div>
                    <div className="font-mono text-xl text-gray-900">{formatSpread(spreadEdge)} pts</div>
                    <div className="text-sm mt-2 font-medium text-gray-700">
                      {spreadEdge > 0
                        ? `Pick ${home.abbreviation} ${formatSpread(vegasSpread)}`
                        : `Pick ${away.abbreviation} ${formatSpread(-vegasSpread)}`
                      }
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Moneyline */}
          <div className="bg-gray-50 rounded p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="text-gray-500 uppercase font-semibold">Moneyline</div>
              {prediction?.mlConfidence === 'high' && (
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded">HIGH CONF</span>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-gray-500 text-sm">{home.abbreviation} Win Prob</div>
                <div className="font-mono text-xl text-gray-900">{formatNum(homeWinProb * 100, 0)}%</div>
              </div>
              <div>
                <div className="text-gray-500 text-sm">{away.abbreviation} Win Prob</div>
                <div className="font-mono text-xl text-gray-900">{formatNum((1 - homeWinProb) * 100, 0)}%</div>
              </div>
              {(() => {
                const mlEdge = prediction?.mlEdge ?? Math.abs(homeWinProb - 0.5) * 100;
                const isHighConf = mlEdge >= 15;
                return (
                  <div className={`p-3 rounded ${isHighConf ? 'bg-green-100 border border-green-300' : 'bg-gray-100 border border-gray-200'}`}>
                    <div className="text-gray-500 text-sm">Edge</div>
                    <div className="font-mono text-xl text-gray-900">{formatNum(mlEdge, 0)}%</div>
                    <div className="text-sm mt-2 font-medium text-gray-700">
                      Pick {homeWinProb > 0.5 ? home.abbreviation : away.abbreviation}
                    </div>
                    {isHighConf && (
                      <div className="text-xs text-green-600 mt-1">High confidence at 15%+ edge</div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Total */}
          <div className="bg-gray-50 rounded p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="text-gray-500 uppercase font-semibold">Total</div>
              {prediction?.ouConfidence === 'high' && (
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded">HIGH CONF</span>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-gray-500 text-sm">Our Total</div>
                <div className="font-mono text-xl text-gray-900">{formatNum(actualTotal)}</div>
              </div>
              {vegasTotal !== undefined && (
                <>
                  <div>
                    <div className="text-gray-500 text-sm">Vegas Total</div>
                    <div className="font-mono text-xl text-gray-900">{vegasTotal}</div>
                  </div>
                  {(() => {
                    const ouEdge = Math.abs(totalEdge);
                    const isHighConf = ouEdge >= 5;
                    return (
                      <div className={`p-3 rounded ${isHighConf ? 'bg-green-100 border border-green-300' : 'bg-gray-100 border border-gray-200'}`}>
                        <div className="text-gray-500 text-sm">Edge</div>
                        <div className="font-mono text-xl text-gray-900">{formatSpread(totalEdge)} pts</div>
                        <div className="text-sm mt-2 font-medium text-gray-700">
                          {totalEdge > 0 ? `Pick OVER ${vegasTotal}` : `Pick UNDER ${vegasTotal}`}
                        </div>
                        {isHighConf && (
                          <div className="text-xs text-green-600 mt-1">High confidence at 5+ pt edge</div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Win Probability Calculation */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
        <h2 className="text-xl font-bold mb-4 text-gray-900">Win Probability Formula</h2>
        <div className="bg-gray-50 rounded p-4 font-mono border border-gray-200">
          <div className="text-gray-600 mb-3">Using Elo expected score formula:</div>
          <div className="text-gray-700 text-lg">
            P(home wins) = 1 / (1 + 10^((awayElo - homeElo - {ELO_HOME_ADVANTAGE}) / 400))
          </div>
          <div className="text-gray-700 text-lg mt-3">
            = 1 / (1 + 10^(({awayElo} - {homeElo} - {ELO_HOME_ADVANTAGE}) / 400))
          </div>
          <div className="text-gray-700 text-lg mt-3">
            = 1 / (1 + 10^({awayElo - homeElo - ELO_HOME_ADVANTAGE} / 400))
          </div>
          <div className="text-gray-900 text-2xl mt-3 font-bold">
            = {formatNum(homeWinProb * 100, 1)}%
          </div>
        </div>
      </div>

      {/* Back link */}
      <div className="text-center py-4">
        <a href="/nba" className="text-blue-600 hover:text-blue-700 text-lg">
          ← Back to NBA Picks
        </a>
      </div>
    </div>
  );
}
