import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'WNBA Measured Results',
  description: 'Prospective forecasts captured before games, graded at recorded prices. Model predictions and price shopping are measured separately; no edge is established.',
  alternates: {canonical: 'https://www.predictionmatrix.com/wnba/results'},
};
export default function ResultsLayout({children}:{children:React.ReactNode}) { return children; }
