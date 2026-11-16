import { Type } from '@google/genai';
import { db, logSystemEvent } from './db.js';
import { findCountryInfo } from '../shared/countries.js';
import { getOptionalGeminiClient, isGeminiToolEnabled, logGeminiUsage } from './geminiClient.js';
import type { EmailMessageApprovalStatus, EmailMessageRecord } from '../shared/types.js';

export function mapEmailMessageRow(row: any): EmailMessageRecord {
  return {
    id: row.id,
    campaign_id: row.campaign_id ?? null,
    campaign_name: row.campaign_name || null,
    lead_id: row.lead_id,
    lead_code: row.lead_code || undefined,
    owner_user_id: row.owner_user_id,
    owner_email: row.owner_email || undefined,
    email_account_id: row.email_account_id ?? null,
    sending_email_address: row.sending_email_address || null,
    sending_provider: row.sending_provider || null,
    recipient_email: row.recipient_email || '',
    prospect_name: row.prospect_name,
    company_name: row.company_name || null,
    country: row.country || null,
    service_requested: row.service_requested,
    original_buyer_request: row.original_buyer_request,
    source_url: row.source_url,
    lead_score: Number(row.lead_score || 0),
    detected_language: row.detected_language || 'English',
    subject_local: row.subject_local || '',
    body_local: row.body_local || '',
    subject_english: row.subject_english || '',
    body_english: row.body_english || '',
    call_to_action: row.call_to_action || '',
    approval_status: row.approval_status,
    approved_by_user_id: row.approved_by_user_id ?? null,
    approved_by_email: row.approved_by_email || null,
    approved_at: row.approved_at || null,
    rejected_by_email: row.rejected_by_email || null,
    rejected_at: row.rejected_at || null,
    is_follow_up: Boolean(row.is_follow_up),
    follow_up_step: Number(row.follow_up_step || 0),
    compliance_notes: row.compliance_notes || '',
    provider_message_id: row.provider_message_id || null,
    error_message: row.error_message || null,
    sent_at: row.sent_at || null,
    delivered_at: row.delivered_at || null,
    replied_at: row.replied_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    contact_email_status: row.contact_email_status || (row.recipient_email ? 'UNVERIFIED_EMAIL' : 'EMAIL_UNAVAILABLE'),
    contact_verification_source: row.contact_verification_source || null,
    company_research_summary: row.company_research_summary || null,
    decision_maker_role: row.decision_maker_role || null,
  };
}

export function getEmailMessages(filters: {
  viewerScopeUserId?: number;
  status?: string;
  campaignId?: number;
  leadId?: number;
}): EmailMessageRecord[] {
  const clauses = ['1=1'];
  const params: any[] = [];
  if (filters.viewerScopeUserId) {
    clauses.push('em.owner_user_id = ?');
    params.push(filters.viewerScopeUserId);
  }
  if (filters.status && filters.status !== 'ALL') {
    clauses.push('em.approval_status = ?');
    params.push(filters.status);
  }
  if (filters.campaignId) {
    clauses.push('em.campaign_id = ?');
    params.push(filters.campaignId);
  }
  if (filters.leadId) {
    clauses.push('em.lead_id = ?');
    params.push(filters.leadId);
  }

  const rows = db
    .prepare(
      `SELECT em.*,
              l.lead_code,
              l.contact_email_status,
              l.contact_verification_source,
              l.company_research_summary,
              l.decision_maker_role,
              u.email as owner_email,
              c.name as campaign_name,
              ea.email_address as sending_email_address,
              ea.provider as sending_provider
       FROM email_messages em
       LEFT JOIN leads l ON l.id = em.lead_id
       LEFT JOIN users u ON u.id = em.owner_user_id
       LEFT JOIN campaigns c ON c.id = em.campaign_id
       LEFT JOIN email_accounts ea ON ea.id = em.email_account_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY em.id DESC
       LIMIT 300`
    )
    .all(...params) as any[];

  return rows.map(mapEmailMessageRow);
}

export async function generatePersonalizedEmailForLead(params: {
  leadId: number;
  ownerUserId: number;
  ownerEmail: string;
  campaignId?: number | null;
  emailAccountId?: number | null;
  targetLanguageOverride?: string;
  saveStatus?: Extract<EmailMessageApprovalStatus, 'DRAFT' | 'AWAITING_APPROVAL'>;
  isFollowUp?: boolean;
  followUpStep?: number;
  previousContext?: string;
}): Promise<EmailMessageRecord> {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(params.leadId) as any;
  if (!lead) throw new Error('Lead not found');

  const countryInfo = findCountryInfo(lead.country);
  const complianceRegime = countryInfo
    ? `${countryInfo.complianceRegime}: ${countryInfo.complianceNote}`
    : 'Global B2B Cold Email Compliance: Identify sender accurately, reference public business request, include clear opt-out line.';

  let detectedLanguage = params.targetLanguageOverride?.trim() || lead.detected_language || '';
  let subjectLocal = '';
  let bodyLocal = '';
  let subjectEnglish = '';
  let bodyEnglish = '';
  let callToAction = 'Open to a brief 10-minute chat this week to share an outline?';

  const gemini = getOptionalGeminiClient('email_personalization');
  const translationEnabled = isGeminiToolEnabled('translation');
  if (gemini) {
    const start = Date.now();
    try {
      const response = await gemini.ai.models.generateContent({
        model: gemini.model,
        contents: `Generate a genuinely personalized, concise B2B cold ${params.isFollowUp ? 'follow-up ' : ''}email for this verified buyer lead.

PROSPECT DETAILS:
- Prospect Name: ${lead.prospect_name || 'Unverified'}
- Decision Maker Role: ${lead.decision_maker_role || lead.decision_maker_status || 'Unverified'}
- Company Name: ${lead.company_name || 'Unverified'}
- Company Website: ${lead.company_website || 'Unverified'}
- Industry: ${lead.company_industry || 'Unverified'}
- Verified Country: ${lead.country || 'Unverified'}
- Service Required: ${lead.service_requested}
- Original Buyer Post / Statement: "${lead.original_buyer_statement}"
- Project Description: "${lead.project_description}"
- Verified Company Research Summary: "${lead.company_research_summary || 'Use only direct post details; do not invent extra company audits.'}"
- Source URL: ${lead.original_post_url}
${params.targetLanguageOverride ? `- Target Language Requested: ${params.targetLanguageOverride}` : ''}
${params.previousContext ? `- Previous Outreach Context: ${params.previousContext}` : ''}

STRICT COPYWRITING & TRUTHFULNESS RULES:
1. ${translationEnabled ? `Detect the prospect's likely preferred business language using reliable evidence from their post text and verified country (${countryInfo?.primaryLanguage || 'infer from post text'}). If Target Language Requested is set, write in that language.` : 'Write directly in English (translation capability is currently toggled off).'}
2. Write subject_local and body_local in the selected language.
3. Provide accurate subject_english and body_english translations (if the email is already in English, set subject_english = subject_local and body_english = body_local).
4. Reference the prospect's ACTUAL buyer request, company context, and role naturally.
5. Explain clearly how "${lead.service_requested}" helps solve their stated goal.
6. NEVER pretend to know the person or company personally, NEVER invent previous conversations, fake client case studies, testimonials, or unverified audit findings.
7. Never use misleading subject lines ("Re:", "Quick question about your account", etc.) or robotic templates.
8. Include a clear, low-pressure call to action and a respectful one-line opt-out sentence at the bottom (${countryInfo?.complianceRegime || 'standard B2B opt-out'}).`,
        config: {
          ...(gemini.model.startsWith('gemini-4') ? { thinkingConfig: { thinkingLevel: gemini.thinkingLevel } } : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detected_language: { type: Type.STRING },
              subject_local: { type: Type.STRING },
              body_local: { type: Type.STRING },
              subject_english: { type: Type.STRING },
              body_english: { type: Type.STRING },
              call_to_action: { type: Type.STRING },
            },
            required: [
              'detected_language',
              'subject_local',
              'body_local',
              'subject_english',
              'body_english',
              'call_to_action',
            ],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}') as any;
      detectedLanguage = parsed.detected_language || detectedLanguage || 'English';
      subjectLocal = parsed.subject_local || '';
      bodyLocal = parsed.body_local || '';
      subjectEnglish = parsed.subject_english || subjectLocal;
      bodyEnglish = parsed.body_english || bodyLocal;
      callToAction = parsed.call_to_action || callToAction;
      db.prepare("UPDATE ai_agents SET runs_count = runs_count + 1, last_run_at = datetime('now'), last_status = 'OK' WHERE id = 'agent_outreach'").run();
      logGeminiUsage({
        action: params.isFollowUp ? 'GENERATE_FOLLOWUP_EMAIL' : 'GENERATE_PERSONALIZED_EMAIL',
        toolName: 'email_personalization',
        status: 'SUCCESS',
        tokensUsed: (response as any)?.usageMetadata?.totalTokenCount || 0,
        latencyMs: Date.now() - start,
        details: `Generated ${detectedLanguage} draft for lead #${lead.id} (${lead.lead_code}) using ${gemini.model}`,
      });
    } catch (err: any) {
      logGeminiUsage({
        action: params.isFollowUp ? 'GENERATE_FOLLOWUP_EMAIL' : 'GENERATE_PERSONALIZED_EMAIL',
        toolName: 'email_personalization',
        status: 'ERROR',
        latencyMs: Date.now() - start,
        details: `Failed email generation for lead #${lead.id}`,
        errorMessage: err?.message || 'Gemini email generation failed',
      });
      // Fall back safely below if AI rate-limited or unavailable
    }
  }

  if (!subjectLocal || !bodyLocal) {
    detectedLanguage = detectedLanguage || (countryInfo?.primaryLanguage.split('/')[0].trim() || 'English');
    const greeting =
      lead.prospect_name && !/unknown|anonymous/i.test(lead.prospect_name)
        ? `Hi ${lead.prospect_name},`
        : 'Hello,';
    const companyRef = lead.company_name ? ` at ${lead.company_name}` : '';
    const snippet = String(lead.original_buyer_statement || lead.project_description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);

    subjectEnglish = params.isFollowUp
      ? `Following up on your ${lead.service_requested} scope${companyRef}`
      : `${lead.service_requested} support for your ${lead.company_name || 'upcoming project'}`;
    bodyEnglish = [
      greeting,
      '',
      `I saw your public post (${lead.social_platform}) mentioning: "${snippet}${snippet.length >= 140 ? '...' : ''}".`,
      '',
      `Because you're looking for ${lead.service_requested}, I can help scope the technical architecture, timeline, and delivery milestones around your exact requirements—without unnecessary overhead.`,
      '',
      callToAction,
      '',
      'Best regards,',
      params.ownerEmail,
      '',
      '---',
      'If this is no longer relevant, simply reply "opt out" and we will not follow up again.',
    ].join('\n');

    subjectLocal = subjectEnglish;
    bodyLocal = bodyEnglish;
  }

  // Never auto-send: default status is AWAITING_APPROVAL (or DRAFT)
  const initialStatus = params.saveStatus === 'DRAFT' ? 'DRAFT' : 'AWAITING_APPROVAL';

  db.prepare('UPDATE leads SET detected_language = COALESCE(detected_language, ?) WHERE id = ?').run(
    detectedLanguage,
    lead.id
  );

  const info = db
    .prepare(
      `INSERT INTO email_messages (
        campaign_id, lead_id, owner_user_id, email_account_id,
        recipient_email, prospect_name, company_name, country,
        service_requested, original_buyer_request, source_url, lead_score,
        detected_language, subject_local, body_local, subject_english, body_english,
        call_to_action, approval_status, is_follow_up, follow_up_step, compliance_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.campaignId ?? lead.campaign_id ?? null,
      lead.id,
      params.ownerUserId,
      params.emailAccountId ?? null,
      lead.public_business_email || '',
      lead.prospect_name,
      lead.company_name || null,
      lead.country || null,
      lead.service_requested,
      lead.original_buyer_statement || lead.project_description,
      lead.original_post_url,
      lead.lead_score,
      detectedLanguage,
      subjectLocal,
      bodyLocal,
      subjectEnglish,
      bodyEnglish,
      callToAction,
      initialStatus,
      params.isFollowUp ? 1 : 0,
      params.followUpStep || 0,
      complianceRegime
    );

  logSystemEvent(
    'INFO',
    params.ownerEmail,
    params.isFollowUp ? 'FOLLOWUP_EMAIL_DRAFTED' : 'AI_EMAIL_GENERATED',
    `Generated ${detectedLanguage} ${initialStatus} draft #${info.lastInsertRowid} for lead ${lead.lead_code}`
  );

  const created = db
    .prepare(
      `SELECT em.*, l.lead_code, l.contact_email_status, l.contact_verification_source,
              l.company_research_summary, l.decision_maker_role,
              u.email as owner_email, c.name as campaign_name,
              ea.email_address as sending_email_address, ea.provider as sending_provider
       FROM email_messages em
       LEFT JOIN leads l ON l.id = em.lead_id
       LEFT JOIN users u ON u.id = em.owner_user_id
       LEFT JOIN campaigns c ON c.id = em.campaign_id
       LEFT JOIN email_accounts ea ON ea.id = em.email_account_id
       WHERE em.id = ?`
    )
    .get(Number(info.lastInsertRowid));

  return mapEmailMessageRow(created);
}
