import React from 'react';
import { ArrowUpRight, Compass, ExternalLink, PlusCircle } from 'lucide-react';
import type { AppSettings, DashboardMetrics, LeadRecord } from '../../shared/types';

interface OverviewPageProps {
  metrics: DashboardMetrics | null;
  settings: AppSettings | null;
  recentLeads: LeadRecord[];
  onNavigate: (page: string, leadId?: number) => void;
}

export function OverviewPage({ metrics, settings, recentLeads, onNavigate }: OverviewPageProps) {
  const m = metrics;
  const target30 = settings?.thirty_day_revenue_target || 5000;
  const targetStretch = settings?.stretch_revenue_target || 25000;
  const collected = m?.actual_revenue_received || 0;
  const pipeline = m?.total_pipeline_value || 0;
  const pct30 = Math.min(100, Math.round((collected / target30) * 100));
  const pctStretch = Math.min(100, Math.round((collected / targetStretch) * 100));

  const formatUSD = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      {/* Top Hero / Revenue & Discovery Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Live Acquisition &amp; Revenue Performance
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  All figures computed directly from verified database records. Pipeline value is strictly separated from collected revenue.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  onClick={() => onNavigate('email_approval')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Email Approval Center</span>
                </button>
                <button
                  onClick={() => onNavigate('discovery')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Launch Live Discovery</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-slate-100 dark:border-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Total Discovered</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                  {m?.total_leads ?? 0}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                  {m?.leads_today ?? 0} today
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Qualified (60+)</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                  {m?.qualified_leads ?? 0}
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">
                  {m?.hot_leads ?? 0} hot (80+)
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Outreach Sent</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                  {m?.outreach_sent ?? 0}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                  {m?.outreach_prepared ?? 0} prepared · {m?.replies_received ?? 0} replies
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Deals Won</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                  {m?.deals_won ?? 0}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                  {m?.interested_prospects ?? 0} interested
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Verified Contact</span>
              <div className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {m?.leads_with_verified_contact ?? 0} leads
              </div>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Awaiting Approval</span>
              <div className="font-mono font-medium text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">
                {(m?.outreach_prepared ?? 0) - (m?.outreach_sent ?? 0) - (m?.outreach_approved ?? 0) > 0
                  ? (m?.outreach_prepared ?? 0) - (m?.outreach_sent ?? 0) - (m?.outreach_approved ?? 0)
                  : 0}{' '}
                drafts
              </div>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Active Pipeline</span>
              <div className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {formatUSD(pipeline)}
              </div>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Collected Revenue</span>
              <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">
                {formatUSD(collected)}
              </div>
            </div>
          </div>
        </div>

        {/* Revenue Targets Tracker */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Commercial Targets</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Pursued targets tracked against actual paid revenue.
            </p>

            <div className="mt-5 space-y-5">
              <div>
                <div className="flex items-baseline justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-700 dark:text-slate-300">30-Day Target</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatUSD(collected)} / {formatUSD(target30)} ({pct30}%)
                  </span>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                  <div className="h-full bg-blue-700 transition-all" style={{ width: `${pct30}%` }} />
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Stretch Target ({settings?.stretch_target_deadline || '2026-12-25'})
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatUSD(collected)} / {formatUSD(targetStretch)} ({pctStretch}%)
                  </span>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                  <div className="h-full bg-emerald-600 transition-all" style={{ width: `${pctStretch}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">Full email &amp; revenue funnel</span>
            <button
              onClick={() => onNavigate('email_analytics')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              <span>Email Analytics &amp; Calculator</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Distribution Grids: By Platform / By Service / By Country */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DistributionPanel
          title="Leads by Platform"
          items={m?.by_platform || []}
          emptyText="Run discovery or manual intake to populate platform metrics."
        />
        <DistributionPanel
          title="Leads by Service"
          items={m?.by_service || []}
          emptyText="Service breakdown updates as qualified buyers are stored."
        />
        <DistributionPanel
          title="Leads by Country"
          items={m?.by_country || []}
          emptyText="Geographic coverage populates from verified prospect locations."
        />
      </div>

      {/* Recent High-Intent Buyers Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Qualified &amp; Hot Buyer Opportunities
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ranked by commercial intent score. Click any buyer to inspect evidence, 10-point analysis, and outreach drafts.
            </p>
          </div>
          <button
            onClick={() => onNavigate('leads_database')}
            className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
          >
            Open Leads Database
          </button>
        </div>

        {recentLeads.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No qualified buyer records stored yet
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-lg mx-auto">
              This database contains zero fabricated demo leads. Run a live multi-platform discovery sweep or submit a public buyer post URL to inspect real opportunities.
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => onNavigate('discovery')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Run First Discovery Sweep</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Prospect / Company</th>
                  <th className="py-2.5 px-4">Service Needed</th>
                  <th className="py-2.5 px-4">Platform &amp; Location</th>
                  <th className="py-2.5 px-4">Intent</th>
                  <th className="py-2.5 px-4 text-right">Score</th>
                  <th className="py-2.5 px-4">Budget</th>
                  <th className="py-2.5 px-4 text-right">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                {recentLeads.slice(0, 10).map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => onNavigate('lead_details', lead.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{lead.prospect_name}</div>
                      <div className="text-slate-500 dark:text-slate-400">
                        {lead.company_name || lead.username || lead.lead_code}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-900 dark:text-slate-100 font-medium">{lead.service_requested}</div>
                      <div className="text-slate-500 dark:text-slate-400 truncate max-w-xs">{lead.project_description}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {lead.social_platform} · {lead.country || 'Unverified'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-700 dark:text-slate-300 font-medium">
                        {lead.intent_classification.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <span
                        className={
                          lead.lead_score >= 80
                            ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                            : lead.lead_score >= 60
                            ? 'text-blue-700 dark:text-blue-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-400'
                        }
                      >
                        {lead.lead_score}/100 ({lead.lead_priority})
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {lead.budget || 'Unknown'} · {lead.budget_evidence_type.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <a
                        href={lead.original_post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                        <span>Original</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DistributionPanel({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ name: string; count: number }>;
  emptyText: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      ) : (
        <div className="space-y-2.5">
          {items.slice(0, 6).map((item) => (
            <div key={item.name} className="text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-700 dark:text-slate-300 truncate pr-2">{item.name}</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{item.count}</span>
              </div>
              <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                <div
                  className="h-full bg-slate-700 dark:bg-slate-400"
                  style={{ width: `${Math.round((item.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
