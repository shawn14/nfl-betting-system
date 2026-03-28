'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';

export default function LoginButton() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [loading, router, user]);

  const handleGoogleLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  // Hide while loading or if already logged in (will redirect)
  if (loading || user) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleGoogleLogin}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 transition-colors"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-900 text-[10px] font-bold">
            G
          </span>
          Continue with Google
        </button>
        <a
          href="/about"
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          See how it works
        </a>
      </div>
      <div className="text-xs text-gray-400">
        No credit card · No spam · Leave anytime
      </div>
    </div>
  );
}
