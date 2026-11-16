import React, { useEffect, useState } from 'react';
import {
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  ShieldCheck,
  KeyRound,
  Lock,
  Rss,
  Loader2,
} from 'lucide-react';
import { api, canOperate, downloadAuthenticatedFile, isAdmin, isSuperAdmin } from '../lib/api';
import type {
  AgentConfig,
  AppSettings,
  CustomCommunityFeed,
  PlatformConnector,
  ResearchLogItem,
  SearchSchedule,
  UserAccount,
} from '../../shared/types';

export function PlatformIntegrationsPage({
  platforms,
  user,
  settings,
  onUpdate,
  onSaveSettings,
}: {
  platforms: PlatformConnector[];
  user: UserAccount;
  settings?: AppSettings | null;
  onUpdate: (platforms: PlatformConnector[]) => void;
  onSaveSettings?: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const superAdmin = isSuperAdmin(user);
  const [subTab, setSubTab] = useState<'connectors' | 'email_oauth' | 'runtime_webhooks'>('connectors');
  const [integrations, setIntegrations] = useState<PlatformConnector[]>(platforms);
  const [customFeeds, setCustomFeeds] = useState<CustomCommunityFeed[]>([]);
  const [emailOAuthCfg, setEmailOAuthCfg] = useState<any>(null);
  const [msClientId, setMsClientId] = useState('');
  const [msClientSecret, setMsClientSecret] = useState('');
  const [msTenantId, setMsTenantId] = useState('common');
  const [msSaving, setMsSaving] = useState(false);
  const [msMsg, setMsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(superAdmin);
  const [filterMode, setFilterMode] = useState<'ALL' | 'READY' | 'NEEDS_SETUP' | 'APPROVAL'>('ALL');

  const [testingAll, setTestingAll] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCreds, setDraftCreds] = useState<Record<string, string>>({});
  const [savingCreds, setSavingCreds] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [globalBanner, setGlobalBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // Custom Community Feed state
  const [feedName, setFeedName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedType, setFeedType] = useState<'RSS' | 'JSON'>('RSS');
  const [addingFeed, setAddingFeed] = useState(false);
  const [feedMsg, setFeedMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refreshIntegrations() {
    if (!superAdmin) return;
    const res = await api.getIntegrations();
    setIntegrations(res.integrations);
    setCustomFeeds(res.custom_feeds);
    setEmailOAuthCfg(res.email_oauth_config || null);
    if (res.email_oauth_config?.microsoft_365?.tenant_id) {
      setMsTenantId(res.email_oauth_config.microsoft_365.tenant_id);
    }
    onUpdate(res.integrations);
  }

  useEffect(() => {
    if (!superAdmin) {
      setIntegrations(platforms);
      return;
    }
    setLoading(true);
    refreshIntegrations()
      .catch((err: any) => {
        setGlobalBanner({ ok: false, text: err?.message || 'Failed to load integration vault' });
      })
      .finally(() => setLoading(false));
  }, [superAdmin]);

  useEffect(() => {
    if (!superAdmin) setIntegrations(platforms);
  }, [platforms, superAdmin]);

  async function handleSaveMicrosoftOAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!superAdmin) return;
    setMsSaving(true);
    setMsMsg(null);
    try {
      await api.saveMicrosoftOAuthConfig({
        client_id: msClientId.trim() || undefined,
        client_secret: msClientSecret.trim() || undefined,
        tenant_id: msTenantId.trim() || 'common',
      });
      setMsClientId('');
      setMsClientSecret('');
      await refreshIntegrations();
      setMsMsg({ ok: true, text: 'Microsoft 365 OAuth credentials encrypted and stored.' });
    } catch (err: any) {
      setMsMsg({ ok: false, text: err?.message || 'Failed to save Microsoft OAuth configuration' });
    } finally {
      setMsSaving(false);
    }
  }

  async function handleTestAll() {
    if (!superAdmin) return;
    setTestingAll(true);
    setGlobalBanner(null);
    try {
      const res = await api.testAllIntegrations();
      setIntegrations(res.integrations);
      setCustomFeeds(res.custom_feeds);
      onUpdate(res.integrations);
      const readyCount = res.integrations.filter((p) => p.status === 'READY').length;
      setGlobalBanner({
        ok: true,
        text: `Live verification completed: ${readyCount} data connector(s) verified READY.`,
      });
    } catch (err: any) {
      setGlobalBanner({ ok: false, text: err?.message || 'Failed to test connectors' });
    } finally {
      setTestingAll(false);
    }
  }

  async function handleTestOne(id: string) {
    if (!superAdmin) return;
    setTestingId(id);
    try {
      const res = await api.testIntegration(id);
      setIntegrations(res.integrations);
      setCustomFeeds(res.custom_feeds);
      onUpdate(res.integrations);
      setFeedback((prev) => ({
        ...prev,
        [id]: { ok: res.result.ok, text: res.result.message },
      }));
    } catch (err: any) {
      setFeedback((prev) => ({
        ...prev,
        [id]: { ok: false, text: err?.message || 'Connection test failed' },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function toggle(p: PlatformConnector) {
    if (!superAdmin) return;
    const res = await api.togglePlatform(p.id, !p.is_enabled);
    onUpdate(res.platforms);
    setIntegrations((prev) =>
      prev.map((item) => {
        const updated = res.platforms.find((u) => u.id === item.id);
        return updated ? { ...item, is_enabled: updated.is_enabled } : item;
      })
    );
  }

  function startEditing(p: PlatformConnector) {
    setEditingId(editingId === p.id ? null : p.id);
    setDraftCreds({});
  }

  async function handleSaveCredentials(e: React.FormEvent, p: PlatformConnector) {
    e.preventDefault();
    if (!superAdmin) return;
    setSavingCreds(true);
    try {
      const res = await api.saveIntegrationCredentials(p.id, draftCreds);
      setIntegrations(res.integrations);
      onUpdate(res.integrations);
      setEditingId(null);
      setDraftCreds({});
      setFeedback((prev) => ({
        ...prev,
        [p.id]: { ok: true, text: res.message },
      }));
      // Automatically run live connection test right after saving credentials so status only turns READY if valid
      setTestingId(p.id);
      const testRes = await api.testIntegration(p.id);
      setIntegrations(testRes.integrations);
      setCustomFeeds(testRes.custom_feeds);
      onUpdate(testRes.integrations);
      setFeedback((prev) => ({
        ...prev,
        [p.id]: { ok: testRes.result.ok, text: testRes.result.message },
      }));
    } catch (err: any) {
      setFeedback((prev) => ({
        ...prev,
        [p.id]: { ok: false, text: err?.message || 'Failed to save credentials' },
      }));
    } finally {
      setSavingCreds(false);
      setTestingId(null);
    }
  }

  async function handleClearCredentials(id: string) {
    if (!superAdmin) return;
    try {
      const res = await api.clearIntegrationCredentials(id);
      setIntegrations(res.integrations);
      onUpdate(res.integrations);
      setEditingId(null);
      setDraftCreds({});
      setFeedback((prev) => ({
        ...prev,
        [id]: { ok: true, text: 'Stored credentials removed.' },
      }));
    } catch (err: any) {
      setFeedback((prev) => ({
        ...prev,
        [id]: { ok: false, text: err?.message || 'Failed to clear credentials' },
      }));
    }
  }

  async function handleAddCustomFeed(e: React.FormEvent) {
    e.preventDefault();
    if (!superAdmin || !feedName.trim() || !feedUrl.trim()) return;
    setAddingFeed(true);
    setFeedMsg(null);
    try {
      const res = await api.addCustomFeed({
        name: feedName.trim(),
        url: feedUrl.trim(),
        feed_type: feedType,
      });
      setCustomFeeds(res.custom_feeds);
      setIntegrations(res.integrations);
      onUpdate(res.integrations);
      setFeedName('');
      setFeedUrl('');
      setFeedMsg({ ok: res.testResult.ok, text: res.testResult.message });
    } catch (err: any) {
      setFeedMsg({ ok: false, text: err?.message || 'Failed to register custom feed' });
    } finally {
      setAddingFeed(false);
    }
  }

  async function handleTestCustomFeed(feedId: number) {
    if (!superAdmin) return;
    try {
      const res = await api.testCustomFeed(feedId);
      setCustomFeeds(res.custom_feeds);
      setIntegrations(res.integrations);
      onUpdate(res.integrations);
      setFeedMsg({ ok: res.testResult.ok, text: res.testResult.message });
    } catch (err: any) {
      setFeedMsg({ ok: false, text: err?.message || 'Feed test failed' });
    }
  }

  async function handleDeleteCustomFeed(feedId: number) {
    if (!superAdmin) return;
    const res = await api.deleteCustomFeed(feedId);
    setCustomFeeds(res.custom_feeds);
    setIntegrations(res.integrations);
    onUpdate(res.integrations);
  }

  const readyCount = integrations.filter((p) => p.status === 'READY' && p.is_enabled).length;
  const setupCount = integrations.filter((p) => p.status === 'MISSING_CREDENTIALS' || p.status === 'UNTESTED').length;
  const approvalCount = integrations.filter((p) => p.status === 'APPROVAL_REQUIRED').length;

  const filteredIntegrations = integrations.filter((p) => {
    if (filterMode === 'READY') return p.status === 'READY';
    if (filterMode === 'NEEDS_SETUP')
      return p.status === 'MISSING_CREDENTIALS' || p.status === 'UNTESTED' || p.status === 'ERROR';
    if (filterMode === 'APPROVAL') return Boolean(p.requires_approval);
    return true;
  });

  function statusStyle(status: PlatformConnector['status']) {
    switch (status) {
      case 'READY':
        return 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20';
      case 'MANUAL_ONLY':
        return 'border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/20';
      case 'APPROVAL_REQUIRED':
        return 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300';
      case 'MISSING_CREDENTIALS':
      case 'UNTESTED':
        return 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400';
      default:
        return 'border-red-300 dark:border-red-800 text-red-700 dark:text-red-400';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Summary */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Integrations &amp; API Settings (Encrypted Vault)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
              Configure discovery API keys, email provider OAuth credentials (Gmail &amp; Microsoft 365), custom business feeds, and outbound webhooks.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
              {[
                ['connectors', 'Data Sources'],
                ['email_oauth', 'Email OAuth'],
                ['runtime_webhooks', 'API & Webhooks'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSubTab(id as any)}
                  className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
                    subTab === id
                      ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm text-slate-900 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {superAdmin && subTab === 'connectors' && (
              <button
                type="button"
                onClick={handleTestAll}
                disabled={testingAll || loading}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md whitespace-nowrap shrink-0"
              >
                {testingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>{testingAll ? 'Testing Connections...' : 'Test All Connectors'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="text-slate-500">Verified Ready</div>
            <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
              {readyCount}
            </div>
          </div>
          <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="text-slate-500">Needs Credentials / Test</div>
            <div className="text-lg font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400 mt-0.5">
              {setupCount}
            </div>
          </div>
          <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="text-slate-500">Partner Approval Gated</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
              {approvalCount}
            </div>
          </div>
          <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="text-slate-500">Verified Custom Feeds</div>
            <div className="text-lg font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400 mt-0.5">
              {customFeeds.filter((f) => f.status === 'READY').length}
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {[
            { id: 'ALL', label: `All Connectors (${integrations.length})` },
            { id: 'READY', label: 'Ready Only' },
            { id: 'NEEDS_SETUP', label: 'Needs Setup / Errors' },
            { id: 'APPROVAL', label: 'Requires Platform Approval' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id as any)}
              className={`px-3 py-1.5 text-xs rounded-md border whitespace-nowrap ${
                filterMode === tab.id
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 font-medium'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!superAdmin && (
          <div className="p-3.5 border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 rounded-md text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              Credential configuration, encrypted vault edits, and connector administration are restricted exclusively to the Super Admin account (shedrackemmanuelgim@gmail.com).
            </span>
          </div>
        )}

        {globalBanner && (
          <div
            className={`p-3 border rounded-md text-xs flex items-center gap-2 ${
              globalBanner.ok
                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
            }`}
          >
            {globalBanner.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{globalBanner.text}</span>
          </div>
        )}
      </div>

      {subTab === 'email_oauth' && superAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Gmail / Google Workspace OAuth
              </h3>
              <span className="px-2 py-0.5 font-mono text-[11px] border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded">
                PROVISIONED
              </span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Google Workspace Gmail OAuth is provisioned via Firebase Authentication (`gmail.send`, `gmail.readonly`, `userinfo.email`). Users can authorize their Gmail / Workspace inbox directly inside <strong>Email Accounts</strong>. Access tokens remain strictly in browser memory and are never persisted on disk.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Microsoft 365 / Outlook OAuth (Entra ID)
              </h3>
              <span
                className={`px-2 py-0.5 font-mono text-[11px] border rounded ${
                  emailOAuthCfg?.microsoft_365?.client_id_configured &&
                  emailOAuthCfg?.microsoft_365?.client_secret_configured
                    ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                    : 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                }`}
              >
                {emailOAuthCfg?.microsoft_365?.client_id_configured &&
                emailOAuthCfg?.microsoft_365?.client_secret_configured
                  ? 'CONFIGURED'
                  : 'NEEDS APP KEYS'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded">
              <div className="text-[11px] text-slate-500">Azure Entra Redirect URI (register as Web redirect URI):</div>
              <div className="font-mono text-[11px] text-blue-700 dark:text-blue-400 break-all mt-0.5">
                {emailOAuthCfg?.microsoft_365?.callback_url || '/api/email-accounts/oauth/microsoft/callback'}
              </div>
            </div>

            <form onSubmit={handleSaveMicrosoftOAuth} className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Application (Client) ID {emailOAuthCfg?.microsoft_365?.client_id_masked ? `(${emailOAuthCfg.microsoft_365.client_id_masked})` : ''}
                </label>
                <input
                  type="text"
                  placeholder="Enter Azure App Client ID"
                  value={msClientId}
                  onChange={(e) => setMsClientId(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Client Secret {emailOAuthCfg?.microsoft_365?.client_secret_masked ? `(${emailOAuthCfg.microsoft_365.client_secret_masked})` : ''}
                  </label>
                  <input
                    type="password"
                    placeholder="Enter Azure Client Secret"
                    value={msClientSecret}
                    onChange={(e) => setMsClientSecret(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Tenant ID</label>
                  <input
                    type="text"
                    placeholder="common"
                    value={msTenantId}
                    onChange={(e) => setMsTenantId(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                  />
                </div>
              </div>
              {msMsg && (
                <div className={msMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}>
                  {msMsg.text}
                </div>
              )}
              <button
                type="submit"
                disabled={msSaving}
                className="px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
              >
                {msSaving ? 'Encrypting...' : 'Save Microsoft 365 OAuth App'}
              </button>
            </form>
          </div>
        </div>
      )}

      {subTab === 'runtime_webhooks' && (
        <ApiConfigurationPage
          settings={settings || null}
          user={user}
          onSaveSettings={onSaveSettings || (async () => {})}
        />
      )}

      {/* Connector Cards */}
      {subTab === 'connectors' && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredIntegrations.map((p) => {
          const fields = p.credential_fields || [];
          const hasConfiguredField = fields.some((f) => f.configured);
          const isEditing = editingId === p.id;
          const isTesting = testingId === p.id;
          const fb = feedback[p.id];

          return (
            <div
              key={p.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {p.category} · {p.connection_type.replace(/_/g, ' ')}
                      {p.requires_approval ? ' · Partner Approval Required' : ''}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded border whitespace-nowrap shrink-0 ${statusStyle(
                      p.status
                    )}`}
                  >
                    {p.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{p.description}</p>

                {p.setup_instructions && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 rounded px-3 py-2">
                    {p.setup_instructions}
                  </div>
                )}

                {/* Encrypted credential summary for Super Admin */}
                {superAdmin && fields.length > 0 && (
                  <div className="space-y-1.5 text-[11px]">
                    {fields.map((f) => (
                      <div key={f.key} className="flex items-center justify-between gap-2 font-mono">
                        <span className="text-slate-500">{f.label}:</span>
                        <span className={f.configured ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}>
                          {f.configured ? f.masked : 'Not configured'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {p.last_error && (
                  <div className="text-[11px] text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-2.5 py-1.5">
                    {p.last_error}
                  </div>
                )}

                {fb && (
                  <div
                    className={`text-[11px] px-2.5 py-1.5 rounded border ${
                      fb.ok
                        ? 'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20'
                    }`}
                  >
                    {fb.text}
                  </div>
                )}

                {/* Super Admin Credential Entry Form */}
                {superAdmin && isEditing && fields.length > 0 && (
                  <form
                    onSubmit={(e) => handleSaveCredentials(e, p)}
                    className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md space-y-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      <span>Encrypted Credential Vault ({p.name})</span>
                    </div>
                    {fields.map((f) => (
                      <div key={f.key}>
                        <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                          {f.label} {f.configured ? '(enter new value to rotate)' : ''}
                        </label>
                        <input
                          type={f.type === 'secret' ? 'password' : 'text'}
                          autoComplete="off"
                          placeholder={f.configured ? `Saved (${f.masked}) — leave blank to keep` : f.placeholder}
                          value={draftCreds[f.key] || ''}
                          onChange={(e) => setDraftCreds((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      {hasConfiguredField ? (
                        <button
                          type="button"
                          onClick={() => handleClearCredentials(p.id)}
                          className="text-[11px] text-red-600 hover:underline"
                        >
                          Clear Stored Credentials
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Encrypted with AES-256-GCM at rest</span>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingCreds}
                          className="px-3 py-1 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded whitespace-nowrap"
                        >
                          {savingCreds ? 'Encrypting & Testing...' : 'Save & Test'}
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="text-slate-500">
                  <span>{p.rate_limit_info}</span>
                  {p.last_checked_at && <span className="ml-2 font-mono">· Tested {p.last_checked_at}</span>}
                </div>

                {superAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    {fields.length > 0 && (
                      <button
                        type="button"
                        onClick={() => startEditing(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>{hasConfiguredField ? 'Update Keys' : 'Configure Keys'}</span>
                      </button>
                    )}

                    {p.connection_type !== 'MANUAL_CAPTURE' && (
                      <button
                        type="button"
                        disabled={isTesting}
                        onClick={() => handleTestOne(p.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30 whitespace-nowrap"
                      >
                        {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        <span>Test Connection</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      className="px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      {p.is_enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Modular Custom Business Community Feeds (RSS / JSON) */}
      {superAdmin && subTab === 'connectors' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Rss className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Modular Custom Business Communities (Public RSS / JSON Feeds)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extend buyer discovery to additional startup boards, agency RFP feeds, or public tech communities without modifying code.
              </p>
            </div>
          </div>

          <form onSubmit={handleAddCustomFeed} className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
            <input
              type="text"
              required
              placeholder="Community Name (e.g. Dev.to Hiring Feed)"
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
              className="md:col-span-3 px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <input
              type="url"
              required
              placeholder="https://dev.to/api/articles?tag=hiring"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              className="md:col-span-5 px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <select
              value={feedType}
              onChange={(e) => setFeedType(e.target.value as 'RSS' | 'JSON')}
              className="md:col-span-2 px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            >
              <option value="RSS">RSS / Atom</option>
              <option value="JSON">JSON Feed</option>
            </select>
            <button
              type="submit"
              disabled={addingFeed}
              className="md:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
            >
              {addingFeed ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Add &amp; Test</span>
            </button>
          </form>

          {feedMsg && (
            <div
              className={`text-xs px-3 py-2 rounded border ${
                feedMsg.ok
                  ? 'border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                  : 'border-red-200 dark:border-red-900 text-red-600 dark:text-red-400'
              }`}
            >
              {feedMsg.text}
            </div>
          )}

          {customFeeds.length === 0 ? (
            <div className="text-xs text-slate-500 py-2">
              No custom community feeds added yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {customFeeds.map((f) => (
                <div key={f.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {f.name} · <span className="font-mono text-[11px] text-slate-500">{f.feed_type}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 truncate max-w-xl">{f.url}</div>
                    {f.last_error && <div className="text-[11px] text-red-600 mt-0.5">{f.last_error}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                        f.status === 'READY'
                          ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                          : 'border-red-300 dark:border-red-800 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {f.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTestCustomFeed(f.id)}
                      className="px-2 py-1 text-[11px] border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomFeed(f.id)}
                      className="p-1 text-slate-400 hover:text-red-600"
                      title="Remove custom feed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiConfigurationPage({
  settings,
  user,
  onSaveSettings,
}: {
  settings: AppSettings | null;
  user: UserAccount;
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const superAdmin = isSuperAdmin(user);
  const [runtime, setRuntime] = useState<Record<string, any> | null>(null);
  const [webhook, setWebhook] = useState(settings?.n8n_webhook_url || '');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (superAdmin) {
      api.getRuntimeStatus().then(setRuntime).catch(() => {});
    }
  }, [superAdmin]);

  useEffect(() => {
    if (settings) setWebhook(settings.n8n_webhook_url || '');
  }, [settings?.n8n_webhook_url]);

  async function saveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!superAdmin) return;
    await onSaveSettings({ n8n_webhook_url: webhook.trim() });
    setSaved('Webhook integration updated.');
  }

  if (!superAdmin) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-3">
        <Lock className="w-4 h-4 text-amber-600 shrink-0" />
        <span>
          API Configuration &amp; Runtime Secrets overview is restricted exclusively to the Super Admin account (shedrackemmanuelgim@gmail.com).
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Server Runtime &amp; Encrypted Vault Integration Status
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          API secrets are encrypted at rest with AES-256-GCM on the server or loaded from runtime environment Secrets—never exposed to browser bundles.
        </p>

        {runtime && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5 text-xs">
            <StatusTile label="Google Search Grounding (Runtime)" ok={runtime.gemini_configured} detail="GEMINI_API_KEY (Secrets panel)" />
            <StatusTile label="Google Custom Search API" ok={runtime.google_custom_search_configured} detail="Encrypted Vault / GOOGLE_SEARCH_API_KEY + CX" />
            <StatusTile label="Reddit OAuth API" ok={runtime.reddit_oauth_configured} detail="Encrypted Vault / REDDIT_CLIENT_ID + SECRET" />
            <StatusTile label="GitHub Personal Access Token" ok={runtime.github_token_configured} detail="Optional PAT (public search works without)" />
            <StatusTile label="LinkedIn Marketing API" ok={runtime.linkedin_configured} detail="Partner Approval + OAuth Token" />
            <StatusTile label="Upwork GraphQL API" ok={runtime.upwork_configured} detail="Partner Approval + OAuth Token" />
            <StatusTile label="Fiverr Partner API" ok={runtime.fiverr_configured} detail="Partner Approval Required" />
            <StatusTile label="Meta Graph API (FB/IG)" ok={runtime.meta_configured} detail="App Review + Page Token" />
            <StatusTile label="X (Twitter) v2 API" ok={runtime.x_configured} detail="Bearer Token (Basic/Pro tier)" />
            <StatusTile label="Bing Web Search API" ok={runtime.bing_configured} detail="Azure Bing v7 Key" />
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            External Workflow Automation (n8n / Webhook)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Automatically POST newly discovered Hot Leads (score 80+) to an authorized n8n workflow or Slack/CRM webhook.
          </p>
        </div>

        <form onSubmit={saveWebhook} className="flex flex-wrap gap-3">
          <input
            type="url"
            placeholder="https://your-n8n-instance.example/webhook/hot-leads"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            className="flex-1 min-w-[260px] px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
          />
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
          >
            Save Webhook
          </button>
        </form>
        {saved && <div className="text-xs text-emerald-700 dark:text-emerald-400">{saved}</div>}
      </div>
    </div>
  );
}

function StatusTile({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="p-3.5 border border-slate-200 dark:border-slate-800 rounded-md flex items-start justify-between gap-2">
      <div>
        <div className="font-medium text-slate-900 dark:text-slate-100">{label}</div>
        <div className="text-[11px] font-mono text-slate-500 mt-0.5">{detail}</div>
      </div>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Configured</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 font-medium shrink-0">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Not Set</span>
        </span>
      )}
    </div>
  );
}

export function AiAgentManagementPage({
  agents,
  user,
  onUpdateAgents,
}: {
  agents: AgentConfig[];
  user: UserAccount;
  onUpdateAgents: (agents: AgentConfig[]) => void;
}) {
  const [schedules, setSchedules] = useState<SearchSchedule[]>([]);
  const [schedName, setSchedName] = useState('');
  const [schedFreq, setSchedFreq] = useState(120);

  useEffect(() => {
    api.getSchedules().then((r) => setSchedules(r.schedules));
  }, []);

  const canEdit = canOperate(user);

  async function toggleAgent(a: AgentConfig) {
    if (!isSuperAdmin(user)) return;
    const res = await api.toggleAgent(a.id, !a.is_enabled);
    onUpdateAgents(res.agents);
  }

  async function createSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!schedName.trim() || !canEdit) return;
    const res = await api.createSchedule({
      name: schedName.trim(),
      services: ['All Services'],
      platforms: ['google_custom_search', 'google_search_grounding', 'reddit_api', 'hacker_news_api'],
      countries: ['Worldwide'],
      frequency_minutes: schedFreq,
      is_active: true,
    });
    setSchedules(res.schedules);
    setSchedName('');
  }

  async function toggleSchedule(s: SearchSchedule) {
    if (!canEdit) return;
    const res = await api.toggleSchedule(s.id, !s.is_active);
    setSchedules(res.schedules);
  }

  async function deleteSchedule(id: number) {
    if (!canEdit) return;
    await api.deleteSchedule(id);
    setSchedules((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          8-Agent Intelligence Architecture
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Specialized agents execute sequentially for discovery, intent verification, BI, budgeting, deduplication, scoring, outreach, and conversion.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          {agents.map((a) => (
            <div key={a.id} className="p-4 border border-slate-200 dark:border-slate-800 rounded-md space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    0{a.agent_number}. {a.name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">{a.model_name}</div>
                </div>
                <button
                  disabled={!isSuperAdmin(user)}
                  onClick={() => toggleAgent(a)}
                  className={`px-2 py-0.5 text-[11px] rounded border ${
                    a.is_enabled
                      ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-300 text-slate-500'
                  }`}
                >
                  {a.is_enabled ? 'Active' : 'Paused'}
                </button>
              </div>
              <p className="text-slate-600 dark:text-slate-300">{a.role_description}</p>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                Runs: {a.runs_count} · Status: {a.last_status} · Last: {a.last_run_at || 'Never'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Automated Discovery Schedules */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Automated Discovery Schedules
          </h3>
        </div>

        {canEdit && (
          <form onSubmit={createSchedule} className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Schedule name (e.g. Hourly SaaS & AI Buyer Watch)"
              value={schedName}
              onChange={(e) => setSchedName(e.target.value)}
              className="flex-1 min-w-[240px] px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <select
              value={schedFreq}
              onChange={(e) => setSchedFreq(Number(e.target.value))}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            >
              <option value={30}>Every 30 min</option>
              <option value={60}>Every 60 min</option>
              <option value={120}>Every 2 hours</option>
              <option value={360}>Every 6 hours</option>
              <option value={1440}>Daily</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-4 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Schedule</span>
            </button>
          </form>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {schedules.map((s) => (
            <div key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">{s.name}</div>
                <div className="text-[11px] text-slate-500 font-mono">
                  Every {s.frequency_minutes}m · Platforms: {s.platforms.join(', ')} · Next: {s.next_run_at || 'Pending'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={!canEdit}
                  onClick={() => toggleSchedule(s)}
                  className={`px-2.5 py-1 text-[11px] rounded border ${
                    s.is_active
                      ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-300 text-slate-500'
                  }`}
                >
                  {s.is_active ? 'Running' : 'Paused'}
                </button>
                {canEdit && (
                  <button
                    onClick={() => deleteSchedule(s.id)}
                    className="p-1 text-slate-400 hover:text-red-600"
                    title="Delete schedule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SearchHistoryPage() {
  const [logs, setLogs] = useState<ResearchLogItem[]>([]);
  useEffect(() => {
    api.getResearchLogs().then((r) => setLogs(r.logs));
  }, []);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Research &amp; Query History</h2>
        <p className="text-xs text-slate-500">
          Every discovery query executed, including accepted buyers, rejected non-buyers (E/F), duplicates, and rejection reasons.
        </p>
      </div>
      {logs.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-500">No search runs logged yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-medium">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Platform &amp; Service</th>
                <th className="py-2.5 px-4">Query / Source</th>
                <th className="py-2.5 px-4 text-right">Found</th>
                <th className="py-2.5 px-4 text-right">Accepted</th>
                <th className="py-2.5 px-4 text-right">Rejected</th>
                <th className="py-2.5 px-4">Rejection / Error Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">{l.created_at}</td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{l.platform}</div>
                    <div className="text-[11px] text-slate-500">{l.service_category}</div>
                  </td>
                  <td className="py-2.5 px-4 max-w-xs truncate text-slate-700 dark:text-slate-300">{l.query}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{l.results_count}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                    {l.accepted_count}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                    {l.rejected_count}
                  </td>
                  <td className="py-2.5 px-4 text-[11px] text-slate-500 max-w-sm truncate">
                    {l.error_message || l.rejection_reasons.join('; ') || 'Clean'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DuplicateManagementPage() {
  const [dups, setDups] = useState<any[]>([]);
  useEffect(() => {
    api.getDuplicates().then((r) => setDups(r.duplicates));
  }, []);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Duplicate Detection &amp; Canonical Record Links
        </h2>
        <p className="text-xs text-slate-500">
          Cross-platform appearances merged into a single canonical lead by Agent 5 without losing source URLs.
        </p>
      </div>
      {dups.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-500">No duplicate cross-platform merges recorded yet.</div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {dups.map((d) => (
            <div key={d.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {d.lead_code} · {d.prospect_name} ({d.company_name || 'Individual'})
                </div>
                <div className="text-slate-500 mt-0.5">
                  Match Reason: {d.match_reason} ({d.similarity_score}% confidence)
                </div>
                <div className="text-[11px] text-blue-700 dark:text-blue-400 truncate max-w-xl mt-0.5">
                  Merged URL ({d.platform}): {d.duplicate_source_url}
                </div>
              </div>
              <div className="font-mono tabular-nums text-slate-500">{d.created_at}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SystemLogsPage({ user }: { user: UserAccount }) {
  const [tab, setTab] = useState<'audit' | 'email_queue' | 'research' | 'duplicates'>('audit');
  const [logs, setLogs] = useState<any[]>([]);
  const [queueLogs, setQueueLogs] = useState<any[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  useEffect(() => {
    api.getSystemLogs().then((r) => setLogs(r.logs)).catch(() => {});
    api.getEmailQueue().then((r) => setQueueLogs(r.queue)).catch(() => {});
  }, []);

  async function handleExport(kind: 'csv' | 'json') {
    setExportError(null);
    setExporting(kind);
    try {
      if (kind === 'csv') {
        await downloadAuthenticatedFile('/api/export/leads.csv', 'ai-buyer-hunter-leads.csv');
      } else {
        await downloadAuthenticatedFile('/api/export/backup.json', 'ai-buyer-hunter-backup.json');
      }
    } catch (err: any) {
      setExportError(err?.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            System, Email Delivery &amp; Discovery Logs
          </h2>
          <p className="text-xs text-slate-500">
            Security audit trail, email queue execution &amp; bounce logs, search history, and duplicate merges.
          </p>
          {exportError && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{exportError}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
            {[
              ['audit', 'Audit Logs'],
              ['email_queue', 'Email Queue Logs'],
              ['research', 'Discovery History'],
              ['duplicates', 'Duplicate Merges'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as any)}
                className={`px-2.5 py-1 text-xs rounded whitespace-nowrap ${
                  tab === id ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting === 'csv' ? 'Exporting CSV...' : 'Export Leads CSV'}</span>
          </button>
          {isSuperAdmin(user) && (
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport('json')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting === 'json' ? 'Exporting JSON...' : 'Full DB Backup (JSON)'}</span>
            </button>
          )}
        </div>
      </div>

      {tab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-medium">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Level</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">{l.created_at}</td>
                    <td className="py-2 px-4 font-mono">{l.level}</td>
                    <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{l.actor}</td>
                    <td className="py-2 px-4 font-medium text-slate-900 dark:text-slate-100">{l.action}</td>
                    <td className="py-2 px-4 text-slate-600 dark:text-slate-400">{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'email_queue' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          {queueLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No email queue logs yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-medium">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Sender Account</th>
                    <th className="py-2.5 px-4">Recipient</th>
                    <th className="py-2.5 px-4">Status / Attempts</th>
                    <th className="py-2.5 px-4">Result / Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {queueLogs.map((q) => (
                    <tr key={q.id}>
                      <td className="py-2 px-4 font-mono text-slate-500 whitespace-nowrap">{q.created_at}</td>
                      <td className="py-2 px-4 font-mono">{q.sending_email}</td>
                      <td className="py-2 px-4 font-mono">{q.recipient_email}</td>
                      <td className="py-2 px-4 font-mono">
                        {q.status} ({q.attempts}/{q.max_attempts})
                      </td>
                      <td className="py-2 px-4 text-slate-600 dark:text-slate-400">{q.last_error || 'Clean'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'research' && <SearchHistoryPage />}
      {tab === 'duplicates' && <DuplicateManagementPage />}
    </div>
  );
}

export function SettingsPage({
  settings,
  user,
  agents = [],
  onSaveSettings,
  onUpdateAgents,
}: {
  settings: AppSettings | null;
  user: UserAccount;
  agents?: AgentConfig[];
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onUpdateAgents?: (agents: AgentConfig[]) => void;
}) {
  const [subTab, setSubTab] = useState<'governance' | 'agents'>('governance');
  const [target30, setTarget30] = useState(String(settings?.thirty_day_revenue_target || 5000));
  const [stretch, setStretch] = useState(String(settings?.stretch_revenue_target || 25000));
  const [deadline, setDeadline] = useState(settings?.stretch_target_deadline || '2026-12-25');
  const [retention, setRetention] = useState(String(settings?.data_retention_days || 365));

  // Owner email sending & concurrency governance (Module 3)
  const [ownerDailyLimit, setOwnerDailyLimit] = useState(String(settings?.owner_daily_send_limit ?? 200));
  const [ownerHourlyLimit, setOwnerHourlyLimit] = useState(String(settings?.owner_hourly_send_limit ?? 40));
  const [ownerMaxConcurrent, setOwnerMaxConcurrent] = useState(String(settings?.owner_max_concurrent_sends ?? 10));
  const [invitedConcurrent, setInvitedConcurrent] = useState(String(settings?.invited_default_concurrent_sends ?? 5));
  const [sandboxMode, setSandboxMode] = useState(Boolean(settings?.sandbox_mode));
  const [saved, setSaved] = useState('');

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [userMsg, setUserMsg] = useState('');

  const [curPw, setCurPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [confirmNextPw, setConfirmNextPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  const adminAccess = isAdmin(user);
  const superAdminAccess = isSuperAdmin(user);

  useEffect(() => {
    if (settings) {
      setTarget30(String(settings.thirty_day_revenue_target || 5000));
      setStretch(String(settings.stretch_revenue_target || 25000));
      setDeadline(settings.stretch_target_deadline || '2026-12-25');
      setRetention(String(settings.data_retention_days || 365));
      setOwnerDailyLimit(String(settings.owner_daily_send_limit ?? 200));
      setOwnerHourlyLimit(String(settings.owner_hourly_send_limit ?? 40));
      setOwnerMaxConcurrent(String(settings.owner_max_concurrent_sends ?? 10));
      setInvitedConcurrent(String(settings.invited_default_concurrent_sends ?? 5));
      setSandboxMode(Boolean(settings.sandbox_mode));
    }
  }, [settings]);

  useEffect(() => {
    if (adminAccess) {
      api.getUsers().then((r) => setUsers(r.users)).catch(() => {});
    }
  }, [adminAccess]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved('');
    await onSaveSettings({
      thirty_day_revenue_target: Number(target30),
      stretch_revenue_target: Number(stretch),
      stretch_target_deadline: deadline,
      data_retention_days: Number(retention),
      owner_daily_send_limit: Math.max(1, Number(ownerDailyLimit)),
      owner_hourly_send_limit: Math.max(1, Number(ownerHourlyLimit)),
      owner_max_concurrent_sends: Math.max(1, Number(ownerMaxConcurrent)),
      invited_default_concurrent_sends: Math.max(1, Number(invitedConcurrent)),
      sandbox_mode: sandboxMode,
    });
    setSaved('Owner governance & email sending limits saved.');
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setUserMsg('');
    try {
      await api.createUser({ name: newName, email: newEmail, password: newPassword, role: newRole });
      const res = await api.getUsers();
      setUsers(res.users);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setUserMsg('User account created.');
    } catch (err: any) {
      setUserMsg(err?.message || 'Failed to create user');
    }
  }

  async function handleRoleChange(targetId: number, role: string) {
    setUserMsg('');
    try {
      await api.updateUser(targetId, { role });
      const res = await api.getUsers();
      setUsers(res.users);
      setUserMsg('User role updated.');
    } catch (err: any) {
      setUserMsg(err?.message || 'Failed to update role');
    }
  }

  async function handleDeleteUser(targetId: number) {
    setUserMsg('');
    try {
      await api.deleteUser(targetId);
      const res = await api.getUsers();
      setUsers(res.users);
      setUserMsg('User removed.');
    } catch (err: any) {
      setUserMsg(err?.message || 'Failed to remove user');
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg('');
    if (nextPw.length < 10) {
      setPwMsg('New password must be at least 10 characters.');
      return;
    }
    if (nextPw !== confirmNextPw) {
      setPwMsg('New passwords do not match.');
      return;
    }
    try {
      await api.changePassword(curPw, nextPw);
      setCurPw('');
      setNextPw('');
      setConfirmNextPw('');
      setPwMsg('Password updated successfully.');
    } catch (err: any) {
      setPwMsg(err?.message || 'Failed to update password');
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Owner Settings &amp; System Governance
          </h2>
          <p className="text-xs text-slate-500">
            Configure Owner sending quotas, default concurrent send cap for invited users, revenue targets, password rotation, and 8 AI agents.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
          <button
            type="button"
            onClick={() => setSubTab('governance')}
            className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
              subTab === 'governance' ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Sending Limits &amp; Revenue Goals
          </button>
          <button
            type="button"
            onClick={() => setSubTab('agents')}
            className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
              subTab === 'agents' ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            AI Agents &amp; Schedules ({agents.length})
          </button>
        </div>
      </div>

      {subTab === 'agents' ? (
        <AiAgentManagementPage
          agents={agents}
          user={user}
          onUpdateAgents={onUpdateAgents || (() => {})}
        />
      ) : (
      <>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">
          Owner Email Sending Limits, Sandbox Policy &amp; Commercial Goals
        </h3>
        <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Owner Daily Send Limit</label>
            <input
              type="number"
              min={1}
              disabled={!superAdminAccess}
              value={ownerDailyLimit}
              onChange={(e) => setOwnerDailyLimit(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Owner Hourly Send Limit</label>
            <input
              type="number"
              min={1}
              disabled={!superAdminAccess}
              value={ownerHourlyLimit}
              onChange={(e) => setOwnerHourlyLimit(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Owner Max Concurrent Sends</label>
            <input
              type="number"
              min={1}
              disabled={!superAdminAccess}
              value={ownerMaxConcurrent}
              onChange={(e) => setOwnerMaxConcurrent(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Default Concurrent Sends (Invited Users)
            </label>
            <input
              type="number"
              min={1}
              disabled={!superAdminAccess}
              value={invitedConcurrent}
              onChange={(e) => setInvitedConcurrent(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">30-Day Revenue Target ($)</label>
            <input
              type="number"
              disabled={!superAdminAccess}
              value={target30}
              onChange={(e) => setTarget30(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Stretch Revenue Target ($)</label>
            <input
              type="number"
              disabled={!superAdminAccess}
              value={stretch}
              onChange={(e) => setStretch(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Stretch Target Date</label>
            <input
              type="date"
              disabled={!superAdminAccess}
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Data Retention (Days)</label>
            <input
              type="number"
              disabled={!superAdminAccess}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={!superAdminAccess}
                checked={sandboxMode}
                onChange={(e) => setSandboxMode(e.target.checked)}
              />
              <span>Force Safe Sandbox Mode globally (routes all outbound mail to internal Sandbox Outbox)</span>
            </label>
            {superAdminAccess && (
              <div className="flex items-center gap-3">
                <span className="text-emerald-700 dark:text-emerald-400">{saved}</span>
                <button type="submit" className="px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md">
                  Save Owner Configuration
                </button>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Account Password Rotation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Account Security — Rotate Password ({user.email})
        </h3>
        <form onSubmit={handleChangePassword} className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <input
            type="password"
            placeholder="Current Password"
            required
            value={curPw}
            onChange={(e) => setCurPw(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
          />
          <input
            type="password"
            placeholder="New Password (min 10 chars)"
            required
            minLength={10}
            value={nextPw}
            onChange={(e) => setNextPw(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
          />
          <input
            type="password"
            placeholder="Confirm New Password"
            required
            minLength={10}
            value={confirmNextPw}
            onChange={(e) => setConfirmNextPw(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
          />
          <button type="submit" className="px-4 py-2 font-medium text-white bg-slate-900 dark:bg-blue-700 rounded-md">
            Update Password
          </button>
        </form>
        {pwMsg && <div className="text-xs text-slate-600 dark:text-slate-300">{pwMsg}</div>}
      </div>

      {adminAccess && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Role-Based User Management ({users.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Permanent Owner &amp; Super Admin status is locked exclusively to shedrackemmanuelgim@gmail.com.
            </p>
          </div>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
            <input
              type="text"
              placeholder="Full Name"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <input
              type="email"
              placeholder="Email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <input
              type="password"
              placeholder="Password (min 10 chars)"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            >
              <option value="operator">Operator (Discovery &amp; CRM)</option>
              <option value="viewer">Viewer (Read-only)</option>
              {superAdminAccess && <option value="admin">Admin (Operations Admin)</option>}
            </select>
            <button type="submit" className="px-4 py-2 font-medium text-white bg-slate-900 dark:bg-blue-700 rounded-md">
              Add User
            </button>
          </form>
          {userMsg && <div className="text-xs text-slate-600 dark:text-slate-300">{userMsg}</div>}

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {users.map((u) => {
              const ownerLocked = u.is_owner || u.role === 'super_admin';
              return (
                <div key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {u.name} · <span className="text-slate-500 font-normal">{u.email}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                      {ownerLocked ? 'Permanent Owner · super_admin' : `Role: ${u.role}`} · Last login:{' '}
                      {u.last_login_at || 'Never'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ownerLocked ? (
                      <span className="text-[11px] font-mono text-blue-700 dark:text-blue-400">
                        Owner Protected
                      </span>
                    ) : (
                      <>
                        <select
                          value={u.role}
                          disabled={u.id === user.id || (u.role === 'admin' && !superAdminAccess)}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          className="px-2 py-1 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                        >
                          <option value="operator">operator</option>
                          <option value="viewer">viewer</option>
                          {superAdminAccess && <option value="admin">admin</option>}
                        </select>
                        {u.id !== user.id && (superAdminAccess || u.role !== 'admin') && (
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-1 text-slate-400 hover:text-red-600"
                            title="Delete user"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
