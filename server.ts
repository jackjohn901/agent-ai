import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import crypto from 'crypto';
import {
  db,
  defaultPermissionsForRole,
  getAgents,
  getAppSettings,
  getCustomFeeds,
  getDashboardMetrics,
  getEmailAnalytics,
  getPlatforms,
  getResearchLogs,
  getSearchSchedules,
  getServiceCategories,
  getTargetCountrySets,
  initDatabase,
  logSystemEvent,
  mapLeadRow,
  SUPER_ADMIN_EMAIL,
} from './server/db.js';
import {
  authenticateUser,
  changeUserPassword,
  checkLoginRateLimit,
  clearSessionCookie,
  completeInitialPasswordSetup,
  createPasswordResetTokenForEmail,
  createSession,
  getAccountSetupStatus,
  getUserBySessionToken,
  mapUserRow,
  requireAuth,
  requirePermission,
  requireRole,
  requireSuperAdmin,
  resetPasswordWithToken,
  setSessionCookie,
  type AuthenticatedRequest,
} from './server/auth.js';
import {
  evaluateCandidateWithAgents,
  generateFollowUpRecommendation,
  persistLead,
  runDiscoveryPipeline,
} from './server/agents.js';
import {
  inspectManualPostOrUrl,
  isSafePublicUrl,
  testAllConnectors,
  testConnector,
  testCustomFeed,
} from './server/connectors.js';
import { getConnectorDefinition } from './server/connectorRegistry.js';
import {
  decryptJson,
  deleteConnectorCredentials,
  encryptJson,
  getDecryptedCredential,
  getMaskedCredentialsForConnector,
  saveEncryptedCredential,
} from './server/secrets.js';
import {
  getEmailAccountById,
  getEmailAccountsForUser,
  mapEmailAccountRow,
  testEmailAccountConnection,
  type EmailAccountCredentials,
} from './server/emailService.js';
import {
  approveAndDispatchIndividualEmail,
  getActiveConcurrencySnapshot,
  getUserSendLimits,
  isRecipientSuppressed,
  processQueueItem,
  startEmailQueueWorker,
} from './server/emailQueue.js';
import {
  generatePersonalizedEmailForLead,
  getEmailMessages,
  mapEmailMessageRow,
} from './server/emailWriter.js';
import {
  findCountryInfo,
  MAX_TARGET_COUNTRIES_PER_CAMPAIGN,
  WORLD_COUNTRIES,
} from './shared/countries.js';
import { startScheduler } from './server/scheduler.js';
import {
  clearUniversalCredentials,
  completeUniversalOAuthCallback,
  createCustomUniversalIntegration,
  deleteUniversalIntegration,
  executeUniversalTool,
  getAppBaseUrl,
  getUniversalIntegrationReport,
  listUniversalIntegrations,
  saveUniversalCredentials,
  startUniversalOAuth,
  testUniversalIntegration,
  toggleUniversalIntegration,
  toggleUniversalTool,
  updateUniversalIntegrationConfig,
} from './server/universalIntegrations.js';
import { researchAndEnrichLead } from './server/researchPipeline.js';
import type { EmailProviderType, UserPermissions, UserRole } from './shared/types.js';

initDatabase();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ======================== AUTHENTICATION ========================
app.post('/api/auth/account-status', (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  res.json(getAccountSetupStatus(email));
});

app.post('/api/auth/setup-password', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and new password are required.' });
  }
  try {
    const user = completeInitialPasswordSetup(String(email), String(password));
    const token = createSession(user.id);
    setSessionCookie(res, token, req);
    res.json({ user, session_token: token });
  } catch (err: any) {
    res.status(403).json({ error: err?.message || 'Unable to initialize password.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
  }
  const { email, password } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const statusCheck = getAccountSetupStatus(String(email));
  if (statusCheck.exists && statusCheck.password_setup_required) {
    return res.status(403).json({
      code: 'PASSWORD_SETUP_REQUIRED',
      error: 'Initial password setup is required for this account before signing in.',
    });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const result = authenticateUser(String(email), String(password));
  if (result.status === 'SUSPENDED') {
    logSystemEvent('WARN', String(email), 'LOGIN_BLOCKED_SUSPENDED', `Suspended account login attempt from ${ip}`);
    return res.status(403).json({
      code: 'ACCOUNT_SUSPENDED',
      error: 'This account has been suspended by the platform owner.',
    });
  }
  if (result.status === 'PASSWORD_SETUP_REQUIRED') {
    return res.status(403).json({
      code: 'PASSWORD_SETUP_REQUIRED',
      error: 'Initial password setup is required for this account before signing in.',
    });
  }
  if (result.status !== 'OK') {
    logSystemEvent('WARN', String(email), 'LOGIN_FAILED', `Invalid credentials from ${ip}`);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = createSession(result.user.id);
  setSessionCookie(res, token, req);
  logSystemEvent('AUDIT', result.user.email, 'LOGIN_SUCCESS', `Authenticated with role ${result.user.role}`);
  res.json({ user: result.user, session_token: token });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many reset requests. Please try again later.' });
  }
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  createPasswordResetTokenForEmail(email);
  res.json({
    ok: true,
    message: 'If this account exists, a one-time reset token has been issued on the server.',
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  const { email, token, password } = req.body || {};
  if (!email || !token || !password) {
    return res.status(400).json({ error: 'Email, reset token, and new password are required.' });
  }
  try {
    const user = resetPasswordWithToken(String(email), String(token), String(password));
    const sessionToken = createSession(user.id);
    setSessionCookie(res, sessionToken, req);
    res.json({ user, session_token: sessionToken });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Password reset failed.' });
  }
});

app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }
  try {
    changeUserPassword(req.user!.id, String(current_password), String(new_password));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to change password.' });
  }
});

app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  // Explicitly block any privilege escalation attempt via profile edits
  if (req.body?.role !== undefined || req.body?.is_owner !== undefined) {
    logSystemEvent(
      'WARN',
      req.user!.email,
      'PRIVILEGE_ESCALATION_BLOCKED',
      `Blocked attempt to modify role/is_owner via /api/auth/profile`
    );
    return res.status(403).json({ error: 'Users cannot modify their own role or ownership status.' });
  }
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user!.id);
  res.json({ ok: true, name });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.abh_session || req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.abh_session || req.headers.authorization?.replace('Bearer ', '');
  const user = getUserBySessionToken(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user });
});

// User Management (Super Admin & Admin only, with strict Super Admin exclusivity)
app.get('/api/users', requireAuth, requireRole(['super_admin', 'admin']), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM email_accounts ea WHERE ea.owner_user_id = u.id AND ea.is_active = 1) as email_accounts_count,
        (SELECT COUNT(*) FROM leads l WHERE l.assigned_user_id = u.id AND l.canonical_lead_id IS NULL) as assigned_leads_count,
        (SELECT COUNT(*) FROM email_messages em WHERE em.owner_user_id = u.id AND em.approval_status IN ('SENT','DELIVERED','BOUNCED')) as emails_sent_count
       FROM users u
       ORDER BY u.is_owner DESC, u.id ASC`
    )
    .all() as any[];

  const users = rows.map((u) => ({
    ...mapUserRow(u),
    email_accounts_count: Number(u.email_accounts_count || 0),
    assigned_leads_count: Number(u.assigned_leads_count || 0),
    emails_sent_count: Number(u.emails_sent_count || 0),
  }));
  res.json({ users });
});

app.post('/api/users', requireAuth, requireRole(['super_admin', 'admin']), (req: AuthenticatedRequest, res) => {
  const {
    name,
    email,
    password,
    role = 'operator',
    invite_mode = false,
    permissions,
    daily_send_limit,
    hourly_send_limit,
    max_concurrent_sends,
  } = req.body || {};

  if (role === 'super_admin') {
    return res.status(403).json({ error: 'The super_admin role is reserved exclusively for the platform owner.' });
  }
  if (!name || !email || !['admin', 'operator', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Valid name, email, and role (admin, operator, viewer) are required.' });
  }
  if (!invite_mode && (!password || String(password).length < 10)) {
    return res.status(400).json({ error: 'Password must be at least 10 characters long (or use invite mode).' });
  }
  if (role === 'admin' && req.user!.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only the Super Admin can invite Administrator accounts.' });
  }

  const settings = getAppSettings();
  const basePerms = defaultPermissionsForRole(role as UserRole);
  const mergedPerms: UserPermissions = {
    can_discover: permissions?.can_discover ?? basePerms.can_discover,
    can_generate_emails: permissions?.can_generate_emails ?? basePerms.can_generate_emails,
    can_approve_emails: permissions?.can_approve_emails ?? basePerms.can_approve_emails,
    can_send_emails: permissions?.can_send_emails ?? basePerms.can_send_emails,
    can_connect_email_accounts: permissions?.can_connect_email_accounts ?? basePerms.can_connect_email_accounts,
    can_manage_leads: permissions?.can_manage_leads ?? basePerms.can_manage_leads,
    can_view_analytics: permissions?.can_view_analytics ?? basePerms.can_view_analytics,
  };

  const dailyLimit = Math.max(1, Number(daily_send_limit ?? 50));
  const hourlyLimit = Math.max(1, Number(hourly_send_limit ?? 15));
  const concurrentLimit =
    req.user!.role === 'super_admin' && max_concurrent_sends !== undefined
      ? Math.max(1, Number(max_concurrent_sends))
      : settings.invited_default_concurrent_sends || 5;

  const isInviteOnly = Boolean(invite_mode) || !password;
  const hash = isInviteOnly ? '' : bcrypt.hashSync(String(password), 12);
  const status = isInviteOnly ? 'INVITED' : 'ACTIVE';
  const setupRequired = isInviteOnly ? 1 : 0;

  try {
    const info = db
      .prepare(
        `INSERT INTO users (
          name, email, password_hash, role, status, is_owner, password_setup_required,
          permissions_json, daily_send_limit, hourly_send_limit, max_concurrent_sends, invited_by
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(name).trim(),
        String(email).trim().toLowerCase(),
        hash,
        role,
        status,
        setupRequired,
        JSON.stringify(mergedPerms),
        dailyLimit,
        hourlyLimit,
        concurrentLimit,
        req.user!.email
      );
    logSystemEvent('AUDIT', req.user!.email, 'USER_INVITED', `Invited ${email} (${role}, status: ${status})`);
    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json({ id: Number(info.lastInsertRowid), user: mapUserRow(created) });
  } catch {
    res.status(409).json({ error: 'A user with this email already exists.' });
  }
});

app.patch('/api/users/:id', requireAuth, requireRole(['super_admin', 'admin']), (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  const targetIsOwner =
    Boolean(target.is_owner) || String(target.email).toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  const { role, name, status, permissions, daily_send_limit, hourly_send_limit, max_concurrent_sends } = req.body || {};

  if (role !== undefined) {
    if (targetIsOwner && role !== 'super_admin') {
      return res.status(403).json({ error: 'Permanent owner Super Admin role cannot be changed or demoted.' });
    }
    if (role === 'super_admin' && !targetIsOwner) {
      return res.status(403).json({ error: 'super_admin role cannot be assigned to another account.' });
    }
    if (req.user!.id === targetId && role !== req.user!.role) {
      return res.status(403).json({ error: 'Users cannot modify their own role.' });
    }
    if (!['admin', 'operator', 'viewer'].includes(role) && !targetIsOwner) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if ((role === 'admin' || target.role === 'admin') && req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the Super Admin can manage Administrator roles.' });
    }
  }

  if (status !== undefined) {
    if (targetIsOwner && status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Permanent owner Super Admin cannot be suspended.' });
    }
    if (!['ACTIVE', 'SUSPENDED', 'INVITED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid user status.' });
    }
    if (targetId === req.user!.id && status === 'SUSPENDED') {
      return res.status(400).json({ error: 'You cannot suspend your own account.' });
    }
  }

  if (targetIsOwner && req.user!.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only the Super Admin can edit the owner account.' });
  }

  const nextName = name ? String(name).trim() : target.name;
  const nextRole = targetIsOwner ? 'super_admin' : role || target.role;
  const nextStatus = targetIsOwner ? 'ACTIVE' : status || target.status || 'ACTIVE';
  const currentPerms = mapUserRow(target).permissions;
  const nextPerms: UserPermissions = targetIsOwner
    ? defaultPermissionsForRole('super_admin')
    : {
        ...currentPerms,
        ...(permissions && typeof permissions === 'object' ? permissions : {}),
      };

  const nextDaily =
    daily_send_limit !== undefined ? Math.max(1, Number(daily_send_limit)) : Number(target.daily_send_limit ?? 50);
  const nextHourly =
    hourly_send_limit !== undefined ? Math.max(1, Number(hourly_send_limit)) : Number(target.hourly_send_limit ?? 15);
  const nextConcurrent =
    max_concurrent_sends !== undefined && req.user!.role === 'super_admin'
      ? Math.max(1, Number(max_concurrent_sends))
      : Number(target.max_concurrent_sends ?? 5);

  db.prepare(
    `UPDATE users
     SET name = ?, role = ?, status = ?, permissions_json = ?,
         daily_send_limit = ?, hourly_send_limit = ?, max_concurrent_sends = ?
     WHERE id = ?`
  ).run(nextName, nextRole, nextStatus, JSON.stringify(nextPerms), nextDaily, nextHourly, nextConcurrent, targetId);

  if (nextStatus === 'SUSPENDED') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
  }

  logSystemEvent(
    'AUDIT',
    req.user!.email,
    'USER_UPDATED',
    `Updated user ${target.email} (role: ${nextRole}, status: ${nextStatus}, concurrent: ${nextConcurrent})`
  );
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  res.json({ ok: true, user: mapUserRow(updated) });
});

app.delete('/api/users/:id', requireAuth, requireRole(['super_admin', 'admin']), (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (Boolean(target.is_owner) || String(target.email).toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'The permanent owner Super Admin account cannot be deleted.' });
  }
  if (targetId === req.user!.id) {
    return res.status(400).json({ error: 'You cannot delete your currently signed-in account.' });
  }
  if (target.role === 'admin' && req.user!.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only the Super Admin can delete Administrator accounts.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  logSystemEvent('AUDIT', req.user!.email, 'USER_DELETED', `Deleted user ${target.email}`);
  res.json({ ok: true });
});

// ======================== DASHBOARD & METRICS ========================
app.get('/api/dashboard/metrics', requireAuth, (_req, res) => {
  res.json(getDashboardMetrics());
});

// ======================== LEADS & CRM ========================
app.get('/api/leads', requireAuth, (req: AuthenticatedRequest, res) => {
  const {
    search,
    service,
    platform,
    country,
    intent,
    priority,
    minScore,
    dealStatus,
    approvalStatus,
    dateFrom,
    dateTo,
    includeMerged,
  } = req.query;

  const clauses: string[] = [];
  const params: any[] = [];

  if (req.user!.role !== 'super_admin' && req.user!.role !== 'admin') {
    clauses.push('assigned_user_id = ?');
    params.push(req.user!.id);
  }
  if (includeMerged !== 'true') {
    clauses.push('canonical_lead_id IS NULL');
  }
  if (search) {
    clauses.push(
      '(lower(prospect_name) LIKE ? OR lower(COALESCE(company_name, \'\')) LIKE ? OR lower(project_description) LIKE ? OR lower(service_requested) LIKE ?)'
    );
    const q = `%${String(search).toLowerCase()}%`;
    params.push(q, q, q, q);
  }
  if (service && service !== 'All Services') {
    clauses.push('service_requested = ?');
    params.push(String(service));
  }
  if (platform && platform !== 'All Platforms') {
    clauses.push('lower(social_platform) LIKE ?');
    params.push(`%${String(platform).toLowerCase()}%`);
  }
  if (country && country !== 'Worldwide') {
    clauses.push('lower(COALESCE(country, \'\')) LIKE ?');
    params.push(`%${String(country).toLowerCase()}%`);
  }
  if (intent && intent !== 'ALL') {
    clauses.push('intent_classification = ?');
    params.push(String(intent));
  }
  if (priority && priority !== 'ALL') {
    clauses.push('lead_priority = ?');
    params.push(String(priority));
  }
  if (minScore !== undefined && minScore !== '') {
    clauses.push('lead_score >= ?');
    params.push(Number(minScore));
  }
  if (dealStatus && dealStatus !== 'ALL') {
    clauses.push('deal_status = ?');
    params.push(String(dealStatus));
  }
  if (approvalStatus && approvalStatus !== 'ALL') {
    clauses.push('outreach_approval_status = ?');
    params.push(String(approvalStatus));
  }
  if (dateFrom) {
    clauses.push('date(date_discovered) >= date(?)');
    params.push(String(dateFrom));
  }
  if (dateTo) {
    clauses.push('date(date_discovered) <= date(?)');
    params.push(String(dateTo));
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM leads ${where} ORDER BY lead_score DESC, id DESC LIMIT 500`).all(...params);
  res.json({ leads: rows.map(mapLeadRow) });
});

app.get('/api/leads/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;
  if (!row) return res.status(404).json({ error: 'Lead not found' });

  if (
    req.user!.role !== 'super_admin' &&
    req.user!.role !== 'admin' &&
    row.assigned_user_id !== req.user!.id
  ) {
    return res.status(403).json({ error: 'You only have access to leads assigned to your account.' });
  }

  const contactHistory = db
    .prepare('SELECT * FROM contact_history WHERE lead_id = ? ORDER BY id DESC')
    .all(id);
  const duplicates = db
    .prepare('SELECT * FROM duplicate_links WHERE canonical_lead_id = ? ORDER BY id DESC')
    .all(id);

  res.json({
    lead: mapLeadRow(row),
    contact_history: contactHistory,
    duplicate_links: duplicates,
  });
});

app.patch('/api/leads/:id', requireAuth, requirePermission('can_manage_leads'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  if (
    req.user!.role !== 'super_admin' &&
    req.user!.role !== 'admin' &&
    existing.assigned_user_id !== req.user!.id
  ) {
    return res.status(403).json({ error: 'Cannot edit leads not assigned to you.' });
  }

  const allowedFields: Record<string, string> = {
    deal_status: 'deal_status',
    deal_value: 'deal_value',
    revenue_received: 'revenue_received',
    follow_up_date: 'follow_up_date',
    assigned_service_provider: 'assigned_service_provider',
    internal_notes: 'internal_notes',
    outreach_subject: 'outreach_subject',
    outreach_message: 'outreach_message',
    preferred_contact_method: 'preferred_contact_method',
    public_business_email: 'public_business_email',
    campaign_id: 'campaign_id',
  };
  if (req.user!.role === 'super_admin' || req.user!.role === 'admin') {
    allowedFields.assigned_user_id = 'assigned_user_id';
  }

  const sets: string[] = [];
  const vals: any[] = [];
  for (const [bodyKey, col] of Object.entries(allowedFields)) {
    if (req.body[bodyKey] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(req.body[bodyKey]);
    }
  }
  if (req.body.outreach_variants !== undefined) {
    sets.push('outreach_variants_json = ?');
    vals.push(JSON.stringify(req.body.outreach_variants));
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  logSystemEvent('AUDIT', req.user!.email, 'LEAD_UPDATED', `Updated lead #${id} (${Object.keys(req.body).join(', ')})`);

  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  res.json({ lead: mapLeadRow(updated) });
});

app.delete('/api/leads/:id', requireAuth, requirePermission('can_manage_leads'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT lead_code, prospect_name, assigned_user_id FROM leads WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  if (
    req.user!.role !== 'super_admin' &&
    req.user!.role !== 'admin' &&
    existing.assigned_user_id !== req.user!.id
  ) {
    return res.status(403).json({ error: 'Cannot delete leads not assigned to you.' });
  }

  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  logSystemEvent('AUDIT', req.user!.email, 'LEAD_DELETED', `Deleted lead ${existing.lead_code} (${existing.prospect_name})`);
  res.json({ ok: true });
});

// ======================== OUTREACH APPROVAL & FOLLOW-UP ========================
app.post('/api/leads/:id/outreach/approve', requireAuth, requireRole(['admin', 'operator']), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Suppression check
  const suppressed = db
    .prepare('SELECT identifier FROM suppression_list WHERE lower(identifier) IN (lower(?), lower(?), lower(?))')
    .get(lead.public_business_email || '__none__', lead.username || '__none__', lead.original_post_url);
  if (suppressed) {
    return res.status(400).json({ error: 'Prospect is on the opt-out suppression list. Outreach blocked.' });
  }

  const nextDealStatus = lead.deal_status === 'Message Prepared' ? 'Message Approved' : lead.deal_status;
  db.prepare(
    "UPDATE leads SET outreach_approval_status = 'APPROVED', deal_status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(nextDealStatus, id);

  logSystemEvent('AUDIT', req.user!.email, 'OUTREACH_APPROVED', `Approved outreach for lead #${id}`);
  res.json({ lead: mapLeadRow(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)) });
});

app.post('/api/leads/:id/outreach/reject', requireAuth, requireRole(['admin', 'operator']), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE leads SET outreach_approval_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?").run(id);
  logSystemEvent('AUDIT', req.user!.email, 'OUTREACH_REJECTED', `Rejected draft for lead #${id}`);
  res.json({ lead: mapLeadRow(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)) });
});

app.post('/api/leads/:id/outreach/mark-sent', requireAuth, requireRole(['admin', 'operator']), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (lead.outreach_approval_status !== 'APPROVED' && lead.outreach_approval_status !== 'SENT') {
    return res.status(400).json({ error: 'Human approval is required before marking outreach as sent.' });
  }

  const channel = String(req.body?.channel || 'Email / Direct');
  const subject = String(req.body?.subject || lead.outreach_subject || '');
  const message = String(req.body?.message || lead.outreach_message || '');

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO contact_history (lead_id, channel, direction, subject, message, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, channel, 'OUTBOUND', subject, message, 'SENT');

    db.prepare(
      `UPDATE leads SET
        outreach_approval_status = 'SENT',
        deal_status = CASE WHEN deal_status IN ('Message Prepared', 'Message Approved') THEN 'Message Sent' ELSE deal_status END,
        follow_up_date = date('now', '+3 days'),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(id);
  });
  tx();

  logSystemEvent('AUDIT', req.user!.email, 'OUTREACH_SENT', `Recorded sent outreach for lead #${id} via ${channel}`);
  res.json({ lead: mapLeadRow(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)) });
});

app.post('/api/leads/:id/contact-history', requireAuth, requireRole(['admin', 'operator']), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const { channel, direction, subject, message, status, new_deal_status } = req.body || {};
  if (!channel || !direction || !message) {
    return res.status(400).json({ error: 'Channel, direction, and message are required.' });
  }
  db.prepare(
    'INSERT INTO contact_history (lead_id, channel, direction, subject, message, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, channel, direction, subject || null, message, status || 'RECORDED');

  if (new_deal_status) {
    db.prepare("UPDATE leads SET deal_status = ?, updated_at = datetime('now') WHERE id = ?").run(new_deal_status, id);
  }
  res.status(201).json({ ok: true });
});

app.post('/api/leads/:id/follow-up/recommend', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rec = await generateFollowUpRecommendation(id);
    res.json(rec);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate follow-up recommendation' });
  }
});

app.post('/api/leads/:id/research-enrich', requireAuth, requirePermission('can_manage_leads'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT assigned_user_id FROM leads WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    if (req.user!.role !== 'super_admin' && req.user!.role !== 'admin' && existing.assigned_user_id !== req.user!.id) {
      return res.status(403).json({ error: 'Cannot enrich leads not assigned to you.' });
    }
    const result = await researchAndEnrichLead(id, req.user!.email);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Research & enrichment failed' });
  }
});

// ======================== DISCOVERY & MANUAL INTAKE ========================
app.post('/api/discovery/run', requireAuth, requirePermission('can_discover'), async (req: AuthenticatedRequest, res) => {
  try {
    const {
      services = ['All Services'],
      platforms = ['All Platforms'],
      countries = ['Worldwide'],
      minScore = 40,
      maxResults = 6,
      intelligentMode = true,
      campaignId = null,
      strictCountryFilter = false,
    } = req.body || {};

    const countryList = Array.isArray(countries) ? countries.slice(0, MAX_TARGET_COUNTRIES_PER_CAMPAIGN) : [String(countries)];
    const summary = await runDiscoveryPipeline({
      services: Array.isArray(services) ? services : [String(services)],
      platforms: Array.isArray(platforms) ? platforms : [String(platforms)],
      countries: countryList,
      minScore: Number(minScore),
      maxResults: Math.min(15, Math.max(1, Number(maxResults))),
      intelligentMode: Boolean(intelligentMode),
      actor: req.user!.email,
      actorUserId: req.user!.id,
      campaignId: campaignId ? Number(campaignId) : null,
      strictCountryFilter: Boolean(strictCountryFilter),
    });

    res.json({ summary });
  } catch (err: any) {
    logSystemEvent('ERROR', req.user!.email, 'DISCOVERY_RUN_ERROR', err?.message || 'Discovery failed');
    res.status(500).json({ error: err?.message || 'Discovery pipeline failed' });
  }
});

app.post('/api/discovery/manual', requireAuth, requirePermission('can_discover'), async (req: AuthenticatedRequest, res) => {
  try {
    const { url, platform, author, content, service_hint } = req.body || {};
    if (!url && !content) {
      return res.status(400).json({ error: 'Provide either a public post URL or the buyer post content.' });
    }

    const candidate = await inspectManualPostOrUrl({ url, platform, author, content, service_hint });
    const knownServices = (
      db.prepare('SELECT name FROM service_categories WHERE is_active = 1').all() as Array<{ name: string }>
    ).map((r) => r.name);

    const evaluated = await evaluateCandidateWithAgents(candidate, knownServices);
    if (!evaluated.accepted) {
      db.prepare(
        `INSERT INTO research_logs (query, platform, service_category, country, results_count, accepted_count, rejected_count, rejection_reasons_json, execution_ms, status)
         VALUES (?, ?, ?, ?, 1, 0, 1, ?, 0, 'SUCCESS')`
      ).run(
        candidate.original_post_url,
        candidate.platform,
        evaluated.service_requested,
        evaluated.country || 'Worldwide',
        JSON.stringify([evaluated.rejection_reason || 'Rejected by Buyer Intent Agent'])
      );
      return res.json({
        accepted: false,
        intent_classification: evaluated.intent_classification,
        rejection_reason: evaluated.rejection_reason,
      });
    }

    const persisted = persistLead(candidate, evaluated, { assignedUserId: req.user!.id });
    db.prepare(
      `INSERT INTO research_logs (query, platform, service_category, country, results_count, accepted_count, rejected_count, duplicate_count, execution_ms, status)
       VALUES (?, ?, ?, ?, 1, ?, 0, ?, 0, 'SUCCESS')`
    ).run(
      candidate.original_post_url,
      candidate.platform,
      evaluated.service_requested,
      evaluated.country || 'Worldwide',
      persisted.action === 'CREATED' ? 1 : 0,
      persisted.action === 'MERGED' ? 1 : 0
    );

    logSystemEvent(
      'INFO',
      req.user!.email,
      'MANUAL_INTAKE_PROCESSED',
      `Action: ${persisted.action}, Lead ID: ${persisted.leadId || 'N/A'}`
    );

    const leadRow = persisted.leadId ? db.prepare('SELECT * FROM leads WHERE id = ?').get(persisted.leadId) : null;
    res.json({
      accepted: true,
      action: persisted.action,
      lead: leadRow ? mapLeadRow(leadRow) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Manual intake failed' });
  }
});

// ======================== SERVICES, PLATFORMS, AGENTS ========================
app.get('/api/services', requireAuth, (_req, res) => {
  res.json({ services: getServiceCategories() });
});

app.post('/api/services', requireAuth, requireRole(['admin', 'operator']), (req: AuthenticatedRequest, res) => {
  const { name, group_name = 'Custom & Emerging Services', keywords = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Service name is required' });
  try {
    db.prepare(
      'INSERT INTO service_categories (name, group_name, keywords_json, is_emerging, is_active) VALUES (?, ?, ?, 1, 1)'
    ).run(String(name).trim(), String(group_name).trim(), JSON.stringify(keywords));
    logSystemEvent('AUDIT', req.user!.email, 'SERVICE_ADDED', `Added service category: ${name}`);
    res.status(201).json({ services: getServiceCategories() });
  } catch {
    res.status(409).json({ error: 'Service category already exists' });
  }
});

app.patch('/api/services/:id', requireAuth, requireRole(['admin', 'operator']), (req, res) => {
  const id = Number(req.params.id);
  const { is_active } = req.body || {};
  db.prepare('UPDATE service_categories SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
  res.json({ services: getServiceCategories() });
});

app.get('/api/platforms', requireAuth, (_req, res) => {
  res.json({ platforms: getPlatforms() });
});

app.patch('/api/platforms/:id', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const id = req.params.id;
  const { is_enabled } = req.body || {};
  db.prepare('UPDATE platforms SET is_enabled = ? WHERE id = ?').run(is_enabled ? 1 : 0, id);
  logSystemEvent('AUDIT', req.user!.email, 'CONNECTOR_TOGGLED', `Set ${id} is_enabled=${Boolean(is_enabled)}`);
  res.json({ platforms: getPlatforms() });
});

// ======================== DATA SOURCES & API INTEGRATIONS (SUPER ADMIN ONLY) ========================
function buildSuperAdminIntegrationsPayload() {
  const platforms = getPlatforms();
  return platforms.map((p) => {
    const def = getConnectorDefinition(p.id);
    const fields = def?.credential_fields || [];
    const maskedMap = getMaskedCredentialsForConnector(
      p.id,
      fields.map((f) => f.key)
    );
    return {
      ...p,
      credential_fields: fields.map((f) => ({
        ...f,
        configured: maskedMap[f.key]?.configured ?? false,
        masked: maskedMap[f.key]?.masked ?? '',
        updated_at: maskedMap[f.key]?.updated_at ?? null,
      })),
    };
  });
}

app.get('/api/integrations', requireAuth, requireSuperAdmin, (_req, res) => {
  const m365Masked = getMaskedCredentialsForConnector('microsoft_365_email_oauth', [
    'client_id',
    'client_secret',
    'tenant_id',
  ]);
  const appBaseUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  res.json({
    integrations: buildSuperAdminIntegrationsPayload(),
    custom_feeds: getCustomFeeds(),
    email_oauth_config: {
      gmail_firebase_provisioned: true,
      microsoft_365: {
        client_id_configured: Boolean(m365Masked.client_id?.configured),
        client_id_masked: m365Masked.client_id?.masked || '',
        client_secret_configured: Boolean(m365Masked.client_secret?.configured),
        client_secret_masked: m365Masked.client_secret?.masked || '',
        tenant_id: getDecryptedCredential('microsoft_365_email_oauth', 'tenant_id') || 'common',
        callback_url: appBaseUrl
          ? `${appBaseUrl}/api/email-accounts/oauth/microsoft/callback`
          : '/api/email-accounts/oauth/microsoft/callback',
      },
    },
  });
});

app.put('/api/integrations/microsoft-oauth', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { client_id, client_secret, tenant_id } = req.body || {};
  let updated = 0;
  if (client_id && String(client_id).trim()) {
    saveEncryptedCredential('microsoft_365_email_oauth', 'client_id', String(client_id).trim(), req.user!.email);
    updated++;
  }
  if (client_secret && String(client_secret).trim()) {
    saveEncryptedCredential('microsoft_365_email_oauth', 'client_secret', String(client_secret).trim(), req.user!.email);
    updated++;
  }
  if (tenant_id && String(tenant_id).trim()) {
    saveEncryptedCredential('microsoft_365_email_oauth', 'tenant_id', String(tenant_id).trim(), req.user!.email);
    updated++;
  }
  if (updated === 0) {
    return res.status(400).json({ error: 'Provide client_id, client_secret, or tenant_id.' });
  }
  logSystemEvent('AUDIT', req.user!.email, 'MICROSOFT_OAUTH_SAVED', 'Updated encrypted Microsoft 365 OAuth app config.');
  res.json({ ok: true });
});

app.put('/api/integrations/:id/credentials', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const id = req.params.id;
  const def = getConnectorDefinition(id);
  if (!def) return res.status(404).json({ error: 'Connector not found' });

  const credentials = req.body?.credentials;
  if (!credentials || typeof credentials !== 'object') {
    return res.status(400).json({ error: 'Credentials object is required.' });
  }

  let updatedCount = 0;
  for (const field of def.credential_fields) {
    if (credentials[field.key] !== undefined) {
      const val = String(credentials[field.key]);
      // Empty string skips overwriting existing secret unless explicit clear; non-empty encrypts and stores
      if (val.trim().length > 0) {
        saveEncryptedCredential(id, field.key, val, req.user!.email);
        updatedCount += 1;
      }
    }
  }

  if (updatedCount === 0) {
    return res.status(400).json({ error: 'Enter at least one credential value to save.' });
  }

  // Require live connection test before marking READY
  db.prepare(
    "UPDATE platforms SET status = 'UNTESTED', last_error = NULL, is_enabled = 1 WHERE id = ?"
  ).run(id);

  logSystemEvent(
    'AUDIT',
    req.user!.email,
    'INTEGRATION_CREDENTIALS_SAVED',
    `Saved encrypted credentials for ${id} (${updatedCount} field(s))`
  );

  res.json({
    integrations: buildSuperAdminIntegrationsPayload(),
    message: 'Encrypted credentials saved. Run Test Connection to verify and mark connector READY.',
  });
});

app.delete('/api/integrations/:id/credentials', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const id = req.params.id;
  const def = getConnectorDefinition(id);
  if (!def) return res.status(404).json({ error: 'Connector not found' });

  deleteConnectorCredentials(id);
  db.prepare(
    'UPDATE platforms SET status = ?, last_checked_at = NULL, last_error = NULL WHERE id = ?'
  ).run(def.default_status, id);

  logSystemEvent('AUDIT', req.user!.email, 'INTEGRATION_CREDENTIALS_CLEARED', `Cleared credentials for ${id}`);
  res.json({ integrations: buildSuperAdminIntegrationsPayload() });
});

app.post('/api/integrations/:id/test', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await testConnector(req.params.id);
    logSystemEvent(
      'AUDIT',
      req.user!.email,
      'CONNECTOR_TESTED',
      `${req.params.id} -> ${result.status} (${result.message})`
    );
    res.json({
      result,
      integrations: buildSuperAdminIntegrationsPayload(),
      custom_feeds: getCustomFeeds(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Connection test failed' });
  }
});

app.post('/api/integrations/test-all', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const results = await testAllConnectors(false);
    logSystemEvent(
      'AUDIT',
      req.user!.email,
      'CONNECTORS_TEST_ALL',
      `Tested ${results.length} connectors (${results.filter((r) => r.status === 'READY').length} READY)`
    );
    res.json({
      results,
      integrations: buildSuperAdminIntegrationsPayload(),
      custom_feeds: getCustomFeeds(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Batch connector test failed' });
  }
});

app.post('/api/integrations/custom-feeds', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  const { name, url, feed_type = 'RSS' } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ error: 'Feed name and public URL are required.' });
  }
  if (!isSafePublicUrl(String(url).trim())) {
    return res.status(400).json({ error: 'URL must be a valid public http(s) endpoint.' });
  }
  const type = feed_type === 'JSON' ? 'JSON' : 'RSS';
  try {
    const info = db
      .prepare('INSERT INTO custom_feeds (name, url, feed_type, status, is_enabled) VALUES (?, ?, ?, ?, 1)')
      .run(String(name).trim(), String(url).trim(), type, 'UNTESTED');
    const feedId = Number(info.lastInsertRowid);
    const testResult = await testCustomFeed(feedId);
    await testConnector('custom_community_feeds');
    logSystemEvent('AUDIT', req.user!.email, 'CUSTOM_FEED_ADDED', `${name} (${url}) -> ${testResult.status}`);
    res.status(201).json({
      testResult,
      custom_feeds: getCustomFeeds(),
      integrations: buildSuperAdminIntegrationsPayload(),
    });
  } catch {
    res.status(409).json({ error: 'This custom feed URL is already registered.' });
  }
});

app.post('/api/integrations/custom-feeds/:id/test', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const testResult = await testCustomFeed(Number(req.params.id));
    await testConnector('custom_community_feeds');
    res.json({
      testResult,
      custom_feeds: getCustomFeeds(),
      integrations: buildSuperAdminIntegrationsPayload(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to test custom feed' });
  }
});

app.delete('/api/integrations/custom-feeds/:id', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  db.prepare('DELETE FROM custom_feeds WHERE id = ?').run(Number(req.params.id));
  await testConnector('custom_community_feeds');
  logSystemEvent('AUDIT', req.user!.email, 'CUSTOM_FEED_DELETED', `Deleted custom feed #${req.params.id}`);
  res.json({
    custom_feeds: getCustomFeeds(),
    integrations: buildSuperAdminIntegrationsPayload(),
  });
});

// ======================== UNIVERSAL MCP & API INTEGRATIONS MARKETPLACE (SUPER ADMIN ONLY) ========================
function resolveRequestBaseUrl(req: express.Request): string {
  const origin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
  return getAppBaseUrl(origin);
}

app.get('/api/universal-integrations', requireAuth, requireSuperAdmin, (req, res) => {
  const baseUrl = resolveRequestBaseUrl(req);
  res.json({
    integrations: listUniversalIntegrations(baseUrl),
    report: getUniversalIntegrationReport(baseUrl),
  });
});

app.get('/api/universal-integrations/report', requireAuth, requireSuperAdmin, (req, res) => {
  res.json(getUniversalIntegrationReport(resolveRequestBaseUrl(req)));
});

app.post('/api/universal-integrations', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const { run_test = true, ...payload } = req.body || {};
    const created = createCustomUniversalIntegration({
      ...payload,
      actorEmail: req.user!.email,
    });
    let testResult: any = null;
    if (run_test) {
      testResult = await testUniversalIntegration(created.id, req.user!.email);
    }
    res.status(201).json({
      integration: testResult?.integration || created,
      test_result: testResult,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to create custom integration' });
  }
});

app.patch('/api/universal-integrations/:id/config', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const updated = updateUniversalIntegrationConfig(req.params.id, req.body || {}, req.user!.email);
    res.json({
      integration: updated,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update integration config' });
  }
});

app.put('/api/universal-integrations/:id/credentials', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const updated = saveUniversalCredentials(req.params.id, req.body?.credentials || {}, req.user!.email);
    res.json({
      integration: updated,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to save credentials' });
  }
});

app.delete('/api/universal-integrations/:id/credentials', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const updated = clearUniversalCredentials(req.params.id, req.user!.email);
    res.json({
      integration: updated,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to clear credentials' });
  }
});

app.patch('/api/universal-integrations/:id/toggle', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const updated = toggleUniversalIntegration(req.params.id, Boolean(req.body?.is_enabled), req.user!.email);
    res.json({
      integration: updated,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to toggle integration' });
  }
});

app.patch('/api/universal-integrations/:id/tools/:toolName', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const updated = toggleUniversalTool(
      req.params.id,
      req.params.toolName,
      Boolean(req.body?.enabled),
      req.user!.email
    );
    res.json({
      integration: updated,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to toggle tool' });
  }
});

app.post('/api/universal-integrations/:id/test', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const result = await testUniversalIntegration(req.params.id, req.user!.email);
    res.json({
      result,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Connection test failed' });
  }
});

app.post('/api/universal-integrations/:id/tools/:toolName/execute', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const execResult = await executeUniversalTool({
      integrationId: req.params.id,
      toolName: req.params.toolName,
      args: req.body?.arguments || {},
      actorEmail: req.user!.email,
    });
    res.json({
      exec_result: execResult,
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Tool execution failed' });
  }
});

app.delete('/api/universal-integrations/:id', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    deleteUniversalIntegration(req.params.id, req.user!.email);
    res.json({
      integrations: listUniversalIntegrations(baseUrl),
      report: getUniversalIntegrationReport(baseUrl),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to delete integration' });
  }
});

app.post('/api/universal-integrations/:id/oauth/start', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const baseUrl = resolveRequestBaseUrl(req);
    const result = await startUniversalOAuth({
      integrationId: req.params.id,
      appBaseUrl: baseUrl,
      actorEmail: req.user!.email,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to start OAuth flow' });
  }
});

const handleUniversalOAuthCallback: express.RequestHandler = async (req, res) => {
  const result = await completeUniversalOAuthCallback({
    integrationId: req.params.id,
    code: typeof req.query.code === 'string' ? req.query.code : undefined,
    state: typeof req.query.state === 'string' ? req.query.state : undefined,
    error: typeof req.query.error === 'string' ? req.query.error : undefined,
    errorDescription: typeof req.query.error_description === 'string' ? req.query.error_description : undefined,
  });

  const payloadJson = JSON.stringify({
    type: result.ok ? 'UNIVERSAL_OAUTH_SUCCESS' : 'UNIVERSAL_OAUTH_ERROR',
    integrationId: result.integrationId,
    message: result.message,
  });

  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authorization Complete</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a;background:#f8fafc;">
  <p>${result.ok ? 'Authorization complete. Returning to AI Buyer Hunter...' : `Authorization error: ${result.message.replace(/</g, '&lt;')}`}</p>
  <script>
    (function() {
      var data = ${payloadJson};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(data, '*');
      }
      setTimeout(function() { window.close(); }, 350);
    })();
  </script>
</body>
</html>`);
};

app.get('/api/universal-integrations/oauth/:id/callback', handleUniversalOAuthCallback);
app.get('/api/universal-integrations/oauth/:id/callback/', handleUniversalOAuthCallback);

app.get('/api/agents', requireAuth, (_req, res) => {
  res.json({ agents: getAgents() });
});

app.patch('/api/agents/:id', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const id = req.params.id;
  const { is_enabled } = req.body || {};
  db.prepare('UPDATE ai_agents SET is_enabled = ? WHERE id = ?').run(is_enabled ? 1 : 0, id);
  logSystemEvent('AUDIT', req.user!.email, 'AGENT_TOGGLED', `Agent ${id} is_enabled=${Boolean(is_enabled)}`);
  res.json({ agents: getAgents() });
});

// ======================== LOGS, DUPLICATES, SUPPRESSION, SCHEDULES ========================
app.get('/api/research-logs', requireAuth, (_req, res) => {
  res.json({ logs: getResearchLogs(100) });
});

app.get('/api/duplicates', requireAuth, (_req, res) => {
  const links = db
    .prepare(
      `SELECT d.*, l.lead_code, l.prospect_name, l.company_name, l.original_post_url as canonical_url
       FROM duplicate_links d
       JOIN leads l ON l.id = d.canonical_lead_id
       ORDER BY d.id DESC LIMIT 100`
    )
    .all();
  res.json({ duplicates: links });
});

app.get('/api/suppression', requireAuth, (_req, res) => {
  const list = db.prepare('SELECT * FROM suppression_list ORDER BY id DESC').all();
  res.json({ suppression: list });
});

app.post('/api/suppression', requireAuth, requireRole(['admin', 'operator']), (req: AuthenticatedRequest, res) => {
  const { identifier, reason } = req.body || {};
  if (!identifier) return res.status(400).json({ error: 'Identifier (email, handle, or URL) is required' });
  db.prepare('INSERT OR IGNORE INTO suppression_list (identifier, reason) VALUES (?, ?)').run(
    String(identifier).trim(),
    String(reason || 'Opt-out requested')
  );
  logSystemEvent('AUDIT', req.user!.email, 'SUPPRESSION_ADDED', `Suppressed: ${identifier}`);
  res.status(201).json({ suppression: db.prepare('SELECT * FROM suppression_list ORDER BY id DESC').all() });
});

app.delete('/api/suppression/:id', requireAuth, requireRole(['admin']), (req, res) => {
  db.prepare('DELETE FROM suppression_list WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/schedules', requireAuth, (_req, res) => {
  res.json({ schedules: getSearchSchedules() });
});

app.post('/api/schedules', requireAuth, requireRole(['admin', 'operator']), (req: AuthenticatedRequest, res) => {
  const {
    name,
    services = ['All Services'],
    platforms = ['google_custom_search', 'google_search_grounding', 'reddit_api', 'hacker_news_api'],
    countries = ['Worldwide'],
    min_score = 60,
    max_results = 8,
    frequency_minutes = 120,
    is_active = false,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Schedule name is required' });

  db.prepare(
    `INSERT INTO search_schedules (name, services_json, platforms_json, countries_json, min_score, max_results, frequency_minutes, is_active, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))`
  ).run(
    String(name),
    JSON.stringify(services),
    JSON.stringify(platforms),
    JSON.stringify(countries),
    Number(min_score),
    Number(max_results),
    Number(frequency_minutes),
    is_active ? 1 : 0,
    Number(frequency_minutes)
  );
  logSystemEvent('AUDIT', req.user!.email, 'SCHEDULE_CREATED', `Created schedule: ${name}`);
  res.status(201).json({ schedules: getSearchSchedules() });
});

app.patch('/api/schedules/:id', requireAuth, requireRole(['admin', 'operator']), (req, res) => {
  const id = Number(req.params.id);
  const { is_active, frequency_minutes } = req.body || {};
  if (is_active !== undefined) {
    db.prepare('UPDATE search_schedules SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
  }
  if (frequency_minutes !== undefined) {
    db.prepare('UPDATE search_schedules SET frequency_minutes = ? WHERE id = ?').run(Number(frequency_minutes), id);
  }
  res.json({ schedules: getSearchSchedules() });
});

app.delete('/api/schedules/:id', requireAuth, requireRole(['admin', 'operator']), (req, res) => {
  db.prepare('DELETE FROM search_schedules WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/system-logs', requireAuth, (_req, res) => {
  const logs = db.prepare('SELECT * FROM system_logs ORDER BY id DESC LIMIT 150').all();
  res.json({ logs });
});

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({ settings: getAppSettings() });
});

app.patch('/api/settings', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const allowed = [
    'thirty_day_revenue_target',
    'stretch_revenue_target',
    'stretch_target_deadline',
    'default_currency',
    'data_retention_days',
    'max_requests_per_minute',
    'auto_generate_outreach',
    'n8n_webhook_url',
    'owner_daily_send_limit',
    'owner_hourly_send_limit',
    'owner_max_concurrent_sends',
    'invited_default_concurrent_sends',
    'sandbox_mode',
  ];
  const stmt = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      stmt.run(k, String(req.body[k]));
    }
  }
  logSystemEvent('AUDIT', req.user!.email, 'SETTINGS_UPDATED', 'Updated platform settings');
  res.json({ settings: getAppSettings() });
});

app.get('/api/config/runtime-status', requireAuth, requireSuperAdmin, (_req, res) => {
  res.json({
    gemini_configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    google_custom_search_configured: Boolean(
      getDecryptedCredential('google_custom_search', 'api_key') &&
        getDecryptedCredential('google_custom_search', 'cx')
    ),
    reddit_oauth_configured: Boolean(
      getDecryptedCredential('reddit_api', 'client_id') &&
        getDecryptedCredential('reddit_api', 'client_secret')
    ),
    github_token_configured: Boolean(getDecryptedCredential('github_public_search', 'token')),
    linkedin_configured: Boolean(getDecryptedCredential('linkedin_official_api', 'access_token')),
    x_configured: Boolean(getDecryptedCredential('x_twitter_api', 'bearer_token')),
    meta_configured: Boolean(getDecryptedCredential('meta_facebook_instagram', 'access_token')),
    upwork_configured: Boolean(getDecryptedCredential('upwork_official_api', 'access_token')),
    fiverr_configured: Boolean(getDecryptedCredential('fiverr_partner_api', 'api_key')),
    bing_configured: Boolean(getDecryptedCredential('bing_search_api', 'api_key')),
    microsoft_oauth_configured: Boolean(
      getDecryptedCredential('microsoft_365_email_oauth', 'client_id') &&
        getDecryptedCredential('microsoft_365_email_oauth', 'client_secret')
    ),
    node_version: process.version,
    database_engine: 'SQLite (WAL Mode) + AES-256-GCM Credential Vault',
  });
});

// ======================== TARGET COUNTRIES (MODULE 4) ========================
app.get('/api/countries', requireAuth, (_req, res) => {
  res.json({
    countries: WORLD_COUNTRIES,
    max_target_countries: MAX_TARGET_COUNTRIES_PER_CAMPAIGN,
  });
});

app.get('/api/target-countries', requireAuth, (req: AuthenticatedRequest, res) => {
  const viewerId = req.user!.role === 'super_admin' ? undefined : req.user!.id;
  res.json({ sets: getTargetCountrySets(viewerId), max_target_countries: MAX_TARGET_COUNTRIES_PER_CAMPAIGN });
});

app.post('/api/target-countries', requireAuth, (req: AuthenticatedRequest, res) => {
  const { name, countries, is_default = false } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Target country set name is required.' });
  }
  if (!Array.isArray(countries) || countries.length === 0) {
    return res.status(400).json({ error: 'Select at least 1 target country.' });
  }
  const uniqueCountries = Array.from(new Set(countries.map((c: any) => String(c).trim()).filter(Boolean)));
  if (uniqueCountries.length > MAX_TARGET_COUNTRIES_PER_CAMPAIGN) {
    return res.status(400).json({
      error: `Maximum ${MAX_TARGET_COUNTRIES_PER_CAMPAIGN} target countries allowed per campaign/profile (received ${uniqueCountries.length}).`,
    });
  }

  const tx = db.transaction(() => {
    if (is_default) {
      db.prepare('UPDATE target_country_sets SET is_default = 0 WHERE owner_user_id = ?').run(req.user!.id);
    }
    return db
      .prepare(
        `INSERT INTO target_country_sets (name, countries_json, is_default, owner_user_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(String(name).trim(), JSON.stringify(uniqueCountries), is_default ? 1 : 0, req.user!.id);
  });
  const info = tx();
  logSystemEvent(
    'AUDIT',
    req.user!.email,
    'TARGET_COUNTRIES_SAVED',
    `Saved target country set "${name}" with ${uniqueCountries.length} countries`
  );
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    sets: getTargetCountrySets(req.user!.role === 'super_admin' ? undefined : req.user!.id),
  });
});

app.put('/api/target-countries/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM target_country_sets WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Target country set not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot edit another user’s target country set.' });
  }

  const { name, countries, is_default } = req.body || {};
  const nextCountries = Array.isArray(countries)
    ? Array.from(new Set(countries.map((c: any) => String(c).trim()).filter(Boolean)))
    : JSON.parse(existing.countries_json || '[]');
  if (nextCountries.length === 0) {
    return res.status(400).json({ error: 'At least 1 target country is required.' });
  }
  if (nextCountries.length > MAX_TARGET_COUNTRIES_PER_CAMPAIGN) {
    return res.status(400).json({
      error: `Maximum ${MAX_TARGET_COUNTRIES_PER_CAMPAIGN} target countries allowed per campaign/profile.`,
    });
  }

  const tx = db.transaction(() => {
    if (is_default) {
      db.prepare('UPDATE target_country_sets SET is_default = 0 WHERE owner_user_id = ?').run(existing.owner_user_id);
    }
    db.prepare(
      `UPDATE target_country_sets
       SET name = ?, countries_json = ?, is_default = COALESCE(?, is_default), updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      name ? String(name).trim() : existing.name,
      JSON.stringify(nextCountries),
      is_default !== undefined ? (is_default ? 1 : 0) : null,
      id
    );
  });
  tx();

  res.json({
    sets: getTargetCountrySets(req.user!.role === 'super_admin' ? undefined : req.user!.id),
  });
});

app.delete('/api/target-countries/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM target_country_sets WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Target country set not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot delete another user’s target country set.' });
  }
  db.prepare('DELETE FROM target_country_sets WHERE id = ?').run(id);
  res.json({
    sets: getTargetCountrySets(req.user!.role === 'super_admin' ? undefined : req.user!.id),
  });
});

// ======================== MULTIPLE EMAIL ACCOUNTS (MODULE 2) ========================
const pendingMicrosoftOAuthStates = new Map<
  string,
  { userId: number; userEmail: string; displayName: string; createdAt: number }
>();

app.get('/api/email-accounts', requireAuth, (req: AuthenticatedRequest, res) => {
  const includeAll = req.user!.role === 'super_admin';
  const accounts = getEmailAccountsForUser(req.user!.id, includeAll);
  const limits = getUserSendLimits(req.user!.id);
  res.json({ accounts, user_limits: limits });
});

app.post('/api/email-accounts', requireAuth, requirePermission('can_connect_email_accounts'), async (req: AuthenticatedRequest, res) => {
  const {
    provider,
    email_address,
    display_name = '',
    daily_limit = 100,
    hourly_limit = 25,
    credentials = {},
    skip_test = false,
  } = req.body || {};

  const allowedProviders: EmailProviderType[] = ['smtp', 'resend_api', 'sendgrid_api', 'sandbox_test'];
  if (!allowedProviders.includes(provider)) {
    return res.status(400).json({ error: 'Use OAuth endpoints for Gmail/Outlook, or choose smtp, resend_api, sendgrid_api, or sandbox_test.' });
  }
  const email = String(email_address || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid sending email address is required.' });
  }

  const creds: EmailAccountCredentials = {
    host: credentials.host ? String(credentials.host).trim() : undefined,
    port: credentials.port ? Number(credentials.port) : undefined,
    secure: credentials.secure !== undefined ? Boolean(credentials.secure) : undefined,
    username: credentials.username ? String(credentials.username).trim() : undefined,
    password: credentials.password ? String(credentials.password) : undefined,
    api_key: credentials.api_key ? String(credentials.api_key).trim() : undefined,
  };

  try {
    const info = db
      .prepare(
        `INSERT INTO email_accounts (
          owner_user_id, provider, email_address, display_name, status,
          daily_limit, hourly_limit, encrypted_credentials, smtp_host, smtp_port, is_active
        ) VALUES (?, ?, ?, ?, 'UNTESTED', ?, ?, ?, ?, ?, 1)`
      )
      .run(
        req.user!.id,
        provider,
        email,
        String(display_name || '').trim(),
        Math.max(1, Number(daily_limit)),
        Math.max(1, Number(hourly_limit)),
        encryptJson(creds),
        creds.host || null,
        creds.port || null
      );

    const accountId = Number(info.lastInsertRowid);
    logSystemEvent('AUDIT', req.user!.email, 'EMAIL_ACCOUNT_ADDED', `Added ${provider} account ${email}`);

    if (!skip_test) {
      const testResult = await testEmailAccountConnection(accountId);
      return res.status(201).json({
        account: testResult.account,
        test_result: testResult,
      });
    }

    res.status(201).json({ account: mapEmailAccountRow(getEmailAccountById(accountId)) });
  } catch {
    res.status(409).json({ error: 'This email account is already connected to your user profile.' });
  }
});

app.post('/api/email-accounts/gmail/connect', requireAuth, requirePermission('can_connect_email_accounts'), async (req: AuthenticatedRequest, res) => {
  const gmailToken = String(req.headers['x-gmail-access-token'] || '').trim();
  if (!gmailToken) {
    return res.status(400).json({ error: 'Google Workspace Gmail OAuth token missing.' });
  }

  const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${gmailToken}` },
  });
  if (!profileRes.ok) {
    return res.status(401).json({ error: 'Unable to verify Gmail account with Google Workspace API.' });
  }
  const profile = (await profileRes.json()) as { emailAddress?: string };
  const email = (profile.emailAddress || String(req.body?.email_address || '')).trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Google Workspace did not return a verified Gmail address.' });
  }

  const displayName = String(req.body?.display_name || '').trim();
  const dailyLimit = Math.max(1, Number(req.body?.daily_limit || 150));
  const hourlyLimit = Math.max(1, Number(req.body?.hourly_limit || 30));

  const existing = db
    .prepare('SELECT id FROM email_accounts WHERE owner_user_id = ? AND lower(email_address) = lower(?)')
    .get(req.user!.id, email) as { id: number } | undefined;

  let accountId: number;
  if (existing) {
    db.prepare(
      `UPDATE email_accounts
       SET provider = 'gmail_oauth', display_name = ?, status = 'CONNECTED',
           daily_limit = ?, hourly_limit = ?, is_active = 1, last_error = NULL,
           last_tested_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    ).run(displayName, dailyLimit, hourlyLimit, existing.id);
    accountId = existing.id;
  } else {
    const info = db
      .prepare(
        `INSERT INTO email_accounts (
          owner_user_id, provider, email_address, display_name, status,
          daily_limit, hourly_limit, encrypted_credentials, last_tested_at, is_active
        ) VALUES (?, 'gmail_oauth', ?, ?, 'CONNECTED', ?, ?, '', datetime('now'), 1)`
      )
      .run(req.user!.id, email, displayName, dailyLimit, hourlyLimit);
    accountId = Number(info.lastInsertRowid);
  }

  logSystemEvent('AUDIT', req.user!.email, 'GMAIL_OAUTH_CONNECTED', `Connected & verified Gmail account ${email}`);
  res.json({ account: mapEmailAccountRow(getEmailAccountById(accountId)) });
});

app.get('/api/email-accounts/oauth/microsoft/url', requireAuth, requirePermission('can_connect_email_accounts'), (req: AuthenticatedRequest, res) => {
  const clientId = getDecryptedCredential('microsoft_365_email_oauth', 'client_id');
  const clientSecret = getDecryptedCredential('microsoft_365_email_oauth', 'client_secret');
  const tenantId = getDecryptedCredential('microsoft_365_email_oauth', 'tenant_id') || 'common';
  const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  if (!clientId || !clientSecret) {
    return res.status(400).json({
      error: 'Microsoft 365 OAuth client credentials are not configured yet. Ask the Super Admin to add Microsoft OAuth credentials in Integrations & API Settings.',
    });
  }

  const state = crypto.randomBytes(24).toString('hex');
  pendingMicrosoftOAuthStates.set(state, {
    userId: req.user!.id,
    userEmail: req.user!.email,
    displayName: String(req.query.display_name || ''),
    createdAt: Date.now(),
  });

  // Prune stale states older than 15m
  for (const [k, v] of pendingMicrosoftOAuthStates.entries()) {
    if (Date.now() - v.createdAt > 15 * 60 * 1000) pendingMicrosoftOAuthStates.delete(k);
  }

  const redirectUri = `${appUrl}/api/email-accounts/oauth/microsoft/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'offline_access Mail.Send User.Read',
    state,
    prompt: 'select_account',
  });

  res.json({
    url: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params.toString()}`,
    redirect_uri: redirectUri,
  });
});

app.get(
  ['/api/email-accounts/oauth/microsoft/callback', '/api/email-accounts/oauth/microsoft/callback/'],
  async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const oauthErr = String(req.query.error_description || req.query.error || '');

    const renderPopupClose = (ok: boolean, message: string) => `<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
      <p>${ok ? 'Outlook / Microsoft 365 connected. Closing window...' : message}</p>
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: '${ok ? 'EMAIL_OAUTH_SUCCESS' : 'EMAIL_OAUTH_ERROR'}', provider: 'microsoft_oauth', message: ${JSON.stringify(message)} }, '*');
          window.close();
        }
      </script></body></html>`;

    if (oauthErr) {
      return res.status(400).send(renderPopupClose(false, oauthErr));
    }

    const pending = pendingMicrosoftOAuthStates.get(state);
    pendingMicrosoftOAuthStates.delete(state);
    if (!pending || !code || Date.now() - pending.createdAt > 15 * 60 * 1000) {
      return res.status(400).send(renderPopupClose(false, 'Invalid or expired OAuth state. Please retry connecting Outlook.'));
    }

    const clientId = getDecryptedCredential('microsoft_365_email_oauth', 'client_id') || '';
    const clientSecret = getDecryptedCredential('microsoft_365_email_oauth', 'client_secret') || '';
    const tenantId = getDecryptedCredential('microsoft_365_email_oauth', 'tenant_id') || 'common';
    const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const redirectUri = `${appUrl}/api/email-accounts/oauth/microsoft/callback`;

    try {
      const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: 'offline_access Mail.Send User.Read',
        }).toString(),
      });
      const tokenData = (await tokenRes.json()) as any;
      if (!tokenRes.ok || !tokenData.access_token) {
        return res.status(400).send(renderPopupClose(false, tokenData.error_description || 'Microsoft token exchange failed.'));
      }

      const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
      const mailbox = String(me.mail || me.userPrincipalName || '').trim().toLowerCase();
      if (!mailbox) {
        return res.status(400).send(renderPopupClose(false, 'Microsoft Graph did not return an email address.'));
      }

      const expiresAt = new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString();
      const creds: EmailAccountCredentials = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        expires_at: expiresAt,
      };
      const enc = encryptJson(creds);

      db.prepare(
        `INSERT INTO email_accounts (
          owner_user_id, provider, email_address, display_name, status,
          daily_limit, hourly_limit, encrypted_credentials, token_expires_at, last_tested_at, is_active
        ) VALUES (?, 'microsoft_oauth', ?, ?, 'CONNECTED', 150, 30, ?, ?, datetime('now'), 1)
        ON CONFLICT(owner_user_id, email_address) DO UPDATE SET
          provider = 'microsoft_oauth',
          status = 'CONNECTED',
          encrypted_credentials = excluded.encrypted_credentials,
          token_expires_at = excluded.token_expires_at,
          last_tested_at = datetime('now'),
          last_error = NULL,
          is_active = 1,
          updated_at = datetime('now')`
      ).run(pending.userId, mailbox, pending.displayName || me.displayName || '', enc, expiresAt);

      logSystemEvent('AUDIT', pending.userEmail, 'MICROSOFT_OAUTH_CONNECTED', `Connected Outlook/M365 mailbox ${mailbox}`);
      return res.send(renderPopupClose(true, `Connected ${mailbox}`));
    } catch (err: any) {
      return res.status(500).send(renderPopupClose(false, err?.message || 'Microsoft OAuth callback error'));
    }
  }
);

app.post('/api/email-accounts/:id/test', requireAuth, requirePermission('can_connect_email_accounts'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = getEmailAccountById(id);
  if (!existing) return res.status(404).json({ error: 'Email account not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot test another user’s email account.' });
  }
  const gmailToken = String(req.headers['x-gmail-access-token'] || '').trim() || undefined;
  const result = await testEmailAccountConnection(id, gmailToken);
  res.json(result);
});

app.patch('/api/email-accounts/:id', requireAuth, requirePermission('can_connect_email_accounts'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = getEmailAccountById(id);
  if (!existing) return res.status(404).json({ error: 'Email account not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot modify another user’s email account.' });
  }

  const { display_name, daily_limit, hourly_limit, is_active, status } = req.body || {};
  db.prepare(
    `UPDATE email_accounts
     SET display_name = COALESCE(?, display_name),
         daily_limit = COALESCE(?, daily_limit),
         hourly_limit = COALESCE(?, hourly_limit),
         is_active = COALESCE(?, is_active),
         status = COALESCE(?, status),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    display_name !== undefined ? String(display_name) : null,
    daily_limit !== undefined ? Math.max(1, Number(daily_limit)) : null,
    hourly_limit !== undefined ? Math.max(1, Number(hourly_limit)) : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    status === 'DISCONNECTED' ? 'DISCONNECTED' : null,
    id
  );
  res.json({ account: mapEmailAccountRow(getEmailAccountById(id)) });
});

app.delete('/api/email-accounts/:id', requireAuth, requirePermission('can_connect_email_accounts'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = getEmailAccountById(id);
  if (!existing) return res.status(404).json({ error: 'Email account not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot delete another user’s email account.' });
  }
  db.prepare('DELETE FROM email_accounts WHERE id = ?').run(id);
  logSystemEvent('AUDIT', req.user!.email, 'EMAIL_ACCOUNT_REMOVED', `Removed sending account ${existing.email_address}`);
  res.json({ ok: true });
});

// ======================== EMAIL CAMPAIGNS (MODULES 4, 8) ========================
app.get('/api/campaigns', requireAuth, (req: AuthenticatedRequest, res) => {
  const isOwner = req.user!.role === 'super_admin';
  const rows = (
    isOwner
      ? db
          .prepare(
            `SELECT c.*, u.email as owner_email, ea.email_address as default_email_address,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id) as total_emails,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.approval_status IN ('SENT','DELIVERED','BOUNCED')) as sent_emails,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.replied_at IS NOT NULL) as replies_count
             FROM campaigns c
             LEFT JOIN users u ON u.id = c.owner_user_id
             LEFT JOIN email_accounts ea ON ea.id = c.default_email_account_id
             ORDER BY c.id DESC`
          )
          .all()
      : db
          .prepare(
            `SELECT c.*, u.email as owner_email, ea.email_address as default_email_address,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id) as total_emails,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.approval_status IN ('SENT','DELIVERED','BOUNCED')) as sent_emails,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.replied_at IS NOT NULL) as replies_count
             FROM campaigns c
             LEFT JOIN users u ON u.id = c.owner_user_id
             LEFT JOIN email_accounts ea ON ea.id = c.default_email_account_id
             WHERE c.owner_user_id = ?
             ORDER BY c.id DESC`
          )
          .all(req.user!.id)
  ) as any[];

  res.json({
    campaigns: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      owner_user_id: r.owner_user_id,
      owner_email: r.owner_email,
      default_email_account_id: r.default_email_account_id ?? null,
      default_email_address: r.default_email_address || null,
      target_countries: JSON.parse(r.target_countries_json || '[]'),
      target_services: JSON.parse(r.target_services_json || '[]'),
      status: r.status,
      total_emails: Number(r.total_emails || 0),
      sent_emails: Number(r.sent_emails || 0),
      replies_count: Number(r.replies_count || 0),
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

app.post('/api/campaigns', requireAuth, (req: AuthenticatedRequest, res) => {
  const { name, description = '', default_email_account_id = null, target_countries = [], target_services = [] } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Campaign name is required.' });
  }
  const countries = Array.isArray(target_countries)
    ? Array.from(new Set(target_countries.map((c: any) => String(c).trim()).filter(Boolean)))
    : [];
  if (countries.length > MAX_TARGET_COUNTRIES_PER_CAMPAIGN) {
    return res.status(400).json({
      error: `Campaigns support a maximum of ${MAX_TARGET_COUNTRIES_PER_CAMPAIGN} target countries.`,
    });
  }

  const info = db
    .prepare(
      `INSERT INTO campaigns (name, description, owner_user_id, default_email_account_id, target_countries_json, target_services_json, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`
    )
    .run(
      String(name).trim(),
      String(description).trim(),
      req.user!.id,
      default_email_account_id ? Number(default_email_account_id) : null,
      JSON.stringify(countries),
      JSON.stringify(Array.isArray(target_services) ? target_services : [])
    );
  logSystemEvent('AUDIT', req.user!.email, 'CAMPAIGN_CREATED', `Created campaign "${name}" (${countries.length} countries)`);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.patch('/api/campaigns/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Campaign not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot edit another user’s campaign.' });
  }
  const { name, description, status, default_email_account_id, target_countries, target_services } = req.body || {};
  if (Array.isArray(target_countries) && target_countries.length > MAX_TARGET_COUNTRIES_PER_CAMPAIGN) {
    return res.status(400).json({ error: `Max ${MAX_TARGET_COUNTRIES_PER_CAMPAIGN} countries per campaign.` });
  }
  db.prepare(
    `UPDATE campaigns
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         status = COALESCE(?, status),
         default_email_account_id = ?,
         target_countries_json = COALESCE(?, target_countries_json),
         target_services_json = COALESCE(?, target_services_json),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name ? String(name).trim() : null,
    description !== undefined ? String(description) : null,
    status && ['ACTIVE', 'PAUSED', 'COMPLETED'].includes(status) ? status : null,
    default_email_account_id !== undefined ? (default_email_account_id ? Number(default_email_account_id) : null) : existing.default_email_account_id,
    Array.isArray(target_countries) ? JSON.stringify(target_countries) : null,
    Array.isArray(target_services) ? JSON.stringify(target_services) : null,
    id
  );
  res.json({ ok: true });
});

app.delete('/api/campaigns/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Campaign not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot delete another user’s campaign.' });
  }
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ======================== AI EMAIL WRITER & APPROVAL CENTER (MODULES 6, 7) ========================
app.get('/api/email-messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const viewerScopeUserId = req.user!.role === 'super_admin' ? undefined : req.user!.id;
  const messages = getEmailMessages({
    viewerScopeUserId,
    status: req.query.status ? String(req.query.status) : undefined,
    campaignId: req.query.campaignId ? Number(req.query.campaignId) : undefined,
    leadId: req.query.leadId ? Number(req.query.leadId) : undefined,
  });
  res.json({ messages });
});

app.post('/api/email-messages/generate', requireAuth, requirePermission('can_generate_emails'), async (req: AuthenticatedRequest, res) => {
  const { lead_id, campaign_id = null, email_account_id = null, target_language, save_status = 'AWAITING_APPROVAL' } = req.body || {};
  if (!lead_id) return res.status(400).json({ error: 'lead_id is required.' });
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(lead_id)) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  if (req.user!.role !== 'super_admin' && req.user!.role !== 'admin' && lead.assigned_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'You can only generate emails for leads assigned to you.' });
  }

  try {
    const emailMessage = await generatePersonalizedEmailForLead({
      leadId: Number(lead_id),
      ownerUserId: req.user!.id,
      ownerEmail: req.user!.email,
      campaignId: campaign_id ? Number(campaign_id) : null,
      emailAccountId: email_account_id ? Number(email_account_id) : null,
      targetLanguageOverride: target_language ? String(target_language) : undefined,
      saveStatus: save_status === 'DRAFT' ? 'DRAFT' : 'AWAITING_APPROVAL',
    });
    res.status(201).json({ email_message: emailMessage });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate personalized email.' });
  }
});

app.patch('/api/email-messages/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Email message not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot edit another user’s email draft.' });
  }
  if (['SENT', 'DELIVERED'].includes(existing.approval_status)) {
    return res.status(400).json({ error: 'Sent emails cannot be modified.' });
  }

  const {
    recipient_email,
    email_account_id,
    campaign_id,
    subject_local,
    body_local,
    subject_english,
    body_english,
    call_to_action,
    detected_language,
    approval_status,
  } = req.body || {};

  // Strictly block changing status directly to APPROVED/SENT via PATCH; must use approve-send endpoint
  const nextStatus =
    approval_status && ['DRAFT', 'AWAITING_APPROVAL'].includes(approval_status)
      ? approval_status
      : existing.approval_status;

  db.prepare(
    `UPDATE email_messages
     SET recipient_email = COALESCE(?, recipient_email),
         email_account_id = ?,
         campaign_id = ?,
         subject_local = COALESCE(?, subject_local),
         body_local = COALESCE(?, body_local),
         subject_english = COALESCE(?, subject_english),
         body_english = COALESCE(?, body_english),
         call_to_action = COALESCE(?, call_to_action),
         detected_language = COALESCE(?, detected_language),
         approval_status = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    recipient_email !== undefined ? String(recipient_email).trim() : null,
    email_account_id !== undefined ? (email_account_id ? Number(email_account_id) : null) : existing.email_account_id,
    campaign_id !== undefined ? (campaign_id ? Number(campaign_id) : null) : existing.campaign_id,
    subject_local !== undefined ? String(subject_local) : null,
    body_local !== undefined ? String(body_local) : null,
    subject_english !== undefined ? String(subject_english) : null,
    body_english !== undefined ? String(body_english) : null,
    call_to_action !== undefined ? String(call_to_action) : null,
    detected_language !== undefined ? String(detected_language) : null,
    nextStatus,
    id
  );

  const row = db
    .prepare(
      `SELECT em.*, l.lead_code, u.email as owner_email, c.name as campaign_name,
              ea.email_address as sending_email_address, ea.provider as sending_provider
       FROM email_messages em
       LEFT JOIN leads l ON l.id = em.lead_id
       LEFT JOIN users u ON u.id = em.owner_user_id
       LEFT JOIN campaigns c ON c.id = em.campaign_id
       LEFT JOIN email_accounts ea ON ea.id = em.email_account_id
       WHERE em.id = ?`
    )
    .get(id);
  res.json({ email_message: mapEmailMessageRow(row) });
});

app.post('/api/email-messages/:id/approve-send', requireAuth, requirePermission('can_approve_emails'), requirePermission('can_send_emails'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Email message not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot approve or send another user’s email.' });
  }

  const emailAccountId = Number(req.body?.email_account_id || existing.email_account_id);
  if (!emailAccountId) {
    return res.status(400).json({ error: 'Select a connected sending email account before approving.' });
  }
  const account = getEmailAccountById(emailAccountId);
  if (!account) return res.status(404).json({ error: 'Selected email account not found.' });
  if (req.user!.role !== 'super_admin' && account.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'You can only send from email accounts connected to your own user account.' });
  }

  const gmailToken = String(req.headers['x-gmail-access-token'] || '').trim() || undefined;
  try {
    const result = await approveAndDispatchIndividualEmail({
      emailMessageId: id,
      approverUserId: req.user!.id,
      approverEmail: req.user!.email,
      emailAccountId,
      recipientEmail: req.body?.recipient_email,
      subjectLocal: req.body?.subject_local,
      bodyLocal: req.body?.body_local,
      transientGmailToken: gmailToken,
    });
    res.json({
      ...result,
      email_message: mapEmailMessageRow(
        db
          .prepare(
            `SELECT em.*, l.lead_code, u.email as owner_email, c.name as campaign_name,
                    ea.email_address as sending_email_address, ea.provider as sending_provider
             FROM email_messages em
             LEFT JOIN leads l ON l.id = em.lead_id
             LEFT JOIN users u ON u.id = em.owner_user_id
             LEFT JOIN campaigns c ON c.id = em.campaign_id
             LEFT JOIN email_accounts ea ON ea.id = em.email_account_id
             WHERE em.id = ?`
          )
          .get(id)
      ),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Approval & dispatch failed.' });
  }
});

app.post('/api/email-messages/:id/reject', requireAuth, requirePermission('can_approve_emails'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Email message not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot reject another user’s email.' });
  }

  db.prepare(
    `UPDATE email_messages
     SET approval_status = 'REJECTED',
         rejected_by_email = ?,
         rejected_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(req.user!.email, id);
  db.prepare("UPDATE email_queue SET status = 'CANCELLED', last_error = 'Rejected by user' WHERE email_message_id = ?").run(id);
  logSystemEvent('AUDIT', req.user!.email, 'EMAIL_REJECTED', `Rejected individual email #${id}`);
  res.json({ ok: true });
});

app.post('/api/email-messages/:id/record-outcome', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Email message not found.' });
  if (req.user!.role !== 'super_admin' && existing.owner_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { outcome, deal_status, revenue_received, note } = req.body || {};
  if (outcome === 'REPLIED') {
    db.prepare("UPDATE email_messages SET replied_at = COALESCE(replied_at, datetime('now')), updated_at = datetime('now') WHERE id = ?").run(id);
    db.prepare("UPDATE leads SET deal_status = ?, updated_at = datetime('now') WHERE id = ?").run(
      deal_status || 'Reply Received',
      existing.lead_id
    );
    db.prepare('INSERT INTO contact_history (lead_id, channel, direction, subject, message, status) VALUES (?, ?, ?, ?, ?, ?)').run(
      existing.lead_id,
      'Email Reply',
      'INBOUND',
      existing.subject_local,
      String(note || 'Prospect replied to cold outreach email.'),
      'RECEIVED'
    );
  } else if (outcome === 'DELIVERED') {
    db.prepare(
      "UPDATE email_messages SET approval_status = 'DELIVERED', delivered_at = COALESCE(delivered_at, datetime('now')), updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  } else if (outcome === 'BOUNCED') {
    db.prepare("UPDATE email_messages SET approval_status = 'BOUNCED', error_message = 'Marked bounced', updated_at = datetime('now') WHERE id = ?").run(id);
    if (existing.recipient_email) {
      db.prepare('INSERT OR IGNORE INTO suppression_list (identifier, reason) VALUES (?, ?)').run(
        existing.recipient_email,
        'Bounced address'
      );
    }
  } else if (outcome === 'CONVERTED') {
    const rev = Number(revenue_received || 0);
    db.prepare("UPDATE email_messages SET replied_at = COALESCE(replied_at, datetime('now')), updated_at = datetime('now') WHERE id = ?").run(id);
    db.prepare("UPDATE leads SET deal_status = 'Won', revenue_received = ?, updated_at = datetime('now') WHERE id = ?").run(
      rev,
      existing.lead_id
    );
  }
  logSystemEvent('AUDIT', req.user!.email, 'EMAIL_OUTCOME_RECORDED', `Email #${id} outcome=${outcome}`);
  res.json({ ok: true });
});

// ======================== EMAIL QUEUE & SANDBOX OUTBOX (MODULES 3, 12) ========================
app.get('/api/email-queue', requireAuth, (req: AuthenticatedRequest, res) => {
  const isOwner = req.user!.role === 'super_admin';
  const items = isOwner
    ? db
        .prepare(
          `SELECT q.*, u.email as user_email, ea.email_address as sending_email,
                  em.recipient_email, em.subject_local
           FROM email_queue q
           LEFT JOIN users u ON u.id = q.user_id
           LEFT JOIN email_accounts ea ON ea.id = q.email_account_id
           LEFT JOIN email_messages em ON em.id = q.email_message_id
           ORDER BY q.id DESC LIMIT 200`
        )
        .all()
    : db
        .prepare(
          `SELECT q.*, u.email as user_email, ea.email_address as sending_email,
                  em.recipient_email, em.subject_local
           FROM email_queue q
           LEFT JOIN users u ON u.id = q.user_id
           LEFT JOIN email_accounts ea ON ea.id = q.email_account_id
           LEFT JOIN email_messages em ON em.id = q.email_message_id
           WHERE q.user_id = ?
           ORDER BY q.id DESC LIMIT 200`
        )
        .all(req.user!.id);

  res.json({
    queue: items,
    user_limits: getUserSendLimits(req.user!.id),
    active_concurrency: isOwner ? getActiveConcurrencySnapshot() : undefined,
  });
});

app.post('/api/email-queue/:id/retry', requireAuth, requirePermission('can_send_emails'), async (req: AuthenticatedRequest, res) => {
  const queueId = Number(req.params.id);
  const qRow = db.prepare('SELECT * FROM email_queue WHERE id = ?').get(queueId) as any;
  if (!qRow) return res.status(404).json({ error: 'Queue item not found.' });
  if (req.user!.role !== 'super_admin' && qRow.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const gmailToken = String(req.headers['x-gmail-access-token'] || '').trim() || undefined;
  const result = await processQueueItem(queueId, gmailToken);
  res.json(result);
});

app.get('/api/sandbox-outbox', requireAuth, (req: AuthenticatedRequest, res) => {
  const isOwner = req.user!.role === 'super_admin';
  const rows = isOwner
    ? db.prepare('SELECT * FROM sandbox_outbox ORDER BY id DESC LIMIT 100').all()
    : db
        .prepare(
          `SELECT so.* FROM sandbox_outbox so
           JOIN email_messages em ON em.id = so.email_message_id
           WHERE em.owner_user_id = ?
           ORDER BY so.id DESC LIMIT 100`
        )
        .all(req.user!.id);
  res.json({ outbox: rows });
});

// ======================== EMAIL ANALYTICS & FOLLOW-UPS (MODULES 8, 9) ========================
app.get('/api/email-analytics', requireAuth, (req: AuthenticatedRequest, res) => {
  const viewerScopeUserId = req.user!.role === 'super_admin' ? undefined : req.user!.id;
  const analytics = getEmailAnalytics({
    country: req.query.country ? String(req.query.country) : undefined,
    service: req.query.service ? String(req.query.service) : undefined,
    language: req.query.language ? String(req.query.language) : undefined,
    campaignId: req.query.campaignId ? Number(req.query.campaignId) : undefined,
    emailAccountId: req.query.emailAccountId ? Number(req.query.emailAccountId) : undefined,
    userId: req.user!.role === 'super_admin' && req.query.userId ? Number(req.query.userId) : undefined,
    dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
    dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
    viewerScopeUserId,
  });
  res.json(analytics);
});

app.post('/api/follow-ups/generate', requireAuth, requirePermission('can_generate_emails'), async (req: AuthenticatedRequest, res) => {
  const { lead_id, email_account_id = null, campaign_id = null } = req.body || {};
  if (!lead_id) return res.status(400).json({ error: 'lead_id is required.' });

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(lead_id)) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  if (req.user!.role !== 'super_admin' && req.user!.role !== 'admin' && lead.assigned_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot generate follow-ups for leads not assigned to you.' });
  }

  if (isRecipientSuppressed(lead.public_business_email || '', lead.original_post_url, lead.username)) {
    return res.status(400).json({ error: 'Prospect has opted out (on suppression list). Follow-ups are blocked.' });
  }
  if (
    ['Reply Received', 'Interested Prospect', 'Call Requested', 'Meeting Booked', 'Proposal Submitted', 'Negotiation', 'Won', 'Lost'].includes(
      lead.deal_status
    )
  ) {
    return res.status(400).json({
      error: `Follow-up sequence stopped because prospect status is "${lead.deal_status}".`,
    });
  }

  const prevCountRow = db
    .prepare('SELECT COUNT(*) as c FROM email_messages WHERE lead_id = ?')
    .get(lead.id) as { c: number };
  const priorMessages = db
    .prepare("SELECT subject_local, body_local, sent_at FROM email_messages WHERE lead_id = ? AND approval_status IN ('SENT','DELIVERED') ORDER BY id DESC LIMIT 2")
    .all(lead.id) as Array<{ subject_local: string; body_local: string; sent_at: string }>;

  try {
    const draft = await generatePersonalizedEmailForLead({
      leadId: lead.id,
      ownerUserId: req.user!.id,
      ownerEmail: req.user!.email,
      campaignId: campaign_id ? Number(campaign_id) : null,
      emailAccountId: email_account_id ? Number(email_account_id) : null,
      saveStatus: 'AWAITING_APPROVAL',
      isFollowUp: true,
      followUpStep: Number(prevCountRow?.c || 0) + 1,
      previousContext:
        priorMessages.length > 0
          ? priorMessages.map((p) => `Sent ${p.sent_at}: "${p.subject_local}"`).join(' | ')
          : 'Initial cold outreach follow-up',
    });
    res.status(201).json({ email_message: draft });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate follow-up draft.' });
  }
});

// ======================== EXPORTS & BACKUP ========================
app.get('/api/export/leads.csv', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db.prepare('SELECT * FROM leads WHERE canonical_lead_id IS NULL ORDER BY lead_score DESC').all() as any[];
  const headers = [
    'lead_code',
    'prospect_name',
    'company_name',
    'social_platform',
    'original_post_url',
    'service_requested',
    'intent_classification',
    'lead_score',
    'lead_priority',
    'budget',
    'budget_evidence_type',
    'country',
    'city',
    'company_website',
    'public_business_email',
    'deal_status',
    'deal_value',
    'revenue_received',
    'date_discovered',
  ];
  const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');

  logSystemEvent('AUDIT', req.user!.email, 'CSV_EXPORT', `Exported ${rows.length} leads`);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ai-buyer-hunter-leads.csv"');
  res.send(csv);
});

app.get('/api/export/backup.json', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const backup = {
    exported_at: new Date().toISOString(),
    leads: db.prepare('SELECT * FROM leads').all(),
    contact_history: db.prepare('SELECT * FROM contact_history').all(),
    suppression_list: db.prepare('SELECT * FROM suppression_list').all(),
    service_categories: db.prepare('SELECT * FROM service_categories').all(),
    search_schedules: db.prepare('SELECT * FROM search_schedules').all(),
    research_logs: db.prepare('SELECT * FROM research_logs').all(),
    app_settings: db.prepare('SELECT * FROM app_settings').all(),
  };
  logSystemEvent('AUDIT', req.user!.email, 'DATABASE_BACKUP', 'Downloaded full JSON database backup');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="ai-buyer-hunter-backup.json"');
  res.send(JSON.stringify(backup, null, 2));
});

// ======================== SERVER & VITE SETUP ========================
async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  startScheduler();
  startEmailQueueWorker();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI BUYER HUNTER server listening on http://0.0.0.0:${PORT}`);
    // Asynchronously run real live connectivity tests for configured / public connectors on startup
    setTimeout(() => {
      testAllConnectors(false).catch((err) => {
        console.error('Startup connector verification failed:', err);
      });
    }, 500);
  });
}

startServer();
