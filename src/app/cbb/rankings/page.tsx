'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Team {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;
  ppgAllowed?: number;
}

const getLogoUrl = (teamId: string | undefined) => {
  if (!teamId) {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/default.png`;
  }
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`;
};

export default function CBBRankingsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const res = await fetch('/cbb-prediction-data.json', { cache: 'no-cache' });
        const data = await res.json();
        setTeams(data.teams || []);
      } catch (error) {
        console.error('Error fetching teams:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchTeams();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Define tiers for CBB (30 teams)
  const tiers = [
    { name: 'ELITE', range: [1, 5], color: 'bg-green-600', textColor: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
    { name: 'CONTENDERS', range: [6, 12], color: 'bg-purple-500', textColor: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
    { name: 'PLAY-IN', range: [13, 20], color: 'bg-gray-400', textColor: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' },
    { name: 'LOTTERY', range: [21, 30], color: 'bg-red-400', textColor: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-200' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">CBB Power Rankings</h1>
          <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded">CBB</span>
        </div>
        <span className="text-sm text-gray-500">Based on Elo ratings</span>
      </div>

      {/* Tier Legend */}
      <div className="flex flex-wrap gap-2">
        {tiers.map(tier => (
          <div key={tier.name} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${tier.bgColor} border ${tier.borderColor}`}>
            <div className={`w-2 h-2 rounded-full ${tier.color}`} />
            <span className={`text-xs font-bold ${tier.textColor}`}>{tier.name}</span>
            <span className="text-xs text-gray-400">#{tier.range[0]}-{tier.range[1]}</span>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {tiers.map(tier => {
          const tierTeams = teams.filter((_, i) => (i + 1) >= tier.range[0] && (i + 1) <= tier.range[1]);
          if (tierTeams.length === 0) return null;

          return (
            <div key={tier.name} className={`bg-white rounded-2xl border ${tier.borderColor} shadow-sm overflow-hidden`}>
              {/* Tier Header */}
              <div className={`${tier.bgColor} px-4 py-2.5 border-b ${tier.borderColor} flex items-center gap-2`}>
                <div className={`w-3 h-3 rounded-full ${tier.color}`} />
                <span className={`font-bold text-sm ${tier.textColor}`}>{tier.name}</span>
                <span className="text-xs text-gray-400 ml-auto">#{tier.range[0]}-{tier.range[1]}</span>
              </div>

              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-12">Rank</th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Team</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Elo</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">PPG</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Opp PPG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tierTeams.map((team) => {
                    const index = teams.indexOf(team);
                    const rank = index + 1;
                    return (
                      <tr key={team.id} className="hover:bg-gray-50 transition-colors cursor-pointer">
                        <td className="px-4 py-3">
                          <Link href={`/nba/teams/${team.abbreviation.toLowerCase()}`} className="block">
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${tier.color} text-white`}>
                              {rank}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/nba/teams/${team.abbreviation.toLowerCase()}`} className="flex items-center gap-3">
                            <img src={getLogoUrl(team.id)} alt="" className="w-8 h-8 object-contain" />
                            <div>
                              <span className="font-bold text-gray-900 hover:text-purple-500">{team.abbreviation}</span>
                              <span className="text-gray-500 ml-2 hidden sm:inline">{team.name}</span>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono font-bold text-gray-900">{team.eloRating}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600 hidden sm:table-cell">{team.ppg?.toFixed(1) || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600 hidden sm:table-cell">{team.ppgAllowed?.toFixed(1) || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
