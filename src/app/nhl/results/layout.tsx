import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NHL ATS Results & Pick History',
  description: 'Track our NHL betting predictions performance. View puckline records, spread results, and historical pick accuracy for every game.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/nhl/results',
  },
  openGraph: {
    title: 'NHL ATS Results & Pick History | Prediction Matrix',
    description: 'Track our NHL betting predictions performance. View puckline records and historical accuracy.',
    url: 'https://www.predictionmatrix.com/nhl/results',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'NHL ATS Results | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NHL ATS Results & Pick History | Prediction Matrix',
    description: 'Track our NHL betting predictions performance. View puckline records and historical accuracy.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What does puckline record mean?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Puckline record tracks how well picks perform against the 1.5 goal spread in hockey. A winning puckline pick means the favorite won by 2+ goals or the underdog didn\'t lose by more than 1.',
      },
    },
    {
      '@type': 'Question',
      name: 'How accurate are Prediction Matrix NHL picks?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our NHL model tracks all picks transparently so you can verify our historical performance. Check this results page for our current puckline record and accuracy metrics.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does overtime affect NHL puckline bets?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, overtime and shootout results count for puckline bets. A game that goes to overtime means the underdog at +1.5 automatically covers since OT/SO games end with a 1-goal difference.',
      },
    },
    {
      '@type': 'Question',
      name: 'What win rate do you need to be profitable betting the puckline?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You need approximately 52.4% accuracy to break even when paying standard -110 juice. Anything above 55% is considered excellent and generates consistent profit over time. Our model targets edges where we have the highest historical accuracy.',
      },
    },
  ],
};

export default function NHLResultsLayout({ children }: { children: React.ReactNode }) {
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
