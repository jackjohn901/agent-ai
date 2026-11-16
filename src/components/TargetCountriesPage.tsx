import React, { useEffect, useState } from 'react';
import { Check, Globe, Plus, Search, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { CountryInfo } from '../../shared/countries';
import type { TargetCountrySet } from '../../shared/types';

export function TargetCountriesPage() {
  const [countries, setCountries] = useState<CountryInfo[]>([]);
  const [maxLimit, setMaxLimit] = useState(20);
  const [sets, setSets] = useState<TargetCountrySet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);
  const [setName, setSetName] = useState('');
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [isDefault, setIsDefault] = useState(true);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadAll() {
    const [cRes, sRes] = await Promise.all([api.getWorldCountries(), api.getTargetCountrySets()]);
    setCountries(cRes.countries);
    setMaxLimit(cRes.max_target_countries || 20);
    setSets(sRes.sets);
    if (sRes.sets.length > 0 && selectedSetId === null) {
      const def = sRes.sets.find((s) => s.is_default) || sRes.sets[0];
      setSelectedSetId(def.id);
      setSetName(def.name);
      setSelectedCountries(def.countries);
      setIsDefault(def.is_default);
    }
  }

  useEffect(() => {
    loadAll().catch(() => {});
  }, []);

  function selectProfile(s: TargetCountrySet) {
    setSelectedSetId(s.id);
    setSetName(s.name);
    setSelectedCountries(s.countries);
    setIsDefault(s.is_default);
    setFeedback(null);
  }

  function startNewProfile() {
    setSelectedSetId(null);
    setSetName('');
    setSelectedCountries([]);
    setIsDefault(false);
    setFeedback(null);
  }

  function toggleCountry(countryName: string) {
    setFeedback(null);
    setSelectedCountries((prev) => {
      if (prev.includes(countryName)) {
        return prev.filter((c) => c !== countryName);
      }
      if (prev.length >= maxLimit) {
        setFeedback({
          ok: false,
          text: `Maximum ${maxLimit} target countries allowed per campaign or profile. Remove one before adding another.`,
        });
        return prev;
      }
      return [...prev, countryName];
    });
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!setName.trim()) {
      setFeedback({ ok: false, text: 'Enter a profile name for this target country list.' });
      return;
    }
    if (selectedCountries.length === 0) {
      setFeedback({ ok: false, text: 'Select at least 1 target country.' });
      return;
    }
    if (selectedCountries.length > maxLimit) {
      setFeedback({ ok: false, text: `Cannot exceed ${maxLimit} target countries.` });
      return;
    }

    setSaving(true);
    try {
      if (selectedSetId) {
        const res = await api.updateTargetCountrySet(selectedSetId, {
          name: setName.trim(),
          countries: selectedCountries,
          is_default: isDefault,
        });
        setSets(res.sets);
        setFeedback({ ok: true, text: `Updated "${setName.trim()}" (${selectedCountries.length}/${maxLimit} countries).` });
      } else {
        const res = await api.createTargetCountrySet({
          name: setName.trim(),
          countries: selectedCountries,
          is_default: isDefault,
        });
        setSets(res.sets);
        setSelectedSetId(res.id);
        setFeedback({ ok: true, text: `Saved new target country profile "${setName.trim()}".` });
      }
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Failed to save target country profile' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setFeedback(null);
    const res = await api.deleteTargetCountrySet(id);
    setSets(res.sets);
    if (selectedSetId === id) {
      if (res.sets.length > 0) {
        selectProfile(res.sets[0]);
      } else {
        startNewProfile();
      }
    }
  }

  const regions = ['ALL', ...Array.from(new Set(countries.map((c) => c.region)))];
  const filteredCountries = countries.filter((c) => {
    if (region !== 'ALL' && c.region !== region) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.primaryLanguage.toLowerCase().includes(q) ||
        c.complianceRegime.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedInfoList = countries.filter((c) => selectedCountries.includes(c.name));

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Global Target Country Selector (Up to {maxLimit} Countries per Profile / Campaign)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Scope global buyer discovery and cold-email campaigns across up to {maxLimit} verified countries. Discovery never fabricates a country when prospect location is unverified.
            </p>
          </div>
          <button
            type="button"
            onClick={startNewProfile}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Country Profile</span>
          </button>
        </div>

        {/* Saved Profiles */}
        {sets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
            {sets.map((s) => (
              <div
                key={s.id}
                onClick={() => selectProfile(s)}
                className={`p-3.5 border rounded-md cursor-pointer transition-colors ${
                  selectedSetId === s.id
                    ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {s.name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                      {s.countries.length} / {maxLimit} countries
                      {s.is_default ? ' · Default Discovery Scope' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {s.is_default && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      className="p-1 text-slate-400 hover:text-red-600"
                      title="Delete profile"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-2">
                  {s.countries.join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Worldwide Searchable Selector */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Worldwide Country Directory ({countries.length} Countries)
            </h3>
            <span className="text-xs font-mono tabular-nums text-blue-700 dark:text-blue-400 font-semibold">
              {selectedCountries.length} / {maxLimit} Selected
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search country, ISO code, language, law..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            >
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r === 'ALL' ? 'All Worldwide Regions' : r}
                </option>
              ))}
            </select>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800 max-h-[480px] overflow-y-auto">
            {filteredCountries.map((c) => {
              const checked = selectedCountries.includes(c.name);
              const disabled = !checked && selectedCountries.length >= maxLimit;
              return (
                <label
                  key={c.code}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-colors ${
                    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  } ${checked ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleCountry(c.name)}
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {c.name}{' '}
                        <span className="font-mono text-[11px] text-slate-400">({c.code})</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {c.region} · Language: {c.primaryLanguage} · {c.complianceRegime}
                      </div>
                    </div>
                  </div>
                  {checked && <Check className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400 shrink-0" />}
                </label>
              );
            })}
          </div>
        </div>

        {/* Selected Profile Editor & Compliance Rules */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {selectedSetId ? 'Edit Target Country Profile' : 'Create Target Country Profile'}
          </h3>

          <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Profile Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Europe + North America SaaS Buyers"
                value={setName}
                onChange={(e) => setSetName(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              <span>Set as default geographic scope for discovery runs</span>
            </label>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Selected Countries ({selectedCountries.length}/{maxLimit})
                </span>
                {selectedCountries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCountries([])}
                    className="text-[11px] text-red-600 hover:underline"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {selectedCountries.length === 0 ? (
                <div className="p-4 border border-dashed border-slate-300 dark:border-slate-700 rounded text-slate-500 text-center">
                  Select up to {maxLimit} countries from the directory on the left.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto">
                  {selectedInfoList.map((c) => (
                    <div key={c.code} className="px-3 py-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {c.name} · <span className="text-slate-500">{c.primaryLanguage}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-start gap-1">
                          <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
                          <span>
                            {c.complianceRegime}: {c.complianceNote}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCountry(c.name)}
                        className="text-[11px] text-slate-400 hover:text-red-600 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {feedback && (
              <div
                className={`p-2.5 border rounded text-xs ${
                  feedback.ok
                    ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                    : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md disabled:opacity-60"
            >
              {saving ? 'Saving...' : selectedSetId ? 'Update Target Country Profile' : 'Save Target Country Profile'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
