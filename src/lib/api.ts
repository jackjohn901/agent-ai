import type {
  AgentConfig,
  AppSettings,
  ContactHistoryItem,
  CustomCommunityFeed,
  DashboardMetrics,
  EmailAccount,
  EmailAnalyticsResponse,
  EmailCampaign,
  EmailMessageRecord,
  EmailQueueItem,
  LeadRecord,
  PlatformConnector,
  ResearchLogItem,
  SandboxOutboxItem,
  SearchSchedule,
  ServiceCategory,
  TargetCountrySet,
  UniversalIntegration,
  UniversalIntegrationReport,
  ResearchEnrichResult,
  IntegrationAuthType,
  IntegrationKind,
  McpTransportType,
  UserAccount,
  UserPermissions,
} from '../../shared/types';
import type { CountryInfo } from '../../shared/countries';

const TOKEN_STORAGE_KEY = 'abh_session_token';
let memoryToken: string | null = null;

function getSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setSessionToken(token: string | undefined | null) {
  if (!token) return;
  memoryToken = token;
  try {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore restricted storage
  }
}

export function clearSessionToken() {
  memoryToken = null;
  try {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore restricted storage
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });
  if (!res.ok) {
    if (res.status === 401) {
      clearSessionToken();
    }
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) errMsg = body.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export async function downloadAuthenticatedFile(url: string, filename: string) {
  const token = getSessionToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) {
    throw new Error(`Export failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export function isSuperAdmin(user: UserAccount | null | undefined): boolean {
  return user?.role === 'super_admin';
}

export function isAdmin(user: UserAccount | null | undefined): boolean {
  return user?.role === 'super_admin' || user?.role === 'admin';
}

export function canOperate(user: UserAccount | null | undefined): boolean {
  return user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'operator';
}

export function hasPermission(user: UserAccount | null | undefined, perm: keyof UserPermissions): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return Boolean(user.permissions?.[perm]);
}

export const api = {
  me: () => request<{ user: UserAccount }>('/api/auth/me'),
  accountStatus: (email: string) =>
    request<{ exists: boolean; password_setup_required: boolean; is_owner: boolean }>('/api/auth/account-status', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  setupPassword: async (email: string, password: string) => {
    const res = await request<{ user: UserAccount; session_token?: string }>('/api/auth/setup-password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSessionToken(res.session_token);
    return res;
  },
  login: async (email: string, password: string) => {
    const res = await request<{ user: UserAccount; session_token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSessionToken(res.session_token);
    return res;
  },
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: async (email: string, token: string, password: string) => {
    const res = await request<{ user: UserAccount; session_token?: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, token, password }),
    });
    setSessionToken(res.session_token);
    return res;
  },
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
  logout: async () => {
    try {
      return await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      clearSessionToken();
    }
  },

  // Users & Invited Users
  getUsers: () => request<{ users: UserAccount[] }>('/api/users'),
  createUser: (data: {
    name: string;
    email: string;
    password?: string;
    role: string;
    invite_mode?: boolean;
    permissions?: Partial<UserPermissions>;
    daily_send_limit?: number;
    hourly_send_limit?: number;
    max_concurrent_sends?: number;
  }) => request<{ id: number; user: UserAccount }>('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (
    id: number,
    data: {
      name?: string;
      role?: string;
      status?: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
      permissions?: Partial<UserPermissions>;
      daily_send_limit?: number;
      hourly_send_limit?: number;
      max_concurrent_sends?: number;
    }
  ) => request<{ ok: boolean; user: UserAccount }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  // Dashboard & Leads
  getMetrics: () => request<DashboardMetrics>('/api/dashboard/metrics'),
  getLeads: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== 'ALL') qs.set(k, String(v));
    }
    const query = qs.toString();
    return request<{ leads: LeadRecord[] }>(`/api/leads${query ? `?${query}` : ''}`);
  },
  getLeadDetail: (id: number) =>
    request<{ lead: LeadRecord; contact_history: ContactHistoryItem[]; duplicate_links: any[] }>(`/api/leads/${id}`),
  updateLead: (id: number, patch: Record<string, any>) =>
    request<{ lead: LeadRecord }>(`/api/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteLead: (id: number) => request<{ ok: boolean }>(`/api/leads/${id}`, { method: 'DELETE' }),

  approveOutreach: (id: number) =>
    request<{ lead: LeadRecord }>(`/api/leads/${id}/outreach/approve`, { method: 'POST' }),
  rejectOutreach: (id: number) =>
    request<{ lead: LeadRecord }>(`/api/leads/${id}/outreach/reject`, { method: 'POST' }),
  markOutreachSent: (id: number, payload: { channel: string; subject: string; message: string }) =>
    request<{ lead: LeadRecord }>(`/api/leads/${id}/outreach/mark-sent`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addContactHistory: (
    id: number,
    payload: {
      channel: string;
      direction: 'OUTBOUND' | 'INBOUND';
      subject?: string;
      message: string;
      status: string;
      new_deal_status?: string;
    }
  ) =>
    request<{ ok: boolean }>(`/api/leads/${id}/contact-history`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  recommendFollowUp: (id: number) =>
    request<{ recommended_action: string; suggested_message: string; suggested_follow_up_date: string }>(
      `/api/leads/${id}/follow-up/recommend`,
      { method: 'POST' }
    ),
  researchEnrichLead: (id: number) =>
    request<ResearchEnrichResult>(`/api/leads/${id}/research-enrich`, { method: 'POST' }),

  // Discovery
  runDiscovery: (payload: {
    services: string[];
    platforms: string[];
    countries: string[];
    minScore: number;
    maxResults: number;
    intelligentMode: boolean;
    campaignId?: number | null;
    strictCountryFilter?: boolean;
  }) =>
    request<{ summary: any }>('/api/discovery/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitManualIntake: (payload: {
    url?: string;
    platform?: string;
    author?: string;
    content?: string;
    service_hint?: string;
  }) =>
    request<{
      accepted: boolean;
      action?: string;
      lead?: LeadRecord;
      intent_classification?: string;
      rejection_reason?: string;
    }>('/api/discovery/manual', { method: 'POST', body: JSON.stringify(payload) }),

  // Services & Platforms
  getServices: () => request<{ services: ServiceCategory[] }>('/api/services'),
  addService: (payload: { name: string; group_name: string; keywords: string[] }) =>
    request<{ services: ServiceCategory[] }>('/api/services', { method: 'POST', body: JSON.stringify(payload) }),
  toggleService: (id: number, is_active: boolean) =>
    request<{ services: ServiceCategory[] }>(`/api/services/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active }),
    }),
  getPlatforms: () => request<{ platforms: PlatformConnector[] }>('/api/platforms'),
  togglePlatform: (id: string, is_enabled: boolean) =>
    request<{ platforms: PlatformConnector[] }>(`/api/platforms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_enabled }),
    }),

  // Integrations
  getIntegrations: () =>
    request<{
      integrations: PlatformConnector[];
      custom_feeds: CustomCommunityFeed[];
      email_oauth_config?: {
        gmail_firebase_provisioned: boolean;
        microsoft_365: {
          client_id_configured: boolean;
          client_id_masked: string;
          client_secret_configured: boolean;
          client_secret_masked: string;
          tenant_id: string;
          callback_url: string;
        };
      };
    }>('/api/integrations'),
  saveMicrosoftOAuthConfig: (payload: { client_id?: string; client_secret?: string; tenant_id?: string }) =>
    request<{ ok: boolean }>('/api/integrations/microsoft-oauth', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  saveIntegrationCredentials: (id: string, credentials: Record<string, string>) =>
    request<{ integrations: PlatformConnector[]; message: string }>(`/api/integrations/${id}/credentials`, {
      method: 'PUT',
      body: JSON.stringify({ credentials }),
    }),
  clearIntegrationCredentials: (id: string) =>
    request<{ integrations: PlatformConnector[] }>(`/api/integrations/${id}/credentials`, {
      method: 'DELETE',
    }),
  testIntegration: (id: string) =>
    request<{
      result: { connector_id: string; status: string; ok: boolean; message: string; checked_at: string };
      integrations: PlatformConnector[];
      custom_feeds: CustomCommunityFeed[];
    }>(`/api/integrations/${id}/test`, { method: 'POST' }),
  testAllIntegrations: () =>
    request<{
      results: Array<{ connector_id: string; status: string; ok: boolean; message: string; checked_at: string }>;
      integrations: PlatformConnector[];
      custom_feeds: CustomCommunityFeed[];
    }>('/api/integrations/test-all', { method: 'POST' }),
  addCustomFeed: (payload: { name: string; url: string; feed_type: 'RSS' | 'JSON' }) =>
    request<{
      testResult: { ok: boolean; status: string; message: string };
      custom_feeds: CustomCommunityFeed[];
      integrations: PlatformConnector[];
    }>('/api/integrations/custom-feeds', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  testCustomFeed: (id: number) =>
    request<{
      testResult: { ok: boolean; status: string; message: string };
      custom_feeds: CustomCommunityFeed[];
      integrations: PlatformConnector[];
    }>(`/api/integrations/custom-feeds/${id}/test`, { method: 'POST' }),
  deleteCustomFeed: (id: number) =>
    request<{
      custom_feeds: CustomCommunityFeed[];
      integrations: PlatformConnector[];
    }>(`/api/integrations/custom-feeds/${id}`, { method: 'DELETE' }),

  // Target Countries (Module 4)
  getWorldCountries: () =>
    request<{ countries: CountryInfo[]; max_target_countries: number }>('/api/countries'),
  getTargetCountrySets: () =>
    request<{ sets: TargetCountrySet[]; max_target_countries: number }>('/api/target-countries'),
  createTargetCountrySet: (payload: { name: string; countries: string[]; is_default?: boolean }) =>
    request<{ id: number; sets: TargetCountrySet[] }>('/api/target-countries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTargetCountrySet: (
    id: number,
    payload: { name?: string; countries?: string[]; is_default?: boolean }
  ) =>
    request<{ sets: TargetCountrySet[] }>(`/api/target-countries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteTargetCountrySet: (id: number) =>
    request<{ sets: TargetCountrySet[] }>(`/api/target-countries/${id}`, { method: 'DELETE' }),

  // Multiple Email Accounts (Module 2)
  getEmailAccounts: () =>
    request<{
      accounts: EmailAccount[];
      user_limits: {
        isOwner: boolean;
        dailyLimit: number;
        hourlyLimit: number;
        maxConcurrent: number;
        sentToday: number;
        sentThisHour: number;
        activeConcurrent: number;
      };
    }>('/api/email-accounts'),
  createEmailAccount: (payload: {
    provider: 'smtp' | 'resend_api' | 'sendgrid_api' | 'sandbox_test';
    email_address: string;
    display_name?: string;
    daily_limit?: number;
    hourly_limit?: number;
    credentials?: Record<string, any>;
    skip_test?: boolean;
  }) =>
    request<{ account: EmailAccount; test_result?: { ok: boolean; status: string; message: string } }>(
      '/api/email-accounts',
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  connectGmailOAuthAccount: (
    gmailAccessToken: string,
    payload: { email_address?: string; display_name?: string; daily_limit?: number; hourly_limit?: number }
  ) =>
    request<{ account: EmailAccount }>('/api/email-accounts/gmail/connect', {
      method: 'POST',
      headers: { 'X-Gmail-Access-Token': gmailAccessToken },
      body: JSON.stringify(payload),
    }),
  getMicrosoftOAuthUrl: (displayName?: string) =>
    request<{ url: string; redirect_uri: string }>(
      `/api/email-accounts/oauth/microsoft/url${displayName ? `?display_name=${encodeURIComponent(displayName)}` : ''}`
    ),
  testEmailAccount: (id: number, gmailAccessToken?: string) =>
    request<{ ok: boolean; status: string; message: string; account: EmailAccount }>(
      `/api/email-accounts/${id}/test`,
      {
        method: 'POST',
        headers: gmailAccessToken ? { 'X-Gmail-Access-Token': gmailAccessToken } : undefined,
      }
    ),
  updateEmailAccount: (
    id: number,
    patch: { display_name?: string; daily_limit?: number; hourly_limit?: number; is_active?: boolean; status?: string }
  ) =>
    request<{ account: EmailAccount }>(`/api/email-accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteEmailAccount: (id: number) =>
    request<{ ok: boolean }>(`/api/email-accounts/${id}`, { method: 'DELETE' }),

  // Email Campaigns (Modules 4, 8)
  getCampaigns: () => request<{ campaigns: EmailCampaign[] }>('/api/campaigns'),
  createCampaign: (payload: {
    name: string;
    description?: string;
    default_email_account_id?: number | null;
    target_countries: string[];
    target_services: string[];
  }) => request<{ id: number }>('/api/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  updateCampaign: (id: number, patch: Partial<EmailCampaign>) =>
    request<{ ok: boolean }>(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCampaign: (id: number) => request<{ ok: boolean }>(`/api/campaigns/${id}`, { method: 'DELETE' }),

  // AI Email Writer & Individual Approval Center (Modules 6, 7)
  getEmailMessages: (params: { status?: string; campaignId?: number; leadId?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.campaignId) qs.set('campaignId', String(params.campaignId));
    if (params.leadId) qs.set('leadId', String(params.leadId));
    const q = qs.toString();
    return request<{ messages: EmailMessageRecord[] }>(`/api/email-messages${q ? `?${q}` : ''}`);
  },
  generatePersonalizedEmail: (payload: {
    lead_id: number;
    campaign_id?: number | null;
    email_account_id?: number | null;
    target_language?: string;
    save_status?: 'DRAFT' | 'AWAITING_APPROVAL';
  }) =>
    request<{ email_message: EmailMessageRecord }>('/api/email-messages/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEmailMessage: (
    id: number,
    patch: {
      recipient_email?: string;
      email_account_id?: number | null;
      campaign_id?: number | null;
      subject_local?: string;
      body_local?: string;
      subject_english?: string;
      body_english?: string;
      call_to_action?: string;
      detected_language?: string;
      approval_status?: 'DRAFT' | 'AWAITING_APPROVAL';
    }
  ) =>
    request<{ email_message: EmailMessageRecord }>(`/api/email-messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  approveAndSendEmail: (
    id: number,
    payload: {
      email_account_id: number;
      recipient_email?: string;
      subject_local?: string;
      body_local?: string;
    },
    gmailAccessToken?: string
  ) =>
    request<{ status: string; message: string; queued: boolean; email_message: EmailMessageRecord }>(
      `/api/email-messages/${id}/approve-send`,
      {
        method: 'POST',
        headers: gmailAccessToken ? { 'X-Gmail-Access-Token': gmailAccessToken } : undefined,
        body: JSON.stringify(payload),
      }
    ),
  rejectEmailMessage: (id: number) =>
    request<{ ok: boolean }>(`/api/email-messages/${id}/reject`, { method: 'POST' }),
  recordEmailOutcome: (
    id: number,
    payload: { outcome: 'REPLIED' | 'DELIVERED' | 'BOUNCED' | 'CONVERTED'; deal_status?: string; revenue_received?: number; note?: string }
  ) =>
    request<{ ok: boolean }>(`/api/email-messages/${id}/record-outcome`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateFollowUpEmail: (payload: {
    lead_id: number;
    email_account_id?: number | null;
    campaign_id?: number | null;
  }) =>
    request<{ email_message: EmailMessageRecord }>('/api/follow-ups/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Email Queue, Sandbox Outbox & Analytics (Modules 3, 8)
  getEmailQueue: () =>
    request<{
      queue: EmailQueueItem[];
      user_limits: {
        isOwner: boolean;
        dailyLimit: number;
        hourlyLimit: number;
        maxConcurrent: number;
        sentToday: number;
        sentThisHour: number;
        activeConcurrent: number;
      };
      active_concurrency?: Record<number, number>;
    }>('/api/email-queue'),
  retryQueueItem: (id: number, gmailAccessToken?: string) =>
    request<{ status: string; message: string }>(`/api/email-queue/${id}/retry`, {
      method: 'POST',
      headers: gmailAccessToken ? { 'X-Gmail-Access-Token': gmailAccessToken } : undefined,
    }),
  getSandboxOutbox: () => request<{ outbox: SandboxOutboxItem[] }>('/api/sandbox-outbox'),
  getEmailAnalytics: (filters: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== '' && v !== 'ALL') qs.set(k, String(v));
    }
    const q = qs.toString();
    return request<EmailAnalyticsResponse>(`/api/email-analytics${q ? `?${q}` : ''}`);
  },

  // Agents, Logs, Suppression, Schedules, Settings
  getAgents: () => request<{ agents: AgentConfig[] }>('/api/agents'),
  toggleAgent: (id: string, is_enabled: boolean) =>
    request<{ agents: AgentConfig[] }>(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_enabled }),
    }),
  getResearchLogs: () => request<{ logs: ResearchLogItem[] }>('/api/research-logs'),
  getDuplicates: () => request<{ duplicates: any[] }>('/api/duplicates'),
  getSuppression: () =>
    request<{ suppression: Array<{ id: number; identifier: string; reason: string; created_at: string }> }>(
      '/api/suppression'
    ),
  addSuppression: (identifier: string, reason: string) =>
    request<{ suppression: any[] }>('/api/suppression', { method: 'POST', body: JSON.stringify({ identifier, reason }) }),
  deleteSuppression: (id: number) => request<{ ok: boolean }>(`/api/suppression/${id}`, { method: 'DELETE' }),
  getSchedules: () => request<{ schedules: SearchSchedule[] }>('/api/schedules'),
  createSchedule: (payload: any) =>
    request<{ schedules: SearchSchedule[] }>('/api/schedules', { method: 'POST', body: JSON.stringify(payload) }),
  toggleSchedule: (id: number, is_active: boolean) =>
    request<{ schedules: SearchSchedule[] }>(`/api/schedules/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  deleteSchedule: (id: number) => request<{ ok: boolean }>(`/api/schedules/${id}`, { method: 'DELETE' }),
  getSystemLogs: () => request<{ logs: any[] }>('/api/system-logs'),
  getSettings: () => request<{ settings: AppSettings }>('/api/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  getRuntimeStatus: () => request<Record<string, any>>('/api/config/runtime-status'),

  // Universal MCP & API Integrations Marketplace (Super Admin)
  getUniversalIntegrations: () =>
    request<{ integrations: UniversalIntegration[]; report: UniversalIntegrationReport }>('/api/universal-integrations'),
  getUniversalIntegrationReport: () =>
    request<UniversalIntegrationReport>('/api/universal-integrations/report'),
  createUniversalIntegration: (payload: {
    name: string;
    kind: IntegrationKind;
    category?: string;
    description?: string;
    endpoint_url: string;
    transport_type?: McpTransportType;
    auth_type: IntegrationAuthType;
    api_key_header?: string;
    oauth_authorize_url?: string;
    oauth_token_url?: string;
    oauth_scopes?: string;
    rate_limit_info?: string;
    credentials?: Record<string, string>;
    run_test?: boolean;
  }) =>
    request<{
      integration: UniversalIntegration;
      test_result: any;
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>('/api/universal-integrations', { method: 'POST', body: JSON.stringify(payload) }),
  updateUniversalIntegrationConfig: (id: string, patch: Record<string, any>) =>
    request<{
      integration: UniversalIntegration;
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>(`/api/universal-integrations/${id}/config`, { method: 'PATCH', body: JSON.stringify(patch) }),
  saveUniversalCredentials: (id: string, credentials: Record<string, string>) =>
    request<{
      integration: UniversalIntegration;
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>(`/api/universal-integrations/${id}/credentials`, {
      method: 'PUT',
      body: JSON.stringify({ credentials }),
    }),
  clearUniversalCredentials: (id: string) =>
    request<{
      integration: UniversalIntegration;
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>(`/api/universal-integrations/${id}/credentials`, { method: 'DELETE' }),
  toggleUniversalIntegration: (id: string, is_enabled: boolean) =>
    request<{
      integration: UniversalIntegration;
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>(`/api/universal-integrations/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_enabled }),
    }),
  toggleUniversalTool: (id: string, toolName: string, enabled: boolean) =>
    request<{
      integration: UniversalIntegration;
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>(`/api/universal-integrations/${id}/tools/${encodeURIComponent(toolName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  testUniversalIntegration: (id: string) =>
    request<{
      result: { ok: boolean; status: string; message: string; integration: UniversalIntegration };
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>(`/api/universal-integrations/${id}/test`, { method: 'POST' }),
  executeUniversalTool: (id: string, toolName: string, args: Record<string, any> = {}) =>
    request<{
      exec_result: { ok: boolean; output: any; credits_consumed: number; latency_ms: number; error?: string };
      integrations: UniversalIntegration[];
      report: UniversalIntegrationReport;
    }>(`/api/universal-integrations/${id}/tools/${encodeURIComponent(toolName)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ arguments: args }),
    }),
  deleteUniversalIntegration: (id: string) =>
    request<{ integrations: UniversalIntegration[]; report: UniversalIntegrationReport }>(
      `/api/universal-integrations/${id}`,
      { method: 'DELETE' }
    ),
  startUniversalOAuth: (id: string) =>
    request<{ authorize_url: string; redirect_uri: string }>(
      `/api/universal-integrations/${id}/oauth/start`,
      { method: 'POST' }
    ),
};

export async function authorizeUniversalOAuthPopup(integrationId: string): Promise<{ message: string }> {
  const { authorize_url } = await api.startUniversalOAuth(integrationId);
  return new Promise((resolve, reject) => {
    const popup = window.open(
      authorize_url,
      `universal_oauth_${integrationId}`,
      'width=620,height=720,menubar=no,toolbar=no,status=no'
    );
    if (!popup) {
      reject(new Error('Popup window was blocked by browser. Allow popups for this site and retry.'));
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', onMessage);
        reject(new Error('OAuth authorization timed out before completion.'));
      }
    }, 180000);

    const pollClosed = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        clearTimeout(timeout);
        clearInterval(pollClosed);
        window.removeEventListener('message', onMessage);
        reject(new Error('Authorization window closed before completion.'));
      }
    }, 600);

    function onMessage(ev: MessageEvent) {
      const d = ev.data;
      if (!d || d.integrationId !== integrationId) return;
      if (d.type === 'UNIVERSAL_OAUTH_SUCCESS') {
        settled = true;
        clearTimeout(timeout);
        clearInterval(pollClosed);
        window.removeEventListener('message', onMessage);
        resolve({ message: d.message || 'Authorized and verified.' });
      } else if (d.type === 'UNIVERSAL_OAUTH_ERROR') {
        settled = true;
        clearTimeout(timeout);
        clearInterval(pollClosed);
        window.removeEventListener('message', onMessage);
        reject(new Error(d.message || 'OAuth authorization failed.'));
      }
    }

    window.addEventListener('message', onMessage);
  });
}
