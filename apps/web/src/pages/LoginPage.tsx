/**
 * Login page — email/password + optional MFA code.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { api, ApiError } from '../lib/api-client';
import { useAuthStore } from '../store/auth.store';

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
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="px-3 py-2 text-sm text-danger-600 bg-danger-50 rounded-lg border border-danger-100">
                {error}
              </div>
            )}

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
