import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WNBA Power Rankings - Elo Ratings',
  description: 'WNBA team power rankings based on Elo ratings. See which teams are trending up or down with our AI-powered rating system.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/wnba/rankings',
  },
  openGraph: {
    title: 'WNBA Power Rankings - Elo Ratings | Prediction Matrix',
    description: 'WNBA team power rankings based on Elo ratings. See which teams are trending up or down.',
    url: 'https://www.predictionmatrix.com/wnba/rankings',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'WNBA Power Rankings | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WNBA Power Rankings - Elo Ratings | Prediction Matrix',
    description: 'WNBA team power rankings based on Elo ratings. See which teams are trending.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What are Elo ratings in WNBA?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Elo ratings are a mathematical system for calculating the relative skill levels of WNBA teams. Our model starts each team at 1500 and adjusts ratings based on game outcomes, margin of victory, and home court advantage. Higher ratings indicate stronger teams.',
      },
    },
    {
      '@type': 'Question',
      name: 'How often are WNBA power rankings updated?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our WNBA power rankings are updated automatically after each game is completed. With games nearly every night during the season, rankings shift frequently based on actual game results.',
      },
    },
    {
      '@type': 'Question',
      name: 'How are WNBA betting predictions calculated?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our predictions use Elo ratings to calculate expected point spreads, incorporating home court advantage of approximately 4.5 points. We compare our model spread to Vegas lines to identify betting value.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is a good Elo rating in WNBA?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'An Elo rating above 1550 indicates an above-average WNBA team, while ratings above 1600 suggest a playoff-caliber team. Elite teams typically range from 1650-1750. The league average is always 1500, so any rating above that means the team is performing better than average.',
      },
    },
  ],
};

export default function WNBARankingsLayout({ children }: { children: React.ReactNode }) {
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
