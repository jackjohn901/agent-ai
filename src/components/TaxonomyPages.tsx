import React, { useState } from 'react';
import { Plus, Globe } from 'lucide-react';
import { api, canOperate } from '../lib/api';
import type { LeadRecord, ServiceCategory, UserAccount } from '../../shared/types';

export function ServiceCategoriesPage({
  services,
  user,
  onUpdate,
}: {
  services: ServiceCategory[];
  user: UserAccount;
  onUpdate: (services: ServiceCategory[]) => void;
}) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('Custom & Emerging Services');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState('');

  const canEdit = canOperate(user);
  const groups = Array.from(new Set(services.map((s) => s.group_name)));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !canEdit) return;
    setError('');
    try {
      const res = await api.addService({
        name: name.trim(),
        group_name: group,
        keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      });
      onUpdate(res.services);
      setName('');
      setKeywords('');
    } catch (err: any) {
      setError(err?.message || 'Failed to add service');
    }
  }

  async function handleToggle(id: number, current: boolean) {
    if (!canEdit) return;
    const res = await api.toggleService(id, !current);
    onUpdate(res.services);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Service Categories ({services.length} Active &amp; Emerging)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Includes all 50 core digital &amp; technology service categories plus dynamically recognized emerging demands.
            </p>
          </div>
        </div>

        {canEdit && (
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <input
              type="text"
              placeholder="New or emerging service name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <input
              type="text"
              placeholder="Category group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <input
              type="text"
              placeholder="Buyer keywords (comma separated)"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              className="px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Service Category</span>
            </button>
          </form>
        )}
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {groups.map((g) => {
          const items = services.filter((s) => s.group_name === g);
          return (
            <div key={g} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                {g} ({items.length})
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((s) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {s.name}
                        {s.is_emerging && (
                          <span className="ml-2 text-[11px] font-mono text-blue-700 dark:text-blue-400">Emerging</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {s.keywords.length > 0 ? s.keywords.join(', ') : 'AI contextual intent detection'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {s.lead_count || 0} leads
                      </span>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => handleToggle(s.id, s.is_active)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded border ${
                          s.is_active
                            ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20'
                            : 'border-slate-300 dark:border-slate-700 text-slate-500'
                        }`}
                      >
                        {s.is_active ? 'Active' : 'Paused'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GeographicResearchPage({
  leads,
  onSelectLead,
}: {
  leads: LeadRecord[];
  onSelectLead: (id: number) => void;
}) {
  const [selectedCountry, setSelectedCountry] = useState<string>('ALL');

  const countryStats = new Map<string, { count: number; hot: number; pipeline: number }>();
  for (const l of leads) {
    const c = l.country?.trim() || 'Unspecified / Global Remote';
    const cur = countryStats.get(c) || { count: 0, hot: 0, pipeline: 0 };
    cur.count += 1;
    if (l.lead_score >= 80) cur.hot += 1;
    cur.pipeline += l.deal_value || 0;
    countryStats.set(c, cur);
  }

  const countries = Array.from(countryStats.entries()).sort((a, b) => b[1].count - a[1].count);
  const filteredLeads =
    selectedCountry === 'ALL'
      ? leads
      : leads.filter((l) => (l.country?.trim() || 'Unspecified / Global Remote') === selectedCountry);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Geographic Buyer Distribution
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Countries and cities recorded only when publicly verified in the buyer post or company profile.
        </p>

        {countries.length === 0 ? (
          <div className="mt-6 text-xs text-slate-500">No geographic data discovered yet. Run Global Discovery to collect international buyers.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
            <button
              onClick={() => setSelectedCountry('ALL')}
              className={`text-left p-3 border rounded-md transition-colors ${
                selectedCountry === 'ALL'
                  ? 'border-blue-700 bg-blue-50/40 dark:bg-blue-950/20'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">All Countries</div>
              <div className="text-lg font-mono tabular-nums font-bold mt-1">{leads.length}</div>
            </button>
            {countries.map(([country, st]) => (
              <button
                key={country}
                onClick={() => setSelectedCountry(country)}
                className={`text-left p-3 border rounded-md transition-colors ${
                  selectedCountry === country
                    ? 'border-blue-700 bg-blue-50/40 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{country}</div>
                <div className="text-lg font-mono tabular-nums font-bold mt-1">{st.count}</div>
                <div className="text-[11px] text-slate-500 tabular-nums">{st.hot} hot leads</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100">
          Prospects in {selectedCountry === 'ALL' ? 'Worldwide Scope' : selectedCountry} ({filteredLeads.length})
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filteredLeads.map((l) => (
            <div
              key={l.id}
              onClick={() => onSelectLead(l.id)}
              className="px-5 py-3 flex items-center justify-between gap-4 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
            >
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {l.prospect_name} {l.company_name ? `· ${l.company_name}` : ''}
                </div>
                <div className="text-slate-500">
                  {l.service_requested} · {l.city ? `${l.city}, ` : ''}
                  {l.country || 'Unspecified'}
                </div>
              </div>
              <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">{l.lead_score}/100</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
