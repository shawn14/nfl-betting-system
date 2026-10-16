import type { Metadata } from "next";
import { Inter, Roboto_Condensed } from "next/font/google";
import "./globals.css";
import AppFrame from "@/components/AppFrame";
import { AuthProvider } from "@/components/AuthProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const robotoCondensed = Roboto_Condensed({
  variable: "--font-roboto-condensed",
  subsets: ["latin"],
  weight: ["700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.predictionmatrix.com'),
  title: {
    default: "Prediction Matrix - AI Sports Betting Predictions",
    template: "%s | Prediction Matrix",
  },
  description: "AI-powered NFL, NBA, NHL & College Basketball betting predictions. Get daily picks, Elo rankings, ATS results, and expert analysis for smarter sports betting.",
  keywords: ["sports betting", "NFL picks", "NBA picks", "NHL picks", "college basketball picks", "CBB picks", "betting predictions", "Elo ratings", "ATS", "spread predictions", "sports analytics"],
  alternates: {
    canonical: 'https://www.predictionmatrix.com',
  },
  openGraph: {
    title: "Prediction Matrix - AI Sports Betting Predictions",
    description: "AI-powered NFL, NBA, NHL & CBB betting predictions. Daily picks, Elo rankings, and ATS results.",
    url: "https://www.predictionmatrix.com",
    siteName: "Prediction Matrix",
    images: [
      {
        url: "https://www.predictionmatrix.com/api/og",
        width: 1200,
        height: 630,
        alt: "Prediction Matrix - AI Sports Betting Predictions",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prediction Matrix - AI Sports Betting Predictions",
    description: "AI-powered NFL, NBA, NHL & CBB betting predictions. Daily picks, Elo rankings, and ATS results.",
    images: ["https://www.predictionmatrix.com/api/og"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

// JSON-LD structured data for SEO
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://www.predictionmatrix.com/#organization',
      name: 'Prediction Matrix',
      url: 'https://www.predictionmatrix.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://www.predictionmatrix.com/api/og',
        width: 1200,
        height: 630,
      },
      description: 'AI-powered sports betting predictions for NFL, NBA, NHL & College Basketball.',
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://www.predictionmatrix.com/#website',
      url: 'https://www.predictionmatrix.com',
      name: 'Prediction Matrix',
      description: 'AI-powered NFL, NBA, NHL & CBB betting predictions with Elo ratings and ATS results.',
      publisher: {
        '@id': 'https://www.predictionmatrix.com/#organization',
      },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://www.predictionmatrix.com/rankings?q={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${inter.variable} ${robotoCondensed.variable} antialiased font-sans`}
        style={{ fontFamily: 'var(--font-inter), -apple-system, BlinkMacSystemFont, sans-serif' }}
      >
        <AuthProvider>
          <AppFrame>{children}</AppFrame>
        </AuthProvider>
      </body>
    </html>
  );
}
