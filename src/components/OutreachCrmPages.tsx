import React, { useEffect, useState } from 'react';
import { Check, Copy, Send, XCircle, Ban, Sparkles, DollarSign, Mail } from 'lucide-react';
import { api, canOperate, hasPermission } from '../lib/api';
import type { AppSettings, DashboardMetrics, LeadRecord, UserAccount } from '../../shared/types';

export function OutreachGeneratorPage({
  leads,
  selectedLeadId,
  user,
  onRefresh,
}: {
  leads: LeadRecord[];
  selectedLeadId: number | null;
  user: UserAccount;
  onRefresh: () => void;
}) {
  const [activeId, setActiveId] = useState<number | null>(selectedLeadId || leads[0]?.id || null);
  const lead = leads.find((l) => l.id === activeId) || leads[0] || null;

  const [channel, setChannel] = useState<'social_reply' | 'linkedin_message' | 'email' | 'contact_form' | 'marketplace_proposal'>('social_reply');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    if (selectedLeadId) setActiveId(selectedLeadId);
  }, [selectedLeadId]);

  useEffect(() => {
    if (!lead) return;
    const v = lead.outreach_variants || ({} as any);
    setSubject(v.email_subject || lead.outreach_subject || '');
    if (channel === 'social_reply') setBody(v.social_reply || lead.outreach_message || '');
    else if (channel === 'linkedin_message') setBody(v.linkedin_message || '');
    else if (channel === 'email') setBody(v.email_body || '');
    else if (channel === 'contact_form') setBody(v.contact_form || '');
    else setBody(v.marketplace_proposal || '');
  }, [lead?.id, channel]);

  const canEdit = canOperate(user);

  async function handleSaveDraft() {
    if (!lead || !canEdit) return;
    const variants = { ...(lead.outreach_variants || {}) } as any;
    if (channel === 'email') {
      variants.email_subject = subject;
      variants.email_body = body;
    } else {
      variants[channel] = body;
    }
    await api.updateLead(lead.id, {
      outreach_subject: subject,
      outreach_message: body,
      outreach_variants: variants,
    });
    setStatusMsg('Saved customized outreach draft (awaiting human approval).');
    onRefresh();
  }

  function handleCopy() {
    navigator.clipboard.writeText(channel === 'email' ? `Subject: ${subject}\n\n${body}` : body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (leads.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-10 text-center text-xs text-slate-500">
        No leads available yet. Discover or intake a buyer prospect to generate 5-channel personalized outreach.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100">
          Select Prospect ({leads.length})
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
          {leads.map((l) => (
            <button
              key={l.id}
              onClick={() => setActiveId(l.id)}
              className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                lead?.id === l.id ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="font-medium text-slate-900 dark:text-slate-100">{l.prospect_name}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {l.service_requested} · Score {l.lead_score} · {l.outreach_approval_status}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        {lead && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  7-Step Personalized Outreach — {lead.prospect_name}
                </h2>
                <div className="text-xs text-slate-500 mt-0.5">
                  {lead.social_platform} · {lead.service_requested} · Approval: {lead.outreach_approval_status}
                </div>
              </div>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-md whitespace-nowrap shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? 'Copied' : 'Copy Draft'}</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
              {[
                ['social_reply', 'Social Reply'],
                ['linkedin_message', 'LinkedIn DM'],
                ['email', 'Email'],
                ['contact_form', 'Contact Form'],
                ['marketplace_proposal', 'Marketplace Proposal'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setChannel(key as any)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    channel === key
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {channel === 'email' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Email Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Message Body (Observation → Problem → Impact → Primary Service → Ownership → Deliverable → Low-Pressure Question)
              </label>
              <textarea
                rows={9}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full px-3 py-2 text-xs leading-relaxed bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-[11px] text-slate-500">
                Human approval required before outreach can be marked as sent.
              </div>
              {canEdit && (
                <button
                  onClick={handleSaveDraft}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
                >
                  Save Draft
                </button>
              )}
            </div>
            {statusMsg && <div className="text-xs text-emerald-700 dark:text-emerald-400">{statusMsg}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function MessageApprovalCenterPage({
  leads,
  user,
  onRefresh,
}: {
  leads: LeadRecord[];
  user: UserAccount;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<'PENDING_APPROVAL' | 'APPROVED' | 'SENT' | 'REJECTED'>('PENDING_APPROVAL');
  const [error, setError] = useState('');
  const canEdit = canOperate(user);
  const filtered = leads.filter((l) => l.outreach_approval_status === filter);

  async function approve(id: number) {
    setError('');
    try {
      await api.approveOutreach(id);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Approval failed');
    }
  }

  async function reject(id: number) {
    await api.rejectOutreach(id);
    onRefresh();
  }

  async function markSent(l: LeadRecord) {
    setError('');
    try {
      await api.markOutreachSent(l.id, {
        channel: l.preferred_contact_method || l.social_platform,
        subject: l.outreach_subject,
        message: l.outreach_message,
      });
      onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to mark sent');
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Human-in-the-Loop Message Approval Center
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Unsolicited bulk sending is disabled. Every message requires explicit operator approval and suppression-list verification.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
          {(
            [
              ['PENDING_APPROVAL', 'Pending'],
              ['APPROVED', 'Approved'],
              ['SENT', 'Sent'],
              ['REJECTED', 'Rejected'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
                filter === k
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {label} ({leads.filter((l) => l.outreach_approval_status === k).length})
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">{error}</div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-10 text-center text-xs text-slate-500">
          No outreach drafts in &ldquo;{filter.replace(/_/g, ' ')}&rdquo; queue.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((l) => (
            <div key={l.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {l.prospect_name} · {l.service_requested}
                  </div>
                  <div className="text-xs text-slate-500">
                    {l.social_platform} · Score {l.lead_score}/100 · Target: {l.public_business_email || l.username || l.original_post_url}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2 shrink-0">
                    {filter === 'PENDING_APPROVAL' && (
                      <>
                        <button
                          onClick={() => approve(l.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          onClick={() => reject(l.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}
                    {filter === 'APPROVED' && (
                      <button
                        onClick={() => markSent(l)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Record as Sent</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                {l.outreach_message}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FollowUpManagerPage({
  leads,
  user,
  onRefresh,
  onNavigateApproval,
}: {
  leads: LeadRecord[];
  user: UserAccount;
  onRefresh: () => void;
  onNavigateApproval?: () => void;
}) {
  const [suppression, setSuppression] = useState<Array<{ id: number; identifier: string; reason: string; created_at: string }>>([]);
  const [newSuppressId, setNewSuppressId] = useState('');
  const [newSuppressReason, setNewSuppressReason] = useState('Opt-out requested');
  const [aiRec, setAiRec] = useState<Record<number, { recommended_action: string; suggested_message: string; suggested_follow_up_date: string }>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [draftingId, setDraftingId] = useState<number | null>(null);
  const [followUpBanner, setFollowUpBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const canEdit = canOperate(user);
  const canDraftEmail = hasPermission(user, 'can_generate_emails');

  useEffect(() => {
    api.getSuppression().then((r) => setSuppression(r.suppression));
  }, []);

  const stoppedStatuses = [
    'Reply Received',
    'Interested Prospect',
    'Call Requested',
    'Meeting Booked',
    'Proposal Submitted',
    'Negotiation',
    'Won',
    'Lost',
  ];

  const suppressedSet = new Set(suppression.map((s) => s.identifier.toLowerCase()));
  const followUpLeads = leads.filter(
    (l) =>
      !stoppedStatuses.includes(l.deal_status) &&
      (l.follow_up_date || l.outreach_approval_status === 'SENT' || l.deal_status === 'Message Sent')
  );

  async function askAgent8(id: number) {
    setLoadingId(id);
    try {
      const rec = await api.recommendFollowUp(id);
      setAiRec((prev) => ({ ...prev, [id]: rec }));
    } finally {
      setLoadingId(null);
    }
  }

  async function draftApprovalGatedFollowUp(l: LeadRecord) {
    setDraftingId(l.id);
    setFollowUpBanner(null);
    try {
      const res = await api.generateFollowUpEmail({ lead_id: l.id });
      setFollowUpBanner({
        ok: true,
        text: `Follow-up email #${res.email_message.id} drafted for ${l.prospect_name} (AWAITING APPROVAL — never auto-sent).`,
      });
    } catch (err: any) {
      setFollowUpBanner({ ok: false, text: err?.message || 'Unable to generate follow-up email' });
    } finally {
      setDraftingId(null);
    }
  }

  async function handleAddSuppression(e: React.FormEvent) {
    e.preventDefault();
    if (!newSuppressId.trim() || !canEdit) return;
    const res = await api.addSuppression(newSuppressId.trim(), newSuppressReason);
    setSuppression(res.suppression);
    setNewSuppressId('');
    onRefresh();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              AI Follow-Up Manager &amp; Opt-Out Safeguards ({followUpLeads.length} Eligible)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Sequences automatically stop when a prospect replies, converts, closes, bounces, or opts out. Every follow-up draft enters the Email Approval Center first.
            </p>
          </div>
          {onNavigateApproval && (
            <button
              type="button"
              onClick={onNavigateApproval}
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Open Approval Center →
            </button>
          )}
        </div>

        {followUpBanner && (
          <div
            className={`p-3 border rounded-md text-xs ${
              followUpBanner.ok
                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
            }`}
          >
            {followUpBanner.text}
          </div>
        )}

        {followUpLeads.length === 0 ? (
          <p className="text-xs text-slate-500 py-6">
            No pending follow-ups. Leads with replies, won/lost outcomes, or suppression entries are automatically excluded.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {followUpLeads.map((l) => {
              const rec = aiRec[l.id];
              const isSuppressed =
                (l.public_business_email && suppressedSet.has(l.public_business_email.toLowerCase())) ||
                suppressedSet.has(l.original_post_url.toLowerCase());
              return (
                <div key={l.id} className="py-4 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{l.prospect_name}</span>
                      <span className="text-slate-500">
                        {' '}
                        · {l.service_requested} · {l.country || 'Unverified'} · Stage: {l.deal_status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        Due: {l.follow_up_date || 'Ready'}
                      </span>
                      {canDraftEmail && !isSuppressed && (
                        <button
                          type="button"
                          onClick={() => draftApprovalGatedFollowUp(l)}
                          disabled={draftingId === l.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-blue-700 hover:bg-blue-800 rounded whitespace-nowrap"
                        >
                          <Mail className="w-3 h-3" />
                          <span>{draftingId === l.id ? 'Drafting...' : 'Draft Follow-Up Email'}</span>
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => askAgent8(l.id)}
                          disabled={loadingId === l.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30 whitespace-nowrap"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>{loadingId === l.id ? 'Analyzing...' : 'Agent 8 Advice'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {isSuppressed && (
                    <div className="text-[11px] text-red-600 dark:text-red-400">
                      Blocked: Prospect is on the opt-out/bounce suppression list.
                    </div>
                  )}

                  {rec && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded space-y-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Recommended Action ({rec.suggested_follow_up_date}): {rec.recommended_action}
                      </div>
                      <div className="text-slate-600 dark:text-slate-300">{rec.suggested_message}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Ban className="w-4 h-4 text-red-600" />
          <span>Opt-Out Suppression List ({suppression.length})</span>
        </div>
        <p className="text-xs text-slate-500">
          Any email, handle, or URL added here is immediately blocked from discovery and outreach approval.
        </p>

        {canEdit && (
          <form onSubmit={handleAddSuppression} className="space-y-2">
            <input
              type="text"
              placeholder="Email, @handle, or post URL"
              value={newSuppressId}
              onChange={(e) => setNewSuppressId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <input
              type="text"
              placeholder="Reason"
              value={newSuppressReason}
              onChange={(e) => setNewSuppressReason(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <button
              type="submit"
              className="w-full px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-700 rounded-md"
            >
              Add to Suppression List
            </button>
          </form>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {suppression.map((s) => (
            <div key={s.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono truncate text-slate-900 dark:text-slate-100">{s.identifier}</div>
                <div className="text-[11px] text-slate-500">{s.reason}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const DEAL_STAGES = [
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
];

export function CrmPipelinePage({
  leads,
  user,
  onSelectLead,
  onRefresh,
}: {
  leads: LeadRecord[];
  user: UserAccount;
  onSelectLead: (id: number) => void;
  onRefresh: () => void;
}) {
  const canEdit = canOperate(user);

  async function updateStage(id: number, deal_status: string) {
    if (!canEdit) return;
    await api.updateLead(id, { deal_status });
    onRefresh();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">CRM &amp; Deal Conversion Pipeline</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Track every qualified buyer from initial prepared outreach through proposal, negotiation, and collected revenue.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {leads.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">No leads in pipeline yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-medium">
                  <th className="py-2.5 px-4">Prospect / Company</th>
                  <th className="py-2.5 px-4">Service</th>
                  <th className="py-2.5 px-4">Stage</th>
                  <th className="py-2.5 px-4 text-right">Pipeline Value</th>
                  <th className="py-2.5 px-4 text-right">Collected Revenue</th>
                  <th className="py-2.5 px-4 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td
                      onClick={() => onSelectLead(l.id)}
                      className="py-3 px-4 font-medium text-blue-700 dark:text-blue-400 cursor-pointer hover:underline"
                    >
                      {l.prospect_name} {l.company_name ? `(${l.company_name})` : ''}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{l.service_requested}</td>
                    <td className="py-3 px-4">
                      <select
                        value={l.deal_status}
                        disabled={!canEdit}
                        onChange={(e) => updateStage(l.id, e.target.value)}
                        className="px-2 py-1 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                      >
                        {DEAL_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">${(l.deal_value || 0).toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      ${(l.revenue_received || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{l.lead_score}</td>
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

export function RevenueAnalyticsPage({
  metrics,
  settings,
}: {
  metrics: DashboardMetrics | null;
  settings: AppSettings | null;
}) {
  // Interactive Unit-Economics Revenue Calculator (Part 9)
  const [avgPrice, setAvgPrice] = useState(500);
  const [convRate, setConvRate] = useState(12);
  const [targetCustomers, setTargetCustomers] = useState(10);
  const [deliveryCostPct, setDeliveryCostPct] = useState(25);

  const grossRevenue = avgPrice * targetCustomers;
  const deliveryCost = Math.round((grossRevenue * deliveryCostPct) / 100);
  const netProfit = grossRevenue - deliveryCost;
  const requiredQualifiedConversations = convRate > 0 ? Math.ceil(targetCustomers / (convRate / 100)) : 0;

  const collected = metrics?.actual_revenue_received || 0;
  const pipeline = metrics?.total_pipeline_value || 0;
  const target30 = settings?.thirty_day_revenue_target || 5000;
  const stretch = settings?.stretch_revenue_target || 25000;

  return (
    <div className="space-y-6">
      {/* Real Financial Ledger Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="text-xs text-slate-500">Collected Cash Revenue</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
            ${collected.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Actual payments received</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="text-xs text-slate-500">Open Pipeline Value</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            ${pipeline.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Active proposals &amp; negotiations</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="text-xs text-slate-500">30-Day Target</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            ${target30.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Remaining: ${Math.max(0, target30 - collected).toLocaleString()}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="text-xs text-slate-500">Stretch Target ({settings?.stretch_target_deadline})</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            ${stretch.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Remaining: ${Math.max(0, stretch - collected).toLocaleString()}</div>
        </div>
      </div>

      {/* Interactive Revenue & Conversion Calculator */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-1">
          <DollarSign className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Client Acquisition Revenue Calculator
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          Model project pricing, expected close rate, delivery costs, and required qualified buyer volume to hit commercial goals.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Average Project Price ($)
            </label>
            <input
              type="number"
              min={50}
              value={avgPrice}
              onChange={(e) => setAvgPrice(Math.max(0, Number(e.target.value)))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Expected Conversion Rate (%)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={convRate}
              onChange={(e) => setConvRate(Math.min(100, Math.max(1, Number(e.target.value))))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Target Paying Customers
            </label>
            <input
              type="number"
              min={1}
              value={targetCustomers}
              onChange={(e) => setTargetCustomers(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Expected Delivery Cost (%)
            </label>
            <input
              type="number"
              min={0}
              max={95}
              value={deliveryCostPct}
              onChange={(e) => setDeliveryCostPct(Math.min(95, Math.max(0, Number(e.target.value))))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
          <div>
            <div className="text-[11px] text-slate-500">Projected Gross Revenue</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              ${grossRevenue.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Estimated Delivery Costs</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-300 mt-0.5">
              ${deliveryCost.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Estimated Net Profit</div>
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
              ${netProfit.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Qualified Buyers Needed</div>
            <div className="text-xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400 mt-0.5">
              {requiredQualifiedConversations} leads
            </div>
          </div>
        </div>
      </div>

      {/* Stage Breakdown from Real DB */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          Pipeline Breakdown by Deal Stage (Live Database)
        </h3>
        {!metrics?.by_deal_status?.length ? (
          <p className="text-xs text-slate-500">No active deals recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {metrics.by_deal_status.map((st) => (
              <div key={st.name} className="py-2.5 flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-200">{st.name}</span>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {st.count} deals · ${Number(st.value || 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
