import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { db } from './db.js';
import { getDecryptedCredential } from './secrets.js';
import type { GeminiSettingsConfig } from '../shared/types.js';

export const ALLOWED_GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-3.1-flash-lite',
] as const;

export type AllowedGeminiModel = (typeof ALLOWED_GEMINI_MODELS)[number];

export function getGeminiConfig(): GeminiSettingsConfig {
  const row = db
    .prepare('SELECT config_json FROM universal_integrations WHERE id = ?')
    .get('gemini_api') as { config_json?: string } | undefined;
  let parsed: any = {};
  try {
    parsed = row?.config_json ? JSON.parse(row.config_json) : {};
  } catch {
    parsed = {};
  }

  const activeModel = ALLOWED_GEMINI_MODELS.includes(parsed.active_model)
    ? (parsed.active_model as AllowedGeminiModel)
    : 'gemini-4-hydrogen';

  const thinkingLevel = ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.thinking_level)
    ? (parsed.thinking_level as 'LOW' | 'MEDIUM' | 'HIGH')
    : 'MEDIUM';

  const envKey = process.env.GEMINI_API_KEY;
  const envKeyPresent = Boolean(envKey && envKey.trim() && envKey !== 'MY_GEMINI_API_KEY');

  return {
    active_model: activeModel,
    thinking_level: thinkingLevel,
    use_env_fallback: parsed.use_env_fallback !== false,
    env_key_present: envKeyPresent,
    tools: {
      buyer_discovery_queries: parsed.tools?.buyer_discovery_queries !== false,
      buyer_intent_classification: parsed.tools?.buyer_intent_classification !== false,
      company_research_enrichment: parsed.tools?.company_research_enrichment !== false,
      email_personalization: parsed.tools?.email_personalization !== false,
      translation: parsed.tools?.translation !== false,
      follow_up_recommendations: parsed.tools?.follow_up_recommendations !== false,
    },
  };
}

export function resolveGeminiApiKey(): { apiKey: string | null; source: 'saved_override' | 'env_secret' | 'none' } {
  const saved = getDecryptedCredential('gemini_api', 'api_key');
  if (saved && saved.trim() && saved !== 'MY_GEMINI_API_KEY') {
    return { apiKey: saved.trim(), source: 'saved_override' };
  }
  const cfg = getGeminiConfig();
  if (cfg.use_env_fallback) {
    const envVal = process.env.GEMINI_API_KEY;
    if (envVal && envVal.trim() && envVal !== 'MY_GEMINI_API_KEY') {
      return { apiKey: envVal.trim(), source: 'env_secret' };
    }
  }
  return { apiKey: null, source: 'none' };
}

export function isGeminiToolEnabled(toolKey: keyof GeminiSettingsConfig['tools']): boolean {
  const row = db
    .prepare('SELECT is_enabled, tools_json FROM universal_integrations WHERE id = ?')
    .get('gemini_api') as { is_enabled: number; tools_json: string } | undefined;

  if (row && !row.is_enabled) return false;
  if (row?.tools_json) {
    try {
      const tools = JSON.parse(row.tools_json) as Array<{ name: string; enabled: boolean }>;
      const match = tools.find((t) => t.name === toolKey);
      if (match) return Boolean(match.enabled);
    } catch {
      // ignore
    }
  }
  const cfg = getGeminiConfig();
  return cfg.tools[toolKey] !== false;
}

export function getThinkingLevelEnum(override?: 'LOW' | 'MEDIUM' | 'HIGH'): ThinkingLevel {
  const lvl = override || getGeminiConfig().thinking_level;
  if (lvl === 'HIGH') return ThinkingLevel.HIGH;
  if (lvl === 'LOW') return ThinkingLevel.LOW;
  return ThinkingLevel.MEDIUM;
}

export function getConfiguredGeminiClient(toolKey?: keyof GeminiSettingsConfig['tools']): {
  ai: GoogleGenAI;
  model: AllowedGeminiModel;
  thinkingLevel: ThinkingLevel;
  keySource: 'saved_override' | 'env_secret';
} {
  const row = db
    .prepare('SELECT is_enabled FROM universal_integrations WHERE id = ?')
    .get('gemini_api') as { is_enabled: number } | undefined;
  if (row && !row.is_enabled) {
    throw new Error('Google Gemini API integration is currently disabled by Super Admin.');
  }
  if (toolKey && !isGeminiToolEnabled(toolKey)) {
    throw new Error(`Gemini capability "${toolKey}" is disabled in Google Gemini API settings.`);
  }

  const { apiKey, source } = resolveGeminiApiKey();
  if (!apiKey || source === 'none') {
    throw new Error('Gemini API key is not configured (neither saved override nor GEMINI_API_KEY env secret).');
  }

  const cfg = getGeminiConfig();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return {
    ai,
    model: cfg.active_model,
    thinkingLevel: getThinkingLevelEnum(cfg.thinking_level),
    keySource: source,
  };
}

export function getOptionalGeminiClient(toolKey?: keyof GeminiSettingsConfig['tools']) {
  try {
    return getConfiguredGeminiClient(toolKey);
  } catch {
    return null;
  }
}

export function logGeminiUsage(params: {
  action: string;
  toolName?: string;
  status: 'SUCCESS' | 'ERROR';
  tokensUsed?: number;
  latencyMs?: number;
  details: string;
  errorMessage?: string | null;
}) {
  try {
    db.prepare(
      `INSERT INTO integration_usage_logs (integration_id, action, tool_name, status, credits_consumed, tokens_used, latency_ms, details, error_message)
       VALUES ('gemini_api', ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(
      params.action,
      params.toolName || null,
      params.status,
      Math.max(0, Math.round(params.tokensUsed || 0)),
      Math.max(0, Math.round(params.latencyMs || 0)),
      params.details,
      params.errorMessage || null
    );

    if (params.status === 'SUCCESS') {
      db.prepare(
        "UPDATE universal_integrations SET api_calls_count = api_calls_count + 1, status = 'CONNECTED', last_error = NULL, updated_at = datetime('now') WHERE id = 'gemini_api' AND is_enabled = 1"
      ).run();
    } else {
      db.prepare(
        "UPDATE universal_integrations SET api_calls_count = api_calls_count + 1, last_error = ?, updated_at = datetime('now') WHERE id = 'gemini_api'"
      ).run(params.errorMessage || 'Gemini request failed');
    }
  } catch {
    // ignore logging failure
  }
}
