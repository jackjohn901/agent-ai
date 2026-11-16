import React, { useEffect, useState } from 'react';
import { Lock, Shield, Sliders, Trash2, UserPlus } from 'lucide-react';
import { api, isAdmin, isSuperAdmin } from '../lib/api';
import type { UserAccount, UserPermissions } from '../../shared/types';

const PERMISSION_LABELS: Array<{ key: keyof UserPermissions; label: string }> = [
  { key: 'can_discover', label: 'Run Lead Discovery' },
  { key: 'can_generate_emails', label: 'Generate AI Cold Emails' },
  { key: 'can_approve_emails', label: 'Approve Emails' },
  { key: 'can_send_emails', label: 'Dispatch Approved Emails' },
  { key: 'can_connect_email_accounts', label: 'Connect Own Email Accounts' },
  { key: 'can_manage_leads', label: 'Edit / Manage Assigned Leads' },
  { key: 'can_view_analytics', label: 'View Email Analytics' },
];

const DEFAULT_OPERATOR_PERMS: UserPermissions = {
  can_discover: true,
  can_generate_emails: true,
  can_approve_emails: true,
  can_send_emails: true,
  can_connect_email_accounts: true,
  can_manage_leads: true,
  can_view_analytics: true,
};

export function InvitedUsersPage({ user }: { user: UserAccount }) {
  const adminAccess = isAdmin(user);
  const superAdminAccess = isSuperAdmin(user);

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Invite form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'operator' | 'viewer' | 'admin'>('operator');
  const [inviteMode, setInviteMode] = useState(true);
  const [password, setPassword] = useState('');
  const [dailyLimit, setDailyLimit] = useState(50);
  const [hourlyLimit, setHourlyLimit] = useState(15);
  const [concurrentLimit, setConcurrentLimit] = useState(5);
  const [perms, setPerms] = useState<UserPermissions>({ ...DEFAULT_OPERATOR_PERMS });

  async function refresh() {
    if (!adminAccess) return;
    setLoading(true);
    try {
      const res = await api.getUsers();
      setUsers(res.users);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [adminAccess]);

  if (!adminAccess) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-3">
        <Lock className="w-4 h-4 text-amber-600 shrink-0" />
        <span>
          Invited User Management is accessible only to the Owner / Super Admin and Administrators.
        </span>
      </div>
    );
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await api.createUser({
        name: name.trim(),
        email: email.trim(),
        role,
        invite_mode: inviteMode,
        password: inviteMode ? undefined : password,
        permissions: perms,
        daily_send_limit: dailyLimit,
        hourly_send_limit: hourlyLimit,
        max_concurrent_sends: superAdminAccess ? concurrentLimit : 5,
      });
      setName('');
      setEmail('');
      setPassword('');
      setFeedback({
        ok: true,
        text: inviteMode
          ? 'User invited! They can activate their account by entering their email on the sign-in screen to set a password.'
          : 'User account created and active immediately.',
      });
      await refresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Failed to invite user' });
    }
  }

  async function handleUpdateUser(target: UserAccount, patch: Parameters<typeof api.updateUser>[1]) {
    setFeedback(null);
    try {
      await api.updateUser(target.id, patch);
      setFeedback({ ok: true, text: `Updated ${target.email}.` });
      await refresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Update failed' });
    }
  }

  async function handleDeleteUser(target: UserAccount) {
    setFeedback(null);
    try {
      await api.deleteUser(target.id);
      setFeedback({ ok: true, text: `Removed user ${target.email}.` });
      await refresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Delete failed' });
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite User Panel */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Invite Team User &amp; Configure Granular Permissions
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Invited users receive their own isolated email accounts, assigned leads, and default 5-concurrent-send guardrails. They can never view owner secrets or promote themselves to administrator.
          </p>
        </div>

        <form onSubmit={handleInvite} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
              <input
                type="text"
                required
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Work Email</label>
              <input
                type="email"
                required
                placeholder="jane@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="operator">Invited Operator</option>
                <option value="viewer">Viewer (Read-Only)</option>
                {superAdminAccess && <option value="admin">Operations Admin</option>}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Onboarding Mode</label>
              <select
                value={inviteMode ? 'invite' : 'password'}
                onChange={(e) => setInviteMode(e.target.value === 'invite')}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="invite">Invite (User sets password on 1st login)</option>
                <option value="password">Create with Temporary Password</option>
              </select>
            </div>
          </div>

          {!inviteMode && (
            <div className="max-w-xs">
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Initial Password (min 10 characters)
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Daily Send Limit</label>
              <input
                type="number"
                min={1}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Hourly Send Limit</label>
              <input
                type="number"
                min={1}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Max Concurrent Sends
              </label>
              <input
                type="number"
                min={1}
                disabled={!superAdminAccess}
                value={concurrentLimit}
                onChange={(e) => setConcurrentLimit(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <div className="font-medium text-slate-700 dark:text-slate-300 mb-2">Granular User Permissions</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {PERMISSION_LABELS.map((p) => (
                <label
                  key={p.key}
                  className="inline-flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-800 rounded cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <input
                    type="checkbox"
                    checked={perms[p.key]}
                    onChange={(e) => setPerms((prev) => ({ ...prev, [p.key]: e.target.checked }))}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{inviteMode ? 'Send Account Invite' : 'Create User Account'}</span>
            </button>
          </div>
        </form>

        {feedback && (
          <div
            className={`p-3 border rounded text-xs ${
              feedback.ok
                ? 'border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20'
            }`}
          >
            {feedback.text}
          </div>
        )}
      </div>

      {/* Users Table & Permissions Editor */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Team Directory &amp; Sending Quotas ({users.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-8 text-xs text-slate-500">Loading users...</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {users.map((u) => {
              const ownerLocked = Boolean(u.is_owner) || u.role === 'super_admin';
              const isEditing = editingUserId === u.id;
              return (
                <div key={u.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{u.name}</span>
                        <span className="text-slate-500">{u.email}</span>
                        <span
                          className={`px-2 py-0.5 text-[11px] font-medium border rounded ${
                            u.status === 'ACTIVE'
                              ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                              : u.status === 'INVITED'
                              ? 'border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                              : 'border-red-300 dark:border-red-800 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {u.status}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                        {ownerLocked ? 'Permanent Owner · super_admin' : `Role: ${u.role}`} · Limits: {u.daily_send_limit}/day,{' '}
                        {u.hourly_send_limit}/hr, {u.max_concurrent_sends} concurrent · Accounts: {u.email_accounts_count ?? 0} · Leads:{' '}
                        {u.assigned_leads_count ?? 0} · Sent: {u.emails_sent_count ?? 0}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {ownerLocked ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-blue-700 dark:text-blue-400">
                          <Shield className="w-3.5 h-3.5" />
                          <span>Owner Protected</span>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingUserId(isEditing ? null : u.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <Sliders className="w-3 h-3" />
                            <span>{isEditing ? 'Close' : 'Permissions & Limits'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={u.id === user.id}
                            onClick={() =>
                              handleUpdateUser(u, { status: u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' })
                            }
                            className={`px-2.5 py-1 border rounded ${
                              u.status === 'SUSPENDED'
                                ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                                : 'border-amber-300 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {u.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                          </button>
                          {(superAdminAccess || u.role !== 'admin') && u.id !== user.id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 text-slate-400 hover:text-red-600"
                              title="Remove user"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {isEditing && !ownerLocked && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Role</label>
                          <select
                            value={u.role}
                            onChange={(e) => handleUpdateUser(u, { role: e.target.value })}
                            className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                          >
                            <option value="operator">operator</option>
                            <option value="viewer">viewer</option>
                            {superAdminAccess && <option value="admin">admin</option>}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Daily Send Limit
                          </label>
                          <input
                            type="number"
                            min={1}
                            defaultValue={u.daily_send_limit}
                            onBlur={(e) => handleUpdateUser(u, { daily_send_limit: Number(e.target.value) })}
                            className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Hourly Send Limit
                          </label>
                          <input
                            type="number"
                            min={1}
                            defaultValue={u.hourly_send_limit}
                            onBlur={(e) => handleUpdateUser(u, { hourly_send_limit: Number(e.target.value) })}
                            className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Max Concurrent Sends
                          </label>
                          <input
                            type="number"
                            min={1}
                            disabled={!superAdminAccess}
                            defaultValue={u.max_concurrent_sends}
                            onBlur={(e) => handleUpdateUser(u, { max_concurrent_sends: Number(e.target.value) })}
                            className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded disabled:opacity-60"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
                        {PERMISSION_LABELS.map((p) => (
                          <label key={p.key} className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(u.permissions?.[p.key])}
                              onChange={(e) =>
                                handleUpdateUser(u, { permissions: { [p.key]: e.target.checked } })
                              }
                            />
                            <span>{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
