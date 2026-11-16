import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import {
  db,
  getAppSettings,
  logSystemEvent,
  parseUserPermissions,
  SUPER_ADMIN_EMAIL,
} from './db.js';
import type { UserAccount, UserPermissions, UserRole, UserStatus } from '../shared/types.js';

export interface AuthenticatedRequest extends Request {
  user?: UserAccount;
}

const SESSION_COOKIE_NAME = 'abh_session';
const SESSION_TTL_HOURS = 72;

// Simple in-memory login rate limiter
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 25) {
    return false;
  }
  entry.count += 1;
  return true;
}

export function mapUserRow(row: any): UserAccount {
  const isOwner = Boolean(row.is_owner) || String(row.email).toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  const effectiveRole: UserRole = isOwner ? 'super_admin' : (row.role as UserRole);
  const status: UserStatus = isOwner ? 'ACTIVE' : ((row.status as UserStatus) || 'ACTIVE');
  const settings = isOwner ? getAppSettings() : null;
  const permissions = parseUserPermissions(row.permissions_json, effectiveRole);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: effectiveRole,
    status,
    is_owner: isOwner,
    password_setup_required: Boolean(row.password_setup_required) || !row.password_hash,
    permissions,
    daily_send_limit: isOwner ? settings!.owner_daily_send_limit : Number(row.daily_send_limit ?? 50),
    hourly_send_limit: isOwner ? settings!.owner_hourly_send_limit : Number(row.hourly_send_limit ?? 15),
    max_concurrent_sends: isOwner
      ? settings!.owner_max_concurrent_sends
      : Number(row.max_concurrent_sends ?? settings?.invited_default_concurrent_sends ?? 5),
    invited_by: row.invited_by || null,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  return token;
}

export function getUserBySessionToken(token: string | undefined): UserAccount | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = mapUserRow(row);
  if (user.status === 'SUSPENDED') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return user;
}

function isHttpsRequest(req?: Request): boolean {
  if (!req) return process.env.NODE_ENV === 'production';
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.secure || proto.includes('https') || process.env.NODE_ENV === 'production';
}

export function setSessionCookie(res: Response, token: string, req?: Request) {
  const https = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    maxAge: SESSION_TTL_HOURS * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, req?: Request) {
  const https = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: https ? 'none' : 'lax',
    secure: https,
  });
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  const user = getUserBySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    // Permanent owner super_admin has full administrative access across all protected routes
    if (req.user.role === 'super_admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    logSystemEvent(
      'WARN',
      req.user.email,
      'UNAUTHORIZED_ROLE_ACCESS',
      `Attempted ${req.method} ${req.path} with role ${req.user.role}`
    );
    return res.status(403).json({ error: 'Insufficient permissions for this action' });
  };
}

export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (
    req.user.role !== 'super_admin' ||
    req.user.email.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()
  ) {
    logSystemEvent(
      'WARN',
      req.user.email,
      'UNAUTHORIZED_SUPER_ADMIN_ACCESS',
      `Blocked non-owner access to ${req.method} ${req.path} (role: ${req.user.role})`
    );
    return res.status(403).json({
      error: `Restricted to permanent Super Admin (${SUPER_ADMIN_EMAIL}) only.`,
    });
  }
  return next();
}

export function requirePermission(permission: keyof UserPermissions) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role === 'super_admin' || req.user.permissions?.[permission]) {
      return next();
    }
    logSystemEvent(
      'WARN',
      req.user.email,
      'UNAUTHORIZED_PERMISSION_ACCESS',
      `Blocked ${req.method} ${req.path} (missing permission: ${permission})`
    );
    return res.status(403).json({ error: `Permission "${permission}" is required for this action.` });
  };
}

export type AuthCheckResult =
  | { status: 'OK'; user: UserAccount }
  | { status: 'PASSWORD_SETUP_REQUIRED'; user: UserAccount }
  | { status: 'SUSPENDED' }
  | { status: 'INVALID_CREDENTIALS' };

export function authenticateUser(email: string, password: string): AuthCheckResult {
  const row = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim()) as any;
  if (!row) return { status: 'INVALID_CREDENTIALS' };

  const mapped = mapUserRow(row);
  if (mapped.status === 'SUSPENDED') {
    return { status: 'SUSPENDED' };
  }

  if (row.password_setup_required === 1 || !row.password_hash) {
    return { status: 'PASSWORD_SETUP_REQUIRED', user: mapped };
  }

  const ok = bcrypt.compareSync(password, row.password_hash);
  if (!ok) return { status: 'INVALID_CREDENTIALS' };

  return { status: 'OK', user: mapped };
}

export function getAccountSetupStatus(email: string): { exists: boolean; password_setup_required: boolean; is_owner: boolean } {
  const row = db
    .prepare('SELECT id, email, is_owner, password_setup_required, password_hash FROM users WHERE lower(email) = lower(?)')
    .get(email.trim()) as any;
  if (!row) {
    return { exists: false, password_setup_required: false, is_owner: false };
  }
  return {
    exists: true,
    password_setup_required: Boolean(row.password_setup_required) || !row.password_hash,
    is_owner: Boolean(row.is_owner) || String(row.email).toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase(),
  };
}

export function completeInitialPasswordSetup(email: string, newPassword: string): UserAccount {
  const row = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim()) as any;
  if (!row) {
    throw new Error('Account not found');
  }
  if (row.password_setup_required !== 1 && Boolean(row.password_hash)) {
    throw new Error('Initial password setup has already been completed for this account.');
  }
  if (newPassword.length < 10) {
    throw new Error('Password must be at least 10 characters long.');
  }

  if (row.status === 'SUSPENDED') {
    throw new Error('This account has been suspended by the administrator.');
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare(
    "UPDATE users SET password_hash = ?, password_setup_required = 0, status = 'ACTIVE' WHERE id = ?"
  ).run(hash, row.id);
  logSystemEvent('AUDIT', row.email, 'OWNER_PASSWORD_INITIALIZED', 'Initial password configured securely.');
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
  return mapUserRow(updated);
}

export function changeUserPassword(userId: number, currentPassword: string, newPassword: string) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!row) throw new Error('User not found');
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    throw new Error('Current password is incorrect.');
  }
  if (newPassword.length < 10) {
    throw new Error('New password must be at least 10 characters long.');
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ?, password_setup_required = 0 WHERE id = ?').run(hash, userId);
  logSystemEvent('AUDIT', row.email, 'PASSWORD_CHANGED', 'User rotated their account password.');
}

export function createPasswordResetTokenForEmail(email: string): { issued: boolean } {
  const row = db.prepare('SELECT id, email FROM users WHERE lower(email) = lower(?)').get(email.trim()) as any;
  if (!row) return { issued: false };

  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash,
    row.id,
    expiresAt
  );

  // Never send reset token in HTTP response; log securely to server console only for operator recovery
  console.info(`[SECURITY] Password reset token issued for ${row.email} (expires in 15m): ${rawToken}`);
  logSystemEvent('AUDIT', row.email, 'PASSWORD_RESET_REQUESTED', 'One-time reset token generated on server.');
  return { issued: true };
}

export function resetPasswordWithToken(email: string, rawToken: string, newPassword: string): UserAccount {
  const row = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim()) as any;
  if (!row) throw new Error('Invalid reset request.');
  if (newPassword.length < 10) throw new Error('Password must be at least 10 characters long.');

  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  const tokenRow = db
    .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ? AND user_id = ? AND used_at IS NULL')
    .get(tokenHash, row.id) as any;

  if (!tokenRow || new Date(tokenRow.expires_at).getTime() < Date.now()) {
    throw new Error('Reset token is invalid or expired.');
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  const tx = db.transaction(() => {
    db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token_hash = ?").run(tokenHash);
    db.prepare('UPDATE users SET password_hash = ?, password_setup_required = 0 WHERE id = ?').run(hash, row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  });
  tx();

  logSystemEvent('AUDIT', row.email, 'PASSWORD_RESET_COMPLETED', 'Password reset completed via one-time token.');
  return mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id));
}
