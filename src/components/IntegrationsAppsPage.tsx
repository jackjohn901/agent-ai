import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
  Wrench,
} from 'lucide-react';
import { api, authorizeUniversalOAuthPopup, isSuperAdmin } from '../lib/api';
import { PlatformIntegrationsPage } from './SystemPages';
import type {
  AppSettings,
  IntegrationAuthType,
  IntegrationKind,
  McpTransportType,
  PlatformConnector,
  UniversalIntegration,
  UniversalIntegrationReport,
  UniversalIntegrationStatus,
  UserAccount,
} from '../../shared/types';

function statusTextClass(status: UniversalIntegrationStatus): string {
  switch (status) {
    case 'CONNECTED':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'PENDING_AUTH':
    case 'AWAITING_APPROVAL':
      return 'text-amber-700 dark:text-amber-400';
    case 'ERROR':
    case 'EXPIRED':
    case 'UNSUPPORTED':
      return 'text-red-700 dark:text-red-400';
    default:
      return 'text-slate-500 dark:text-slate-400';
  }
}

function statusLabel(status: UniversalIntegrationStatus): string {
  return status.replace(/_/g, ' ');
}

export function IntegrationsAppsPage({
  platforms,
  user,
  settings,
  onUpdatePlatforms,
  onSaveSettings,
}: {
  platforms: PlatformConnector[];
  user: UserAccount;
  settings?: AppSettings | null;
  onUpdatePlatforms: (platforms: PlatformConnector[]) => void;
  onSaveSettings?: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const superAdmin = isSuperAdmin(user);
  const [activeTab, setActiveTab] = useState<'marketplace' | 'add_custom' | 'report' | 'legacy_sources'>('marketplace');
  const [integrations, setIntegrations] = useState<UniversalIntegration[]>([]);
  const [report, setReport] = useState<UniversalIntegrationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>('apollo_mcp');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [credDrafts, setCredDrafts] = useState<Record<string, Record<string, string>>>({});
  const [toolTestArgs, setToolTestArgs] = useState<Record<string, string>>({});
  const [toolTestOutput, setToolTestOutput] = useState<Record<string, { ok: boolean; text: string }>>({});

  // Custom MCP / API Builder form state
  const [customName, setCustomName] = useState('');
  const [customKind, setCustomKind] = useState<IntegrationKind>('MCP');
  const [customTransport, setCustomTransport] = useState<McpTransportType>('streamable_http');
  const [customUrl, setCustomUrl] = useState('');
  const [customCategory, setCustomCategory] = useState('B2B Research & Enrichment');
  const [customDescription, setCustomDescription] = useState('');
  const [customAuthType, setCustomAuthType] = useState<IntegrationAuthType>('bearer');
  const [customApiKeyHeader, setCustomApiKeyHeader] = useState('X-API-Key');
  const [customTokenOrKey, setCustomTokenOrKey] = useState('');
  const [customHeadersJson, setCustomHeadersJson] = useState('');
  const [customOAuthAuthUrl, setCustomOAuthAuthUrl] = useState('');
  const [customOAuthTokenUrl, setCustomOAuthTokenUrl] = useState('');
  const [customOAuthScopes, setCustomOAuthScopes] = useState('mcp:tools');
  const [customClientId, setCustomClientId] = useState('');
  const [customClientSecret, setCustomClientSecret] = useState('');
  const [customRateLimit, setCustomRateLimit] = useState('Vendor API rate limits apply');
  const [creatingCustom, setCreatingCustom] = useState(false);

  const loadMarketplace = useCallback(async () => {
    if (!superAdmin) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.getUniversalIntegrations();
      setIntegrations(res.integrations);
      setReport(res.report);
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Failed to load Universal Integrations Marketplace' });
    } finally {
      setLoading(false);
    }
  }, [superAdmin]);

  useEffect(() => {
    loadMarketplace();
  }, [loadMarketplace]);

  if (!superAdmin) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center">
        <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto mb-2" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Super Admin Access Only</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Only the primary Owner / Super Admin can configure MCP servers, API credentials, OAuth apps, and system tools.
        </p>
      </div>
    );
  }

  function applyServerState(res: { integrations: UniversalIntegration[]; report: UniversalIntegrationReport }) {
    setIntegrations(res.integrations);
    setReport(res.report);
  }

  async function handleTest(id: string) {
    setBusyId(id);
    setBanner(null);
    try {
      const res = await api.testUniversalIntegration(id);
      applyServerState(res);
      setBanner({ ok: res.result.ok, text: `${res.result.integration.name}: ${res.result.message}` });
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Connection test failed' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveCredentials(e: React.FormEvent, intg: UniversalIntegration) {
    e.preventDefault();
    const creds = credDrafts[intg.id] || {};
    setBusyId(intg.id);
    setBanner(null);
    try {
      const res = await api.saveUniversalCredentials(intg.id, creds);
      applyServerState(res);
      setCredDrafts((prev) => ({ ...prev, [intg.id]: {} }));
      const testRes = await api.testUniversalIntegration(intg.id);
      applyServerState(testRes);
      setBanner({
        ok: testRes.result.ok,
        text: `Credentials encrypted for ${intg.name}. Live test: ${testRes.result.message}`,
      });
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Failed to save credentials' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleClearCredentials(intg: UniversalIntegration) {
    setBusyId(intg.id);
    setBanner(null);
    try {
      const res = await api.clearUniversalCredentials(intg.id);
      applyServerState(res);
      setBanner({ ok: true, text: `Cleared stored credentials for ${intg.name}.` });
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Failed to clear credentials' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleIntegration(intg: UniversalIntegration) {
    setBusyId(intg.id);
    setBanner(null);
    try {
      const res = await api.toggleUniversalIntegration(intg.id, !intg.is_enabled);
      applyServerState(res);
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Toggle failed' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleTool(intg: UniversalIntegration, toolName: string, nextEnabled: boolean) {
    setBusyId(intg.id);
    try {
      const res = await api.toggleUniversalTool(intg.id, toolName, nextEnabled);
      applyServerState(res);
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Failed to update tool permission' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleExecuteTool(intg: UniversalIntegration, toolName: string) {
    const key = `${intg.id}:${toolName}`;
    setBusyId(key);
    try {
      let args: Record<string, any> = {};
      const raw = (toolTestArgs[key] || '').trim();
      if (raw) {
        args = JSON.parse(raw);
      }
      const res = await api.executeUniversalTool(intg.id, toolName, args);
      applyServerState(res);
      setToolTestOutput((prev) => ({
        ...prev,
        [key]: {
          ok: res.exec_result.ok,
          text: res.exec_result.ok
            ? `${JSON.stringify(res.exec_result.output, null, 2)} (credits: ${res.exec_result.credits_consumed}, ${res.exec_result.latency_ms}ms)`
            : res.exec_result.error || 'Tool call failed',
        },
      }));
    } catch (err: any) {
      setToolTestOutput((prev) => ({
        ...prev,
        [key]: { ok: false, text: err?.message || 'Invalid JSON arguments or execution failed' },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function handleOAuthAuthorize(intg: UniversalIntegration) {
    setBusyId(intg.id);
    setBanner(null);
    try {
      const result = await authorizeUniversalOAuthPopup(intg.id);
      await loadMarketplace();
      setBanner({ ok: true, text: `${intg.name}: ${result.message}` });
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || `OAuth authorization failed for ${intg.name}` });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteCustom(intg: UniversalIntegration) {
    setBusyId(intg.id);
    setBanner(null);
    try {
      const res = await api.deleteUniversalIntegration(intg.id);
      applyServerState(res);
      setBanner({ ok: true, text: `Deleted custom integration "${intg.name}".` });
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Failed to delete integration' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateCustom(e: React.FormEvent) {
    e.preventDefault();
    setCreatingCustom(true);
    setBanner(null);
    try {
      const credentials: Record<string, string> = {};
      if (customAuthType === 'bearer' && customTokenOrKey.trim()) {
        credentials.bearer_token = customTokenOrKey.trim();
      } else if (customAuthType === 'api_key' && customTokenOrKey.trim()) {
        credentials.api_key = customTokenOrKey.trim();
      } else if (customAuthType === 'custom_headers' && customHeadersJson.trim()) {
        credentials.custom_headers_json = customHeadersJson.trim();
      } else if (customAuthType === 'oauth2') {
        if (customClientId.trim()) credentials.client_id = customClientId.trim();
        if (customClientSecret.trim()) credentials.client_secret = customClientSecret.trim();
        if (customTokenOrKey.trim()) credentials.bearer_token = customTokenOrKey.trim();
      }

      const res = await api.createUniversalIntegration({
        name: customName.trim(),
        kind: customKind,
        transport_type: customKind === 'MCP' ? customTransport : undefined,
        endpoint_url: customUrl.trim(),
        category: customCategory.trim(),
        description: customDescription.trim(),
        auth_type: customAuthType,
        api_key_header: customApiKeyHeader.trim() || 'X-API-Key',
        oauth_authorize_url: customOAuthAuthUrl.trim() || undefined,
        oauth_token_url: customOAuthTokenUrl.trim() || undefined,
        oauth_scopes: customOAuthScopes.trim() || undefined,
        rate_limit_info: customRateLimit.trim(),
        credentials,
        run_test: true,
      });

      applyServerState(res);
      setBanner({
        ok: Boolean(res.test_result?.ok),
        text: res.test_result?.message
          ? `Registered "${res.integration.name}". Live test: ${res.test_result.message}`
          : `Registered "${res.integration.name}".`,
      });
      setCustomName('');
      setCustomUrl('');
      setCustomDescription('');
      setCustomTokenOrKey('');
      setCustomHeadersJson('');
      setCustomClientId('');
      setCustomClientSecret('');
      setExpandedId(res.integration.id);
      setActiveTab('marketplace');
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || 'Failed to register integration' });
    } finally {
      setCreatingCustom(false);
    }
  }

  function copyText(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(
      () => setBanner({ ok: true, text: `Copied ${label} to clipboard.` }),
      () => {}
    );
  }

  const summary = report?.summary;

  return (
    <div className="space-y-5">
      {/* Header & Top Metrics Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Integrations &amp; Connected Apps
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Universal MCP Server &amp; API Marketplace: manage Apollo MCP, Fiverr MCP, Reddit API, LinkedIn API, Google Gemini AI, custom MCP endpoints, lead discovery feeds, and email OAuth.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('add_custom')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Custom MCP / API</span>
            </button>
            <button
              type="button"
              onClick={() => loadMarketplace()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-500">Connected MCP / API</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {summary.connected_mcp} MCP · {summary.connected_api} API
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-500">Pending / Failed</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {summary.pending_authorization} pending · {summary.failed_connections} failed
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-500">Discovered / Enabled Tools</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {summary.enabled_tools}/{summary.total_available_tools} active
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-500">API Calls / Credits Used</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {summary.total_api_calls} calls · {summary.total_credits_consumed} cr
              </div>
            </div>
          </div>
        )}

        {/* Section Sub-Navigation */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
          {(
            [
              ['marketplace', `Connected Apps & MCP (${integrations.length})`],
              ['add_custom', 'Add Custom MCP Server / API'],
              ['report', 'Status & Test Report'],
              ['legacy_sources', 'Lead Data Sources, Feeds & Email OAuth'],
            ] as const
          ).map(([tabId, label]) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                activeTab === tabId
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {banner && (
          <div
            className={`px-3 py-2 rounded-md text-xs border flex items-start gap-2 ${
              banner.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
            }`}
          >
            {banner.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>{banner.text}</span>
          </div>
        )}
      </div>

      {/* TAB 1: MARKETPLACE CONNECTED APPS */}
      {activeTab === 'marketplace' && (
        <div className="space-y-3">
          {loading ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading integrations and encrypted credentials status...</span>
            </div>
          ) : (
            integrations.map((intg) => {
              const isExpanded = expandedId === intg.id;
              const isBusy = busyId === intg.id;
              const credValues = credDrafts[intg.id] || {};
              const redditCfg = intg.id === 'reddit_api' ? intg.config : null;
              const geminiCfg = intg.id === 'gemini_api' ? intg.config : null;
              const linkedinProducts: any[] =
                intg.id === 'linkedin_api' && Array.isArray(intg.config?.products_matrix)
                  ? intg.config.products_matrix
                  : [];

              return (
                <div
                  key={intg.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
                >
                  {/* Integration Row Header */}
                  <div className="p-4 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{intg.name}</span>
                        <span className={`text-[11px] font-mono font-semibold ${statusTextClass(intg.status)}`}>
                          {statusLabel(intg.status)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                        {intg.kind}
                        {intg.transport_type ? ` · ${intg.transport_type}` : ''}
                        {` · auth: ${intg.auth_type}`}
                        {intg.endpoint_url ? ` · ${intg.endpoint_url}` : ''}
                        {` · ${intg.tools.filter((t) => t.enabled).length}/${intg.tools.length} tools active`}
                        {intg.credits_used > 0 ? ` · ${intg.credits_used} credits used` : ''}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{intg.description}</p>
                      {intg.last_error && (
                        <div className="text-[11px] text-red-700 dark:text-red-400 flex items-start gap-1.5 pt-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{intg.last_error}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleTest(intg.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        <span>Test Connection</span>
                      </button>

                      {intg.auth_type === 'oauth2' && (
                        <button
                          type="button"
                          disabled={isBusy || !intg.is_enabled}
                          onClick={() => handleOAuthAuthorize(intg)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md disabled:opacity-50"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>{intg.status === 'EXPIRED' ? 'Reconnect OAuth' : 'Authorize OAuth'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : intg.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>{isExpanded ? 'Hide Details' : 'Configure & Tools'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleToggleIntegration(intg)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md border ${
                          intg.is_enabled
                            ? 'border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                            : 'border-slate-300 dark:border-slate-700 text-slate-500'
                        }`}
                      >
                        {intg.is_enabled ? 'Enabled' : 'Disabled'}
                      </button>

                      {!intg.is_builtin && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDeleteCustom(intg)}
                          title="Delete custom integration"
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Configuration Drawer */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-950/40 space-y-5">
                      {/* Honest Limitations / Compliance Callout */}
                      {intg.limitations_note && (
                        <div className="p-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2">
                          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{intg.limitations_note}</span>
                        </div>
                      )}

                      {/* OAuth Callback URL Notice */}
                      {intg.auth_type === 'oauth2' && intg.oauth_config?.redirect_uri && (
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md text-xs">
                          <div className="min-w-0">
                            <span className="text-slate-500 dark:text-slate-400 mr-2">Authorized OAuth Redirect URI:</span>
                            <code className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all">
                              {intg.oauth_config.redirect_uri}
                            </code>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyText(intg.oauth_config.redirect_uri || '', 'OAuth Callback URL')}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                          >
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </button>
                        </div>
                      )}

                      {/* REDDIT SPECIFIC: Commercial Data Access Approval Gate */}
                      {redditCfg && (
                        <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              Reddit Commercial Data Access &amp; Compliance Gate
                            </div>
                            <span className="text-[11px] font-mono text-slate-500">
                              Status: {redditCfg.commercial_approved ? 'COMMERCIAL APPROVED' : 'AWAITING COMMERCIAL APPROVAL'}
                            </span>
                          </div>
                          <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(redditCfg.commercial_approved)}
                              onChange={async (e) => {
                                const res = await api.updateUniversalIntegrationConfig('reddit_api', {
                                  config: {
                                    ...redditCfg,
                                    commercial_approved: e.target.checked,
                                    approval_stage: e.target.checked ? 'APPROVED' : 'NOT_SUBMITTED',
                                  },
                                });
                                applyServerState(res);
                              }}
                              className="mt-0.5 rounded border-slate-300"
                            />
                            <span>
                              I confirm this Reddit app has obtained Reddit commercial API data access approval (or authorized non-commercial permission) and complies with Reddit Data API Terms. Until checked, commercial Reddit lead discovery stays blocked.
                            </span>
                          </label>
                        </div>
                      )}

                      {/* LINKEDIN SPECIFIC: Approved vs Pending Products Matrix */}
                      {linkedinProducts.length > 0 && (
                        <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md space-y-2.5">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            LinkedIn Developer Products &amp; Scope Enforcement Matrix
                          </div>
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {linkedinProducts.map((prod) => (
                              <div key={prod.id} className="py-2 flex flex-wrap items-start justify-between gap-3 text-xs">
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-slate-900 dark:text-slate-100">
                                    {prod.name} <span className="font-mono text-[11px] text-slate-500">({prod.scope})</span>
                                  </div>
                                  <div className="text-[11px] text-slate-600 dark:text-slate-300">{prod.capabilities}</div>
                                  <div className="text-[11px] text-slate-400">{prod.limitation_note}</div>
                                </div>
                                <label className="inline-flex items-center gap-1.5 text-[11px] font-mono shrink-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(prod.approved)}
                                    onChange={async (e) => {
                                      const cur = Array.isArray(intg.config?.approved_products)
                                        ? intg.config.approved_products
                                        : ['openid_connect'];
                                      const next = e.target.checked
                                        ? Array.from(new Set([...cur, prod.id]))
                                        : cur.filter((x: string) => x !== prod.id);
                                      const res = await api.updateUniversalIntegrationConfig('linkedin_api', {
                                        config: { approved_products: next },
                                      });
                                      applyServerState(res);
                                    }}
                                  />
                                  <span className={prod.approved ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                                    {prod.approved ? 'Approved' : 'Pending Approval'}
                                  </span>
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* GEMINI SPECIFIC: Model & Generation Settings */}
                      {geminiCfg && (
                        <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              Gemini Model &amp; Generation Settings
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              Server Env Secret: {geminiCfg.env_key_present ? 'Present' : 'Not detected'}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                                Active Gemini Model
                              </label>
                              <select
                                value={geminiCfg.active_model || 'gemini-4-hydrogen'}
                                onChange={async (e) => {
                                  const res = await api.updateUniversalIntegrationConfig('gemini_api', {
                                    config: { active_model: e.target.value },
                                  });
                                  applyServerState(res);
                                }}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                              >
                                <option value="gemini-4-hydrogen">gemini-4-hydrogen (Fast / Default)</option>
                                <option value="gemini-4-argon">gemini-4-argon (Balanced Multimodal)</option>
                                <option value="gemini-4-carbon">gemini-4-carbon (Deep Reasoning)</option>
                                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (High Throughput)</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                                Thinking Level
                              </label>
                              <select
                                value={geminiCfg.thinking_level || 'MEDIUM'}
                                onChange={async (e) => {
                                  const res = await api.updateUniversalIntegrationConfig('gemini_api', {
                                    config: { thinking_level: e.target.value },
                                  });
                                  applyServerState(res);
                                }}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                              >
                                <option value="LOW">LOW (Fastest latency)</option>
                                <option value="MEDIUM">MEDIUM (Recommended)</option>
                                <option value="HIGH">HIGH (Deep analysis)</option>
                              </select>
                            </div>
                            <div className="flex items-end pb-1">
                              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={geminiCfg.use_env_fallback !== false}
                                  onChange={async (e) => {
                                    const res = await api.updateUniversalIntegrationConfig('gemini_api', {
                                      config: { use_env_fallback: e.target.checked },
                                    });
                                    applyServerState(res);
                                  }}
                                />
                                <span>Fallback to GEMINI_API_KEY env if override blank</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Encrypted Credentials Form */}
                      {intg.credential_fields.length > 0 && (
                        <form
                          onSubmit={(e) => handleSaveCredentials(e, intg)}
                          className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                              <span>Encrypted Backend Credentials (AES-256-GCM)</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleClearCredentials(intg)}
                              className="text-[11px] text-red-600 hover:underline"
                            >
                              Clear Stored Secrets
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {intg.credential_fields.map((field) => (
                              <div key={field.key}>
                                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                                  {field.label}
                                  {field.configured && (
                                    <span className="ml-2 font-mono text-emerald-700 dark:text-emerald-400">
                                      Saved: {field.masked}
                                    </span>
                                  )}
                                </label>
                                <input
                                  type={field.type === 'secret' ? 'password' : 'text'}
                                  placeholder={field.placeholder}
                                  value={credValues[field.key] ?? ''}
                                  onChange={(e) =>
                                    setCredDrafts((prev) => ({
                                      ...prev,
                                      [intg.id]: { ...(prev[intg.id] || {}), [field.key]: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                                />
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="submit"
                              disabled={isBusy}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                              <span>Save Credentials &amp; Run Test</span>
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Discovered / Available Tools & Safe Execution Runner */}
                      <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <Wrench className="w-3.5 h-3.5 text-slate-500" />
                            <span>Available Tools &amp; Per-Tool Permissions ({intg.tools.length})</span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-500">
                            {intg.rate_limit_info}
                          </span>
                        </div>

                        {intg.tools.length === 0 ? (
                          <div className="text-xs text-slate-500 py-2">
                            No MCP tools discovered yet. Run "Test Connection" (or authorize OAuth) to execute live `tools/list` discovery.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {intg.tools.map((tool) => {
                              const toolKey = `${intg.id}:${tool.name}`;
                              const out = toolTestOutput[toolKey];
                              return (
                                <div key={tool.name} className="py-2.5 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
                                        {tool.name}
                                        {tool.category ? (
                                          <span className="ml-2 text-[10px] font-sans font-normal text-slate-500">
                                            · {tool.category}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="text-[11px] text-slate-600 dark:text-slate-300">{tool.description}</div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={tool.enabled}
                                          onChange={(e) => handleToggleTool(intg, tool.name, e.target.checked)}
                                        />
                                        <span className={tool.enabled ? 'text-emerald-700 dark:text-emerald-400 text-[11px]' : 'text-slate-400 text-[11px]'}>
                                          {tool.enabled ? 'Allowed' : 'Blocked'}
                                        </span>
                                      </label>
                                      <button
                                        type="button"
                                        disabled={!tool.enabled || !intg.is_enabled || busyId === toolKey}
                                        onClick={() => handleExecuteTool(intg, tool.name)}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded disabled:opacity-50"
                                      >
                                        {busyId === toolKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                        <span>Test Tool</span>
                                      </button>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      type="text"
                                      placeholder='Optional JSON arguments, e.g. {"query": "saas"}'
                                      value={toolTestArgs[toolKey] || ''}
                                      onChange={(e) =>
                                        setToolTestArgs((prev) => ({ ...prev, [toolKey]: e.target.value }))
                                      }
                                      className="flex-1 min-w-[220px] px-2 py-1 text-[11px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded"
                                    />
                                  </div>
                                  {out && (
                                    <pre
                                      className={`text-[11px] font-mono p-2 rounded border overflow-x-auto max-h-40 ${
                                        out.ok
                                          ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-300'
                                          : 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
                                      }`}
                                    >
                                      {out.text}
                                    </pre>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: CUSTOM MCP SERVER & API BUILDER */}
      {activeTab === 'add_custom' && (
        <form
          onSubmit={handleCreateCustom}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-600" />
              <span>Custom MCP Server &amp; External API Builder</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Connect any future external MCP server (Streamable HTTP / SSE) or custom REST API without rebuilding the application. URL is validated for SSRF safety, handshake &amp; tool discovery run live, and credentials are encrypted server-side.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Integration Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. HubSpot MCP Server or Hunter.io API"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Connection Type *
              </label>
              <select
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value as IntegrationKind)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="MCP">MCP Connector (Model Context Protocol)</option>
                <option value="API">API Connector (REST / HTTP Endpoint)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {customKind === 'MCP' ? 'MCP Server Endpoint URL *' : 'API Endpoint URL *'}
              </label>
              <input
                type="url"
                required
                placeholder={customKind === 'MCP' ? 'https://mcp.example.com/mcp' : 'https://api.example.com/v1/health'}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md font-mono"
              />
            </div>

            {customKind === 'MCP' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  MCP Transport Protocol
                </label>
                <select
                  value={customTransport}
                  onChange={(e) => setCustomTransport(e.target.value as McpTransportType)}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  <option value="streamable_http">Streamable HTTP (JSON-RPC / SSE framed)</option>
                  <option value="sse">Legacy HTTP+SSE (/sse endpoint event)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Authentication Type
              </label>
              <select
                value={customAuthType}
                onChange={(e) => setCustomAuthType(e.target.value as IntegrationAuthType)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="none">No Authentication (Public Endpoint)</option>
                <option value="bearer">Bearer Token</option>
                <option value="api_key">API Key Header</option>
                <option value="oauth2">OAuth 2.0 (Auto-Discover or Manual URLs)</option>
                <option value="custom_headers">Custom Headers JSON</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Category &amp; Rate Limit Note
              </label>
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g. CRM, Enrichment, Social, AI Tools"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          </div>

          {customAuthType === 'api_key' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  API Key Header Name
                </label>
                <input
                  type="text"
                  value={customApiKeyHeader}
                  onChange={(e) => setCustomApiKeyHeader(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  API Key Value
                </label>
                <input
                  type="password"
                  value={customTokenOrKey}
                  onChange={(e) => setCustomTokenOrKey(e.target.value)}
                  placeholder="Encrypted immediately server-side"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
            </div>
          )}

          {customAuthType === 'bearer' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Bearer Token
              </label>
              <input
                type="password"
                value={customTokenOrKey}
                onChange={(e) => setCustomTokenOrKey(e.target.value)}
                placeholder="Enter Bearer token"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          )}

          {customAuthType === 'custom_headers' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Custom Headers JSON
              </label>
              <textarea
                rows={3}
                value={customHeadersJson}
                onChange={(e) => setCustomHeadersJson(e.target.value)}
                placeholder='{"X-Workspace-Id": "123", "Authorization": "Token ..."}'
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          )}

          {customAuthType === 'oauth2' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  OAuth Authorize URL (blank to auto-discover RFC 8414)
                </label>
                <input
                  type="url"
                  value={customOAuthAuthUrl}
                  onChange={(e) => setCustomOAuthAuthUrl(e.target.value)}
                  placeholder="https://provider.com/oauth/authorize"
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  OAuth Token URL (blank to auto-discover)
                </label>
                <input
                  type="url"
                  value={customOAuthTokenUrl}
                  onChange={(e) => setCustomOAuthTokenUrl(e.target.value)}
                  placeholder="https://provider.com/oauth/token"
                  className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  OAuth Client ID (optional if dynamic registration supported)
                </label>
                <input
                  type="text"
                  value={customClientId}
                  onChange={(e) => setCustomClientId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  OAuth Client Secret &amp; Scopes
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    placeholder="Client Secret"
                    value={customClientSecret}
                    onChange={(e) => setCustomClientSecret(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                  <input
                    type="text"
                    placeholder="Scopes"
                    value={customOAuthScopes}
                    onChange={(e) => setCustomOAuthScopes(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Description &amp; Intended Workflow
            </label>
            <input
              type="text"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Explain what buyer discovery, enrichment, or CRM actions this integration provides"
              className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Rate Limit Info
            </label>
            <input
              type="text"
              value={customRateLimit}
              onChange={(e) => setCustomRateLimit(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setActiveTab('marketplace')}
              className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingCustom}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md disabled:opacity-50"
            >
              {creatingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Register Integration &amp; Discover Tools</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: INTEGRATION STATUS & TEST REPORT */}
      {activeTab === 'report' && report && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Integration Verification &amp; Quota Matrix
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Live health, discovered tools, disabled tools, last tested timestamp, API usage, and credits consumed.
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {report.summary.total_integrations} registered integrations
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-medium">
                    <th className="py-2.5 px-4">Integration</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Tools (On / Total)</th>
                    <th className="py-2.5 px-4 text-right">Calls / Credits</th>
                    <th className="py-2.5 px-4">Last Tested</th>
                    <th className="py-2.5 px-4">Rate Limit &amp; Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.integrations.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        {item.name}
                        <div className="text-[11px] font-mono text-slate-400 truncate max-w-[220px]">
                          {item.endpoint_url}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {item.kind} ({item.auth_type})
                      </td>
                      <td className={`py-2.5 px-4 font-mono font-semibold ${statusTextClass(item.status)}`}>
                        {statusLabel(item.status)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {item.tools.filter((t) => t.enabled).length} / {item.tools.length}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {item.api_calls_count} · {item.credits_used} cr
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                        {item.last_tested_at || 'Never tested'}
                      </td>
                      <td className="py-2.5 px-4 text-[11px]">
                        <div className="text-slate-600 dark:text-slate-300">{item.rate_limit_info}</div>
                        {item.last_error && (
                          <div className="text-red-600 dark:text-red-400 mt-0.5">{item.last_error}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Recent Tool Execution &amp; Error Audit Log
              </h3>
            </div>
            {report.recent_logs.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 text-center">No integration executions logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-medium">
                      <th className="py-2 px-4">Time</th>
                      <th className="py-2 px-4">Integration</th>
                      <th className="py-2 px-4">Action / Tool</th>
                      <th className="py-2 px-4">Status</th>
                      <th className="py-2 px-4 text-right">Usage</th>
                      <th className="py-2 px-4">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.recent_logs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {log.created_at}
                        </td>
                        <td className="py-2 px-4 font-medium text-slate-900 dark:text-slate-100">
                          {log.integration_name || log.integration_id}
                        </td>
                        <td className="py-2 px-4 font-mono text-[11px]">
                          {log.action}
                          {log.tool_name ? ` · ${log.tool_name}` : ''}
                        </td>
                        <td
                          className={`py-2 px-4 font-mono font-semibold text-[11px] ${
                            log.status === 'SUCCESS'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : log.status === 'BLOCKED'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          {log.status}
                        </td>
                        <td className="py-2 px-4 text-right font-mono text-[11px] tabular-nums whitespace-nowrap">
                          {log.latency_ms}ms · {log.tokens_used}tok · {log.credits_consumed}cr
                        </td>
                        <td className="py-2 px-4 text-[11px] text-slate-600 dark:text-slate-300">
                          {log.error_message || log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: PRESERVED LEAD DISCOVERY DATA SOURCES, FEEDS & EMAIL OAUTH */}
      {activeTab === 'legacy_sources' && (
        <PlatformIntegrationsPage
          platforms={platforms}
          user={user}
          settings={settings}
          onUpdate={onUpdatePlatforms}
          onSaveSettings={onSaveSettings}
        />
      )}
    </div>
  );
}
