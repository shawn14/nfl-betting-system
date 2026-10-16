'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import NavBar from './NavBar';
import FooterStats from './FooterStats';
export default function AppFrame({children}:{children:ReactNode}){
 const pathname=usePathname();
 if(pathname==='/terminal')return <>{children}</>;
 return <>
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
                    <a href="/prediction-markets" className="hover:text-gray-600">Prediction Markets</a>
                    <a href="/terms" className="hover:text-gray-600">Terms</a>
                    <a href="/privacy" className="hover:text-gray-600">Privacy</a>
                  </div>
                  <span className="leading-relaxed">For entertainment only. 21+. Problem? 1-800-522-4700</span>
                </div>
              </div>
            </div>
          </footer>
 </>;
}
