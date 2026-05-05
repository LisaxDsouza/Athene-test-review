import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportAgent } from "../report-agent";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { vectorSearch } from "../../tools/vector-search";

// Mock the vector search
vi.mock("../../tools/vector-search", () => ({
  vectorSearch: vi.fn()
}));

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@langchain/openai", () => {
  return {
    ChatOpenAI: vi.fn().mockImplementation(function () {
      return {
        invoke: mockInvoke,
      };
    }),
  };
});






describe("reportAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock returns structured rows with chunk_id and document_id
    (vectorSearch as any).mockResolvedValue([
      { chunk_id: "chk_001", document_id: "doc_abc", metadata: { text: "mocked chunk data", source: "doc1" } },
      { chunk_id: "chk_002", document_id: "doc_def", metadata: { text: "another chunk", source: "doc2" } },
    ]);
  });

  it("generates a 2-section report with citations preserved per section", async () => {
    mockInvoke.mockImplementation(async (messages: any[]) => {
      const prompt = messages[0].content.toString();
      if (prompt.includes("Report Planning Prompt") || prompt.includes("Return a JSON array")) {
        return { content: '["Section A", "Section B"]' };
      }
      return { content: "Activity was high last week [source: chk_001]. Deployment count increased [source: chk_002]." };
    });


    const fakeState: any = {
      orgId: "org_123",
      userId: "user_456",
      role: "member",
      messages: [new HumanMessage("Summarize the recent updates (2 sections)")],
    };

    const result = await reportAgent(fakeState, {});

    expect(result.final_answer).toBeDefined();

    // Structured markdown headings
    expect(result.final_answer).toContain("## Section A");
    expect(result.final_answer).toContain("## Section B");

    // Sections appear in the correct order
    const indexA = result.final_answer?.indexOf("## Section A") ?? -1;
    const indexB = result.final_answer?.indexOf("## Section B") ?? -1;
    expect(indexA).toBeLessThan(indexB);

    // Citations preserved per section
    expect(result.final_answer).toContain("[source: chk_001]");
    expect(result.final_answer).toContain("[source: chk_002]");

    // vectorSearch called once per section
    expect(vectorSearch).toHaveBeenCalledTimes(2);

    // Verify chunk_id was passed to the synthesis prompt
    const synthesisCalls = mockInvoke.mock.calls.filter(
      (call: any) => call[0][0].content.includes("chunk_id=")
    );
    expect(synthesisCalls.length).toBe(2);


  });

  it("generates a 5-section report with citations preserved per section", async () => {
    mockInvoke.mockImplementation(async (messages: any[]) => {
      const prompt = messages[0].content.toString();
      if (prompt.includes("Report Planning Prompt") || prompt.includes("Return a JSON array")) {
        return { content: '["Intro", "Metrics", "Events", "Risks", "Conclusion"]' };
      }
      return { content: "Data shows growth [source: chk_001]. Risk identified in deployment pipeline [source: chk_002]." };
    });


    const fakeState: any = {
      orgId: "org_123",
      userId: "user_456",
      role: "member",
      messages: [new HumanMessage("Summarize the recent updates (5 sections)")],
    };

    const result = await reportAgent(fakeState, {});

    expect(result.final_answer).toBeDefined();

    // All 5 section headings present
    expect(result.final_answer).toContain("## Intro");
    expect(result.final_answer).toContain("## Metrics");
    expect(result.final_answer).toContain("## Events");
    expect(result.final_answer).toContain("## Risks");
    expect(result.final_answer).toContain("## Conclusion");

    // Ordering
    const indexIntro = result.final_answer?.indexOf("## Intro") ?? -1;
    const indexConclusion = result.final_answer?.indexOf("## Conclusion") ?? -1;
    expect(indexIntro).toBeLessThan(indexConclusion);

    // Citations preserved per section
    expect(result.final_answer).toContain("[source: chk_001]");
    expect(result.final_answer).toContain("[source: chk_002]");

    // vectorSearch called once per section
    expect(vectorSearch).toHaveBeenCalledTimes(5);

    // Verify chunk_id metadata was passed into every synthesis prompt
    const synthesisCalls = mockInvoke.mock.calls.filter(
      (call: any) => call[0][0].content.includes("chunk_id=")
    );
    expect(synthesisCalls.length).toBe(5);


  });

  it("handles array-style content blocks without producing [object Object]", async () => {
    mockInvoke.mockImplementation(async (messages: any[]) => {
      const prompt = messages[0].content.toString();
      if (prompt.includes("Report Planning Prompt") || prompt.includes("Return a JSON array")) {
        return { content: '["Overview"]' };
      }
      return { content: "Weekly summary data [source: chk_001]." };
    });


    // Simulate a LangChain message whose .content is an array of blocks
    const fakeState: any = {
      orgId: "org_123",
      userId: "user_456",
      role: "member",
      messages: [{
        content: [{ type: "text", text: "Weekly product summary" }],
        _getType: () => "human",
      }],
    };

    const result = await reportAgent(fakeState, {});

    expect(result.final_answer).toContain("## Overview");
    expect(result.final_answer).not.toContain("[object Object]");

    // Citation present
    expect(result.final_answer).toContain("[source: chk_001]");

    // Verify vectorSearch received a real string, not "[object Object]"
    const searchCall = (vectorSearch as any).mock.calls[0][0];
    expect(searchCall.query).toContain("Weekly product summary");
    expect(searchCall.query).not.toContain("[object Object]");
  });
});
