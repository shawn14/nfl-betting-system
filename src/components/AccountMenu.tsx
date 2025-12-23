'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || '';
  if (!source) return '?';
  const parts = source.split(' ').filter(Boolean);
  if (parts.length === 0) return source.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function AccountMenu({ className = '' }: { className?: string }) {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (loading || !user) return null;

  const initials = getInitials(user.displayName, user.email);

  return (
    <div className={`relative ${className}`} ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-10 h-10 rounded-full bg-white border border-gray-200 shadow-md flex items-center justify-center overflow-hidden hover:shadow-lg transition-shadow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt={user.displayName || 'Account'} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-semibold text-gray-700">{initials}</span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-12 right-0 w-48 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-xs text-gray-500">Signed in as</div>
            <div className="text-sm font-semibold text-gray-900 truncate">{user.email || 'user'}</div>
          </div>
          <a
            href="/account"
            role="menuitem"
            className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => setOpen(false)}
          >
            Account
          </a>
          <button
            type="button"
            role="menuitem"
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => signOut(auth)}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
