import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchBlobData, type NFLData } from '@/lib/blob-data';

export const metadata: Metadata = {
  title: 'NFL Power Rankings - Elo Ratings',
  description:
    'NFL power rankings based on Elo ratings. See which teams are elite, contenders, and rebuilding based on data-driven analysis.',
  keywords: [
    'NFL power rankings',
    'NFL Elo ratings',
    'NFL team rankings',
    'football power rankings',
    'NFL tier list',
  ],
};

const getLogoUrl = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png`;

const tiers = [
  {
    name: 'ELITE',
    range: [1, 5] as const,
    color: 'bg-green-600',
    textColor: 'text-green-700',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  {
    name: 'CONTENDERS',
    range: [6, 12] as const,
    color: 'bg-blue-500',
    textColor: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  {
    name: 'MIDDLE PACK',
    range: [13, 20] as const,
    color: 'bg-gray-400',
    textColor: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
  },
  {
    name: 'REBUILDING',
    range: [21, 32] as const,
    color: 'bg-red-400',
    textColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
];

export default async function RankingsPage() {
  const data = await fetchBlobData<NFLData>('prediction-matrix-data.json');
  const teams = data?.teams || [];

  if (teams.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-500">Rankings data is not available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <h1 className="text-xl font-bold text-gray-900">Power Rankings</h1>
        <span className="text-sm text-gray-500">Based on Elo ratings</span>
      </div>

      {/* Tier Legend */}
      <div className="flex flex-wrap gap-2">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${tier.bgColor} border ${tier.borderColor}`}
          >
            <div className={`w-2 h-2 rounded-full ${tier.color}`} />
            <span className={`text-xs font-bold ${tier.textColor}`}>
              {tier.name}
            </span>
            <span className="text-xs text-gray-400">
              #{tier.range[0]}-{tier.range[1]}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {tiers.map((tier) => {
          const tierTeams = teams.filter(
            (_, i) => i + 1 >= tier.range[0] && i + 1 <= tier.range[1]
          );
          if (tierTeams.length === 0) return null;

          return (
            <div
              key={tier.name}
              className={`bg-white rounded-2xl border ${tier.borderColor} shadow-sm overflow-hidden`}
            >
              {/* Tier Header */}
              <div
                className={`${tier.bgColor} px-4 py-2.5 border-b ${tier.borderColor} flex items-center gap-2`}
              >
                <div className={`w-3 h-3 rounded-full ${tier.color}`} />
                <span className={`font-bold text-sm ${tier.textColor}`}>
                  {tier.name}
                </span>
                <span className="text-xs text-gray-400 ml-auto">
                  #{tier.range[0]}-{tier.range[1]}
                </span>
              </div>

              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-12">
                      Rank
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                      Team
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">
                      Elo
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                      PPG
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                      Opp PPG
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tierTeams.map((team) => {
                    const index = teams.indexOf(team);
                    const rank = index + 1;
                    return (
                      <tr
                        key={team.id}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/nfl/teams/${team.abbreviation.toLowerCase()}`}
                            className="block"
                          >
                            <span
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${tier.color} text-white`}
                            >
                              {rank}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/nfl/teams/${team.abbreviation.toLowerCase()}`}
                            className="flex items-center gap-3"
                          >
                            <img
                              src={getLogoUrl(team.abbreviation)}
                              alt=""
                              className="w-8 h-8 object-contain"
                            />
                            <div>
                              <span className="font-bold text-gray-900 hover:text-red-600">
                                {team.abbreviation}
                              </span>
                              <span className="text-gray-500 ml-2 hidden sm:inline">
                                {team.name}
                              </span>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono font-bold text-gray-900">
                            {team.eloRating}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600 hidden sm:table-cell">
                          {team.ppg?.toFixed(1) || '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600 hidden sm:table-cell">
                          {team.ppgAllowed?.toFixed(1) || '—'}
                        </td>
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
