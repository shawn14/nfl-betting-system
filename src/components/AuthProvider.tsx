'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

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
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  subscription: null,
  isPremium: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
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

  const isPremium = subscription?.isPremium === true
    || subscription?.subscriptionStatus === 'active'
    || subscription?.subscriptionStatus === 'trialing';

  const value = useMemo(
    () => ({ user, loading, subscription, isPremium }),
    [user, loading, subscription, isPremium]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
