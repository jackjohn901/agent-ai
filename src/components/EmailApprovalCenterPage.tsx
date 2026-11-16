import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Languages,
  Loader2,
  MessageSquare,
  Save,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { api, hasPermission } from '../lib/api';
import { authorizeGmailAccount, getCachedGmailToken } from '../lib/gmailOAuth';
import type { EmailAccount, EmailMessageRecord, UserAccount } from '../../shared/types';

type ApprovalTab =
  | 'AWAITING_APPROVAL'
  | 'DRAFT'
  | 'QUEUED_SENDING'
  | 'SENT_DELIVERED'
  | 'BOUNCED_FAILED'
  | 'REJECTED'
  | 'ALL';

export function EmailApprovalCenterPage({
  user,
  onRefreshWorkspace,
}: {
  user: UserAccount;
  onRefreshWorkspace: () => void;
}) {
  const [messages, setMessages] = useState<EmailMessageRecord[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [tab, setTab] = useState<ApprovalTab>('AWAITING_APPROVAL');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Per-card state
  const [selectedAccounts, setSelectedAccounts] = useState<Record<number, number>>({});
  const [langPreview, setLangPreview] = useState<Record<number, 'local' | 'english'>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRecipient, setEditRecipient] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  // Confirmation modal before dispatching a SINGLE individual email
  const [confirmMsg, setConfirmMsg] = useState<EmailMessageRecord | null>(null);

  // Convert-to-won modal state
  const [convertMsg, setConvertMsg] = useState<EmailMessageRecord | null>(null);
  const [convertRevenue, setConvertRevenue] = useState('1500');

  const canApprove = hasPermission(user, 'can_approve_emails');
  const canSend = hasPermission(user, 'can_send_emails');

  async function loadData() {
    setLoading(true);
    try {
      const [mRes, aRes] = await Promise.all([api.getEmailMessages(), api.getEmailAccounts()]);
      setMessages(mRes.messages);
      setAccounts(aRes.accounts);
      const firstConnected = aRes.accounts.find((a) => a.status === 'CONNECTED' && a.is_active);
      setSelectedAccounts((prev) => {
        const next = { ...prev };
        for (const m of mRes.messages) {
          if (!next[m.id]) {
            if (m.email_account_id) next[m.id] = m.email_account_id;
            else if (firstConnected) next[m.id] = firstConnected.id;
          }
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filtered = messages.filter((m) => {
    if (tab === 'AWAITING_APPROVAL') return m.approval_status === 'AWAITING_APPROVAL';
    if (tab === 'DRAFT') return m.approval_status === 'DRAFT';
    if (tab === 'QUEUED_SENDING') return ['APPROVED', 'QUEUED', 'SENDING'].includes(m.approval_status);
    if (tab === 'SENT_DELIVERED') return ['SENT', 'DELIVERED'].includes(m.approval_status);
    if (tab === 'BOUNCED_FAILED') return ['BOUNCED', 'FAILED'].includes(m.approval_status);
    if (tab === 'REJECTED') return m.approval_status === 'REJECTED';
    return true;
  });

  function beginEdit(m: EmailMessageRecord) {
    setEditingId(m.id);
    setEditRecipient(m.recipient_email || '');
    setEditSubject(m.subject_local || '');
    setEditBody(m.body_local || '');
  }

  async function saveEdit(m: EmailMessageRecord, nextStatus?: 'DRAFT' | 'AWAITING_APPROVAL') {
    setBusyId(m.id);
    setFeedback(null);
    try {
      await api.updateEmailMessage(m.id, {
        recipient_email: editingId === m.id ? editRecipient.trim() : m.recipient_email,
        subject_local: editingId === m.id ? editSubject : m.subject_local,
        body_local: editingId === m.id ? editBody : m.body_local,
        email_account_id: selectedAccounts[m.id] || m.email_account_id,
        approval_status: nextStatus,
      });
      setEditingId(null);
      setFeedback({
        ok: true,
        text:
          nextStatus === 'DRAFT'
            ? `Email #${m.id} saved as Draft.`
            : `Updated personalized email #${m.id} for ${m.prospect_name}.`,
      });
      await loadData();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Failed to update email draft' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(m: EmailMessageRecord) {
    setBusyId(m.id);
    setFeedback(null);
    try {
      await api.rejectEmailMessage(m.id);
      setFeedback({ ok: true, text: `Rejected email #${m.id} (${m.prospect_name}). Not sent.` });
      await loadData();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Reject failed' });
    } finally {
      setBusyId(null);
    }
  }

  async function executeSingleApproveAndSend() {
    if (!confirmMsg) return;
    const m = confirmMsg;
    const accountId = selectedAccounts[m.id] || m.email_account_id;
    if (!accountId) {
      setFeedback({ ok: false, text: 'Select a connected sending email account first.' });
      setConfirmMsg(null);
      return;
    }

    const account = accounts.find((a) => a.id === accountId);
    setBusyId(m.id);
    setFeedback(null);

    try {
      let gmailToken: string | undefined;
      if (account?.provider === 'gmail_oauth') {
        gmailToken = getCachedGmailToken(account.email_address);
        if (!gmailToken) {
          const auth = await authorizeGmailAccount();
          gmailToken = auth.accessToken;
        }
      }

      const recipient = editingId === m.id ? editRecipient.trim() : m.recipient_email;
      const subject = editingId === m.id ? editSubject : m.subject_local;
      const body = editingId === m.id ? editBody : m.body_local;

      const res = await api.approveAndSendEmail(
        m.id,
        {
          email_account_id: accountId,
          recipient_email: recipient,
          subject_local: subject,
          body_local: body,
        },
        gmailToken
      );

      setEditingId(null);
      setConfirmMsg(null);
      setFeedback({ ok: true, text: `Email #${m.id} approved individually: ${res.message}` });
      await loadData();
      onRefreshWorkspace();
    } catch (err: any) {
      setConfirmMsg(null);
      setFeedback({ ok: false, text: err?.message || 'Approval & send blocked' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRecordOutcome(
    m: EmailMessageRecord,
    outcome: 'REPLIED' | 'BOUNCED' | 'CONVERTED',
    rev?: number
  ) {
    setBusyId(m.id);
    setFeedback(null);
    try {
      await api.recordEmailOutcome(m.id, {
        outcome,
        revenue_received: rev,
      });
      setConvertMsg(null);
      setFeedback({
        ok: true,
        text:
          outcome === 'BOUNCED'
            ? `Marked #${m.id} BOUNCED and automatically suppressed ${m.recipient_email}.`
            : `Recorded outcome (${outcome}) for #${m.id}.`,
      });
      await loadData();
      onRefreshWorkspace();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Outcome update failed' });
    } finally {
      setBusyId(null);
    }
  }

  const connectedAccounts = accounts.filter((a) => a.status === 'CONNECTED' && a.is_active);

  return (
    <div className="space-y-5">
      {/* Header & Tabs */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Individual Email Approval Center (Human-in-the-Loop Gate)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Every cold email and follow-up requires individual review and explicit approval before sending. Approving one email never approves or sends any other email.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>{connectedAccounts.length} connected sender(s) available</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
          {(
            [
              ['AWAITING_APPROVAL', `Awaiting Approval (${messages.filter((m) => m.approval_status === 'AWAITING_APPROVAL').length})`],
              ['DRAFT', `Drafts (${messages.filter((m) => m.approval_status === 'DRAFT').length})`],
              ['QUEUED_SENDING', `Queued (${messages.filter((m) => ['APPROVED', 'QUEUED', 'SENDING'].includes(m.approval_status)).length})`],
              ['SENT_DELIVERED', `Sent & Delivered (${messages.filter((m) => ['SENT', 'DELIVERED'].includes(m.approval_status)).length})`],
              ['BOUNCED_FAILED', `Bounced / Failed (${messages.filter((m) => ['BOUNCED', 'FAILED'].includes(m.approval_status)).length})`],
              ['REJECTED', `Rejected (${messages.filter((m) => m.approval_status === 'REJECTED').length})`],
              ['ALL', `Audit Trail (${messages.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-xs rounded whitespace-nowrap shrink-0 ${
                tab === id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {feedback && (
          <div
            className={`p-3 border rounded-md text-xs flex items-center gap-2 ${
              feedback.ok
                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
            }`}
          >
            {feedback.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>

      {/* Individual Email Cards */}
      {loading ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-xs text-slate-500">
          Loading approval queue...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-10 text-center text-xs text-slate-500">
          No email records in &ldquo;{tab.replace(/_/g, ' ')}&rdquo;.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((m) => {
            const isEditing = editingId === m.id;
            const viewMode = langPreview[m.id] || 'local';
            const selectedAccountId = selectedAccounts[m.id] || m.email_account_id || 0;
            const canAct =
              ['DRAFT', 'AWAITING_APPROVAL', 'FAILED'].includes(m.approval_status) && (canApprove || canSend);
            const isSent = ['SENT', 'DELIVERED'].includes(m.approval_status);

            return (
              <div
                key={m.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
              >
                {/* Header Row */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-slate-500">#{m.id}</span>
                      <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {m.prospect_name} {m.company_name ? `— ${m.company_name}` : ''}
                      </span>
                      <span className="px-2 py-0.5 text-[11px] font-mono border border-slate-300 dark:border-slate-700 rounded">
                        {m.approval_status.replace(/_/g, ' ')}
                      </span>
                      {m.is_follow_up && (
                        <span className="px-2 py-0.5 text-[11px] font-mono border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400 rounded">
                          Follow-Up #{m.follow_up_step}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Country: <strong className="text-slate-700 dark:text-slate-300">{m.country || 'Unverified'}</strong> ·
                      Service: <strong className="text-slate-700 dark:text-slate-300">{m.service_requested}</strong> ·
                      Language: <strong className="text-slate-700 dark:text-slate-300">{m.detected_language}</strong> ·
                      Score: <strong className="font-mono">{m.lead_score}/100</strong>
                      {m.campaign_name ? ` · Campaign: ${m.campaign_name}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setLangPreview((prev) => ({ ...prev, [m.id]: viewMode === 'local' ? 'english' : 'local' }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Languages className="w-3 h-3" />
                      <span>{viewMode === 'local' ? 'View English' : `View ${m.detected_language}`}</span>
                    </button>
                    {m.source_url && (
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-900 rounded whitespace-nowrap"
                      >
                        <span>Source Post</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Original Buyer Request & Research Evidence */}
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Verified Buyer Request: </span>
                    &ldquo;{m.original_buyer_request}&rdquo;
                  </div>
                  {(m.company_research_summary || m.decision_maker_role || m.contact_verification_source) && (
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-800">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Research Evidence: </span>
                      {m.decision_maker_role ? `Role: ${m.decision_maker_role} · ` : ''}
                      {m.company_research_summary ? `${m.company_research_summary} ` : ''}
                      {m.contact_verification_source ? `(Contact source: ${m.contact_verification_source})` : ''}
                    </div>
                  )}
                </div>

                {/* Recipient & Sending Account Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        Recipient Email
                      </label>
                      <span
                        className={`text-[10px] font-mono font-semibold ${
                          m.contact_email_status === 'VERIFIED_EMAIL'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : m.contact_email_status === 'OPTED_OUT' || m.contact_email_status === 'INVALID_EMAIL'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {m.contact_email_status === 'EMAIL_UNAVAILABLE'
                          ? 'CONTACT NOT FOUND'
                          : (m.contact_email_status || 'UNVERIFIED_EMAIL').replace(/_/g, ' ')}
                      </span>
                    </div>
                    {isEditing ? (
                      <input
                        type="email"
                        value={editRecipient}
                        onChange={(e) => setEditRecipient(e.target.value)}
                        className="w-full px-3 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                      />
                    ) : (
                      <div className="px-3 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200">
                        {m.recipient_email || 'CONTACT NOT FOUND — click EDIT EMAIL to enter verified address'}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Sending Email Account
                    </label>
                    {canAct ? (
                      <select
                        value={selectedAccountId}
                        onChange={(e) =>
                          setSelectedAccounts((prev) => ({ ...prev, [m.id]: Number(e.target.value) }))
                        }
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                      >
                        <option value={0}>Select connected sending account...</option>
                        {connectedAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.email_address} ({a.provider.replace(/_/g, ' ')} · {a.sent_today}/{a.daily_limit} today)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="px-3 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded">
                        {m.sending_email_address || 'Not dispatched'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Email Content (Editable vs Preview) */}
                {isEditing ? (
                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Subject</label>
                      <input
                        type="text"
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Email Body</label>
                      <textarea
                        rows={8}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="w-full px-3 py-2 leading-relaxed bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded space-y-2 text-xs">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Subject: {viewMode === 'local' ? m.subject_local : m.subject_english}
                    </div>
                    <div className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {viewMode === 'local' ? m.body_local : m.body_english}
                    </div>
                  </div>
                )}

                {m.error_message && (
                  <div className="text-xs text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-3 py-2">
                    Delivery Notice: {m.error_message}
                  </div>
                )}

                {/* Audit Trail & Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[11px] font-mono text-slate-500">
                    {m.compliance_notes}
                    {m.approved_by_email && ` · Approved by ${m.approved_by_email} at ${m.approved_at}`}
                    {m.sent_at && ` · Sent ${m.sent_at}`}
                    {m.replied_at && ` · Reply received ${m.replied_at}`}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {canAct && (
                      <>
                        {isEditing ? (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => saveEdit(m)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md whitespace-nowrap"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>Save Edits</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => beginEdit(m)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>EDIT EMAIL</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={busyId === m.id}
                          onClick={() => saveEdit(m, 'DRAFT')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>SAVE AS DRAFT</span>
                        </button>

                        {canApprove && (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => handleReject(m)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 rounded-md whitespace-nowrap"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>REJECT EMAIL</span>
                          </button>
                        )}

                        {canApprove && canSend && (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => setConfirmMsg(m)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md whitespace-nowrap"
                          >
                            {busyId === m.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>APPROVE AND SEND</span>
                          </button>
                        )}
                      </>
                    )}

                    {isSent && (
                      <>
                        {!m.replied_at && (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => handleRecordOutcome(m, 'REPLIED')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400 rounded whitespace-nowrap"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Record Reply</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === m.id}
                          onClick={() => {
                            setConvertMsg(m);
                            setConvertRevenue('1500');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded whitespace-nowrap"
                        >
                          <Check className="w-3 h-3" />
                          <span>Mark Converted + Revenue</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === m.id}
                          onClick={() => handleRecordOutcome(m, 'BOUNCED')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 rounded whitespace-nowrap"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span>Mark Bounced</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Single-Email Approval & Send Confirmation Modal */}
      {confirmMsg && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Confirm Individual Approval &amp; Send (#{confirmMsg.id})</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Only this single email will be approved and dispatched. No other queued or draft emails will be affected.
            </p>
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded space-y-1.5 text-xs">
              <div>
                <span className="text-slate-500">From:</span>{' '}
                <span className="font-mono">
                  {accounts.find((a) => a.id === (selectedAccounts[confirmMsg.id] || confirmMsg.email_account_id))
                    ?.email_address || 'No account selected'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">To:</span>{' '}
                <span className="font-mono">
                  {editingId === confirmMsg.id ? editRecipient : confirmMsg.recipient_email || 'Missing recipient'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Subject:</span>{' '}
                <span className="font-medium">
                  {editingId === confirmMsg.id ? editSubject : confirmMsg.subject_local}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 whitespace-pre-wrap text-slate-700 dark:text-slate-300 max-h-44 overflow-y-auto">
                {editingId === confirmMsg.id ? editBody : confirmMsg.body_local}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmMsg(null)}
                className="px-3.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyId === confirmMsg.id}
                onClick={executeSingleApproveAndSend}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md whitespace-nowrap"
              >
                {busyId === confirmMsg.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Confirm &amp; Dispatch Single Email</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Conversion & Collected Revenue Modal */}
      {convertMsg && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Record Paying Customer Conversion — {convertMsg.prospect_name}
            </h3>
            <p className="text-slate-500">
              Only enter verified revenue collected from this client. Actual Revenue is tracked separately from Estimated Opportunity Value.
            </p>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Actual Revenue Collected ($)
              </label>
              <input
                type="number"
                min={0}
                value={convertRevenue}
                onChange={(e) => setConvertRevenue(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConvertMsg(null)}
                className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRecordOutcome(convertMsg, 'CONVERTED', Number(convertRevenue || 0))}
                className="px-4 py-1.5 font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
              >
                Record Actual Revenue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
