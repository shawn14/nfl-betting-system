import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NFL ATS Results & Pick History',
  description: 'Track our NFL betting predictions performance. View ATS records, spread results, and historical pick accuracy for every game this season.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/results',
  },
  openGraph: {
    title: 'NFL ATS Results & Pick History | Prediction Matrix',
    description: 'Track our NFL betting predictions performance. View ATS records, spread results, and historical accuracy.',
    url: 'https://www.predictionmatrix.com/results',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'NFL ATS Results | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NFL ATS Results & Pick History | Prediction Matrix',
    description: 'Track our NFL betting predictions performance. View ATS records and historical accuracy.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What does ATS mean in NFL betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'ATS stands for "Against The Spread." It measures how well picks perform relative to the Vegas point spread, not just picking winners. A team can lose the game but still cover the spread and win ATS.',
      },
    },
    {
      '@type': 'Question',
      name: 'How accurate are Prediction Matrix NFL picks?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Our NFL model achieves approximately 55% ATS accuracy over the season. We track all picks transparently so you can verify our historical performance on this results page.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is a push in NFL betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A push occurs when the final margin exactly matches the spread. For example, if Team A is -7 and wins by exactly 7 points, the bet is a push and your stake is returned. Pushes are tracked separately in our ATS records.',
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

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
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
