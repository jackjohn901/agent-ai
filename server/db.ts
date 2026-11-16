import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import type {
  AgentConfig,
  AppSettings,
  CustomCommunityFeed,
  DashboardMetrics,
  EmailAnalyticsResponse,
  LeadRecord,
  PlatformConnector,
  ResearchLogItem,
  SearchSchedule,
  ServiceCategory,
  TargetCountrySet,
  UserPermissions,
  UserRole,
} from '../shared/types.js';
import { CONNECTOR_DEFINITIONS, getConnectorDefinition } from './connectorRegistry.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'buyer_hunter.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const SUPER_ADMIN_EMAIL = 'shedrackemmanuelgim@gmail.com';

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'operator', 'viewer')),
      is_owner INTEGER NOT NULL DEFAULT 0,
      password_setup_required INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_code TEXT UNIQUE NOT NULL,
      prospect_name TEXT NOT NULL,
      company_name TEXT,
      username TEXT,
      social_platform TEXT NOT NULL,
      original_post_url TEXT NOT NULL,
      date_posted TEXT,
      date_discovered TEXT NOT NULL DEFAULT (datetime('now')),
      country TEXT,
      city TEXT,
      service_requested TEXT NOT NULL,
      project_description TEXT NOT NULL,
      original_buyer_statement TEXT NOT NULL,
      intent_classification TEXT NOT NULL,
      lead_score INTEGER NOT NULL DEFAULT 0,
      lead_priority TEXT NOT NULL,
      score_breakdown_json TEXT NOT NULL,
      budget TEXT,
      budget_evidence_type TEXT NOT NULL DEFAULT 'UNKNOWN',
      urgency TEXT NOT NULL DEFAULT 'UNKNOWN',
      project_status TEXT NOT NULL DEFAULT 'Active Opportunity',
      decision_maker_status TEXT NOT NULL DEFAULT 'Unknown',
      company_website TEXT,
      public_business_email TEXT,
      public_profile_url TEXT,
      preferred_contact_method TEXT,
      evidence_url TEXT NOT NULL,
      evidence_notes TEXT NOT NULL,
      ai_opportunity_analysis_json TEXT NOT NULL,
      outreach_subject TEXT NOT NULL DEFAULT '',
      outreach_message TEXT NOT NULL DEFAULT '',
      outreach_variants_json TEXT NOT NULL DEFAULT '{}',
      outreach_approval_status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      follow_up_date TEXT,
      deal_status TEXT NOT NULL DEFAULT 'Message Prepared',
      deal_value REAL NOT NULL DEFAULT 0,
      revenue_received REAL NOT NULL DEFAULT 0,
      assigned_service_provider TEXT,
      internal_notes TEXT NOT NULL DEFAULT '',
      canonical_lead_id INTEGER,
      additional_sources_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_url ON leads(original_post_url);
    CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(lead_score DESC);
    CREATE INDEX IF NOT EXISTS idx_leads_intent ON leads(intent_classification);
    CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(social_platform);

    CREATE TABLE IF NOT EXISTS contact_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('OUTBOUND', 'INBOUND')),
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suppression_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT UNIQUE NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      platform TEXT NOT NULL,
      service_category TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'Worldwide',
      results_count INTEGER NOT NULL DEFAULT 0,
      accepted_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      rejection_reasons_json TEXT NOT NULL DEFAULT '[]',
      execution_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'SUCCESS',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS duplicate_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_lead_id INTEGER NOT NULL,
      duplicate_source_url TEXT NOT NULL,
      platform TEXT NOT NULL,
      match_reason TEXT NOT NULL,
      similarity_score INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (canonical_lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS service_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      group_name TEXT NOT NULL,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      is_emerging INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS platforms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      connection_type TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT NOT NULL,
      required_env_vars_json TEXT NOT NULL DEFAULT '[]',
      rate_limit_info TEXT NOT NULL,
      last_checked_at TEXT,
      last_error TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS connector_credentials (
      connector_id TEXT NOT NULL,
      field_key TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      masked_preview TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (connector_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS custom_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT UNIQUE NOT NULL,
      feed_type TEXT NOT NULL CHECK(feed_type IN ('RSS', 'JSON')),
      status TEXT NOT NULL DEFAULT 'UNTESTED',
      last_checked_at TEXT,
      last_error TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      agent_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      role_description TEXT NOT NULL,
      model_name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      runs_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'IDLE'
    );

    CREATE TABLE IF NOT EXISTS search_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      services_json TEXT NOT NULL,
      platforms_json TEXT NOT NULL,
      countries_json TEXT NOT NULL,
      min_score INTEGER NOT NULL DEFAULT 60,
      max_results INTEGER NOT NULL DEFAULT 10,
      frequency_minutes INTEGER NOT NULL DEFAULT 60,
      is_active INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      next_run_at TEXT
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK(level IN ('INFO', 'WARN', 'ERROR', 'AUDIT')),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS target_country_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      countries_json TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('gmail_oauth', 'microsoft_oauth', 'smtp', 'resend_api', 'sendgrid_api', 'sandbox_test')),
      email_address TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'UNTESTED' CHECK(status IN ('UNTESTED', 'CONNECTED', 'AUTH_ERROR', 'EXPIRED', 'DISCONNECTED')),
      encrypted_credentials TEXT,
      token_expires_at TEXT,
      daily_limit INTEGER NOT NULL DEFAULT 100,
      hourly_limit INTEGER NOT NULL DEFAULT 25,
      sent_today INTEGER NOT NULL DEFAULT 0,
      sent_this_hour INTEGER NOT NULL DEFAULT 0,
      sent_window_date TEXT NOT NULL DEFAULT (date('now')),
      sent_window_hour TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H', 'now')),
      smtp_host TEXT,
      smtp_port INTEGER,
      last_tested_at TEXT,
      last_error TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_user_id INTEGER NOT NULL,
      default_email_account_id INTEGER,
      target_countries_json TEXT NOT NULL DEFAULT '[]',
      target_services_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'PAUSED', 'COMPLETED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (default_email_account_id) REFERENCES email_accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS email_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      lead_id INTEGER NOT NULL,
      owner_user_id INTEGER NOT NULL,
      email_account_id INTEGER,
      recipient_email TEXT NOT NULL DEFAULT '',
      prospect_name TEXT NOT NULL,
      company_name TEXT,
      country TEXT,
      service_requested TEXT NOT NULL,
      original_buyer_request TEXT NOT NULL,
      source_url TEXT NOT NULL,
      lead_score INTEGER NOT NULL DEFAULT 0,
      detected_language TEXT NOT NULL DEFAULT 'English',
      subject_local TEXT NOT NULL DEFAULT '',
      body_local TEXT NOT NULL DEFAULT '',
      subject_english TEXT NOT NULL DEFAULT '',
      body_english TEXT NOT NULL DEFAULT '',
      call_to_action TEXT NOT NULL DEFAULT '',
      approval_status TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL' CHECK(approval_status IN ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'REJECTED', 'FAILED')),
      approved_by_user_id INTEGER,
      approved_by_email TEXT,
      approved_at TEXT,
      rejected_by_email TEXT,
      rejected_at TEXT,
      is_follow_up INTEGER NOT NULL DEFAULT 0,
      follow_up_step INTEGER NOT NULL DEFAULT 0,
      compliance_notes TEXT NOT NULL DEFAULT '',
      provider_message_id TEXT,
      error_message TEXT,
      sent_at TEXT,
      delivered_at TEXT,
      replied_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(approval_status);
    CREATE INDEX IF NOT EXISTS idx_email_messages_lead ON email_messages(lead_id);
    CREATE INDEX IF NOT EXISTS idx_email_messages_owner ON email_messages(owner_user_id);

    CREATE TABLE IF NOT EXISTS email_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_message_id INTEGER UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      email_account_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'PROCESSING', 'SENT', 'RETRYING', 'FAILED', 'CANCELLED')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_error TEXT,
      locked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (email_message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sandbox_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_message_id INTEGER NOT NULL,
      from_email TEXT NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DELIVERED_SANDBOX',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (email_message_id) REFERENCES email_messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS universal_integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('MCP', 'API')),
      is_builtin INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'Custom',
      description TEXT NOT NULL DEFAULT '',
      endpoint_url TEXT NOT NULL DEFAULT '',
      transport_type TEXT CHECK(transport_type IN ('streamable_http', 'sse')),
      auth_type TEXT NOT NULL DEFAULT 'none' CHECK(auth_type IN ('none', 'bearer', 'api_key', 'oauth2', 'custom_headers')),
      status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK(status IN ('NOT_CONFIGURED', 'AWAITING_APPROVAL', 'PENDING_AUTH', 'CONNECTED', 'EXPIRED', 'ERROR', 'DISABLED', 'UNSUPPORTED')),
      is_enabled INTEGER NOT NULL DEFAULT 1,
      tools_json TEXT NOT NULL DEFAULT '[]',
      config_json TEXT NOT NULL DEFAULT '{}',
      oauth_config_json TEXT NOT NULL DEFAULT '{}',
      credential_fields_json TEXT NOT NULL DEFAULT '[]',
      capabilities_summary_json TEXT NOT NULL DEFAULT '[]',
      limitations_note TEXT,
      rate_limit_info TEXT NOT NULL DEFAULT '',
      api_calls_count INTEGER NOT NULL DEFAULT 0,
      credits_used INTEGER NOT NULL DEFAULT 0,
      last_tested_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS integration_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      action TEXT NOT NULL,
      tool_name TEXT,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'ERROR', 'BLOCKED')),
      credits_consumed INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      details TEXT NOT NULL DEFAULT '',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_integration_usage_id ON integration_usage_logs(integration_id, id DESC);
  `);

  migrateUsersTableIfNeeded();
  migrateExtendedColumns();
  seedInitialConfiguration();
}

function migrateUsersTableIfNeeded() {
  const tableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql?: string } | undefined;

  if (tableInfo?.sql && !tableInfo.sql.includes("'super_admin'")) {
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE users_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'operator', 'viewer')),
          is_owner INTEGER NOT NULL DEFAULT 0,
          password_setup_required INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_login_at TEXT
        );
        INSERT INTO users_migrated (id, name, email, password_hash, role, is_owner, password_setup_required, created_at, last_login_at)
        SELECT id, name, email, password_hash, role, 0, 0, created_at, last_login_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
      `);
    });
    tx();
    db.pragma('foreign_keys = ON');
  }
}

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateExtendedColumns() {
  ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  ensureColumn('users', 'permissions_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('users', 'daily_send_limit', 'INTEGER NOT NULL DEFAULT 50');
  ensureColumn('users', 'hourly_send_limit', 'INTEGER NOT NULL DEFAULT 15');
  ensureColumn('users', 'max_concurrent_sends', 'INTEGER NOT NULL DEFAULT 5');
  ensureColumn('users', 'invited_by', 'TEXT');
  ensureColumn('users', 'invite_token_hash', 'TEXT');

  ensureColumn('leads', 'assigned_user_id', 'INTEGER');
  ensureColumn('leads', 'detected_language', 'TEXT');
  ensureColumn('leads', 'campaign_id', 'INTEGER');
  ensureColumn('leads', 'contact_email_status', "TEXT NOT NULL DEFAULT 'EMAIL_UNAVAILABLE'");
  ensureColumn('leads', 'contact_verification_source', 'TEXT');
  ensureColumn('leads', 'contact_evidence_notes', 'TEXT');
  ensureColumn('leads', 'decision_maker_role', 'TEXT');
  ensureColumn('leads', 'company_industry', 'TEXT');
  ensureColumn('leads', 'company_research_summary', 'TEXT');
  ensureColumn('leads', 'enrichment_credits_used', 'INTEGER NOT NULL DEFAULT 0');
}

export function defaultPermissionsForRole(role: UserRole): UserPermissions {
  if (role === 'super_admin') {
    return {
      can_discover: true,
      can_generate_emails: true,
      can_approve_emails: true,
      can_send_emails: true,
      can_connect_email_accounts: true,
      can_manage_leads: true,
      can_view_analytics: true,
    };
  }
  if (role === 'admin') {
    return {
      can_discover: true,
      can_generate_emails: true,
      can_approve_emails: true,
      can_send_emails: true,
      can_connect_email_accounts: true,
      can_manage_leads: true,
      can_view_analytics: true,
    };
  }
  if (role === 'operator') {
    return {
      can_discover: true,
      can_generate_emails: true,
      can_approve_emails: true,
      can_send_emails: true,
      can_connect_email_accounts: true,
      can_manage_leads: true,
      can_view_analytics: true,
    };
  }
  return {
    can_discover: false,
    can_generate_emails: false,
    can_approve_emails: false,
    can_send_emails: false,
    can_connect_email_accounts: false,
    can_manage_leads: false,
    can_view_analytics: true,
  };
}

export function parseUserPermissions(rawJson: string | null | undefined, role: UserRole): UserPermissions {
  const base = defaultPermissionsForRole(role);
  if (role === 'super_admin') return base;
  try {
    const parsed = JSON.parse(rawJson || '{}');
    return {
      can_discover: parsed.can_discover !== undefined ? Boolean(parsed.can_discover) : base.can_discover,
      can_generate_emails: parsed.can_generate_emails !== undefined ? Boolean(parsed.can_generate_emails) : base.can_generate_emails,
      can_approve_emails: parsed.can_approve_emails !== undefined ? Boolean(parsed.can_approve_emails) : base.can_approve_emails,
      can_send_emails: parsed.can_send_emails !== undefined ? Boolean(parsed.can_send_emails) : base.can_send_emails,
      can_connect_email_accounts:
        parsed.can_connect_email_accounts !== undefined
          ? Boolean(parsed.can_connect_email_accounts)
          : base.can_connect_email_accounts,
      can_manage_leads: parsed.can_manage_leads !== undefined ? Boolean(parsed.can_manage_leads) : base.can_manage_leads,
      can_view_analytics: parsed.can_view_analytics !== undefined ? Boolean(parsed.can_view_analytics) : base.can_view_analytics,
    };
  } catch {
    return base;
  }
}

function seedInitialConfiguration() {
  // 1. Ensure permanent Owner & Super Admin account exists without inventing a hardcoded password
  db.prepare(
    "DELETE FROM users WHERE lower(email) IN ('admin@aibuyerhunter.local', 'operator@aibuyerhunter.local')"
  ).run();

  const existingOwner = db
    .prepare('SELECT id, password_hash FROM users WHERE lower(email) = lower(?)')
    .get(SUPER_ADMIN_EMAIL) as { id: number; password_hash: string } | undefined;

  if (!existingOwner) {
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, is_owner, password_setup_required)
       VALUES (?, ?, '', 'super_admin', 1, 1)`
    ).run('Shedrack Emmanuel', SUPER_ADMIN_EMAIL);
  } else {
    const needsSetup = !existingOwner.password_hash ? 1 : 0;
    db.prepare(
      `UPDATE users
       SET role = 'super_admin',
           is_owner = 1,
           password_setup_required = CASE WHEN password_hash = '' THEN 1 ELSE password_setup_required END
       WHERE id = ?`
    ).run(existingOwner.id);
    if (needsSetup) {
      db.prepare('UPDATE users SET password_setup_required = 1 WHERE id = ?').run(existingOwner.id);
    }
  }

  // 2. Seed all 50+ Digital Service Categories from Part 1
  const catCount = (db.prepare('SELECT COUNT(*) as c FROM service_categories').get() as { c: number }).c;
  if (catCount === 0) {
    const services: Array<[string, string, string[]]> = [
      ['Website development', 'Web & CMS Development', ['build a website', 'web developer', 'new website']],
      ['WordPress development', 'Web & CMS Development', ['wordpress expert', 'wp developer', 'elementor', 'wordpress site']],
      ['Laravel development', 'Web & CMS Development', ['laravel developer', 'laravel expert', 'php laravel']],
      ['PHP development', 'Web & CMS Development', ['php developer', 'php programmer', 'fix php']],
      ['Custom website development', 'Web & CMS Development', ['custom website', 'bespoke web', 'react developer']],
      ['Website redesign', 'Web & CMS Development', ['website redesign', 'revamp website', 'modernize site']],
      ['Website maintenance', 'Web & CMS Development', ['website maintenance', 'fix my website', 'site support']],
      ['Mobile application development', 'Mobile & Software', ['mobile app', 'app developer', 'create an app']],
      ['Android application development', 'Mobile & Software', ['android app', 'kotlin developer', 'play store app']],
      ['iOS application development', 'Mobile & Software', ['ios app', 'swift developer', 'iphone app']],
      ['SaaS development', 'Mobile & Software', ['build a saas', 'saas mvp', 'saas platform']],
      ['Web application development', 'Mobile & Software', ['web app', 'web application', 'portal development']],
      ['Software development', 'Mobile & Software', ['software developer', 'software team', 'custom software']],
      ['AI application development', 'AI & Automation', ['ai app', 'llm integration', 'gemini app', 'openai app']],
      ['AI chatbot development', 'AI & Automation', ['ai chatbot', 'support bot', 'custom gpt bot']],
      ['AI agent development', 'AI & Automation', ['ai agent', 'autonomous agent', 'multi-agent']],
      ['Business automation', 'AI & Automation', ['workflow automation', 'n8n', 'zapier', 'make.com', 'automate business']],
      ['API integration', 'AI & Automation', ['api integration', 'connect api', 'webhook integration']],
      ['UI/UX design', 'Design & Branding', ['ui ux designer', 'figma designer', 'product design']],
      ['Graphic design', 'Design & Branding', ['graphic designer', 'brand assets', 'marketing creatives']],
      ['Logo and brand identity', 'Design & Branding', ['logo design', 'brand identity', 'rebrand']],
      ['E-commerce website development', 'E-Commerce', ['ecommerce site', 'online store', 'sell online']],
      ['Shopify development', 'E-Commerce', ['shopify store', 'shopify expert', 'shopify liquid']],
      ['WooCommerce development', 'E-Commerce', ['woocommerce', 'wordpress store', 'woo checkout']],
      ['Landing page development', 'E-Commerce', ['landing page', 'sales page', 'high converting page']],
      ['Search engine optimization', 'Growth & Paid Media', ['seo expert', 'rank on google', 'technical seo']],
      ['Answer engine optimization', 'Growth & Paid Media', ['aeo', 'geo optimization', 'ai search optimization']],
      ['Digital marketing', 'Growth & Paid Media', ['digital marketing', 'marketing agency', 'growth strategist']],
      ['Facebook advertising', 'Growth & Paid Media', ['facebook ads', 'meta ads specialist', 'fb media buyer']],
      ['Instagram advertising', 'Growth & Paid Media', ['instagram ads', 'ig ads manager']],
      ['Google advertising', 'Growth & Paid Media', ['google ads', 'ppc specialist', 'adwords']],
      ['TikTok advertising', 'Growth & Paid Media', ['tiktok ads', 'tiktok media buyer']],
      ['Social media management', 'Growth & Paid Media', ['social media manager', 'manage socials']],
      ['Video editing', 'Video & Animation', ['video editor', 'reels editor', 'premiere editor']],
      ['Video production', 'Video & Animation', ['video production', 'commercial video']],
      ['2D animation', 'Video & Animation', ['2d animation', 'motion graphics', 'after effects']],
      ['3D animation', 'Video & Animation', ['3d animation', 'blender artist', '3d product render']],
      ['AI-generated video production', 'Video & Animation', ['ai video', 'ai commercial', 'synthetic video']],
      ['Explainer videos', 'Video & Animation', ['explainer video', 'saas demo video']],
      ['Promotional videos', 'Video & Animation', ['promo video', 'launch video']],
      ['Product advertisement videos', 'Video & Animation', ['product ad video', 'ugc video ad', 'ecom video ad']],
      ['YouTube content creation', 'Content & Lifecycle', ['youtube producer', 'youtube scriptwriter', 'thumbnail designer']],
      ['YouTube automation', 'Content & Lifecycle', ['youtube automation', 'faceless youtube channel']],
      ['Content writing', 'Content & Lifecycle', ['content writer', 'blog writer', 'technical writer']],
      ['Sales copywriting', 'Content & Lifecycle', ['copywriter', 'sales copy', 'landing page copy']],
      ['Email marketing', 'Content & Lifecycle', ['email marketing', 'klaviyo expert', 'email flows']],
      ['Lead generation', 'Content & Lifecycle', ['lead generation', 'b2b leads', 'outbound agency']],
      ['CRM development', 'CRM & Systems', ['crm setup', 'hubspot expert', 'custom crm', 'salesforce']],
      ['Chatbot integration', 'CRM & Systems', ['chatbot integration', 'intercom bot', 'whatsapp bot']],
      ['Other digital & technology services', 'Emerging Services', ['tech consultant', 'fractional cto', 'cloud migration']],
    ];
    const stmt = db.prepare(
      'INSERT INTO service_categories (name, group_name, keywords_json, is_emerging, is_active) VALUES (?, ?, ?, 0, 1)'
    );
    const tx = db.transaction(() => {
      for (const [name, group, kw] of services) {
        stmt.run(name, group, JSON.stringify(kw));
      }
    });
    tx();
  }

  // 3. Seed & migrate Platform Connectors truthfully (never hardcode CONNECTED/READY without a live test)
  db.prepare("DELETE FROM platforms WHERE id = 'reddit_public_json'").run();
  db.prepare("UPDATE platforms SET status = 'UNTESTED' WHERE status = 'CONNECTED'").run();

  const insertPlatform = db.prepare(`
    INSERT INTO platforms (id, name, category, connection_type, status, description, required_env_vars_json, rate_limit_info, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      connection_type = excluded.connection_type,
      description = excluded.description,
      required_env_vars_json = excluded.required_env_vars_json,
      rate_limit_info = excluded.rate_limit_info
  `);
  for (const p of CONNECTOR_DEFINITIONS) {
    insertPlatform.run(
      p.id,
      p.name,
      p.category,
      p.connection_type,
      p.default_status,
      p.description,
      JSON.stringify(p.required_env_vars),
      p.rate_limit_info,
      p.default_enabled ? 1 : 0
    );
  }
  // Ensure manual capture is always MANUAL_ONLY
  db.prepare("UPDATE platforms SET status = 'MANUAL_ONLY' WHERE id = 'manual_url_capture'").run();

  // 4. Seed 8 AI Agents
  const agentCount = (db.prepare('SELECT COUNT(*) as c FROM ai_agents').get() as { c: number }).c;
  if (agentCount === 0) {
    const agents: Array<[number, string, string, string, string]> = [
      [1, 'agent_discovery', 'Global Discovery Agent', 'Generates multi-variation buyer queries and collects public opportunities across authorized sources.', 'gemini-4-hydrogen'],
      [2, 'agent_intent', 'Buyer Intent Agent', 'Classifies posts into Direct, Active, Recommendation, Upcoming, Discussion, or Service Provider; rejects E & F.', 'gemini-4-hydrogen'],
      [3, 'agent_intel', 'Business Intelligence Agent', 'Extracts verifiable company, website, geography, role, and public contact details without fabrication.', 'gemini-4-hydrogen'],
      [4, 'agent_budget', 'Budget & Opportunity Agent', 'Separates explicitly stated budgets from AI-estimated opportunity values and unknown budgets.', 'gemini-4-hydrogen'],
      [5, 'agent_dedup', 'Duplicate Detection Agent', 'Matches name, username, domain, post URL, and project overlap to maintain canonical deduplicated leads.', 'deterministic+gemini-4-hydrogen'],
      [6, 'agent_scoring', 'Lead Scoring Agent', 'Applies exact 100-point commercial scoring rubric (25+15+15+15+15+10+5) and priority tiers.', 'gemini-4-hydrogen'],
      [7, 'agent_outreach', 'Personalized Outreach Agent', 'Drafts non-generic 7-step outreach across 5 channels strictly awaiting human approval.', 'gemini-4-hydrogen'],
      [8, 'agent_conversion', 'Conversion & Follow-Up Agent', 'Manages CRM progression, suppression list compliance, and context-aware follow-up recommendations.', 'gemini-4-hydrogen'],
    ];
    const insAgent = db.prepare(
      'INSERT INTO ai_agents (agent_number, id, name, role_description, model_name) VALUES (?, ?, ?, ?, ?)'
    );
    for (const a of agents) insAgent.run(...a);
  }

  // 5. Seed Default Search Schedules (paused by default until operator enables)
  const schedCount = (db.prepare('SELECT COUNT(*) as c FROM search_schedules').get() as { c: number }).c;
  if (schedCount === 0) {
    db.prepare(`
      INSERT INTO search_schedules (name, services_json, platforms_json, countries_json, min_score, max_results, frequency_minutes, is_active, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now', '+60 minutes'))
    `).run(
      'Global High-Intent Web, SaaS & AI Buyers',
      JSON.stringify(['Website development', 'SaaS development', 'AI agent development', 'Shopify development']),
      JSON.stringify(['google_custom_search', 'google_search_grounding', 'reddit_api', 'hacker_news_api']),
      JSON.stringify(['Worldwide']),
      60,
      10,
      120
    );
  }

  // 6. Default Settings
  const defaults: Record<string, string> = {
    thirty_day_revenue_target: '5000',
    stretch_revenue_target: '25000',
    stretch_target_deadline: '2026-12-25',
    default_currency: 'USD',
    data_retention_days: '365',
    max_requests_per_minute: '20',
    auto_generate_outreach: 'true',
    n8n_webhook_url: process.env.N8N_WEBHOOK_URL || '',
    owner_daily_send_limit: '250',
    owner_hourly_send_limit: '50',
    owner_max_concurrent_sends: '10',
    invited_default_concurrent_sends: '5',
    sandbox_mode: 'false',
  };
  const insSet = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insSet.run(k, v);
  }

  // 7. Ensure requested Module 5 services are always present
  const extraServices: Array<[string, string, string[]]> = [
    ['React development', 'Web & CMS Development', ['react developer', 'nextjs developer', 'frontend react']],
    ['Workflow automation', 'AI & Automation', ['workflow automation', 'make.com', 'n8n workflow', 'zapier automation']],
    ['Branding', 'Design & Branding', ['branding agency', 'brand strategy', 'rebranding']],
    ['Advertising', 'Growth & Paid Media', ['paid ads', 'ad campaign manager', 'media buyer']],
    ['Content creation', 'Content & Lifecycle', ['content creator', 'ugc creator', 'video content creator']],
  ];
  const insExtra = db.prepare(
    'INSERT OR IGNORE INTO service_categories (name, group_name, keywords_json, is_emerging, is_active) VALUES (?, ?, ?, 0, 1)'
  );
  for (const [name, group, kw] of extraServices) {
    insExtra.run(name, group, JSON.stringify(kw));
  }

  // 8. Seed a default Target Country Set for the Owner if none exists
  const ownerRow = db
    .prepare('SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1')
    .get(SUPER_ADMIN_EMAIL) as { id: number } | undefined;
  if (ownerRow) {
    const tcCount = (db.prepare('SELECT COUNT(*) as c FROM target_country_sets').get() as { c: number }).c;
    if (tcCount === 0) {
      db.prepare(
        `INSERT INTO target_country_sets (name, countries_json, is_default, owner_user_id)
         VALUES (?, ?, 1, ?)`
      ).run(
        'Global Core Markets (Starter Set)',
        JSON.stringify(['United States', 'United Kingdom', 'Canada', 'Germany', 'Australia', 'Netherlands', 'United Arab Emirates', 'Singapore']),
        ownerRow.id
      );
    }
  }

  // 9. Seed First-Party Universal Integrations (Apollo MCP, Fiverr MCP, Reddit API, LinkedIn API, Google Gemini API)
  const insUniversal = db.prepare(`
    INSERT INTO universal_integrations (
      id, name, slug, kind, is_builtin, category, description, endpoint_url,
      transport_type, auth_type, status, is_enabled, tools_json, config_json,
      oauth_config_json, credential_fields_json, capabilities_summary_json,
      limitations_note, rate_limit_info
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      endpoint_url = CASE WHEN universal_integrations.endpoint_url = '' THEN excluded.endpoint_url ELSE universal_integrations.endpoint_url END,
      credential_fields_json = excluded.credential_fields_json,
      capabilities_summary_json = excluded.capabilities_summary_json,
      rate_limit_info = excluded.rate_limit_info
  `);

  const firstPartySeeds: Array<any[]> = [
    [
      'apollo_mcp',
      'Apollo MCP',
      'apollo-mcp',
      'MCP',
      'B2B Intelligence & Enrichment',
      'First-party Model Context Protocol connector for Apollo company discovery, decision-maker identification, contact enrichment, and email verification.',
      'https://mcp.apollo.io/mcp',
      'streamable_http',
      'oauth2',
      'NOT_CONFIGURED',
      '[]',
      JSON.stringify({ track_credits: true, auto_enrich_high_intent: false }),
      JSON.stringify({
        authorize_url: '',
        token_url: '',
        scopes: 'mcp:tools',
        redirect_path: '/api/universal-integrations/oauth/apollo_mcp/callback',
      }),
      JSON.stringify([
        { key: 'client_id', label: 'OAuth Client ID (or leave blank for Dynamic Client Registration)', type: 'text', placeholder: 'Auto-discovered or Apollo OAuth Client ID', required: false },
        { key: 'client_secret', label: 'OAuth Client Secret (if confidential client)', type: 'secret', placeholder: 'Optional OAuth Client Secret', required: false },
        { key: 'bearer_token', label: 'Apollo OAuth Bearer / API Access Token (Optional Direct Token)', type: 'secret', placeholder: 'Paste Apollo OAuth token if pre-authorized', required: false },
      ]),
      JSON.stringify([
        'Streamable HTTP MCP server at https://mcp.apollo.io/mcp',
        'OAuth 2.0 owner authorization & dynamic metadata discovery',
        'MCP tool discovery & per-tool permission management',
        'Company discovery, decision-maker research & contact enrichment',
        'Email verification classification & credit consumption logging',
      ]),
      'Requires Apollo account authorization via OAuth 2.0 (or pre-authorized Apollo token). Some enrichment endpoints consume Apollo plan credits.',
      'Depends on Apollo plan tier & credit balance',
    ],
    [
      'fiverr_mcp',
      'Fiverr MCP',
      'fiverr-mcp',
      'MCP',
      'Freelance Marketplace Research',
      'Model Context Protocol connector targeting Fiverr MCP endpoint for live compatibility testing, freelancer/service discovery, and marketplace capability inspection.',
      'https://mcp.fiverr.com/mcp',
      'streamable_http',
      'oauth2',
      'NOT_CONFIGURED',
      '[]',
      JSON.stringify({ allow_fallback_manual_capture: true }),
      JSON.stringify({
        authorize_url: '',
        token_url: '',
        scopes: 'mcp:tools',
        redirect_path: '/api/universal-integrations/oauth/fiverr_mcp/callback',
      }),
      JSON.stringify([
        { key: 'client_id', label: 'Fiverr OAuth Client ID (if issued)', type: 'text', placeholder: 'Optional Fiverr OAuth Client ID', required: false },
        { key: 'client_secret', label: 'Fiverr OAuth Client Secret', type: 'secret', placeholder: 'Optional OAuth Client Secret', required: false },
        { key: 'bearer_token', label: 'Bearer Token (if issued)', type: 'secret', placeholder: 'Optional Bearer Token', required: false },
      ]),
      JSON.stringify([
        'Live Streamable HTTP compatibility probe against https://mcp.fiverr.com/mcp',
        'Real MCP tool discovery when reachable & authorized',
        'Freelancer & service category research when supported by server tools',
      ]),
      'IMPORTANT: Fiverr public MCP/API access may be restricted by Cloudflare WAF, OAuth/session requirements, or limited strictly to freelancer/gig search rather than buyer-request discovery. Manual capture & custom API fallback remain available.',
      'Vendor-managed (may return 403/401/challenge from server IPs)',
    ],
    [
      'reddit_api',
      'Reddit API',
      'reddit-api',
      'API',
      'Social Buyer Communities',
      'Official Reddit OAuth 2.0 API for approved public subreddit & buyer-intent search with commercial license compliance gating and original post evidence capture.',
      'https://oauth.reddit.com',
      null,
      'oauth2',
      'NOT_CONFIGURED',
      JSON.stringify([
        { name: 'search_subreddits', description: 'Search approved subreddits for buyer-intent posts and capture original permalinks.', enabled: true, category: 'Discovery' },
        { name: 'fetch_subreddit_new', description: 'Poll latest posts in approved hiring/business subreddits.', enabled: true, category: 'Discovery' },
        { name: 'fetch_post_context', description: 'Retrieve full thread author and public post context.', enabled: true, category: 'Research' },
      ]),
      JSON.stringify({
        commercial_approved: false,
        commercial_license_notes: '',
        subreddits: ['forhire', 'freelance_forhire', 'Entrepreneur', 'smallbusiness', 'SaaS', 'shopify', 'DesignJobs'],
        approval_stage: 'NOT_SUBMITTED',
      }),
      JSON.stringify({
        authorize_url: 'https://www.reddit.com/api/v1/authorize',
        token_url: 'https://www.reddit.com/api/v1/access_token',
        scopes: 'read identity',
        redirect_path: '/api/universal-integrations/oauth/reddit_api/callback',
      }),
      JSON.stringify([
        { key: 'client_id', label: 'Reddit App Client ID', type: 'text', placeholder: '14+ char Reddit App Client ID', required: true },
        { key: 'client_secret', label: 'Reddit App Client Secret', type: 'secret', placeholder: 'Reddit App Secret', required: true },
        { key: 'user_agent', label: 'Descriptive User-Agent', type: 'text', placeholder: 'web:ai-buyer-hunter:v1.0 (by /u/your_reddit_handle)', required: true },
      ]),
      JSON.stringify([
        'Reddit OAuth 2.0 Authorization Code & Client Credentials support',
        'Approved subreddit & keyword buyer discovery',
        'Full original Reddit post URL & timestamp evidence capture',
        'Strict Commercial Data Access Approval Gate',
      ]),
      'COMMERCIAL COMPLIANCE GATE: Reddit commercial API usage requires formal Reddit Data API approval. Automated commercial collection remains blocked until Commercial Approval is explicitly confirmed.',
      '100 queries / minute (Reddit OAuth tier)',
    ],
    [
      'linkedin_api',
      'LinkedIn API',
      'linkedin-api',
      'API',
      'Professional Network',
      'Official LinkedIn OAuth 2.0 integration strictly scoped to approved LinkedIn Developer products. Displays approved vs. pending partner products transparently.',
      'https://api.linkedin.com/v2',
      null,
      'oauth2',
      'NOT_CONFIGURED',
      JSON.stringify([
        { name: 'get_member_profile', description: 'Read authorized member OpenID profile (requires OpenID Connect product).', enabled: true, category: 'Identity' },
        { name: 'get_ad_lead_forms', description: 'Sync LinkedIn Lead Gen Form responses (requires approved Lead Sync / Marketing API).', enabled: false, category: 'Leads' },
        { name: 'get_organization_posts', description: 'Read organization updates (requires approved Community Management API).', enabled: false, category: 'Research' },
      ]),
      JSON.stringify({
        approved_products: ['openid_connect'],
        pending_products: ['community_management', 'lead_sync', 'advertising_api'],
      }),
      JSON.stringify({
        authorize_url: 'https://www.linkedin.com/oauth/v2/authorization',
        token_url: 'https://www.linkedin.com/oauth/v2/accessToken',
        scopes: 'openid profile email',
        redirect_path: '/api/universal-integrations/oauth/linkedin_api/callback',
      }),
      JSON.stringify([
        { key: 'client_id', label: 'LinkedIn App Client ID', type: 'text', placeholder: 'LinkedIn Developer Client ID', required: true },
        { key: 'client_secret', label: 'LinkedIn App Client Secret', type: 'secret', placeholder: 'LinkedIn Client Secret', required: true },
        { key: 'access_token', label: 'Pre-authorized Access Token (Optional)', type: 'secret', placeholder: 'Populated automatically via OAuth 2.0 flow', required: false },
      ]),
      JSON.stringify([
        'LinkedIn OAuth 2.0 authorization with verified scopes',
        'Transparent matrix of approved vs. pending LinkedIn Partner products',
        'Strictly executes only capabilities permitted by approved token scopes',
      ]),
      'IMPORTANT: LinkedIn standard Sign-In / OpenID Connect does NOT allow unrestricted searching of member posts, private emails, or automated DMs. Lead Sync and Community Management require official LinkedIn Partner approval.',
      'App & Partner tier rate limits apply',
    ],
    [
      'gemini_api',
      'Google Gemini API',
      'gemini-api',
      'API',
      'AI Models & Intelligence',
      'Core Google Gemini AI engine powering query generation, buyer-intent classification, research analysis, multilingual cold email writing, translation, and follow-up intelligence.',
      'https://generativelanguage.googleapis.com',
      null,
      'api_key',
      'NOT_CONFIGURED',
      JSON.stringify([
        { name: 'buyer_discovery_queries', description: 'Generate multi-variation global buyer-intent search queries.', enabled: true, category: 'Discovery' },
        { name: 'buyer_intent_classification', description: 'Classify buyer posts (A-F), extract evidence, and calculate 0-100 commercial scores.', enabled: true, category: 'Qualification' },
        { name: 'company_research_enrichment', description: 'Synthesize verified company website & public evidence summaries.', enabled: true, category: 'Research' },
        { name: 'email_personalization', description: 'Write personalized, compliant B2B cold emails from verified research.', enabled: true, category: 'Outreach' },
        { name: 'translation', description: 'Translate outreach between prospect local business language and English.', enabled: true, category: 'Outreach' },
        { name: 'follow_up_recommendations', description: 'Generate context-aware CRM conversion & follow-up recommendations.', enabled: true, category: 'CRM' },
      ]),
      JSON.stringify({
        active_model: 'gemini-4-hydrogen',
        thinking_level: 'MEDIUM',
        use_env_fallback: true,
        tools: {
          buyer_discovery_queries: true,
          buyer_intent_classification: true,
          company_research_enrichment: true,
          email_personalization: true,
          translation: true,
          follow_up_recommendations: true,
        },
      }),
      JSON.stringify({}),
      JSON.stringify([
        { key: 'api_key', label: 'Gemini API Key Override (Encrypted Backend Storage; optional if server GEMINI_API_KEY env is active)', type: 'secret', placeholder: 'AIza... (leave blank to use server environment secret)', required: false },
      ]),
      JSON.stringify([
        'Encrypted backend Gemini API key override + safe server environment fallback',
        'Live connection check using official @google/genai TypeScript SDK',
        'Active Gemini 4 / 3.1 model & ThinkingLevel selector',
        'Per-capability AI tool toggles, token counter & error logging',
      ]),
      'Raw Gemini API keys are stored encrypted server-side and are never transmitted back to browser clients.',
      'Governed by your Google AI / Gemini API project quota',
    ],
  ];

  for (const seed of firstPartySeeds) {
    insUniversal.run(...seed);
  }
}

export function mapLeadRow(row: any): LeadRecord {
  return {
    id: row.id,
    lead_code: row.lead_code,
    prospect_name: row.prospect_name,
    company_name: row.company_name,
    username: row.username,
    social_platform: row.social_platform,
    original_post_url: row.original_post_url,
    date_posted: row.date_posted,
    date_discovered: row.date_discovered,
    country: row.country,
    city: row.city,
    detected_language: row.detected_language || null,
    service_requested: row.service_requested,
    project_description: row.project_description,
    original_buyer_statement: row.original_buyer_statement,
    intent_classification: row.intent_classification,
    lead_score: row.lead_score,
    lead_priority: row.lead_priority,
    score_breakdown: JSON.parse(row.score_breakdown_json || '{}'),
    budget: row.budget,
    budget_evidence_type: row.budget_evidence_type,
    urgency: row.urgency,
    project_status: row.project_status,
    decision_maker_status: row.decision_maker_status,
    company_website: row.company_website,
    public_business_email: row.public_business_email,
    contact_email_status: row.contact_email_status || (row.public_business_email ? 'UNVERIFIED_EMAIL' : 'EMAIL_UNAVAILABLE'),
    contact_verification_source: row.contact_verification_source || null,
    contact_evidence_notes: row.contact_evidence_notes || null,
    decision_maker_role: row.decision_maker_role || null,
    company_industry: row.company_industry || null,
    company_research_summary: row.company_research_summary || null,
    enrichment_credits_used: Number(row.enrichment_credits_used || 0),
    public_profile_url: row.public_profile_url,
    preferred_contact_method: row.preferred_contact_method,
    evidence_url: row.evidence_url,
    evidence_notes: row.evidence_notes,
    ai_opportunity_analysis: JSON.parse(row.ai_opportunity_analysis_json || '{}'),
    outreach_subject: row.outreach_subject,
    outreach_message: row.outreach_message,
    outreach_variants: JSON.parse(row.outreach_variants_json || '{}'),
    outreach_approval_status: row.outreach_approval_status,
    follow_up_date: row.follow_up_date,
    deal_status: row.deal_status,
    deal_value: Number(row.deal_value || 0),
    revenue_received: Number(row.revenue_received || 0),
    assigned_service_provider: row.assigned_service_provider,
    assigned_user_id: row.assigned_user_id ?? null,
    campaign_id: row.campaign_id ?? null,
    internal_notes: row.internal_notes || '',
    canonical_lead_id: row.canonical_lead_id,
    additional_sources: JSON.parse(row.additional_sources_json || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getDashboardMetrics(): DashboardMetrics {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total_leads,
      SUM(CASE WHEN lead_score >= 60 AND intent_classification IN ('DIRECT_BUYER','ACTIVE_PROJECT_BUYER','RECOMMENDATION_REQUEST') THEN 1 ELSE 0 END) as qualified_leads,
      SUM(CASE WHEN lead_score >= 80 THEN 1 ELSE 0 END) as hot_leads,
      SUM(CASE WHEN intent_classification = 'UPCOMING_BUYER' THEN 1 ELSE 0 END) as upcoming_leads,
      SUM(CASE WHEN date(date_discovered) = date('now') THEN 1 ELSE 0 END) as leads_today,
      SUM(CASE WHEN (public_business_email IS NOT NULL AND public_business_email != '') OR (company_website IS NOT NULL AND company_website != '') OR (public_profile_url IS NOT NULL AND public_profile_url != '') THEN 1 ELSE 0 END) as leads_with_verified_contact,
      SUM(CASE WHEN outreach_message != '' THEN 1 ELSE 0 END) as outreach_prepared,
      SUM(CASE WHEN outreach_approval_status = 'APPROVED' THEN 1 ELSE 0 END) as outreach_approved,
      SUM(CASE WHEN outreach_approval_status = 'SENT' THEN 1 ELSE 0 END) as outreach_sent,
      SUM(CASE WHEN deal_status IN ('Reply Received','Interested Prospect','Call Requested','Meeting Booked','Proposal Submitted','Negotiation','Won') THEN 1 ELSE 0 END) as replies_received,
      SUM(CASE WHEN deal_status IN ('Interested Prospect','Call Requested','Meeting Booked','Proposal Submitted','Negotiation','Won') THEN 1 ELSE 0 END) as interested_prospects,
      SUM(CASE WHEN deal_status = 'Won' THEN 1 ELSE 0 END) as deals_won,
      COALESCE(SUM(CASE WHEN deal_status NOT IN ('Lost') THEN deal_value ELSE 0 END), 0) as total_pipeline_value,
      COALESCE(SUM(revenue_received), 0) as actual_revenue_received
    FROM leads
    WHERE canonical_lead_id IS NULL
  `).get() as any;

  const by_platform = db.prepare(`
    SELECT social_platform as name, COUNT(*) as count
    FROM leads WHERE canonical_lead_id IS NULL
    GROUP BY social_platform ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  const by_service = db.prepare(`
    SELECT service_requested as name, COUNT(*) as count
    FROM leads WHERE canonical_lead_id IS NULL
    GROUP BY service_requested ORDER BY count DESC LIMIT 12
  `).all() as Array<{ name: string; count: number }>;

  const by_country = db.prepare(`
    SELECT COALESCE(NULLIF(country, ''), 'Unspecified') as name, COUNT(*) as count
    FROM leads WHERE canonical_lead_id IS NULL
    GROUP BY name ORDER BY count DESC LIMIT 12
  `).all() as Array<{ name: string; count: number }>;

  const by_intent = db.prepare(`
    SELECT intent_classification as name, COUNT(*) as count
    FROM leads WHERE canonical_lead_id IS NULL
    GROUP BY intent_classification ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  const by_deal_status = db.prepare(`
    SELECT deal_status as name, COUNT(*) as count, COALESCE(SUM(deal_value), 0) as value
    FROM leads WHERE canonical_lead_id IS NULL
    GROUP BY deal_status ORDER BY count DESC
  `).all() as Array<{ name: string; count: number; value: number }>;

  return {
    total_leads: counts.total_leads || 0,
    qualified_leads: counts.qualified_leads || 0,
    hot_leads: counts.hot_leads || 0,
    upcoming_leads: counts.upcoming_leads || 0,
    leads_today: counts.leads_today || 0,
    leads_with_verified_contact: counts.leads_with_verified_contact || 0,
    outreach_prepared: counts.outreach_prepared || 0,
    outreach_approved: counts.outreach_approved || 0,
    outreach_sent: counts.outreach_sent || 0,
    replies_received: counts.replies_received || 0,
    interested_prospects: counts.interested_prospects || 0,
    deals_won: counts.deals_won || 0,
    total_pipeline_value: Number(counts.total_pipeline_value || 0),
    actual_revenue_received: Number(counts.actual_revenue_received || 0),
    by_platform,
    by_service,
    by_country,
    by_intent,
    by_deal_status,
  };
}

export function getAppSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    thirty_day_revenue_target: Number(map.thirty_day_revenue_target || 5000),
    stretch_revenue_target: Number(map.stretch_revenue_target || 25000),
    stretch_target_deadline: map.stretch_target_deadline || '2026-12-25',
    default_currency: map.default_currency || 'USD',
    data_retention_days: Number(map.data_retention_days || 365),
    max_requests_per_minute: Number(map.max_requests_per_minute || 20),
    auto_generate_outreach: map.auto_generate_outreach !== 'false',
    n8n_webhook_url: map.n8n_webhook_url || '',
    owner_daily_send_limit: Number(map.owner_daily_send_limit || 250),
    owner_hourly_send_limit: Number(map.owner_hourly_send_limit || 50),
    owner_max_concurrent_sends: Number(map.owner_max_concurrent_sends || 10),
    invited_default_concurrent_sends: Number(map.invited_default_concurrent_sends || 5),
    sandbox_mode: map.sandbox_mode === 'true',
  };
}

export function logSystemEvent(level: 'INFO' | 'WARN' | 'ERROR' | 'AUDIT', actor: string, action: string, details: string) {
  try {
    db.prepare('INSERT INTO system_logs (level, actor, action, details) VALUES (?, ?, ?, ?)').run(
      level,
      actor,
      action,
      details
    );
  } catch (err) {
    console.error('Failed to log system event:', err);
  }
}

export function getPlatforms(): PlatformConnector[] {
  const rows = db.prepare('SELECT * FROM platforms ORDER BY category, name').all() as any[];
  return rows.map((r) => {
    const def = getConnectorDefinition(r.id);
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      connection_type: r.connection_type,
      status: r.status,
      description: r.description,
      required_env_vars: JSON.parse(r.required_env_vars_json || '[]'),
      requires_approval: def?.requires_approval ?? false,
      setup_instructions: def?.setup_instructions ?? '',
      rate_limit_info: r.rate_limit_info,
      last_checked_at: r.last_checked_at,
      last_error: r.last_error,
      is_enabled: Boolean(r.is_enabled),
    };
  });
}

export function getCustomFeeds(): CustomCommunityFeed[] {
  const rows = db.prepare('SELECT * FROM custom_feeds ORDER BY id DESC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    feed_type: r.feed_type,
    status: r.status,
    last_checked_at: r.last_checked_at,
    last_error: r.last_error,
    is_enabled: Boolean(r.is_enabled),
  }));
}

export function getServiceCategories(): ServiceCategory[] {
  const rows = db.prepare(`
    SELECT sc.*,
      (SELECT COUNT(*) FROM leads l WHERE l.service_requested = sc.name AND l.canonical_lead_id IS NULL) as lead_count
    FROM service_categories sc
    ORDER BY sc.is_emerging ASC, sc.group_name ASC, sc.id ASC
  `).all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    group_name: r.group_name,
    keywords: JSON.parse(r.keywords_json || '[]'),
    is_emerging: Boolean(r.is_emerging),
    is_active: Boolean(r.is_active),
    lead_count: r.lead_count || 0,
  }));
}

export function getAgents(): AgentConfig[] {
  const rows = db.prepare('SELECT * FROM ai_agents ORDER BY agent_number ASC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    agent_number: r.agent_number,
    name: r.name,
    role_description: r.role_description,
    model_name: r.model_name,
    is_enabled: Boolean(r.is_enabled),
    runs_count: r.runs_count,
    last_run_at: r.last_run_at,
    last_status: r.last_status,
  }));
}

export function getResearchLogs(limit = 50): ResearchLogItem[] {
  const rows = db.prepare('SELECT * FROM research_logs ORDER BY id DESC LIMIT ?').all(limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    query: r.query,
    platform: r.platform,
    service_category: r.service_category,
    country: r.country,
    results_count: r.results_count,
    accepted_count: r.accepted_count,
    rejected_count: r.rejected_count,
    duplicate_count: r.duplicate_count,
    rejection_reasons: JSON.parse(r.rejection_reasons_json || '[]'),
    execution_ms: r.execution_ms,
    status: r.status,
    error_message: r.error_message,
    created_at: r.created_at,
  }));
}

export function getSearchSchedules(): SearchSchedule[] {
  const rows = db.prepare('SELECT * FROM search_schedules ORDER BY id DESC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    services: JSON.parse(r.services_json || '[]'),
    platforms: JSON.parse(r.platforms_json || '[]'),
    countries: JSON.parse(r.countries_json || '[]'),
    min_score: r.min_score,
    max_results: r.max_results,
    frequency_minutes: r.frequency_minutes,
    is_active: Boolean(r.is_active),
    last_run_at: r.last_run_at,
    next_run_at: r.next_run_at,
  }));
}

export function getTargetCountrySets(userId?: number): TargetCountrySet[] {
  const rows = userId
    ? (db.prepare('SELECT * FROM target_country_sets WHERE owner_user_id = ? OR is_default = 1 ORDER BY is_default DESC, id DESC').all(userId) as any[])
    : (db.prepare('SELECT * FROM target_country_sets ORDER BY is_default DESC, id DESC').all() as any[]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    countries: JSON.parse(r.countries_json || '[]'),
    is_default: Boolean(r.is_default),
    owner_user_id: r.owner_user_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function getActiveTargetCountriesForDiscovery(userId?: number): string[] {
  const row = db
    .prepare(
      userId
        ? 'SELECT countries_json FROM target_country_sets WHERE owner_user_id = ? OR is_default = 1 ORDER BY is_default DESC, id DESC LIMIT 1'
        : 'SELECT countries_json FROM target_country_sets WHERE is_default = 1 ORDER BY id DESC LIMIT 1'
    )
    .get(...(userId ? [userId] : [])) as { countries_json?: string } | undefined;
  if (!row?.countries_json) return [];
  try {
    const arr = JSON.parse(row.countries_json);
    return Array.isArray(arr) ? arr.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function getEmailAnalytics(filters: {
  country?: string;
  service?: string;
  language?: string;
  campaignId?: number;
  emailAccountId?: number;
  userId?: number;
  dateFrom?: string;
  dateTo?: string;
  viewerScopeUserId?: number;
}): EmailAnalyticsResponse {
  const leadClauses = ['canonical_lead_id IS NULL'];
  const leadParams: any[] = [];
  if (filters.viewerScopeUserId) {
    leadClauses.push('assigned_user_id = ?');
    leadParams.push(filters.viewerScopeUserId);
  }
  if (filters.country && filters.country !== 'ALL') {
    leadClauses.push('lower(COALESCE(country, \'\')) = lower(?)');
    leadParams.push(filters.country);
  }
  if (filters.service && filters.service !== 'ALL') {
    leadClauses.push('service_requested = ?');
    leadParams.push(filters.service);
  }
  if (filters.dateFrom) {
    leadClauses.push('date(date_discovered) >= date(?)');
    leadParams.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    leadClauses.push('date(date_discovered) <= date(?)');
    leadParams.push(filters.dateTo);
  }

  const leadAgg = db
    .prepare(
      `SELECT
        COUNT(*) as total_discovered_leads,
        SUM(CASE WHEN lead_score >= 60 AND intent_classification IN ('DIRECT_BUYER','ACTIVE_PROJECT_BUYER','RECOMMENDATION_REQUEST') THEN 1 ELSE 0 END) as qualified_leads,
        SUM(CASE WHEN deal_status IN ('Reply Received','Interested Prospect','Call Requested','Meeting Booked','Proposal Submitted','Negotiation','Won') THEN 1 ELSE 0 END) as replies_received,
        SUM(CASE WHEN deal_status IN ('Interested Prospect','Call Requested','Meeting Booked','Proposal Submitted','Negotiation','Won') THEN 1 ELSE 0 END) as interested_prospects,
        SUM(CASE WHEN deal_status IN ('Meeting Booked','Call Requested') THEN 1 ELSE 0 END) as meetings_booked,
        SUM(CASE WHEN deal_status = 'Won' THEN 1 ELSE 0 END) as converted_customers,
        COALESCE(SUM(revenue_received), 0) as actual_revenue_recorded,
        COALESCE(SUM(CASE WHEN deal_status != 'Lost' THEN deal_value ELSE 0 END), 0) as estimated_opportunity_value
       FROM leads WHERE ${leadClauses.join(' AND ')}`
    )
    .get(...leadParams) as any;

  const msgClauses = ['1=1'];
  const msgParams: any[] = [];
  if (filters.viewerScopeUserId) {
    msgClauses.push('em.owner_user_id = ?');
    msgParams.push(filters.viewerScopeUserId);
  }
  if (filters.country && filters.country !== 'ALL') {
    msgClauses.push('lower(COALESCE(em.country, \'\')) = lower(?)');
    msgParams.push(filters.country);
  }
  if (filters.service && filters.service !== 'ALL') {
    msgClauses.push('em.service_requested = ?');
    msgParams.push(filters.service);
  }
  if (filters.language && filters.language !== 'ALL') {
    msgClauses.push('lower(em.detected_language) = lower(?)');
    msgParams.push(filters.language);
  }
  if (filters.campaignId) {
    msgClauses.push('em.campaign_id = ?');
    msgParams.push(filters.campaignId);
  }
  if (filters.emailAccountId) {
    msgClauses.push('em.email_account_id = ?');
    msgParams.push(filters.emailAccountId);
  }
  if (filters.userId) {
    msgClauses.push('em.owner_user_id = ?');
    msgParams.push(filters.userId);
  }
  if (filters.dateFrom) {
    msgClauses.push('date(em.created_at) >= date(?)');
    msgParams.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    msgClauses.push('date(em.created_at) <= date(?)');
    msgParams.push(filters.dateTo);
  }

  const whereMsg = msgClauses.join(' AND ');
  const msgAgg = db
    .prepare(
      `SELECT
        COUNT(*) as emails_generated,
        SUM(CASE WHEN em.approval_status = 'AWAITING_APPROVAL' THEN 1 ELSE 0 END) as emails_awaiting_approval,
        SUM(CASE WHEN em.approval_status IN ('APPROVED','QUEUED','SENDING','SENT','DELIVERED','BOUNCED') THEN 1 ELSE 0 END) as emails_approved,
        SUM(CASE WHEN em.approval_status IN ('SENT','DELIVERED','BOUNCED') THEN 1 ELSE 0 END) as emails_sent,
        SUM(CASE WHEN em.approval_status = 'DELIVERED' OR (em.approval_status = 'SENT' AND em.delivered_at IS NOT NULL) THEN 1 ELSE 0 END) as emails_delivered,
        SUM(CASE WHEN em.approval_status = 'BOUNCED' THEN 1 ELSE 0 END) as emails_bounced,
        SUM(CASE WHEN em.replied_at IS NOT NULL THEN 1 ELSE 0 END) as msg_replies
       FROM email_messages em WHERE ${whereMsg}`
    )
    .get(...msgParams) as any;

  const by_country = db
    .prepare(
      `SELECT
        COALESCE(NULLIF(em.country, ''), 'Unverified') as name,
        SUM(CASE WHEN em.approval_status IN ('SENT','DELIVERED','BOUNCED') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN em.approval_status = 'DELIVERED' OR (em.approval_status = 'SENT' AND em.delivered_at IS NOT NULL) THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN em.replied_at IS NOT NULL THEN 1 ELSE 0 END) as replies,
        COALESCE(SUM(l.revenue_received), 0) as revenue
       FROM email_messages em
       LEFT JOIN leads l ON l.id = em.lead_id
       WHERE ${whereMsg}
       GROUP BY name ORDER BY sent DESC, replies DESC LIMIT 15`
    )
    .all(...msgParams) as Array<{ name: string; sent: number; delivered: number; replies: number; revenue: number }>;

  const by_service = db
    .prepare(
      `SELECT
        em.service_requested as name,
        SUM(CASE WHEN em.approval_status IN ('SENT','DELIVERED','BOUNCED') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN em.approval_status = 'DELIVERED' OR (em.approval_status = 'SENT' AND em.delivered_at IS NOT NULL) THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN em.replied_at IS NOT NULL THEN 1 ELSE 0 END) as replies,
        COALESCE(SUM(l.revenue_received), 0) as revenue
       FROM email_messages em
       LEFT JOIN leads l ON l.id = em.lead_id
       WHERE ${whereMsg}
       GROUP BY name ORDER BY sent DESC, replies DESC LIMIT 15`
    )
    .all(...msgParams) as Array<{ name: string; sent: number; delivered: number; replies: number; revenue: number }>;

  const by_language = db
    .prepare(
      `SELECT
        COALESCE(NULLIF(em.detected_language, ''), 'English') as name,
        COUNT(*) as count,
        SUM(CASE WHEN em.approval_status IN ('SENT','DELIVERED','BOUNCED') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN em.replied_at IS NOT NULL THEN 1 ELSE 0 END) as replies
       FROM email_messages em
       WHERE ${whereMsg}
       GROUP BY name ORDER BY count DESC`
    )
    .all(...msgParams) as Array<{ name: string; count: number; sent: number; replies: number }>;

  const by_account = db
    .prepare(
      `SELECT
        COALESCE(ea.email_address, 'Unassigned') as email_address,
        COALESCE(ea.provider, 'none') as provider,
        SUM(CASE WHEN em.approval_status IN ('SENT','DELIVERED','BOUNCED') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN em.approval_status = 'DELIVERED' OR (em.approval_status = 'SENT' AND em.delivered_at IS NOT NULL) THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN em.approval_status = 'BOUNCED' THEN 1 ELSE 0 END) as bounced
       FROM email_messages em
       LEFT JOIN email_accounts ea ON ea.id = em.email_account_id
       WHERE ${whereMsg}
       GROUP BY email_address, provider ORDER BY sent DESC`
    )
    .all(...msgParams) as Array<{ email_address: string; provider: string; sent: number; delivered: number; bounced: number }>;

  return {
    kpis: {
      total_discovered_leads: leadAgg?.total_discovered_leads || 0,
      qualified_leads: leadAgg?.qualified_leads || 0,
      emails_generated: msgAgg?.emails_generated || 0,
      emails_awaiting_approval: msgAgg?.emails_awaiting_approval || 0,
      emails_approved: msgAgg?.emails_approved || 0,
      emails_sent: msgAgg?.emails_sent || 0,
      emails_delivered: msgAgg?.emails_delivered || 0,
      emails_bounced: msgAgg?.emails_bounced || 0,
      replies_received: Math.max(leadAgg?.replies_received || 0, msgAgg?.msg_replies || 0),
      interested_prospects: leadAgg?.interested_prospects || 0,
      meetings_booked: leadAgg?.meetings_booked || 0,
      converted_customers: leadAgg?.converted_customers || 0,
      actual_revenue_recorded: Number(leadAgg?.actual_revenue_recorded || 0),
      estimated_opportunity_value: Number(leadAgg?.estimated_opportunity_value || 0),
    },
    by_country,
    by_service,
    by_language,
    by_account,
  };
}

