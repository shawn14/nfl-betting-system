'use client';

import RequireAuth from '@/components/RequireAuth';
import { useAuth } from '@/components/AuthProvider';

export default function AccountPage() {
  const { user, subscription } = useAuth();

  const status = subscription?.subscriptionStatus || (subscription?.isPremium ? 'active' : 'free');
  const periodEnd = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US')
    : null;

  return (
    <RequireAuth>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Account</h1>
          <p className="text-sm text-gray-500">Manage your membership and access.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <div className="text-xs uppercase tracking-widest text-gray-400">Profile</div>
          <div className="text-sm text-gray-600">Email</div>
          <div className="text-base font-semibold text-gray-900">{user?.email || 'user'}</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <div className="text-xs uppercase tracking-widest text-gray-400">Subscription</div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Status</span>
            <span className="font-semibold text-gray-900">{status}</span>
          </div>
          {periodEnd && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Renews</span>
              <span className="font-semibold text-gray-900">{periodEnd}</span>
            </div>
          )}
          <div className="text-xs text-gray-500">
            Need to update your plan? Use the checkout buttons on the dashboard.
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
