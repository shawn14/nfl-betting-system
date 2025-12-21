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
}

// Constants from our calibrated model
const LEAGUE_AVG_PPG = 22;
const ELO_TO_POINTS = 0.0593; // 100 Elo = 5.93 points
const HOME_FIELD_ADVANTAGE = 2.28;
const ELO_HOME_ADVANTAGE = 48; // For win probability calculation

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png`;
};

export default function GameDetailPage() {
  const params = useParams();
  const gameId = params.id as string;

  const [game, setGame] = useState<Game | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch game
        const gamesRes = await fetch('/api/games?sport=nfl');
        const gamesData = await gamesRes.json();
        const foundGame = (gamesData.games || []).find((g: Game) => g.id === gameId);
        setGame(foundGame || null);

        // Fetch prediction
        const predRes = await fetch(`/api/predictions?gameId=${gameId}`);
        const predData = await predRes.json();
        setPrediction(predData.prediction || null);
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
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
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

  // Recalculate the math for display
  const homePPG = home.ppg || LEAGUE_AVG_PPG;
  const homePPGAllowed = home.ppgAllowed || LEAGUE_AVG_PPG;
  const awayPPG = away.ppg || LEAGUE_AVG_PPG;
  const awayPPGAllowed = away.ppgAllowed || LEAGUE_AVG_PPG;

  const homeElo = home.eloRating || 1500;
  const awayElo = away.eloRating || 1500;
  const eloDiff = homeElo - awayElo;

  // Regression toward mean (30%)
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;
  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  // Base scores from matchup
  const baseHomeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  const baseAwayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  // Elo adjustment
  const eloAdjustment = (eloDiff * ELO_TO_POINTS) / 2;

  // Final scores
  const finalHomeScore = baseHomeScore + eloAdjustment + HOME_FIELD_ADVANTAGE / 2;
  const finalAwayScore = baseAwayScore - eloAdjustment - HOME_FIELD_ADVANTAGE / 2;

  // Spread and total
  const ourSpread = finalAwayScore - finalHomeScore;
  const ourTotal = finalHomeScore + finalAwayScore;

  // Win probability
  const adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
  const homeWinProb = 1 / (1 + Math.pow(10, (awayElo - adjustedHomeElo) / 400));

  // Edge calculations
  const vegasSpread = prediction?.vegasSpread;
  const vegasTotal = prediction?.vegasTotal;
  const spreadEdge = vegasSpread !== undefined ? vegasSpread - ourSpread : 0;
  const totalEdge = vegasTotal !== undefined ? ourTotal - vegasTotal : 0;

  const formatNum = (n: number, decimals = 1) => n.toFixed(decimals);
  const formatSpread = (s: number) => (s > 0 ? `+${formatNum(s)}` : formatNum(s));

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-gray-900 rounded-lg p-8">
        <div className="flex items-center justify-center gap-12 mb-6">
          <div className="text-center">
            <img src={getLogoUrl(away.abbreviation)} alt={away.abbreviation} className="w-20 h-20 mx-auto mb-3" />
            <div className="font-bold text-2xl">{away.abbreviation}</div>
            <div className="text-gray-500">{away.name}</div>
          </div>
          <div className="text-center">
            <div className="text-5xl font-mono font-bold">
              {prediction ? `${Math.round(prediction.predictedAwayScore)}-${Math.round(prediction.predictedHomeScore)}` : '—'}
            </div>
            <div className="text-gray-500 mt-2">Predicted Score</div>
          </div>
          <div className="text-center">
            <img src={getLogoUrl(home.abbreviation)} alt={home.abbreviation} className="w-20 h-20 mx-auto mb-3" />
            <div className="font-bold text-2xl">{home.abbreviation}</div>
            <div className="text-gray-500">{home.name}</div>
          </div>
        </div>
        <div className="text-center text-gray-400">
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
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Team Stats</h2>
        <table className="w-full">
          <thead className="text-gray-500 border-b border-gray-800">
            <tr>
              <th className="py-3 text-left text-base">Stat</th>
              <th className="py-3 text-center text-base">{away.abbreviation}</th>
              <th className="py-3 text-center text-base">{home.abbreviation}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            <tr>
              <td className="py-3 text-gray-400">Elo Rating</td>
              <td className="py-3 text-center font-mono text-lg">{awayElo}</td>
              <td className="py-3 text-center font-mono text-lg">{homeElo}</td>
            </tr>
            <tr>
              <td className="py-3 text-gray-400">Points Per Game</td>
              <td className="py-3 text-center font-mono text-lg">{formatNum(awayPPG)}</td>
              <td className="py-3 text-center font-mono text-lg">{formatNum(homePPG)}</td>
            </tr>
            <tr>
              <td className="py-3 text-gray-400">Points Allowed</td>
              <td className="py-3 text-center font-mono text-lg">{formatNum(awayPPGAllowed)}</td>
              <td className="py-3 text-center font-mono text-lg">{formatNum(homePPGAllowed)}</td>
            </tr>
            <tr>
              <td className="py-3 text-gray-400">Games Played</td>
              <td className="py-3 text-center font-mono text-lg">{away.gamesPlayed || '—'}</td>
              <td className="py-3 text-center font-mono text-lg">{home.gamesPlayed || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Score Calculation */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Score Calculation</h2>

        <div className="space-y-4">
          {/* Step 1: Regression */}
          <div className="bg-gray-800 rounded p-4">
            <div className="text-emerald-400 font-semibold text-lg mb-2">Step 1: Regress Stats to League Average (30%)</div>
            <div className="text-gray-400 mb-3">
              We regress each team's stats 30% toward league average ({LEAGUE_AVG_PPG} PPG) to account for small sample sizes.
            </div>
            <div className="grid grid-cols-2 gap-4 font-mono">
              <div className="space-y-1">
                <div className="text-gray-300">{away.abbreviation} PPG: {formatNum(awayPPG)} → <span className="text-white">{formatNum(regAwayPPG)}</span></div>
                <div className="text-gray-300">{away.abbreviation} Allowed: {formatNum(awayPPGAllowed)} → <span className="text-white">{formatNum(regAwayPPGAllowed)}</span></div>
              </div>
              <div className="space-y-1">
                <div className="text-gray-300">{home.abbreviation} PPG: {formatNum(homePPG)} → <span className="text-white">{formatNum(regHomePPG)}</span></div>
                <div className="text-gray-300">{home.abbreviation} Allowed: {formatNum(homePPGAllowed)} → <span className="text-white">{formatNum(regHomePPGAllowed)}</span></div>
              </div>
            </div>
          </div>

          {/* Step 2: Base Scores */}
          <div className="bg-gray-800 rounded p-4">
            <div className="text-emerald-400 font-semibold text-lg mb-2">Step 2: Calculate Base Scores from Matchup</div>
            <div className="text-gray-400 mb-3">
              Each team's score = average of their offense vs opponent's defense.
            </div>
            <div className="font-mono space-y-2">
              <div className="text-gray-300">
                {home.abbreviation} Base = ({formatNum(regHomePPG)} + {formatNum(regAwayPPGAllowed)}) / 2 = <span className="text-white text-xl">{formatNum(baseHomeScore)}</span>
              </div>
              <div className="text-gray-300">
                {away.abbreviation} Base = ({formatNum(regAwayPPG)} + {formatNum(regHomePPGAllowed)}) / 2 = <span className="text-white text-xl">{formatNum(baseAwayScore)}</span>
              </div>
            </div>
          </div>

          {/* Step 3: Elo Adjustment */}
          <div className="bg-gray-800 rounded p-4">
            <div className="text-emerald-400 font-semibold text-lg mb-2">Step 3: Elo Adjustment</div>
            <div className="text-gray-400 mb-3">
              Based on calibration: 100 Elo difference = {formatNum(ELO_TO_POINTS * 100)} points. Split between teams.
            </div>
            <div className="font-mono space-y-2">
              <div className="text-gray-300">
                Elo Diff = {homeElo} - {awayElo} = <span className="text-white text-xl">{eloDiff}</span>
              </div>
              <div className="text-gray-300">
                Adjustment = {eloDiff} × {ELO_TO_POINTS} / 2 = <span className="text-white text-xl">{formatSpread(eloAdjustment)}</span> per team
              </div>
            </div>
          </div>

          {/* Step 4: Home Field */}
          <div className="bg-gray-800 rounded p-4">
            <div className="text-emerald-400 font-semibold text-lg mb-2">Step 4: Home Field Advantage</div>
            <div className="text-gray-400 mb-3">
              Based on calibration: home teams score {formatNum(HOME_FIELD_ADVANTAGE)} more points on average.
            </div>
            <div className="font-mono">
              <div className="text-gray-300">
                Split: <span className="text-white">+{formatNum(HOME_FIELD_ADVANTAGE / 2)}</span> to home, <span className="text-white">-{formatNum(HOME_FIELD_ADVANTAGE / 2)}</span> to away
              </div>
            </div>
          </div>

          {/* Final Scores */}
          <div className="bg-emerald-900/30 border border-emerald-800 rounded p-4">
            <div className="text-emerald-400 font-semibold text-lg mb-3">Final Predicted Scores</div>
            <div className="font-mono space-y-2">
              <div className="text-gray-300 text-lg">
                {home.abbreviation} = {formatNum(baseHomeScore)} + {formatSpread(eloAdjustment)} + {formatNum(HOME_FIELD_ADVANTAGE / 2)} = <span className="text-white text-2xl font-bold">{formatNum(finalHomeScore)}</span>
              </div>
              <div className="text-gray-300 text-lg">
                {away.abbreviation} = {formatNum(baseAwayScore)} - {formatNum(Math.abs(eloAdjustment))} - {formatNum(HOME_FIELD_ADVANTAGE / 2)} = <span className="text-white text-2xl font-bold">{formatNum(finalAwayScore)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Betting Analysis */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Betting Analysis</h2>

        <div className="grid grid-cols-3 gap-4">
          {/* Spread */}
          <div className="bg-gray-800 rounded p-4">
            <div className="text-gray-500 uppercase mb-3 font-semibold">Spread</div>
            <div className="space-y-3">
              <div>
                <div className="text-gray-400 text-sm">Our Line</div>
                <div className="font-mono text-xl">{home.abbreviation} {formatSpread(ourSpread)}</div>
              </div>
              {vegasSpread !== undefined && (
                <>
                  <div>
                    <div className="text-gray-400 text-sm">Vegas Line</div>
                    <div className="font-mono text-xl">{home.abbreviation} {formatSpread(vegasSpread)}</div>
                  </div>
                  <div className={`p-3 rounded ${Math.abs(spreadEdge) >= 2.5 ? 'bg-emerald-900/50' : 'bg-gray-700'}`}>
                    <div className="text-gray-400 text-sm">Edge</div>
                    <div className="font-mono text-xl">{formatSpread(spreadEdge)} pts</div>
                    <div className="text-sm mt-2 font-medium">
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
          <div className="bg-gray-800 rounded p-4">
            <div className="text-gray-500 uppercase mb-3 font-semibold">Moneyline</div>
            <div className="space-y-3">
              <div>
                <div className="text-gray-400 text-sm">{home.abbreviation} Win Prob</div>
                <div className="font-mono text-xl">{formatNum(homeWinProb * 100, 0)}%</div>
              </div>
              <div>
                <div className="text-gray-400 text-sm">{away.abbreviation} Win Prob</div>
                <div className="font-mono text-xl">{formatNum((1 - homeWinProb) * 100, 0)}%</div>
              </div>
              <div className={`p-3 rounded ${homeWinProb > 0.6 || homeWinProb < 0.4 ? 'bg-emerald-900/50' : 'bg-gray-700'}`}>
                <div className="text-gray-400 text-sm">Pick</div>
                <div className="font-mono text-xl font-medium">
                  {homeWinProb > 0.5 ? home.abbreviation : away.abbreviation}
                </div>
              </div>
            </div>
          </div>

          {/* Total */}
          <div className="bg-gray-800 rounded p-4">
            <div className="text-gray-500 uppercase mb-3 font-semibold">Total</div>
            <div className="space-y-3">
              <div>
                <div className="text-gray-400 text-sm">Our Total</div>
                <div className="font-mono text-xl">{formatNum(ourTotal)}</div>
              </div>
              {vegasTotal !== undefined && (
                <>
                  <div>
                    <div className="text-gray-400 text-sm">Vegas Total</div>
                    <div className="font-mono text-xl">{vegasTotal}</div>
                  </div>
                  <div className={`p-3 rounded ${Math.abs(totalEdge) >= 2.5 ? 'bg-emerald-900/50' : 'bg-gray-700'}`}>
                    <div className="text-gray-400 text-sm">Edge</div>
                    <div className="font-mono text-xl">{formatSpread(totalEdge)} pts</div>
                    <div className="text-sm mt-2 font-medium">
                      {totalEdge > 0 ? `Pick OVER ${vegasTotal}` : `Pick UNDER ${vegasTotal}`}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Win Probability Calculation */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Win Probability Formula</h2>
        <div className="bg-gray-800 rounded p-4 font-mono">
          <div className="text-gray-400 mb-3">Using Elo expected score formula:</div>
          <div className="text-gray-300 text-lg">
            P(home wins) = 1 / (1 + 10^((awayElo - homeElo - {ELO_HOME_ADVANTAGE}) / 400))
          </div>
          <div className="text-gray-300 text-lg mt-3">
            = 1 / (1 + 10^(({awayElo} - {homeElo} - {ELO_HOME_ADVANTAGE}) / 400))
          </div>
          <div className="text-gray-300 text-lg mt-3">
            = 1 / (1 + 10^({awayElo - homeElo - ELO_HOME_ADVANTAGE} / 400))
          </div>
          <div className="text-white text-2xl mt-3 font-bold">
            = {formatNum(homeWinProb * 100, 1)}%
          </div>
        </div>
      </div>

      {/* Back link */}
      <div className="text-center py-4">
        <a href="/" className="text-emerald-400 hover:text-emerald-300 text-lg">
          ← Back to Picks
        </a>
      </div>
    </div>
  );
}
