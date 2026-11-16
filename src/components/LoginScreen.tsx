import React, { useState } from 'react';
import { Lock, ArrowRight, ShieldCheck, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import type { UserAccount } from '../../shared/types';

interface LoginScreenProps {
  onSuccess: (user: UserAccount) => void;
}

type AuthMode = 'login' | 'setup_owner' | 'forgot' | 'reset_token';

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  async function checkIfSetupRequired(targetEmail: string): Promise<boolean> {
    if (!targetEmail.trim()) return false;
    try {
      const status = await api.accountStatus(targetEmail.trim());
      if (status.exists && status.password_setup_required) {
        setMode('setup_owner');
        setPassword('');
        setConfirmPassword('');
        setError('');
        setInfo(
          status.is_owner
            ? 'Owner Super Admin account recognized. Create your private password below to complete initial setup.'
            : 'This account requires initial password setup before signing in.'
        );
        return true;
      }
    } catch {
      // ignore pre-check errors
    }
    return false;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const needsSetup = await checkIfSetupRequired(email);
      if (needsSetup) {
        setLoading(false);
        return;
      }
      const { user } = await api.login(email.trim(), password);
      onSuccess(user);
    } catch (err: any) {
      const msg = err?.message || 'Sign-in failed';
      if (msg.toLowerCase().includes('initial password setup')) {
        setMode('setup_owner');
        setInfo('Owner account requires initial password setup. Choose your password below.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 10) {
      setError('Password must be at least 10 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.setupPassword(email.trim(), password);
      onSuccess(user);
    } catch (err: any) {
      setError(err?.message || 'Unable to set password');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setInfo(res.message + ' Enter the server-issued reset token below.');
      setMode('reset_token');
    } catch (err: any) {
      setError(err?.message || 'Reset request failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetWithToken(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 10) {
      setError('New password must be at least 10 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.resetPassword(email.trim(), resetToken.trim(), password);
      onSuccess(user);
    } catch (err: any) {
      setError(err?.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F19] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8">
        <div className="mb-7">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 text-xs font-medium tracking-wide mb-2">
            <ShieldCheck className="w-4 h-4" />
            <span>Authenticated Workspace</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            AI BUYER HUNTER
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
            Global digital-services buyer discovery, intent verification, and client acquisition console.
          </p>
        </div>

        {info && (
          <div className="mb-4 p-3 text-xs text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-md">
            {info}
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                required
                placeholder="Enter your workspace email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => checkIfSetupRequired(email)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {error && (
              <div className="p-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Lock className="w-4 h-4" />
              <span>{loading ? 'Verifying Session...' : 'Sign In to Dashboard'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-center justify-between pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setError('');
                  setInfo('');
                }}
                className="text-blue-700 dark:text-blue-400 hover:underline"
              >
                Forgot / Reset Password
              </button>
              <button
                type="button"
                onClick={() => checkIfSetupRequired(email)}
                className="text-slate-600 dark:text-slate-400 hover:underline"
              >
                First-time Owner Setup
              </button>
            </div>
          </form>
        )}

        {mode === 'setup_owner' && (
          <form onSubmit={handleSetupPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Owner / Account Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Create New Password (min 10 characters)
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            {error && (
              <div className="p-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md"
            >
              <KeyRound className="w-4 h-4" />
              <span>{loading ? 'Securing Account...' : 'Set Password & Sign In'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setInfo('');
              }}
              className="w-full text-center text-xs text-slate-600 dark:text-slate-400 hover:underline"
            >
              Back to Sign In
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Account Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            {error && <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
            >
              {loading ? 'Issuing Reset Token...' : 'Request Password Reset Token'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setInfo('');
              }}
              className="w-full text-center text-xs text-slate-600 dark:text-slate-400 hover:underline"
            >
              Back to Sign In
            </button>
          </form>
        )}

        {mode === 'reset_token' && (
          <form onSubmit={handleResetWithToken} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                One-Time Reset Token
              </label>
              <input
                type="text"
                required
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                New Password (min 10 characters)
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            {error && <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
            >
              {loading ? 'Updating Password...' : 'Complete Password Reset'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
