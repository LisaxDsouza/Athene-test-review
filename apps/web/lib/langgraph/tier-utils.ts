/**
 * lib/langgraph/tier-utils.ts
 *
 * Shared tier comparison utilities used by both llm-factory.ts and
 * agents/registry.ts. Extracted to a standalone file so neither module
 * needs to import from the other, preventing circular dependencies.
 *
 * TIER_RANK provides a stable numeric ordering so maxTier() can compare
 * tiers without a hard-coded switch. Adding a new tier only requires
 * updating this object — all callers stay correct automatically.
 */

export type ModelTier = "simple" | "medium" | "complex";

/** Numeric rank for each tier (higher = more capable / more expensive). */
export const TIER_RANK: Readonly<Record<ModelTier, number>> = {
  simple:  0,
  medium:  1,
  complex: 2,
} as const;

/**
 * Returns the higher of two ModelTiers.
 *
 * Used by the LLM factory and the agent registry to enforce agent
 * minimum tiers: effective_tier = max(requestComplexity, agentMinTier).
 *
 * @example
 * maxTier("simple", "complex") // → "complex"
 * maxTier("medium", "medium")  // → "medium"
 */
export function maxTier(a: ModelTier, b: ModelTier): ModelTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}
