'use client';

import { usePathname } from 'next/navigation';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';
import AccountMenu from '@/components/AccountMenu';

export default function NavBar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const isNBA = pathname?.startsWith('/nba');

  // Determine base paths based on current section
  const rankingsPath = isNBA ? '/nba/rankings' : '/rankings';
  const resultsPath = isNBA ? '/nba/results' : '/results';
  const nflHomePath = user ? '/dashboard' : '/';

  // Active link styling
  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    if (path === '/dashboard') return pathname === '/dashboard';
    if (path === '/nba') return pathname === '/nba';
    return pathname?.startsWith(path);
  };

  const getLinkClass = (path: string, sport: 'nfl' | 'nba' = 'nfl') => {
    const active = isActive(path);
    const baseClass = 'px-4 py-4 text-sm font-semibold transition-colors';
    if (sport === 'nba') {
      return `${baseClass} ${active ? 'text-orange-600 border-b-2 border-orange-500' : 'text-gray-700 hover:text-orange-600 hover:border-b-2 hover:border-orange-500'}`;
    }
    return `${baseClass} ${active ? 'text-red-700 border-b-2 border-red-600' : 'text-gray-700 hover:text-red-700 hover:border-b-2 hover:border-red-600'}`;
  };

  const getMobileLinkClass = (path: string, sport: 'nfl' | 'nba' = 'nfl') => {
    const active = isActive(path);
    const baseClass = 'flex-1 text-center py-2.5 text-xs font-semibold transition-colors';
    if (sport === 'nba') {
      return `${baseClass} ${active ? 'text-orange-600 bg-orange-50' : 'text-gray-700 hover:text-orange-600 hover:bg-gray-50'}`;
    }
    return `${baseClass} ${active ? 'text-red-700 bg-red-50' : 'text-gray-700 hover:text-red-700 hover:bg-gray-50'}`;
  };

  const accentColor = isNBA ? 'bg-orange-500' : 'bg-red-600';
  const logoColor = isNBA ? 'bg-orange-500' : 'bg-red-600';

  return (
    <>
      {/* Top accent bar */}
      <div className={`h-1 ${accentColor}`} />

      {/* Main nav */}
      <nav className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4 sm:gap-8">
              <a href={nflHomePath} className="flex items-center gap-2 min-w-0">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 ${logoColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white font-bold text-xs sm:text-sm">PM</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-base sm:text-lg font-bold text-gray-900 leading-tight truncate">Prediction Matrix</span>
                  <span className="text-[8px] sm:text-[10px] text-gray-500 uppercase tracking-wider leading-tight hidden xs:block">
                    AI-Powered {isNBA ? 'NBA' : 'NFL'} Predictions
                  </span>
                </div>
              </a>
              {!loading && user && (
                <div className="hidden sm:flex">
                  <a href="/dashboard" className={getLinkClass('/dashboard', 'nfl')}>
                    NFL
                  </a>
                  <a href="/nba" className={getLinkClass('/nba', 'nba')}>
                    NBA
                  </a>
                  <a href={rankingsPath} className={getLinkClass(rankingsPath, isNBA ? 'nba' : 'nfl')}>
                    Rankings
                  </a>
                  <a href={resultsPath} className={getLinkClass(resultsPath, isNBA ? 'nba' : 'nfl')}>
                    Results
                  </a>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {!loading && user && (
                <div className="hidden lg:flex items-center gap-1 text-xs text-gray-500">
                  {isNBA ? (
                    <>
                      <span className="font-medium text-orange-600">NBA</span>
                      <span className="text-gray-300 mx-1">|</span>
                      <span className="text-[10px] text-gray-400">Season 2024-25</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">ATS:</span>
                      <span className="font-bold text-green-600">55.1%</span>
                      <span className="text-gray-300 mx-1">|</span>
                      <span className="font-medium">ML:</span>
                      <span className="font-bold text-green-600">77.9%</span>
                      <span className="text-[10px] text-gray-400">w/edge</span>
                      <span className="text-gray-300 mx-1">|</span>
                      <span className="font-medium">O/U:</span>
                      <span className="font-bold text-green-600">57.4%</span>
                      <span className="text-[10px] text-gray-400">w/edge</span>
                    </>
                  )}
                </div>
              )}
              {!loading && user ? (
                <AccountMenu />
              ) : (
                <button
                  onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
                  className="text-xs sm:text-sm font-semibold text-gray-600 hover:text-gray-900"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
          {/* Mobile nav */}
          {!loading && user && (
            <div className="flex sm:hidden border-t border-gray-100 -mx-3 px-1">
              <a href="/dashboard" className={getMobileLinkClass('/dashboard', 'nfl')}>
                NFL
              </a>
              <a href="/nba" className={getMobileLinkClass('/nba', 'nba')}>
                NBA
              </a>
              <a href={rankingsPath} className={getMobileLinkClass(rankingsPath, isNBA ? 'nba' : 'nfl')}>
                Rankings
              </a>
              <a href={resultsPath} className={getMobileLinkClass(resultsPath, isNBA ? 'nba' : 'nfl')}>
                Results
              </a>
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
