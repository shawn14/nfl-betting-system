import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NBA ATS Results & Pick History',
  description: 'Track our NBA betting predictions performance. View ATS records, spread results, and historical pick accuracy for every game.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/nba/results',
  },
  openGraph: {
    title: 'NBA ATS Results & Pick History | Prediction Matrix',
    description: 'Track our NBA betting predictions performance. View ATS records, spread results, and historical accuracy.',
    url: 'https://www.predictionmatrix.com/nba/results',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'NBA ATS Results | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NBA ATS Results & Pick History | Prediction Matrix',
    description: 'Track our NBA betting predictions performance. View ATS records and historical accuracy.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What does ATS mean in NBA betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'ATS stands for "Against The Spread." It measures how well picks perform relative to the Vegas point spread, not just picking winners. A team can lose the game but still cover the spread and win ATS.',
      },
    },
    {
      '@type': 'Question',
      name: 'How accurate are Prediction Matrix NBA picks?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our NBA model tracks all picks transparently so you can verify our historical performance. Check this results page for our current ATS record and accuracy metrics.',
      },
    },
    {
      '@type': 'Question',
      name: 'Why do NBA spreads differ from NFL spreads?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'NBA spreads are typically larger than NFL spreads because basketball is a higher-scoring game. Point differentials of 10+ points are common in NBA, while NFL games rarely have spreads above 14 points.',
      },
    },
    {
      '@type': 'Question',
      name: 'What win rate do you need to be profitable betting against the spread?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You need approximately 52.4% ATS accuracy to break even when paying standard -110 juice. Anything above 55% is considered excellent and generates consistent profit over time. Our model targets edges where we have the highest historical accuracy.',
      },
    },
  ],
};

export default function NBAResultsLayout({ children }: { children: React.ReactNode }) {
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
