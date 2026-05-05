import { describe, it, expect, vi, beforeEach } from "vitest";
import { calendarAgent } from "../calendar-agent";
import { HumanMessage } from "@langchain/core/messages";

// 1. Use vi.hoisted to ensure these exist before the mock is called
const mocks = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockWithStructuredOutput = vi.fn(() => ({
    invoke: mockInvoke
  }));
  return {
    mockInvoke,
    mockWithStructuredOutput
  };
});

// 2. Mock the LLM factory using the hoisted variables
vi.mock("../../langgraph/llm-factory", () => {
  const mockModel = {
    withStructuredOutput: mocks.mockWithStructuredOutput
  };
  return {
    model: mockModel,
    getModel: vi.fn(() => mockModel)
  };
});

describe("calendarAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts meeting details from natural language", async () => {
    const mockDraft = {
      summary: "Meeting with Alice",
      start: {
        dateTime: "2024-04-24T14:00:00Z",
        timeZone: "America/New_York"
      },
      end: {
        dateTime: "2024-04-24T15:00:00Z",
        timeZone: "America/New_York"
      },
      attendees: [{ displayName: "Alice", email: "alice@example.com" }]
    };

    // 3. Use the hoisted mockInvoke
    mocks.mockInvoke.mockResolvedValue(mockDraft);

    const state: any = {
      messages: [new HumanMessage("meeting with Alice tomorrow 2pm for 1h")],
      timezone: "America/New_York"
    };

    const result = await calendarAgent(state);

    expect(result.awaiting_approval).toBe(true);
    // pending_write_action is the canonical field (pending_action was the old name)
    expect((result.pending_write_action as any)?.tool).toBe("calendar-create");
    expect((result.pending_write_action as any)?.payload?.summary).toBe("Meeting with Alice");
    expect((result.pending_write_action as any)?.requested_at).toBeDefined();
  });

  it("handles errors by returning a user-friendly message", async () => {
    // 4. Use the hoisted mockInvoke to simulate failure
    mocks.mockInvoke.mockRejectedValue(new Error("LLM Error"));

    const state: any = {
      messages: [new HumanMessage("invalid request")],
      timezone: "UTC"
    };

    const result = await calendarAgent(state);

    expect(result.messages).toBeDefined();
    expect(result.messages[0].content).toContain("I'm sorry, I couldn't quite process that calendar request");
  });
});
