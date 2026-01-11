import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NFL Power Rankings - Elo Ratings',
  description: 'NFL team power rankings based on Elo ratings. See which teams are trending up or down with our AI-powered rating system updated weekly.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/rankings',
  },
  openGraph: {
    title: 'NFL Power Rankings - Elo Ratings | Prediction Matrix',
    description: 'NFL team power rankings based on Elo ratings. See which teams are trending up or down.',
    url: 'https://www.predictionmatrix.com/rankings',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'NFL Power Rankings | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NFL Power Rankings - Elo Ratings | Prediction Matrix',
    description: 'NFL team power rankings based on Elo ratings. See which teams are trending.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What are Elo ratings in NFL?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Elo ratings are a mathematical system for calculating the relative skill levels of NFL teams. Our model starts each team at 1500 and adjusts ratings based on game outcomes, margin of victory, and home field advantage. Higher ratings indicate stronger teams.',
      },
    },
    {
      '@type': 'Question',
      name: 'How often are NFL power rankings updated?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our NFL power rankings are updated automatically after each game is completed. Ratings adjust based on the actual game results compared to expected outcomes.',
      },
    },
    {
      '@type': 'Question',
      name: 'How are NFL betting predictions calculated?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our predictions use Elo ratings to calculate expected point spreads, incorporating home field advantage, weather conditions, and injury reports. We compare our model spread to Vegas lines to identify betting value.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is a good Elo rating in NFL?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'An Elo rating above 1550 indicates an above-average NFL team, while ratings above 1600 suggest a playoff-caliber team. Elite teams typically range from 1650-1750. The league average is always 1500, so any rating above that means the team is performing better than average.',
      },
    },
  ],
};

export default function RankingsLayout({ children }: { children: React.ReactNode }) {
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
