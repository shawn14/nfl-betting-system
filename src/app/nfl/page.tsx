import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchBlobData, type NFLData, type GameWithPrediction } from '@/lib/blob-data';

export const metadata: Metadata = {
  title: 'NFL Predictions Today - Spread, Moneyline & Over/Under Picks',
  description:
    "Free NFL betting predictions powered by Elo ratings and statistical analysis. Get today's NFL spread picks, moneyline predictions, and over/under analysis.",
  keywords: [
    'NFL picks today',
    'NFL spread predictions',
    'NFL betting picks',
    'NFL moneyline picks',
    'NFL over under predictions',
    'free NFL picks',
    'NFL predictions against the spread',
    'NFL computer picks',
  ],
};

function formatGameTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function getLogoUrl(abbr: string) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png`;
}

function GameCard({ gp }: { gp: GameWithPrediction }) {
  const { game, prediction } = gp;
  const homeTeam = game.homeTeam;
  const awayTeam = game.awayTeam;
  if (!homeTeam || !awayTeam) return null;

  const spread = prediction.predictedSpread;
  const total = prediction.predictedTotal;
  const homeProb = (prediction.homeWinProbability * 100).toFixed(0);
  const awayProb = (100 - prediction.homeWinProbability * 100).toFixed(0);

  const hasVegas = prediction.vegasSpread !== undefined;
  const spreadEdge = hasVegas
    ? Math.abs(prediction.predictedSpread - prediction.vegasSpread!).toFixed(1)
    : null;
  const totalEdge =
    prediction.vegasTotal !== undefined
      ? Math.abs(prediction.predictedTotal - prediction.vegasTotal).toFixed(1)
      : null;

  const isBestBetAts = prediction.isAtsBestBet;
  const isBestBetOu = prediction.isOuBestBet;
  const isBestBetMl = prediction.isMlBestBet;
  const hasBestBet = isBestBetAts || isBestBetOu || isBestBetMl;

  return (
    <Link href={`/game/${game.id}`} className="block">
      <div
        className={`bg-white rounded-xl border ${
          hasBestBet
            ? 'border-green-300 ring-1 ring-green-100'
            : 'border-gray-200'
        } shadow-sm hover:shadow-md transition-shadow p-4`}
      >
        {/* Best bet badges */}
        {hasBestBet && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {isBestBetAts && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase">
                ATS Pick
              </span>
            )}
            {isBestBetMl && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase">
                ML Pick
              </span>
            )}
            {isBestBetOu && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase">
                O/U Pick
              </span>
            )}
          </div>
        )}

        {/* Game time */}
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-3">
          {formatGameTime(game.gameTime)}
          {prediction.week && (
            <span className="ml-2">Week {prediction.week}</span>
          )}
        </div>

        {/* Teams */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={getLogoUrl(awayTeam.abbreviation)}
                alt=""
                className="w-6 h-6 object-contain"
              />
              <span className="font-semibold text-gray-900 text-sm">
                {awayTeam.abbreviation}
              </span>
              <span className="text-xs text-gray-400">
                {awayTeam.eloRating}
              </span>
            </div>
            <div className="text-right">
              <span className="font-mono text-sm font-bold text-gray-900">
                {prediction.predictedAwayScore.toFixed(1)}
              </span>
              <span className="text-xs text-gray-400 ml-2">{awayProb}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={getLogoUrl(homeTeam.abbreviation)}
                alt=""
                className="w-6 h-6 object-contain"
              />
              <span className="font-semibold text-gray-900 text-sm">
                {homeTeam.abbreviation}
              </span>
              <span className="text-xs text-gray-400">
                {homeTeam.eloRating}
              </span>
            </div>
            <div className="text-right">
              <span className="font-mono text-sm font-bold text-gray-900">
                {prediction.predictedHomeScore.toFixed(1)}
              </span>
              <span className="text-xs text-gray-400 ml-2">{homeProb}%</span>
            </div>
          </div>
        </div>

        {/* Prediction details */}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
          <div className="text-center">
            <div className="text-[10px] text-gray-500 uppercase">Spread</div>
            <div className="font-mono text-sm font-bold text-gray-900">
              {spread > 0 ? '+' : ''}
              {spread.toFixed(1)}
            </div>
            {hasVegas && (
              <div className="text-[10px] text-gray-400">
                Vegas: {prediction.vegasSpread! > 0 ? '+' : ''}
                {prediction.vegasSpread!.toFixed(1)}
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-[10px] text-gray-500 uppercase">Total</div>
            <div className="font-mono text-sm font-bold text-gray-900">
              {total.toFixed(1)}
            </div>
            {prediction.vegasTotal !== undefined && (
              <div className="text-[10px] text-gray-400">
                Vegas: {prediction.vegasTotal.toFixed(1)}
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-[10px] text-gray-500 uppercase">Edge</div>
            <div className="font-mono text-sm font-bold text-gray-900">
              {spreadEdge ? `${spreadEdge}pts` : '—'}
            </div>
            {totalEdge && (
              <div className="text-[10px] text-gray-400">
                O/U: {totalEdge}
              </div>
            )}
          </div>
        </div>

        {/* Weather / Injury indicators */}
        {(prediction.weather || prediction.injuries) && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-50">
            {prediction.weather &&
              prediction.weatherImpact !== undefined &&
              prediction.weatherImpact !== 0 && (
                <span className="text-[10px] text-gray-400">
                  {prediction.weather.conditions}{' '}
                  {prediction.weather.temperature}°F
                  {prediction.weather.windSpeed > 15 &&
                    ` 💨 ${prediction.weather.windSpeed}mph`}
                </span>
              )}
            {prediction.injuries?.impactLevel &&
              prediction.injuries.impactLevel !== 'none' && (
                <span
                  className={`text-[10px] ${
                    prediction.injuries.impactLevel === 'major'
                      ? 'text-red-500'
                      : prediction.injuries.impactLevel === 'significant'
                      ? 'text-orange-500'
                      : 'text-gray-400'
                  }`}
                >
                  Injury: {prediction.injuries.impactLevel}
                </span>
              )}
          </div>
        )}
      </div>
    </Link>
  );
}

export default async function NFLPredictionsPage() {
  const data = await fetchBlobData<NFLData>('prediction-matrix-data.json');
  const games = data?.games || [];
  const generated = data?.generated;

  // Separate upcoming from completed
  const now = new Date();
  const upcoming = games.filter(
    (gp) =>
      new Date(gp.game.gameTime) > now || gp.game.status === 'scheduled'
  );
  const bestBets = upcoming.filter(
    (gp) =>
      gp.prediction.isAtsBestBet ||
      gp.prediction.isOuBestBet ||
      gp.prediction.isMlBestBet
  );

  // Sort by game time
  upcoming.sort(
    (a, b) =>
      new Date(a.game.gameTime).getTime() -
      new Date(b.game.gameTime).getTime()
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">NFL Predictions</h1>
          <p className="text-sm text-gray-500 mt-1">
            Elo-powered spread, moneyline &amp; over/under picks
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/rankings"
            className="text-xs text-gray-500 hover:text-red-600 transition-colors"
          >
            Power Rankings →
          </Link>
          <Link
            href="/results"
            className="text-xs text-gray-500 hover:text-red-600 transition-colors"
          >
            Results →
          </Link>
        </div>
      </div>

      {generated && (
        <p className="text-xs text-gray-400">
          Last updated:{' '}
          {new Date(generated).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      )}

      {/* Best Bets Section */}
      {bestBets.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-3">
            High Conviction Picks ({bestBets.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bestBets.map((gp) => (
              <GameCard key={gp.game.id} gp={gp} />
            ))}
          </div>
        </div>
      )}

      {/* All Upcoming Games */}
      {upcoming.length > 0 ? (
        <div>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
            All Upcoming Games ({upcoming.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((gp) => (
              <GameCard key={gp.game.id} gp={gp} />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg font-semibold">
            No upcoming NFL games
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Check back when the NFL season is active. View{' '}
            <Link href="/results" className="text-red-600 hover:underline">
              past results
            </Link>{' '}
            or{' '}
            <Link href="/rankings" className="text-red-600 hover:underline">
              power rankings
            </Link>{' '}
            in the meantime.
          </p>
        </div>
      )}

      {/* SEO content — rich text for search engine crawlers */}
      <div className="mt-12 pt-8 border-t border-gray-200 space-y-4 text-sm text-gray-500">
        <h2 className="text-lg font-semibold text-gray-900">
          About Our NFL Predictions
        </h2>
        <p>
          Prediction Matrix generates NFL betting predictions using a
          proprietary Elo rating system, weather data for outdoor stadiums, and
          real-time injury reports. Our model produces spread predictions,
          over/under totals, and moneyline win probabilities for every NFL game.
        </p>
        <p>
          High conviction picks are flagged when multiple favorable conditions
          align — divisional matchups, late-season games, large Elo mismatches,
          or significant spread edges. These filtered picks have historically
          outperformed our overall predictions.
        </p>
        <p>
          Vegas lines are locked one hour before kickoff to ensure fair
          comparison. All results are tracked and publicly available on our{' '}
          <Link href="/results" className="text-red-600 hover:underline">
            results page
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
