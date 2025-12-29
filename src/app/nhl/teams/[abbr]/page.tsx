'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';

interface Team {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;
  ppgAllowed?: number;
}

interface BacktestResult {
  gameId: string;
  gameTime: string;
  homeTeam: string;
  awayTeam: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  actualHomeScore: number;
  actualAwayScore: number;
  atsResult?: 'win' | 'loss' | 'push';
  mlResult?: 'win' | 'loss';
  ouVegasResult?: 'win' | 'loss' | 'push';
  vegasSpread?: number;
  vegasTotal?: number;
}

interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  predictedHomeScore?: number;
  predictedAwayScore?: number;
  vegasSpread?: number;
  vegasTotal?: number;
  spreadPick?: string;
  totalPick?: string;
  homeWinProb?: number;
}

interface TeamRecord {
  ats: { wins: number; losses: number; pushes: number; winPct: number };
  ml: { wins: number; losses: number; winPct: number };
  ou: { wins: number; losses: number; pushes: number; winPct: number };
}

const NHL_TEAMS: Record<string, string> = {
  // Atlantic
  BOS: 'Boston Bruins', BUF: 'Buffalo Sabres', DET: 'Detroit Red Wings',
  FLA: 'Florida Panthers', MTL: 'Montreal Canadiens', OTT: 'Ottawa Senators',
  TB: 'Tampa Bay Lightning', TOR: 'Toronto Maple Leafs',
  // Metropolitan
  CAR: 'Carolina Hurricanes', CBJ: 'Columbus Blue Jackets', NJ: 'New Jersey Devils',
  NYI: 'New York Islanders', NYR: 'New York Rangers', PHI: 'Philadelphia Flyers',
  PIT: 'Pittsburgh Penguins', WSH: 'Washington Capitals',
  // Central
  ARI: 'Arizona Coyotes', CHI: 'Chicago Blackhawks', COL: 'Colorado Avalanche',
  DAL: 'Dallas Stars', MIN: 'Minnesota Wild', NSH: 'Nashville Predators',
  STL: 'St. Louis Blues', WPG: 'Winnipeg Jets', UTA: 'Utah Hockey Club',
  // Pacific
  ANA: 'Anaheim Ducks', CGY: 'Calgary Flames', EDM: 'Edmonton Oilers',
  LA: 'Los Angeles Kings', SEA: 'Seattle Kraken', SJ: 'San Jose Sharks',
  VAN: 'Vancouver Canucks', VGK: 'Vegas Golden Knights',
};

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nhl/500-dark/${abbr.toLowerCase()}.png`;
};

function computeTeamRecord(results: BacktestResult[], abbr: string): TeamRecord {
  let atsW = 0, atsL = 0, atsP = 0;
  let mlW = 0, mlL = 0;
  let ouW = 0, ouL = 0, ouP = 0;

  for (const r of results) {
    if (r.homeTeam !== abbr && r.awayTeam !== abbr) continue;

    if (r.atsResult) {
      if (r.atsResult === 'win') atsW++;
      else if (r.atsResult === 'loss') atsL++;
      else atsP++;
    }

    if (r.mlResult) {
      if (r.mlResult === 'win') mlW++;
      else mlL++;
    }

    if (r.ouVegasResult) {
      if (r.ouVegasResult === 'win') ouW++;
      else if (r.ouVegasResult === 'loss') ouL++;
      else ouP++;
    }
  }

  const atsTotal = atsW + atsL;
  const mlTotal = mlW + mlL;
  const ouTotal = ouW + ouL;

  return {
    ats: { wins: atsW, losses: atsL, pushes: atsP, winPct: atsTotal > 0 ? Math.round((atsW / atsTotal) * 1000) / 10 : 0 },
    ml: { wins: mlW, losses: mlL, winPct: mlTotal > 0 ? Math.round((mlW / mlTotal) * 1000) / 10 : 0 },
    ou: { wins: ouW, losses: ouL, pushes: ouP, winPct: ouTotal > 0 ? Math.round((ouW / ouTotal) * 1000) / 10 : 0 },
  };
}

export default function NHLTeamPage({ params }: { params: Promise<{ abbr: string }> }) {
  const { abbr: rawAbbr } = use(params);
  const abbr = rawAbbr.toUpperCase();
  const teamName = NHL_TEAMS[abbr] || abbr;

  const [team, setTeam] = useState<Team | null>(null);
  const [powerRank, setPowerRank] = useState<number>(0);
  const [record, setRecord] = useState<TeamRecord | null>(null);
  const [recentGames, setRecentGames] = useState<BacktestResult[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/nhl-prediction-data.json', { cache: 'no-cache' });
        const data = await res.json();

        const teams: Team[] = data.teams || [];
        const foundTeam = teams.find(t => t.abbreviation === abbr);

        if (!foundTeam) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        setTeam(foundTeam);
        setPowerRank(teams.findIndex(t => t.abbreviation === abbr) + 1);

        // Filter backtest results for this team
        const allResults: BacktestResult[] = data.backtest?.results || [];
        const teamResults = allResults.filter(r => r.homeTeam === abbr || r.awayTeam === abbr);
        teamResults.sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime());
        setRecentGames(teamResults.slice(0, 10));
        setRecord(computeTeamRecord(teamResults, abbr));

        // Filter upcoming games for this team
        const allGames: Game[] = data.games || [];
        const teamGames = allGames.filter(g => g.homeTeam === abbr || g.awayTeam === abbr);
        teamGames.sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());
        setUpcomingGames(teamGames.slice(0, 5));

      } catch (error) {
        console.error('Error fetching team data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [abbr]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Team Not Found</h1>
        <p className="text-gray-500 mb-4">The team &quot;{abbr}&quot; does not exist.</p>
        <Link href="/nhl/rankings" className="text-blue-500 hover:text-blue-600 font-medium">
          ← View all teams
        </Link>
      </div>
    );
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const ResultBadge = ({ result }: { result?: 'win' | 'loss' | 'push' }) => {
    if (!result) return <span className="text-gray-400">—</span>;
    const colors = {
      win: 'bg-green-600 text-white',
      loss: 'bg-red-500 text-white',
      push: 'bg-gray-400 text-white',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-bold ${colors[result]}`}>
        {result.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/nhl/rankings" className="hover:text-blue-500">Rankings</Link>
        <span className="mx-2">›</span>
        <span className="text-gray-900">{teamName}</span>
      </div>

      {/* Team Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-6">
          <img src={getLogoUrl(abbr)} alt={teamName} className="w-20 h-20 object-contain" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{teamName}</h1>
              <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded">NHL</span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm">
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                powerRank <= 3 ? 'bg-blue-500 text-white' :
                powerRank <= 10 ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-500'
              }`}>
                #{powerRank}
              </span>
              <span className="text-gray-600">Power Ranking</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold font-mono text-gray-900">{team?.eloRating}</div>
            <div className="text-sm text-gray-500">Elo Rating</div>
          </div>
        </div>
        {team && (
          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-100">
            <div>
              <div className="text-sm text-gray-500">Goals For Per Game</div>
              <div className="text-xl font-bold text-gray-900">{team.ppg?.toFixed(2) || '—'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Goals Against Per Game</div>
              <div className="text-xl font-bold text-gray-900">{team.ppgAllowed?.toFixed(2) || '—'}</div>
            </div>
          </div>
        )}
      </div>

      {/* Betting Record */}
      {record && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Betting Record</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-sm text-gray-500 mb-1">Puck Line</div>
              <div className="text-2xl font-bold text-gray-900">
                {record.ats.wins}-{record.ats.losses}
                {record.ats.pushes > 0 && <span className="text-gray-400">-{record.ats.pushes}</span>}
              </div>
              <div className={`text-lg font-mono font-bold ${record.ats.winPct > 52.4 ? 'text-green-600' : record.ats.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                {record.ats.winPct}%
              </div>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-sm text-gray-500 mb-1">Moneyline</div>
              <div className="text-2xl font-bold text-gray-900">
                {record.ml.wins}-{record.ml.losses}
              </div>
              <div className={`text-lg font-mono font-bold ${record.ml.winPct > 50 ? 'text-green-600' : 'text-red-500'}`}>
                {record.ml.winPct}%
              </div>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-sm text-gray-500 mb-1">Over/Under</div>
              <div className="text-2xl font-bold text-gray-900">
                {record.ou.wins}-{record.ou.losses}
                {record.ou.pushes > 0 && <span className="text-gray-400">-{record.ou.pushes}</span>}
              </div>
              <div className={`text-lg font-mono font-bold ${record.ou.winPct > 52.4 ? 'text-green-600' : record.ou.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                {record.ou.winPct}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Games */}
      {upcomingGames.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Upcoming Games</h2>
          <div className="space-y-3">
            {upcomingGames.map(game => {
              const isHome = game.homeTeam === abbr;
              const opponent = isHome ? game.awayTeam : game.homeTeam;
              return (
                <div key={game.id} className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <img src={getLogoUrl(opponent)} alt="" className="w-8 h-8" />
                    <div>
                      <div className="font-medium text-gray-900">
                        {isHome ? 'vs' : '@'} {opponent}
                      </div>
                      <div className="text-sm text-gray-500">{formatDate(game.gameTime)}</div>
                    </div>
                  </div>
                  {game.vegasSpread !== undefined && (
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Puck Line</div>
                      <div className="font-mono font-bold">
                        {isHome ? (game.vegasSpread > 0 ? '+' : '') + game.vegasSpread : (game.vegasSpread < 0 ? '+' : '') + (-game.vegasSpread)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Results */}
      {recentGames.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Results</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="pb-2 text-left font-medium">Game</th>
                  <th className="pb-2 text-center font-medium">Score</th>
                  <th className="pb-2 text-center font-medium">PL</th>
                  <th className="pb-2 text-center font-medium">ML</th>
                  <th className="pb-2 text-center font-medium">O/U</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentGames.map(game => {
                  const isHome = game.homeTeam === abbr;
                  const opponent = isHome ? game.awayTeam : game.homeTeam;
                  const teamScore = isHome ? game.actualHomeScore : game.actualAwayScore;
                  const oppScore = isHome ? game.actualAwayScore : game.actualHomeScore;
                  const won = teamScore > oppScore;
                  return (
                    <tr key={game.gameId}>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <img src={getLogoUrl(opponent)} alt="" className="w-6 h-6" />
                          <span className="text-gray-900">{isHome ? 'vs' : '@'} {opponent}</span>
                          <span className="text-gray-400 text-xs">{formatDate(game.gameTime)}</span>
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        <span className={`font-mono font-bold ${won ? 'text-green-600' : 'text-red-500'}`}>
                          {teamScore}-{oppScore}
                        </span>
                      </td>
                      <td className="py-3 text-center"><ResultBadge result={game.atsResult} /></td>
                      <td className="py-3 text-center"><ResultBadge result={game.mlResult} /></td>
                      <td className="py-3 text-center"><ResultBadge result={game.ouVegasResult} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
