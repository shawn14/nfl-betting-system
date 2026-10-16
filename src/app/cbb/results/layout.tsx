import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'CBB Measured Results',
  description: 'Prospective forecasts captured before games, graded at recorded prices. Model predictions and price shopping are measured separately; no edge is established.',
  alternates: {canonical: 'https://www.predictionmatrix.com/cbb/results'},
};
export default function ResultsLayout({children}:{children:React.ReactNode}) { return children; }
