'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { FREE_ACCESS_MODE } from '@/lib/access';

interface SubscriptionState {
  stripeCustomerId?: string;
  subscriptionStatus?: string;
  currentPeriodEnd?: string;
  priceId?: string;
  isPremium?: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  subscription: SubscriptionState | null;
  isPremium: boolean;
  freeAccess: boolean; // FREE_ACCESS_MODE is on: isPremium is true for everyone signed in
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  subscription: null,
  isPremium: false,
  freeAccess: FREE_ACCESS_MODE,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setSubscription(null);
      return;
    }
    const userRef = doc(db, 'users', user.uid);

    // Create user doc if it doesn't exist
    const ensureUserDoc = async () => {
      const snapshot = await getDoc(userRef);
      if (!snapshot.exists()) {
        await setDoc(userRef, {
          email: user.email || null,
          createdAt: new Date().toISOString(),
          isPremium: false,
        });
      }
    };
    ensureUserDoc();

    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (!snapshot.exists()) {
        setSubscription(null);
        return;
      }
      setSubscription(snapshot.data() as SubscriptionState);
    });
    return () => unsubscribe();
  }, [user]);

  const isPremium = FREE_ACCESS_MODE
    || subscription?.isPremium === true
    || subscription?.subscriptionStatus === 'active'
    || subscription?.subscriptionStatus === 'trialing';

  const value = useMemo(
    () => ({ user, loading, subscription, isPremium, freeAccess: FREE_ACCESS_MODE }),
    [user, loading, subscription, isPremium]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
