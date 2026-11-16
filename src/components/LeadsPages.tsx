import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Loader2, Mail, RefreshCw, Search, Trash2, Ban, Save } from 'lucide-react';
import { api, hasPermission, isAdmin, downloadAuthenticatedFile } from '../lib/api';
import type { ContactHistoryItem, LeadRecord, ResearchEnrichResult, ServiceCategory, UserAccount } from '../../shared/types';
import { GeographicResearchPage, ServiceCategoriesPage } from './TaxonomyPages';
import { CrmPipelinePage } from './OutreachCrmPages';

interface LeadsListPageProps {
  mode: 'all' | 'social' | 'high_intent';
  leads: LeadRecord[];
  onSelectLead: (id: number) => void;
  onNavigateDiscovery: () => void;
}

export function LeadsListPage({ mode, leads, onSelectLead, onNavigateDiscovery }: LeadsListPageProps) {
  const [search, setSearch] = useState('');
  const [intentFilter, setIntentFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [platformFilter, setPlatformFilter] = useState('ALL');
  const [exporting, setExporting] = useState(false);

  const socialPlatforms = ['Reddit', 'LinkedIn', 'X/Twitter', 'Facebook', 'Instagram', 'TikTok', 'YouTube'];

  const filtered = leads.filter((l) => {
    if (mode === 'social') {
      const isSocial = socialPlatforms.some((sp) => l.social_platform.toLowerCase().includes(sp.toLowerCase()));
      if (!isSocial) return false;
    }
    if (mode === 'high_intent') {
      if (l.lead_score < 60) return false;
      if (!['DIRECT_BUYER', 'ACTIVE_PROJECT_BUYER', 'RECOMMENDATION_REQUEST'].includes(l.intent_classification)) {
        return false;
      }
    }
    if (intentFilter !== 'ALL' && l.intent_classification !== intentFilter) return false;
    if (priorityFilter !== 'ALL' && l.lead_priority !== priorityFilter) return false;
    if (platformFilter !== 'ALL' && l.social_platform !== platformFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${l.prospect_name} ${l.company_name || ''} ${l.service_requested} ${l.project_description} ${l.country || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const uniquePlatforms = Array.from(new Set(leads.map((l) => l.social_platform)));

  const title =
    mode === 'social'
      ? 'Social Media Opportunities'
      : mode === 'high_intent'
      ? 'High-Intent Buyers (60–100 Score)'
      : 'All Qualified & Upcoming Leads';

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing {filtered.length} of {leads.length} deduplicated buyer records
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadAuthenticatedFile('/api/export/leads.csv', 'ai-buyer-hunter-leads.csv');
                } finally {
                  setExporting(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search prospect, company, service..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>

          <select
            value={intentFilter}
            onChange={(e) => setIntentFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
          >
            <option value="ALL">All Intent Classifications</option>
            <option value="DIRECT_BUYER">A. Direct Buyer</option>
            <option value="ACTIVE_PROJECT_BUYER">B. Active Project Buyer</option>
            <option value="RECOMMENDATION_REQUEST">C. Recommendation Request</option>
            <option value="UPCOMING_BUYER">D. Upcoming Buyer</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
          >
            <option value="ALL">All Priorities</option>
            <option value="HOT">Hot Lead (80–100)</option>
            <option value="QUALIFIED">Qualified Lead (60–79)</option>
            <option value="POTENTIAL">Potential Lead (40–59)</option>
            <option value="LOW_PRIORITY">Low Priority (0–39)</option>
          </select>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
          >
            <option value="ALL">All Platforms</option>
            {uniquePlatforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No matching buyer records</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Adjust filters or run Global Lead Discovery to collect live buyer requests.
            </p>
            <button
              onClick={onNavigateDiscovery}
              className="mt-4 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
            >
              Open Global Discovery
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">ID / Prospect</th>
                  <th className="py-2.5 px-4">Service &amp; Scope</th>
                  <th className="py-2.5 px-4">Source &amp; Geography</th>
                  <th className="py-2.5 px-4">Intent &amp; Urgency</th>
                  <th className="py-2.5 px-4 text-right">Score</th>
                  <th className="py-2.5 px-4">Budget</th>
                  <th className="py-2.5 px-4">CRM Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => onSelectLead(lead.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{lead.prospect_name}</div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {lead.lead_code} · {lead.company_name || lead.username || 'Individual'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{lead.service_requested}</div>
                      <div className="text-slate-500 dark:text-slate-400 truncate max-w-xs">{lead.project_description}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      <div>{lead.social_platform}</div>
                      <div className="text-[11px] text-slate-500">
                        {lead.city ? `${lead.city}, ` : ''}
                        {lead.country || 'Unverified'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-800 dark:text-slate-200">{lead.intent_classification.replace(/_/g, ' ')}</div>
                      <div className="text-[11px] text-slate-500">Urgency: {lead.urgency}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <div
                        className={
                          lead.lead_score >= 80
                            ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                            : lead.lead_score >= 60
                            ? 'text-blue-700 dark:text-blue-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-400'
                        }
                      >
                        {lead.lead_score}/100
                      </div>
                      <div className="text-[11px] text-slate-500">{lead.lead_priority}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-800 dark:text-slate-200">{lead.budget || 'Unknown'}</div>
                      <div className="text-[11px] text-slate-500">{lead.budget_evidence_type.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-800 dark:text-slate-200">{lead.deal_status}</div>
                      <div className="text-[11px] text-slate-500">Outreach: {lead.outreach_approval_status}</div>
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

interface LeadDetailsPageProps {
  leadId: number | null;
  user: UserAccount;
  usersList?: UserAccount[];
  onBack: () => void;
  onRefresh: () => void;
  onOpenOutreach: (leadId: number) => void;
  onOpenAiEmailWriter?: (leadId: number) => void;
}

export function LeadDetailsPage({
  leadId,
  user,
  usersList = [],
  onBack,
  onRefresh,
  onOpenOutreach,
  onOpenAiEmailWriter,
}: LeadDetailsPageProps) {
  const [lead, setLead] = useState<LeadRecord | null>(null);
  const [history, setHistory] = useState<ContactHistoryItem[]>([]);
  const [dups, setDups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dealStatus, setDealStatus] = useState('');
  const [dealValue, setDealValue] = useState('0');
  const [revenueReceived, setRevenueReceived] = useState('0');
  const [assignedProvider, setAssignedProvider] = useState('');
  const [assignedUserId, setAssignedUserId] = useState<string>('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichSteps, setEnrichSteps] = useState<ResearchEnrichResult['steps_executed']>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!leadId) return;
    setLoading(true);
    api
      .getLeadDetail(leadId)
      .then((res) => {
        setLead(res.lead);
        setHistory(res.contact_history);
        setDups(res.duplicate_links);
        setDealStatus(res.lead.deal_status);
        setDealValue(String(res.lead.deal_value || 0));
        setRevenueReceived(String(res.lead.revenue_received || 0));
        setAssignedProvider(res.lead.assigned_service_provider || '');
        setAssignedUserId(res.lead.assigned_user_id ? String(res.lead.assigned_user_id) : '');
        setBusinessEmail(res.lead.public_business_email || '');
        setNotes(res.lead.internal_notes || '');
      })
      .finally(() => setLoading(false));
  }, [leadId]);

  if (!leadId) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-10 text-center">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No lead selected</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Select any buyer from Leads Database or Overview to inspect their full 38-field dossier.
        </p>
        <button onClick={onBack} className="mt-4 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md">
          Browse Leads Database
        </button>
      </div>
    );
  }

  if (loading || !lead) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-xs text-slate-500">
        Loading full prospect dossier...
      </div>
    );
  }

  const canEdit = hasPermission(user, 'can_manage_leads');
  const adminRole = isAdmin(user);

  async function handleSaveCrm() {
    if (!lead || !canEdit) return;
    setSaving(true);
    setMsg('');
    try {
      const patch: Record<string, any> = {
        deal_status: dealStatus,
        deal_value: Number(dealValue),
        revenue_received: Number(revenueReceived),
        assigned_service_provider: assignedProvider,
        public_business_email: businessEmail.trim() || null,
        internal_notes: notes,
      };
      if (adminRole) {
        patch.assigned_user_id = assignedUserId ? Number(assignedUserId) : null;
      }
      const { lead: updated } = await api.updateLead(lead.id, patch);
      setLead(updated);
      setMsg('CRM, assignment & revenue record saved.');
      onRefresh();
    } catch (err: any) {
      setMsg(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleSuppress() {
    if (!lead || !canEdit) return;
    const idStr = lead.public_business_email || lead.username || lead.original_post_url;
    await api.addSuppression(idStr, 'Operator added to suppression list from Lead Details');
    setMsg(`Added ${idStr} to opt-out suppression list.`);
  }

  async function handleResearchEnrich() {
    if (!lead || !canEdit) return;
    setEnriching(true);
    setMsg('');
    try {
      const res = await api.researchEnrichLead(lead.id);
      setLead(res.lead);
      setBusinessEmail(res.lead.public_business_email || '');
      setEnrichSteps(res.steps_executed);
      setMsg(
        `11-Step Research complete: ${
          res.lead.contact_email_status === 'EMAIL_UNAVAILABLE'
            ? 'CONTACT NOT FOUND'
            : res.lead.contact_email_status?.replace(/_/g, ' ')
        }${res.credits_consumed > 0 ? ` (${res.credits_consumed} enrichment credits used)` : ''}.`
      );
      onRefresh();
    } catch (err: any) {
      setMsg(err?.message || 'Research & enrichment failed');
    } finally {
      setEnriching(false);
    }
  }

  async function handleDelete() {
    if (!lead || !canEdit) return;
    await api.deleteLead(lead.id);
    onRefresh();
    onBack();
  }

  const sb = lead.score_breakdown || ({} as any);
  const analysis = lead.ai_opportunity_analysis || ({} as any);
  const contactStatusLabel =
    lead.contact_email_status === 'EMAIL_UNAVAILABLE'
      ? 'CONTACT NOT FOUND'
      : (lead.contact_email_status || 'EMAIL_UNAVAILABLE').replace(/_/g, ' ');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Leads</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              type="button"
              disabled={enriching}
              onClick={handleResearchEnrich}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {enriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{enriching ? 'Researching...' : 'Run 11-Step Research & Enrich'}</span>
            </button>
          )}
          {onOpenAiEmailWriter && (
            <button
              onClick={() => onOpenAiEmailWriter(lead.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Write AI Cold Email</span>
            </button>
          )}
          <button
            onClick={() => onOpenOutreach(lead.id)}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap shrink-0"
          >
            5-Channel Outreach
          </button>
          {canEdit && (
            <>
              <button
                onClick={handleSuppress}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md whitespace-nowrap shrink-0"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Suppress</span>
              </button>
              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Summary & Score */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {lead.lead_code} · Discovered {lead.date_discovered} · {lead.social_platform}
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {lead.prospect_name} {lead.company_name ? `— ${lead.company_name}` : ''}
              </h2>
              <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                {lead.service_requested} · {lead.intent_classification.replace(/_/g, ' ')} · Urgency: {lead.urgency}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
                {lead.lead_score}/100
              </div>
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{lead.lead_priority}</div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Original Buyer Statement &amp; Evidence
            </h3>
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
              &ldquo;{lead.original_buyer_statement}&rdquo;
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <a
                href={lead.original_post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline"
              >
                <span>Open Original Source Post</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <span>Posted: {lead.date_posted || 'Unknown'}</span>
              <span>{lead.evidence_notes}</span>
            </div>
          </div>

          {/* Verified Business Intelligence Grid (All 38 fields + Contact Verification) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <FieldItem label="Username / Handle" value={lead.username || 'Not listed'} />
            <FieldItem label="Verified Country" value={lead.country || 'Unverified'} />
            <FieldItem label="City" value={lead.city || 'Unverified'} />
            <FieldItem label="Detected Language" value={lead.detected_language || 'Auto-detect'} />
            <FieldItem label="Budget" value={lead.budget || 'Unknown'} />
            <FieldItem label="Budget Evidence" value={lead.budget_evidence_type.replace(/_/g, ' ')} />
            <FieldItem label="Decision-Maker Status" value={lead.decision_maker_role || lead.decision_maker_status} />
            <FieldItem label="Company Industry" value={lead.company_industry || 'Unverified'} />
            <FieldItem label="Company Website" value={lead.company_website || 'Not publicly listed'} isLink={Boolean(lead.company_website)} />
            <FieldItem label="Business Email" value={lead.public_business_email || 'CONTACT NOT FOUND'} />
            <FieldItem label="Email Verification Status" value={contactStatusLabel} />
            <FieldItem label="Verification Source" value={lead.contact_verification_source || 'Unverified'} />
            <FieldItem label="Public Profile URL" value={lead.public_profile_url || 'Not listed'} isLink={Boolean(lead.public_profile_url)} />
            <FieldItem label="Preferred Contact" value={lead.preferred_contact_method || 'Platform reply'} />
            <FieldItem label="Follow-Up Date" value={lead.follow_up_date || 'Not scheduled'} />
          </div>

          {(lead.company_research_summary || enrichSteps.length > 0) && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              {lead.company_research_summary && (
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-xs text-slate-700 dark:text-slate-300">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                    Verified Company &amp; Prospect Research Summary
                  </div>
                  <p>{lead.company_research_summary}</p>
                </div>
              )}
              {enrichSteps.length > 0 && (
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md space-y-1 text-[11px]">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    11-Step Enrichment Pipeline Trace
                  </div>
                  {enrichSteps.map((s, idx) => (
                    <div key={idx} className="font-mono text-slate-600 dark:text-slate-300">
                      [{s.status}] {s.name}: {s.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 10-Point AI Business Opportunity Analysis */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              AI Business Opportunity Analysis (10-Point Assessment)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <AnalysisBox q="01. Trying to Accomplish" a={analysis.trying_to_accomplish} />
              <AnalysisBox q="02. Service Requested" a={analysis.service_looking_for} />
              <AnalysisBox q="03. Problem Experienced" a={analysis.problem_experiencing} />
              <AnalysisBox q="04. Confirming Information" a={analysis.confirming_information} />
              <AnalysisBox q="05. Desired Outcome" a={analysis.desired_outcome} />
              <AnalysisBox q="06. Recommended Primary Service" a={analysis.recommended_primary_service} />
              <AnalysisBox q="07. Decision Maker" a={analysis.decision_maker_assessment} />
              <AnalysisBox q="08. Active Project Evidence" a={analysis.active_project_evidence} />
              <AnalysisBox q="09. Next Best Approach" a={analysis.next_best_approach} />
              <AnalysisBox q="10. Conversion Risks" a={analysis.conversion_risks} />
            </div>
          </div>
        </div>

        {/* Right Column: Scoring Breakdown + CRM Controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Lead Scoring Breakdown (100 pts)
            </h3>
            <div className="space-y-2.5 text-xs">
              <ScoreRow label="Explicit Buying Intent" val={sb.explicit_buying_intent || 0} max={25} />
              <ScoreRow label="Clear Project Requirements" val={sb.clear_project_requirements || 0} max={15} />
              <ScoreRow label="Decision-Maker Evidence" val={sb.decision_maker_evidence || 0} max={15} />
              <ScoreRow label="Urgency / Active Hiring" val={sb.urgency_or_active_hiring || 0} max={15} />
              <ScoreRow label="Budget Evidence" val={sb.budget_evidence || 0} max={15} />
              <ScoreRow label="Relevant Service Fit" val={sb.relevant_service_fit || 0} max={10} />
              <ScoreRow label="Recent Accessible Evidence" val={sb.recent_accessible_evidence || 0} max={5} />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">CRM &amp; Revenue Tracking</h3>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Deal Status</label>
              <select
                value={dealStatus}
                disabled={!canEdit}
                onChange={(e) => setDealStatus(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                {[
                  'Message Prepared',
                  'Message Approved',
                  'Message Sent',
                  'Reply Received',
                  'Interested Prospect',
                  'Call Requested',
                  'Meeting Booked',
                  'Proposal Submitted',
                  'Negotiation',
                  'Won',
                  'Lost',
                  'Follow-Up Due',
                ].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Pipeline Value ($)
                </label>
                <input
                  type="number"
                  disabled={!canEdit}
                  value={dealValue}
                  onChange={(e) => setDealValue(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Revenue Received ($)
                </label>
                <input
                  type="number"
                  disabled={!canEdit}
                  value={revenueReceived}
                  onChange={(e) => setRevenueReceived(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Verified Business Email
              </label>
              <input
                type="email"
                disabled={!canEdit}
                placeholder="contact@company.com"
                value={businessEmail}
                onChange={(e) => setBusinessEmail(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            {adminRole && usersList.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Assigned Team Member
                </label>
                <select
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  <option value="">Unassigned / Owner Pool</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Assigned Service Provider
              </label>
              <input
                type="text"
                disabled={!canEdit}
                placeholder="Agency / Specialist"
                value={assignedProvider}
                onChange={(e) => setAssignedProvider(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Internal Notes</label>
              <textarea
                rows={3}
                disabled={!canEdit}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            {canEdit && (
              <button
                onClick={handleSaveCrm}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Save CRM Updates'}</span>
              </button>
            )}
            {msg && <div className="text-[11px] text-emerald-700 dark:text-emerald-400">{msg}</div>}
          </div>

          {/* Contact History & Linked Cross-Platform Sources */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              Contact History ({history.length})
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No messages sent or logged yet.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {history.map((h) => (
                  <div key={h.id} className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {h.direction} · {h.channel} · {h.status}
                    </div>
                    <div className="text-slate-500 text-[11px] mt-0.5">{h.created_at}</div>
                    <div className="text-slate-700 dark:text-slate-300 mt-1">{h.message}</div>
                  </div>
                ))}
              </div>
            )}

            {dups.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  Linked Cross-Platform Sources ({dups.length})
                </div>
                {dups.map((d) => (
                  <div key={d.id} className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                    {d.platform}: <a href={d.duplicate_source_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">{d.duplicate_source_url}</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldItem({ label, value, isLink = false }: { label: string; value: string; isLink?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      {isLink ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 dark:text-blue-400 hover:underline truncate block mt-0.5"
        >
          {value}
        </a>
      ) : (
        <div className="font-medium text-slate-900 dark:text-slate-100 truncate mt-0.5">{value}</div>
      )}
    </div>
  );
}

function AnalysisBox({ q, a }: { q: string; a: string }) {
  return (
    <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-slate-950/50">
      <div className="font-semibold text-slate-800 dark:text-slate-200 mb-1">{q}</div>
      <div className="text-slate-600 dark:text-slate-400 leading-relaxed">{a || 'Not specified'}</div>
    </div>
  );
}

function ScoreRow({ label, val, max }: { label: string; val: number; max: number }) {
  const pct = Math.round((val / max) * 100);
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
          {val}/{max}
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
        <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function LeadsDatabasePage({
  leads,
  services,
  user,
  usersList,
  selectedLeadId,
  initialTab,
  onSelectLead,
  onUpdateServices,
  onRefresh,
  onNavigateDiscovery,
  onOpenOutreach,
  onOpenAiEmailWriter,
}: {
  leads: LeadRecord[];
  services: ServiceCategory[];
  user: UserAccount;
  usersList: UserAccount[];
  selectedLeadId: number | null;
  initialTab?: 'all' | 'social' | 'high_intent' | 'services' | 'geography' | 'crm' | 'details';
  onSelectLead: (id: number) => void;
  onUpdateServices: (s: ServiceCategory[]) => void;
  onRefresh: () => void;
  onNavigateDiscovery: () => void;
  onOpenOutreach: (id: number) => void;
  onOpenAiEmailWriter: (id: number) => void;
}) {
  const [subTab, setSubTab] = useState<'all' | 'social' | 'high_intent' | 'services' | 'geography' | 'crm' | 'details'>(
    initialTab || 'all'
  );

  useEffect(() => {
    if (initialTab) setSubTab(initialTab);
  }, [initialTab]);

  function openLead(id: number) {
    onSelectLead(id);
    setSubTab('details');
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
          {(
            [
              ['all', `All Leads (${leads.length})`],
              ['social', 'Social Media Opportunities'],
              ['high_intent', 'High-Intent Buyers (60+)'],
              ['services', `Service Categories (${services.length})`],
              ['geography', 'Geographic Research'],
              ['crm', 'CRM & Deal Pipeline'],
              ['details', 'Lead Details'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
                subTab === id
                  ? 'bg-white dark:bg-slate-900 font-semibold text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {subTab === 'all' && (
        <LeadsListPage
          mode="all"
          leads={leads}
          onSelectLead={openLead}
          onNavigateDiscovery={onNavigateDiscovery}
        />
      )}
      {subTab === 'social' && (
        <LeadsListPage
          mode="social"
          leads={leads}
          onSelectLead={openLead}
          onNavigateDiscovery={onNavigateDiscovery}
        />
      )}
      {subTab === 'high_intent' && (
        <LeadsListPage
          mode="high_intent"
          leads={leads}
          onSelectLead={openLead}
          onNavigateDiscovery={onNavigateDiscovery}
        />
      )}
      {subTab === 'services' && (
        <ServiceCategoriesPage services={services} user={user} onUpdate={onUpdateServices} />
      )}
      {subTab === 'geography' && (
        <GeographicResearchPage leads={leads} onSelectLead={openLead} />
      )}
      {subTab === 'crm' && (
        <CrmPipelinePage
          leads={leads}
          user={user}
          onSelectLead={openLead}
          onRefresh={onRefresh}
        />
      )}
      {subTab === 'details' && (
        <LeadDetailsPage
          leadId={selectedLeadId || leads[0]?.id || null}
          user={user}
          usersList={usersList}
          onBack={() => setSubTab('all')}
          onRefresh={onRefresh}
          onOpenOutreach={onOpenOutreach}
          onOpenAiEmailWriter={onOpenAiEmailWriter}
        />
      )}
    </div>
  );
}
