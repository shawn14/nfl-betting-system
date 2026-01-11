import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'How to Read Prediction Market Probabilities',
  description: 'Learn how to interpret prediction market prices as probabilities. Understand what moves markets, how to spot trends, and why smart traders watch multiple platforms.',
  keywords: ['prediction market probabilities', 'how to read prediction markets', 'prediction market prices', 'market probability', 'prediction market guide'],
  alternates: {
    canonical: 'https://www.predictionmatrix.com/prediction-markets/how-to-read-probabilities',
  },
  openGraph: {
    title: 'How to Read Prediction Market Probabilities | Prediction Matrix',
    description: 'Learn how to interpret prediction market prices as probabilities and spot market trends.',
    url: 'https://www.predictionmatrix.com/prediction-markets/how-to-read-probabilities',
    siteName: 'Prediction Matrix',
    type: 'article',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'How to Read Prediction Market Probabilities | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How to Read Prediction Market Probabilities | Prediction Matrix',
    description: 'Learn how to interpret prediction market prices as probabilities.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqs = [
  {
    q: 'What does a prediction market price mean?',
    a: 'The price represents the probability of an outcome. A contract trading at $0.65 means the market believes there is approximately a 65% chance the event will occur.',
  },
  {
    q: 'Why do prediction market probabilities change?',
    a: 'Probabilities change when new information arrives, confidence levels shift, or more capital enters the market. Traders act on what they know, and prices adjust accordingly.',
  },
  {
    q: 'What does high volatility in a prediction market mean?',
    a: 'High volatility indicates uncertainty—conflicting information, unclear outcomes, or competing narratives. When markets calm down, it usually means consensus is forming.',
  },
  {
    q: 'Should I watch multiple prediction markets?',
    a: 'Yes. Different platforms attract different crowds with different information. Watching multiple markets helps you spot disagreements and identify where belief is shifting.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.a,
    },
  })),
};

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://www.predictionmatrix.com',
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Prediction Markets',
      item: 'https://www.predictionmatrix.com/prediction-markets',
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: 'How to Read Probabilities',
      item: 'https://www.predictionmatrix.com/prediction-markets/how-to-read-probabilities',
    },
  ],
};

const howToJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Read Prediction Market Probabilities',
  description: 'A guide to interpreting prediction market prices as probabilities',
  step: [
    {
      '@type': 'HowToStep',
      name: 'Understand prices are probabilities',
      text: 'A contract trading at $0.72 means approximately 72% probability. This is the golden rule of prediction markets.',
    },
    {
      '@type': 'HowToStep',
      name: 'Watch what moves prices',
      text: 'New information, changing confidence, and capital flows all move probabilities. When someone acts on better information, the price adjusts.',
    },
    {
      '@type': 'HowToStep',
      name: 'Track direction, not just level',
      text: 'A move from 55% to 65% is often more meaningful than sitting at 80% all week. Direction reveals changing beliefs.',
    },
    {
      '@type': 'HowToStep',
      name: 'Interpret volatility as uncertainty',
      text: 'Fast price swings mean conflicting information. Flat prices mean consensus. Markets calm down when the future becomes clearer.',
    },
    {
      '@type': 'HowToStep',
      name: 'Compare multiple markets',
      text: 'Different platforms see different things. When markets diverge, something interesting is happening.',
    },
  ],
};

export default function HowToReadProbabilitiesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />

      <article className="max-w-4xl mx-auto prose prose-gray prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl">
        <div className="mb-4 not-prose">
          <a
            href="/prediction-markets"
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            ← Back to Prediction Markets
          </a>
        </div>

        <h1>How to Read Prediction Market Probabilities</h1>
        <p className="text-xl text-gray-600 font-medium">
          Stop Guessing. Start Interpreting.
        </p>

        <p>
          Prediction markets don't tell you <em>what to think</em>.
          <br />
          They tell you <em>what the market believes</em>.
        </p>
        <p>
          Once you know how to read them, you'll never look at forecasts the same way again.
        </p>

        <hr className="my-8" />

        <h2>Prices Are Probabilities</h2>
        <p>This is the golden rule.</p>
        <div className="bg-gray-50 p-6 rounded-lg my-6 not-prose">
          <p className="text-gray-700 mb-4">If a contract:</p>
          <ul className="space-y-2 text-gray-600">
            <li>
              Trades at <strong className="text-gray-900">$0.72</strong> → ~72% chance
            </li>
            <li>
              Trades at <strong className="text-gray-900">$0.40</strong> → ~40% chance
            </li>
            <li>
              Trades at <strong className="text-gray-900">$0.15</strong> → ~15% chance
            </li>
          </ul>
        </div>
        <p>Nothing more complicated than that.</p>

        <hr className="my-8" />

        <h2>What Moves Probabilities?</h2>
        <p>Three things:</p>
        <ol>
          <li>
            <strong>New information</strong> — facts, reports, announcements
          </li>
          <li>
            <strong>Confidence</strong> — how certain traders feel
          </li>
          <li>
            <strong>Capital</strong> — money entering or leaving positions
          </li>
        </ol>
        <p>
          When someone learns something meaningful—and acts on it—the price moves.
        </p>

        <hr className="my-8" />

        <h2>Rising vs Falling Probabilities</h2>
        <div className="grid md:grid-cols-2 gap-6 my-6 not-prose">
          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-600 text-xl">↑</span>
              <h4 className="font-bold text-gray-900">Rising Probability</h4>
            </div>
            <p className="text-sm text-gray-600">
              Increasing confidence. The market is becoming more certain the event will happen.
            </p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg border border-red-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-600 text-xl">↓</span>
              <h4 className="font-bold text-gray-900">Falling Probability</h4>
            </div>
            <p className="text-sm text-gray-600">
              Doubt entering the market. Confidence is weakening or counter-evidence is emerging.
            </p>
          </div>
        </div>
        <p>
          The <em>direction</em> matters as much as the number.
        </p>
        <p>
          A move from 55% → 65% is often more meaningful than sitting at 80% all week.
        </p>

        <hr className="my-8" />

        <h2>Volatility = Uncertainty</h2>
        <div className="grid md:grid-cols-2 gap-6 my-6 not-prose">
          <div className="bg-orange-50 p-4 rounded-lg">
            <h4 className="font-bold text-gray-900 mb-2">Fast Swings Mean:</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Conflicting information</li>
              <li>• Unclear outcomes</li>
              <li>• Competing narratives</li>
            </ul>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-bold text-gray-900 mb-2">Flat Prices Mean:</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Consensus</li>
              <li>• Stability</li>
              <li>• Low uncertainty</li>
            </ul>
          </div>
        </div>
        <p>Markets calm down when the future becomes clearer.</p>

        <hr className="my-8" />

        <h2>Prediction Markets vs Headlines</h2>
        <p>
          Headlines tell you what <em>already happened</em>.
        </p>
        <p>Prediction markets tell you:</p>
        <ul>
          <li>What people expect next</li>
          <li>How confident they are</li>
          <li>When belief is shifting</li>
        </ul>
        <p>
          <strong>That's the edge.</strong>
        </p>

        <hr className="my-8" />

        <h2>Why Smart People Watch Multiple Markets</h2>
        <p>Different crowds see different things.</p>
        <p>Watching multiple prediction markets lets you:</p>
        <ul>
          <li>Spot disagreement between platforms</li>
          <li>Identify early trend changes</li>
          <li>Avoid narrative traps</li>
        </ul>
        <p>
          When markets diverge, something interesting is happening.
        </p>

        <hr className="my-8" />

        <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 my-8 not-prose">
          <h2 className="text-xl font-bold text-gray-900 mb-3">
            Where Prediction Matrix Fits In
          </h2>
          <p className="text-gray-600 mb-4">Prediction Matrix is building tools to:</p>
          <ul className="text-gray-600 space-y-2 mb-4 list-disc list-inside">
            <li>Track probabilities over time</li>
            <li>Compare platforms side-by-side</li>
            <li>Highlight belief shifts early</li>
          </ul>
          <p className="text-gray-700 font-medium">
            Not opinions. Not noise. Just probabilities.
          </p>
        </div>

        <hr className="my-8" />

        <h2>Quick Reference</h2>
        <div className="overflow-x-auto not-prose my-6">
          <table className="min-w-full border border-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-900 border-b">
                  Price
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900 border-b">
                  Probability
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900 border-b">
                  Interpretation
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr>
                <td className="px-4 py-3 font-mono text-gray-900">$0.90+</td>
                <td className="px-4 py-3 text-gray-600">90%+</td>
                <td className="px-4 py-3 text-gray-600">Near certainty</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-gray-900">$0.70-0.89</td>
                <td className="px-4 py-3 text-gray-600">70-89%</td>
                <td className="px-4 py-3 text-gray-600">Likely to happen</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-gray-900">$0.50-0.69</td>
                <td className="px-4 py-3 text-gray-600">50-69%</td>
                <td className="px-4 py-3 text-gray-600">Slightly favored</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-gray-900">$0.30-0.49</td>
                <td className="px-4 py-3 text-gray-600">30-49%</td>
                <td className="px-4 py-3 text-gray-600">Possible but unlikely</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-gray-900">$0.10-0.29</td>
                <td className="px-4 py-3 text-gray-600">10-29%</td>
                <td className="px-4 py-3 text-gray-600">Long shot</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-gray-900">$0.01-0.09</td>
                <td className="px-4 py-3 text-gray-600">1-9%</td>
                <td className="px-4 py-3 text-gray-600">Very unlikely</td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr className="my-8" />

        <h2>Frequently Asked Questions</h2>
        <div className="space-y-6 not-prose">
          {faqs.map((faq) => (
            <div key={faq.q}>
              <h3 className="font-semibold text-gray-900 mb-2">{faq.q}</h3>
              <p className="text-gray-600">{faq.a}</p>
            </div>
          ))}
        </div>

        <hr className="my-8" />

        <div className="not-prose">
          <p className="text-sm text-gray-500 mb-4">Continue reading:</p>
          <div className="flex flex-wrap gap-4">
            <a
              href="/prediction-markets"
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              ← Prediction Markets Explained
            </a>
            <a
              href="/prediction-markets/kalshi-vs-polymarket"
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Kalshi vs Polymarket →
            </a>
          </div>
        </div>
      </article>
    </>
  );
}
