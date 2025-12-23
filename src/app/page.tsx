'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';

export default function LandingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [loading, router, user]);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  return (
    <div className="min-h-[70vh] flex items-center">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] items-center w-full">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-red-600">
            Prediction Matrix
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight">
            AI-backed NFL & NBA predictions,
            <span className="block text-red-600">built for speed and clarity.</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-600 max-w-xl">
            Track projections, see market movement, and review weekly results in one place.
            Sign in to unlock the live dashboard.
          </p>
          {!user && (
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
              <button
                onClick={() => router.push('/about')}
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Learn more
              </button>
            </div>
          )}
          <div className="text-xs text-gray-400">
            By continuing, you agree to the Terms and acknowledge the Privacy Policy.
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">What you get</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Live</span>
          </div>
          <div className="space-y-4 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">01</span>
              <div>
                <div className="text-gray-900 font-semibold">Weekly projections</div>
                Updated every two hours with injuries, weather, and line movement.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">02</span>
              <div>
                <div className="text-gray-900 font-semibold">Confidence signals</div>
                See consensus, divergence, and our adjustments at a glance.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">03</span>
              <div>
                <div className="text-gray-900 font-semibold">Results tracking</div>
                Audit picks, ATS performance, and market edges by week.
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-xs text-gray-500">
            Trusted by serious bettors looking for signal, not noise.
          </div>
        </div>
      </div>
    </div>
  );
}
