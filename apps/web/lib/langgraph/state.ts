/**
 * lib/langgraph/state.ts
 *
 * AtheneState — the single source of truth for all data flowing through
 * the LangGraph agent pipeline.
 *
 * Design rules:
 *  - Zero `any`. Every field is strictly typed.
 *  - Identity fields (org_id … bi_grant_id) are set ONCE at request
 *    start and never mutated by agent nodes.
 *  - thread_id is intentionally NOT stored in AtheneState. LangGraph owns
 *    it via RunnableConfig.configurable.thread_id — duplicating it here
 *    creates a silent mismatch when nodes read state.thread_id before the
 *    first state update arrives. Read thread_id from
 *    config.configurable.thread_id in node functions instead.
 *  - retrieved_chunks is ephemeral: the synthesis agent clears it after
 *    producing final_answer, keeping the checkpoint lean.
 *  - accessible_dept_ids uses a deduplicating-append reducer so parallel
 *    retrieval nodes can safely write to it concurrently.
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

// ─── Domain value types ────────────────────────────────────────────────────

/** User roles recognised throughout the system */
export type UserRole = "member" | "bi_analyst" | "super_user" | "admin";

/** LLM complexity tier used by the supervisor to select model */
export type Complexity = "simple" | "medium" | "complex";

/** Run lifecycle status */
export type RunStatus = "idle" | "running" | "awaiting_approval" | "completed" | "failed";

/**
 * Which agent the supervisor last routed to.
 * Uses short canonical names that match the supervisor LLM schema.
 * The graph edge map translates these to full node names (retrieval_agent etc.).
 */
export type ActiveAgent =
  | "retrieval"
  | "cross_dept_retrieval"
  | "email"
  | "calendar"
  | "report"
  | "data_index"
  | "synthesis"
  | "END"
  | null;

/** Task classification set by the supervisor */
export type TaskType =
  | "document_search"
  | "cross_dept_analysis"
  | "email_draft"
  | "email_read"
  | "calendar_create"
  | "calendar_read"
  | "report_generation"
  | "data_index"
  | "cross_dept_retrieval"
  | "synthesis"
  | null;

// ─── Sub-object interfaces (no `any`) ─────────────────────────────────────

/** A single retrieved vector-search chunk (ephemeral — cleared after synthesis) */
export interface RetrievedChunk {
  id?: string;
  document_id: string;
  /** Truncated preview text shown in citations */
  content_preview: string;
  chunk_index: number;
  source_type: string;
  external_url?: string | null;
  department_id?: string | null;
  similarity?: number;
}

/** Source reference included in the final answer */
export interface CitedSource {
  document_id: string;
  title: string | null;
  external_url?: string | null;
  chunk_index: number;
  source_type: string;
}

/**
 * A pending async tool call dispatched to QStash.
 * Stored so the graph can resume once the worker responds.
 */
export interface PendingToolCall {
  tool_name: string;
  tool_call_id: string;
  /** ISO-8601 timestamp when the call was dispatched */
  dispatched_at: string;
  /** Opaque payload forwarded to the worker */
  payload: Record<string, unknown>;
}

/**
 * A write-action waiting for human-in-the-loop approval.
 * Persisted in the checkpoint so approval can arrive asynchronously.
 */
export interface PendingWriteAction {
  tool: string;
  payload: Record<string, unknown>;
  /** ISO-8601 */
  requested_at: string;
}

// ─── Deduplicating reducer for dept ID arrays ─────────────────────────────

/**
 * Merge two dept-ID arrays, removing duplicates.
 * Safe for concurrent writes from parallel retrieval nodes.
 * Reset to empty array by passing `[]` as incoming (last-write-wins
 * semantics are preserved for the empty case via LangGraph update order).
 */
function mergeDeptIds(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  const set = new Set(existing);
  for (const id of incoming) set.add(id);
  return Array.from(set);
}

// ─── State annotation ──────────────────────────────────────────────────────

export const AtheneState = Annotation.Root({
  // Spread LangGraph's built-in messages channel
  ...MessagesAnnotation.spec,

  // ── Identity (immutable after request start) ──────────────────────────
  //
  // Thread id is persisted in state for compatibility with existing nodes/tests.
  // LangGraph owns thread_id via RunnableConfig.configurable.thread_id.
  // Storing it here risks a silent mismatch (state value vs. checkpoint key).
  // Node functions should read thread_id from config.configurable.thread_id.

  thread_id: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  /** Internal Supabase org UUID */
  org_id: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  /** Clerk user ID */
  user_id: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  user_role: Annotation<UserRole | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  /** User's primary department UUID */
  user_dept_id: Annotation<string | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  /**
   * Dept UUIDs the user may access via BI grants.
   * Deduplicating-append reducer: safe for concurrent retrieval node writes.
   */
  accessible_dept_ids: Annotation<string[]>({
    reducer: mergeDeptIds,
    default: () => [],
  }),
  /** Active BI access-grant ID (null if user has no cross-dept grant) */
  bi_grant_id: Annotation<string | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),

  // ── Routing ──────────────────────────────────────────────────────────
  /** Currently executing agent node */
  active_agent: Annotation<ActiveAgent>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  /**
   * Next node the supervisor wants to route to.
   * Plain string (not a union) so the conditional-edge map can forward it
   * without a hard-coded union that must be kept in sync with graph.ts.
   */
  next: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "FINISH",
  }),
  task_type: Annotation<TaskType>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  complexity: Annotation<Complexity>({
    reducer: (_x, y) => y,
    default: () => "simple",
  }),
  is_cross_dept_query: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => false,
  }),

  // ── Retrieved context (ephemeral — cleared after synthesis) ──────────
  /**
   * Raw chunks accumulated by retrieval nodes.
   * Synthesis agent reads these then sets retrieved_chunks: [] to keep
   * subsequent checkpoints small.
   */
  retrieved_chunks: Annotation<RetrievedChunk[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),

  // ── Routing / tracing helpers ────────────────────────────────────────
  /**
   * Number of supervisor→agent hops in the current run.
   * Supervisor increments this on every invocation and short-circuits
   * to END when it exceeds MAX_HOPS (prevents infinite loops).
   */
  hop_count: Annotation<number>({
    reducer: (_x, y) => y,
    default: () => 0,
  }),
  /**
   * Supervisor's plain-English reasoning for the routing decision.
   * Logged to the audit trail; never shown to the end user.
   */
  reasoning: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  // ── Async tool state ─────────────────────────────────────────────────
  pending_tool_calls: Annotation<PendingToolCall[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),
  run_status: Annotation<RunStatus>({
    reducer: (_x, y) => y,
    default: () => "idle",
  }),

  // ── HITL ─────────────────────────────────────────────────────────────
  awaiting_approval: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => false,
  }),
  pending_write_action: Annotation<PendingWriteAction | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),

  // ── Output ───────────────────────────────────────────────────────────
  final_answer: Annotation<string | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  cited_sources: Annotation<CitedSource[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),
});

// ─── Convenience type aliases ──────────────────────────────────────────────

/**
 * Full inferred state type — primary alias for node function signatures.
 *
 * Usage:
 *   import type { AtheneStateType } from "../state";
 *   async function myNode(state: AtheneStateType): Promise<AtheneStateUpdate> { … }
 *
 * Test helpers that need to construct a full state object should import
 * `AtheneState` (the type alias below) so they can spread all required fields.
 */
export type AtheneStateType = typeof AtheneState.State;

/**
 * Type alias for the full state shape.
 *
 * Exported as `AtheneState` so test files can use it as a type:
 *   import type { AtheneState } from "../../state";
 *
 * DO NOT confuse with the `AtheneState` const (the Annotation.Root object).
 * TypeScript resolves the name correctly because the const is a value export
 * and this is a type export — they live in separate namespaces.
 */
export type AtheneState = AtheneStateType;

/** Partial return type for every node function (nodes only return changed fields). */
export type AtheneStateUpdate = Partial<AtheneStateType>;