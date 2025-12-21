import type { Metadata } from "next";
import { Inter, Roboto_Condensed } from "next/font/google";
import "./globals.css";

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
  title: "Prediction Matrix - NFL Picks",
  description: "AI-powered NFL betting predictions using Elo ratings",
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
        {/* Top accent bar */}
        <div className="h-1 bg-red-600" />

        {/* Main nav */}
        <nav className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-8">
                <a href="/" className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-sm">PM</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-lg font-bold text-gray-900 leading-tight">Prediction Matrix</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider leading-tight">AI-Powered NFL Predictions</span>
                  </div>
                </a>
                <div className="flex">
                  <a href="/" className="text-gray-700 hover:text-red-700 hover:border-b-2 hover:border-red-600 px-4 py-4 text-sm font-semibold transition-colors">
                    Picks
                  </a>
                  <a href="/rankings" className="text-gray-700 hover:text-red-700 hover:border-b-2 hover:border-red-600 px-4 py-4 text-sm font-semibold transition-colors">
                    Rankings
                  </a>
                  <a href="/results" className="text-gray-700 hover:text-red-700 hover:border-b-2 hover:border-red-600 px-4 py-4 text-sm font-semibold transition-colors">
                    Results
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-1 text-xs text-gray-500">
                  <span className="font-medium">ATS:</span>
                  <span className="font-bold text-green-600">55.7%</span>
                  <span className="text-gray-300 mx-1">|</span>
                  <span className="font-medium">ML:</span>
                  <span className="font-bold text-green-600">77.9%</span>
                  <span className="text-[10px] text-gray-400">@15%+</span>
                  <span className="text-gray-300 mx-1">|</span>
                  <span className="font-medium">O/U:</span>
                  <span className="font-bold text-green-600">59.7%</span>
                  <span className="text-[10px] text-gray-400">@5pt+</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">NFL</span>
                  <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-1 rounded">2025</span>
                </div>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>Prediction Matrix - AI-Powered NFL Predictions</span>
                <span>High Conf: ATS 55.7% | ML 77.9% | O/U 59.7%</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
                <div className="flex items-center gap-4">
                  <a href="/about" className="hover:text-gray-600">About</a>
                  <a href="/terms" className="hover:text-gray-600">Terms</a>
                  <a href="/privacy" className="hover:text-gray-600">Privacy</a>
                </div>
                <span>For entertainment purposes only. Must be 21+. Gambling problem? Call 1-800-522-4700</span>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
