import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions',
  description: 'Common questions about Prediction Matrix sports betting predictions, Elo ratings, ATS records, and how our AI model works.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/faq',
  },
  openGraph: {
    title: 'FAQ | Prediction Matrix',
    description: 'Common questions about Prediction Matrix sports betting predictions and how our AI model works.',
    url: 'https://www.predictionmatrix.com/faq',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'Prediction Matrix FAQ',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FAQ | Prediction Matrix',
    description: 'Common questions about Prediction Matrix sports betting predictions.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqs = [
  {
    category: 'About Prediction Matrix',
    questions: [
      {
        q: 'How is Prediction Matrix different from other sports betting sites?',
        a: 'Unlike sites that rely on expert opinions, we use a purely mathematical Elo-based model that updates automatically after every game. Our predictions are 100% transparent - we show our model spread vs Vegas spread and track every pick publicly so you can verify our accuracy.',
      },
      {
        q: 'What sports do you cover?',
        a: 'We provide AI-powered predictions for NFL, NBA, NHL, and College Basketball (CBB). Each sport has its own dedicated section with power rankings, game predictions, and historical results.',
      },
    ],
  },
  {
    category: 'Elo Ratings',
    questions: [
      {
        q: 'What are Elo ratings?',
        a: 'Elo ratings are a mathematical system for calculating the relative skill levels of teams. Our model starts each team at 1500 and adjusts ratings based on game outcomes, margin of victory, and home field advantage. Higher ratings indicate stronger teams.',
      },
      {
        q: 'What is a good Elo rating?',
        a: 'An Elo rating above 1550 indicates an above-average team, while ratings above 1600 suggest a playoff-caliber team. Elite teams typically range from 1650-1750. The league average is always 1500, so any rating above that means the team is performing better than average.',
      },
      {
        q: 'How often are power rankings updated?',
        a: 'Our power rankings are updated automatically after each game is completed. Ratings adjust based on the actual game results compared to expected outcomes.',
      },
    ],
  },
  {
    category: 'Betting Basics',
    questions: [
      {
        q: 'What does ATS mean?',
        a: 'ATS stands for "Against The Spread." It measures how well picks perform relative to the Vegas point spread, not just picking winners. A team can lose the game but still cover the spread and win ATS.',
      },
      {
        q: 'What is a push?',
        a: 'A push occurs when the final margin exactly matches the spread. For example, if Team A is -7 and wins by exactly 7 points, the bet is a push and your stake is returned. Pushes are tracked separately in our ATS records.',
      },
      {
        q: 'What is the puckline in NHL betting?',
        a: "The puckline is hockey's version of the point spread, typically set at 1.5 goals. Betting the favorite at -1.5 means they must win by 2+ goals. The underdog at +1.5 covers if they win or lose by just 1 goal.",
      },
      {
        q: 'What win rate do you need to be profitable?',
        a: 'You need approximately 52.4% ATS accuracy to break even when paying standard -110 juice. Anything above 55% is considered excellent and generates consistent profit over time. Our model targets edges where we have the highest historical accuracy.',
      },
    ],
  },
  {
    category: 'Our Predictions',
    questions: [
      {
        q: 'How are betting predictions calculated?',
        a: 'Our predictions use Elo ratings to calculate expected point spreads, incorporating home field advantage, weather conditions (NFL), and other factors. We compare our model spread to Vegas lines to identify betting value.',
      },
      {
        q: 'How accurate are your picks?',
        a: 'Our NFL model achieves approximately 55% ATS accuracy over the season. We track all picks transparently so you can verify our historical performance on each sport\'s results page.',
      },
      {
        q: 'Does overtime affect NHL puckline bets?',
        a: 'Yes, overtime and shootout results count for puckline bets. A game that goes to overtime means the underdog at +1.5 automatically covers since OT/SO games end with a 1-goal difference.',
      },
    ],
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.flatMap((category) =>
    category.questions.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.a,
      },
    }))
  ),
};

export default function FAQPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Frequently Asked Questions</h1>
        <p className="text-gray-600 mb-8">
          Everything you need to know about Prediction Matrix and sports betting.
        </p>

        <div className="space-y-10">
          {faqs.map((category) => (
            <section key={category.category}>
              <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-200">
                {category.category}
              </h2>
              <div className="space-y-6">
                {category.questions.map((faq) => (
                  <div key={faq.q}>
                    <h3 className="text-base font-medium text-gray-900 mb-2">{faq.q}</h3>
                    <p className="text-gray-600 text-sm leading-relaxed">{faq.a}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 p-6 bg-gray-50 rounded-lg">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Still have questions?</h2>
          <p className="text-gray-600 text-sm">
            Check out our detailed results pages for each sport to see our historical performance,
            or visit the rankings pages to understand how teams are rated.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="/results"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              NFL Results →
            </a>
            <a
              href="/nba/results"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              NBA Results →
            </a>
            <a
              href="/nhl/results"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              NHL Results →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
