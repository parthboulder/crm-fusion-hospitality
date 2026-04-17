/**
 * Login page — email/password + optional MFA code.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { api, ApiError } from '../lib/api-client';
import { useAuthStore } from '../store/auth.store';
import { supabase } from '../lib/supabase';

interface LoginResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      email: string;
      fullName: string;
      role: string;
      orgId: string;
    };
  };
}

interface MeResponse {
  success: boolean;
  data: { user: { permissions: string[] } };
}

export function LoginPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  async function handleMicrosoftLogin() {
    setError('');
    setOauthLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          scopes: 'email profile openid',
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setOauthLoading(false);
      }
    } catch {
      setError('Failed to initiate Microsoft sign-in.');
      setOauthLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post<LoginResponse>('/auth/login', {
        email,
        password,
        ...(showMfa && mfaCode ? { mfaCode } : {}),
      });

      const me = await api.get<MeResponse>('/auth/me');

      setUser({
        ...res.data.user,
        permissions: me.data.user.permissions,
      });

      navigate('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'MFA_CODE_REQUIRED') {
          setShowMfa(true);
          setError('Enter your MFA code to continue.');
        } else if (err.code === 'MFA_SETUP_REQUIRED') {
          setError('MFA setup is required for your role. Contact your administrator.');
        } else {
          setError(err.message);
        }
      } else {
        setError('An unexpected error occurred.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-600 mb-4">
            <BuildingOffice2Icon className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Fusion Hospitality</h1>
          <p className="text-sm text-gray-400 mt-1">Sign in to your account</p>
        </div>

        <div className="card p-6">
          {error && (
            <div className="px-3 py-2 mb-4 text-sm text-danger-600 bg-danger-50 rounded-lg border border-danger-100">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={oauthLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium
                       text-gray-700 bg-white border border-gray-300 rounded-lg
                       hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
              <rect x="1" y="1" width="9" height="9" fill="#F25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
              <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
            </svg>
            {oauthLoading ? 'Redirecting…' : 'Sign in with Microsoft'}
          </button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-gray-400">or</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                           placeholder:text-gray-300"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            {showMfa && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="mfa">
                  Authenticator Code
                </label>
                <input
                  id="mfa"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                             tracking-widest text-center font-mono"
                  placeholder="000000"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Internal use only · Fusion Hospitality Group
        </p>
      </div>
    </div>
  );
}
