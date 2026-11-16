import crypto from 'crypto';
import type {
  DiscoveredMcpTool,
  IntegrationAuthType,
  McpTransportType,
  UniversalIntegrationStatus,
} from '../shared/types.js';
import { isSafePublicUrl } from './connectors.js';

export interface McpAuthHeadersConfig {
  authType: IntegrationAuthType;
  bearerToken?: string | null;
  apiKey?: string | null;
  apiKeyHeader?: string | null;
  customHeaders?: Record<string, string> | null;
}

export interface DiscoveredOAuthMetadata {
  resource_metadata_url?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface McpProbeResult {
  ok: boolean;
  status: UniversalIntegrationStatus;
  http_status?: number;
  message: string;
  server_info?: { name?: string; version?: string; protocolVersion?: string };
  tools: DiscoveredMcpTool[];
  requires_oauth?: boolean;
  oauth_metadata?: DiscoveredOAuthMetadata;
  limitation_detected?: string | null;
  latency_ms: number;
}

export function validateMcpEndpointUrl(rawUrl: string): { valid: boolean; error?: string; normalized?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { valid: false, error: 'MCP server URL is required.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'MCP server URL must use http:// or https://.' };
  }
  if (!isSafePublicUrl(trimmed)) {
    return { valid: false, error: 'Localhost, internal, and private network URLs are blocked for SSRF safety.' };
  }
  return { valid: true, normalized: parsed.toString() };
}

export function buildMcpAuthHeaders(cfg: McpAuthHeadersConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cfg.authType === 'bearer' || cfg.authType === 'oauth2') {
    if (cfg.bearerToken) {
      headers.Authorization = cfg.bearerToken.startsWith('Bearer ')
        ? cfg.bearerToken
        : `Bearer ${cfg.bearerToken}`;
    }
  } else if (cfg.authType === 'api_key' && cfg.apiKey) {
    const hdr = (cfg.apiKeyHeader || 'X-API-Key').trim();
    if (hdr.toLowerCase() === 'authorization') {
      headers.Authorization = cfg.apiKey;
    } else {
      headers[hdr] = cfg.apiKey;
    }
  }
  if (cfg.customHeaders && typeof cfg.customHeaders === 'object') {
    for (const [k, v] of Object.entries(cfg.customHeaders)) {
      const cleanKey = k.trim();
      if (cleanKey && v !== undefined && v !== null) {
        headers[cleanKey] = String(v);
      }
    }
  }
  return headers;
}

async function fetchTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonRpcPayload(rawBody: string, contentType: string | null): any {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;

  // Handle SSE-framed responses from Streamable HTTP endpoints
  if (
    (contentType && contentType.includes('text/event-stream')) ||
    /^event:\s*|^data:\s*/m.test(trimmed)
  ) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((chunk) => chunk && chunk !== '[DONE]');

    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(dataLines[i]);
        if (parsed && (parsed.result !== undefined || parsed.error !== undefined || parsed.jsonrpc)) {
          return parsed;
        }
      } catch {
        // try previous frame
      }
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isCloudflareOrHtmlChallenge(status: number, contentType: string | null, body: string): boolean {
  const lower = body.toLowerCase();
  if (contentType && contentType.includes('text/html')) {
    if (
      lower.includes('cloudflare') ||
      lower.includes('cf-browser-verification') ||
      lower.includes('just a moment') ||
      lower.includes('attention required') ||
      status === 403
    ) {
      return true;
    }
  }
  return false;
}

export async function discoverOAuthMetadataForUrl(
  endpointUrl: string,
  wwwAuthenticateHeader?: string | null
): Promise<DiscoveredOAuthMetadata> {
  const result: DiscoveredOAuthMetadata = {};
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    return result;
  }

  const origin = parsed.origin;
  const candidates: string[] = [];

  if (wwwAuthenticateHeader) {
    const m = wwwAuthenticateHeader.match(/resource_metadata=["']([^"']+)["']/i);
    if (m?.[1] && isSafePublicUrl(m[1])) {
      candidates.push(m[1]);
    }
  }
  candidates.push(`${origin}/.well-known/oauth-protected-resource`);
  candidates.push(`${origin}/.well-known/oauth-authorization-server`);

  const authServers: string[] = [];

  for (const url of candidates) {
    try {
      const res = await fetchTimeout(url, { headers: { Accept: 'application/json' } }, 7000);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const json = (await res.json()) as any;
      if (url.includes('oauth-protected-resource') || json?.resource_name || Array.isArray(json?.authorization_servers)) {
        result.resource_metadata_url = url;
        if (Array.isArray(json?.authorization_servers)) {
          for (const srv of json.authorization_servers) {
            if (typeof srv === 'string' && isSafePublicUrl(srv)) authServers.push(srv);
          }
        }
        if (Array.isArray(json?.scopes_supported)) {
          result.scopes_supported = json.scopes_supported;
        }
      }
      if (json?.authorization_endpoint) result.authorization_endpoint = json.authorization_endpoint;
      if (json?.token_endpoint) result.token_endpoint = json.token_endpoint;
      if (json?.registration_endpoint) result.registration_endpoint = json.registration_endpoint;
      if (Array.isArray(json?.scopes_supported) && !result.scopes_supported) {
        result.scopes_supported = json.scopes_supported;
      }
      if (Array.isArray(json?.code_challenge_methods_supported)) {
        result.code_challenge_methods_supported = json.code_challenge_methods_supported;
      }
    } catch {
      // probe next candidate
    }
  }

  for (const srv of authServers) {
    if (result.authorization_endpoint && result.token_endpoint) break;
    try {
      const srvUrl = new URL(srv);
      const asUrl = `${srvUrl.origin}/.well-known/oauth-authorization-server${srvUrl.pathname === '/' ? '' : srvUrl.pathname}`;
      const res = await fetchTimeout(asUrl, { headers: { Accept: 'application/json' } }, 7000);
      if (!res.ok) continue;
      const json = (await res.json()) as any;
      if (json?.authorization_endpoint) result.authorization_endpoint = json.authorization_endpoint;
      if (json?.token_endpoint) result.token_endpoint = json.token_endpoint;
      if (json?.registration_endpoint) result.registration_endpoint = json.registration_endpoint;
      if (Array.isArray(json?.scopes_supported)) result.scopes_supported = json.scopes_supported;
      if (Array.isArray(json?.code_challenge_methods_supported)) {
        result.code_challenge_methods_supported = json.code_challenge_methods_supported;
      }
    } catch {
      // try origin root
      try {
        const srvUrl = new URL(srv);
        const res = await fetchTimeout(`${srvUrl.origin}/.well-known/oauth-authorization-server`, { headers: { Accept: 'application/json' } }, 6000);
        if (res.ok) {
          const json = (await res.json()) as any;
          if (json?.authorization_endpoint) result.authorization_endpoint = json.authorization_endpoint;
          if (json?.token_endpoint) result.token_endpoint = json.token_endpoint;
          if (json?.registration_endpoint) result.registration_endpoint = json.registration_endpoint;
        }
      } catch {
        // ignore
      }
    }
  }

  return result;
}

export async function registerDynamicOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName = 'AI Buyer Hunter'
): Promise<{ client_id: string; client_secret?: string } | null> {
  if (!isSafePublicUrl(registrationEndpoint)) return null;
  try {
    const res = await fetchTimeout(
      registrationEndpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_name: clientName,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      },
      9000
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json?.client_id) {
      return {
        client_id: String(json.client_id),
        client_secret: json.client_secret ? String(json.client_secret) : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function probeAndDiscoverMcpTools(params: {
  endpointUrl: string;
  transportType: McpTransportType;
  authConfig: McpAuthHeadersConfig;
}): Promise<McpProbeResult> {
  const start = Date.now();
  const check = validateMcpEndpointUrl(params.endpointUrl);
  if (!check.valid || !check.normalized) {
    return {
      ok: false,
      status: 'ERROR',
      message: check.error || 'Invalid MCP server URL',
      tools: [],
      latency_ms: Date.now() - start,
    };
  }

  const endpoint = check.normalized;
  const authHeaders = buildMcpAuthHeaders(params.authConfig);

  if (params.transportType === 'sse') {
    return probeLegacySseMcp(endpoint, authHeaders, start);
  }

  return probeStreamableHttpMcp(endpoint, params.authConfig, authHeaders, start);
}

async function probeStreamableHttpMcp(
  endpoint: string,
  authConfig: McpAuthHeadersConfig,
  authHeaders: Record<string, string>,
  start: number
): Promise<McpProbeResult> {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'AIBuyerHunter-MCP-Client/1.0',
    ...authHeaders,
  };

  try {
    const initRes = await fetchTimeout(endpoint, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          clientInfo: { name: 'ai-buyer-hunter', version: '1.0.0' },
        },
      }),
    });

    const contentType = initRes.headers.get('content-type');
    const wwwAuth = initRes.headers.get('www-authenticate');
    const bodyText = await initRes.text();

    if (isCloudflareOrHtmlChallenge(initRes.status, contentType, bodyText)) {
      const oauthMeta = await discoverOAuthMetadataForUrl(endpoint, wwwAuth);
      const hasOAuth = Boolean(oauthMeta.authorization_endpoint);
      return {
        ok: false,
        status: hasOAuth ? 'PENDING_AUTH' : 'UNSUPPORTED',
        http_status: initRes.status,
        message: `Endpoint returned HTTP ${initRes.status} HTML/WAF protection challenge rather than MCP JSON-RPC. ${
          hasOAuth
            ? 'OAuth endpoints discovered, though direct server calls may require vendor approval.'
            : 'Direct server-side MCP calls are blocked by vendor firewall/WAF or require an authenticated API adapter.'
        }`,
        tools: [],
        requires_oauth: hasOAuth || initRes.status === 401,
        oauth_metadata: oauthMeta,
        limitation_detected: `HTTP ${initRes.status} WAF/HTML challenge prevents direct unauthenticated server MCP handshake.`,
        latency_ms: Date.now() - start,
      };
    }

    if (initRes.status === 401) {
      const oauthMeta = await discoverOAuthMetadataForUrl(endpoint, wwwAuth);
      const authMsg = oauthMeta.authorization_endpoint
        ? `MCP server requires OAuth 2.0 authorization (HTTP 401). Discovered authorization endpoint: ${oauthMeta.authorization_endpoint}.`
        : `MCP server requires authorization (HTTP 401)${authConfig.bearerToken ? ' — supplied token was rejected or expired' : ''}. Configure OAuth 2.0 or Bearer token and authorize.`;

      return {
        ok: false,
        status: authConfig.bearerToken ? 'EXPIRED' : 'PENDING_AUTH',
        http_status: 401,
        message: authMsg,
        tools: [],
        requires_oauth: true,
        oauth_metadata: oauthMeta,
        limitation_detected: authConfig.bearerToken ? 'Bearer/OAuth token expired or invalid (HTTP 401).' : null,
        latency_ms: Date.now() - start,
      };
    }

    if (!initRes.ok) {
      const parsedErr = parseJsonRpcPayload(bodyText, contentType);
      const errDetail = parsedErr?.error?.message || bodyText.slice(0, 220);
      return {
        ok: false,
        status: 'ERROR',
        http_status: initRes.status,
        message: `MCP handshake returned HTTP ${initRes.status}: ${errDetail || initRes.statusText}`,
        tools: [],
        latency_ms: Date.now() - start,
      };
    }

    const sessionId = initRes.headers.get('mcp-session-id') || initRes.headers.get('Mcp-Session-Id');
    const initJson = parseJsonRpcPayload(bodyText, contentType);
    if (!initJson || initJson.error) {
      return {
        ok: false,
        status: 'ERROR',
        http_status: initRes.status,
        message: initJson?.error?.message || 'MCP server did not return a valid JSON-RPC initialize result.',
        tools: [],
        latency_ms: Date.now() - start,
      };
    }

    const sessionHeaders: Record<string, string> = { ...baseHeaders };
    if (sessionId) {
      sessionHeaders['Mcp-Session-Id'] = sessionId;
    }

    // Send notifications/initialized (best effort per MCP spec)
    await fetchTimeout(
      endpoint,
      {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      },
      5000
    ).catch(() => {});

    // Call tools/list
    const toolsRes = await fetchTimeout(endpoint, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools-1',
        method: 'tools/list',
        params: {},
      }),
    });

    const toolsCt = toolsRes.headers.get('content-type');
    const toolsBody = await toolsRes.text();
    const toolsJson = parseJsonRpcPayload(toolsBody, toolsCt);

    if (!toolsRes.ok || toolsJson?.error) {
      return {
        ok: false,
        status: toolsRes.status === 401 ? 'PENDING_AUTH' : 'ERROR',
        http_status: toolsRes.status,
        message: toolsJson?.error?.message || `MCP tools/list returned HTTP ${toolsRes.status}`,
        tools: [],
        latency_ms: Date.now() - start,
      };
    }

    const rawTools = Array.isArray(toolsJson?.result?.tools) ? toolsJson.result.tools : [];
    const tools: DiscoveredMcpTool[] = rawTools.map((t: any) => ({
      name: String(t.name || 'unnamed_tool'),
      description: String(t.description || 'MCP server tool'),
      input_schema: t.inputSchema || t.input_schema || undefined,
      enabled: true,
      category: 'MCP Tool',
    }));

    return {
      ok: true,
      status: 'CONNECTED',
      http_status: toolsRes.status,
      server_info: {
        name: initJson?.result?.serverInfo?.name,
        version: initJson?.result?.serverInfo?.version,
        protocolVersion: initJson?.result?.protocolVersion,
      },
      tools,
      message: `Connected via Streamable HTTP (${initJson?.result?.serverInfo?.name || 'MCP Server'}). Discovered ${tools.length} tool(s).`,
      latency_ms: Date.now() - start,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 'ERROR',
      message: `MCP connection error: ${err?.message || 'Network or timeout error'}`,
      tools: [],
      latency_ms: Date.now() - start,
    };
  }
}

async function probeLegacySseMcp(
  endpoint: string,
  authHeaders: Record<string, string>,
  start: number
): Promise<McpProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 11000);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'User-Agent': 'AIBuyerHunter-MCP-Client/1.0',
        ...authHeaders,
      },
      signal: controller.signal,
    });

    if (res.status === 401) {
      const oauthMeta = await discoverOAuthMetadataForUrl(endpoint, res.headers.get('www-authenticate'));
      clearTimeout(timeout);
      return {
        ok: false,
        status: 'PENDING_AUTH',
        http_status: 401,
        message: 'SSE MCP server requires authorization (HTTP 401).',
        tools: [],
        requires_oauth: true,
        oauth_metadata: oauthMeta,
        latency_ms: Date.now() - start,
      };
    }

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      clearTimeout(timeout);
      return {
        ok: false,
        status: 'ERROR',
        http_status: res.status,
        message: `SSE endpoint HTTP ${res.status}: ${txt.slice(0, 180)}`,
        tools: [],
        latency_ms: Date.now() - start,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messagePostUrl: string | null = null;
    let initResult: any = null;
    let toolsListResult: any = null;
    let initSent = false;
    let toolsSent = false;

    while (!toolsListResult) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';

      for (const frame of frames) {
        const eventMatch = frame.match(/^event:\s*(.+)$/m);
        const dataLines = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');

        const eventName = eventMatch?.[1]?.trim() || 'message';

        if (eventName === 'endpoint' && dataLines && !messagePostUrl) {
          messagePostUrl = new URL(dataLines, endpoint).toString();
          if (!isSafePublicUrl(messagePostUrl)) {
            throw new Error('SSE endpoint advertised unsafe message URL.');
          }
          initSent = true;
          await fetchTimeout(messagePostUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'sse-init-1',
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                clientInfo: { name: 'ai-buyer-hunter', version: '1.0.0' },
              },
            }),
          });
        } else if (dataLines) {
          try {
            const msg = JSON.parse(dataLines);
            if (msg?.id === 'sse-init-1' && !initResult) {
              initResult = msg.result || {};
              if (messagePostUrl && !toolsSent) {
                toolsSent = true;
                await fetchTimeout(messagePostUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders },
                  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
                }).catch(() => {});
                await fetchTimeout(messagePostUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders },
                  body: JSON.stringify({ jsonrpc: '2.0', id: 'sse-tools-1', method: 'tools/list', params: {} }),
                });
              }
            } else if (msg?.id === 'sse-tools-1') {
              toolsListResult = msg;
            }
          } catch {
            // ignore non-json frames
          }
        }
      }
      if (initSent && !messagePostUrl) break;
    }

    controller.abort();
    clearTimeout(timeout);

    if (!messagePostUrl || !toolsListResult) {
      return {
        ok: false,
        status: 'ERROR',
        message: 'SSE MCP stream connected but did not complete initialize + tools/list within timeout.',
        tools: [],
        latency_ms: Date.now() - start,
      };
    }

    const rawTools = Array.isArray(toolsListResult?.result?.tools) ? toolsListResult.result.tools : [];
    const tools: DiscoveredMcpTool[] = rawTools.map((t: any) => ({
      name: String(t.name || 'unnamed_tool'),
      description: String(t.description || 'MCP SSE tool'),
      input_schema: t.inputSchema || undefined,
      enabled: true,
      category: 'MCP Tool',
    }));

    return {
      ok: true,
      status: 'CONNECTED',
      http_status: 200,
      server_info: {
        name: initResult?.serverInfo?.name,
        version: initResult?.serverInfo?.version,
        protocolVersion: initResult?.protocolVersion,
      },
      tools,
      message: `Connected via SSE MCP (${initResult?.serverInfo?.name || 'SSE Server'}). Discovered ${tools.length} tool(s).`,
      latency_ms: Date.now() - start,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    return {
      ok: false,
      status: 'ERROR',
      message: `SSE MCP error: ${err?.message || 'Timeout or stream interrupted'}`,
      tools: [],
      latency_ms: Date.now() - start,
    };
  }
}

export async function callStreamableMcpTool(params: {
  endpointUrl: string;
  transportType: McpTransportType;
  authConfig: McpAuthHeadersConfig;
  toolName: string;
  args: Record<string, any>;
}): Promise<{
  ok: boolean;
  http_status?: number;
  result?: any;
  credits_consumed: number;
  error?: string;
  latency_ms: number;
}> {
  const start = Date.now();
  const check = validateMcpEndpointUrl(params.endpointUrl);
  if (!check.valid || !check.normalized) {
    return { ok: false, credits_consumed: 0, error: check.error, latency_ms: Date.now() - start };
  }

  const endpoint = check.normalized;
  const authHeaders = buildMcpAuthHeaders(params.authConfig);

  if (params.transportType === 'sse') {
    return callSseMcpTool(endpoint, authHeaders, params.toolName, params.args, start);
  }

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'AIBuyerHunter-MCP-Client/1.0',
    ...authHeaders,
  };

  try {
    const initRes = await fetchTimeout(endpoint, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-init',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          clientInfo: { name: 'ai-buyer-hunter', version: '1.0.0' },
        },
      }),
    });

    if (!initRes.ok) {
      const txt = await initRes.text();
      return {
        ok: false,
        http_status: initRes.status,
        credits_consumed: 0,
        error: `MCP initialize HTTP ${initRes.status}: ${txt.slice(0, 180)}`,
        latency_ms: Date.now() - start,
      };
    }

    const sessionId = initRes.headers.get('mcp-session-id') || initRes.headers.get('Mcp-Session-Id');
    const sessionHeaders: Record<string, string> = { ...baseHeaders };
    if (sessionId) sessionHeaders['Mcp-Session-Id'] = sessionId;

    await fetchTimeout(
      endpoint,
      {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      },
      4000
    ).catch(() => {});

    const callRes = await fetchTimeout(
      endpoint,
      {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `call-${Date.now()}`,
          method: 'tools/call',
          params: {
            name: params.toolName,
            arguments: params.args || {},
          },
        }),
      },
      15000
    );

    const callBody = await callRes.text();
    const parsed = parseJsonRpcPayload(callBody, callRes.headers.get('content-type'));

    if (!callRes.ok || parsed?.error) {
      return {
        ok: false,
        http_status: callRes.status,
        credits_consumed: 0,
        error: parsed?.error?.message || `MCP tools/call HTTP ${callRes.status}: ${callBody.slice(0, 200)}`,
        latency_ms: Date.now() - start,
      };
    }

    const resObj = parsed?.result ?? parsed;
    const credits =
      Number(resObj?.credits_consumed || resObj?.meta?.credits_consumed || resObj?._meta?.credits_consumed || 0) || 0;

    return {
      ok: true,
      http_status: callRes.status,
      result: resObj,
      credits_consumed: credits,
      latency_ms: Date.now() - start,
    };
  } catch (err: any) {
    return {
      ok: false,
      credits_consumed: 0,
      error: err?.message || 'MCP tool call failed',
      latency_ms: Date.now() - start,
    };
  }
}

async function callSseMcpTool(
  endpoint: string,
  authHeaders: Record<string, string>,
  toolName: string,
  args: Record<string, any>,
  start: number
): Promise<{
  ok: boolean;
  http_status?: number;
  result?: any;
  credits_consumed: number;
  error?: string;
  latency_ms: number;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', ...authHeaders },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      clearTimeout(timeout);
      return { ok: false, http_status: res.status, credits_consumed: 0, error: `SSE HTTP ${res.status}`, latency_ms: Date.now() - start };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let postUrl: string | null = null;
    let callResponse: any = null;

    while (!callResponse) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const ev = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message';
        const data = frame.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
        if (ev === 'endpoint' && data && !postUrl) {
          postUrl = new URL(data, endpoint).toString();
          await fetchTimeout(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'sse-c-init',
              method: 'initialize',
              params: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, clientInfo: { name: 'ai-buyer-hunter', version: '1.0.0' } },
            }),
          });
        } else if (data) {
          try {
            const msg = JSON.parse(data);
            if (msg?.id === 'sse-c-init' && postUrl) {
              await fetchTimeout(postUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 'sse-c-call',
                  method: 'tools/call',
                  params: { name: toolName, arguments: args || {} },
                }),
              });
            } else if (msg?.id === 'sse-c-call') {
              callResponse = msg;
            }
          } catch {
            // ignore
          }
        }
      }
    }
    controller.abort();
    clearTimeout(timeout);

    if (!callResponse) {
      return { ok: false, credits_consumed: 0, error: 'SSE MCP tool call timed out', latency_ms: Date.now() - start };
    }
    if (callResponse.error) {
      return { ok: false, credits_consumed: 0, error: callResponse.error.message || 'MCP error', latency_ms: Date.now() - start };
    }
    return { ok: true, http_status: 200, result: callResponse.result, credits_consumed: 0, latency_ms: Date.now() - start };
  } catch (err: any) {
    clearTimeout(timeout);
    return { ok: false, credits_consumed: 0, error: err?.message || 'SSE tool call failed', latency_ms: Date.now() - start };
  }
}

export function createPkceChallenge(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
