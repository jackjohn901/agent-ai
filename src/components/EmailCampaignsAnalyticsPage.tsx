import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  FlaskConical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { api, isSuperAdmin } from '../lib/api';
import { authorizeGmailAccount, getCachedGmailToken } from '../lib/gmailOAuth';
import { WORLD_COUNTRIES } from '../../shared/countries';
import type {
  EmailAccount,
  EmailAnalyticsResponse,
  EmailCampaign,
  EmailQueueItem,
  SandboxOutboxItem,
  ServiceCategory,
  TargetCountrySet,
  UserAccount,
} from '../../shared/types';
import { RevenueAnalyticsPage } from './OutreachCrmPages';
import type { AppSettings, DashboardMetrics } from '../../shared/types';

export function EmailCampaignsPage({
  services,
  user,
}: {
  services: ServiceCategory[];
  user: UserAccount;
}) {
  const [subTab, setSubTab] = useState<'campaigns' | 'queue' | 'sandbox'>('campaigns');
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [countrySets, setCountrySets] = useState<TargetCountrySet[]>([]);
  const [queue, setQueue] = useState<EmailQueueItem[]>([]);
  const [limits, setLimits] = useState<any>(null);
  const [sandbox, setSandbox] = useState<SandboxOutboxItem[]>([]);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // New campaign state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [selectedSetId, setSelectedSetId] = useState('');
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  async function loadAll() {
    const [cRes, aRes, tRes, qRes, sRes] = await Promise.all([
      api.getCampaigns(),
      api.getEmailAccounts(),
      api.getTargetCountrySets(),
      api.getEmailQueue(),
      api.getSandboxOutbox(),
    ]);
    setCampaigns(cRes.campaigns);
    setAccounts(aRes.accounts);
    setCountrySets(tRes.sets);
    setQueue(qRes.queue);
    setLimits(qRes.user_limits);
    setSandbox(sRes.outbox);
  }

  useEffect(() => {
    loadAll().catch(() => {});
  }, []);

  function applyCountrySet(setIdStr: string) {
    setSelectedSetId(setIdStr);
    const found = countrySets.find((s) => s.id === Number(setIdStr));
    if (found) setSelectedCountries(found.countries.slice(0, 20));
  }

  function toggleCountry(name: string) {
    setSelectedCountries((prev) => {
      if (prev.includes(name)) return prev.filter((c) => c !== name);
      if (prev.length >= 20) return prev;
      return [...prev, name];
    });
  }

  function toggleService(name: string) {
    setSelectedServices((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  }

  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await api.createCampaign({
        name: name.trim(),
        description: description.trim(),
        default_email_account_id: defaultAccountId ? Number(defaultAccountId) : null,
        target_countries: selectedCountries,
        target_services: selectedServices,
      });
      setName('');
      setDescription('');
      setSelectedCountries([]);
      setSelectedServices([]);
      setFeedback({ ok: true, text: 'Campaign created.' });
      await loadAll();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Failed to create campaign' });
    }
  }

  async function toggleStatus(c: EmailCampaign) {
    const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await api.updateCampaign(c.id, { status: next });
    await loadAll();
  }

  async function removeCampaign(id: number) {
    await api.deleteCampaign(id);
    await loadAll();
  }

  async function handleRetryQueue(item: EmailQueueItem) {
    setFeedback(null);
    try {
      let gmailToken: string | undefined;
      const acct = accounts.find((a) => a.id === item.email_account_id);
      if (acct?.provider === 'gmail_oauth') {
        gmailToken = getCachedGmailToken(acct.email_address) || (await authorizeGmailAccount()).accessToken;
      }
      const res = await api.retryQueueItem(item.id, gmailToken);
      setFeedback({ ok: res.status === 'SENT', text: res.message });
      await loadAll();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Retry failed' });
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Email Campaigns, Sending Queue &amp; Sandbox Outbox
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Organize multi-country campaigns (up to 20 countries each), monitor live send concurrency limits, and verify test emails safely in Sandbox Outbox.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
          <button
            type="button"
            onClick={() => setSubTab('campaigns')}
            className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
              subTab === 'campaigns' ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Campaigns ({campaigns.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('queue')}
            className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
              subTab === 'queue' ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Send Queue ({queue.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('sandbox')}
            className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
              subTab === 'sandbox' ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Sandbox Outbox ({sandbox.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 border rounded-md text-xs ${
            feedback.ok
              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
              : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {subTab === 'campaigns' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Create Email Campaign</h3>
            <form onSubmit={handleCreateCampaign} className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Campaign Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q2 SaaS & AI Automation Europe/NA"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <input
                  type="text"
                  placeholder="Target positioning or offer angle"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Default Sending Email Account
                </label>
                <select
                  value={defaultAccountId}
                  onChange={(e) => setDefaultAccountId(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  <option value="">Choose per email in Approval Center</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email_address} ({a.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Target Countries ({selectedCountries.length}/20)
                  </label>
                  <select
                    value={selectedSetId}
                    onChange={(e) => applyCountrySet(e.target.value)}
                    className="px-2 py-1 text-[11px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                  >
                    <option value="">Load Saved Country Profile...</option>
                    {countrySets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.countries.length})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded p-2 grid grid-cols-2 gap-1">
                  {WORLD_COUNTRIES.slice(0, 60).map((c) => {
                    const checked = selectedCountries.includes(c.name);
                    return (
                      <label key={c.code} className="flex items-center gap-1.5 text-[11px] cursor-pointer truncate">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && selectedCountries.length >= 20}
                          onChange={() => toggleCountry(c.name)}
                        />
                        <span className="truncate">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Target Services ({selectedServices.length} selected)
                </label>
                <div className="max-h-28 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded p-2 grid grid-cols-2 gap-1">
                  {services.slice(0, 40).map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-[11px] cursor-pointer truncate">
                      <input
                        type="checkbox"
                        checked={selectedServices.includes(s.name)}
                        onChange={() => toggleService(s.name)}
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Campaign</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
            {campaigns.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">No campaigns created yet.</div>
            ) : (
              campaigns.map((c) => (
                <div key={c.id} className="p-5 flex flex-wrap items-start justify-between gap-4 text-xs">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{c.name}</span>
                      <span className="px-2 py-0.5 text-[11px] font-mono border border-slate-300 dark:border-slate-700 rounded">
                        {c.status}
                      </span>
                    </div>
                    {c.description && <div className="text-slate-500">{c.description}</div>}
                    <div className="text-[11px] text-slate-500">
                      Countries ({c.target_countries.length}/20):{' '}
                      {c.target_countries.slice(0, 5).join(', ') || 'Worldwide'}
                      {c.target_countries.length > 5 ? ` +${c.target_countries.length - 5} more` : ''}
                    </div>
                    <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                      Drafts: {c.total_emails || 0} · Sent: {c.sent_emails || 0} · Replies: {c.replies_count || 0}
                      {c.default_email_address ? ` · Sender: ${c.default_email_address}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleStatus(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      {c.status === 'ACTIVE' ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{c.status === 'ACTIVE' ? 'Pause' : 'Activate'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCampaign(c.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600"
                      title="Delete campaign"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {subTab === 'queue' && (
        <div className="space-y-4">
          {limits && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Concurrent Sends Active</div>
                <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {limits.activeConcurrent} / {limits.maxConcurrent}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Daily Send Quota</div>
                <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {limits.sentToday} / {limits.dailyLimit}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Hourly Send Quota</div>
                <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {limits.sentThisHour} / {limits.hourlyLimit}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Concurrency Policy</div>
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-1">
                  {limits.isOwner ? 'Owner Configurable Limit' : `Invited User Max ${limits.maxConcurrent}`}
                </div>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            {queue.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">Email dispatch queue is empty.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-medium">
                      <th className="py-2.5 px-4">Queue #</th>
                      <th className="py-2.5 px-4">Sender → Recipient</th>
                      <th className="py-2.5 px-4">Subject</th>
                      <th className="py-2.5 px-4">Status &amp; Attempts</th>
                      <th className="py-2.5 px-4">Notes</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {queue.map((q) => (
                      <tr key={q.id}>
                        <td className="py-2.5 px-4 font-mono">#{q.id} (Msg #{q.email_message_id})</td>
                        <td className="py-2.5 px-4 font-mono">
                          {q.sending_email} → {q.recipient_email}
                        </td>
                        <td className="py-2.5 px-4 max-w-xs truncate">{q.subject_local}</td>
                        <td className="py-2.5 px-4 font-mono">
                          {q.status} ({q.attempts}/{q.max_attempts})
                        </td>
                        <td className="py-2.5 px-4 text-[11px] text-slate-500 max-w-xs truncate">
                          {q.last_error || (q.completed_at ? `Completed ${q.completed_at}` : 'Waiting')}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {['QUEUED', 'RETRYING', 'FAILED'].includes(q.status) && (
                            <button
                              type="button"
                              onClick={() => handleRetryQueue(q)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Process Now</span>
                            </button>
                          )}
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

      {subTab === 'sandbox' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <FlaskConical className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <span>Safe Sandbox Outbox ({sandbox.length}) — Zero Live External Spam Risk</span>
            </div>
            <button
              type="button"
              onClick={() => loadAll()}
              className="text-xs text-blue-700 dark:text-blue-400 hover:underline"
            >
              Refresh
            </button>
          </div>
          {sandbox.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No sandbox test deliveries yet. Connect a Safe Sandbox Test sender in Email Accounts to test full approval and delivery flows safely.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {sandbox.map((s) => (
                <div key={s.id} className="p-4 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono font-medium text-slate-900 dark:text-slate-100">
                      {s.from_email} → {s.to_email}
                    </div>
                    <span className="px-2 py-0.5 text-[11px] font-mono border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded">
                      {s.status} · {s.created_at}
                    </span>
                  </div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{s.subject}</div>
                  <div className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{s.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EmailAnalyticsPage({
  services,
  user,
  metrics,
  settings,
}: {
  services: ServiceCategory[];
  user: UserAccount;
  metrics: DashboardMetrics | null;
  settings: AppSettings | null;
}) {
  const [view, setView] = useState<'analytics' | 'calculator'>('analytics');
  const [data, setData] = useState<EmailAnalyticsResponse | null>(null);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [usersList, setUsersList] = useState<UserAccount[]>([]);

  const [country, setCountry] = useState('ALL');
  const [service, setService] = useState('ALL');
  const [language, setLanguage] = useState('ALL');
  const [campaignId, setCampaignId] = useState('ALL');
  const [emailAccountId, setEmailAccountId] = useState('ALL');
  const [userId, setUserId] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const superAdmin = isSuperAdmin(user);

  async function loadAnalytics() {
    const res = await api.getEmailAnalytics({
      country,
      service,
      language,
      campaignId,
      emailAccountId,
      userId: superAdmin ? userId : undefined,
      dateFrom,
      dateTo,
    });
    setData(res);
  }

  useEffect(() => {
    Promise.all([
      api.getCampaigns(),
      api.getEmailAccounts(),
      superAdmin ? api.getUsers() : Promise.resolve({ users: [] }),
    ])
      .then(([cRes, aRes, uRes]) => {
        setCampaigns(cRes.campaigns);
        setAccounts(aRes.accounts);
        setUsersList(uRes.users);
      })
      .catch(() => {});
  }, [superAdmin]);

  useEffect(() => {
    loadAnalytics().catch(() => {});
  }, [country, service, language, campaignId, emailAccountId, userId, dateFrom, dateTo]);

  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Email Outreach Analytics &amp; Verified Revenue Attribution
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Actual Recorded Revenue is strictly separated from Estimated Opportunity Value. Filter metrics across country, service, language, campaign, sender account, user, and date range.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => setView('analytics')}
              className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
                view === 'analytics' ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Outreach Analytics
            </button>
            <button
              type="button"
              onClick={() => setView('calculator')}
              className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
                view === 'calculator' ? 'bg-white dark:bg-slate-900 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Revenue Calculator
            </button>
          </div>
        </div>

        {view === 'analytics' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            >
              <option value="ALL">All Countries</option>
              {WORLD_COUNTRIES.map((c) => (
                <option key={c.code} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            >
              <option value="ALL">All Services</option>
              {services.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            >
              <option value="ALL">All Languages</option>
              {['English', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Dutch', 'Italian', 'Hindi', 'Japanese'].map(
                (lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                )
              )}
            </select>

            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            >
              <option value="ALL">All Campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={emailAccountId}
              onChange={(e) => setEmailAccountId(e.target.value)}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            >
              <option value="ALL">All Sending Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email_address}
                </option>
              ))}
            </select>

            {superAdmin && (
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              >
                <option value="ALL">All Team Users</option>
                {usersList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="From date"
              className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="To date"
              className="px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
          </div>
        )}
      </div>

      {view === 'calculator' ? (
        <RevenueAnalyticsPage metrics={metrics} settings={settings} />
      ) : (
        <>
          {/* 14 KPI Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <MetricCard label="Discovered Leads" value={k?.total_discovered_leads ?? 0} />
            <MetricCard label="Qualified (60+)" value={k?.qualified_leads ?? 0} />
            <MetricCard label="Emails Generated" value={k?.emails_generated ?? 0} />
            <MetricCard label="Awaiting Approval" value={k?.emails_awaiting_approval ?? 0} tone="amber" />
            <MetricCard label="Approved" value={k?.emails_approved ?? 0} />
            <MetricCard label="Emails Sent" value={k?.emails_sent ?? 0} tone="blue" />
            <MetricCard label="Delivered" value={k?.emails_delivered ?? 0} tone="emerald" />
            <MetricCard label="Bounced" value={k?.emails_bounced ?? 0} tone="red" />
            <MetricCard label="Replies Received" value={k?.replies_received ?? 0} tone="blue" />
            <MetricCard label="Interested" value={k?.interested_prospects ?? 0} />
            <MetricCard label="Meetings Booked" value={k?.meetings_booked ?? 0} />
            <MetricCard label="Converted Clients" value={k?.converted_customers ?? 0} tone="emerald" />
            <MetricCard
              label="Actual Revenue Recorded"
              value={`$${(k?.actual_revenue_recorded ?? 0).toLocaleString()}`}
              tone="emerald"
              sub="Verified cash collected"
            />
            <MetricCard
              label="Est. Opportunity Value"
              value={`$${(k?.estimated_opportunity_value ?? 0).toLocaleString()}`}
              sub="Pipeline estimate only"
            />
          </div>

          {/* 4 Breakdown Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BreakdownTable
              title="Performance by Country"
              headers={['Country', 'Sent', 'Delivered', 'Replies', 'Revenue']}
              rows={(data?.by_country || []).map((r) => [
                r.name,
                String(r.sent),
                String(r.delivered),
                String(r.replies),
                `$${Number(r.revenue || 0).toLocaleString()}`,
              ])}
            />
            <BreakdownTable
              title="Performance by Service"
              headers={['Service', 'Sent', 'Delivered', 'Replies', 'Revenue']}
              rows={(data?.by_service || []).map((r) => [
                r.name,
                String(r.sent),
                String(r.delivered),
                String(r.replies),
                `$${Number(r.revenue || 0).toLocaleString()}`,
              ])}
            />
            <BreakdownTable
              title="Outreach by Language"
              headers={['Language', 'Generated', 'Sent', 'Replies']}
              rows={(data?.by_language || []).map((r) => [
                r.name,
                String(r.count),
                String(r.sent),
                String(r.replies),
              ])}
            />
            <BreakdownTable
              title="Deliverability by Sending Account"
              headers={['Email Account', 'Provider', 'Sent', 'Delivered', 'Bounced']}
              rows={(data?.by_account || []).map((r) => [
                r.email_address,
                r.provider,
                String(r.sent),
                String(r.delivered),
                String(r.bounced),
              ])}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number | string;
  tone?: 'emerald' | 'blue' | 'amber' | 'red';
  sub?: string;
}) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'blue'
      ? 'text-blue-700 dark:text-blue-400'
      : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-400'
      : tone === 'red'
      ? 'text-red-700 dark:text-red-400'
      : 'text-slate-900 dark:text-slate-100';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-blue-700 dark:text-blue-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">No data matching current filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-medium">
                {headers.map((h) => (
                  <th key={h} className="py-2 px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`py-2 px-4 ${cIdx > 0 ? 'font-mono tabular-nums text-slate-700 dark:text-slate-300' : 'font-medium text-slate-900 dark:text-slate-100'}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
