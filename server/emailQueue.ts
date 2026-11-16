import { db, getAppSettings, logSystemEvent, SUPER_ADMIN_EMAIL } from './db.js';
import {
  dispatchEmailViaAccount,
  getEmailAccountById,
  refreshRollingQuotaCounters,
} from './emailService.js';

const activeSendsByUser = new Map<number, number>();
let queueWorkerInterval: NodeJS.Timeout | null = null;
let workerBusy = false;

export function getActiveConcurrencySnapshot(): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [uid, count] of activeSendsByUser.entries()) {
    if (count > 0) out[uid] = count;
  }
  return out;
}

export function getUserSendLimits(userId: number): {
  isOwner: boolean;
  dailyLimit: number;
  hourlyLimit: number;
  maxConcurrent: number;
  sentToday: number;
  sentThisHour: number;
  activeConcurrent: number;
} {
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  const settings = getAppSettings();
  const isOwner =
    Boolean(userRow?.is_owner) ||
    String(userRow?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

  const dailyLimit = isOwner
    ? settings.owner_daily_send_limit
    : Number(userRow?.daily_send_limit ?? 50);
  const hourlyLimit = isOwner
    ? settings.owner_hourly_send_limit
    : Number(userRow?.hourly_send_limit ?? 15);
  const maxConcurrent = isOwner
    ? Math.max(1, settings.owner_max_concurrent_sends)
    : Math.max(1, Number(userRow?.max_concurrent_sends ?? settings.invited_default_concurrent_sends ?? 5));

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN date(sent_at) = date('now') THEN 1 ELSE 0 END) as sent_today,
         SUM(CASE WHEN strftime('%Y-%m-%d %H', sent_at) = strftime('%Y-%m-%d %H', 'now') THEN 1 ELSE 0 END) as sent_hour
       FROM email_messages
       WHERE owner_user_id = ?
         AND approval_status IN ('SENT', 'DELIVERED', 'BOUNCED')`
    )
    .get(userId) as { sent_today?: number; sent_hour?: number } | undefined;

  return {
    isOwner,
    dailyLimit,
    hourlyLimit,
    maxConcurrent,
    sentToday: Number(counts?.sent_today || 0),
    sentThisHour: Number(counts?.sent_hour || 0),
    activeConcurrent: activeSendsByUser.get(userId) || 0,
  };
}

export function isRecipientSuppressed(recipientEmail: string, sourceUrl?: string, username?: string): boolean {
  const checks = [recipientEmail, sourceUrl || '__none__', username || '__none__']
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (checks.length === 0) return false;
  const row = db
    .prepare(
      `SELECT id FROM suppression_list WHERE lower(identifier) IN (${checks.map(() => 'lower(?)').join(',')}) LIMIT 1`
    )
    .get(...checks);
  return Boolean(row);
}

export function checkCapacityForDispatch(userId: number, accountId: number): {
  allowed: boolean;
  reason?: string;
} {
  const userLimits = getUserSendLimits(userId);
  if (userLimits.activeConcurrent >= userLimits.maxConcurrent) {
    return {
      allowed: false,
      reason: `Concurrent limit reached (${userLimits.activeConcurrent}/${userLimits.maxConcurrent} active sends). Queued until a slot frees.`,
    };
  }
  if (userLimits.sentThisHour >= userLimits.hourlyLimit) {
    return {
      allowed: false,
      reason: `Hourly user send limit reached (${userLimits.sentThisHour}/${userLimits.hourlyLimit}). Queued for next hourly window.`,
    };
  }
  if (userLimits.sentToday >= userLimits.dailyLimit) {
    return {
      allowed: false,
      reason: `Daily user send limit reached (${userLimits.sentToday}/${userLimits.dailyLimit}). Queued for next daily window.`,
    };
  }

  refreshRollingQuotaCounters(accountId);
  const acc = getEmailAccountById(accountId);
  if (!acc || !acc.is_active) {
    return { allowed: false, reason: 'Selected email account is inactive or missing.' };
  }
  if (acc.status !== 'CONNECTED') {
    return {
      allowed: false,
      reason: `Email account ${acc.email_address} status is ${acc.status}. Test or reconnect account first.`,
    };
  }
  if (Number(acc.sent_this_hour || 0) >= Number(acc.hourly_limit || 25)) {
    return {
      allowed: false,
      reason: `Provider account hourly quota reached (${acc.sent_this_hour}/${acc.hourly_limit}) for ${acc.email_address}.`,
    };
  }
  if (Number(acc.sent_today || 0) >= Number(acc.daily_limit || 100)) {
    return {
      allowed: false,
      reason: `Provider account daily quota reached (${acc.sent_today}/${acc.daily_limit}) for ${acc.email_address}.`,
    };
  }

  return { allowed: true };
}

export async function processQueueItem(
  queueId: number,
  transientGmailToken?: string
): Promise<{
  status: 'SENT' | 'DELIVERED' | 'BOUNCED' | 'QUEUED' | 'RETRYING' | 'FAILED';
  message: string;
}> {
  const qRow = db.prepare('SELECT * FROM email_queue WHERE id = ?').get(queueId) as any;
  if (!qRow) return { status: 'FAILED', message: 'Queue item not found' };
  if (qRow.status === 'SENT' || qRow.status === 'CANCELLED') {
    return { status: 'SENT', message: 'Already completed' };
  }

  const msg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(qRow.email_message_id) as any;
  if (!msg) {
    db.prepare("UPDATE email_queue SET status = 'FAILED', last_error = 'Message deleted' WHERE id = ?").run(queueId);
    return { status: 'FAILED', message: 'Email message not found' };
  }

  // CRITICAL SECURITY GATE: Unapproved messages can NEVER be sent
  if (
    !msg.approved_by_user_id ||
    !msg.approved_at ||
    !['APPROVED', 'QUEUED'].includes(msg.approval_status)
  ) {
    db.prepare(
      "UPDATE email_queue SET status = 'CANCELLED', last_error = 'Blocked: human approval missing' WHERE id = ?"
    ).run(queueId);
    return {
      status: 'FAILED',
      message: 'Blocked: Individual human approval is required before any email can be sent.',
    };
  }

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(msg.lead_id) as any;

  // Opt-out / Suppression list guard
  if (isRecipientSuppressed(msg.recipient_email, msg.source_url, lead?.username)) {
    db.prepare(
      "UPDATE email_queue SET status = 'CANCELLED', last_error = 'Recipient opted out / suppressed' WHERE id = ?"
    ).run(queueId);
    db.prepare(
      "UPDATE email_messages SET approval_status = 'FAILED', error_message = 'Blocked by suppression list (opted out)', updated_at = datetime('now') WHERE id = ?"
    ).run(msg.id);
    return { status: 'FAILED', message: 'Blocked: Prospect has opted out / is on suppression list.' };
  }

  // Follow-up stop-on-reply guard
  if (
    msg.is_follow_up &&
    lead &&
    ['Reply Received', 'Interested Prospect', 'Call Requested', 'Meeting Booked', 'Proposal Submitted', 'Negotiation', 'Won', 'Lost'].includes(
      lead.deal_status
    )
  ) {
    db.prepare(
      "UPDATE email_queue SET status = 'CANCELLED', last_error = 'Stopped follow-up because prospect already replied or closed' WHERE id = ?"
    ).run(queueId);
    db.prepare(
      "UPDATE email_messages SET approval_status = 'REJECTED', error_message = 'Follow-up stopped: reply or closed status recorded', updated_at = datetime('now') WHERE id = ?"
    ).run(msg.id);
    return { status: 'FAILED', message: 'Follow-up cancelled automatically because prospect has replied or closed.' };
  }

  // Duplicate send prevention
  if (!msg.is_follow_up) {
    const priorSent = db
      .prepare(
        `SELECT id FROM email_messages
         WHERE lead_id = ?
           AND id != ?
           AND is_follow_up = 0
           AND lower(recipient_email) = lower(?)
           AND approval_status IN ('SENT', 'DELIVERED')
         LIMIT 1`
      )
      .get(msg.lead_id, msg.id, msg.recipient_email);
    if (priorSent) {
      db.prepare(
        "UPDATE email_queue SET status = 'CANCELLED', last_error = 'Duplicate send prevented' WHERE id = ?"
      ).run(queueId);
      db.prepare(
        "UPDATE email_messages SET approval_status = 'FAILED', error_message = 'Duplicate send prevented for this lead & recipient', updated_at = datetime('now') WHERE id = ?"
      ).run(msg.id);
      return { status: 'FAILED', message: 'Duplicate outreach send prevented for this prospect.' };
    }
  }

  const cap = checkCapacityForDispatch(qRow.user_id, qRow.email_account_id);
  if (!cap.allowed) {
    db.prepare("UPDATE email_queue SET status = 'QUEUED', last_error = ? WHERE id = ?").run(cap.reason || 'Waiting for capacity', queueId);
    db.prepare("UPDATE email_messages SET approval_status = 'QUEUED', updated_at = datetime('now') WHERE id = ?").run(msg.id);
    return { status: 'QUEUED', message: cap.reason || 'Queued for capacity' };
  }

  // Reserve concurrency slot atomically
  const currentActive = activeSendsByUser.get(qRow.user_id) || 0;
  activeSendsByUser.set(qRow.user_id, currentActive + 1);
  db.prepare("UPDATE email_queue SET status = 'PROCESSING', locked_at = datetime('now') WHERE id = ?").run(queueId);
  db.prepare("UPDATE email_messages SET approval_status = 'SENDING', updated_at = datetime('now') WHERE id = ?").run(msg.id);

  try {
    const accountRow = getEmailAccountById(qRow.email_account_id);
    const dispatchRes = await dispatchEmailViaAccount(accountRow, msg, transientGmailToken);

    if (dispatchRes.bounced) {
      db.prepare(
        "UPDATE email_queue SET status = 'FAILED', attempts = attempts + 1, last_error = 'Hard bounce detected', completed_at = datetime('now') WHERE id = ?"
      ).run(queueId);
      db.prepare(
        `UPDATE email_messages
         SET approval_status = 'BOUNCED',
             provider_message_id = ?,
             error_message = 'Recipient address bounced; added to suppression list',
             sent_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(dispatchRes.providerMessageId, msg.id);
      db.prepare('INSERT OR IGNORE INTO suppression_list (identifier, reason) VALUES (?, ?)').run(
        msg.recipient_email,
        'Automatic bounce protection'
      );
      return { status: 'BOUNCED', message: `Email bounced for ${msg.recipient_email} and was added to suppression list.` };
    }

    const finalMsgStatus = dispatchRes.sandbox ? 'DELIVERED' : 'SENT';
    db.prepare(
      "UPDATE email_queue SET status = 'SENT', attempts = attempts + 1, last_error = NULL, completed_at = datetime('now') WHERE id = ?"
    ).run(queueId);
    db.prepare(
      `UPDATE email_messages
       SET approval_status = ?,
           provider_message_id = ?,
           error_message = NULL,
           sent_at = datetime('now'),
           delivered_at = CASE WHEN ? = 'DELIVERED' THEN datetime('now') ELSE delivered_at END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(finalMsgStatus, dispatchRes.providerMessageId, finalMsgStatus, msg.id);

    // Sync contact history & CRM lead status
    db.prepare(
      'INSERT INTO contact_history (lead_id, channel, direction, subject, message, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      msg.lead_id,
      `Email (${accountRow.email_address})`,
      'OUTBOUND',
      msg.subject_local,
      msg.body_local,
      finalMsgStatus
    );
    db.prepare(
      `UPDATE leads
       SET outreach_approval_status = 'SENT',
           deal_status = CASE WHEN deal_status IN ('Message Prepared', 'Message Approved') THEN 'Message Sent' ELSE deal_status END,
           follow_up_date = COALESCE(follow_up_date, date('now', '+3 days')),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(msg.lead_id);

    logSystemEvent(
      'AUDIT',
      msg.approved_by_email || accountRow.email_address,
      'EMAIL_DISPATCHED',
      `Sent approved email #${msg.id} to ${msg.recipient_email} via ${accountRow.email_address} (${accountRow.provider})`
    );

    return {
      status: finalMsgStatus,
      message: dispatchRes.sandbox
        ? `Delivered to Safe Sandbox Outbox (${msg.recipient_email})`
        : `Dispatched to ${msg.recipient_email} via ${accountRow.email_address}`,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Send error';
    const nextAttempts = Number(qRow.attempts || 0) + 1;
    const isPermanent =
      nextAttempts >= Number(qRow.max_attempts || 3) ||
      /auth|expired|invalid recipient|missing/i.test(errMsg);

    if (isPermanent) {
      db.prepare(
        "UPDATE email_queue SET status = 'FAILED', attempts = ?, last_error = ?, completed_at = datetime('now') WHERE id = ?"
      ).run(nextAttempts, errMsg, queueId);
      db.prepare(
        "UPDATE email_messages SET approval_status = 'FAILED', error_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(errMsg, msg.id);
      logSystemEvent('ERROR', msg.approved_by_email || 'email-queue', 'EMAIL_SEND_FAILED', `Email #${msg.id}: ${errMsg}`);
      return { status: 'FAILED', message: errMsg };
    }

    const backoffMinutes = Math.pow(2, nextAttempts);
    db.prepare(
      `UPDATE email_queue
       SET status = 'RETRYING',
           attempts = ?,
           last_error = ?,
           next_attempt_at = datetime('now', '+' || ? || ' minutes')
       WHERE id = ?`
    ).run(nextAttempts, errMsg, backoffMinutes, queueId);
    db.prepare("UPDATE email_messages SET approval_status = 'QUEUED', error_message = ?, updated_at = datetime('now') WHERE id = ?").run(
      errMsg,
      msg.id
    );
    return { status: 'RETRYING', message: `Transient error (${errMsg}); retry scheduled in ${backoffMinutes}m.` };
  } finally {
    const after = Math.max(0, (activeSendsByUser.get(qRow.user_id) || 1) - 1);
    if (after === 0) activeSendsByUser.delete(qRow.user_id);
    else activeSendsByUser.set(qRow.user_id, after);
  }
}

export async function approveAndDispatchIndividualEmail(params: {
  emailMessageId: number;
  approverUserId: number;
  approverEmail: string;
  emailAccountId: number;
  recipientEmail?: string;
  subjectLocal?: string;
  bodyLocal?: string;
  transientGmailToken?: string;
}): Promise<{
  status: string;
  message: string;
  emailMessage: any;
  queued: boolean;
}> {
  const msg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(params.emailMessageId) as any;
  if (!msg) throw new Error('Email draft not found.');
  if (['SENT', 'DELIVERED'].includes(msg.approval_status)) {
    throw new Error('Duplicate send blocked: this email has already been sent.');
  }

  const nextRecipient = (params.recipientEmail !== undefined ? params.recipientEmail : msg.recipient_email).trim();
  if (!nextRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextRecipient)) {
    throw new Error('A valid recipient email address is required before approving & sending.');
  }

  const acc = getEmailAccountById(params.emailAccountId);
  if (!acc || !acc.is_active) {
    throw new Error('Select a valid sending email account.');
  }
  if (acc.status !== 'CONNECTED') {
    throw new Error(`Sending account ${acc.email_address} is ${acc.status}. Please test/connect it on Email Accounts first.`);
  }

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(msg.lead_id) as any;
  if (isRecipientSuppressed(nextRecipient, msg.source_url, lead?.username)) {
    throw new Error('Blocked: Recipient is on the opt-out / suppression list.');
  }

  // Strictly approve ONLY this single email ID
  const nextSubj = params.subjectLocal !== undefined ? params.subjectLocal : msg.subject_local;
  const nextBody = params.bodyLocal !== undefined ? params.bodyLocal : msg.body_local;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE email_messages
       SET email_account_id = ?,
           recipient_email = ?,
           subject_local = ?,
           body_local = ?,
           approval_status = 'APPROVED',
           approved_by_user_id = ?,
           approved_by_email = ?,
           approved_at = datetime('now'),
           rejected_by_email = NULL,
           rejected_at = NULL,
           error_message = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      params.emailAccountId,
      nextRecipient,
      nextSubj,
      nextBody,
      params.approverUserId,
      params.approverEmail,
      params.emailMessageId
    );

    db.prepare(
      `INSERT INTO email_queue (email_message_id, user_id, email_account_id, status, next_attempt_at)
       VALUES (?, ?, ?, 'QUEUED', datetime('now'))
       ON CONFLICT(email_message_id) DO UPDATE SET
         email_account_id = excluded.email_account_id,
         status = 'QUEUED',
         next_attempt_at = datetime('now'),
         last_error = NULL`
    ).run(params.emailMessageId, msg.owner_user_id, params.emailAccountId);
  });
  tx();

  logSystemEvent(
    'AUDIT',
    params.approverEmail,
    'EMAIL_INDIVIDUALLY_APPROVED',
    `Approved single email #${params.emailMessageId} for ${nextRecipient} via ${acc.email_address}`
  );

  const qItem = db
    .prepare('SELECT id FROM email_queue WHERE email_message_id = ?')
    .get(params.emailMessageId) as { id: number };
  const result = await processQueueItem(qItem.id, params.transientGmailToken);
  const updatedMsg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(params.emailMessageId);

  return {
    status: result.status,
    message: result.message,
    emailMessage: updatedMsg,
    queued: result.status === 'QUEUED' || result.status === 'RETRYING',
  };
}

export async function runEmailQueueCycle() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const pending = db
      .prepare(
        `SELECT q.id
         FROM email_queue q
         JOIN email_accounts ea ON ea.id = q.email_account_id
         WHERE q.status IN ('QUEUED', 'RETRYING')
           AND datetime(q.next_attempt_at) <= datetime('now')
           AND ea.provider != 'gmail_oauth'
         ORDER BY q.id ASC
         LIMIT 25`
      )
      .all() as Array<{ id: number }>;

    await Promise.all(pending.map((item) => processQueueItem(item.id)));
  } finally {
    workerBusy = false;
  }
}

export function startEmailQueueWorker() {
  if (queueWorkerInterval) return;
  queueWorkerInterval = setInterval(() => {
    runEmailQueueCycle().catch((err) => {
      console.error('Email queue worker error:', err);
    });
  }, 5000);
}

export function stopEmailQueueWorker() {
  if (queueWorkerInterval) {
    clearInterval(queueWorkerInterval);
    queueWorkerInterval = null;
  }
}
