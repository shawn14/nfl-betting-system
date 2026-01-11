import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NHL Power Rankings - Elo Ratings',
  description: 'NHL team power rankings based on Elo ratings. See which teams are trending up or down with our AI-powered rating system.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/nhl/rankings',
  },
  openGraph: {
    title: 'NHL Power Rankings - Elo Ratings | Prediction Matrix',
    description: 'NHL team power rankings based on Elo ratings. See which teams are trending up or down.',
    url: 'https://www.predictionmatrix.com/nhl/rankings',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'NHL Power Rankings | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NHL Power Rankings - Elo Ratings | Prediction Matrix',
    description: 'NHL team power rankings based on Elo ratings. See which teams are trending.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What are Elo ratings in NHL?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Elo ratings are a mathematical system for calculating the relative skill levels of NHL teams. Our model starts each team at 1500 and adjusts ratings based on game outcomes, including regulation wins vs overtime/shootout results.',
      },
    },
    {
      '@type': 'Question',
      name: 'How often are NHL power rankings updated?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our NHL power rankings are updated automatically after each game is completed. With games nearly every night during the season, rankings shift frequently based on actual game results.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is the puckline in NHL betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The puckline is hockey\'s version of the point spread, typically set at 1.5 goals. Betting the favorite at -1.5 means they must win by 2+ goals. The underdog at +1.5 covers if they win or lose by just 1 goal.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is a good Elo rating in NHL?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'An Elo rating above 1550 indicates an above-average NHL team, while ratings above 1600 suggest a playoff-caliber team. Elite teams typically range from 1650-1750. The league average is always 1500, so any rating above that means the team is performing better than average.',
      },
    },
  ],
};

export default function NHLRankingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {children}
    </>
  );
}
