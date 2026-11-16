import type { CredentialFieldMeta, PlatformConnector } from '../shared/types.js';

export interface ConnectorDefinition {
  id: string;
  name: string;
  category: PlatformConnector['category'];
  connection_type: PlatformConnector['connection_type'];
  default_status: PlatformConnector['status'];
  description: string;
  required_env_vars: string[];
  credential_fields: CredentialFieldMeta[];
  requires_approval: boolean;
  setup_instructions: string;
  rate_limit_info: string;
  default_enabled: boolean;
}

export const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    id: 'google_custom_search',
    name: 'Google Custom Search JSON API',
    category: 'Search Engine',
    connection_type: 'CREDENTIAL_REQUIRED',
    default_status: 'MISSING_CREDENTIALS',
    description:
      'Official Google Programmable Search JSON API for discovering public buyer posts across websites, forums, LinkedIn public pages, Indie Hackers, and job boards.',
    required_env_vars: ['GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX'],
    credential_fields: [
      {
        key: 'api_key',
        label: 'Google Custom Search API Key',
        type: 'secret',
        placeholder: 'AIzaSy...',
        required: true,
      },
      {
        key: 'cx',
        label: 'Programmable Search Engine ID (cx)',
        type: 'text',
        placeholder: 'e.g. 017576662512468239146:omuauf_lfve',
        required: true,
      },
    ],
    requires_approval: false,
    setup_instructions:
      'Enable "Custom Search API" in Google Cloud Console to obtain an API Key, and create a search engine at programmablesearchengine.google.com ("Search the entire web") for the CX ID.',
    rate_limit_info: '100 free queries/day; $5 per 1,000 queries',
    default_enabled: true,
  },
  {
    id: 'google_search_grounding',
    name: 'Google Search Grounding (AI Web Search)',
    category: 'Search Engine',
    connection_type: 'GROUNDED_SEARCH',
    default_status: 'UNTESTED',
    description:
      'Real-time Google Search web grounding across public social posts, communities, startup boards, and business sites using the server runtime key.',
    required_env_vars: ['GEMINI_API_KEY'],
    credential_fields: [],
    requires_approval: false,
    setup_instructions:
      'Managed automatically by the server runtime environment secret (GEMINI_API_KEY). Click Test Connection to verify live Google Search grounding.',
    rate_limit_info: 'Managed per discovery run with query deduplication',
    default_enabled: true,
  },
  {
    id: 'reddit_api',
    name: 'Reddit Official OAuth & Community Feeds',
    category: 'Social Media',
    connection_type: 'LIVE_API',
    default_status: 'UNTESTED',
    description:
      'Monitors buyer-intent communities (r/forhire, r/freelance_forhire, r/Entrepreneur, r/smallbusiness, r/SaaS, r/shopify, r/webdev, r/DesignJobs). Uses Reddit OAuth API when configured, or verified subreddit RSS feeds.',
    required_env_vars: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
    credential_fields: [
      {
        key: 'client_id',
        label: 'Reddit App Client ID',
        type: 'text',
        placeholder: '14-char app ID from reddit.com/prefs/apps',
        required: false,
      },
      {
        key: 'client_secret',
        label: 'Reddit App Client Secret',
        type: 'secret',
        placeholder: 'Reddit OAuth secret',
        required: false,
      },
      {
        key: 'user_agent',
        label: 'Reddit API User-Agent (Optional)',
        type: 'text',
        placeholder: 'web:ai-buyer-hunter:v1.0 (by /u/yourusername)',
        required: false,
      },
    ],
    requires_approval: false,
    setup_instructions:
      'For full cross-Reddit search, register an app at reddit.com/prefs/apps and save your Client ID & Secret here. Without OAuth keys, Test Connection probes public subreddit RSS feeds where reachable.',
    rate_limit_info: '100 req/min with OAuth; low-rate RSS fallback',
    default_enabled: true,
  },
  {
    id: 'hacker_news_api',
    name: 'Hacker News (Firebase & Algolia Search API)',
    category: 'Business & Startup',
    connection_type: 'LIVE_API',
    default_status: 'UNTESTED',
    description:
      'Official Hacker News public Firebase & Algolia APIs monitoring Ask HN, Hiring, and startup threads where founders seek developers, agencies, and SaaS help.',
    required_env_vars: [],
    credential_fields: [],
    requires_approval: false,
    setup_instructions: 'No API credentials required. Click Test Connection to verify live connectivity.',
    rate_limit_info: 'Public read-only API',
    default_enabled: true,
  },
  {
    id: 'remoteok_public_feed',
    name: 'RemoteOK Public Opportunities',
    category: 'Freelance & Hiring',
    connection_type: 'LIVE_API',
    default_status: 'UNTESTED',
    description:
      'Public JSON feed of technology, design, marketing, and software contract opportunities worldwide.',
    required_env_vars: [],
    credential_fields: [],
    requires_approval: false,
    setup_instructions: 'No API credentials required. Click Test Connection to verify live feed availability.',
    rate_limit_info: 'Cached & rate-limited public feed',
    default_enabled: true,
  },
  {
    id: 'weworkremotely_rss',
    name: 'WeWorkRemotely Public RSS',
    category: 'Freelance & Hiring',
    connection_type: 'LIVE_API',
    default_status: 'UNTESTED',
    description:
      'Public RSS feed for software, design, product, and digital marketing hiring requests.',
    required_env_vars: [],
    credential_fields: [],
    requires_approval: false,
    setup_instructions: 'No API credentials required. Click Test Connection to verify live RSS feed.',
    rate_limit_info: 'Standard RSS polling',
    default_enabled: true,
  },
  {
    id: 'github_public_search',
    name: 'GitHub Public Issues & Bounties',
    category: 'Business & Startup',
    connection_type: 'LIVE_API',
    default_status: 'UNTESTED',
    description:
      'Searches public GitHub issues/requests for companies seeking contractors, integrations, website/app builds, or automation consultants.',
    required_env_vars: [],
    credential_fields: [
      {
        key: 'token',
        label: 'GitHub Personal Access Token (Optional)',
        type: 'secret',
        placeholder: 'ghp_... (optional; increases rate limit)',
        required: false,
      },
    ],
    requires_approval: false,
    setup_instructions:
      'Works publicly at 10 search req/min without credentials, or add a read-only GitHub PAT for 30 req/min.',
    rate_limit_info: '10 req/min unauthenticated · 30 req/min with PAT',
    default_enabled: true,
  },
  {
    id: 'custom_community_feeds',
    name: 'Custom Business Communities (RSS / JSON)',
    category: 'Business & Startup',
    connection_type: 'LIVE_API',
    default_status: 'MISSING_CREDENTIALS',
    description:
      'Modular connector for additional public startup forums, local business RFPs, Dev.to, or agency job boards configured below via RSS or JSON feeds.',
    required_env_vars: [],
    credential_fields: [],
    requires_approval: false,
    setup_instructions:
      'Add one or more verified public RSS or JSON feed URLs in the Custom Business Community Feeds panel below.',
    rate_limit_info: 'Respectful per-feed polling',
    default_enabled: true,
  },
  {
    id: 'linkedin_official_api',
    name: 'LinkedIn Marketing / Community API',
    category: 'Social Media',
    connection_type: 'CREDENTIAL_REQUIRED',
    default_status: 'APPROVAL_REQUIRED',
    description:
      'Official LinkedIn OAuth Partner API. Public LinkedIn discovery without partner approval is only permitted via Google Search or Manual URL Intake.',
    required_env_vars: ['LINKEDIN_ACCESS_TOKEN'],
    credential_fields: [
      {
        key: 'access_token',
        label: 'LinkedIn OAuth 2.0 Access Token',
        type: 'secret',
        placeholder: 'AQV...',
        required: true,
      },
    ],
    requires_approval: true,
    setup_instructions:
      'Requires LinkedIn Developer App + Marketing Developer / Community Management API Partner approval.',
    rate_limit_info: 'Per LinkedIn Partner tier',
    default_enabled: false,
  },
  {
    id: 'upwork_official_api',
    name: 'Upwork GraphQL API',
    category: 'Freelance & Hiring',
    connection_type: 'CREDENTIAL_REQUIRED',
    default_status: 'APPROVAL_REQUIRED',
    description:
      'Official Upwork GraphQL API for authorized marketplace job discovery. Never scrapes protected marketplace pages.',
    required_env_vars: ['UPWORK_API_KEY'],
    credential_fields: [
      {
        key: 'access_token',
        label: 'Upwork OAuth2 Access Token',
        type: 'secret',
        placeholder: 'oauth2v2_...',
        required: true,
      },
    ],
    requires_approval: true,
    setup_instructions:
      'Apply for API access at upwork.com/developer. Once approved, save your OAuth2 Access Token and run Test Connection.',
    rate_limit_info: 'Per Upwork Developer contract',
    default_enabled: false,
  },
  {
    id: 'fiverr_partner_api',
    name: 'Fiverr Partner / Briefs API',
    category: 'Freelance & Hiring',
    connection_type: 'CREDENTIAL_REQUIRED',
    default_status: 'APPROVAL_REQUIRED',
    description:
      'Reserved connector for approved Fiverr Partner / Enterprise integrations. Fiverr does not provide an open self-serve buyer-request search API.',
    required_env_vars: ['FIVERR_PARTNER_API_KEY'],
    credential_fields: [
      {
        key: 'api_key',
        label: 'Fiverr Partner API Key',
        type: 'secret',
        placeholder: 'Requires approved Fiverr Partner onboarding',
        required: true,
      },
    ],
    requires_approval: true,
    setup_instructions:
      'Requires direct commercial partnership approval from Fiverr. Until approved, submit public Fiverr buyer briefs through Manual URL Intake.',
    rate_limit_info: 'Partner agreement required',
    default_enabled: false,
  },
  {
    id: 'meta_facebook_instagram',
    name: 'Meta Graph API (Facebook & Instagram)',
    category: 'Social Media',
    connection_type: 'CREDENTIAL_REQUIRED',
    default_status: 'APPROVAL_REQUIRED',
    description:
      'Official Meta Graph API for authorized public business Pages and Instagram business accounts. Private Facebook Groups are never scraped.',
    required_env_vars: ['META_GRAPH_TOKEN'],
    credential_fields: [
      {
        key: 'access_token',
        label: 'Meta Graph Page/App Access Token',
        type: 'secret',
        placeholder: 'EAA...',
        required: true,
      },
      {
        key: 'page_ids',
        label: 'Monitored Public Page IDs (Comma-separated)',
        type: 'text',
        placeholder: 'e.g. 104218991234567',
        required: false,
      },
    ],
    requires_approval: true,
    setup_instructions:
      'Requires Meta App Review (pages_read_engagement / instagram_basic). Configure token & optional Page IDs to verify.',
    rate_limit_info: '200 calls/user/hour',
    default_enabled: false,
  },
  {
    id: 'x_twitter_api',
    name: 'X (Twitter) v2 Search API',
    category: 'Social Media',
    connection_type: 'CREDENTIAL_REQUIRED',
    default_status: 'APPROVAL_REQUIRED',
    description:
      'Official X API v2 Recent Search endpoint for real-time public buyer intent tweets.',
    required_env_vars: ['X_BEARER_TOKEN'],
    credential_fields: [
      {
        key: 'bearer_token',
        label: 'X API v2 Bearer Token',
        type: 'secret',
        placeholder: 'AAAA...',
        required: true,
      },
    ],
    requires_approval: true,
    setup_instructions:
      'Requires X Developer Portal Basic or Pro plan (Free tier does not include Tweet Recent Search).',
    rate_limit_info: 'Per X Developer tier (60 req/15m on Basic)',
    default_enabled: false,
  },
  {
    id: 'bing_search_api',
    name: 'Bing Web Search API (Azure)',
    category: 'Search Engine',
    connection_type: 'CREDENTIAL_REQUIRED',
    default_status: 'MISSING_CREDENTIALS',
    description:
      'Secondary global web search integration via Microsoft Azure Bing Search v7 API.',
    required_env_vars: ['BING_SEARCH_API_KEY'],
    credential_fields: [
      {
        key: 'api_key',
        label: 'Azure Bing Search v7 Key',
        type: 'secret',
        placeholder: 'Azure Cognitive Services subscription key',
        required: true,
      },
    ],
    requires_approval: false,
    setup_instructions: 'Provision a Bing Search v7 resource in Microsoft Azure and enter the subscription key.',
    rate_limit_info: 'Per Azure tier',
    default_enabled: false,
  },
  {
    id: 'manual_url_capture',
    name: 'Manual URL & Post Intake',
    category: 'Automation',
    connection_type: 'MANUAL_CAPTURE',
    default_status: 'MANUAL_ONLY',
    description:
      'Submit any public post URL or copied buyer request from Facebook Groups, LinkedIn, Upwork, Fiverr, or X for full 8-agent analysis.',
    required_env_vars: [],
    credential_fields: [],
    requires_approval: false,
    setup_instructions: 'Always available inside Global Lead Discovery for operator-supplied public posts.',
    rate_limit_info: 'On-demand operator intake',
    default_enabled: true,
  },
];

export function getConnectorDefinition(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_DEFINITIONS.find((c) => c.id === id);
}
