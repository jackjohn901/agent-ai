import React, { useEffect, useState } from 'react';
import { Play, Globe, Link2, CheckCircle2, AlertCircle, Loader2, Plug } from 'lucide-react';
import { api, hasPermission, isSuperAdmin } from '../lib/api';
import { WORLD_COUNTRIES } from '../../shared/countries';
import type { EmailCampaign, PlatformConnector, ServiceCategory, TargetCountrySet, UserAccount } from '../../shared/types';

interface DiscoveryPageProps {
  services: ServiceCategory[];
  platforms: PlatformConnector[];
  user: UserAccount;
  onDiscoveryComplete: (leadId?: number) => void;
  onOpenIntegrations?: () => void;
}

const COUNTRIES = [
  'Worldwide',
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'Netherlands',
  'United Arab Emirates',
  'Singapore',
  'Nigeria',
  'India',
  'France',
  'Spain',
  'Brazil',
];

export function DiscoveryPage({
  services,
  platforms,
  user,
  onDiscoveryComplete,
  onOpenIntegrations,
}: DiscoveryPageProps) {
  const [selectedService, setSelectedService] = useState<string>('All Services');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [countrySets, setCountrySets] = useState<TargetCountrySet[]>([]);
  const [selectedCountrySetId, setSelectedCountrySetId] = useState<string>('custom');
  const [country, setCountry] = useState<string>('Worldwide');
  const [city, setCity] = useState<string>('');
  const [strictCountryFilter, setStrictCountryFilter] = useState<boolean>(false);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>('');
  const [minScore, setMinScore] = useState<number>(40);
  const [maxResults, setMaxResults] = useState<number>(5);
  const [intelligentMode, setIntelligentMode] = useState<boolean>(true);
  const [intentFilter, setIntentFilter] = useState<string>('ALL');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('ALL');
  const [budgetFilter, setBudgetFilter] = useState<string>('ALL');

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [runSummary, setRunSummary] = useState<any>(null);

  // Manual URL / Post Intake state
  const [manualUrl, setManualUrl] = useState('');
  const [manualPlatform, setManualPlatform] = useState('LinkedIn');
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualServiceHint, setManualServiceHint] = useState('Auto-detect');
  const [manualContent, setManualContent] = useState('');
  const [manualRunning, setManualRunning] = useState(false);
  const [manualResult, setManualResult] = useState<any>(null);
  const [manualError, setManualError] = useState('');

  const canRun = hasPermission(user, 'can_discover');
  const liveConnectors = platforms.filter(
    (p) => p.connection_type !== 'MANUAL_CAPTURE' && p.status === 'READY' && p.is_enabled
  );

  useEffect(() => {
    Promise.all([api.getTargetCountrySets(), api.getCampaigns()])
      .then(([tRes, cRes]) => {
        setCountrySets(tRes.sets);
        const def = tRes.sets.find((s) => s.is_default);
        if (def) setSelectedCountrySetId(String(def.id));
        setCampaigns(cRes.campaigns);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectionTouched && liveConnectors.length > 0) {
      setSelectedPlatforms(liveConnectors.map((c) => c.id));
    }
  }, [platforms.length, liveConnectors.length, selectionTouched]);

  function togglePlatform(id: string) {
    setSelectionTouched(true);
    setSelectedPlatforms((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleRunDiscovery(e: React.FormEvent) {
    e.preventDefault();
    if (!canRun) return;
    if (selectedPlatforms.length === 0) {
      setRunError('Select at least one verified READY data connector, or configure credentials in Data Sources & API Integrations.');
      return;
    }
    setRunning(true);
    setRunError('');
    setRunSummary(null);
    try {
      const chosenSet =
        selectedCountrySetId !== 'custom' ? countrySets.find((s) => s.id === Number(selectedCountrySetId)) : null;
      const targetCountries = chosenSet
        ? chosenSet.countries.slice(0, 20)
        : [city.trim() ? `${city.trim()}, ${country}` : country];

      const { summary } = await api.runDiscovery({
        services: [selectedService],
        platforms: selectedPlatforms,
        countries: targetCountries,
        minScore,
        maxResults,
        intelligentMode,
        campaignId: campaignId ? Number(campaignId) : null,
        strictCountryFilter,
      });
      setRunSummary(summary);
      onDiscoveryComplete();
    } catch (err: any) {
      setRunError(err?.message || 'Discovery run failed');
    } finally {
      setRunning(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canRun) return;
    setManualRunning(true);
    setManualError('');
    setManualResult(null);
    try {
      const res = await api.submitManualIntake({
        url: manualUrl.trim() || undefined,
        platform: manualPlatform,
        author: manualAuthor.trim() || undefined,
        content: manualContent.trim() || undefined,
        service_hint: manualServiceHint,
      });
      setManualResult(res);
      if (res.accepted) {
        setManualUrl('');
        setManualContent('');
        setManualAuthor('');
        onDiscoveryComplete(res.lead?.id);
      }
    } catch (err: any) {
      setManualError(err?.message || 'Manual intake failed');
    } finally {
      setManualRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Live Multi-Platform Discovery Panel */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Global Multi-Platform Buyer Discovery Engine
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Executes multi-variation intent queries across authorized live connectors, verifies genuine buyer intent, scores 0–100, deduplicates, and drafts 5-channel outreach.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              {liveConnectors.length} live connectors ready
            </div>
            {isSuperAdmin(user) && onOpenIntegrations && (
              <button
                type="button"
                onClick={onOpenIntegrations}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30 whitespace-nowrap shrink-0"
              >
                <Plug className="w-3.5 h-3.5" />
                <span>Configure Sources</span>
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleRunDiscovery} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Target Digital Service
              </label>
              <select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
              >
                <option value="All Services">All Services (Intelligent Multi-Category Sweep)</option>
                {services
                  .filter((s) => s.is_active)
                  .map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.group_name})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Target Country Profile (Up to 20)
              </label>
              <select
                value={selectedCountrySetId}
                onChange={(e) => setSelectedCountrySetId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
              >
                <option value="custom">Single Country / Worldwide Scope</option>
                {countrySets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.countries.length}/20 countries)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {selectedCountrySetId === 'custom' ? 'Country / Worldwide' : 'Specific City (Optional)'}
              </label>
              {selectedCountrySetId === 'custom' ? (
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
                >
                  <option value="Worldwide">Worldwide</option>
                  {WORLD_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-600 dark:text-slate-300 truncate">
                  {countrySets.find((s) => s.id === Number(selectedCountrySetId))?.countries.join(', ')}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Assign Campaign / City
              </label>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
              >
                <option value="">No Campaign Tag</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Minimum Lead Score
              </label>
              <select
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value={0}>0+ (Store all valid buyers)</option>
                <option value={40}>40+ (Potential &amp; above)</option>
                <option value={60}>60+ (Qualified &amp; above)</option>
                <option value={80}>80+ (Hot leads only)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Buyer Intent Target
              </label>
              <select
                value={intentFilter}
                onChange={(e) => setIntentFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="ALL">A, B, C &amp; D (All Valid)</option>
                <option value="DIRECT_BUYER">A. Direct Buyer</option>
                <option value="ACTIVE_PROJECT_BUYER">B. Active Project Buyer</option>
                <option value="RECOMMENDATION_REQUEST">C. Recommendation Request</option>
                <option value="UPCOMING_BUYER">D. Upcoming Buyer</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Project Urgency
              </label>
              <select
                value={urgencyFilter}
                onChange={(e) => setUrgencyFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="ALL">Any Urgency</option>
                <option value="IMMEDIATE">Immediate</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Budget Range
              </label>
              <select
                value={budgetFilter}
                onChange={(e) => setBudgetFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="ALL">Any / Unknown</option>
                <option value="500">$500+</option>
                <option value="2000">$2,000+</option>
                <option value="5000">$5,000+</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Max Results / Connector
              </label>
              <input
                type="number"
                min={1}
                max={15}
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Authorized Live Data Connectors (Only verified READY &amp; enabled sources run)
              </div>
              {liveConnectors.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectionTouched(true);
                    setSelectedPlatforms(liveConnectors.map((c) => c.id));
                  }}
                  className="text-[11px] text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  Select All Ready ({liveConnectors.length})
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {platforms
                .filter((p) => p.connection_type !== 'MANUAL_CAPTURE')
                .map((p) => {
                  const available = p.status === 'READY' && p.is_enabled;
                  const checked = available && selectedPlatforms.includes(p.id);
                  const statusLabel =
                    p.status === 'READY'
                      ? p.is_enabled
                        ? 'Ready (Live Tested)'
                        : 'Ready (Disabled)'
                      : p.status === 'APPROVAL_REQUIRED'
                      ? 'Approval / Token Required'
                      : p.status === 'MISSING_CREDENTIALS'
                      ? 'Missing Credentials'
                      : p.status === 'ERROR'
                      ? 'Connection Error'
                      : 'Untested';
                  return (
                    <label
                      key={p.id}
                      className={`flex items-start gap-2.5 p-3 border rounded-md transition-colors ${
                        available ? 'cursor-pointer' : 'cursor-not-allowed opacity-65'
                      } ${
                        checked
                          ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!available}
                        onChange={() => togglePlatform(p.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {p.category} ·{' '}
                          <span
                            className={
                              available
                                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                : p.status === 'ERROR'
                                ? 'text-red-600 dark:text-red-400'
                                : ''
                            }
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={intelligentMode}
                  onChange={(e) => setIntelligentMode(e.target.checked)}
                />
                <span>
                  Intelligent Discovery Mode (recognize emerging digital &amp; AI service terminology)
                </span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={strictCountryFilter}
                  onChange={(e) => setStrictCountryFilter(e.target.checked)}
                />
                <span>
                  Strict Target Country Filter (discard prospects outside selected target countries)
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={running || !canRun}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              <span>{running ? 'Running 8-Agent Pipeline...' : 'Run Live Discovery Sweep'}</span>
            </button>
          </div>
        </form>

        {runError && (
          <div className="mt-4 p-3 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-md text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{runError}</span>
          </div>
        )}

        {runSummary && (
          <div className="mt-5 p-4 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-md">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Discovery Sweep Completed</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono tabular-nums">
              <div>Scanned: {runSummary.total_scanned}</div>
              <div className="text-emerald-700 dark:text-emerald-400">Accepted: {runSummary.accepted}</div>
              <div className="text-amber-700 dark:text-amber-400">Rejected (E/F/Score): {runSummary.rejected + runSummary.below_min_score}</div>
              <div>Duplicates Skipped: {runSummary.duplicates}</div>
              <div>Logs Recorded: {runSummary.logs_created}</div>
            </div>
            {runSummary.errors?.length > 0 && (
              <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                Connector notes: {runSummary.errors.join(' | ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual URL & Post Intake (For Platforms Without Direct Public APIs) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Link2 className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span>Authorized Manual URL &amp; Post Intake (LinkedIn, Facebook Groups, Upwork, Fiverr, X)</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            For platforms requiring private OAuth or without public search APIs, paste any public post URL or buyer statement here to run Agents 2–7 immediately.
          </p>
        </div>

        <form onSubmit={handleManualSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Original Public Post URL
              </label>
              <input
                type="url"
                placeholder="https://www.linkedin.com/posts/... or https://www.reddit.com/r/..."
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Source Platform
              </label>
              <select
                value={manualPlatform}
                onChange={(e) => setManualPlatform(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option>LinkedIn</option>
                <option>Facebook Public Group</option>
                <option>X/Twitter</option>
                <option>Instagram</option>
                <option>Upwork</option>
                <option>Fiverr</option>
                <option>Freelancer</option>
                <option>Indie Hackers</option>
                <option>Product Hunt</option>
                <option>YouTube</option>
                <option>TikTok</option>
                <option>Public Forum</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Author / Company Name
              </label>
              <input
                type="text"
                placeholder="Optional if inside post text"
                value={manualAuthor}
                onChange={(e) => setManualAuthor(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Buyer Post / Request Text
            </label>
            <textarea
              rows={4}
              placeholder="Paste the exact buyer post or requirement here (e.g., 'We are launching a B2B SaaS in Q1 and need a Laravel + React developer to build our billing portal. Budget around $3,500...')"
              value={manualContent}
              onChange={(e) => setManualContent(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={manualServiceHint}
                onChange={(e) => setManualServiceHint(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="Auto-detect">Service: Auto-detect via AI</option>
                {services.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={manualRunning || !canRun}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap shrink-0"
            >
              {manualRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span>{manualRunning ? 'Evaluating Intent & Scoring...' : 'Analyze & Store Prospect'}</span>
            </button>
          </div>
        </form>

        {manualError && (
          <div className="mt-4 p-3 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-md text-xs text-red-700 dark:text-red-300">
            {manualError}
          </div>
        )}

        {manualResult && (
          <div className="mt-4 p-4 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-md text-xs">
            {manualResult.accepted ? (
              <div className="space-y-1">
                <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                  Accepted ({manualResult.action}) — Score {manualResult.lead?.lead_score}/100 ({manualResult.lead?.lead_priority})
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  {manualResult.lead?.prospect_name} · {manualResult.lead?.service_requested} · {manualResult.lead?.intent_classification}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-semibold text-red-700 dark:text-red-400">
                  Rejected by Buyer Intent Agent ({manualResult.intent_classification})
                </div>
                <div className="text-slate-600 dark:text-slate-300">{manualResult.rejection_reason}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
