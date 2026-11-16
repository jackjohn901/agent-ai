import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { db, logSystemEvent } from './db.js';
import {
  ALLOWED_GEMINI_MODELS,
  getGeminiConfig,
  logGeminiUsage,
  resolveGeminiApiKey,
} from './geminiClient.js';
import {
  buildMcpAuthHeaders,
  callStreamableMcpTool,
  createPkceChallenge,
  discoverOAuthMetadataForUrl,
  probeAndDiscoverMcpTools,
  registerDynamicOAuthClient,
  validateMcpEndpointUrl,
} from './mcpGateway.js';
import { isSafePublicUrl } from './connectors.js';
import {
  deleteConnectorCredentials,
  getDecryptedCredential,
  getMaskedCredentialsForConnector,
  saveEncryptedCredential,
} from './secrets.js';
import type {
  CredentialFieldMeta,
  DiscoveredMcpTool,
  IntegrationAuthType,
  IntegrationKind,
  IntegrationUsageLog,
  LinkedInProductInfo,
  McpTransportType,
  UniversalIntegration,
  UniversalIntegrationReport,
  UniversalIntegrationStatus,
} from '../shared/types.js';

interface PendingOAuthState {
  integrationId: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
  useBasicAuth?: boolean;
  actorEmail: string;
  expiresAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();

function cleanExpiredOAuthStates() {
  const now = Date.now();
  for (const [k, v] of pendingOAuthStates.entries()) {
    if (v.expiresAt < now) pendingOAuthStates.delete(k);
  }
}

export function getAppBaseUrl(reqOrigin?: string): string {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl) return envUrl;
  if (reqOrigin) return reqOrigin.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

export function getLinkedInProductsStatus(approvedList: string[] = []): LinkedInProductInfo[] {
  const approvedSet = new Set(approvedList);
  return [
    {
      id: 'openid_connect',
      name: 'Sign In with LinkedIn using OpenID Connect',
      scope: 'openid profile email',
      approved: approvedSet.has('openid_connect'),
      requires_partner_approval: false,
      capabilities: 'Verify authorized LinkedIn account identity & basic member profile.',
      limitation_note: 'Does NOT grant access to search public member posts or send cold DMs.',
    },
    {
      id: 'share_on_linkedin',
      name: 'Share on LinkedIn',
      scope: 'w_member_social',
      approved: approvedSet.has('share_on_linkedin'),
      requires_partner_approval: false,
      capabilities: 'Publish posts on behalf of the authorized member.',
      limitation_note: 'Publishing-only scope; cannot read other users’ feeds or emails.',
    },
    {
      id: 'advertising_api',
      name: 'LinkedIn Advertising API',
      scope: 'r_ads r_ads_reporting',
      approved: approvedSet.has('advertising_api'),
      requires_partner_approval: true,
      capabilities: 'Read ad accounts and campaign performance metrics.',
      limitation_note: 'Requires LinkedIn Marketing Developer Platform approval.',
    },
    {
      id: 'community_management',
      name: 'Community Management API',
      scope: 'r_organization_social',
      approved: approvedSet.has('community_management'),
      requires_partner_approval: true,
      capabilities: 'Read & moderate posts on LinkedIn Company Pages you manage.',
      limitation_note: 'Requires restricted LinkedIn Community Management partner review.',
    },
    {
      id: 'lead_sync',
      name: 'Lead Sync API',
      scope: 'r_marketing_leadgen_automation',
      approved: approvedSet.has('lead_sync'),
      requires_partner_approval: true,
      capabilities: 'Sync incoming LinkedIn Lead Gen Form submissions into AI Buyer Hunter.',
      limitation_note: 'Requires approved LinkedIn Lead Sync Partner product access.',
    },
  ];
}

function getAllCredentialKeysForRow(row: any, fields: CredentialFieldMeta[]): string[] {
  const keys = new Set<string>(fields.map((f) => f.key));
  for (const k of ['client_id', 'client_secret', 'bearer_token', 'api_key', 'access_token', 'refresh_token', 'custom_headers_json', 'user_agent']) {
    keys.add(k);
  }
  return Array.from(keys);
}

function mapUniversalRow(row: any, appBaseUrl = getAppBaseUrl()): UniversalIntegration {
  const credentialFields: CredentialFieldMeta[] = JSON.parse(row.credential_fields_json || '[]');
  const keysToMask = getAllCredentialKeysForRow(row, credentialFields);
  const maskedMap = getMaskedCredentialsForConnector(row.id, keysToMask);

  const oauthRaw = JSON.parse(row.oauth_config_json || '{}');
  const configRaw = JSON.parse(row.config_json || '{}');

  if (row.id === 'gemini_api') {
    const geminiCfg = getGeminiConfig();
    Object.assign(configRaw, geminiCfg);
  }
  if (row.id === 'linkedin_api') {
    configRaw.products_matrix = getLinkedInProductsStatus(
      Array.isArray(configRaw.approved_products) ? configRaw.approved_products : ['openid_connect']
    );
  }

  const redirectPath = oauthRaw.redirect_path || `/api/universal-integrations/oauth/${row.id}/callback`;
  const redirectUri = `${appBaseUrl}${redirectPath}`;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    is_builtin: Boolean(row.is_builtin),
    category: row.category,
    description: row.description,
    endpoint_url: row.endpoint_url,
    transport_type: row.transport_type || null,
    auth_type: row.auth_type,
    status: row.status,
    is_enabled: Boolean(row.is_enabled),
    tools: JSON.parse(row.tools_json || '[]'),
    config: configRaw,
    oauth_config: {
      authorize_url: oauthRaw.authorize_url || '',
      token_url: oauthRaw.token_url || '',
      scopes: oauthRaw.scopes || '',
      redirect_uri: redirectUri,
      client_id_configured: Boolean(maskedMap.client_id?.configured),
      client_secret_configured: Boolean(maskedMap.client_secret?.configured),
      access_token_configured: Boolean(maskedMap.access_token?.configured || maskedMap.bearer_token?.configured),
      token_expires_at: oauthRaw.token_expires_at || null,
      auto_discovered: Boolean(oauthRaw.auto_discovered),
    },
    credential_fields: credentialFields.map((f) => ({
      ...f,
      configured: maskedMap[f.key]?.configured ?? false,
      masked: maskedMap[f.key]?.masked ?? '',
      updated_at: maskedMap[f.key]?.updated_at ?? null,
    })),
    capabilities_summary: JSON.parse(row.capabilities_summary_json || '[]'),
    limitations_note: row.limitations_note || null,
    rate_limit_info: row.rate_limit_info || '',
    api_calls_count: Number(row.api_calls_count || 0),
    credits_used: Number(row.credits_used || 0),
    last_tested_at: row.last_tested_at || null,
    last_error: row.last_error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listUniversalIntegrations(appBaseUrl?: string): UniversalIntegration[] {
  const rows = db
    .prepare('SELECT * FROM universal_integrations ORDER BY is_builtin DESC, kind ASC, name ASC')
    .all() as any[];
  return rows.map((r) => mapUniversalRow(r, appBaseUrl || getAppBaseUrl()));
}

export function getUniversalIntegration(id: string, appBaseUrl?: string): UniversalIntegration | null {
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!row) return null;
  return mapUniversalRow(row, appBaseUrl || getAppBaseUrl());
}

function logIntegrationUsage(params: {
  integrationId: string;
  action: string;
  toolName?: string | null;
  status: 'SUCCESS' | 'ERROR' | 'BLOCKED';
  creditsConsumed?: number;
  tokensUsed?: number;
  latencyMs?: number;
  details: string;
  errorMessage?: string | null;
}) {
  try {
    db.prepare(
      `INSERT INTO integration_usage_logs (
        integration_id, action, tool_name, status, credits_consumed, tokens_used, latency_ms, details, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.integrationId,
      params.action,
      params.toolName || null,
      params.status,
      Math.max(0, Number(params.creditsConsumed || 0)),
      Math.max(0, Number(params.tokensUsed || 0)),
      Math.max(0, Math.round(params.latencyMs || 0)),
      params.details,
      params.errorMessage || null
    );
    db.prepare(
      `UPDATE universal_integrations
       SET api_calls_count = api_calls_count + 1,
           credits_used = credits_used + ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(Math.max(0, Number(params.creditsConsumed || 0)), params.integrationId);
  } catch {
    // ignore logging failure
  }
}

export function createCustomUniversalIntegration(params: {
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
  actorEmail: string;
}): UniversalIntegration {
  const cleanName = String(params.name || '').trim();
  if (!cleanName) throw new Error('Integration name is required.');

  const urlCheck = validateMcpEndpointUrl(params.endpoint_url);
  if (!urlCheck.valid || !urlCheck.normalized) {
    throw new Error(urlCheck.error || 'Endpoint URL must be a valid public http(s) URL.');
  }

  const slugBase = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  const suffix = crypto.randomBytes(3).toString('hex');
  const slug = `${slugBase || 'custom'}-${suffix}`;
  const id = `custom_${slug.replace(/-/g, '_')}`;

  const kind: IntegrationKind = params.kind === 'API' ? 'API' : 'MCP';
  const transport: McpTransportType | null =
    kind === 'MCP' ? (params.transport_type === 'sse' ? 'sse' : 'streamable_http') : null;
  const authType: IntegrationAuthType = ['none', 'bearer', 'api_key', 'oauth2', 'custom_headers'].includes(
    params.auth_type
  )
    ? params.auth_type
    : 'none';

  const credFields: CredentialFieldMeta[] = [];
  if (authType === 'bearer') {
    credFields.push({ key: 'bearer_token', label: 'Bearer Token', type: 'secret', placeholder: 'Enter Bearer token', required: true });
  } else if (authType === 'api_key') {
    credFields.push({ key: 'api_key', label: `API Key (${params.api_key_header || 'X-API-Key'})`, type: 'secret', placeholder: 'Enter API Key', required: true });
  } else if (authType === 'oauth2') {
    credFields.push(
      { key: 'client_id', label: 'OAuth Client ID', type: 'text', placeholder: 'Optional if server supports dynamic registration', required: false },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'secret', placeholder: 'Optional OAuth Client Secret', required: false },
      { key: 'bearer_token', label: 'Direct Access / Bearer Token (Optional)', type: 'secret', placeholder: 'Populated via OAuth flow or pasted directly', required: false }
    );
  } else if (authType === 'custom_headers') {
    credFields.push({ key: 'custom_headers_json', label: 'Custom Headers JSON', type: 'secret', placeholder: '{"X-Tenant-Id": "...", "X-Token": "..."}', required: true });
  }

  const oauthCfg =
    authType === 'oauth2'
      ? {
          authorize_url: (params.oauth_authorize_url || '').trim(),
          token_url: (params.oauth_token_url || '').trim(),
          scopes: (params.oauth_scopes || 'mcp:tools').trim(),
          redirect_path: `/api/universal-integrations/oauth/${id}/callback`,
        }
      : {};

  const configObj = {
    api_key_header: (params.api_key_header || 'X-API-Key').trim(),
  };

  db.prepare(
    `INSERT INTO universal_integrations (
      id, name, slug, kind, is_builtin, category, description, endpoint_url,
      transport_type, auth_type, status, is_enabled, tools_json, config_json,
      oauth_config_json, credential_fields_json, capabilities_summary_json, rate_limit_info
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'NOT_CONFIGURED', 1, '[]', ?, ?, ?, ?, ?)`
  ).run(
    id,
    cleanName,
    slug,
    kind,
    String(params.category || (kind === 'MCP' ? 'Custom MCP Server' : 'Custom REST API')).trim(),
    String(params.description || `Custom ${kind} connector`).trim(),
    urlCheck.normalized,
    transport,
    authType,
    JSON.stringify(configObj),
    JSON.stringify(oauthCfg),
    JSON.stringify(credFields),
    JSON.stringify([
      kind === 'MCP'
        ? `Remote ${transport === 'sse' ? 'SSE' : 'Streamable HTTP'} MCP server`
        : 'Custom REST API integration',
      `Auth: ${authType}`,
    ]),
    String(params.rate_limit_info || 'Custom endpoint limits apply').trim()
  );

  if (params.credentials && typeof params.credentials === 'object') {
    for (const [k, v] of Object.entries(params.credentials)) {
      if (v && String(v).trim()) {
        saveEncryptedCredential(id, k, String(v), params.actorEmail);
      }
    }
  }

  logSystemEvent('AUDIT', params.actorEmail, 'CUSTOM_INTEGRATION_CREATED', `Added custom ${kind} integration "${cleanName}" (${urlCheck.normalized})`);
  return getUniversalIntegration(id)!;
}

export function updateUniversalIntegrationConfig(
  id: string,
  patch: {
    name?: string;
    description?: string;
    endpoint_url?: string;
    transport_type?: McpTransportType;
    auth_type?: IntegrationAuthType;
    config?: Record<string, any>;
    oauth_config?: Record<string, any>;
  },
  actorEmail: string
): UniversalIntegration {
  const existing = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!existing) throw new Error('Integration not found.');

  let endpoint = existing.endpoint_url;
  if (patch.endpoint_url !== undefined) {
    const check = validateMcpEndpointUrl(patch.endpoint_url);
    if (!check.valid || !check.normalized) {
      throw new Error(check.error || 'Invalid endpoint URL');
    }
    endpoint = check.normalized;
  }

  const currentConfig = JSON.parse(existing.config_json || '{}');
  let nextConfig = { ...currentConfig, ...(patch.config || {}) };

  if (id === 'gemini_api') {
    const nextModel = nextConfig.active_model;
    if (nextModel && !ALLOWED_GEMINI_MODELS.includes(nextModel)) {
      throw new Error(`Unsupported Gemini model "${nextModel}". Choose one of: ${ALLOWED_GEMINI_MODELS.join(', ')}`);
    }
    if (nextConfig.thinking_level && !['LOW', 'MEDIUM', 'HIGH'].includes(nextConfig.thinking_level)) {
      nextConfig.thinking_level = 'MEDIUM';
    }
    // Sync tool enabled state with tools_json if tools map updated
    if (patch.config?.tools && typeof patch.config.tools === 'object') {
      const existingTools: DiscoveredMcpTool[] = JSON.parse(existing.tools_json || '[]');
      const syncedTools = existingTools.map((t) =>
        patch.config!.tools[t.name] !== undefined
          ? { ...t, enabled: Boolean(patch.config!.tools[t.name]) }
          : t
      );
      db.prepare('UPDATE universal_integrations SET tools_json = ? WHERE id = ?').run(JSON.stringify(syncedTools), id);
    }
  }

  const currentOAuth = JSON.parse(existing.oauth_config_json || '{}');
  const nextOAuth = { ...currentOAuth, ...(patch.oauth_config || {}) };

  db.prepare(
    `UPDATE universal_integrations
     SET name = ?,
         description = ?,
         endpoint_url = ?,
         transport_type = ?,
         auth_type = ?,
         config_json = ?,
         oauth_config_json = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    patch.name ? String(patch.name).trim() : existing.name,
    patch.description !== undefined ? String(patch.description).trim() : existing.description,
    endpoint,
    patch.transport_type || existing.transport_type,
    patch.auth_type || existing.auth_type,
    JSON.stringify(nextConfig),
    JSON.stringify(nextOAuth),
    id
  );

  // If Reddit commercial approval was toggled off, immediately enforce compliance status on both tables
  if (id === 'reddit_api' && patch.config && patch.config.commercial_approved !== undefined) {
    if (!patch.config.commercial_approved) {
      db.prepare("UPDATE universal_integrations SET status = 'AWAITING_APPROVAL' WHERE id = 'reddit_api' AND status = 'CONNECTED'").run();
      db.prepare("UPDATE platforms SET status = 'APPROVAL_REQUIRED', last_error = 'Commercial Reddit Data API approval pending' WHERE id = 'reddit_api'").run();
    } else {
      // Allow re-test or keep AWAITING_APPROVAL/NOT_CONFIGURED until tested
      db.prepare("UPDATE universal_integrations SET status = CASE WHEN status = 'AWAITING_APPROVAL' THEN 'NOT_CONFIGURED' ELSE status END WHERE id = 'reddit_api'").run();
    }
  }

  logSystemEvent('AUDIT', actorEmail, 'INTEGRATION_CONFIG_UPDATED', `Updated config for ${id}`);
  return getUniversalIntegration(id)!;
}

export function saveUniversalCredentials(
  id: string,
  credentials: Record<string, string>,
  actorEmail: string
): UniversalIntegration {
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!row) throw new Error('Integration not found.');

  let savedCount = 0;
  for (const [key, rawVal] of Object.entries(credentials || {})) {
    if (rawVal === undefined || rawVal === null) continue;
    const val = String(rawVal).trim();
    if (!val) continue;
    if (key === 'custom_headers_json') {
      try {
        const parsed = JSON.parse(val);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Custom headers must be a JSON object.');
        }
      } catch (e: any) {
        throw new Error(`Invalid Custom Headers JSON: ${e?.message || 'parse error'}`);
      }
    }
    saveEncryptedCredential(id, key, val, actorEmail);
    savedCount += 1;
  }

  if (savedCount === 0) {
    throw new Error('Enter at least one credential field value to save.');
  }

  db.prepare(
    "UPDATE universal_integrations SET status = 'NOT_CONFIGURED', last_error = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  // Keep legacy reddit_api platform credentials in sync automatically
  if (id === 'reddit_api') {
    db.prepare("UPDATE platforms SET status = 'UNTESTED', last_error = NULL WHERE id = 'reddit_api'").run();
  }

  logSystemEvent('AUDIT', actorEmail, 'UNIVERSAL_CREDS_SAVED', `Saved ${savedCount} encrypted credential field(s) for ${id}`);
  return getUniversalIntegration(id)!;
}

export function clearUniversalCredentials(id: string, actorEmail: string): UniversalIntegration {
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!row) throw new Error('Integration not found.');
  deleteConnectorCredentials(id);
  db.prepare(
    "UPDATE universal_integrations SET status = 'NOT_CONFIGURED', last_error = NULL, last_tested_at = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(id);
  if (id === 'reddit_api') {
    db.prepare("UPDATE platforms SET status = 'MISSING_CREDENTIALS', last_error = NULL WHERE id = 'reddit_api'").run();
  }
  logSystemEvent('AUDIT', actorEmail, 'UNIVERSAL_CREDS_CLEARED', `Cleared stored credentials for ${id}`);
  return getUniversalIntegration(id)!;
}

export function toggleUniversalIntegration(id: string, isEnabled: boolean, actorEmail: string): UniversalIntegration {
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!row) throw new Error('Integration not found.');
  const nextStatus: UniversalIntegrationStatus = !isEnabled
    ? 'DISABLED'
    : row.status === 'DISABLED'
    ? 'NOT_CONFIGURED'
    : row.status;

  db.prepare(
    "UPDATE universal_integrations SET is_enabled = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(isEnabled ? 1 : 0, nextStatus, id);

  if (id === 'reddit_api') {
    db.prepare('UPDATE platforms SET is_enabled = ? WHERE id = ?').run(isEnabled ? 1 : 0, 'reddit_api');
  }

  logSystemEvent('AUDIT', actorEmail, 'UNIVERSAL_INTEGRATION_TOGGLED', `${id} is_enabled=${isEnabled}`);
  return getUniversalIntegration(id)!;
}

export function toggleUniversalTool(
  id: string,
  toolName: string,
  enabled: boolean,
  actorEmail: string
): UniversalIntegration {
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!row) throw new Error('Integration not found.');

  const tools: DiscoveredMcpTool[] = JSON.parse(row.tools_json || '[]');
  const idx = tools.findIndex((t) => t.name === toolName);
  if (idx === -1) throw new Error(`Tool "${toolName}" not found on ${id}.`);

  tools[idx] = { ...tools[idx], enabled: Boolean(enabled) };
  db.prepare("UPDATE universal_integrations SET tools_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(tools),
    id
  );

  // Sync Gemini tools map if gemini_api
  if (id === 'gemini_api') {
    const cfg = JSON.parse(row.config_json || '{}');
    cfg.tools = { ...(cfg.tools || {}), [toolName]: Boolean(enabled) };
    db.prepare('UPDATE universal_integrations SET config_json = ? WHERE id = ?').run(JSON.stringify(cfg), id);
  }

  logSystemEvent('AUDIT', actorEmail, 'INTEGRATION_TOOL_TOGGLED', `${id}.${toolName} enabled=${enabled}`);
  return getUniversalIntegration(id)!;
}

export function deleteUniversalIntegration(id: string, actorEmail: string) {
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!row) throw new Error('Integration not found.');
  if (row.is_builtin) {
    throw new Error('Built-in integrations cannot be deleted. You can disable or disconnect them instead.');
  }
  deleteConnectorCredentials(id);
  db.prepare('DELETE FROM integration_usage_logs WHERE integration_id = ?').run(id);
  db.prepare('DELETE FROM universal_integrations WHERE id = ?').run(id);
  logSystemEvent('AUDIT', actorEmail, 'CUSTOM_INTEGRATION_DELETED', `Deleted custom integration ${row.name} (${id})`);
}

function resolveMcpAuthConfig(row: any) {
  const cfg = JSON.parse(row.config_json || '{}');
  const bearerToken = getDecryptedCredential(row.id, 'bearer_token') || getDecryptedCredential(row.id, 'access_token');
  const apiKey = getDecryptedCredential(row.id, 'api_key');
  const customHeadersRaw = getDecryptedCredential(row.id, 'custom_headers_json');
  let customHeaders: Record<string, string> | null = null;
  if (customHeadersRaw) {
    try {
      customHeaders = JSON.parse(customHeadersRaw);
    } catch {
      customHeaders = null;
    }
  }
  return {
    authType: (row.auth_type || 'none') as IntegrationAuthType,
    bearerToken,
    apiKey,
    apiKeyHeader: cfg.api_key_header || 'X-API-Key',
    customHeaders,
  };
}

export async function testUniversalIntegration(id: string, actorEmail = 'system'): Promise<{
  ok: boolean;
  status: UniversalIntegrationStatus;
  message: string;
  integration: UniversalIntegration;
}> {
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(id) as any;
  if (!row) throw new Error('Integration not found.');

  if (!row.is_enabled) {
    return {
      ok: false,
      status: 'DISABLED',
      message: 'Integration is disabled. Enable it before testing.',
      integration: getUniversalIntegration(id)!,
    };
  }

  const start = Date.now();
  const finish = (
    ok: boolean,
    status: UniversalIntegrationStatus,
    message: string,
    extra?: { tools?: DiscoveredMcpTool[]; oauthPatch?: Record<string, any>; limitationsNote?: string | null; tokensUsed?: number }
  ) => {
    const toolsJson = extra?.tools ? JSON.stringify(extra.tools) : row.tools_json;
    let nextOAuthJson = row.oauth_config_json;
    if (extra?.oauthPatch) {
      const merged = { ...JSON.parse(row.oauth_config_json || '{}'), ...extra.oauthPatch };
      nextOAuthJson = JSON.stringify(merged);
    }

    db.prepare(
      `UPDATE universal_integrations
       SET status = ?,
           tools_json = ?,
           oauth_config_json = ?,
           limitations_note = COALESCE(?, limitations_note),
           last_tested_at = datetime('now'),
           last_error = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      status,
      toolsJson,
      nextOAuthJson,
      extra?.limitationsNote !== undefined ? extra.limitationsNote : null,
      ok ? null : message,
      id
    );

    logIntegrationUsage({
      integrationId: id,
      action: 'TEST_CONNECTION',
      status: ok ? 'SUCCESS' : 'ERROR',
      tokensUsed: extra?.tokensUsed || 0,
      latencyMs: Date.now() - start,
      details: message,
      errorMessage: ok ? null : message,
    });

    logSystemEvent('AUDIT', actorEmail, 'INTEGRATION_TESTED', `${id} -> ${status}: ${message}`);
    return {
      ok,
      status,
      message,
      integration: getUniversalIntegration(id)!,
    };
  };

  try {
    // A. ALL MCP CONNECTORS (Apollo MCP, Fiverr MCP, and Custom MCP Servers)
    if (row.kind === 'MCP') {
      const authConfig = resolveMcpAuthConfig(row);
      const probe = await probeAndDiscoverMcpTools({
        endpointUrl: row.endpoint_url,
        transportType: (row.transport_type || 'streamable_http') as McpTransportType,
        authConfig,
      });

      const existingTools: DiscoveredMcpTool[] = JSON.parse(row.tools_json || '[]');
      const existingEnabledMap = new Map(existingTools.map((t) => [t.name, t.enabled]));
      const mergedTools: DiscoveredMcpTool[] =
        probe.tools.length > 0
          ? probe.tools.map((t) => ({
              ...t,
              enabled: existingEnabledMap.has(t.name) ? Boolean(existingEnabledMap.get(t.name)) : true,
            }))
          : existingTools;

      const oauthPatch: Record<string, any> | undefined = probe.oauth_metadata
        ? {
            authorize_url: probe.oauth_metadata.authorization_endpoint || JSON.parse(row.oauth_config_json || '{}').authorize_url || '',
            token_url: probe.oauth_metadata.token_endpoint || JSON.parse(row.oauth_config_json || '{}').token_url || '',
            registration_endpoint: probe.oauth_metadata.registration_endpoint || '',
            scopes: probe.oauth_metadata.scopes_supported?.join(' ') || JSON.parse(row.oauth_config_json || '{}').scopes || 'mcp:tools',
            auto_discovered: Boolean(probe.oauth_metadata.authorization_endpoint),
          }
        : undefined;

      // For Fiverr MCP specifically, never misclaim buyer-request capability if live tools don't have one
      let limitationNote = probe.limitation_detected || undefined;
      if (id === 'fiverr_mcp' && probe.ok) {
        const hasBuyerRequestTool = mergedTools.some((t) => /buyer.*request|brief|job_post/i.test(`${t.name} ${t.description}`));
        if (!hasBuyerRequestTool) {
          limitationNote =
            'Live tools discovered only cover freelancer/service research; buyer-request search is not exposed by Fiverr MCP. Use Manual Intake or Custom API fallback for buyer briefs.';
        }
      }

      return finish(probe.ok, probe.status, probe.message, {
        tools: mergedTools,
        oauthPatch,
        limitationsNote: limitationNote,
      });
    }

    // B. GOOGLE GEMINI API
    if (id === 'gemini_api') {
      const { apiKey, source } = resolveGeminiApiKey();
      if (!apiKey || source === 'none') {
        return finish(false, 'NOT_CONFIGURED', 'No Gemini API key saved and server GEMINI_API_KEY fallback is not available.');
      }
      const cfg = getGeminiConfig();
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const res = await ai.models.generateContent({
        model: cfg.active_model,
        contents: 'Connection health check. Reply strictly with: OK',
      });
      if (!res.text) {
        return finish(false, 'ERROR', `Gemini model ${cfg.active_model} returned an empty response.`);
      }
      const tokens = Number((res as any)?.usageMetadata?.totalTokenCount || 0);
      return finish(
        true,
        'CONNECTED',
        `Google Gemini API verified (${cfg.active_model} via ${source === 'saved_override' ? 'encrypted override key' : 'server environment secret'}).`,
        { tokensUsed: tokens }
      );
    }

    // C. REDDIT API (with mandatory Commercial License Approval gate)
    if (id === 'reddit_api') {
      const cfg = JSON.parse(row.config_json || '{}');
      const clientId = getDecryptedCredential('reddit_api', 'client_id');
      const clientSecret = getDecryptedCredential('reddit_api', 'client_secret');
      const userAgent =
        getDecryptedCredential('reddit_api', 'user_agent') || 'web:ai-buyer-hunter:v1.0 (by /u/aibuyerhunter)';
      const userAccessToken = getDecryptedCredential('reddit_api', 'access_token') || getDecryptedCredential('reddit_api', 'bearer_token');

      if (!clientId || !clientSecret) {
        if (!cfg.commercial_approved) {
          db.prepare("UPDATE platforms SET status = 'APPROVAL_REQUIRED', last_checked_at = datetime('now'), last_error = ? WHERE id = 'reddit_api'").run(
            'Reddit Client ID, Client Secret, and Commercial License Approval required.'
          );
          return finish(false, 'AWAITING_APPROVAL', 'Configure Reddit Client ID & Secret, authorize via OAuth 2.0, and confirm Reddit Commercial Data API Approval.');
        }
        return finish(false, 'NOT_CONFIGURED', 'Reddit Client ID and Client Secret are required.');
      }

      let tokenToUse = userAccessToken;
      if (!tokenToUse) {
        const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${creds}`,
            'User-Agent': userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });
        if (!tokenRes.ok) {
          const msg = `Reddit OAuth token request failed (HTTP ${tokenRes.status}). Check Client ID & Secret.`;
          db.prepare("UPDATE platforms SET status = 'ERROR', last_checked_at = datetime('now'), last_error = ? WHERE id = 'reddit_api'").run(msg);
          return finish(false, 'ERROR', msg);
        }
        const tj = (await tokenRes.json()) as any;
        if (!tj?.access_token) {
          const msg = tj?.error || 'Reddit OAuth did not return an access token.';
          db.prepare("UPDATE platforms SET status = 'ERROR', last_checked_at = datetime('now'), last_error = ? WHERE id = 'reddit_api'").run(msg);
          return finish(false, 'ERROR', msg);
        }
        tokenToUse = tj.access_token;
      }

      const apiRes = await fetch('https://oauth.reddit.com/r/forhire/search?q=website&restrict_sr=1&sort=new&limit=1', {
        headers: { Authorization: `Bearer ${tokenToUse}`, 'User-Agent': userAgent },
      });
      if (apiRes.status === 401) {
        const msg = 'Reddit OAuth token rejected or expired (HTTP 401). Re-authorize Reddit OAuth.';
        db.prepare("UPDATE platforms SET status = 'ERROR', last_checked_at = datetime('now'), last_error = ? WHERE id = 'reddit_api'").run(msg);
        return finish(false, 'EXPIRED', msg);
      }
      if (!apiRes.ok) {
        const msg = `Reddit OAuth API returned HTTP ${apiRes.status}`;
        db.prepare("UPDATE platforms SET status = 'ERROR', last_checked_at = datetime('now'), last_error = ? WHERE id = 'reddit_api'").run(msg);
        return finish(false, 'ERROR', msg);
      }

      if (!cfg.commercial_approved) {
        const msg = 'Reddit OAuth API connection works, but Commercial API Data Approval has NOT been confirmed yet. Lead collection remains blocked until approved.';
        db.prepare("UPDATE platforms SET status = 'APPROVAL_REQUIRED', last_checked_at = datetime('now'), last_error = ? WHERE id = 'reddit_api'").run(msg);
        return finish(false, 'AWAITING_APPROVAL', msg);
      }

      const msg = 'Reddit OAuth API verified and Commercial License Approval confirmed. Ready for approved subreddit discovery.';
      db.prepare("UPDATE platforms SET status = 'READY', last_checked_at = datetime('now'), last_error = NULL WHERE id = 'reddit_api'").run();
      return finish(true, 'CONNECTED', msg);
    }

    // D. LINKEDIN API
    if (id === 'linkedin_api') {
      const token = getDecryptedCredential('linkedin_api', 'access_token') || getDecryptedCredential('linkedin_api', 'bearer_token');
      const clientId = getDecryptedCredential('linkedin_api', 'client_id');
      if (!token) {
        if (!clientId) {
          return finish(false, 'NOT_CONFIGURED', 'Configure LinkedIn Client ID & Client Secret, then click Authorize LinkedIn OAuth 2.0.');
        }
        return finish(false, 'PENDING_AUTH', 'LinkedIn App credentials saved. Click "Authorize via OAuth 2.0" to grant member consent.');
      }

      // Try OpenID Connect /v2/userinfo first (standard approved product), fallback to /v2/me
      let profileName = '';
      let res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const u = (await res.json()) as any;
        profileName = u?.name || u?.email || u?.sub || 'Authorized LinkedIn Member';
      } else if (res.status === 401) {
        return finish(false, 'EXPIRED', 'LinkedIn OAuth access token expired or revoked (HTTP 401). Re-authorize via OAuth 2.0.');
      } else {
        res = await fetch('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          return finish(false, 'ERROR', `LinkedIn API returned HTTP ${res.status}. Verify approved scopes & token.`);
        }
        const me = (await res.json()) as any;
        profileName = [me?.localizedFirstName, me?.localizedLastName].filter(Boolean).join(' ') || me?.id || 'Member';
      }

      return finish(true, 'CONNECTED', `LinkedIn OAuth verified for ${profileName} (strictly limited to approved LinkedIn Developer products).`);
    }

    // E. CUSTOM REST API CONNECTOR
    const authHeaders = buildMcpAuthHeaders(resolveMcpAuthConfig(row));
    if (!isSafePublicUrl(row.endpoint_url)) {
      return finish(false, 'ERROR', 'Endpoint URL failed SSRF public safety check.');
    }
    const res = await fetch(row.endpoint_url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'AIBuyerHunter/1.0', ...authHeaders },
    });
    if (res.status === 401 || res.status === 403) {
      return finish(false, 'PENDING_AUTH', `API endpoint returned HTTP ${res.status} — authorization/API key required or rejected.`);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return finish(false, 'ERROR', `API endpoint returned HTTP ${res.status}: ${txt.slice(0, 140)}`);
    }
    return finish(true, 'CONNECTED', `API endpoint verified (HTTP ${res.status}).`);
  } catch (err: any) {
    return finish(false, 'ERROR', err?.message || 'Integration test failed');
  }
}

export async function executeUniversalTool(params: {
  integrationId: string;
  toolName: string;
  args: Record<string, any>;
  actorEmail: string;
}): Promise<{ ok: boolean; output: any; credits_consumed: number; latency_ms: number; error?: string }> {
  const start = Date.now();
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(params.integrationId) as any;
  if (!row) throw new Error('Integration not found.');
  if (!row.is_enabled) {
    logIntegrationUsage({
      integrationId: params.integrationId,
      action: 'TOOL_CALL',
      toolName: params.toolName,
      status: 'BLOCKED',
      details: 'Integration disabled',
      errorMessage: 'Integration is currently disabled.',
    });
    return { ok: false, output: null, credits_consumed: 0, latency_ms: 0, error: 'Integration is currently disabled.' };
  }

  const tools: DiscoveredMcpTool[] = JSON.parse(row.tools_json || '[]');
  const toolDef = tools.find((t) => t.name === params.toolName);
  if (toolDef && !toolDef.enabled) {
    logIntegrationUsage({
      integrationId: params.integrationId,
      action: 'TOOL_CALL',
      toolName: params.toolName,
      status: 'BLOCKED',
      details: 'Tool disabled by Super Admin',
      errorMessage: `Tool "${params.toolName}" is disabled in integration permissions.`,
    });
    return {
      ok: false,
      output: null,
      credits_consumed: 0,
      latency_ms: 0,
      error: `Tool "${params.toolName}" is disabled in integration permissions.`,
    };
  }

  // MCP execution
  if (row.kind === 'MCP') {
    const authConfig = resolveMcpAuthConfig(row);
    const callRes = await callStreamableMcpTool({
      endpointUrl: row.endpoint_url,
      transportType: (row.transport_type || 'streamable_http') as McpTransportType,
      authConfig,
      toolName: params.toolName,
      args: params.args || {},
    });

    logIntegrationUsage({
      integrationId: params.integrationId,
      action: 'MCP_TOOL_CALL',
      toolName: params.toolName,
      status: callRes.ok ? 'SUCCESS' : 'ERROR',
      creditsConsumed: callRes.credits_consumed,
      latencyMs: callRes.latency_ms,
      details: callRes.ok ? `Executed MCP tool ${params.toolName}` : `MCP tool ${params.toolName} failed`,
      errorMessage: callRes.error || null,
    });

    return {
      ok: callRes.ok,
      output: callRes.result || null,
      credits_consumed: callRes.credits_consumed,
      latency_ms: callRes.latency_ms,
      error: callRes.error,
    };
  }

  // Built-in API tool execution
  if (row.id === 'gemini_api') {
    const { apiKey, source } = resolveGeminiApiKey();
    if (!apiKey || source === 'none') {
      return { ok: false, output: null, credits_consumed: 0, latency_ms: Date.now() - start, error: 'Gemini API key not configured.' };
    }
    const cfg = getGeminiConfig();
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const prompt = String(params.args?.prompt || `Test capability ${params.toolName}: confirm active status in one concise sentence.`);
    const res = await ai.models.generateContent({ model: cfg.active_model, contents: prompt });
    const tokens = Number((res as any)?.usageMetadata?.totalTokenCount || 0);
    const latency = Date.now() - start;
    logGeminiUsage({
      action: 'MANUAL_TOOL_TEST',
      toolName: params.toolName,
      status: 'SUCCESS',
      tokensUsed: tokens,
      latencyMs: latency,
      details: `Tested Gemini capability ${params.toolName} on ${cfg.active_model}`,
    });
    return {
      ok: true,
      output: { model: cfg.active_model, response: res.text, tokens_used: tokens },
      credits_consumed: 0,
      latency_ms: latency,
    };
  }

  if (row.id === 'reddit_api') {
    const cfg = JSON.parse(row.config_json || '{}');
    if (!cfg.commercial_approved) {
      logIntegrationUsage({
        integrationId: 'reddit_api',
        action: 'TOOL_CALL',
        toolName: params.toolName,
        status: 'BLOCKED',
        details: 'Blocked by Reddit commercial approval gate',
        errorMessage: 'Confirm Reddit Commercial Data API Approval before executing commercial collection tools.',
      });
      return {
        ok: false,
        output: null,
        credits_consumed: 0,
        latency_ms: Date.now() - start,
        error: 'Blocked: Reddit Commercial Data API Approval is not confirmed yet.',
      };
    }
  }

  if (row.id === 'linkedin_api') {
    const cfg = JSON.parse(row.config_json || '{}');
    const approved = new Set<string>(Array.isArray(cfg.approved_products) ? cfg.approved_products : ['openid_connect']);
    if (params.toolName === 'get_ad_lead_forms' && !approved.has('lead_sync')) {
      return {
        ok: false,
        output: null,
        credits_consumed: 0,
        latency_ms: 0,
        error: 'Blocked: LinkedIn Lead Sync API partner approval is still pending.',
      };
    }
    if (params.toolName === 'get_organization_posts' && !approved.has('community_management')) {
      return {
        ok: false,
        output: null,
        credits_consumed: 0,
        latency_ms: 0,
        error: 'Blocked: LinkedIn Community Management API partner approval is still pending.',
      };
    }
    const token = getDecryptedCredential('linkedin_api', 'access_token') || getDecryptedCredential('linkedin_api', 'bearer_token');
    if (!token) {
      return { ok: false, output: null, credits_consumed: 0, latency_ms: 0, error: 'LinkedIn OAuth token not authorized yet.' };
    }
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    const latency = Date.now() - start;
    logIntegrationUsage({
      integrationId: 'linkedin_api',
      action: 'TOOL_CALL',
      toolName: params.toolName,
      status: res.ok ? 'SUCCESS' : 'ERROR',
      latencyMs: latency,
      details: `Executed LinkedIn ${params.toolName}`,
      errorMessage: res.ok ? null : `HTTP ${res.status}`,
    });
    return {
      ok: res.ok,
      output: body,
      credits_consumed: 0,
      latency_ms: latency,
      error: res.ok ? undefined : `LinkedIn HTTP ${res.status}`,
    };
  }

  // Fallback for custom API HTTP probe
  const authHeaders = buildMcpAuthHeaders(resolveMcpAuthConfig(row));
  const res = await fetch(row.endpoint_url, {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeaders },
  });
  const text = await res.text();
  const latency = Date.now() - start;
  logIntegrationUsage({
    integrationId: params.integrationId,
    action: 'API_CALL',
    toolName: params.toolName,
    status: res.ok ? 'SUCCESS' : 'ERROR',
    latencyMs: latency,
    details: `Custom API GET ${row.endpoint_url} -> HTTP ${res.status}`,
    errorMessage: res.ok ? null : `HTTP ${res.status}`,
  });
  return {
    ok: res.ok,
    output: text.slice(0, 2000),
    credits_consumed: 0,
    latency_ms: latency,
    error: res.ok ? undefined : `HTTP ${res.status}`,
  };
}

export async function startUniversalOAuth(params: {
  integrationId: string;
  appBaseUrl: string;
  actorEmail: string;
}): Promise<{ authorize_url: string; redirect_uri: string }> {
  cleanExpiredOAuthStates();
  const row = db.prepare('SELECT * FROM universal_integrations WHERE id = ?').get(params.integrationId) as any;
  if (!row) throw new Error('Integration not found.');

  const oauthCfg = JSON.parse(row.oauth_config_json || '{}');
  const redirectPath = oauthCfg.redirect_path || `/api/universal-integrations/oauth/${row.id}/callback`;
  const redirectUri = `${params.appBaseUrl.replace(/\/+$/, '')}${redirectPath}`;

  let authorizeUrl = String(oauthCfg.authorize_url || '').trim();
  let tokenUrl = String(oauthCfg.token_url || '').trim();
  let scopes = String(oauthCfg.scopes || 'mcp:tools').trim();
  let regEndpoint = String(oauthCfg.registration_endpoint || '').trim();

  // Discover OAuth metadata automatically for MCP servers when authorize_url or token_url is missing
  if (row.kind === 'MCP' && (!authorizeUrl || !tokenUrl)) {
    const meta = await discoverOAuthMetadataForUrl(row.endpoint_url);
    authorizeUrl = authorizeUrl || meta.authorization_endpoint || '';
    tokenUrl = tokenUrl || meta.token_endpoint || '';
    regEndpoint = regEndpoint || meta.registration_endpoint || '';
    if (meta.scopes_supported?.length) {
      scopes = meta.scopes_supported.join(' ');
    }
    db.prepare('UPDATE universal_integrations SET oauth_config_json = ? WHERE id = ?').run(
      JSON.stringify({
        ...oauthCfg,
        authorize_url: authorizeUrl,
        token_url: tokenUrl,
        registration_endpoint: regEndpoint,
        scopes,
        auto_discovered: Boolean(authorizeUrl),
      }),
      row.id
    );
  }

  if (!authorizeUrl || !tokenUrl) {
    throw new Error(
      `OAuth 2.0 metadata is not configured or could not be auto-discovered for ${row.name}. Supply Client ID, Authorize URL & Token URL, or paste a direct Bearer token.`
    );
  }

  let clientId = getDecryptedCredential(row.id, 'client_id') || '';
  let clientSecret = getDecryptedCredential(row.id, 'client_secret') || '';

  // Support RFC 7591 Dynamic Client Registration for MCP servers (e.g. Apollo MCP) when client_id is empty
  if (!clientId && regEndpoint) {
    const registered = await registerDynamicOAuthClient(regEndpoint, redirectUri);
    if (registered?.client_id) {
      clientId = registered.client_id;
      saveEncryptedCredential(row.id, 'client_id', registered.client_id, params.actorEmail);
      if (registered.client_secret) {
        clientSecret = registered.client_secret;
        saveEncryptedCredential(row.id, 'client_secret', registered.client_secret, params.actorEmail);
      }
    }
  }

  if (!clientId) {
    throw new Error(`${row.name} requires an OAuth Client ID before opening the authorization popup.`);
  }

  const state = crypto.randomBytes(24).toString('hex');
  const { verifier, challenge } = createPkceChallenge();

  pendingOAuthStates.set(state, {
    integrationId: row.id,
    redirectUri,
    tokenUrl,
    clientId,
    clientSecret: clientSecret || undefined,
    codeVerifier: verifier,
    useBasicAuth: row.id === 'reddit_api',
    actorEmail: params.actorEmail,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  const url = new URL(authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  if (scopes) url.searchParams.set('scope', scopes);

  if (row.id === 'reddit_api') {
    url.searchParams.set('duration', 'permanent');
  } else if (row.kind === 'MCP') {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return { authorize_url: url.toString(), redirect_uri: redirectUri };
}

export async function completeUniversalOAuthCallback(params: {
  integrationId: string;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<{ ok: boolean; integrationId: string; message: string }> {
  cleanExpiredOAuthStates();
  if (params.error) {
    return {
      ok: false,
      integrationId: params.integrationId,
      message: params.errorDescription || params.error,
    };
  }
  if (!params.code || !params.state) {
    return { ok: false, integrationId: params.integrationId, message: 'Missing OAuth code or state parameter.' };
  }

  const pending = pendingOAuthStates.get(params.state);
  pendingOAuthStates.delete(params.state);
  if (!pending || pending.integrationId !== params.integrationId) {
    return { ok: false, integrationId: params.integrationId, message: 'OAuth session expired or invalid state.' };
  }

  try {
    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('code', params.code);
    form.set('redirect_uri', pending.redirectUri);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    if (pending.useBasicAuth && pending.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${pending.clientId}:${pending.clientSecret}`).toString('base64')}`;
      headers['User-Agent'] =
        getDecryptedCredential(params.integrationId, 'user_agent') || 'web:ai-buyer-hunter:v1.0 (by /u/aibuyerhunter)';
    } else {
      form.set('client_id', pending.clientId);
      if (pending.clientSecret) {
        form.set('client_secret', pending.clientSecret);
      } else {
        form.set('code_verifier', pending.codeVerifier);
      }
    }

    const tokenRes = await fetch(pending.tokenUrl, {
      method: 'POST',
      headers,
      body: form.toString(),
    });
    const tj = (await tokenRes.json().catch(() => ({}))) as any;
    if (!tokenRes.ok || !tj?.access_token) {
      const msg = tj?.error_description || tj?.error || `OAuth token exchange HTTP ${tokenRes.status}`;
      db.prepare("UPDATE universal_integrations SET status = 'ERROR', last_error = ? WHERE id = ?").run(
        msg,
        params.integrationId
      );
      return { ok: false, integrationId: params.integrationId, message: msg };
    }

    saveEncryptedCredential(params.integrationId, 'access_token', String(tj.access_token), pending.actorEmail);
    saveEncryptedCredential(params.integrationId, 'bearer_token', String(tj.access_token), pending.actorEmail);
    if (tj.refresh_token) {
      saveEncryptedCredential(params.integrationId, 'refresh_token', String(tj.refresh_token), pending.actorEmail);
    }

    const row = db.prepare('SELECT oauth_config_json FROM universal_integrations WHERE id = ?').get(params.integrationId) as any;
    const oauthCfg = JSON.parse(row?.oauth_config_json || '{}');
    if (tj.expires_in) {
      oauthCfg.token_expires_at = new Date(Date.now() + Number(tj.expires_in) * 1000).toISOString();
    }
    db.prepare('UPDATE universal_integrations SET oauth_config_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
      JSON.stringify(oauthCfg),
      params.integrationId
    );

    const testResult = await testUniversalIntegration(params.integrationId, pending.actorEmail);
    return {
      ok: testResult.ok || testResult.status === 'AWAITING_APPROVAL',
      integrationId: params.integrationId,
      message: testResult.message,
    };
  } catch (err: any) {
    return {
      ok: false,
      integrationId: params.integrationId,
      message: err?.message || 'OAuth callback exchange failed',
    };
  }
}

export function getUniversalIntegrationReport(appBaseUrl?: string): UniversalIntegrationReport {
  const integrations = listUniversalIntegrations(appBaseUrl);
  const logs = db
    .prepare(
      `SELECT l.*, ui.name as integration_name
       FROM integration_usage_logs l
       LEFT JOIN universal_integrations ui ON ui.id = l.integration_id
       ORDER BY l.id DESC
       LIMIT 80`
    )
    .all() as IntegrationUsageLog[];

  let totalTools = 0;
  let enabledTools = 0;
  let disabledTools = 0;

  for (const intg of integrations) {
    for (const tool of intg.tools) {
      totalTools += 1;
      if (tool.enabled && intg.is_enabled) enabledTools += 1;
      else disabledTools += 1;
    }
  }

  return {
    summary: {
      total_integrations: integrations.length,
      connected_mcp: integrations.filter((i) => i.kind === 'MCP' && i.status === 'CONNECTED').length,
      connected_api: integrations.filter((i) => i.kind === 'API' && i.status === 'CONNECTED').length,
      pending_authorization: integrations.filter((i) =>
        ['PENDING_AUTH', 'AWAITING_APPROVAL', 'NOT_CONFIGURED'].includes(i.status)
      ).length,
      failed_connections: integrations.filter((i) => ['ERROR', 'EXPIRED', 'UNSUPPORTED'].includes(i.status)).length,
      disabled_integrations: integrations.filter((i) => !i.is_enabled || i.status === 'DISABLED').length,
      total_available_tools: totalTools,
      enabled_tools: enabledTools,
      disabled_tools: disabledTools,
      total_api_calls: integrations.reduce((acc, i) => acc + i.api_calls_count, 0),
      total_credits_consumed: integrations.reduce((acc, i) => acc + i.credits_used, 0),
    },
    integrations,
    recent_logs: logs,
  };
}
