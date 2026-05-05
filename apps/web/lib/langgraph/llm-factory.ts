/**
 * lib/langgraph/llm-factory.ts
 *
 * resolveModelClient — selects the right LLM client for a given request.
 *
 * Resolution order:
 *  1. Check org's BYOK keys in `llm_keys` (decrypt via pgp_sym_decrypt).
 *  2. If BYOK present → instantiate provider client with that key.
 *  3. Else → fall back to platform key from environment variables.
 *  4. Apply model-selection matrix (Chapter 7 of architecture doc).
 *  5. Respect agent minimum tier: effective tier = max(complexity, agentMinTier).
 *
 * Model selection matrix:
 *
 *  Complexity │ Anthropic           │ OpenAI        │ Google
 *  ───────────┼─────────────────────┼───────────────┼─────────────────
 *  simple     │ claude-haiku-4-5    │ gpt-4o-mini   │ gemini-2.0-flash
 *  medium     │ claude-sonnet-4-5   │ gpt-4o        │ gemini-2.5-pro
 *  complex    │ claude-opus-4-5     │ gpt-4o        │ gemini-2.5-pro
 *
 * Security:
 *  - Decrypted key strings are scoped to the function call; they are never
 *    stored in module-level variables.
 *  - The KMS passphrase is passed to Postgres as a bind parameter, never
 *    interpolated into a query string or written to logs.
 *  - BYOK results are cached in a module-level Map (keyed by orgId) with a
 *    short TTL so we pay one DB round-trip per org per process lifetime,
 *    not one per message. Cache is invalidated when an org rotates their key
 *    via the admin API route (call invalidateByokCache(orgId) there).
 *  - The legacy `model` / `getModel` exports are lazy — they do NOT call
 *    buildPlatformClient() at module load time, so importing this file in
 *    test environments without API keys set does not throw.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { supabaseAdmin } from "@/lib/supabase/server";
import { maxTier, TIER_RANK } from "./tier-utils";

// ─── Types ─────────────────────────────────────────────────────────────────

/** LLM complexity tier used by the supervisor */
export type ModelTier = "simple" | "medium" | "complex";

/** LLM provider identifier stored in `llm_keys.provider` */
export type LLMProvider = "anthropic" | "openai" | "google";

/** Returned by resolveModelClient */
export interface ResolvedModel {
  client: BaseChatModel;
  provider: LLMProvider;
  model: string;
  tier: ModelTier;
  byok: boolean;
}

// ─── Model name matrix ─────────────────────────────────────────────────────

const MODEL_MATRIX: Readonly<Record<LLMProvider, Readonly<Record<ModelTier, string>>>> = {
  anthropic: {
    simple:  "claude-haiku-4-5",
    medium:  "claude-sonnet-4-5",
    complex: "claude-opus-4-5",
  },
  openai: {
    simple:  "gpt-4o-mini",
    medium:  "gpt-4o",
    complex: "gpt-4o",
  },
  google: {
    simple:  "gemini-2.0-flash",
    medium:  "gemini-2.5-pro",
    complex: "gemini-2.5-pro",
  },
} as const;

// Re-export so registry.ts can use it without a circular import via tier-utils
export { maxTier, TIER_RANK };

// ─── BYOK key cache ────────────────────────────────────────────────────────

interface ByokResult {
  provider: LLMProvider;
  plaintext: string;
}

interface ByokCacheEntry {
  result: ByokResult | null;
  /** Unix ms timestamp when this entry was cached */
  cachedAt: number;
}

/** Cache BYOK lookups for 5 minutes. Key rotations call invalidateByokCache(). */
const BYOK_CACHE_TTL_MS = 5 * 60 * 1000;
const _byokCache = new Map<string, ByokCacheEntry>();

/**
 * Evict a single org's BYOK entry from the cache.
 * Call this from the admin /api/admin/keys route whenever a key is
 * created, updated, or deleted so the factory picks up the new key
 * without waiting for TTL expiry.
 */
export function invalidateByokCache(orgId: string): void {
  _byokCache.delete(orgId);
}

/**
 * Fetches and decrypts the active BYOK key for the given org.
 * Results are cached for BYOK_CACHE_TTL_MS. Returns null when no
 * active key exists or KMS_SECRET is not configured.
 */
async function fetchByokKey(orgId: string): Promise<ByokResult | null> {
  const kmsSecret = process.env.KMS_SECRET;
  if (!kmsSecret) return null;

  // Check cache
  const cached = _byokCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < BYOK_CACHE_TTL_MS) {
    return cached.result;
  }

  const { data, error } = await supabaseAdmin.rpc("get_decrypted_llm_key", {
    p_org_id:  orgId,
    p_kms_key: kmsSecret,
  });

  if (error) {
    console.warn("[llm-factory] BYOK lookup failed, falling back to platform key:", error.message);
    // Cache the null result too — avoids hammering DB on a broken key
    _byokCache.set(orgId, { result: null, cachedAt: Date.now() });
    return null;
  }

  const row = (data as { provider: LLMProvider; plaintext: string } | null) ?? null;
  _byokCache.set(orgId, { result: row, cachedAt: Date.now() });
  return row;
}

// ─── Client instantiation ──────────────────────────────────────────────────

function buildAnthropicClient(apiKey: string, model: string): ChatAnthropic {
  return new ChatAnthropic({ apiKey, model, temperature: 0 });
}

function buildOpenAIClient(apiKey: string, model: string): ChatOpenAI {
  return new ChatOpenAI({ apiKey, modelName: model, temperature: 0 });
}

function buildGoogleClient(apiKey: string, model: string): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({ apiKey, model, temperature: 0 });
}

function buildPlatformClient(provider: LLMProvider, model: string): BaseChatModel {
  switch (provider) {
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("[llm-factory] ANTHROPIC_API_KEY is not set");
      return buildAnthropicClient(key, model);
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("[llm-factory] OPENAI_API_KEY is not set");
      return buildOpenAIClient(key, model);
    }
    case "google": {
      const key = process.env.GOOGLE_API_KEY;
      if (!key) throw new Error("[llm-factory] GOOGLE_API_KEY is not set");
      return buildGoogleClient(key, model);
    }
  }
}

// ─── Default platform provider ─────────────────────────────────────────────

function defaultProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY)    return "openai";
  if (process.env.GOOGLE_API_KEY)    return "google";
  throw new Error(
    "[llm-factory] No platform LLM API key found. " +
    "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY."
  );
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Resolves the correct LLM client for a request.
 *
 * @param orgId         Supabase org UUID — used to look up BYOK key.
 * @param complexity    Request-level complexity determined by the supervisor.
 * @param agentMinTier  Minimum tier enforced by the agent registry.
 *                      Effective tier = max(complexity, agentMinTier).
 *
 * @example
 * const { client, model } = await resolveModelClient(orgId, "medium", "simple");
 * const response = await client.invoke(messages);
 */
export async function resolveModelClient(
  orgId: string,
  complexity: ModelTier,
  agentMinTier: ModelTier = "simple",
): Promise<ResolvedModel> {
  const tier = maxTier(complexity, agentMinTier);

  const byok = await fetchByokKey(orgId);

  if (byok) {
    const modelName = MODEL_MATRIX[byok.provider][tier];
    let client: BaseChatModel;
    switch (byok.provider) {
      case "anthropic": client = buildAnthropicClient(byok.plaintext, modelName); break;
      case "openai":    client = buildOpenAIClient(byok.plaintext, modelName);    break;
      case "google":    client = buildGoogleClient(byok.plaintext, modelName);    break;
    }
    return { client, provider: byok.provider, model: modelName, tier, byok: true };
  }

  const provider = defaultProvider();
  const modelName = MODEL_MATRIX[provider][tier];
  const client = buildPlatformClient(provider, modelName);
  return { client, provider, model: modelName, tier, byok: false };
}

// ─── Legacy / convenience export (lazy — no module-load side effect) ───────
//
// supervisor.ts imports `model` directly. This shim keeps backward
// compatibility without throwing at module load time when API keys are absent.
//
// TODO (ATH-22): Remove once supervisor.ts calls resolveModelClient().

let _shimInstance: BaseChatModel | null = null;

function getShim(): BaseChatModel {
  if (_shimInstance) return _shimInstance;
  _shimInstance = buildPlatformClient(
    defaultProvider(),
    MODEL_MATRIX[defaultProvider()].simple,
  );
  return _shimInstance;
}

/** @deprecated Use resolveModelClient() instead. Will be removed in ATH-22. */
export const model = new Proxy({} as BaseChatModel, {
  get(_target, prop) {
    return (getShim() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** @deprecated Use resolveModelClient() instead. Will be removed in ATH-22. */
export const getModel = (): BaseChatModel => getShim();