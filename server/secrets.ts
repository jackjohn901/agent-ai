import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from './db.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const KEY_FILE = path.join(DATA_DIR, '.master.key');

let cachedMasterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const envKey = process.env.CREDENTIALS_MASTER_KEY;
  if (envKey && envKey.trim().length >= 16) {
    cachedMasterKey = crypto.createHash('sha256').update(envKey.trim()).digest();
    return cachedMasterKey;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      cachedMasterKey = Buffer.from(hex, 'hex');
      return cachedMasterKey;
    }
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  cachedMasterKey = key;
  return cachedMasterKey;
}

export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const parts = String(payload || '').split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskSecretValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 6) {
    return '••••••';
  }
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}••••••${trimmed.slice(-4)}`;
}

export function encryptJson(obj: Record<string, any>): string {
  return encryptSecret(JSON.stringify(obj));
}

export function decryptJson<T = Record<string, any>>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  try {
    return JSON.parse(decryptSecret(payload)) as T;
  } catch {
    return null;
  }
}

const ENV_FALLBACK_MAP: Record<string, Record<string, string>> = {
  google_custom_search: {
    api_key: 'GOOGLE_SEARCH_API_KEY',
    cx: 'GOOGLE_SEARCH_CX',
  },
  reddit_api: {
    client_id: 'REDDIT_CLIENT_ID',
    client_secret: 'REDDIT_CLIENT_SECRET',
    user_agent: 'REDDIT_USER_AGENT',
  },
  github_public_search: {
    token: 'GITHUB_TOKEN',
  },
  linkedin_official_api: {
    access_token: 'LINKEDIN_ACCESS_TOKEN',
  },
  x_twitter_api: {
    bearer_token: 'X_BEARER_TOKEN',
  },
  meta_facebook_instagram: {
    access_token: 'META_GRAPH_TOKEN',
    page_ids: 'META_PAGE_IDS',
  },
  upwork_official_api: {
    access_token: 'UPWORK_API_KEY',
  },
  fiverr_partner_api: {
    api_key: 'FIVERR_PARTNER_API_KEY',
  },
  bing_search_api: {
    api_key: 'BING_SEARCH_API_KEY',
  },
  microsoft_365_email_oauth: {
    client_id: 'MICROSOFT_CLIENT_ID',
    client_secret: 'MICROSOFT_CLIENT_SECRET',
    tenant_id: 'MICROSOFT_TENANT_ID',
  },
};

export function saveEncryptedCredential(
  connectorId: string,
  fieldKey: string,
  plainValue: string,
  actorEmail: string
) {
  const cleaned = plainValue.trim();
  if (!cleaned) {
    db.prepare('DELETE FROM connector_credentials WHERE connector_id = ? AND field_key = ?').run(
      connectorId,
      fieldKey
    );
    return;
  }

  const encrypted = encryptSecret(cleaned);
  const masked = maskSecretValue(cleaned);

  db.prepare(
    `INSERT INTO connector_credentials (connector_id, field_key, encrypted_value, masked_preview, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(connector_id, field_key) DO UPDATE SET
       encrypted_value = excluded.encrypted_value,
       masked_preview = excluded.masked_preview,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  ).run(connectorId, fieldKey, encrypted, masked, actorEmail);
}

export function deleteConnectorCredentials(connectorId: string) {
  db.prepare('DELETE FROM connector_credentials WHERE connector_id = ?').run(connectorId);
}

export function getDecryptedCredential(connectorId: string, fieldKey: string): string | null {
  const row = db
    .prepare('SELECT encrypted_value FROM connector_credentials WHERE connector_id = ? AND field_key = ?')
    .get(connectorId, fieldKey) as { encrypted_value: string } | undefined;

  if (row?.encrypted_value) {
    try {
      const val = decryptSecret(row.encrypted_value).trim();
      if (val) return val;
    } catch {
      return null;
    }
  }

  const envName = ENV_FALLBACK_MAP[connectorId]?.[fieldKey];
  if (envName) {
    const envVal = process.env[envName];
    if (envVal && envVal.trim() && !envVal.startsWith('MY_')) {
      return envVal.trim();
    }
  }
  return null;
}

export function getMaskedCredentialsForConnector(
  connectorId: string,
  fieldKeys: string[]
): Record<string, { configured: boolean; masked: string; updated_at: string | null }> {
  const result: Record<string, { configured: boolean; masked: string; updated_at: string | null }> = {};
  const rows = db
    .prepare('SELECT field_key, masked_preview, updated_at FROM connector_credentials WHERE connector_id = ?')
    .all(connectorId) as Array<{ field_key: string; masked_preview: string; updated_at: string }>;

  const rowMap = new Map(rows.map((r) => [r.field_key, r]));

  for (const key of fieldKeys) {
    const dbEntry = rowMap.get(key);
    if (dbEntry) {
      result[key] = {
        configured: true,
        masked: dbEntry.masked_preview,
        updated_at: dbEntry.updated_at,
      };
      continue;
    }

    const envName = ENV_FALLBACK_MAP[connectorId]?.[key];
    const envVal = envName ? process.env[envName] : undefined;
    if (envVal && envVal.trim() && !envVal.startsWith('MY_')) {
      result[key] = {
        configured: true,
        masked: `${maskSecretValue(envVal)} (env)`,
        updated_at: null,
      };
    } else {
      result[key] = {
        configured: false,
        masked: '',
        updated_at: null,
      };
    }
  }

  return result;
}
