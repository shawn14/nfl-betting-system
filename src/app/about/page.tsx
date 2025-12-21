'use client';

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">How Prediction Matrix Works</h1>

      <div className="space-y-8 text-gray-600">
        <p className="text-lg">
          Prediction Matrix is a transparent, data-driven NFL prediction system. Every prediction
          can be traced back to specific inputs and calculations - no black boxes.
        </p>

        {/* Backtest Results */}
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">2024 Season Backtest Results</h2>
          <p className="text-sm text-gray-500 mb-4">
            Results from 169 games with Vegas lines during the 2024 NFL season.
            Vegas lines are locked 1 hour before each game to ensure fair comparison.
          </p>

          {/* Overall Stats */}
          <div className="mb-6">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">All Picks</div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-white rounded-xl p-4 border-2 border-green-500">
                <div className="text-2xl font-bold text-green-600">55.7%</div>
                <div className="text-xs text-gray-500 mt-1">Against the Spread</div>
                <div className="text-[10px] text-gray-400 mt-1">93-74-2</div>
              </div>
              <div className="bg-white rounded-xl p-4 border-2 border-green-500">
                <div className="text-2xl font-bold text-green-600">63.4%</div>
                <div className="text-xs text-gray-500 mt-1">Moneyline</div>
                <div className="text-[10px] text-gray-400 mt-1">144-83</div>
              </div>
              <div className="bg-white rounded-xl p-4 border-2 border-green-500">
                <div className="text-2xl font-bold text-green-600">56.3%</div>
                <div className="text-xs text-gray-500 mt-1">Over/Under</div>
                <div className="text-[10px] text-gray-400 mt-1">94-73-2</div>
              </div>
            </div>
          </div>

          {/* High Confidence Stats */}
          <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-200">
            <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">High Confidence Picks Only</div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-white rounded-xl p-3 border border-amber-200">
                <div className="text-xl font-bold text-amber-600">55.7%</div>
                <div className="text-xs text-gray-500 mt-1">ATS</div>
                <div className="text-[10px] text-gray-400">Edge doesn&apos;t improve</div>
              </div>
              <div className="bg-white rounded-xl p-3 border-2 border-green-500">
                <div className="text-xl font-bold text-green-600">77.9%</div>
                <div className="text-xs text-gray-500 mt-1">Moneyline</div>
                <div className="text-[10px] text-gray-400">53-15 @ 15%+ edge</div>
              </div>
              <div className="bg-white rounded-xl p-3 border-2 border-green-500">
                <div className="text-xl font-bold text-green-600">59.7%</div>
                <div className="text-xs text-gray-500 mt-1">Over/Under</div>
                <div className="text-[10px] text-gray-400">40-27 @ 5+ pt edge</div>
              </div>
            </div>
            <p className="text-xs text-amber-700 mt-3 text-center">
              Games marked &quot;HIGH CONF&quot; have historically hit at these rates.
            </p>
          </div>

          <p className="text-xs text-gray-400 mt-4 text-center">
            Break-even at -110 odds is 52.4%. All green boxes are profitable.
          </p>
        </div>

        {/* Core Model */}
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">The Prediction Model</h2>
          <div className="space-y-4 text-sm">
            <div className="flex gap-3">
              <span className="text-red-600 font-bold shrink-0">Step 1</span>
              <div>
                <strong>Elo Ratings</strong> - Each team has a power rating (starting at 1500) that updates
                after every game. Wins against strong teams boost your rating more; losses to weak teams
                hurt more. This captures "who's actually good" better than win-loss records.
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-red-600 font-bold shrink-0">Step 2</span>
              <div>
                <strong>Regression to Mean (30%)</strong> - Raw PPG and points allowed are regressed 30%
                toward league average (22 PPG). This prevents overreacting to small samples - a team that
                scored 45 in week 1 probably won't average 45 all season.
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-red-600 font-bold shrink-0">Step 3</span>
              <div>
                <strong>Matchup Calculation</strong> - Each team's predicted score = average of their
                offensive PPG and opponent's defensive points allowed. This creates matchup-specific
                predictions rather than generic power ratings.
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-red-600 font-bold shrink-0">Step 4</span>
              <div>
                <strong>Elo Adjustment</strong> - The Elo difference between teams adjusts the scores.
                Calibrated at 5.93 points per 100 Elo difference, split between both teams.
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-red-600 font-bold shrink-0">Step 5</span>
              <div>
                <strong>Home Field Advantage</strong> - Home teams get +2.28 points, calibrated from
                historical NFL data. This is split as +1.14 to home and -1.14 to away.
              </div>
            </div>
          </div>
        </div>

        {/* Weather */}
        <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Weather Adjustment</h2>
          <p className="text-sm mb-4">
            For outdoor games, we fetch real-time weather data and adjust predicted totals downward
            for adverse conditions. After backtesting multipliers from 0-8, we found <strong>3× weather
            impact</strong> optimal - this improved O/U accuracy from 55.7% to 56.3%.
          </p>
          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span>Cold (&lt;32°F)</span>
              <span className="font-mono">-1.5 to -3 pts</span>
            </div>
            <div className="flex justify-between">
              <span>Wind (&gt;15 mph)</span>
              <span className="font-mono">-1 to -2 pts</span>
            </div>
            <div className="flex justify-between">
              <span>Rain/Snow</span>
              <span className="font-mono">-1 to -2 pts</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Indoor stadiums (domes) are not affected. Weather impact is split evenly between both teams.
          </p>
        </div>

        {/* Vegas Line Locking */}
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Vegas Line Locking</h2>
          <p className="text-sm">
            Vegas lines are locked 1 hour before game time. This ensures we're comparing our predictions
            against the lines that were actually available to bettors, not lines that moved after
            late-breaking news. Once locked, lines don't change even if Vegas adjusts theirs.
          </p>
        </div>

        {/* Transparency */}
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Full Transparency</h2>
          <p className="text-sm mb-4">
            Click into any game to see the complete calculation breakdown:
          </p>
          <ul className="text-sm space-y-2 list-disc list-inside">
            <li>Exact inputs used (PPG, points allowed, Elo ratings)</li>
            <li>Step-by-step calculation with formulas</li>
            <li>Weather conditions and adjustment applied</li>
            <li>Our line vs Vegas line comparison</li>
            <li>Edge calculation and pick recommendation</li>
          </ul>
        </div>

        {/* Data Sources */}
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Sources</h2>
          <ul className="text-sm space-y-2">
            <li><strong>Scores & Stats:</strong> ESPN API (real-time)</li>
            <li><strong>Vegas Odds:</strong> The Odds API (spreads & totals)</li>
            <li><strong>Weather:</strong> Open-Meteo API (game-time forecasts)</li>
            <li><strong>Injuries:</strong> NFL.com injury reports</li>
          </ul>
        </div>

        <p className="text-sm text-gray-400 text-center pt-4">
          Prediction Matrix is designed for analytical and entertainment purposes. Always gamble responsibly.
        </p>
      </div>
    </div>
  );
}
