'use client';

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">About Prediction Matrix</h1>

      <div className="space-y-6 text-gray-600">
        <p className="text-lg">
          Prediction Matrix is an AI-powered sports analytics platform that leverages advanced
          statistical modeling to generate NFL game predictions.
        </p>

        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">How It Works</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="text-red-600 font-bold">1.</span>
              <span><strong>Elo Rating System</strong> - Each team maintains a dynamic power rating that updates after every game based on margin of victory and opponent strength.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-red-600 font-bold">2.</span>
              <span><strong>Statistical Regression</strong> - Team scoring stats are regressed toward league averages to account for small sample sizes and reduce noise.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-red-600 font-bold">3.</span>
              <span><strong>Matchup Analysis</strong> - Predicted scores are calculated by analyzing offensive efficiency against defensive performance for each specific matchup.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-red-600 font-bold">4.</span>
              <span><strong>Calibrated Adjustments</strong> - Home field advantage and Elo differentials are calibrated against historical data to optimize prediction accuracy.</span>
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-2xl font-bold text-green-600">60.7%</div>
            <div className="text-xs text-gray-500 mt-1">Against the Spread</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-2xl font-bold text-green-600">63.4%</div>
            <div className="text-xs text-gray-500 mt-1">Moneyline</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-2xl font-bold text-green-600">63.6%</div>
            <div className="text-xs text-gray-500 mt-1">Over/Under</div>
          </div>
        </div>

        <p>
          Our models process game data in real-time, continuously updating team ratings and
          predictions as the season progresses. Every prediction includes transparent methodology -
          click into any game to see exactly how the numbers are calculated.
        </p>

        <p className="text-sm text-gray-400">
          Prediction Matrix is designed for analytical and entertainment purposes.
          Always gamble responsibly.
        </p>
      </div>
    </div>
  );
}
