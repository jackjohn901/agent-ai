import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { api, hasPermission } from '../lib/api';
import { authorizeGmailAccount, clearCachedGmailToken, getCachedGmailToken } from '../lib/gmailOAuth';
import type { EmailAccount, UserAccount } from '../../shared/types';

type ConnectMode = 'gmail_oauth' | 'microsoft_oauth' | 'smtp' | 'resend_api' | 'sendgrid_api' | 'sandbox_test';

export function EmailAccountsPage({ user }: { user: UserAccount }) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [limits, setLimits] = useState<any>(null);
  const [mode, setMode] = useState<ConnectMode>('gmail_oauth');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Common form state
  const [emailAddress, setEmailAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [dailyLimit, setDailyLimit] = useState(100);
  const [hourlyLimit, setHourlyLimit] = useState(25);

  // SMTP fields
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');

  // API key (Resend / SendGrid)
  const [apiKey, setApiKey] = useState('');

  const canConnect = hasPermission(user, 'can_connect_email_accounts');

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.getEmailAccounts();
      setAccounts(res.accounts);
      setLimits(res.user_limits);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    function handleOAuthMessage(ev: MessageEvent) {
      if (ev.data?.type === 'EMAIL_OAUTH_SUCCESS') {
        setFeedback({ ok: true, text: ev.data.message || 'Outlook / Microsoft 365 mailbox verified and connected.' });
        refresh();
      } else if (ev.data?.type === 'EMAIL_OAUTH_ERROR') {
        setFeedback({ ok: false, text: ev.data.message || 'Microsoft OAuth connection failed.' });
      }
    }
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, []);

  async function handleConnectGmail() {
    if (!canConnect) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const { email, accessToken } = await authorizeGmailAccount();
      const res = await api.connectGmailOAuthAccount(accessToken, {
        email_address: email,
        display_name: displayName.trim(),
        daily_limit: dailyLimit,
        hourly_limit: hourlyLimit,
      });
      setFeedback({
        ok: true,
        text: `Connected & verified Gmail mailbox (${res.account.email_address}). Ready to approve & send emails.`,
      });
      setDisplayName('');
      await refresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Gmail OAuth authorization cancelled or failed.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConnectMicrosoft() {
    if (!canConnect) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const { url } = await api.getMicrosoftOAuthUrl(displayName.trim());
      const popup = window.open(url, 'm365_oauth_popup', 'width=560,height=680');
      if (!popup) {
        setFeedback({ ok: false, text: 'Popup blocked by browser. Allow popups for this site and try again.' });
      }
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Microsoft 365 OAuth setup is incomplete.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateNonOAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!canConnect) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await api.createEmailAccount({
        provider: mode as 'smtp' | 'resend_api' | 'sendgrid_api' | 'sandbox_test',
        email_address: emailAddress.trim(),
        display_name: displayName.trim(),
        daily_limit: dailyLimit,
        hourly_limit: hourlyLimit,
        credentials:
          mode === 'smtp'
            ? {
                host: smtpHost.trim(),
                port: smtpPort,
                secure: smtpSecure,
                username: smtpUsername.trim(),
                password: smtpPassword,
              }
            : mode === 'resend_api' || mode === 'sendgrid_api'
            ? { api_key: apiKey.trim() }
            : {},
      });
      const testRes = res.test_result;
      setFeedback({
        ok: Boolean(testRes?.ok),
        text: testRes?.message || 'Account created.',
      });
      if (testRes?.ok) {
        setEmailAddress('');
        setDisplayName('');
        setSmtpPassword('');
        setApiKey('');
      }
      await refresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Failed to connect email account' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestAccount(acc: EmailAccount) {
    setTestingId(acc.id);
    setFeedback(null);
    try {
      let gmailToken: string | undefined;
      if (acc.provider === 'gmail_oauth') {
        gmailToken = getCachedGmailToken(acc.email_address);
        if (!gmailToken) {
          const authRes = await authorizeGmailAccount();
          gmailToken = authRes.accessToken;
        }
      }
      const res = await api.testEmailAccount(acc.id, gmailToken);
      setFeedback({ ok: res.ok, text: res.message });
      await refresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Connection test failed' });
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggleActive(acc: EmailAccount) {
    await api.updateEmailAccount(acc.id, { is_active: !acc.is_active });
    await refresh();
  }

  async function handleDelete(acc: EmailAccount) {
    if (acc.provider === 'gmail_oauth') {
      clearCachedGmailToken(acc.email_address);
    }
    await api.deleteEmailAccount(acc.id);
    await refresh();
  }

  function statusClass(status: EmailAccount['status']) {
    switch (status) {
      case 'CONNECTED':
        return 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20';
      case 'UNTESTED':
        return 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400';
      default:
        return 'border-red-300 dark:border-red-800 text-red-700 dark:text-red-400';
    }
  }

  return (
    <div className="space-y-6">
      {/* Sending Quota & Concurrency Summary */}
      {limits && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500">User Daily Quota</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
              {limits.sentToday} / {limits.dailyLimit}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {limits.isOwner ? 'Owner Configurable Limit' : 'Assigned User Quota'}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500">User Hourly Quota</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
              {limits.sentThisHour} / {limits.hourlyLimit}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Rolling hourly rate guard</div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500">Concurrent Send Limit</div>
            <div className="text-xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400 mt-1">
              {limits.activeConcurrent} / {limits.maxConcurrent}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {limits.isOwner ? 'Configurable in Owner Settings' : 'Default 5 concurrent max'}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500">Verified Accounts Ready</div>
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
              {accounts.filter((a) => a.status === 'CONNECTED' && a.is_active).length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Tested &amp; active senders</div>
          </div>
        </div>
      )}

      {/* Connect Email Account Panel */}
      {canConnect && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Connect Email Sending Accounts
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Connect multiple verified Gmail, Outlook/Microsoft 365, SMTP, Resend, SendGrid, or Safe Sandbox Test accounts. Credentials are encrypted with AES-256-GCM and live-tested before marking CONNECTED.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(
              [
                ['gmail_oauth', 'Gmail / Workspace OAuth'],
                ['microsoft_oauth', 'Outlook / Microsoft 365'],
                ['smtp', 'Custom SMTP / Domain'],
                ['resend_api', 'Resend API'],
                ['sendgrid_api', 'SendGrid API'],
                ['sandbox_test', 'Safe Sandbox Test'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setMode(k);
                  setFeedback(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                  mode === k
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'gmail_oauth' && (
            <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Sender Display Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Shedrack Emmanuel"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Daily Account Quota</label>
                  <input
                    type="number"
                    min={1}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Hourly Account Quota</label>
                  <input
                    type="number"
                    min={1}
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    Uses provisioned Google Workspace OAuth (`gmail.send`, `gmail.readonly`, `userinfo.email`). OAuth access tokens remain in browser memory only.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleConnectGmail}
                  className="inline-flex items-center gap-2 px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  <span>Authorize &amp; Connect Gmail</span>
                </button>
              </div>
            </div>
          )}

          {mode === 'microsoft_oauth' && (
            <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md space-y-3 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Sender Display Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Sales Team"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleConnectMicrosoft}
                    className="inline-flex items-center gap-2 px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                    <span>Connect Outlook / Microsoft 365</span>
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Requires Super Admin to configure Microsoft Entra App Client ID &amp; Client Secret in Integrations &amp; API Settings.
              </p>
            </div>
          )}

          {(mode === 'smtp' || mode === 'resend_api' || mode === 'sendgrid_api' || mode === 'sandbox_test') && (
            <form onSubmit={handleCreateNonOAuth} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Sender Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder={mode === 'sandbox_test' ? 'sandbox-sender@local.test' : 'you@yourdomain.com'}
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Display Name</label>
                  <input
                    type="text"
                    placeholder="Optional sender name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Daily Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Hourly Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>

              {mode === 'smtp' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">SMTP Host</label>
                    <input
                      type="text"
                      required
                      placeholder="smtp.zoho.com"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Port</label>
                    <input
                      type="number"
                      required
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(Number(e.target.value))}
                      className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">SMTP Username</label>
                    <input
                      type="text"
                      required
                      value={smtpUsername}
                      onChange={(e) => setSmtpUsername(e.target.value)}
                      className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">SMTP Password / App Pass</label>
                    <input
                      type="password"
                      required
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smtpSecure}
                        onChange={(e) => setSmtpSecure(e.target.checked)}
                      />
                      <span>Use SSL/TLS (port 465)</span>
                    </label>
                  </div>
                </div>
              )}

              {(mode === 'resend_api' || mode === 'sendgrid_api') && (
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {mode === 'resend_api' ? 'Resend API Key' : 'SendGrid API Key'}
                  </label>
                  <input
                    type="password"
                    required
                    placeholder={mode === 'resend_api' ? 're_...' : 'SG....'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full max-w-md px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              )}

              {mode === 'sandbox_test' && (
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-[11px] text-slate-600 dark:text-slate-300">
                  Safe Sandbox Test delivers approved emails to the internal Sandbox Outbox instead of contacting external mail servers. Recipients matching <span className="font-mono">bounce@...</span> or <span className="font-mono">*.invalid</span> automatically simulate a hard bounce and opt-out suppression.
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{submitting ? 'Verifying Connection...' : 'Save & Test Connection'}</span>
                </button>
              </div>
            </form>
          )}

          {feedback && (
            <div
              className={`p-3 border rounded-md text-xs flex items-center gap-2 ${
                feedback.ok
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                  : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
              }`}
            >
              {feedback.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{feedback.text}</span>
            </div>
          )}
        </div>
      )}

      {/* Connected Accounts List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Configured Sending Accounts ({accounts.length})
            </h3>
            <p className="text-xs text-slate-500">
              Only accounts with status CONNECTED can be selected during human approval and sending.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-xs text-slate-500">Loading email accounts...</div>
        ) : accounts.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No email sending accounts connected yet. Connect Gmail, Outlook, SMTP, Resend, SendGrid, or Safe Sandbox Test above.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {accounts.map((acc) => {
              const hasMemToken = acc.provider === 'gmail_oauth' ? Boolean(getCachedGmailToken(acc.email_address)) : true;
              return (
                <div key={acc.id} className="p-5 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{acc.email_address}</span>
                      {acc.display_name && <span className="text-slate-500">({acc.display_name})</span>}
                      <span className={`px-2 py-0.5 text-[11px] font-medium border rounded ${statusClass(acc.status)}`}>
                        {acc.status}
                      </span>
                      {!acc.is_active && (
                        <span className="text-[11px] text-slate-500 font-mono">[Paused]</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      Provider: {acc.provider} · Today: {acc.sent_today}/{acc.daily_limit} · Hour: {acc.sent_this_hour}/
                      {acc.hourly_limit} · Tested: {acc.last_tested_at || 'Never'}
                      {acc.owner_email ? ` · Owner: ${acc.owner_email}` : ''}
                    </div>
                    {acc.provider === 'gmail_oauth' && !hasMemToken && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400">
                        Browser OAuth session not in memory — click Test / Re-authorize before sending via Gmail API.
                      </div>
                    )}
                    {acc.last_error && (
                      <div className="text-[11px] text-red-600 dark:text-red-400">{acc.last_error}</div>
                    )}
                  </div>

                  {canConnect && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={testingId === acc.id}
                        onClick={() => handleTestAccount(acc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30 whitespace-nowrap"
                      >
                        {testingId === acc.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        <span>{acc.provider === 'gmail_oauth' ? 'Authorize / Test Gmail' : 'Test Connection'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(acc)}
                        className="px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        {acc.is_active ? 'Pause' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(acc)}
                        className="p-1.5 text-slate-400 hover:text-red-600"
                        title="Disconnect account"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
