import type { Metadata } from "next";
import { Inter, Roboto_Condensed } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
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
  title: "Prediction Matrix - NFL Picks",
  description: "AI-powered NFL betting predictions using Elo ratings",
  openGraph: {
    title: "Prediction Matrix",
    description: "AI Sports Predictions",
    url: "https://www.predictionmatrix.com",
    siteName: "Prediction Matrix",
    images: [
      {
        url: "https://www.predictionmatrix.com/api/og",
        width: 1200,
        height: 630,
        alt: "Prediction Matrix - AI Sports Predictions",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prediction Matrix",
    description: "AI Sports Predictions",
    images: ["https://www.predictionmatrix.com/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
                  <span className="text-[10px] sm:text-sm">ATS 55.1% | ML 77.9% | O/U 57.4%</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[10px] sm:text-xs text-gray-400 border-t border-gray-100 pt-3 sm:pt-4">
                  <div className="flex items-center gap-4">
                    <a href="/about" className="hover:text-gray-600">About</a>
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
