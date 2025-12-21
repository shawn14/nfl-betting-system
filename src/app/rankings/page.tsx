'use client';

import { useState, useEffect } from 'react';

interface Team {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;
  ppgAllowed?: number;
}

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png`;
};

export default function RankingsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        // Fetch from pre-computed blob (instant!)
        const res = await fetch('/prediction-data.json', { cache: 'no-cache' });
        const data = await res.json();
        // Teams are already sorted by Elo in the blob
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
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <h1 className="text-xl font-bold text-gray-900">Power Rankings</h1>
        <span className="text-sm text-gray-500">Based on Elo ratings</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-12">Rank</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Team</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Elo</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">PPG</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Opp PPG</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teams.map((team, index) => (
              <tr key={team.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    index < 3 ? 'bg-emerald-500 text-white' :
                    index < 10 ? 'bg-gray-200 text-gray-700' : 'text-gray-400'
                  }`}>
                    {index + 1}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <img src={getLogoUrl(team.abbreviation)} alt="" className="w-8 h-8 object-contain" />
                    <div>
                      <span className="font-bold text-gray-900">{team.abbreviation}</span>
                      <span className="text-gray-500 ml-2 hidden sm:inline">{team.name}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono font-bold text-gray-900">{team.eloRating}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">{team.ppg?.toFixed(1) || '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">{team.ppgAllowed?.toFixed(1) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
