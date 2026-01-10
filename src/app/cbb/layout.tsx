import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CBB Betting Predictions & Picks',
  description: 'Daily CBB betting predictions with AI-powered spread picks, over/under analysis, and Elo power rankings. Track ATS results and find value bets.',
  openGraph: {
    title: 'CBB Betting Predictions & Picks | Prediction Matrix',
    description: 'Daily CBB betting predictions with AI-powered spread picks, over/under analysis, and Elo power rankings.',
  },
};

export default function CBBLayout({ children }: { children: React.ReactNode }) {
  return children;
}
