import nodemailer from 'nodemailer';
import { db, logSystemEvent } from './db.js';
import { decryptJson, encryptJson, getDecryptedCredential } from './secrets.js';
import type { EmailAccount, EmailAccountStatus, EmailProviderType } from '../shared/types.js';

export interface EmailAccountCredentials {
  // SMTP
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  // API key (Resend / SendGrid)
  api_key?: string;
  // OAuth (Microsoft 365 / custom server OAuth)
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
}

export function mapEmailAccountRow(row: any): EmailAccount {
  const nowDate = new Date().toISOString().slice(0, 10);
  const nowHour = new Date().toISOString().slice(0, 13).replace('T', ' ');
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    owner_email: row.owner_email || undefined,
    owner_name: row.owner_name || undefined,
    provider: row.provider as EmailProviderType,
    email_address: row.email_address,
    display_name: row.display_name || '',
    status: row.status as EmailAccountStatus,
    daily_limit: Number(row.daily_limit || 100),
    hourly_limit: Number(row.hourly_limit || 25),
    sent_today: row.sent_window_date === nowDate ? Number(row.sent_today || 0) : 0,
    sent_this_hour: row.sent_window_hour === nowHour ? Number(row.sent_this_hour || 0) : 0,
    last_tested_at: row.last_tested_at || null,
    last_error: row.last_error || null,
    token_expires_at: row.token_expires_at || null,
    is_active: Boolean(row.is_active),
    smtp_host: row.smtp_host || null,
    smtp_port: row.smtp_port ? Number(row.smtp_port) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getEmailAccountsForUser(userId: number, includeAll: boolean): EmailAccount[] {
  const sql = includeAll
    ? `SELECT ea.*, u.email as owner_email, u.name as owner_name
       FROM email_accounts ea
       JOIN users u ON u.id = ea.owner_user_id
       ORDER BY ea.owner_user_id = ? DESC, ea.id DESC`
    : `SELECT ea.*, u.email as owner_email, u.name as owner_name
       FROM email_accounts ea
       JOIN users u ON u.id = ea.owner_user_id
       WHERE ea.owner_user_id = ?
       ORDER BY ea.id DESC`;
  const rows = db.prepare(sql).all(userId) as any[];
  return rows.map(mapEmailAccountRow);
}

export function getEmailAccountById(accountId: number): any | null {
  return (
    db
      .prepare(
        `SELECT ea.*, u.email as owner_email, u.name as owner_name
         FROM email_accounts ea
         JOIN users u ON u.id = ea.owner_user_id
         WHERE ea.id = ?`
      )
      .get(accountId) || null
  );
}

export function updateAccountStatus(
  accountId: number,
  status: EmailAccountStatus,
  error: string | null
) {
  db.prepare(
    `UPDATE email_accounts
     SET status = ?, last_tested_at = datetime('now'), last_error = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, error, accountId);
}

export function refreshRollingQuotaCounters(accountId: number) {
  const nowDate = new Date().toISOString().slice(0, 10);
  const nowHour = new Date().toISOString().slice(0, 13).replace('T', ' ');
  const row = db.prepare('SELECT sent_window_date, sent_window_hour FROM email_accounts WHERE id = ?').get(accountId) as any;
  if (!row) return;
  if (row.sent_window_date !== nowDate) {
    db.prepare(
      'UPDATE email_accounts SET sent_today = 0, sent_window_date = ?, sent_this_hour = 0, sent_window_hour = ? WHERE id = ?'
    ).run(nowDate, nowHour, accountId);
  } else if (row.sent_window_hour !== nowHour) {
    db.prepare('UPDATE email_accounts SET sent_this_hour = 0, sent_window_hour = ? WHERE id = ?').run(nowHour, accountId);
  }
}

export function incrementAccountSendCounters(accountId: number) {
  refreshRollingQuotaCounters(accountId);
  db.prepare(
    `UPDATE email_accounts
     SET sent_today = sent_today + 1,
         sent_this_hour = sent_this_hour + 1,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(accountId);
}

function getMicrosoftOAuthConfig() {
  return {
    clientId: getDecryptedCredential('microsoft_365_email_oauth', 'client_id') || '',
    clientSecret: getDecryptedCredential('microsoft_365_email_oauth', 'client_secret') || '',
    tenantId: getDecryptedCredential('microsoft_365_email_oauth', 'tenant_id') || 'common',
  };
}

async function ensureValidMicrosoftAccessToken(accountRow: any): Promise<string> {
  const creds = decryptJson<EmailAccountCredentials>(accountRow.encrypted_credentials) || {};
  if (!creds.access_token && !creds.refresh_token) {
    throw new Error('Microsoft 365 credentials missing. Reconnect Outlook account.');
  }
  const expiresMs = creds.expires_at ? new Date(creds.expires_at).getTime() : 0;
  if (creds.access_token && (!expiresMs || expiresMs - Date.now() > 120 * 1000)) {
    return creds.access_token;
  }
  if (!creds.refresh_token) {
    throw new Error('Microsoft 365 access token expired and no refresh token is stored.');
  }

  const cfg = getMicrosoftOAuthConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('Microsoft OAuth client credentials are not configured in Integrations & API Settings.');
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
    scope: 'offline_access Mail.Send User.Read',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = (await res.json()) as any;
  if (!res.ok || !data.access_token) {
    updateAccountStatus(accountRow.id, 'EXPIRED', data.error_description || 'Microsoft token refresh failed');
    throw new Error(data.error_description || 'Microsoft OAuth refresh token expired.');
  }

  const nextExpires = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  const updatedCreds: EmailAccountCredentials = {
    ...creds,
    access_token: data.access_token,
    refresh_token: data.refresh_token || creds.refresh_token,
    expires_at: nextExpires,
  };
  db.prepare('UPDATE email_accounts SET encrypted_credentials = ?, token_expires_at = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    encryptJson(updatedCreds),
    nextExpires,
    accountRow.id
  );
  return data.access_token;
}

export async function testEmailAccountConnection(
  accountId: number,
  clientOAuthToken?: string
): Promise<{ ok: boolean; status: EmailAccountStatus; message: string; account: EmailAccount }> {
  const row = getEmailAccountById(accountId);
  if (!row) throw new Error('Email account not found.');

  const provider = row.provider as EmailProviderType;
  const creds = decryptJson<EmailAccountCredentials>(row.encrypted_credentials) || {};

  try {
    if (provider === 'sandbox_test') {
      updateAccountStatus(accountId, 'CONNECTED', null);
      const updated = mapEmailAccountRow(getEmailAccountById(accountId));
      return {
        ok: true,
        status: 'CONNECTED',
        message: 'Safe Sandbox Test Outbox verified and ready for simulated email delivery.',
        account: updated,
      };
    }

    if (provider === 'gmail_oauth') {
      const token = clientOAuthToken?.trim();
      if (!token) {
        updateAccountStatus(accountId, 'EXPIRED', 'Gmail session authorization required from browser.');
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return {
          ok: false,
          status: 'EXPIRED',
          message: 'Click "Authorize Gmail" to verify live Google Workspace mailbox access.',
          account: updated,
        };
      }
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        const status: EmailAccountStatus = res.status === 401 ? 'EXPIRED' : 'AUTH_ERROR';
        updateAccountStatus(accountId, status, `Gmail API HTTP ${res.status}: ${errText.slice(0, 180)}`);
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return {
          ok: false,
          status,
          message: `Gmail verification failed (HTTP ${res.status}). Please re-authorize Gmail.`,
          account: updated,
        };
      }
      const profile = (await res.json()) as { emailAddress?: string };
      if (profile.emailAddress && profile.emailAddress.toLowerCase() !== row.email_address.toLowerCase()) {
        db.prepare('UPDATE email_accounts SET email_address = ? WHERE id = ?').run(profile.emailAddress, accountId);
      }
      updateAccountStatus(accountId, 'CONNECTED', null);
      const updated = mapEmailAccountRow(getEmailAccountById(accountId));
      return {
        ok: true,
        status: 'CONNECTED',
        message: `Verified Gmail mailbox (${updated.email_address}) via Google Workspace API.`,
        account: updated,
      };
    }

    if (provider === 'microsoft_oauth') {
      const accessToken = await ensureValidMicrosoftAccessToken(row);
      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const status: EmailAccountStatus = res.status === 401 ? 'EXPIRED' : 'AUTH_ERROR';
        updateAccountStatus(accountId, status, `Microsoft Graph HTTP ${res.status}`);
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return { ok: false, status, message: `Microsoft Graph rejected token (HTTP ${res.status}).`, account: updated };
      }
      updateAccountStatus(accountId, 'CONNECTED', null);
      const updated = mapEmailAccountRow(getEmailAccountById(accountId));
      return {
        ok: true,
        status: 'CONNECTED',
        message: `Verified Microsoft 365 mailbox (${updated.email_address}).`,
        account: updated,
      };
    }

    if (provider === 'smtp') {
      if (!creds.host || !creds.username || !creds.password) {
        updateAccountStatus(accountId, 'AUTH_ERROR', 'Missing SMTP host, username, or password.');
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return { ok: false, status: 'AUTH_ERROR', message: 'SMTP credentials incomplete.', account: updated };
      }
      const port = Number(creds.port || 587);
      const transporter = nodemailer.createTransport({
        host: creds.host,
        port,
        secure: creds.secure ?? port === 465,
        auth: {
          user: creds.username,
          pass: creds.password,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });
      await transporter.verify();
      updateAccountStatus(accountId, 'CONNECTED', null);
      const updated = mapEmailAccountRow(getEmailAccountById(accountId));
      return {
        ok: true,
        status: 'CONNECTED',
        message: `SMTP TLS handshake & authentication verified on ${creds.host}:${port}.`,
        account: updated,
      };
    }

    if (provider === 'resend_api') {
      if (!creds.api_key) {
        updateAccountStatus(accountId, 'AUTH_ERROR', 'Missing Resend API key.');
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return { ok: false, status: 'AUTH_ERROR', message: 'Missing Resend API key.', account: updated };
      }
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${creds.api_key}` },
      });
      if (!res.ok) {
        updateAccountStatus(accountId, 'AUTH_ERROR', `Resend API HTTP ${res.status}`);
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return { ok: false, status: 'AUTH_ERROR', message: `Resend rejected API key (HTTP ${res.status}).`, account: updated };
      }
      updateAccountStatus(accountId, 'CONNECTED', null);
      const updated = mapEmailAccountRow(getEmailAccountById(accountId));
      return {
        ok: true,
        status: 'CONNECTED',
        message: 'Resend API key verified live.',
        account: updated,
      };
    }

    if (provider === 'sendgrid_api') {
      if (!creds.api_key) {
        updateAccountStatus(accountId, 'AUTH_ERROR', 'Missing SendGrid API key.');
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return { ok: false, status: 'AUTH_ERROR', message: 'Missing SendGrid API key.', account: updated };
      }
      const res = await fetch('https://api.sendgrid.com/v3/user/profile', {
        headers: { Authorization: `Bearer ${creds.api_key}` },
      });
      if (!res.ok) {
        updateAccountStatus(accountId, 'AUTH_ERROR', `SendGrid API HTTP ${res.status}`);
        const updated = mapEmailAccountRow(getEmailAccountById(accountId));
        return { ok: false, status: 'AUTH_ERROR', message: `SendGrid rejected API key (HTTP ${res.status}).`, account: updated };
      }
      updateAccountStatus(accountId, 'CONNECTED', null);
      const updated = mapEmailAccountRow(getEmailAccountById(accountId));
      return {
        ok: true,
        status: 'CONNECTED',
        message: 'SendGrid API key verified live.',
        account: updated,
      };
    }

    throw new Error(`Unsupported email provider: ${provider}`);
  } catch (err: any) {
    const msg = err?.message || 'Connection test failed';
    const isAuthErr = /auth|535|401|403|invalid login|credentials|expired/i.test(msg);
    const nextStatus: EmailAccountStatus = /expired/i.test(msg)
      ? 'EXPIRED'
      : isAuthErr
      ? 'AUTH_ERROR'
      : 'AUTH_ERROR';
    updateAccountStatus(accountId, nextStatus, msg);
    const updated = mapEmailAccountRow(getEmailAccountById(accountId));
    return {
      ok: false,
      status: nextStatus,
      message: msg,
      account: updated,
    };
  }
}

function buildRawMimeEmail(opts: {
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
}): string {
  const fromHeader = opts.fromName ? `"${opts.fromName.replace(/"/g, '')}" <${opts.fromEmail}>` : opts.fromEmail;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${opts.toEmail}`,
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(opts.body, 'utf8').toString('base64'),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

export async function dispatchEmailViaAccount(
  accountRow: any,
  emailMessageRow: any,
  clientOAuthToken?: string
): Promise<{
  delivered: boolean;
  bounced?: boolean;
  providerMessageId: string;
  sandbox?: boolean;
}> {
  const provider = accountRow.provider as EmailProviderType;
  const creds = decryptJson<EmailAccountCredentials>(accountRow.encrypted_credentials) || {};
  const toEmail = String(emailMessageRow.recipient_email || '').trim();
  const subject = String(emailMessageRow.subject_local || '').trim();
  const body = String(emailMessageRow.body_local || '').trim();

  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    throw new Error(`Invalid recipient email address: "${toEmail}"`);
  }

  if (provider === 'sandbox_test') {
    const isBounceTest = /^bounce[@.]/i.test(toEmail) || toEmail.endsWith('.invalid') || toEmail.includes('+bounce');
    const sandboxStatus = isBounceTest ? 'BOUNCED_SIMULATED' : 'DELIVERED_SANDBOX';
    const info = db
      .prepare(
        `INSERT INTO sandbox_outbox (email_message_id, from_email, to_email, subject, body, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(emailMessageRow.id, accountRow.email_address, toEmail, subject, body, sandboxStatus);
    incrementAccountSendCounters(accountRow.id);
    logSystemEvent(
      isBounceTest ? 'WARN' : 'INFO',
      accountRow.owner_email || accountRow.email_address,
      isBounceTest ? 'SANDBOX_BOUNCE' : 'SANDBOX_DELIVERED',
      `Sandbox email #${emailMessageRow.id} -> ${toEmail} (${sandboxStatus})`
    );
    return {
      delivered: !isBounceTest,
      bounced: isBounceTest,
      providerMessageId: `sandbox-${info.lastInsertRowid}`,
      sandbox: true,
    };
  }

  if (provider === 'gmail_oauth') {
    const token = clientOAuthToken?.trim();
    if (!token) {
      updateAccountStatus(accountRow.id, 'EXPIRED', 'Gmail OAuth authorization missing or expired.');
      throw new Error('Gmail authorization required. Click Re-authorize Gmail on this account and retry.');
    }
    const raw = buildRawMimeEmail({
      fromName: accountRow.display_name || '',
      fromEmail: accountRow.email_address,
      toEmail,
      subject,
      body,
    });
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 401) {
        updateAccountStatus(accountRow.id, 'EXPIRED', 'Gmail access token expired.');
      } else if (res.status === 403) {
        updateAccountStatus(accountRow.id, 'AUTH_ERROR', `Gmail API 403: ${errBody.slice(0, 150)}`);
      }
      throw new Error(`Gmail API send failed (HTTP ${res.status}): ${errBody.slice(0, 180)}`);
    }
    const data = (await res.json()) as { id?: string };
    incrementAccountSendCounters(accountRow.id);
    updateAccountStatus(accountRow.id, 'CONNECTED', null);
    return {
      delivered: true,
      providerMessageId: data.id || `gmail-${Date.now()}`,
    };
  }

  if (provider === 'microsoft_oauth') {
    const token = await ensureValidMicrosoftAccessToken(accountRow);
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: body },
          toRecipients: [{ emailAddress: { address: toEmail } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401) {
        updateAccountStatus(accountRow.id, 'EXPIRED', 'Microsoft OAuth session expired.');
      }
      throw new Error(`Microsoft Graph send failed (HTTP ${res.status}): ${errText.slice(0, 180)}`);
    }
    incrementAccountSendCounters(accountRow.id);
    updateAccountStatus(accountRow.id, 'CONNECTED', null);
    return {
      delivered: true,
      providerMessageId: `m365-${Date.now()}`,
    };
  }

  if (provider === 'smtp') {
    if (!creds.host || !creds.username || !creds.password) {
      updateAccountStatus(accountRow.id, 'AUTH_ERROR', 'Missing SMTP credentials.');
      throw new Error('SMTP credentials missing.');
    }
    const port = Number(creds.port || 587);
    const transporter = nodemailer.createTransport({
      host: creds.host,
      port,
      secure: creds.secure ?? port === 465,
      auth: {
        user: creds.username,
        pass: creds.password,
      },
    });
    try {
      const info = await transporter.sendMail({
        from: accountRow.display_name
          ? `"${accountRow.display_name}" <${accountRow.email_address}>`
          : accountRow.email_address,
        to: toEmail,
        subject,
        text: body,
      });
      incrementAccountSendCounters(accountRow.id);
      updateAccountStatus(accountRow.id, 'CONNECTED', null);
      return {
        delivered: true,
        providerMessageId: info.messageId || `smtp-${Date.now()}`,
      };
    } catch (err: any) {
      const msg = err?.message || 'SMTP send error';
      if (/535|auth|eauth/i.test(msg)) {
        updateAccountStatus(accountRow.id, 'AUTH_ERROR', msg);
      }
      if (/550|551|553|554|mailbox unavailable|user unknown/i.test(msg)) {
        return {
          delivered: false,
          bounced: true,
          providerMessageId: `smtp-bounce-${Date.now()}`,
        };
      }
      throw err;
    }
  }

  if (provider === 'resend_api') {
    if (!creds.api_key) throw new Error('Resend API key missing.');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: accountRow.display_name
          ? `${accountRow.display_name} <${accountRow.email_address}>`
          : accountRow.email_address,
        to: [toEmail],
        subject,
        text: body,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        updateAccountStatus(accountRow.id, 'AUTH_ERROR', data?.message || 'Resend auth error');
      }
      throw new Error(data?.message || `Resend send failed (HTTP ${res.status})`);
    }
    incrementAccountSendCounters(accountRow.id);
    updateAccountStatus(accountRow.id, 'CONNECTED', null);
    return {
      delivered: true,
      providerMessageId: data?.id || `resend-${Date.now()}`,
    };
  }

  if (provider === 'sendgrid_api') {
    if (!creds.api_key) throw new Error('SendGrid API key missing.');
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: accountRow.email_address, name: accountRow.display_name || undefined },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 401 || res.status === 403) {
        updateAccountStatus(accountRow.id, 'AUTH_ERROR', txt.slice(0, 150));
      }
      throw new Error(`SendGrid send failed (HTTP ${res.status}): ${txt.slice(0, 150)}`);
    }
    incrementAccountSendCounters(accountRow.id);
    updateAccountStatus(accountRow.id, 'CONNECTED', null);
    return {
      delivered: true,
      providerMessageId: res.headers.get('x-message-id') || `sg-${Date.now()}`,
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
