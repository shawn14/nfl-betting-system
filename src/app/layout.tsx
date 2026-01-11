import type { Metadata } from "next";
import { Inter, Roboto_Condensed } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import FooterStats from "@/components/FooterStats";
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
  description: "AI-powered NFL, NBA & NHL betting predictions. Get daily picks, Elo rankings, ATS results, and expert analysis for smarter sports betting.",
  keywords: ["sports betting", "NFL picks", "NBA picks", "NHL picks", "betting predictions", "Elo ratings", "ATS", "spread predictions", "sports analytics"],
  alternates: {
    canonical: 'https://www.predictionmatrix.com',
  },
  openGraph: {
    title: "Prediction Matrix - AI Sports Betting Predictions",
    description: "AI-powered NFL, NBA & NHL betting predictions. Daily picks, Elo rankings, and ATS results.",
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
    description: "AI-powered NFL, NBA & NHL betting predictions. Daily picks, Elo rankings, and ATS results.",
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
      description: 'AI-powered sports betting predictions for NFL, NBA, NHL, and College Basketball.',
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://www.predictionmatrix.com/#website',
      url: 'https://www.predictionmatrix.com',
      name: 'Prediction Matrix',
      description: 'AI-powered NFL, NBA & NHL betting predictions with Elo ratings and ATS results.',
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
    {
      '@type': 'FAQPage',
      '@id': 'https://www.predictionmatrix.com/#faq',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'How is Prediction Matrix different from other sports betting sites?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Unlike sites that rely on expert opinions, we use a purely mathematical Elo-based model that updates automatically after every game. Our predictions are 100% transparent - we show our model spread vs Vegas spread and track every pick publicly so you can verify our accuracy.',
          },
        },
      ],
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
          <NavBar />

          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>

          {/* Footer */}
          <footer className="bg-white border-t border-gray-200 mt-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
              <div className="flex flex-col gap-3 sm:gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs sm:text-sm text-gray-500">
                  <span>Prediction Matrix</span>
                  <FooterStats />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[10px] sm:text-xs text-gray-400 border-t border-gray-100 pt-3 sm:pt-4">
                  <div className="flex items-center gap-4">
                    <a href="/about" className="hover:text-gray-600">About</a>
                    <a href="/faq" className="hover:text-gray-600">FAQ</a>
                    <a href="/terms" className="hover:text-gray-600">Terms</a>
                    <a href="/privacy" className="hover:text-gray-600">Privacy</a>
                  </div>
                  <span className="leading-relaxed">For entertainment only. 21+. Problem? 1-800-522-4700</span>
                </div>
              </div>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
