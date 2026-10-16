import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'NHL Measured Results',
  description: 'Prospective forecasts captured before games, graded at recorded prices. Model predictions and price shopping are measured separately; no edge is established.',
  alternates: {canonical: 'https://www.predictionmatrix.com/nhl/results'},
};
export default function ResultsLayout({children}:{children:React.ReactNode}) { return children; }
