export type IntentClassification =
  | 'DIRECT_BUYER'
  | 'ACTIVE_PROJECT_BUYER'
  | 'RECOMMENDATION_REQUEST'
  | 'UPCOMING_BUYER'
  | 'GENERAL_DISCUSSION'
  | 'SERVICE_PROVIDER';

export type LeadPriority = 'HOT' | 'QUALIFIED' | 'POTENTIAL' | 'LOW_PRIORITY';

export type BudgetEvidenceType =
  | 'EXPLICITLY_STATED'
  | 'PUBLICLY_REPORTED'
  | 'AI_ESTIMATED_OPPORTUNITY'
  | 'UNKNOWN';

export type OutreachApprovalStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT';

export type ContactEmailStatus =
  | 'VERIFIED_EMAIL'
  | 'UNVERIFIED_EMAIL'
  | 'EMAIL_UNAVAILABLE'
  | 'INVALID_EMAIL'
  | 'OPTED_OUT';

export type DealStatus =
  | 'Message Prepared'
  | 'Message Approved'
  | 'Message Sent'
  | 'Reply Received'
  | 'Interested Prospect'
  | 'Call Requested'
  | 'Meeting Booked'
  | 'Proposal Submitted'
  | 'Negotiation'
  | 'Won'
  | 'Lost'
  | 'Follow-Up Due';

export type UserRole = 'super_admin' | 'admin' | 'operator' | 'viewer';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INVITED';

export interface UserPermissions {
  can_discover: boolean;
  can_generate_emails: boolean;
  can_approve_emails: boolean;
  can_send_emails: boolean;
  can_connect_email_accounts: boolean;
  can_manage_leads: boolean;
  can_view_analytics: boolean;
}

export interface UserAccount {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  is_owner?: boolean;
  password_setup_required?: boolean;
  permissions: UserPermissions;
  daily_send_limit: number;
  hourly_send_limit: number;
  max_concurrent_sends: number;
  invited_by?: string | null;
  email_accounts_count?: number;
  assigned_leads_count?: number;
  emails_sent_count?: number;
  created_at: string;
  last_login_at: string | null;
}

export interface ScoreBreakdown {
  explicit_buying_intent: number;
  clear_project_requirements: number;
  decision_maker_evidence: number;
  urgency_or_active_hiring: number;
  budget_evidence: number;
  relevant_service_fit: number;
  recent_accessible_evidence: number;
}

export interface OpportunityAnalysis {
  trying_to_accomplish: string;
  service_looking_for: string;
  problem_experiencing: string;
  confirming_information: string;
  desired_outcome: string;
  recommended_primary_service: string;
  decision_maker_assessment: string;
  active_project_evidence: string;
  next_best_approach: string;
  conversion_risks: string;
}

export interface OutreachVariants {
  social_reply: string;
  linkedin_message: string;
  email_subject: string;
  email_body: string;
  contact_form: string;
  marketplace_proposal: string;
}

export interface LeadRecord {
  id: number;
  lead_code: string;
  prospect_name: string;
  company_name: string | null;
  username: string | null;
  social_platform: string;
  original_post_url: string;
  date_posted: string | null;
  date_discovered: string;
  country: string | null;
  city: string | null;
  detected_language: string | null;
  service_requested: string;
  project_description: string;
  original_buyer_statement: string;
  intent_classification: IntentClassification;
  lead_score: number;
  lead_priority: LeadPriority;
  score_breakdown: ScoreBreakdown;
  budget: string | null;
  budget_evidence_type: BudgetEvidenceType;
  urgency: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  project_status: string;
  decision_maker_status: string;
  company_website: string | null;
  public_business_email: string | null;
  contact_email_status?: ContactEmailStatus;
  contact_verification_source?: string | null;
  contact_evidence_notes?: string | null;
  decision_maker_role?: string | null;
  company_industry?: string | null;
  company_research_summary?: string | null;
  enrichment_credits_used?: number;
  public_profile_url: string | null;
  preferred_contact_method: string | null;
  evidence_url: string;
  evidence_notes: string;
  ai_opportunity_analysis: OpportunityAnalysis;
  outreach_subject: string;
  outreach_message: string;
  outreach_variants: OutreachVariants;
  outreach_approval_status: OutreachApprovalStatus;
  follow_up_date: string | null;
  deal_status: DealStatus;
  deal_value: number;
  revenue_received: number;
  assigned_service_provider: string | null;
  assigned_user_id: number | null;
  campaign_id: number | null;
  internal_notes: string;
  canonical_lead_id: number | null;
  additional_sources: Array<{ platform: string; url: string; discovered_at: string }>;
  created_at: string;
  updated_at: string;
}

export interface ContactHistoryItem {
  id: number;
  lead_id: number;
  channel: string;
  direction: 'OUTBOUND' | 'INBOUND';
  subject: string | null;
  message: string;
  status: string;
  created_at: string;
}

export interface ResearchLogItem {
  id: number;
  query: string;
  platform: string;
  service_category: string;
  country: string;
  results_count: number;
  accepted_count: number;
  rejected_count: number;
  duplicate_count: number;
  rejection_reasons: string[];
  execution_ms: number;
  status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  error_message: string | null;
  created_at: string;
}

export interface CredentialFieldMeta {
  key: string;
  label: string;
  type: 'secret' | 'text';
  placeholder: string;
  required: boolean;
  configured?: boolean;
  masked?: string;
  updated_at?: string | null;
}

export interface PlatformConnector {
  id: string;
  name: string;
  category: 'Social Media' | 'Freelance & Hiring' | 'Business & Startup' | 'Search Engine' | 'Automation';
  connection_type: 'LIVE_API' | 'GROUNDED_SEARCH' | 'MANUAL_CAPTURE' | 'CREDENTIAL_REQUIRED';
  status: 'READY' | 'UNTESTED' | 'MANUAL_ONLY' | 'MISSING_CREDENTIALS' | 'APPROVAL_REQUIRED' | 'ERROR';
  description: string;
  required_env_vars: string[];
  credential_fields?: CredentialFieldMeta[];
  requires_approval?: boolean;
  setup_instructions?: string;
  rate_limit_info: string;
  last_checked_at: string | null;
  last_error: string | null;
  is_enabled: boolean;
}

export interface CustomCommunityFeed {
  id: number;
  name: string;
  url: string;
  feed_type: 'RSS' | 'JSON';
  status: 'READY' | 'UNTESTED' | 'ERROR';
  last_checked_at: string | null;
  last_error: string | null;
  is_enabled: boolean;
}

export interface ServiceCategory {
  id: number;
  name: string;
  group_name: string;
  keywords: string[];
  is_emerging: boolean;
  is_active: boolean;
  lead_count?: number;
}

export interface AgentConfig {
  id: string;
  agent_number: number;
  name: string;
  role_description: string;
  model_name: string;
  is_enabled: boolean;
  runs_count: number;
  last_run_at: string | null;
  last_status: string;
}

export interface SearchSchedule {
  id: number;
  name: string;
  services: string[];
  platforms: string[];
  countries: string[];
  min_score: number;
  max_results: number;
  frequency_minutes: number;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface DashboardMetrics {
  total_leads: number;
  qualified_leads: number;
  hot_leads: number;
  upcoming_leads: number;
  leads_today: number;
  leads_with_verified_contact: number;
  outreach_prepared: number;
  outreach_approved: number;
  outreach_sent: number;
  replies_received: number;
  interested_prospects: number;
  deals_won: number;
  total_pipeline_value: number;
  actual_revenue_received: number;
  by_platform: Array<{ name: string; count: number }>;
  by_service: Array<{ name: string; count: number }>;
  by_country: Array<{ name: string; count: number }>;
  by_intent: Array<{ name: string; count: number }>;
  by_deal_status: Array<{ name: string; count: number; value: number }>;
}

export interface AppSettings {
  thirty_day_revenue_target: number;
  stretch_revenue_target: number;
  stretch_target_deadline: string;
  default_currency: string;
  data_retention_days: number;
  max_requests_per_minute: number;
  auto_generate_outreach: boolean;
  n8n_webhook_url: string;
  owner_daily_send_limit: number;
  owner_hourly_send_limit: number;
  owner_max_concurrent_sends: number;
  invited_default_concurrent_sends: number;
  sandbox_mode: boolean;
}

// ==================== EMAIL OUTREACH & TARGETING MODULE TYPES ====================

export type EmailProviderType =
  | 'gmail_oauth'
  | 'microsoft_oauth'
  | 'smtp'
  | 'resend_api'
  | 'sendgrid_api'
  | 'sandbox_test';

export type EmailAccountStatus =
  | 'UNTESTED'
  | 'CONNECTED'
  | 'AUTH_ERROR'
  | 'EXPIRED'
  | 'DISCONNECTED';

export interface EmailAccount {
  id: number;
  owner_user_id: number;
  owner_email?: string;
  owner_name?: string;
  provider: EmailProviderType;
  email_address: string;
  display_name: string;
  status: EmailAccountStatus;
  daily_limit: number;
  hourly_limit: number;
  sent_today: number;
  sent_this_hour: number;
  last_tested_at: string | null;
  last_error: string | null;
  token_expires_at: string | null;
  is_active: boolean;
  smtp_host?: string | null;
  smtp_port?: number | null;
  created_at: string;
  updated_at: string;
}

export interface TargetCountrySet {
  id: number;
  name: string;
  countries: string[]; // max 20
  is_default: boolean;
  owner_user_id: number;
  created_at: string;
  updated_at: string;
}

export interface EmailCampaign {
  id: number;
  name: string;
  description: string;
  owner_user_id: number;
  owner_email?: string;
  default_email_account_id: number | null;
  default_email_address?: string | null;
  target_countries: string[];
  target_services: string[];
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  total_emails?: number;
  sent_emails?: number;
  replies_count?: number;
  created_at: string;
  updated_at: string;
}

export type EmailMessageApprovalStatus =
  | 'DRAFT'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'REJECTED'
  | 'FAILED';

export interface EmailMessageRecord {
  id: number;
  campaign_id: number | null;
  campaign_name?: string | null;
  lead_id: number;
  lead_code?: string;
  owner_user_id: number;
  owner_email?: string;
  email_account_id: number | null;
  sending_email_address?: string | null;
  sending_provider?: EmailProviderType | null;
  recipient_email: string;
  prospect_name: string;
  company_name: string | null;
  country: string | null;
  service_requested: string;
  original_buyer_request: string;
  source_url: string;
  lead_score: number;
  detected_language: string;
  subject_local: string;
  body_local: string;
  subject_english: string;
  body_english: string;
  call_to_action: string;
  approval_status: EmailMessageApprovalStatus;
  approved_by_user_id: number | null;
  approved_by_email: string | null;
  approved_at: string | null;
  rejected_by_email: string | null;
  rejected_at: string | null;
  is_follow_up: boolean;
  follow_up_step: number;
  compliance_notes: string;
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
  contact_email_status?: ContactEmailStatus;
  contact_verification_source?: string | null;
  company_research_summary?: string | null;
  decision_maker_role?: string | null;
}

export interface EmailQueueItem {
  id: number;
  email_message_id: number;
  user_id: number;
  user_email?: string;
  email_account_id: number;
  sending_email?: string;
  recipient_email?: string;
  subject_local?: string;
  status: 'QUEUED' | 'PROCESSING' | 'SENT' | 'RETRYING' | 'FAILED' | 'CANCELLED';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SandboxOutboxItem {
  id: number;
  email_message_id: number;
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  status: 'DELIVERED_SANDBOX' | 'BOUNCED_SIMULATED' | 'REPLIED_SIMULATED';
  created_at: string;
}

export interface EmailAnalyticsResponse {
  kpis: {
    total_discovered_leads: number;
    qualified_leads: number;
    emails_generated: number;
    emails_awaiting_approval: number;
    emails_approved: number;
    emails_sent: number;
    emails_delivered: number;
    emails_bounced: number;
    replies_received: number;
    interested_prospects: number;
    meetings_booked: number;
    converted_customers: number;
    actual_revenue_recorded: number;
    estimated_opportunity_value: number;
  };
  by_country: Array<{ name: string; sent: number; delivered: number; replies: number; revenue: number }>;
  by_service: Array<{ name: string; sent: number; delivered: number; replies: number; revenue: number }>;
  by_language: Array<{ name: string; count: number; sent: number; replies: number }>;
  by_account: Array<{ email_address: string; provider: string; sent: number; delivered: number; bounced: number }>;
}

// ==================== UNIVERSAL MCP & API INTEGRATION TYPES ====================

export type IntegrationKind = 'MCP' | 'API';
export type McpTransportType = 'streamable_http' | 'sse';
export type IntegrationAuthType = 'none' | 'bearer' | 'api_key' | 'oauth2' | 'custom_headers';
export type UniversalIntegrationStatus =
  | 'NOT_CONFIGURED'
  | 'AWAITING_APPROVAL'
  | 'PENDING_AUTH'
  | 'CONNECTED'
  | 'EXPIRED'
  | 'ERROR'
  | 'DISABLED'
  | 'UNSUPPORTED';

export interface DiscoveredMcpTool {
  name: string;
  description: string;
  input_schema?: Record<string, any>;
  enabled: boolean;
  category?: string;
}

export interface LinkedInProductInfo {
  id: string;
  name: string;
  scope: string;
  approved: boolean;
  requires_partner_approval: boolean;
  capabilities: string;
  limitation_note: string;
}

export interface GeminiSettingsConfig {
  active_model: 'gemini-4-hydrogen' | 'gemini-4-argon' | 'gemini-4-carbon' | 'gemini-3.1-flash-lite';
  thinking_level: 'LOW' | 'MEDIUM' | 'HIGH';
  use_env_fallback: boolean;
  env_key_present: boolean;
  tools: {
    buyer_discovery_queries: boolean;
    buyer_intent_classification: boolean;
    company_research_enrichment: boolean;
    email_personalization: boolean;
    translation: boolean;
    follow_up_recommendations: boolean;
  };
}

export interface UniversalIntegration {
  id: string;
  name: string;
  slug: string;
  kind: IntegrationKind;
  is_builtin: boolean;
  category: string;
  description: string;
  endpoint_url: string;
  transport_type: McpTransportType | null;
  auth_type: IntegrationAuthType;
  status: UniversalIntegrationStatus;
  is_enabled: boolean;
  tools: DiscoveredMcpTool[];
  config: Record<string, any>;
  oauth_config: {
    authorize_url?: string;
    token_url?: string;
    scopes?: string;
    redirect_uri?: string;
    client_id_configured?: boolean;
    client_secret_configured?: boolean;
    access_token_configured?: boolean;
    token_expires_at?: string | null;
    auto_discovered?: boolean;
  };
  credential_fields: CredentialFieldMeta[];
  capabilities_summary: string[];
  limitations_note: string | null;
  rate_limit_info: string;
  api_calls_count: number;
  credits_used: number;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationUsageLog {
  id: number;
  integration_id: string;
  integration_name?: string;
  action: string;
  tool_name: string | null;
  status: 'SUCCESS' | 'ERROR' | 'BLOCKED';
  credits_consumed: number;
  tokens_used: number;
  latency_ms: number;
  details: string;
  error_message: string | null;
  created_at: string;
}

export interface UniversalIntegrationReport {
  summary: {
    total_integrations: number;
    connected_mcp: number;
    connected_api: number;
    pending_authorization: number;
    failed_connections: number;
    disabled_integrations: number;
    total_available_tools: number;
    enabled_tools: number;
    disabled_tools: number;
    total_api_calls: number;
    total_credits_consumed: number;
  };
  integrations: UniversalIntegration[];
  recent_logs: IntegrationUsageLog[];
}

export interface ResearchEnrichResult {
  lead: LeadRecord;
  steps_executed: Array<{
    step: number;
    name: string;
    status: 'OK' | 'SKIPPED' | 'UNAVAILABLE' | 'ERROR';
    detail: string;
  }>;
  credits_consumed: number;
}

