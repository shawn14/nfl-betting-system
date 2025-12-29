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

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nhl/500-dark/${abbr.toLowerCase()}.png`;
};

export default function NHLRankingsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const res = await fetch('/nhl-prediction-data.json', { cache: 'no-cache' });
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
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">NHL Power Rankings</h1>
          <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded">NHL</span>
        </div>
        <span className="text-sm text-gray-500">Based on Elo ratings</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-12">Rank</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Team</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Elo</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">GF/G</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">GA/G</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teams.map((team, index) => (
              <tr key={team.id} className="hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-4 py-3">
                  <Link href={`/nhl/teams/${team.abbreviation.toLowerCase()}`} className="block">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                      index < 3 ? 'bg-blue-500 text-white' :
                      index < 10 ? 'bg-gray-200 text-gray-700' : 'text-gray-400'
                    }`}>
                      {index + 1}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/nhl/teams/${team.abbreviation.toLowerCase()}`} className="flex items-center gap-3">
                    <img src={getLogoUrl(team.abbreviation)} alt="" className="w-8 h-8 object-contain" />
                    <div>
                      <span className="font-bold text-gray-900 hover:text-blue-500">{team.abbreviation}</span>
                      <span className="text-gray-500 ml-2 hidden sm:inline">{team.name}</span>
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono font-bold text-gray-900">{team.eloRating}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">{team.ppg?.toFixed(2) || '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">{team.ppgAllowed?.toFixed(2) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
