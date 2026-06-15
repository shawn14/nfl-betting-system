import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WNBA Betting Predictions & Picks',
  description: 'Daily WNBA betting predictions with AI-powered spread picks, over/under analysis, and Elo power rankings. Track ATS results and find value bets.',
  alternates: {
    canonical: 'https://www.predictionmatrix.com/wnba',
  },
  openGraph: {
    title: 'WNBA Betting Predictions & Picks | Prediction Matrix',
    description: 'Daily WNBA betting predictions with AI-powered spread picks, over/under analysis, and Elo power rankings.',
    url: 'https://www.predictionmatrix.com/wnba',
    siteName: 'Prediction Matrix',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
        alt: 'WNBA Betting Predictions | Prediction Matrix',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WNBA Betting Predictions & Picks | Prediction Matrix',
    description: 'Daily WNBA betting predictions with AI-powered spread picks and Elo power rankings.',
    images: ['https://www.predictionmatrix.com/api/og'],
  },
};

export default function WNBALayout({ children }: { children: React.ReactNode }) {
  return children;
}
