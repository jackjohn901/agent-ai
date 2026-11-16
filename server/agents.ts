import { Type } from '@google/genai';
import {
  db,
  getActiveTargetCountriesForDiscovery,
  getAppSettings,
  logSystemEvent,
} from './db.js';
import {
  type RawCandidatePost,
  executeConnectorSearch,
} from './connectors.js';
import { generatePersonalizedEmailForLead } from './emailWriter.js';
import { getConfiguredGeminiClient, logGeminiUsage } from './geminiClient.js';
import { researchAndEnrichLead } from './researchPipeline.js';
import type {
  BudgetEvidenceType,
  IntentClassification,
  LeadPriority,
  OpportunityAnalysis,
  OutreachVariants,
  ScoreBreakdown,
} from '../shared/types.js';

function recordAgentRun(agentId: string, status: string) {
  db.prepare(
    "UPDATE ai_agents SET runs_count = runs_count + 1, last_run_at = datetime('now'), last_status = ? WHERE id = ?"
  ).run(status, agentId);
}

/**
 * AGENT 1: Generate multi-variation buyer-intent search queries for a service
 */
export async function generateMultiVariationQueries(
  service: string,
  country: string,
  intelligentMode = false
): Promise<string[]> {
  try {
    const start = Date.now();
    const { ai, model } = getConfiguredGeminiClient('buyer_discovery_queries');
    const recentLogs = db
      .prepare('SELECT query FROM research_logs ORDER BY id DESC LIMIT 12')
      .all() as Array<{ query: string }>;
    const recentList = recentLogs.map((r) => r.query).join('; ');

    const response = await ai.models.generateContent({
      model,
      contents: `Generate 3 distinct, natural-language buyer-intent search queries to find people or businesses ${
        country !== 'Worldwide' ? `in ${country}` : 'worldwide'
      } actively looking to purchase "${service}"${
        intelligentMode ? ' or emerging adjacent digital/AI services' : ''
      }.
Avoid repeating these recent queries: ${recentList || 'none'}.
Focus on first-person buying phrases like "I need someone to build", "looking for a", "can anyone recommend", "hiring a", "need help with my", "seeking an agency".`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
    });
    logGeminiUsage({
      action: 'GENERATE_DISCOVERY_QUERIES',
      toolName: 'buyer_discovery_queries',
      status: 'SUCCESS',
      tokensUsed: (response as any)?.usageMetadata?.totalTokenCount || 0,
      latencyMs: Date.now() - start,
      details: `Generated search queries for ${service} (${country}) using ${model}`,
    });
    recordAgentRun('agent_discovery', 'OK');
    const parsed = JSON.parse(response.text || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 3);
  } catch {
    // Fallback deterministic variations if Gemini unavailable
  }

  return [
    `"looking for" "${service}" (developer OR designer OR agency OR expert)`,
    `"I need someone to" "${service}" OR "recommend a" "${service}"`,
    `"hiring" "${service}" (freelance OR contractor OR project)`,
  ];
}

export interface EvaluatedCandidate {
  accepted: boolean;
  rejection_reason: string | null;
  prospect_name: string;
  company_name: string | null;
  username: string | null;
  country: string | null;
  city: string | null;
  service_requested: string;
  is_emerging_service: boolean;
  project_description: string;
  original_buyer_statement: string;
  intent_classification: IntentClassification;
  score_breakdown: ScoreBreakdown;
  lead_score: number;
  lead_priority: LeadPriority;
  budget: string | null;
  budget_evidence_type: BudgetEvidenceType;
  urgency: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  project_status: string;
  decision_maker_status: string;
  company_website: string | null;
  public_business_email: string | null;
  public_profile_url: string | null;
  preferred_contact_method: string | null;
  opportunity_analysis: OpportunityAnalysis;
  outreach_variants: OutreachVariants;
}

/**
 * AGENTS 2, 3, 4, 6, 7: Evaluate candidate post for buyer intent, BI, budget, scoring, opportunity analysis & outreach
 */
export async function evaluateCandidateWithAgents(
  candidate: RawCandidatePost,
  knownServices: string[]
): Promise<EvaluatedCandidate> {
  const start = Date.now();
  const { ai, model, thinkingLevel } = getConfiguredGeminiClient('buyer_intent_classification');

  const systemInstruction = `You are a coordinated multi-agent sales intelligence pipeline (Buyer Intent Agent, Business Intelligence Agent, Budget Agent, Lead Scoring Agent, and Personalized Outreach Agent).

STRICT TRUTHFULNESS & ANTI-FABRICATION RULES:
1. NEVER invent, guess, or fabricate emails, phone numbers, company websites, budgets, locations/countries, or facts not present in the source post. If a prospect's country is not verifiable from the post text, author profile, or company details, you MUST return country: null (NEVER copy a search target country onto the prospect unless verified).
2. INTENT CLASSIFICATION (CRITICAL):
   - DIRECT_BUYER (A): Explicitly says they need a service or want to hire someone.
   - ACTIVE_PROJECT_BUYER (B): Developing, launching, redesigning, or expanding a product and needs professional help.
   - RECOMMENDATION_REQUEST (C): Asking network to recommend a service provider or agency.
   - UPCOMING_BUYER (D): Concrete upcoming project requirement, hasn't started hiring yet.
   - GENERAL_DISCUSSION (E): Discussing tech/industry/news without buying intent -> REJECT.
   - SERVICE_PROVIDER (F): Advertising their own services ("For Hire", portfolio pitch, agency promo) -> REJECT.
   Also REJECT spam, unrelated job-seeker resumes, or posts with zero digital-service relevance.
3. BUDGET EVIDENCE CLASSIFICATION:
   - EXPLICITLY_STATED: A concrete dollar/currency figure or range is directly stated in the post.
   - PUBLICLY_REPORTED: Budget/funding range is publicly reported in the post metadata.
   - AI_ESTIMATED_OPPORTUNITY: No budget stated; provide a realistic commercial opportunity estimate clearly labeled as an estimate (e.g., "Est. $1,500-$3,000 commercial scope") and mark type AI_ESTIMATED_OPPORTUNITY. Never present an estimate as verified.
   - UNKNOWN: Insufficient scope to estimate.
4. LEAD SCORING RUBRIC (0-100 exact sum):
   - explicit_buying_intent: 0-25
   - clear_project_requirements: 0-15
   - decision_maker_evidence: 0-15
   - urgency_or_active_hiring: 0-15
   - budget_evidence: 0-15
   - relevant_service_fit: 0-10
   - recent_accessible_evidence: 0-5
   Do NOT inflate scores.
5. OUTREACH FRAMEWORK (7 steps, non-generic, NEVER pretend you audited their site if you haven't):
   1) Specific observation about their actual project/post.
   2) Identify the real problem or opportunity.
   3) Explain commercial/operational impact.
   4) Recommend ONE primary service.
   5) Explain what we take responsibility for.
   6) Describe expected deliverable without unsupported guarantees.
   7) Natural, low-pressure closing question.`;

  const prompt = `Evaluate this public post:
PLATFORM: ${candidate.platform}
URL: ${candidate.original_post_url}
AUTHOR: ${candidate.author_name} (${candidate.username || 'no handle'})
DATE POSTED: ${candidate.date_posted || 'Unknown'}
COUNTRY HINT: ${candidate.country_hint || 'Unknown'}
SERVICE HINT: ${candidate.service_hint}
TITLE: ${candidate.title}
CONTENT:
${candidate.body}

Known service catalog (pick closest exact name, or identify an emerging service if genuinely new):
${knownServices.join(', ')}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      ...(model.startsWith('gemini-4') ? { thinkingConfig: { thinkingLevel } } : {}),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          accepted: { type: Type.BOOLEAN },
          rejection_reason: { type: Type.STRING, nullable: true },
          prospect_name: { type: Type.STRING },
          company_name: { type: Type.STRING, nullable: true },
          username: { type: Type.STRING, nullable: true },
          country: { type: Type.STRING, nullable: true },
          city: { type: Type.STRING, nullable: true },
          service_requested: { type: Type.STRING },
          is_emerging_service: { type: Type.BOOLEAN },
          project_description: { type: Type.STRING },
          original_buyer_statement: { type: Type.STRING },
          intent_classification: {
            type: Type.STRING,
            enum: [
              'DIRECT_BUYER',
              'ACTIVE_PROJECT_BUYER',
              'RECOMMENDATION_REQUEST',
              'UPCOMING_BUYER',
              'GENERAL_DISCUSSION',
              'SERVICE_PROVIDER',
            ],
          },
          score_breakdown: {
            type: Type.OBJECT,
            properties: {
              explicit_buying_intent: { type: Type.INTEGER },
              clear_project_requirements: { type: Type.INTEGER },
              decision_maker_evidence: { type: Type.INTEGER },
              urgency_or_active_hiring: { type: Type.INTEGER },
              budget_evidence: { type: Type.INTEGER },
              relevant_service_fit: { type: Type.INTEGER },
              recent_accessible_evidence: { type: Type.INTEGER },
            },
            required: [
              'explicit_buying_intent',
              'clear_project_requirements',
              'decision_maker_evidence',
              'urgency_or_active_hiring',
              'budget_evidence',
              'relevant_service_fit',
              'recent_accessible_evidence',
            ],
          },
          budget: { type: Type.STRING, nullable: true },
          budget_evidence_type: {
            type: Type.STRING,
            enum: ['EXPLICITLY_STATED', 'PUBLICLY_REPORTED', 'AI_ESTIMATED_OPPORTUNITY', 'UNKNOWN'],
          },
          urgency: { type: Type.STRING, enum: ['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] },
          project_status: { type: Type.STRING },
          decision_maker_status: { type: Type.STRING },
          company_website: { type: Type.STRING, nullable: true },
          public_business_email: { type: Type.STRING, nullable: true },
          public_profile_url: { type: Type.STRING, nullable: true },
          preferred_contact_method: { type: Type.STRING, nullable: true },
          opportunity_analysis: {
            type: Type.OBJECT,
            properties: {
              trying_to_accomplish: { type: Type.STRING },
              service_looking_for: { type: Type.STRING },
              problem_experiencing: { type: Type.STRING },
              confirming_information: { type: Type.STRING },
              desired_outcome: { type: Type.STRING },
              recommended_primary_service: { type: Type.STRING },
              decision_maker_assessment: { type: Type.STRING },
              active_project_evidence: { type: Type.STRING },
              next_best_approach: { type: Type.STRING },
              conversion_risks: { type: Type.STRING },
            },
            required: [
              'trying_to_accomplish',
              'service_looking_for',
              'problem_experiencing',
              'confirming_information',
              'desired_outcome',
              'recommended_primary_service',
              'decision_maker_assessment',
              'active_project_evidence',
              'next_best_approach',
              'conversion_risks',
            ],
          },
          outreach_variants: {
            type: Type.OBJECT,
            properties: {
              social_reply: { type: Type.STRING },
              linkedin_message: { type: Type.STRING },
              email_subject: { type: Type.STRING },
              email_body: { type: Type.STRING },
              contact_form: { type: Type.STRING },
              marketplace_proposal: { type: Type.STRING },
            },
            required: [
              'social_reply',
              'linkedin_message',
              'email_subject',
              'email_body',
              'contact_form',
              'marketplace_proposal',
            ],
          },
        },
        required: [
          'accepted',
          'prospect_name',
          'service_requested',
          'is_emerging_service',
          'project_description',
          'original_buyer_statement',
          'intent_classification',
          'score_breakdown',
          'budget_evidence_type',
          'urgency',
          'project_status',
          'decision_maker_status',
          'opportunity_analysis',
          'outreach_variants',
        ],
      },
    },
  });

  logGeminiUsage({
    action: 'EVALUATE_CANDIDATE',
    toolName: 'buyer_intent_classification',
    status: 'SUCCESS',
    tokensUsed: (response as any)?.usageMetadata?.totalTokenCount || 0,
    latencyMs: Date.now() - start,
    details: `Evaluated post from ${candidate.platform} using ${model}`,
  });

  const parsed = JSON.parse(response.text || '{}') as any;

  // Enforce strict rejection of E and F even if model marked accepted
  const intent: IntentClassification = parsed.intent_classification || 'GENERAL_DISCUSSION';
  let accepted = Boolean(parsed.accepted);
  let rejectionReason = parsed.rejection_reason || null;

  if (intent === 'GENERAL_DISCUSSION' || intent === 'SERVICE_PROVIDER') {
    accepted = false;
    rejectionReason = rejectionReason || `Rejected intent classification: ${intent}`;
  }

  // Clamp and compute exact score from rubric
  const sb: ScoreBreakdown = {
    explicit_buying_intent: Math.min(25, Math.max(0, Number(parsed.score_breakdown?.explicit_buying_intent || 0))),
    clear_project_requirements: Math.min(15, Math.max(0, Number(parsed.score_breakdown?.clear_project_requirements || 0))),
    decision_maker_evidence: Math.min(15, Math.max(0, Number(parsed.score_breakdown?.decision_maker_evidence || 0))),
    urgency_or_active_hiring: Math.min(15, Math.max(0, Number(parsed.score_breakdown?.urgency_or_active_hiring || 0))),
    budget_evidence: Math.min(15, Math.max(0, Number(parsed.score_breakdown?.budget_evidence || 0))),
    relevant_service_fit: Math.min(10, Math.max(0, Number(parsed.score_breakdown?.relevant_service_fit || 0))),
    recent_accessible_evidence: Math.min(5, Math.max(0, Number(parsed.score_breakdown?.recent_accessible_evidence || 0))),
  };

  const lead_score =
    sb.explicit_buying_intent +
    sb.clear_project_requirements +
    sb.decision_maker_evidence +
    sb.urgency_or_active_hiring +
    sb.budget_evidence +
    sb.relevant_service_fit +
    sb.recent_accessible_evidence;

  const lead_priority: LeadPriority =
    lead_score >= 80
      ? 'HOT'
      : lead_score >= 60
      ? 'QUALIFIED'
      : lead_score >= 40
      ? 'POTENTIAL'
      : 'LOW_PRIORITY';

  recordAgentRun('agent_intent', 'OK');
  recordAgentRun('agent_intel', 'OK');
  recordAgentRun('agent_budget', 'OK');
  recordAgentRun('agent_scoring', 'OK');
  recordAgentRun('agent_outreach', 'OK');

  return {
    accepted,
    rejection_reason: rejectionReason,
    prospect_name: parsed.prospect_name || candidate.author_name || 'Prospect',
    company_name: parsed.company_name || null,
    username: parsed.username || candidate.username || null,
    country: sanitizeCountryOrNull(parsed.country || candidate.country_hint),
    city: parsed.city && !/^unknown|n\/a$/i.test(String(parsed.city)) ? parsed.city : null,
    service_requested: parsed.service_requested || candidate.service_hint || 'Other digital & technology services',
    is_emerging_service: Boolean(parsed.is_emerging_service),
    project_description: parsed.project_description || candidate.title,
    original_buyer_statement: parsed.original_buyer_statement || candidate.body.slice(0, 600),
    intent_classification: intent,
    score_breakdown: sb,
    lead_score,
    lead_priority,
    budget: parsed.budget || null,
    budget_evidence_type: parsed.budget_evidence_type || 'UNKNOWN',
    urgency: parsed.urgency || 'UNKNOWN',
    project_status: parsed.project_status || 'Active Opportunity',
    decision_maker_status: parsed.decision_maker_status || 'Unknown',
    company_website: sanitizeUrlOrNull(parsed.company_website),
    public_business_email: sanitizeEmailOrNull(parsed.public_business_email, candidate.body),
    public_profile_url: sanitizeUrlOrNull(parsed.public_profile_url),
    preferred_contact_method: parsed.preferred_contact_method || null,
    opportunity_analysis: parsed.opportunity_analysis,
    outreach_variants: parsed.outreach_variants,
  };
}

function sanitizeCountryOrNull(val: any): string | null {
  if (!val || typeof val !== 'string') return null;
  const cleaned = val.trim();
  if (!cleaned || /^(unknown|unverified|worldwide|global|remote|n\/a|none|unspecified)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function sanitizeUrlOrNull(val: any): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Safeguard: only keep email if it literally appears in the candidate text/body to prevent hallucinated emails
 */
function sanitizeEmailOrNull(val: any, sourceText: string): string | null {
  if (!val || typeof val !== 'string') return null;
  const email = val.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!sourceText.toLowerCase().includes(email)) return null;
  return email;
}

/**
 * AGENT 5: Duplicate Detection Agent
 * Checks normalized URL, username, company domain, and project overlap.
 * Never merges different people merely because they share a first/last name.
 */
export function findDuplicateLead(
  candidate: RawCandidatePost,
  evaluated: EvaluatedCandidate
): { canonicalLeadId: number; matchReason: string; similarity: number } | null {
  recordAgentRun('agent_dedup', 'OK');

  // 1. Exact URL match
  const byUrl = db
    .prepare('SELECT id FROM leads WHERE original_post_url = ? AND canonical_lead_id IS NULL LIMIT 1')
    .get(candidate.original_post_url) as { id: number } | undefined;
  if (byUrl) {
    return { canonicalLeadId: byUrl.id, matchReason: 'Identical original post URL', similarity: 100 };
  }

  // 2. Domain match (same company website domain AND similar service)
  if (evaluated.company_website) {
    try {
      const host = new URL(evaluated.company_website).hostname.replace(/^www\./, '').toLowerCase();
      const rows = db
        .prepare('SELECT id, company_website, service_requested FROM leads WHERE company_website IS NOT NULL AND canonical_lead_id IS NULL')
        .all() as Array<{ id: number; company_website: string; service_requested: string }>;
      for (const r of rows) {
        try {
          const rHost = new URL(r.company_website).hostname.replace(/^www\./, '').toLowerCase();
          if (rHost === host && r.service_requested === evaluated.service_requested) {
            return { canonicalLeadId: r.id, matchReason: `Same company domain (${host}) & service`, similarity: 95 };
          }
        } catch {
          // ignore invalid url
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Username + platform match
  if (evaluated.username && evaluated.username.length > 2) {
    const byUser = db
      .prepare(
        'SELECT id, project_description FROM leads WHERE lower(username) = lower(?) AND lower(social_platform) = lower(?) AND canonical_lead_id IS NULL'
      )
      .all(evaluated.username, candidate.platform) as Array<{ id: number; project_description: string }>;
    for (const row of byUser) {
      const sim = jaccardSimilarity(row.project_description, evaluated.project_description);
      if (sim >= 0.45) {
        return {
          canonicalLeadId: row.id,
          matchReason: `Same handle (${evaluated.username}) on ${candidate.platform} with similar project`,
          similarity: Math.round(sim * 100),
        };
      }
    }
  }

  // 4. High project description overlap + same company name
  if (evaluated.company_name && evaluated.company_name.length > 2) {
    const byCompany = db
      .prepare('SELECT id, project_description FROM leads WHERE lower(company_name) = lower(?) AND canonical_lead_id IS NULL')
      .all(evaluated.company_name) as Array<{ id: number; project_description: string }>;
    for (const row of byCompany) {
      const sim = jaccardSimilarity(row.project_description, evaluated.project_description);
      if (sim >= 0.4) {
        return {
          canonicalLeadId: row.id,
          matchReason: `Cross-platform match for company "${evaluated.company_name}"`,
          similarity: Math.round(sim * 100),
        };
      }
    }
  }

  return null;
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let inter = 0;
  for (const w of wordsA) if (wordsB.has(w)) inter++;
  return inter / (wordsA.size + wordsB.size - inter);
}

/**
 * Store an accepted, deduplicated lead into SQLite
 */
export function persistLead(
  candidate: RawCandidatePost,
  evaluated: EvaluatedCandidate,
  context?: { assignedUserId?: number | null; campaignId?: number | null }
): { action: 'CREATED' | 'MERGED' | 'SUPPRESSED'; leadId?: number } {
  // Check suppression list before persisting
  const suppressed = db
    .prepare('SELECT id FROM suppression_list WHERE lower(identifier) IN (lower(?), lower(?), lower(?))')
    .get(
      evaluated.public_business_email || '__none__',
      evaluated.username || '__none__',
      candidate.original_post_url
    );
  if (suppressed) {
    return { action: 'SUPPRESSED' };
  }

  const dup = findDuplicateLead(candidate, evaluated);
  if (dup) {
    // Merge additional source link onto canonical lead
    const canonical = db.prepare('SELECT additional_sources_json FROM leads WHERE id = ?').get(dup.canonicalLeadId) as any;
    const sources = JSON.parse(canonical?.additional_sources_json || '[]') as Array<{
      platform: string;
      url: string;
      discovered_at: string;
    }>;
    if (!sources.some((s) => s.url === candidate.original_post_url)) {
      sources.push({
        platform: candidate.platform,
        url: candidate.original_post_url,
        discovered_at: new Date().toISOString(),
      });
      db.prepare("UPDATE leads SET additional_sources_json = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(sources),
        dup.canonicalLeadId
      );
      db.prepare(
        'INSERT INTO duplicate_links (canonical_lead_id, duplicate_source_url, platform, match_reason, similarity_score) VALUES (?, ?, ?, ?, ?)'
      ).run(dup.canonicalLeadId, candidate.original_post_url, candidate.platform, dup.matchReason, dup.similarity);
    }
    return { action: 'MERGED', leadId: dup.canonicalLeadId };
  }

  // Register emerging service dynamically if not in catalog
  if (evaluated.is_emerging_service && evaluated.service_requested) {
    db.prepare(
      `INSERT OR IGNORE INTO service_categories (name, group_name, keywords_json, is_emerging, is_active)
       VALUES (?, 'Emerging Services', '[]', 1, 1)`
    ).run(evaluated.service_requested);
  }

  const code = `BH-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
  const followUp = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const info = db
    .prepare(
      `INSERT INTO leads (
        lead_code, prospect_name, company_name, username, social_platform,
        original_post_url, date_posted, date_discovered, country, city,
        service_requested, project_description, original_buyer_statement,
        intent_classification, lead_score, lead_priority, score_breakdown_json,
        budget, budget_evidence_type, urgency, project_status, decision_maker_status,
        company_website, public_business_email, contact_email_status, contact_verification_source,
        public_profile_url, preferred_contact_method,
        evidence_url, evidence_notes, ai_opportunity_analysis_json,
        outreach_subject, outreach_message, outreach_variants_json,
        outreach_approval_status, follow_up_date, deal_status, deal_value, revenue_received,
        assigned_user_id, campaign_id, internal_notes
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, datetime('now'), ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        'PENDING_APPROVAL', ?, 'Message Prepared', 0, 0,
        ?, ?, ''
      )`
    )
    .run(
      code,
      evaluated.prospect_name,
      evaluated.company_name,
      evaluated.username,
      candidate.platform,
      candidate.original_post_url,
      candidate.date_posted,
      evaluated.country,
      evaluated.city,
      evaluated.service_requested,
      evaluated.project_description,
      evaluated.original_buyer_statement,
      evaluated.intent_classification,
      evaluated.lead_score,
      evaluated.lead_priority,
      JSON.stringify(evaluated.score_breakdown),
      evaluated.budget,
      evaluated.budget_evidence_type,
      evaluated.urgency,
      evaluated.project_status,
      evaluated.decision_maker_status,
      evaluated.company_website,
      evaluated.public_business_email,
      evaluated.public_business_email ? 'UNVERIFIED_EMAIL' : 'EMAIL_UNAVAILABLE',
      evaluated.public_business_email ? `Extracted directly from public post (${candidate.platform})` : null,
      evaluated.public_profile_url,
      evaluated.preferred_contact_method,
      candidate.original_post_url,
      candidate.evidence_notes,
      JSON.stringify(evaluated.opportunity_analysis),
      evaluated.outreach_variants.email_subject || `${evaluated.service_requested} — ${evaluated.prospect_name}`,
      evaluated.outreach_variants.social_reply || evaluated.outreach_variants.email_body || '',
      JSON.stringify(evaluated.outreach_variants),
      followUp,
      context?.assignedUserId ?? null,
      context?.campaignId ?? null
    );

  return { action: 'CREATED', leadId: Number(info.lastInsertRowid) };
}

export interface DiscoveryRunParams {
  services: string[];
  platforms: string[];
  countries: string[];
  minScore: number;
  maxResults: number;
  intelligentMode: boolean;
  actor: string;
  actorUserId?: number;
  campaignId?: number | null;
  strictCountryFilter?: boolean;
}

export interface DiscoveryRunSummary {
  total_scanned: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  below_min_score: number;
  created_lead_ids: number[];
  errors: string[];
  logs_created: number;
}

/**
 * Full Multi-Agent Discovery Pipeline Execution
 */
export async function runDiscoveryPipeline(params: DiscoveryRunParams): Promise<DiscoveryRunSummary> {
  const summary: DiscoveryRunSummary = {
    total_scanned: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    below_min_score: 0,
    created_lead_ids: [],
    errors: [],
    logs_created: 0,
  };

  const allServicesRows = db.prepare('SELECT name, keywords_json FROM service_categories WHERE is_active = 1').all() as Array<{
    name: string;
    keywords_json: string;
  }>;
  const knownServices = allServicesRows.map((r) => r.name);

  const selectedServices =
    params.services.length === 0 || params.services.includes('All Services')
      ? knownServices.slice(0, 3) // sample 3 diverse categories per run to respect rate limits
      : params.services.slice(0, 4);

  const requestedCountries = (params.countries || []).filter(Boolean).slice(0, 20);
  const savedTargetCountries = getActiveTargetCountriesForDiscovery(params.actorUserId);
  const effectiveCountries =
    requestedCountries.length > 0 && !(requestedCountries.length === 1 && requestedCountries[0] === 'Worldwide')
      ? requestedCountries
      : savedTargetCountries.length > 0
      ? savedTargetCountries
      : ['Worldwide'];

  const isGlobalScope = effectiveCountries.length === 1 && effectiveCountries[0] === 'Worldwide';
  const normalizedTargetSet = new Set(effectiveCountries.map((c) => c.toLowerCase()));
  const primarySearchCountry = effectiveCountries.slice(0, 3).join(', ');
  const appSettings = getAppSettings();

  const readyPlatformRows = db
    .prepare("SELECT id, name, status, is_enabled FROM platforms WHERE is_enabled = 1 AND status = 'READY'")
    .all() as Array<{ id: string; name: string; status: string; is_enabled: number }>;
  const readyIds = new Set(readyPlatformRows.map((r) => r.id));

  const activePlatforms =
    params.platforms.length === 0 || params.platforms.includes('All Platforms')
      ? readyPlatformRows.map((r) => r.id)
      : params.platforms.filter((id) => readyIds.has(id));

  const skippedNotReady = params.platforms.filter(
    (id) => id !== 'All Platforms' && !readyIds.has(id)
  );
  if (skippedNotReady.length > 0) {
    summary.errors.push(
      `Skipped connectors not verified as READY: ${skippedNotReady.join(', ')}. Configure credentials & test connections first.`
    );
  }
  if (activePlatforms.length === 0) {
    summary.errors.push('No READY & enabled data connectors available. Run Connection Tests in Data Sources & API Integrations.');
    return summary;
  }

  for (const service of selectedServices) {
    const catRow = allServicesRows.find((r) => r.name === service);
    const keywords: string[] = catRow ? JSON.parse(catRow.keywords_json || '[]') : [service];
    const queries = await generateMultiVariationQueries(service, primarySearchCountry, params.intelligentMode);

    for (const platformId of activePlatforms) {
      const start = Date.now();
      const res = await executeConnectorSearch(
        platformId,
        service,
        keywords,
        queries[0] || service,
        primarySearchCountry,
        Math.min(10, params.maxResults)
      );

      if (res.error) summary.errors.push(`${res.platform_name}: ${res.error}`);

      let acceptedCount = 0;
      let rejectedCount = 0;
      let dupCount = 0;
      const rejectionReasons: string[] = [];

      for (const candidate of res.candidates) {
        summary.total_scanned += 1;
        const existingUrl = db
          .prepare('SELECT id FROM leads WHERE original_post_url = ? LIMIT 1')
          .get(candidate.original_post_url);
        if (existingUrl) {
          dupCount += 1;
          summary.duplicates += 1;
          continue;
        }

        try {
          const evaluated = await evaluateCandidateWithAgents(candidate, knownServices);
          if (!evaluated.accepted) {
            rejectedCount += 1;
            summary.rejected += 1;
            if (evaluated.rejection_reason) rejectionReasons.push(evaluated.rejection_reason);
            continue;
          }

          // Respect selected Target Countries: reject leads verified in another non-targeted country
          if (!isGlobalScope) {
            const cLower = (evaluated.country || '').toLowerCase();
            if (cLower && !Array.from(normalizedTargetSet).some((tc) => cLower.includes(tc) || tc.includes(cLower))) {
              rejectedCount += 1;
              summary.rejected += 1;
              rejectionReasons.push(`Verified country "${evaluated.country}" outside selected target countries`);
              continue;
            }
            if (params.strictCountryFilter && !cLower) {
              rejectedCount += 1;
              summary.rejected += 1;
              rejectionReasons.push('Unverified country excluded by strict geographic targeting');
              continue;
            }
          }

          if (evaluated.lead_score < params.minScore) {
            rejectedCount += 1;
            summary.below_min_score += 1;
            rejectionReasons.push(`Score ${evaluated.lead_score} below threshold ${params.minScore}`);
            continue;
          }

          const persisted = persistLead(candidate, evaluated, {
            assignedUserId: params.actorUserId ?? null,
            campaignId: params.campaignId ?? null,
          });
          if (persisted.action === 'CREATED' && persisted.leadId) {
            acceptedCount += 1;
            summary.accepted += 1;
            summary.created_lead_ids.push(persisted.leadId);

            await researchAndEnrichLead(persisted.leadId, params.actor).catch(() => {});

            if (appSettings.auto_generate_outreach && params.actorUserId) {
              await generatePersonalizedEmailForLead({
                leadId: persisted.leadId,
                ownerUserId: params.actorUserId,
                ownerEmail: params.actor,
                campaignId: params.campaignId ?? null,
                saveStatus: 'AWAITING_APPROVAL',
              }).catch(() => {});
            }
          } else if (persisted.action === 'MERGED') {
            dupCount += 1;
            summary.duplicates += 1;
          } else {
            rejectedCount += 1;
            rejectionReasons.push('Matched opt-out suppression list');
          }
        } catch (err: any) {
          summary.errors.push(`Agent evaluation error: ${err?.message || 'Unknown'}`);
        }
      }

      db.prepare(
        `INSERT INTO research_logs (
          query, platform, service_category, country,
          results_count, accepted_count, rejected_count, duplicate_count,
          rejection_reasons_json, execution_ms, status, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        res.query,
        res.platform_name,
        service,
        primarySearchCountry,
        res.candidates.length,
        acceptedCount,
        rejectedCount,
        dupCount,
        JSON.stringify(rejectionReasons.slice(0, 10)),
        Date.now() - start,
        res.error ? 'ERROR' : 'SUCCESS',
        res.error || null
      );
      summary.logs_created += 1;
    }
  }

  logSystemEvent(
    'INFO',
    params.actor,
    'DISCOVERY_RUN_COMPLETED',
    `Scanned ${summary.total_scanned}, accepted ${summary.accepted}, rejected ${summary.rejected}, duplicates ${summary.duplicates}`
  );

  return summary;
}

/**
 * AGENT 8: Conversion & Follow-Up Recommendation
 */
export async function generateFollowUpRecommendation(leadId: number): Promise<{
  recommended_action: string;
  suggested_message: string;
  suggested_follow_up_date: string;
}> {
  recordAgentRun('agent_conversion', 'OK');
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;
  if (!lead) throw new Error('Lead not found');

  const history = db
    .prepare('SELECT * FROM contact_history WHERE lead_id = ? ORDER BY id DESC LIMIT 10')
    .all(leadId) as any[];

  const start = Date.now();
  const { ai, model } = getConfiguredGeminiClient('follow_up_recommendations');
  const response = await ai.models.generateContent({
    model,
    contents: `Based on this prospect and contact history, recommend the exact next conversion action and a respectful, low-pressure follow-up message.
Prospect: ${lead.prospect_name} (${lead.company_name || 'Individual'})
Service: ${lead.service_requested}
Deal Status: ${lead.deal_status}
Project: ${lead.project_description}
Contact History: ${JSON.stringify(history)}

Rules: Respect opt-outs immediately, never invent prior conversations that didn't happen, keep it concise and helpful.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommended_action: { type: Type.STRING },
          suggested_message: { type: Type.STRING },
          days_until_follow_up: { type: Type.INTEGER },
        },
        required: ['recommended_action', 'suggested_message', 'days_until_follow_up'],
      },
    },
  });

  logGeminiUsage({
    action: 'FOLLOW_UP_RECOMMENDATION',
    toolName: 'follow_up_recommendations',
    status: 'SUCCESS',
    tokensUsed: (response as any)?.usageMetadata?.totalTokenCount || 0,
    latencyMs: Date.now() - start,
    details: `Generated follow-up recommendation for lead #${leadId} using ${model}`,
  });

  const parsed = JSON.parse(response.text || '{}') as any;
  const days = Math.min(30, Math.max(1, Number(parsed.days_until_follow_up || 3)));
  const nextDate = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

  return {
    recommended_action: parsed.recommended_action || 'Send polite check-in message',
    suggested_message: parsed.suggested_message || '',
    suggested_follow_up_date: nextDate,
  };
}
