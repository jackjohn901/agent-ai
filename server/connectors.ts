import type { PlatformConnector } from '../shared/types.js';
import { getConnectorDefinition } from './connectorRegistry.js';
import { db, getCustomFeeds, logSystemEvent } from './db.js';
import { getOptionalGeminiClient, logGeminiUsage } from './geminiClient.js';
import { getDecryptedCredential } from './secrets.js';

export interface RawCandidatePost {
  platform: string;
  connector_id: string;
  original_post_url: string;
  author_name: string;
  username: string | null;
  title: string;
  body: string;
  date_posted: string | null;
  country_hint: string | null;
  service_hint: string;
  search_query_used: string;
  evidence_notes: string;
}

export interface ConnectorResult {
  connector_id: string;
  platform_name: string;
  query: string;
  candidates: RawCandidatePost[];
  error?: string;
}

export interface ConnectorTestResult {
  connector_id: string;
  status: PlatformConnector['status'];
  ok: boolean;
  message: string;
  checked_at: string;
}

function getRedditComplianceState(): { isEnabled: boolean; commercialApproved: boolean } {
  const row = db
    .prepare('SELECT is_enabled, config_json FROM universal_integrations WHERE id = ?')
    .get('reddit_api') as { is_enabled?: number; config_json?: string } | undefined;
  if (!row) return { isEnabled: true, commercialApproved: false };
  let cfg: any = {};
  try {
    cfg = JSON.parse(row.config_json || '{}');
  } catch {
    cfg = {};
  }
  return {
    isEnabled: row.is_enabled !== 0,
    commercialApproved: Boolean(cfg.commercial_approved),
  };
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export function updatePlatformStatus(
  id: string,
  status: PlatformConnector['status'],
  error: string | null
) {
  db.prepare(
    "UPDATE platforms SET status = ?, last_checked_at = datetime('now'), last_error = ? WHERE id = ?"
  ).run(status, error, id);
}

export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    // Block private IPv4 ranges & metadata IPs
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 10 || a === 127 || a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRssOrAtomEntries(xml: string): Array<{ title: string; link: string; content: string; author: string; date: string | null }> {
  const entries: Array<{ title: string; link: string; content: string; author: string; date: string | null }> = [];
  const itemMatches = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];

  for (const block of itemMatches) {
    const titleRaw = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const linkAtom = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
    const linkRss = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1];
    const link = decodeHtmlEntities(linkAtom || linkRss || '').trim();
    const descRaw =
      block.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i)?.[1] ||
      block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] ||
      block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ||
      '';
    const authorRaw =
      block.match(/<author\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)?.[1] ||
      block.match(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1] ||
      block.match(/<author\b[^>]*>([\s\S]*?)<\/author>/i)?.[1] ||
      '';
    const dateRaw =
      block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ||
      block.match(/<updated\b[^>]*>([\s\S]*?)<\/updated>/i)?.[1] ||
      block.match(/<published\b[^>]*>([\s\S]*?)<\/published>/i)?.[1] ||
      '';

    const title = decodeHtmlEntities(titleRaw);
    const content = decodeHtmlEntities(descRaw);
    const author = decodeHtmlEntities(authorRaw);
    let isoDate: string | null = null;
    if (dateRaw) {
      const d = new Date(decodeHtmlEntities(dateRaw));
      if (!Number.isNaN(d.getTime())) isoDate = d.toISOString();
    }

    if (title && link && /^https?:\/\//i.test(link)) {
      entries.push({ title, link, content, author, date: isoDate });
    }
  }
  return entries;
}

// ======================== CUSTOM COMMUNITY FEEDS ========================

export async function testCustomFeed(feedId: number): Promise<{ ok: boolean; status: 'READY' | 'ERROR'; message: string }> {
  const row = db.prepare('SELECT * FROM custom_feeds WHERE id = ?').get(feedId) as any;
  if (!row) throw new Error('Custom feed not found');

  if (!isSafePublicUrl(row.url)) {
    const msg = 'Blocked unsafe or private network URL';
    db.prepare("UPDATE custom_feeds SET status = 'ERROR', last_checked_at = datetime('now'), last_error = ? WHERE id = ?").run(
      msg,
      feedId
    );
    return { ok: false, status: 'ERROR', message: msg };
  }

  try {
    const res = await fetchWithTimeout(row.url, {
      headers: { 'User-Agent': 'AIBuyerHunter/1.0', Accept: 'application/json, application/rss+xml, application/xml, text/xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const body = await res.text();

    if (row.feed_type === 'JSON') {
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed?.data) ? parsed.data : null;
      if (!list) throw new Error('JSON feed must return an array or an object with items/data array');
      db.prepare("UPDATE custom_feeds SET status = 'READY', last_checked_at = datetime('now'), last_error = NULL WHERE id = ?").run(
        feedId
      );
      return { ok: true, status: 'READY', message: `Verified JSON feed (${list.length} records)` };
    } else {
      const entries = parseRssOrAtomEntries(body);
      if (entries.length === 0) throw new Error('No valid <item> or <entry> records found in RSS/Atom feed');
      db.prepare("UPDATE custom_feeds SET status = 'READY', last_checked_at = datetime('now'), last_error = NULL WHERE id = ?").run(
        feedId
      );
      return { ok: true, status: 'READY', message: `Verified RSS/Atom feed (${entries.length} entries)` };
    }
  } catch (err: any) {
    const msg = err?.message || 'Feed connection test failed';
    db.prepare("UPDATE custom_feeds SET status = 'ERROR', last_checked_at = datetime('now'), last_error = ? WHERE id = ?").run(
      msg,
      feedId
    );
    return { ok: false, status: 'ERROR', message: msg };
  }
}

// ======================== LIVE CONNECTOR TESTING ========================

async function getRedditOAuthToken(clientId: string, clientSecret: string, userAgent: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`Reddit OAuth HTTP ${res.status}`);
  }
  const json = (await res.json()) as any;
  if (!json?.access_token) {
    throw new Error(json?.error_description || json?.error || 'Reddit OAuth did not return an access_token');
  }
  return String(json.access_token);
}

export async function testConnector(connectorId: string): Promise<ConnectorTestResult> {
  const def = getConnectorDefinition(connectorId);
  if (!def) {
    throw new Error(`Unknown connector: ${connectorId}`);
  }

  const now = new Date().toISOString();
  const done = (status: PlatformConnector['status'], ok: boolean, message: string): ConnectorTestResult => {
    updatePlatformStatus(connectorId, status, ok ? null : message);
    return { connector_id: connectorId, status, ok, message, checked_at: now };
  };

  if (connectorId === 'manual_url_capture') {
    updatePlatformStatus(connectorId, 'MANUAL_ONLY', null);
    return {
      connector_id: connectorId,
      status: 'MANUAL_ONLY',
      ok: true,
      message: 'Manual URL & post intake is active inside Global Lead Discovery.',
      checked_at: now,
    };
  }

  try {
    switch (connectorId) {
      case 'google_custom_search': {
        const apiKey = getDecryptedCredential('google_custom_search', 'api_key');
        const cx = getDecryptedCredential('google_custom_search', 'cx');
        if (!apiKey || !cx) {
          return done('MISSING_CREDENTIALS', false, 'Google Custom Search API Key and Search Engine ID (cx) are required.');
        }
        const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(
          cx
        )}&q=${encodeURIComponent('"looking for" "web developer"')}&num=1`;
        const res = await fetchWithTimeout(url);
        const json = (await res.json()) as any;
        if (!res.ok || json?.error) {
          return done('ERROR', false, json?.error?.message || `Google Custom Search HTTP ${res.status}`);
        }
        return done('READY', true, `Google Custom Search API verified (${json?.searchInformation?.totalResults || '0'} indexed results accessible).`);
      }

      case 'google_search_grounding': {
        const gemini = getOptionalGeminiClient('buyer_discovery_queries');
        if (!gemini) {
          return done('MISSING_CREDENTIALS', false, 'Gemini API key is not configured (neither saved override nor GEMINI_API_KEY env secret).');
        }
        const start = Date.now();
        const response = await gemini.ai.models.generateContent({
          model: gemini.model,
          contents: 'Find 1 current public discussion where a business is hiring a web developer. Return only the page title.',
          config: { tools: [{ googleSearch: {} }] },
        });
        if (!response.text && !(response.candidates && response.candidates.length > 0)) {
          return done('ERROR', false, 'Google Search Grounding returned an empty response.');
        }
        logGeminiUsage({
          action: 'TEST_GROUNDING',
          toolName: 'buyer_discovery_queries',
          status: 'SUCCESS',
          tokensUsed: (response as any)?.usageMetadata?.totalTokenCount || 0,
          latencyMs: Date.now() - start,
          details: `Verified Google Search Grounding using ${gemini.model}`,
        });
        return done('READY', true, `Google Search Grounding (${gemini.model}) verified live.`);
      }

      case 'reddit_api': {
        const compliance = getRedditComplianceState();
        if (!compliance.isEnabled) {
          return done('ERROR', false, 'Reddit API integration is disabled in Integrations & Connected Apps.');
        }
        const clientId = getDecryptedCredential('reddit_api', 'client_id');
        const clientSecret = getDecryptedCredential('reddit_api', 'client_secret');
        const userAgent =
          getDecryptedCredential('reddit_api', 'user_agent') || 'web:ai-buyer-hunter:v1.0 (by /u/aibuyerhunter)';

        if (clientId && clientSecret) {
          const token = await getRedditOAuthToken(clientId, clientSecret, userAgent);
          const testRes = await fetchWithTimeout(
            'https://oauth.reddit.com/r/forhire/search?q=website&restrict_sr=1&sort=new&limit=2',
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': userAgent,
              },
            }
          );
          if (!testRes.ok) {
            return done('ERROR', false, `Reddit OAuth API returned HTTP ${testRes.status}`);
          }
          const json = (await testRes.json()) as any;
          const count = json?.data?.children?.length ?? 0;
          if (!compliance.commercialApproved) {
            return done(
              'APPROVAL_REQUIRED',
              false,
              `Reddit OAuth reachable (${count} posts), but Reddit Commercial API Approval is not confirmed yet in Integrations & Connected Apps.`
            );
          }
          return done('READY', true, `Reddit Official OAuth API verified (${count} sample posts fetched from oauth.reddit.com).`);
        }

        if (!compliance.commercialApproved) {
          return done(
            'APPROVAL_REQUIRED',
            false,
            'Reddit API requires OAuth Client ID/Secret plus explicit confirmation of Reddit Commercial Data API approval.'
          );
        }
        return done(
          'MISSING_CREDENTIALS',
          false,
          'Configure Reddit OAuth Client ID, Client Secret, and descriptive User-Agent.'
        );
      }

      case 'hacker_news_api': {
        const [algoliaRes, fbRes] = await Promise.all([
          fetchWithTimeout('https://hn.algolia.com/api/v1/search_by_date?tags=(ask_hn,job)&hitsPerPage=2'),
          fetchWithTimeout('https://hacker-news.firebaseio.com/v0/askstories.json'),
        ]);
        if (!algoliaRes.ok || !fbRes.ok) {
          return done('ERROR', false, `Hacker News API error (Algolia ${algoliaRes.status} / Firebase ${fbRes.status})`);
        }
        const data = (await algoliaRes.json()) as any;
        const hits = Array.isArray(data?.hits) ? data.hits.length : 0;
        return done('READY', true, `Hacker News Algolia & Firebase APIs verified (${hits} recent items sampled).`);
      }

      case 'remoteok_public_feed': {
        const res = await fetchWithTimeout('https://remoteok.com/api', {
          headers: { 'User-Agent': 'AIBuyerHunter/1.0', Accept: 'application/json' },
        });
        if (!res.ok) return done('ERROR', false, `RemoteOK HTTP ${res.status}`);
        const data = (await res.json()) as any[];
        const count = Array.isArray(data) ? Math.max(0, data.length - 1) : 0;
        if (count === 0) return done('ERROR', false, 'RemoteOK returned no opportunity records.');
        return done('READY', true, `RemoteOK public feed verified (${count} live listings available).`);
      }

      case 'weworkremotely_rss': {
        const res = await fetchWithTimeout('https://weworkremotely.com/remote-jobs.rss', {
          headers: { 'User-Agent': 'AIBuyerHunter/1.0', Accept: 'application/rss+xml, text/xml' },
        });
        if (!res.ok) return done('ERROR', false, `WeWorkRemotely HTTP ${res.status}`);
        const xml = await res.text();
        const entries = parseRssOrAtomEntries(xml);
        if (entries.length === 0) return done('ERROR', false, 'WeWorkRemotely RSS returned no parseable items.');
        return done('READY', true, `WeWorkRemotely RSS verified (${entries.length} live listings).`);
      }

      case 'github_public_search': {
        const token = getDecryptedCredential('github_public_search', 'token');
        const headers: Record<string, string> = {
          'User-Agent': 'AIBuyerHunter/1.0',
          Accept: 'application/vnd.github+json',
        };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetchWithTimeout(
          'https://api.github.com/search/issues?q=is:issue+is:open+%22looking+for+developer%22&per_page=1',
          { headers }
        );
        if (!res.ok) {
          const txt = await res.text();
          return done('ERROR', false, `GitHub API HTTP ${res.status}: ${txt.slice(0, 140)}`);
        }
        const json = (await res.json()) as any;
        return done(
          'READY',
          true,
          `GitHub Public Search API verified (${json?.total_count ?? 0} matching open issues${token ? ' · authenticated token active' : ''}).`
        );
      }

      case 'custom_community_feeds': {
        const feeds = getCustomFeeds().filter((f) => f.is_enabled);
        if (feeds.length === 0) {
          return done('MISSING_CREDENTIALS', false, 'No custom RSS/JSON community feeds configured yet.');
        }
        let readyCount = 0;
        let lastErr = '';
        for (const feed of feeds) {
          const t = await testCustomFeed(feed.id);
          if (t.ok) readyCount += 1;
          else lastErr = `${feed.name}: ${t.message}`;
        }
        if (readyCount > 0) {
          return done('READY', true, `${readyCount} of ${feeds.length} custom community feeds verified and ready.`);
        }
        return done('ERROR', false, lastErr || 'All enabled custom community feeds failed verification.');
      }

      case 'linkedin_official_api': {
        const token = getDecryptedCredential('linkedin_official_api', 'access_token');
        if (!token) {
          return done('APPROVAL_REQUIRED', false, 'Requires approved LinkedIn Developer OAuth 2.0 Access Token.');
        }
        const res = await fetchWithTimeout('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return done('ERROR', false, `LinkedIn API returned HTTP ${res.status} — token invalid or lacks Partner scope.`);
        return done('READY', true, 'LinkedIn API token verified.');
      }

      case 'upwork_official_api': {
        const token = getDecryptedCredential('upwork_official_api', 'access_token');
        if (!token) {
          return done('APPROVAL_REQUIRED', false, 'Requires approved Upwork Developer API OAuth2 token.');
        }
        const res = await fetchWithTimeout('https://api.upwork.com/graphql', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ user { id } }' }),
        });
        if (!res.ok) return done('ERROR', false, `Upwork GraphQL HTTP ${res.status}`);
        const json = (await res.json()) as any;
        if (json?.errors?.length) return done('ERROR', false, json.errors[0]?.message || 'Upwork GraphQL auth error');
        return done('READY', true, 'Upwork GraphQL API verified.');
      }

      case 'fiverr_partner_api': {
        const key = getDecryptedCredential('fiverr_partner_api', 'api_key');
        if (!key) {
          return done(
            'APPROVAL_REQUIRED',
            false,
            'Fiverr does not offer an open self-serve buyer-request search API; Partner approval is required.'
          );
        }
        return done(
          'APPROVAL_REQUIRED',
          false,
          'Fiverr Partner endpoint verification requires direct Fiverr Partner onboarding; key saved encrypted, but Fiverr remains approval-gated.'
        );
      }

      case 'meta_facebook_instagram': {
        const token = getDecryptedCredential('meta_facebook_instagram', 'access_token');
        if (!token) {
          return done('APPROVAL_REQUIRED', false, 'Requires Meta App Review & Graph API Access Token.');
        }
        const res = await fetchWithTimeout(
          `https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(token)}`
        );
        const json = (await res.json()) as any;
        if (!res.ok || json?.error) {
          return done('ERROR', false, json?.error?.message || `Meta Graph HTTP ${res.status}`);
        }
        return done('READY', true, `Meta Graph API verified for ${json?.name || json?.id || 'authorized account'}.`);
      }

      case 'x_twitter_api': {
        const token = getDecryptedCredential('x_twitter_api', 'bearer_token');
        if (!token) {
          return done('APPROVAL_REQUIRED', false, 'Requires X Developer Basic/Pro tier Bearer Token.');
        }
        const res = await fetchWithTimeout(
          'https://api.twitter.com/2/tweets/search/recent?query=website%20developer&max_results=10',
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const txt = await res.text();
          return done('ERROR', false, `X API HTTP ${res.status}: ${txt.slice(0, 140)}`);
        }
        return done('READY', true, 'X (Twitter) v2 Recent Search API verified.');
      }

      case 'bing_search_api': {
        const key = getDecryptedCredential('bing_search_api', 'api_key');
        if (!key) {
          return done('MISSING_CREDENTIALS', false, 'Azure Bing Search v7 API key is required.');
        }
        const res = await fetchWithTimeout('https://api.bing.microsoft.com/v7.0/search?q=website+developer&count=1', {
          headers: { 'Ocp-Apim-Subscription-Key': key },
        });
        if (!res.ok) return done('ERROR', false, `Bing Search HTTP ${res.status}`);
        return done('READY', true, 'Bing Web Search API verified.');
      }

      default:
        return done('ERROR', false, 'No test handler implemented for this connector.');
    }
  } catch (err: any) {
    return done('ERROR', false, err?.message || 'Connection test failed');
  }
}

export async function testAllConnectors(includeApprovalGated = false): Promise<ConnectorTestResult[]> {
  const rows = db.prepare('SELECT id FROM platforms').all() as Array<{ id: string }>;
  const results: ConnectorTestResult[] = [];
  for (const row of rows) {
    const def = getConnectorDefinition(row.id);
    if (!def) continue;
    if (!includeApprovalGated && def.requires_approval) {
      // Only test approval-gated connector if user actually configured credentials for it
      const hasAnyCred = def.credential_fields.some((f) => Boolean(getDecryptedCredential(def.id, f.key)));
      if (!hasAnyCred) {
        updatePlatformStatus(def.id, 'APPROVAL_REQUIRED', null);
        continue;
      }
    }
    const r = await testConnector(row.id);
    results.push(r);
  }
  logSystemEvent(
    'INFO',
    'system',
    'CONNECTORS_TESTED',
    `Tested ${results.length} connectors (${results.filter((x) => x.status === 'READY').length} READY)`
  );
  return results;
}

// ======================== LIVE DATA FETCHERS ========================

/**
 * 1. Google Custom Search JSON API
 */
export async function searchGoogleCustomSearch(
  service: string,
  queryVariation: string,
  country: string,
  maxResults = 6
): Promise<ConnectorResult> {
  const connector_id = 'google_custom_search';
  const apiKey = getDecryptedCredential(connector_id, 'api_key');
  const cx = getDecryptedCredential(connector_id, 'cx');
  if (!apiKey || !cx) {
    updatePlatformStatus(connector_id, 'MISSING_CREDENTIALS', 'Google Custom Search API Key and CX required');
    return {
      connector_id,
      platform_name: 'Google Custom Search JSON API',
      query: queryVariation,
      candidates: [],
      error: 'Google Custom Search credentials are not configured.',
    };
  }

  const locationPart = country && country !== 'Worldwide' ? ` "${country}"` : '';
  const query = `${queryVariation}${locationPart} ("looking for" OR "need someone" OR "hiring" OR "recommend") -site:fiverr.com/categories`;

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(
      cx
    )}&q=${encodeURIComponent(query)}&num=${Math.min(10, Math.max(1, maxResults))}&dateRestrict=m1`;
    const res = await fetchWithTimeout(url);
    const json = (await res.json()) as any;
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || `Google Custom Search HTTP ${res.status}`);
    }

    const items = Array.isArray(json?.items) ? json.items : [];
    const candidates: RawCandidatePost[] = items.map((item: any) => ({
      platform: inferPlatformFromUrl(String(item.link || '')),
      connector_id,
      original_post_url: String(item.link || ''),
      author_name: String(item.displayLink || 'Public Web Poster'),
      username: null,
      title: String(item.title || `${service} Opportunity`),
      body: String(item.snippet || item.title || '').slice(0, 2500),
      date_posted: null,
      country_hint: country !== 'Worldwide' ? country : null,
      service_hint: service,
      search_query_used: query,
      evidence_notes: `Discovered live via Google Custom Search JSON API (${item.displayLink || 'web'})`,
    }));

    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'Google Custom Search JSON API', query, candidates };
  } catch (err: any) {
    const msg = err?.message || 'Google Custom Search failed';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'Google Custom Search JSON API', query, candidates: [], error: msg };
  }
}

/**
 * 2. Reddit API Connector (OAuth oauth.reddit.com primary, single-subreddit RSS fallback)
 */
export async function searchRedditApi(
  service: string,
  keywords: string[],
  maxResults = 8
): Promise<ConnectorResult> {
  const connector_id = 'reddit_api';
  const compliance = getRedditComplianceState();
  if (!compliance.isEnabled) {
    return {
      connector_id,
      platform_name: 'Reddit API',
      query: service,
      candidates: [],
      error: 'Reddit API integration is currently disabled.',
    };
  }
  if (!compliance.commercialApproved) {
    updatePlatformStatus(
      connector_id,
      'APPROVAL_REQUIRED',
      'Commercial Reddit Data API approval must be confirmed before collecting commercial leads.'
    );
    return {
      connector_id,
      platform_name: 'Reddit API',
      query: service,
      candidates: [],
      error: 'Blocked by Reddit Commercial Compliance Gate: confirm Reddit commercial data access approval in Integrations & Connected Apps first.',
    };
  }

  const clientId = getDecryptedCredential(connector_id, 'client_id');
  const clientSecret = getDecryptedCredential(connector_id, 'client_secret');
  const userAgent =
    getDecryptedCredential(connector_id, 'user_agent') || 'web:ai-buyer-hunter:v1.0 (by /u/aibuyerhunter)';

  const subreddits = ['forhire', 'freelance_forhire', 'Entrepreneur', 'smallbusiness', 'SaaS', 'shopify', 'DesignJobs'];
  const qTerms = [service, ...keywords.slice(0, 2)].join(' OR ');
  const candidates: RawCandidatePost[] = [];

  try {
    if (clientId && clientSecret) {
      const token = await getRedditOAuthToken(clientId, clientSecret, userAgent);
      const searchUrl = `https://oauth.reddit.com/r/${subreddits.join('+')}/search?q=${encodeURIComponent(
        `(${qTerms}) (hiring OR "looking for" OR "need someone" OR "recommend" OR "help me build" OR "[Hiring]")`
      )}&restrict_sr=1&sort=new&t=month&limit=${Math.min(25, maxResults * 2)}`;

      const res = await fetchWithTimeout(searchUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': userAgent,
        },
      });
      if (!res.ok) throw new Error(`Reddit OAuth HTTP ${res.status}`);

      const json = (await res.json()) as any;
      for (const child of json?.data?.children || []) {
        const p = child?.data;
        if (!p || !p.permalink) continue;
        const title = String(p.title || '');
        if (/^\s*\[for\s*hire\]/i.test(title)) continue;

        candidates.push({
          platform: `Reddit (r/${p.subreddit || 'public'})`,
          connector_id,
          original_post_url: `https://www.reddit.com${p.permalink}`,
          author_name: p.author && p.author !== '[deleted]' ? p.author : 'Reddit User',
          username: p.author && p.author !== '[deleted]' ? `u/${p.author}` : null,
          title,
          body: String(p.selftext || '').slice(0, 2500),
          date_posted: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
          country_hint: null,
          service_hint: service,
          search_query_used: qTerms,
          evidence_notes: `Collected via Reddit Official OAuth API (r/${p.subreddit})`,
        });
        if (candidates.length >= maxResults) break;
      }

      updatePlatformStatus(connector_id, 'READY', null);
      return { connector_id, platform_name: 'Reddit Official OAuth', query: qTerms, candidates };
    }

    // Fallback: public subreddit /new/.rss (respectful single request to r/forhire + r/freelance_forhire)
    const fallbackSubs = ['forhire', 'freelance_forhire', 'DesignJobs'];
    const tokens = [service, ...keywords].join(' ').toLowerCase().split(/\W+/).filter((w) => w.length > 2);

    for (const sub of fallbackSubs) {
      if (candidates.length >= maxResults) break;
      const rssRes = await fetchWithTimeout(`https://www.reddit.com/r/${sub}/new/.rss`, {
        headers: { 'User-Agent': userAgent, Accept: 'application/rss+xml, text/xml' },
      });
      if (!rssRes.ok) {
        if (candidates.length === 0 && sub === fallbackSubs[0]) {
          throw new Error(`Reddit RSS blocked (HTTP ${rssRes.status}); Reddit OAuth Client ID & Secret required`);
        }
        continue;
      }
      const xml = await rssRes.text();
      const entries = parseRssOrAtomEntries(xml);
      for (const entry of entries) {
        if (/^\s*\[for\s*hire\]/i.test(entry.title)) continue;
        const hay = `${entry.title} ${entry.content}`.toLowerCase();
        const buyerSignals = /\[hiring\]|looking for|need someone|seeking|hiring|help build|redesign/i.test(hay);
        const matchesService = tokens.some((t) => hay.includes(t)) || /website|app|design|seo|marketing|video|ai|shopify|developer/i.test(hay);
        if (!buyerSignals || !matchesService) continue;

        candidates.push({
          platform: `Reddit (r/${sub})`,
          connector_id,
          original_post_url: entry.link,
          author_name: entry.author || 'Reddit Poster',
          username: entry.author || null,
          title: entry.title,
          body: entry.content.slice(0, 2500),
          date_posted: entry.date,
          country_hint: null,
          service_hint: service,
          search_query_used: `r/${sub}/new/.rss (${service})`,
          evidence_notes: `Collected from public Reddit r/${sub} RSS feed`,
        });
        if (candidates.length >= maxResults) break;
      }
    }

    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'Reddit Community RSS', query: qTerms, candidates };
  } catch (err: any) {
    const msg = err?.message || 'Reddit request failed';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'Reddit API', query: qTerms, candidates: [], error: msg };
  }
}

/**
 * 3. Hacker News Public Search (Algolia + Firebase)
 */
export async function searchHackerNewsPublic(service: string, maxResults = 6): Promise<ConnectorResult> {
  const connector_id = 'hacker_news_api';
  const candidates: RawCandidatePost[] = [];
  const query = `Ask HN / Startup hiring matching ${service}`;

  try {
    // Algolia recent search for buyer-intent Ask HN / Hiring posts matching the requested service
    const servicePhrase = service.replace(/\bdevelopment\b|\bservices?\b/gi, '').trim() || service;
    const algoliaUrl = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(
      servicePhrase
    )}&tags=(ask_hn,job)&hitsPerPage=20`;

    const [algoliaRes, askRes] = await Promise.all([
      fetchWithTimeout(algoliaUrl),
      fetchWithTimeout('https://hacker-news.firebaseio.com/v0/askstories.json'),
    ]);

    if (!algoliaRes.ok && !askRes.ok) {
      throw new Error(`Hacker News HTTP error (${algoliaRes.status}/${askRes.status})`);
    }

    const seen = new Set<string>();
    const intentRegex = /(looking for|need|hiring|recommend|freelance|agency|developer|designer|contractor|consultant|build|redesign|automation|ai|saas|seo|marketing|website|app)/i;

    if (algoliaRes.ok) {
      const algData = (await algoliaRes.json()) as any;
      for (const hit of algData?.hits || []) {
        const title = String(hit.title || '');
        const text = decodeHtmlEntities(String(hit.story_text || hit.comment_text || ''));
        if (!title || !intentRegex.test(`${title} ${text}`)) continue;
        const postUrl = hit.url && /^https?:\/\//i.test(hit.url)
          ? String(hit.url)
          : `https://news.ycombinator.com/item?id=${hit.objectID}`;
        if (seen.has(postUrl)) continue;
        seen.add(postUrl);

        candidates.push({
          platform: 'Hacker News',
          connector_id,
          original_post_url: postUrl,
          author_name: hit.author || 'HN Poster',
          username: hit.author || null,
          title,
          body: (text || title).slice(0, 2500),
          date_posted: hit.created_at || null,
          country_hint: null,
          service_hint: service,
          search_query_used: query,
          evidence_notes: `Collected from Hacker News Algolia API (item #${hit.objectID})`,
        });
        if (candidates.length >= maxResults) break;
      }
    }

    if (candidates.length < maxResults && askRes.ok) {
      const askIds = ((await askRes.json()) as number[]).slice(0, 15);
      const items = await Promise.all(
        askIds.map(async (id) => {
          try {
            const r = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {}, 5000);
            return r.ok ? await r.json() : null;
          } catch {
            return null;
          }
        })
      );

      for (const item of items) {
        if (!item || !item.id || !item.title) continue;
        const postUrl = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
        if (seen.has(postUrl)) continue;
        const cleanBody = decodeHtmlEntities(String(item.text || item.title));
        if (!intentRegex.test(`${item.title} ${cleanBody}`)) continue;
        seen.add(postUrl);

        candidates.push({
          platform: 'Hacker News',
          connector_id,
          original_post_url: postUrl,
          author_name: item.by || 'HN Poster',
          username: item.by || null,
          title: item.title,
          body: cleanBody.slice(0, 2500),
          date_posted: item.time ? new Date(item.time * 1000).toISOString() : null,
          country_hint: null,
          service_hint: service,
          search_query_used: query,
          evidence_notes: `Collected from Hacker News official Firebase API (item #${item.id})`,
        });
        if (candidates.length >= maxResults) break;
      }
    }

    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'Hacker News', query, candidates };
  } catch (err: any) {
    const msg = err?.message || 'Hacker News API error';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'Hacker News', query, candidates: [], error: msg };
  }
}

/**
 * 4. RemoteOK Public JSON Feed
 */
export async function searchRemoteOkPublic(service: string, maxResults = 6): Promise<ConnectorResult> {
  const connector_id = 'remoteok_public_feed';
  const candidates: RawCandidatePost[] = [];
  const query = `RemoteOK contract/project feed (${service})`;

  try {
    const res = await fetchWithTimeout('https://remoteok.com/api', {
      headers: {
        'User-Agent': 'AIBuyerHunter/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`RemoteOK HTTP ${res.status}`);

    const data = (await res.json()) as any[];
    const jobs = Array.isArray(data) ? data.slice(1) : [];
    const tokens = service.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && w !== 'development' && w !== 'services');

    for (const job of jobs) {
      if (!job || !job.position || !job.url) continue;
      const haystack = `${job.position} ${job.description || ''} ${(job.tags || []).join(' ')}`.toLowerCase();
      const matchesService =
        tokens.length > 0
          ? tokens.some((t) => haystack.includes(t))
          : /contract|freelance|agency|consultant|developer|designer|marketing/i.test(haystack);
      if (!matchesService) continue;

      const cleanDesc = decodeHtmlEntities(String(job.description || ''));

      candidates.push({
        platform: 'RemoteOK',
        connector_id,
        original_post_url: job.url.startsWith('http') ? job.url : `https://remoteok.com${job.url}`,
        author_name: job.company || 'Company Hiring',
        username: job.company || null,
        title: `${job.position} at ${job.company || 'Company'}`,
        body: cleanDesc.slice(0, 2500),
        date_posted: job.date || null,
        country_hint: job.location || 'Worldwide',
        service_hint: service,
        search_query_used: query,
        evidence_notes: `Collected from RemoteOK public JSON feed (ID ${job.id || 'N/A'})`,
      });

      if (candidates.length >= maxResults) break;
    }

    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'RemoteOK', query, candidates };
  } catch (err: any) {
    const msg = err?.message || 'RemoteOK feed error';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'RemoteOK', query, candidates: [], error: msg };
  }
}

/**
 * 5. WeWorkRemotely Public RSS Feed
 */
export async function searchWeWorkRemotelyRss(service: string, maxResults = 6): Promise<ConnectorResult> {
  const connector_id = 'weworkremotely_rss';
  const candidates: RawCandidatePost[] = [];
  const query = `WeWorkRemotely RSS (${service})`;

  try {
    const res = await fetchWithTimeout('https://weworkremotely.com/remote-jobs.rss', {
      headers: { 'User-Agent': 'AIBuyerHunter/1.0' },
    });
    if (!res.ok) throw new Error(`WeWorkRemotely HTTP ${res.status}`);
    const xml = await res.text();

    const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const tokens = service.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && w !== 'development' && w !== 'services');

    for (const block of itemMatches) {
      const title = decodeHtmlEntities(
        block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ||
          block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ||
          ''
      );
      const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '').trim();
      const region = (block.match(/<region>([\s\S]*?)<\/region>/)?.[1] || 'Worldwide').trim();
      const rawDesc =
        block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ||
        block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ||
        '';
      const cleanDesc = decodeHtmlEntities(rawDesc);

      if (!title || !link) continue;
      const haystack = `${title} ${cleanDesc}`.toLowerCase();
      const matches =
        tokens.length > 0
          ? tokens.some((t) => haystack.includes(t))
          : /contract|freelance|developer|designer|marketing|seo|video|ai/i.test(haystack);
      if (!matches) {
        continue;
      }

      const parts = title.split(':');
      const company = parts.length > 1 ? parts[0].trim() : 'Hiring Business';

      candidates.push({
        platform: 'WeWorkRemotely',
        connector_id,
        original_post_url: link,
        author_name: company,
        username: company,
        title,
        body: cleanDesc.slice(0, 2500),
        date_posted: pubDate ? new Date(pubDate).toISOString() : null,
        country_hint: region || 'Worldwide',
        service_hint: service,
        search_query_used: query,
        evidence_notes: 'Collected from WeWorkRemotely public RSS feed',
      });

      if (candidates.length >= maxResults) break;
    }

    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'WeWorkRemotely', query, candidates };
  } catch (err: any) {
    const msg = err?.message || 'WeWorkRemotely RSS error';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'WeWorkRemotely', query, candidates: [], error: msg };
  }
}

/**
 * 6. GitHub Public Issues & Bounties Search
 */
export async function searchGithubPublic(service: string, maxResults = 5): Promise<ConnectorResult> {
  const connector_id = 'github_public_search';
  const token = getDecryptedCredential(connector_id, 'token');
  const servicePhrase = service.replace(/\bdevelopment\b|\bservices?\b/gi, '').trim() || service;
  const query = `is:issue is:open "looking for" "${servicePhrase}" in:title,body`;
  const candidates: RawCandidatePost[] = [];

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'AIBuyerHunter/1.0',
      Accept: 'application/vnd.github+json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetchWithTimeout(
      `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=${Math.min(
        10,
        maxResults * 2
      )}`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);

    const json = (await res.json()) as any;
    for (const item of json?.items || []) {
      if (!item?.html_url || !item?.title) continue;
      candidates.push({
        platform: 'GitHub',
        connector_id,
        original_post_url: item.html_url,
        author_name: item.user?.login || 'GitHub User',
        username: item.user?.login ? `@${item.user.login}` : null,
        title: item.title,
        body: String(item.body || item.title).slice(0, 2500),
        date_posted: item.created_at || null,
        country_hint: null,
        service_hint: service,
        search_query_used: query,
        evidence_notes: `Collected via GitHub Issues Search API (${item.repository_url?.split('/').slice(-2).join('/') || 'public repo'})`,
      });
      if (candidates.length >= maxResults) break;
    }

    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'GitHub Public Issues', query, candidates };
  } catch (err: any) {
    const msg = err?.message || 'GitHub search failed';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'GitHub Public Issues', query, candidates: [], error: msg };
  }
}

/**
 * 7. Custom Business Community Feeds (RSS / JSON)
 */
export async function searchCustomCommunityFeeds(service: string, maxResults = 6): Promise<ConnectorResult> {
  const connector_id = 'custom_community_feeds';
  const feeds = getCustomFeeds().filter((f) => f.is_enabled && f.status === 'READY');
  const query = `Custom Community Feeds (${service})`;
  const candidates: RawCandidatePost[] = [];

  if (feeds.length === 0) {
    return {
      connector_id,
      platform_name: 'Custom Community Feeds',
      query,
      candidates: [],
      error: 'No verified READY custom community feeds configured.',
    };
  }

  const tokens = service.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  for (const feed of feeds) {
    if (!isSafePublicUrl(feed.url)) continue;
    try {
      const res = await fetchWithTimeout(feed.url, { headers: { 'User-Agent': 'AIBuyerHunter/1.0' } });
      if (!res.ok) continue;
      const body = await res.text();

      if (feed.feed_type === 'JSON') {
        const parsed = JSON.parse(body);
        const list = Array.isArray(parsed) ? parsed : parsed?.items || parsed?.data || [];
        for (const item of list) {
          const title = String(item?.title || item?.name || item?.position || '');
          const link = String(item?.url || item?.link || item?.canonical_url || '');
          const desc = decodeHtmlEntities(String(item?.description || item?.body || item?.summary || title));
          if (!title || !/^https?:\/\//i.test(link)) continue;
          const hay = `${title} ${desc}`.toLowerCase();
          if (!tokens.some((t) => hay.includes(t)) && !/hiring|looking for|developer|designer|agency|freelance|ai|seo|video/i.test(hay)) {
            continue;
          }
          candidates.push({
            platform: feed.name,
            connector_id,
            original_post_url: link,
            author_name: String(item?.user?.name || item?.author || item?.company || feed.name),
            username: item?.user?.username || null,
            title,
            body: desc.slice(0, 2500),
            date_posted: item?.published_at || item?.created_at || item?.date || null,
            country_hint: null,
            service_hint: service,
            search_query_used: `${feed.name} (${service})`,
            evidence_notes: `Collected from custom JSON community feed: ${feed.name}`,
          });
          if (candidates.length >= maxResults) break;
        }
      } else {
        const entries = parseRssOrAtomEntries(body);
        for (const e of entries) {
          const hay = `${e.title} ${e.content}`.toLowerCase();
          if (!tokens.some((t) => hay.includes(t)) && !/hiring|looking for|developer|designer|agency|freelance|ai|seo|video/i.test(hay)) {
            continue;
          }
          candidates.push({
            platform: feed.name,
            connector_id,
            original_post_url: e.link,
            author_name: e.author || feed.name,
            username: e.author || null,
            title: e.title,
            body: (e.content || e.title).slice(0, 2500),
            date_posted: e.date,
            country_hint: null,
            service_hint: service,
            search_query_used: `${feed.name} (${service})`,
            evidence_notes: `Collected from custom RSS community feed: ${feed.name}`,
          });
          if (candidates.length >= maxResults) break;
        }
      }
    } catch {
      // continue to next feed
    }
    if (candidates.length >= maxResults) break;
  }

  return { connector_id, platform_name: 'Custom Community Feeds', query, candidates };
}

/**
 * 8. Bing Search API (when configured & tested)
 */
export async function searchBingApi(
  service: string,
  queryVariation: string,
  country: string,
  maxResults = 6
): Promise<ConnectorResult> {
  const connector_id = 'bing_search_api';
  const apiKey = getDecryptedCredential(connector_id, 'api_key');
  if (!apiKey) {
    return { connector_id, platform_name: 'Bing Web Search API', query: queryVariation, candidates: [], error: 'Missing Bing API key' };
  }
  const locationPart = country && country !== 'Worldwide' ? ` ${country}` : '';
  const query = `${queryVariation}${locationPart} ("looking for" OR "hiring" OR "recommend")`;
  try {
    const res = await fetchWithTimeout(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${Math.min(10, maxResults)}&freshness=Month`,
      { headers: { 'Ocp-Apim-Subscription-Key': apiKey } }
    );
    if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
    const json = (await res.json()) as any;
    const candidates: RawCandidatePost[] = (json?.webPages?.value || []).map((v: any) => ({
      platform: inferPlatformFromUrl(String(v.url || '')),
      connector_id,
      original_post_url: String(v.url || ''),
      author_name: new URL(v.url).hostname,
      username: null,
      title: String(v.name || `${service} Opportunity`),
      body: String(v.snippet || '').slice(0, 2500),
      date_posted: v.dateLastCrawled || null,
      country_hint: country !== 'Worldwide' ? country : null,
      service_hint: service,
      search_query_used: query,
      evidence_notes: 'Collected via Azure Bing Web Search v7 API',
    }));
    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'Bing Web Search API', query, candidates };
  } catch (err: any) {
    const msg = err?.message || 'Bing Search failed';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'Bing Web Search API', query, candidates: [], error: msg };
  }
}

/**
 * 9. X (Twitter) v2 Search API (when configured & tested)
 */
export async function searchXTwitterApi(service: string, maxResults = 6): Promise<ConnectorResult> {
  const connector_id = 'x_twitter_api';
  const token = getDecryptedCredential(connector_id, 'bearer_token');
  const query = `("looking for" OR "need a" OR "hiring" OR "recommend") "${service}" -is:retweet lang:en`;
  if (!token) {
    return { connector_id, platform_name: 'X (Twitter) v2', query, candidates: [], error: 'Missing X Bearer Token' };
  }
  try {
    const res = await fetchWithTimeout(
      `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${Math.min(
        20,
        Math.max(10, maxResults)
      )}&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name,location`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`X API HTTP ${res.status}`);
    const json = (await res.json()) as any;
    const users = new Map<string, any>((json?.includes?.users || []).map((u: any) => [u.id, u]));
    const candidates: RawCandidatePost[] = (json?.data || []).slice(0, maxResults).map((t: any) => {
      const u = users.get(t.author_id);
      const handle = u?.username ? `@${u.username}` : null;
      return {
        platform: 'X/Twitter',
        connector_id,
        original_post_url: u?.username
          ? `https://x.com/${u.username}/status/${t.id}`
          : `https://x.com/i/web/status/${t.id}`,
        author_name: u?.name || 'X Poster',
        username: handle,
        title: String(t.text || '').slice(0, 90),
        body: String(t.text || '').slice(0, 2500),
        date_posted: t.created_at || null,
        country_hint: u?.location || null,
        service_hint: service,
        search_query_used: query,
        evidence_notes: 'Collected via X API v2 Recent Search',
      };
    });
    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'X (Twitter) v2', query, candidates };
  } catch (err: any) {
    const msg = err?.message || 'X Search failed';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return { connector_id, platform_name: 'X (Twitter) v2', query, candidates: [], error: msg };
  }
}

/**
 * 10. Google Search Grounding via Gemini (`tools: [{ googleSearch: {} }]`)
 */
export async function searchGoogleGrounding(
  service: string,
  queryVariation: string,
  country: string,
  maxResults = 6
): Promise<ConnectorResult> {
  const connector_id = 'google_search_grounding';
  const gemini = getOptionalGeminiClient('buyer_discovery_queries');
  if (!gemini) {
    updatePlatformStatus(connector_id, 'MISSING_CREDENTIALS', 'Gemini API key not configured');
    return {
      connector_id,
      platform_name: 'Google Search Grounding',
      query: queryVariation,
      candidates: [],
      error: 'Gemini API key is not configured.',
    };
  }

  const start = Date.now();
  try {
    const locationClause = country && country !== 'Worldwide' ? `in ${country}` : 'globally';
    const prompt = `Search the public web right now using Google Search for real people or businesses ${locationClause} who are actively looking to BUY or HIRE someone for "${service}".
Use search phrasing similar to: ${queryVariation}.
Target public posts, discussions, or hiring listings on platforms like Reddit, Indie Hackers, Hacker News, LinkedIn public posts, X/Twitter public posts, Facebook public pages, Product Hunt, or public freelance/startup boards.

CRITICAL GROUNDING RULES:
- Return ONLY real opportunities found directly in Google Search results from this search.
- NEVER invent, guess, or fabricate URLs, usernames, emails, budgets, or quotes.
- Exclude people advertising their own services ("For Hire", agencies pitching themselves).
- For each real opportunity found, provide a structured JSON array inside a \`\`\`json code block with objects containing:
  - "title": short headline of the post/listing
  - "author_or_company": name/handle shown in the search result (or "Unknown" if not shown)
  - "platform": e.g. "Reddit", "Indie Hackers", "LinkedIn", "X/Twitter", "Product Hunt", "Job Board", "Business Website"
  - "url": the exact URL from the search result
  - "quote_or_excerpt": exact snippet or buyer statement summarizing what they need
  - "country": country if mentioned, else null
  - "date_hint": date if shown in search result, else null`;

    const response = await gemini.ai.models.generateContent({
      model: gemini.model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    logGeminiUsage({
      action: 'GOOGLE_SEARCH_GROUNDING',
      toolName: 'buyer_discovery_queries',
      status: 'SUCCESS',
      tokensUsed: (response as any)?.usageMetadata?.totalTokenCount || 0,
      latencyMs: Date.now() - start,
      details: `Google Search Grounding for ${service} (${country}) using ${gemini.model}`,
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundedUrls = new Map<string, string>();
    for (const chunk of groundingChunks) {
      if (chunk?.web?.uri) {
        groundedUrls.set(chunk.web.uri, chunk.web.title || '');
      }
    }

    const rawText = response.text || '';
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/i) || rawText.match(/(\[\s*\{[\s\S]*\}\s*\])/);
    let parsed: any[] = [];
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1]);
      } catch {
        parsed = [];
      }
    }

    const candidates: RawCandidatePost[] = [];
    const seenUrls = new Set<string>();

    for (const item of Array.isArray(parsed) ? parsed : []) {
      const url = String(item?.url || '').trim();
      if (!url || !url.startsWith('http') || seenUrls.has(url)) continue;

      const isGrounded =
        groundedUrls.size === 0 ||
        Array.from(groundedUrls.keys()).some((gUrl) => {
          try {
            return (
              gUrl === url ||
              url.includes(gUrl) ||
              gUrl.includes(url) ||
              new URL(gUrl).hostname === new URL(url).hostname
            );
          } catch {
            return false;
          }
        });

      if (!isGrounded) continue;
      seenUrls.add(url);

      candidates.push({
        platform: String(item.platform || 'Web Search'),
        connector_id,
        original_post_url: url,
        author_name: String(item.author_or_company || 'Public Poster'),
        username: item.author_or_company && item.author_or_company !== 'Unknown' ? String(item.author_or_company) : null,
        title: String(item.title || `${service} Opportunity`),
        body: String(item.quote_or_excerpt || item.title || ''),
        date_posted: item.date_hint || null,
        country_hint: item.country || (country !== 'Worldwide' ? country : null),
        service_hint: service,
        search_query_used: queryVariation,
        evidence_notes: `Verified via Google Search Grounding (${groundedUrls.size} grounding chunks returned)`,
      });
      if (candidates.length >= maxResults) break;
    }

    if (candidates.length === 0 && groundedUrls.size > 0) {
      for (const [uri, title] of groundedUrls.entries()) {
        if (seenUrls.has(uri)) continue;
        seenUrls.add(uri);
        candidates.push({
          platform: inferPlatformFromUrl(uri),
          connector_id,
          original_post_url: uri,
          author_name: 'Public Web Poster',
          username: null,
          title: title || `${service} Public Result`,
          body: rawText.slice(0, 1200),
          date_posted: null,
          country_hint: country !== 'Worldwide' ? country : null,
          service_hint: service,
          search_query_used: queryVariation,
          evidence_notes: 'Direct groundingChunk URL from Google Search',
        });
        if (candidates.length >= maxResults) break;
      }
    }

    updatePlatformStatus(connector_id, 'READY', null);
    return { connector_id, platform_name: 'Google Search Grounding', query: queryVariation, candidates };
  } catch (err: any) {
    const msg = err?.message || 'Google Search Grounding failed';
    updatePlatformStatus(connector_id, 'ERROR', msg);
    return {
      connector_id,
      platform_name: 'Google Search Grounding',
      query: queryVariation,
      candidates: [],
      error: msg,
    };
  }
}

/**
 * Unified Modular Connector Dispatcher
 */
export async function executeConnectorSearch(
  connectorId: string,
  service: string,
  keywords: string[],
  queryVariation: string,
  country: string,
  maxResults = 6
): Promise<ConnectorResult> {
  switch (connectorId) {
    case 'google_custom_search':
      return searchGoogleCustomSearch(service, queryVariation, country, maxResults);
    case 'google_search_grounding':
      return searchGoogleGrounding(service, queryVariation, country, maxResults);
    case 'reddit_api':
      return searchRedditApi(service, keywords, maxResults);
    case 'hacker_news_api':
      return searchHackerNewsPublic(service, maxResults);
    case 'remoteok_public_feed':
      return searchRemoteOkPublic(service, maxResults);
    case 'weworkremotely_rss':
      return searchWeWorkRemotelyRss(service, maxResults);
    case 'github_public_search':
      return searchGithubPublic(service, maxResults);
    case 'custom_community_feeds':
      return searchCustomCommunityFeeds(service, maxResults);
    case 'bing_search_api':
      return searchBingApi(service, queryVariation, country, maxResults);
    case 'x_twitter_api':
      return searchXTwitterApi(service, maxResults);
    default:
      return {
        connector_id: connectorId,
        platform_name: getConnectorDefinition(connectorId)?.name || connectorId,
        query: queryVariation,
        candidates: [],
        error: `Connector "${connectorId}" does not support automated search without approved API access.`,
      };
  }
}

/**
 * Manual URL & Post Intake (uses Gemini urlContext when URL provided, or direct buyer text)
 */
export async function inspectManualPostOrUrl(input: {
  url?: string;
  platform?: string;
  author?: string;
  content?: string;
  service_hint?: string;
}): Promise<RawCandidatePost> {
  const url = (input.url || '').trim();
  let extractedText = (input.content || '').trim();
  let title = extractedText.slice(0, 90) || 'Manual Buyer Opportunity';

  if (url && !extractedText) {
    const gemini = getOptionalGeminiClient();
    if (gemini) {
      const started = Date.now();
      try {
        const res = await gemini.ai.models.generateContent({
          model: gemini.model,
          contents: `Read the public content at ${url} and summarize verbatim what service the poster is requesting, who posted it, any stated budget, location, and exact buyer quotes. Do not invent missing details.`,
          config: {
            tools: [{ urlContext: {} }],
            ...(gemini.model.startsWith('gemini-4')
              ? { thinkingConfig: { thinkingLevel: gemini.thinkingLevel } }
              : {}),
          },
        });
        extractedText = (res.text || '').trim();
        title = `URL Intake: ${url}`;
        logGeminiUsage({
          action: 'MANUAL_URL_INTAKE',
          toolName: 'urlContext',
          status: 'SUCCESS',
          tokensUsed: res.usageMetadata?.totalTokenCount || 0,
          latencyMs: Date.now() - started,
          details: `Extracted URL intake context for ${url}`,
        });
      } catch (err: any) {
        logGeminiUsage({
          action: 'MANUAL_URL_INTAKE',
          toolName: 'urlContext',
          status: 'ERROR',
          latencyMs: Date.now() - started,
          details: `URL intake failed for ${url}`,
          errorMessage: err?.message,
        });
        extractedText = `Manual URL submitted: ${url}`;
      }
    }
  }

  return {
    platform: input.platform || (url ? inferPlatformFromUrl(url) : 'Manual Intake'),
    connector_id: 'manual_url_capture',
    original_post_url: url || `manual://intake/${Date.now()}`,
    author_name: input.author || 'Prospect',
    username: input.author || null,
    title,
    body: extractedText || 'No description provided.',
    date_posted: new Date().toISOString(),
    country_hint: null,
    service_hint: input.service_hint || 'Auto-detect',
    search_query_used: 'Manual Operator Intake',
    evidence_notes: url ? `Submitted via Manual URL Capture (${url})` : 'Submitted via Manual Post Intake',
  };
}

function inferPlatformFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('reddit.com')) return 'Reddit';
  if (lower.includes('linkedin.com')) return 'LinkedIn';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X/Twitter';
  if (lower.includes('facebook.com')) return 'Facebook';
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('tiktok.com')) return 'TikTok';
  if (lower.includes('github.com')) return 'GitHub';
  if (lower.includes('indiehackers.com')) return 'Indie Hackers';
  if (lower.includes('news.ycombinator.com')) return 'Hacker News';
  if (lower.includes('producthunt.com')) return 'Product Hunt';
  if (lower.includes('upwork.com')) return 'Upwork';
  if (lower.includes('fiverr.com')) return 'Fiverr';
  if (lower.includes('freelancer.com')) return 'Freelancer';
  if (lower.includes('contra.com')) return 'Contra';
  return 'Public Web';
}
