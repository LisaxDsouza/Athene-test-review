/**
 * lib/langgraph/agents/registry.ts
 *
 * Single source of truth for every agent's constraints.
 *
 * Fields:
 *  name          — human-readable label for UI / logging
 *  minTier       — minimum LLM tier; effective tier = max(requestComplexity, minTier)
 *  allowedRoles  — which UserRoles may invoke this agent
 *  needsApproval — HITL requirement mode (see ApprovalMode)
 *  crossDept     — whether this agent may read across department boundaries
 *
 * ApprovalMode:
 *  false        — no approval required (read-only agents)
 *  'write-only' — approval required only for write tool calls
 *  true         — every invocation requires human approval
 *
 * Role hierarchy (lowest → highest privilege):
 *  member < super_user < admin
 *
 * Matches Chapter 6 of the architecture doc and the `user_role` values in
 * the Supabase `org_members` table.
 *
 * Tier logic uses shared maxTier() from tier-utils.ts — not duplicated here.
 */

import type { UserRole } from "../state";
import type { ModelTier } from "../llm-factory";
import { maxTier } from "../tier-utils";

export type ApprovalMode = false | "write-only" | true;

export interface AgentDefinition {
  /** Display name for UI / logging */
  name: string;
  /** Minimum LLM tier; actual tier = max(requestComplexity, minTier) */
  minTier: ModelTier;
  /** User roles that may trigger this agent */
  allowedRoles: readonly UserRole[];
  /** HITL approval requirement */
  needsApproval: ApprovalMode;
  /** Whether this agent may read across department boundaries */
  crossDept: boolean;
}

// ─── Catalog ────────────────────────────────────────────────────────────────
//
// Keys MUST match the node names registered in graph.ts so that the
// agentAllowedForRole / agentNeedsApproval helpers can be called from
// the supervisor without a separate mapping step.

export const AGENT_REGISTRY = {
  retrieval_agent: {
    name:          "Retrieval Agent",
    minTier:       "simple",
    allowedRoles:  ["member", "bi_analyst", "super_user", "admin"],
    needsApproval: false,
    crossDept:     false,
  },

  cross_dept_agent: {
    name:          "Cross-Department Retrieval Agent",
    // Architecture doc §7: cross_dept agent is always ≥ complex
    minTier:       "complex",
    allowedRoles:  ["bi_analyst", "super_user", "admin"],
    needsApproval: false,
    crossDept:     true,
  },

  email_agent: {
    name:          "Email Agent",
    minTier:       "medium",
    allowedRoles:  ["member", "bi_analyst", "super_user", "admin"],
    needsApproval: "write-only",
    crossDept:     false,
  },

  calendar_agent: {
    name:          "Calendar Agent",
    minTier:       "medium",
    allowedRoles:  ["member", "bi_analyst", "super_user", "admin"],
    needsApproval: "write-only",
    crossDept:     false,
  },

  report_agent: {
    name:          "Report Agent",
    minTier:       "medium",
    // Reports aggregate data across departments — restricted to elevated roles
    allowedRoles:  ["bi_analyst", "super_user", "admin"],
    needsApproval: false,
    crossDept:     true,
  },

  data_index_agent: {
    name:          "Data Index Agent",
    minTier:       "simple",
    allowedRoles:  ["admin"],
    // Indexing mutates the knowledge base — always requires approval
    needsApproval: true,
    crossDept:     false,
  },
} as const satisfies Record<string, AgentDefinition>;

export type AgentName = keyof typeof AGENT_REGISTRY;

// ─── Lookup helpers ─────────────────────────────────────────────────────────

/** Returns the full definition for an agent. */
export function getAgent(name: AgentName): AgentDefinition {
  return AGENT_REGISTRY[name];
}

/**
 * Returns true if the given role is permitted to invoke the agent.
 *
 * @example
 * if (!agentAllowedForRole("cross_dept_agent", state.user_role)) {
 *   throw new ForbiddenError();
 * }
 */
export function agentAllowedForRole(name: AgentName, role: UserRole): boolean {
  return (AGENT_REGISTRY[name].allowedRoles as readonly UserRole[]).includes(role);
}

/**
 * Returns true if the agent requires human approval for this invocation.
 *
 * @param isWriteOperation  Set to true when the agent is about to execute
 *                          a mutating tool call (send email, create event …).
 */
export function agentNeedsApproval(name: AgentName, isWriteOperation: boolean): boolean {
  const mode: ApprovalMode = AGENT_REGISTRY[name].needsApproval;
  if (mode === false) return false;
  if (mode === true)  return true;
  return isWriteOperation; // "write-only"
}

/**
 * Returns the effective ModelTier for a request, honouring the agent's
 * minimum tier constraint.
 *
 * Uses the shared maxTier() from tier-utils — no local object allocation.
 *
 * @example
 * const tier = effectiveTierForAgent("cross_dept_agent", "simple"); // → "complex"
 */
export function effectiveTierForAgent(name: AgentName, requestedTier: ModelTier): ModelTier {
  return maxTier(requestedTier, AGENT_REGISTRY[name].minTier as ModelTier);
}