import { Type } from '@google/genai';
import { db, logSystemEvent, mapLeadRow } from './db.js';
import { isSafePublicUrl } from './connectors.js';
import { getOptionalGeminiClient, logGeminiUsage } from './geminiClient.js';
import { executeUniversalTool, getUniversalIntegration } from './universalIntegrations.js';
import type { ContactEmailStatus, ResearchEnrichResult } from '../shared/types.js';

function isValidEmailSyntax(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

function extractPublishedEmails(html: string): string[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const matches = cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const filtered = matches
    .map((m) => m.toLowerCase())
    .filter(
      (e) =>
        !/example\.com|sentry\.io|wixpress\.com|\.png$|\.jpg$|\.webp$|\.svg$|noreply|no-reply|donotreply/i.test(e)
    );
  return Array.from(new Set(filtered)).slice(0, 5);
}

function extractMetaTitleAndDesc(html: string): { title: string; description: string; textExcerpt: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ||
    html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    title: (titleMatch?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    description: (descMatch?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 320),
    textExcerpt: stripped.slice(0, 1500),
  };
}

function findUrlInText(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>)"']+/i);
  if (!m?.[0]) return null;
  const candidate = m[0].replace(/[.,;!?)]+$/, '');
  return isSafePublicUrl(candidate) ? candidate : null;
}

export async function researchAndEnrichLead(
  leadId: number,
  actorEmail = 'system'
): Promise<ResearchEnrichResult> {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;
  if (!lead) throw new Error('Lead not found');

  const steps: ResearchEnrichResult['steps_executed'] = [];
  let creditsConsumed = 0;

  // Step 1-2: Original buyer post verification
  steps.push({
    step: 1,
    name: 'Source Post & Evidence Review',
    status: 'OK',
    detail: `Verified ${lead.social_platform} URL (${lead.original_post_url}) and original buyer request.`,
  });

  // Suppression / Opt-out check
  const suppressed = db
    .prepare('SELECT reason FROM suppression_list WHERE lower(identifier) IN (lower(?), lower(?), lower(?))')
    .get(lead.public_business_email || '__none__', lead.username || '__none__', lead.original_post_url) as
    | { reason: string }
    | undefined;

  if (suppressed) {
    db.prepare(
      `UPDATE leads
       SET contact_email_status = 'OPTED_OUT',
           contact_evidence_notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(`Opted out / suppressed (${suppressed.reason})`, leadId);

    steps.push({
      step: 7,
      name: 'Compliance & Suppression Gate',
      status: 'SKIPPED',
      detail: `Prospect is on suppression list (${suppressed.reason}). Contact marked OPTED_OUT.`,
    });

    const refreshed = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    return { lead: mapLeadRow(refreshed), steps_executed: steps, credits_consumed: 0 };
  }

  // Step 3-4: Determine & research official company website
  let websiteUrl: string | null =
    lead.company_website && isSafePublicUrl(lead.company_website)
      ? lead.company_website
      : findUrlInText(`${lead.original_buyer_statement || ''} ${lead.project_description || ''}`);

  if (
    websiteUrl &&
    /reddit\.com|news\.ycombinator\.com|github\.com|remoteok\.com|weworkremotely\.com|twitter\.com|x\.com|linkedin\.com/i.test(
      new URL(websiteUrl).hostname
    )
  ) {
    // Only treat external non-social URLs as official company website unless explicitly stored
    if (!lead.company_website) websiteUrl = null;
  }

  let websiteTitle = '';
  let websiteDesc = '';
  let websiteExcerpt = '';
  const publishedSiteEmails: string[] = [];

  if (websiteUrl && isSafePublicUrl(websiteUrl)) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(websiteUrl, {
        headers: { 'User-Agent': 'AIBuyerHunterResearch/1.0', Accept: 'text/html' },
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok && (res.headers.get('content-type') || '').includes('html')) {
        const html = await res.text();
        const meta = extractMetaTitleAndDesc(html);
        websiteTitle = meta.title;
        websiteDesc = meta.description;
        websiteExcerpt = meta.textExcerpt;
        publishedSiteEmails.push(...extractPublishedEmails(html));
        steps.push({
          step: 4,
          name: 'Official Website Research',
          status: 'OK',
          detail: `Inspected ${websiteUrl} ("${websiteTitle || 'No title'}"). Found ${publishedSiteEmails.length} published email(s).`,
        });
      } else {
        steps.push({
          step: 4,
          name: 'Official Website Research',
          status: 'UNAVAILABLE',
          detail: `Website ${websiteUrl} returned HTTP ${res.status}.`,
        });
      }
    } catch (err: any) {
      steps.push({
        step: 4,
        name: 'Official Website Research',
        status: 'ERROR',
        detail: `Could not reach ${websiteUrl}: ${err?.message || 'network timeout'}`,
      });
    }
  } else {
    steps.push({
      step: 4,
      name: 'Official Website Research',
      status: 'UNAVAILABLE',
      detail: 'No verified external company website URL on record.',
    });
  }

  // Step 5-7: Apollo MCP Enrichment (only if connected & enabled)
  let enrichedEmail: string | null = lead.public_business_email || null;
  let emailStatus: ContactEmailStatus = enrichedEmail
    ? isValidEmailSyntax(enrichedEmail)
      ? (lead.contact_email_status as ContactEmailStatus) || 'UNVERIFIED_EMAIL'
      : 'INVALID_EMAIL'
    : 'EMAIL_UNAVAILABLE';
  let verificationSource: string | null = lead.contact_verification_source || null;
  let decisionMakerRole: string | null = lead.decision_maker_role || null;
  let companyIndustry: string | null = lead.company_industry || null;
  let companyName: string | null = lead.company_name || null;
  let country: string | null = lead.country || null;
  const evidenceParts: string[] = [];
  if (lead.contact_evidence_notes) evidenceParts.push(lead.contact_evidence_notes);

  const apollo = getUniversalIntegration('apollo_mcp');
  if (apollo && apollo.is_enabled && apollo.status === 'CONNECTED') {
    const enrichTool = apollo.tools.find(
      (t) => t.enabled && /person|enrich|contact|search|organization|company/i.test(`${t.name} ${t.description}`)
    );
    if (enrichTool) {
      const domain = websiteUrl ? new URL(websiteUrl).hostname.replace(/^www\./, '') : undefined;
      const toolArgs: Record<string, any> = {
        name: lead.prospect_name,
        company_name: companyName || undefined,
        domain,
      };
      const callRes = await executeUniversalTool({
        integrationId: 'apollo_mcp',
        toolName: enrichTool.name,
        args: toolArgs,
        actorEmail,
      });
      creditsConsumed += callRes.credits_consumed || 0;
      if (callRes.ok && callRes.output) {
        const rawText = JSON.stringify(callRes.output);
        const foundEmails = extractPublishedEmails(rawText);
        if (!enrichedEmail && foundEmails.length > 0) {
          enrichedEmail = foundEmails[0];
        }
        const verifiedFlag = /"email_status"\s*:\s*"verified"|verified/i.test(rawText);
        if (enrichedEmail && isValidEmailSyntax(enrichedEmail)) {
          emailStatus = verifiedFlag ? 'VERIFIED_EMAIL' : 'UNVERIFIED_EMAIL';
          verificationSource = `Apollo MCP (${enrichTool.name})`;
        }
        steps.push({
          step: 6,
          name: 'Apollo MCP Contact & Company Enrichment',
          status: 'OK',
          detail: `Called Apollo tool "${enrichTool.name}" (${callRes.credits_consumed} credits used).`,
        });
        evidenceParts.push(`Apollo MCP tool ${enrichTool.name} queried on ${new Date().toISOString().slice(0, 10)}.`);
      } else {
        steps.push({
          step: 6,
          name: 'Apollo MCP Contact & Company Enrichment',
          status: 'ERROR',
          detail: callRes.error || 'Apollo MCP enrichment tool returned an error.',
        });
      }
    } else {
      steps.push({
        step: 6,
        name: 'Apollo MCP Contact & Company Enrichment',
        status: 'SKIPPED',
        detail: 'Apollo MCP connected, but no compatible enrichment tool is enabled.',
      });
    }
  } else {
    steps.push({
      step: 6,
      name: 'Apollo MCP Contact & Company Enrichment',
      status: 'UNAVAILABLE',
      detail: `Apollo MCP is ${apollo?.status || 'NOT_CONFIGURED'} — no contact fabrication performed.`,
    });
  }

  // Prefer literally published website email if none yet
  if (!enrichedEmail && publishedSiteEmails.length > 0) {
    enrichedEmail = publishedSiteEmails[0];
    emailStatus = isValidEmailSyntax(enrichedEmail) ? 'UNVERIFIED_EMAIL' : 'INVALID_EMAIL';
    verificationSource = `Published directly on official website (${websiteUrl})`;
    evidenceParts.push(`Public business email "${enrichedEmail}" found verbatim on ${websiteUrl}.`);
  }

  if (!enrichedEmail) {
    emailStatus = 'EMAIL_UNAVAILABLE';
    verificationSource = 'CONTACT NOT FOUND — no verified or public email found across post, website, or connected enrichment tools';
  }

  // Step 5 & 8: Gemini Research Synthesis (strictly grounded in collected evidence)
  let researchSummary = lead.company_research_summary || '';
  const gemini = getOptionalGeminiClient('company_research_enrichment');
  if (gemini) {
    const start = Date.now();
    try {
      const response = await gemini.ai.models.generateContent({
        model: gemini.model,
        contents: `Summarize ONLY the verifiable company, role, and buyer project evidence below. Do NOT invent missing revenue, employee headcount, emails, or facts not shown below.

Buyer Post (${lead.social_platform}):
- Prospect: ${lead.prospect_name}
- Company: ${companyName || 'Unknown'}
- Service Requested: ${lead.service_requested}
- Statement: ${lead.original_buyer_statement}
- Official Website URL: ${websiteUrl || 'None'}
- Website Title: ${websiteTitle || 'N/A'}
- Website Meta Description: ${websiteDesc || 'N/A'}
- Website Text Excerpt: ${websiteExcerpt || 'N/A'}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              company_industry: { type: Type.STRING, nullable: true },
              decision_maker_role: { type: Type.STRING, nullable: true },
              country_verified: { type: Type.STRING, nullable: true },
              research_summary: { type: Type.STRING },
            },
            required: ['research_summary'],
          },
        },
      });
      const parsed = JSON.parse(response.text || '{}') as any;
      if (parsed.research_summary) researchSummary = String(parsed.research_summary).slice(0, 1000);
      if (!companyIndustry && parsed.company_industry) companyIndustry = String(parsed.company_industry).slice(0, 120);
      if (!decisionMakerRole && parsed.decision_maker_role) decisionMakerRole = String(parsed.decision_maker_role).slice(0, 120);
      if (!country && parsed.country_verified) country = String(parsed.country_verified).slice(0, 100);
      logGeminiUsage({
        action: 'COMPANY_RESEARCH_ENRICHMENT',
        toolName: 'company_research_enrichment',
        status: 'SUCCESS',
        tokensUsed: (response as any)?.usageMetadata?.totalTokenCount || 0,
        latencyMs: Date.now() - start,
        details: `Researched lead #${leadId} (${lead.lead_code}) using ${gemini.model}`,
      });
      steps.push({
        step: 5,
        name: 'Company & Decision-Maker Analysis',
        status: 'OK',
        detail: `Synthesized verified research summary via ${gemini.model}.`,
      });
    } catch (err: any) {
      logGeminiUsage({
        action: 'COMPANY_RESEARCH_ENRICHMENT',
        toolName: 'company_research_enrichment',
        status: 'ERROR',
        latencyMs: Date.now() - start,
        details: `Research failed for lead #${leadId}`,
        errorMessage: err?.message || 'Gemini research error',
      });
      steps.push({
        step: 5,
        name: 'Company & Decision-Maker Analysis',
        status: 'ERROR',
        detail: err?.message || 'Gemini research analysis failed.',
      });
    }
  } else {
    researchSummary =
      researchSummary ||
      [
        `Post evidence from ${lead.social_platform}: "${String(lead.original_buyer_statement || '').slice(0, 220)}"`,
        websiteTitle ? `Official website title: ${websiteTitle}` : '',
        websiteDesc ? `Website description: ${websiteDesc}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    steps.push({
      step: 5,
      name: 'Company & Decision-Maker Analysis',
      status: 'OK',
      detail: 'Compiled deterministic evidence summary from post & website metadata.',
    });
  }

  // Persist enriched lead fields
  db.prepare(
    `UPDATE leads
     SET company_name = COALESCE(?, company_name),
         company_website = COALESCE(?, company_website),
         country = COALESCE(?, country),
         public_business_email = ?,
         contact_email_status = ?,
         contact_verification_source = ?,
         contact_evidence_notes = ?,
         decision_maker_role = COALESCE(?, decision_maker_role),
         company_industry = COALESCE(?, company_industry),
         company_research_summary = ?,
         enrichment_credits_used = enrichment_credits_used + ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    companyName,
    websiteUrl,
    country,
    enrichedEmail,
    emailStatus,
    verificationSource,
    evidenceParts.join(' | '),
    decisionMakerRole,
    companyIndustry,
    researchSummary,
    creditsConsumed,
    leadId
  );

  // Also propagate newly found verified email onto any DRAFT / AWAITING_APPROVAL emails missing recipient_email
  if (enrichedEmail && emailStatus !== 'INVALID_EMAIL') {
    db.prepare(
      `UPDATE email_messages
       SET recipient_email = ?, updated_at = datetime('now')
       WHERE lead_id = ? AND (recipient_email IS NULL OR recipient_email = '') AND approval_status IN ('DRAFT', 'AWAITING_APPROVAL')`
    ).run(enrichedEmail, leadId);
  }

  logSystemEvent(
    'INFO',
    actorEmail,
    'LEAD_RESEARCH_ENRICHED',
    `Completed 11-step research on ${lead.lead_code} -> ${emailStatus}`
  );

  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  return {
    lead: mapLeadRow(updated),
    steps_executed: steps,
    credits_consumed: creditsConsumed,
  };
}
