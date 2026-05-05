// ============================================================
// email-agent.test.ts — Unit tests for ATH-37 (Email Agent)
//
// Validates:
//   1. Drafts email with to/subject/body from real context
//   2. Never sends — only fills pending_write_action
//   3. Sets awaiting_approval = true for HITL gate
//   4. Handles JSON parsing edge cases
//   5. Passes retrieved CRM context to the LLM prompt
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Hoist ALL external module mocks BEFORE imports ---------
// The @langchain/langgraph import in state.ts crashes vitest.
// We mock every module in the import chain to prevent it.

vi.mock("@langchain/langgraph", () => {
  const Annotation: any = { Root: () => ({}) };
  return { Annotation, messagesStateReducer: () => [], StateGraph: vi.fn(), START: "START", END: "END" };
});
vi.mock("@langchain/langgraph-checkpoint", () => ({ BaseCheckpointSaver: class {} }));
vi.mock("@langchain/core/messages", () => ({}));
vi.mock("@langchain/core/runnables", () => ({}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));
vi.mock("openai", () => ({ default: class {} }));
vi.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: class {} }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
    }),
  }),
}));
vi.mock("../../langgraph/llm-factory", () => ({
  resolveModelClient: vi.fn(),
}));

// ---- Now safe to import ------------------------------------

import { emailAgentNode } from "../email-agent";
import * as llmFactory from "../../langgraph/llm-factory";

// ---- Helpers ------------------------------------------------

function makeMockState(overrides: Record<string, any> = {}) {
  return {
    thread_id: "thread-abc-123",
    org_id: "org-athene-prod",
    user_id: "user-prajwal-001",
    user_role: "member",
    user_dept_id: "dept-engineering",
    accessible_dept_ids: ["dept-engineering"],
    bi_grant_id: null,
    messages: [
      { _getType: () => "human", content: "Email Bob about Friday's meeting" },
    ],
    active_agent: "email_agent",
    task_type: "email-draft",
    complexity: "medium",
    is_cross_dept_query: false,
    retrieved_chunks: [
      {
        id: "chunk-hs-contact-901",
        document_id: "doc-hubspot-contacts-batch-7",
        content_preview: "Contact: Bob Smith\nTitle: VP of Engineering\nEmail: bob.smith@acmecorp.com\nCompany: Acme Corp\nPhone: +1-555-0142",
        chunk_index: 0,
        source_type: "hubspot_contacts",
        external_url: "https://app.hubspot.com/contacts/12345/contact/901",
        department_id: "dept-engineering",
        similarity: 0.95,
      },
    ],
    run_status: "running",
    awaiting_approval: false,
    pending_write_action: null,
    final_answer: null,
    cited_sources: [],
    ...overrides,
  };
}

function mockAnthropicResponse(jsonText: string) {
  vi.mocked(llmFactory.resolveModelClient).mockResolvedValue({
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    anthropic: {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: jsonText }],
        }),
      },
    } as any,
  });
}

// ---- Tests --------------------------------------------------

describe("emailAgentNode (ATH-37)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drafts an email with real contact data from retrieved_chunks", async () => {
    const draftJson = JSON.stringify({
      to: ["bob.smith@acmecorp.com"],
      cc: [],
      subject: "Friday's Meeting",
      body: "Hi Bob,\n\nI wanted to touch base about our meeting this Friday. Please let me know if there's anything specific you'd like to cover.\n\nBest regards,\nPrajwal",
    });

    mockAnthropicResponse(draftJson);
    const update = await emailAgentNode(makeMockState() as any);

    // HITL gate must be set
    expect(update.run_status).toBe("awaiting_approval");
    expect(update.awaiting_approval).toBe(true);
    expect(update.pending_write_action).toBeDefined();
    expect(update.pending_write_action!.tool).toBe("email-send");
    expect(update.pending_write_action!.requested_at).toBeTruthy();

    // Payload uses real CRM email
    const p = update.pending_write_action!.payload as Record<string, any>;
    expect(p.to).toEqual(["bob.smith@acmecorp.com"]);
    expect(p.cc).toEqual([]);
    expect(p.subject).toBe("Friday's Meeting");
    expect(p.body).toContain("Bob");
  });

  it("never calls Nango/Gmail/Outlook — only fills pending_write_action", async () => {
    mockAnthropicResponse(JSON.stringify({
      to: ["alice.chen@globex.io"], cc: [], subject: "Q3 Report", body: "Hi Alice,\n\nPlease find the Q3 report.",
    }));

    const update = await emailAgentNode(makeMockState({
      messages: [{ _getType: () => "human", content: "Send Alice the Q3 report" }],
      retrieved_chunks: [{
        id: "chunk-sf-42", document_id: "doc-sf", chunk_index: 0, similarity: 0.92,
        content_preview: "Contact: Alice Chen\nEmail: alice.chen@globex.io\nCompany: Globex Inc",
        source_type: "salesforce_contacts", external_url: null, department_id: null,
      }],
    }) as any);

    expect(update.pending_write_action!.tool).toBe("email-send");
    expect(update.awaiting_approval).toBe(true);
    expect(update.run_status).toBe("awaiting_approval");
  });

  it("handles LLM response wrapped in markdown code fences", async () => {
    mockAnthropicResponse('```json\n{"to":["dev@team.io"],"cc":[],"subject":"Standup","body":"Hi team"}\n```');
    const update = await emailAgentNode(makeMockState({
      retrieved_chunks: [{
        id: "c1", document_id: "d1", chunk_index: 0, similarity: 0.88,
        content_preview: "Team Dev Channel\nEmail: dev@team.io",
        source_type: "slack", external_url: null, department_id: null,
      }],
    }) as any);

    const p = update.pending_write_action!.payload as Record<string, any>;
    expect(p.to).toEqual(["dev@team.io"]);
    expect(p.subject).toBe("Standup");
  });

  it("returns empty fields on malformed LLM output (never crashes)", async () => {
    mockAnthropicResponse("This is not JSON at all");
    const update = await emailAgentNode(makeMockState() as any);

    expect(update.awaiting_approval).toBe(true);
    expect(update.pending_write_action!.tool).toBe("email-send");
    const p = update.pending_write_action!.payload as Record<string, any>;
    expect(p.to).toEqual([]);
    expect(p.subject).toBe("");
    expect(p.body).toBe("");
  });

  it("passes retrieved CRM context to the LLM prompt", async () => {
    let capturedPrompt = "";
    vi.mocked(llmFactory.resolveModelClient).mockResolvedValue({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      anthropic: {
        messages: {
          create: vi.fn().mockImplementation(async (params: any) => {
            capturedPrompt = params.system;
            return { content: [{ type: "text", text: JSON.stringify({ to: ["bob.smith@acmecorp.com"], cc: [], subject: "Test", body: "body" }) }] };
          }),
        },
      } as any,
    });

    await emailAgentNode(makeMockState() as any);
    expect(capturedPrompt).toContain("bob.smith@acmecorp.com");
    expect(capturedPrompt).toContain("Acme Corp");
    expect(capturedPrompt).toContain("VP of Engineering");
  });
});
