import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Languages,
  Loader2,
  Mail,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api, hasPermission } from '../lib/api';
import type {
  EmailAccount,
  EmailCampaign,
  EmailMessageRecord,
  LeadRecord,
  UserAccount,
} from '../../shared/types';

const TARGET_LANGUAGES = [
  { value: '', label: 'Auto-Detect (Match Prospect Post Language)' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Dutch', label: 'Dutch' },
  { value: 'Italian', label: 'Italian' },
  { value: 'Hindi', label: 'Hindi' },
  { value: 'Japanese', label: 'Japanese' },
];

export function AiEmailWriterPage({
  leads,
  selectedLeadId,
  user,
  onNavigateApproval,
}: {
  leads: LeadRecord[];
  selectedLeadId: number | null;
  user: UserAccount;
  onNavigateApproval: () => void;
}) {
  const [activeLeadId, setActiveLeadId] = useState<number | null>(selectedLeadId || leads[0]?.id || null);
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [campaignId, setCampaignId] = useState<string>('');
  const [emailAccountId, setEmailAccountId] = useState<string>('');

  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [currentDraft, setCurrentDraft] = useState<EmailMessageRecord | null>(null);
  const [leadDrafts, setLeadDrafts] = useState<EmailMessageRecord[]>([]);

  const [viewLang, setViewLang] = useState<'local' | 'english'>('local');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subjectLocal, setSubjectLocal] = useState('');
  const [bodyLocal, setBodyLocal] = useState('');
  const [subjectEnglish, setSubjectEnglish] = useState('');
  const [bodyEnglish, setBodyEnglish] = useState('');
  const [cta, setCta] = useState('');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const canGenerate = hasPermission(user, 'can_generate_emails');
  const lead = leads.find((l) => l.id === activeLeadId) || leads[0] || null;

  useEffect(() => {
    if (selectedLeadId) setActiveLeadId(selectedLeadId);
  }, [selectedLeadId]);

  useEffect(() => {
    Promise.all([api.getCampaigns(), api.getEmailAccounts()])
      .then(([cRes, aRes]) => {
        setCampaigns(cRes.campaigns);
        const connected = aRes.accounts.filter((a) => a.status === 'CONNECTED' && a.is_active);
        setAccounts(aRes.accounts);
        if (connected.length > 0 && !emailAccountId) {
          setEmailAccountId(String(connected[0].id));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!lead) return;
    api
      .getEmailMessages({ leadId: lead.id })
      .then((res) => {
        setLeadDrafts(res.messages);
        const latest =
          res.messages.find((m) => ['AWAITING_APPROVAL', 'DRAFT'].includes(m.approval_status)) ||
          res.messages[0] ||
          null;
        if (latest) {
          loadDraftIntoEditor(latest);
        } else {
          setCurrentDraft(null);
          setRecipientEmail(lead.public_business_email || '');
          setSubjectLocal('');
          setBodyLocal('');
          setSubjectEnglish('');
          setBodyEnglish('');
          setCta('');
        }
      })
      .catch(() => {});
  }, [lead?.id]);

  function loadDraftIntoEditor(msg: EmailMessageRecord) {
    setCurrentDraft(msg);
    setRecipientEmail(msg.recipient_email || '');
    setSubjectLocal(msg.subject_local || '');
    setBodyLocal(msg.body_local || '');
    setSubjectEnglish(msg.subject_english || '');
    setBodyEnglish(msg.body_english || '');
    setCta(msg.call_to_action || '');
    if (msg.email_account_id) setEmailAccountId(String(msg.email_account_id));
    if (msg.campaign_id) setCampaignId(String(msg.campaign_id));
    setViewLang('local');
  }

  async function handleGenerate(saveStatus: 'AWAITING_APPROVAL' | 'DRAFT' = 'AWAITING_APPROVAL') {
    if (!lead || !canGenerate) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await api.generatePersonalizedEmail({
        lead_id: lead.id,
        campaign_id: campaignId ? Number(campaignId) : null,
        email_account_id: emailAccountId ? Number(emailAccountId) : null,
        target_language: targetLanguage || undefined,
        save_status: saveStatus,
      });
      loadDraftIntoEditor(res.email_message);
      setLeadDrafts((prev) => [res.email_message, ...prev]);
      setFeedback({
        ok: true,
        text: `Generated individualized cold email in ${res.email_message.detected_language} (${res.email_message.approval_status.replace(/_/g, ' ')}). Ready for review — nothing was sent automatically.`,
      });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Failed to generate personalized email' });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveEdits(targetStatus: 'DRAFT' | 'AWAITING_APPROVAL') {
    if (!currentDraft) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await api.updateEmailMessage(currentDraft.id, {
        recipient_email: recipientEmail.trim(),
        email_account_id: emailAccountId ? Number(emailAccountId) : null,
        campaign_id: campaignId ? Number(campaignId) : null,
        subject_local: subjectLocal,
        body_local: bodyLocal,
        subject_english: subjectEnglish,
        body_english: bodyEnglish,
        call_to_action: cta,
        approval_status: targetStatus,
      });
      loadDraftIntoEditor(res.email_message);
      setLeadDrafts((prev) => prev.map((m) => (m.id === res.email_message.id ? res.email_message : m)));
      setFeedback({
        ok: true,
        text:
          targetStatus === 'AWAITING_APPROVAL'
            ? 'Email edits saved and queued in Individual Email Approval Center (never auto-sent).'
            : 'Saved as local Draft.',
      });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Failed to save email edits' });
    } finally {
      setSaving(false);
    }
  }

  if (leads.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-10 text-center text-xs text-slate-500">
        No buyer prospects in the database yet. Run Global Lead Discovery first to draft individualized cold emails.
      </div>
    );
  }

  const isSentOrLocked = currentDraft && ['SENT', 'DELIVERED', 'QUEUED', 'SENDING'].includes(currentDraft.approval_status);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Prospect Queue */}
      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Select Buyer Prospect ({leads.length})
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Each prospect receives a tailored, non-generic email referencing their verified request.
          </div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[680px] overflow-y-auto">
          {leads.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setActiveLeadId(l.id);
                setFeedback(null);
              }}
              className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                lead?.id === l.id ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{l.prospect_name}</span>
                <span className="font-mono text-[11px] text-blue-700 dark:text-blue-400 shrink-0">{l.lead_score}</span>
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate mt-0.5">{l.service_requested}</div>
              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                {l.country || 'Unverified country'} · {l.public_business_email || 'Email not verified yet'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right Column: AI Cold Email Composer & Bilingual Preview */}
      <div className="lg:col-span-8 space-y-5">
        {lead && (
          <>
            {/* Prospect Verification Dossier */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {lead.lead_code} · {lead.social_platform} · Score {lead.lead_score}/100 ({lead.lead_priority})
                  </div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {lead.prospect_name} {lead.company_name ? `— ${lead.company_name}` : ''}
                  </h2>
                </div>
                <a
                  href={lead.original_post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                >
                  <span>Original Public Post</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-slate-500">Verified Country:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-100">{lead.country || 'Unverified'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Service Needed:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-100">{lead.service_requested}</span>
                </div>
                <div>
                  <span className="text-slate-500">Detected Language:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {currentDraft?.detected_language || lead.detected_language || 'Auto-detect'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <span className="font-semibold text-slate-900 dark:text-slate-100">Original Buyer Request: </span>
                &ldquo;{lead.original_buyer_statement}&rdquo;
              </div>

              {/* Generation Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Email Language
                  </label>
                  <select
                    value={targetLanguage}
                    onChange={(e) => setTargetLanguage(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {TARGET_LANGUAGES.map((l) => (
                      <option key={l.value || 'auto'} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Campaign (Optional)
                  </label>
                  <select
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="">No Campaign Assigned</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Preferred Sending Account
                  </label>
                  <select
                    value={emailAccountId}
                    onChange={(e) => setEmailAccountId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="">Select in Approval Center</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.email_address} ({a.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>AI generation NEVER auto-sends. Every email enters manual approval first.</span>
                </div>
                <button
                  type="button"
                  disabled={generating || !canGenerate}
                  onClick={() => handleGenerate('AWAITING_APPROVAL')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md whitespace-nowrap shrink-0"
                >
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{generating ? 'Drafting Personalized Email...' : 'Generate Personalized Cold Email'}</span>
                </button>
              </div>
            </div>

            {feedback && (
              <div
                className={`p-3 border rounded-md text-xs flex items-center gap-2 ${
                  feedback.ok
                    ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
                    : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
                }`}
              >
                {feedback.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Editor Panel */}
            {currentDraft ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Draft #{currentDraft.id} · Status:{' '}
                        <span className="font-mono text-blue-700 dark:text-blue-400">
                          {currentDraft.approval_status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">{currentDraft.compliance_notes}</div>
                    </div>
                  </div>

                  {/* Language View Switch */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
                    <button
                      type="button"
                      onClick={() => setViewLang('local')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded whitespace-nowrap ${
                        viewLang === 'local'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Languages className="w-3.5 h-3.5" />
                      <span>Local ({currentDraft.detected_language})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewLang('english')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded whitespace-nowrap ${
                        viewLang === 'english'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>English Translation</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Verified / Target Recipient Email
                    </label>
                    <input
                      type="email"
                      disabled={Boolean(isSentOrLocked)}
                      placeholder="prospect@company.com"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Primary Call-to-Action
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(isSentOrLocked)}
                      value={cta}
                      onChange={(e) => setCta(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                </div>

                <div className="text-xs space-y-3">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {viewLang === 'local'
                        ? `Subject (${currentDraft.detected_language})`
                        : 'Subject (English Translation)'}
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(isSentOrLocked)}
                      value={viewLang === 'local' ? subjectLocal : subjectEnglish}
                      onChange={(e) =>
                        viewLang === 'local' ? setSubjectLocal(e.target.value) : setSubjectEnglish(e.target.value)
                      }
                      className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {viewLang === 'local'
                        ? `Personalized Cold Email Body (${currentDraft.detected_language})`
                        : 'Personalized Cold Email Body (English Translation)'}
                    </label>
                    <textarea
                      rows={10}
                      disabled={Boolean(isSentOrLocked)}
                      value={viewLang === 'local' ? bodyLocal : bodyEnglish}
                      onChange={(e) =>
                        viewLang === 'local' ? setBodyLocal(e.target.value) : setBodyEnglish(e.target.value)
                      }
                      className="w-full px-3 py-2 leading-relaxed bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                </div>

                {!isSentOrLocked && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={onNavigateApproval}
                      className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      Open in Email Approval Center →
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveEdits('DRAFT')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save as Draft</span>
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveEdits('AWAITING_APPROVAL')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit to Approval Center</span>
                      </button>
                    </div>
                  </div>
                )}

                {leadDrafts.length > 1 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[11px] font-medium text-slate-500 mb-1.5">
                      Draft History for {lead.prospect_name} ({leadDrafts.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {leadDrafts.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => loadDraftIntoEditor(d)}
                          className={`px-2.5 py-1 text-[11px] font-mono border rounded ${
                            currentDraft?.id === d.id
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          #{d.id} ({d.detected_language} · {d.approval_status})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center text-xs text-slate-500">
                No cold email drafted for {lead.prospect_name} yet. Click &ldquo;Generate Personalized Cold Email&rdquo; above to create an individualized bilingual draft.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
